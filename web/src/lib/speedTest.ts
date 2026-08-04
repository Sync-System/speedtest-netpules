export type Phase = "idle" | "ping" | "download" | "upload" | "done";

/**
 * Base URL prefixed onto every API call. Empty by default, which keeps
 * requests relative ("/api/...") for a same-origin deployment — the normal
 * case, where this Express server also serves the built frontend.
 *
 * Set VITE_API_BASE_URL when the frontend and backend are hosted separately
 * (e.g. frontend on Vercel/Netlify, backend on Render/Railway) so requests
 * go to the backend's actual origin instead of 404ing against whatever
 * static host is serving the page. No trailing slash — set it to
 * "https://your-backend.onrender.com", not ".../".
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ClientInfo {
  ip: string;
  isp: string;
  city: string;
  region: string;
  country: string;
}

export interface LatencyResult {
  pingMs: number;
  jitterMs: number;
  minMs: number;
  maxMs: number;
}

export interface TestResult {
  timestamp: number;
  pingMs: number;
  jitterMs: number;
  downloadMbps: number;
  uploadMbps: number;
  /** Latency measured while the link is saturated, i.e. bufferbloat. */
  loadedPingMs: number | null;
}

/** A measured rate plus the spread actually observed while measuring it. */
export interface RateSummary {
  mbps: number;
  lowMbps: number;
  highMbps: number;
  stability: Stability;
}

const PING_SAMPLES = 10;

/**
 * A single TCP connection cannot fill a high bandwidth-delay-product link:
 * its throughput is capped near cwnd/RTT, so on a 200 ms path one stream
 * plateaus far below line rate no matter how fast the link is. Real speed
 * tests open several streams and sum them; this is the single biggest
 * accuracy factor for fast connections.
 */
const DOWNLOAD_STREAMS = 6;
const UPLOAD_STREAMS = 4;

/**
 * Per-request payload sizes. Streams restart when drained, so these must be
 * large enough that a *fast* link doesn't finish one in milliseconds: at
 * 32 MiB a loopback stream completed in ~20ms, so six streams reconnected
 * hundreds of times per phase and tripped our own rate limiter. Sized so even
 * a multi-gigabit link needs only a handful of requests per phase.
 */
const DOWNLOAD_CHUNK_BYTES = 200 * 1024 * 1024; // the server's hard cap
/**
 * Kept well under 4.5 MiB, not chosen for TCP-warmup reasons like the
 * download chunk above. Serverless hosts (Vercel, and most others) cap
 * incoming request body size — commonly ~4.5 MiB — and reject anything
 * larger before it reaches our Express handler at all. A too-large chunk
 * here doesn't measure a slow upload; every attempt fails identically, so
 * the reported speed is a flat, suspiciously steady 0 regardless of the
 * real connection. Response *streaming* (the download side) isn't subject
 * to the same limit, which is why only this constant needs to respect it.
 */
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * TCP starts slow (slow-start) and ramps toward the path's capacity. Bytes
 * moved during that ramp are real but not representative of the link's
 * steady-state rate, so they're excluded from the reported figure — we only
 * measure the window after the connection has settled.
 */
const WARMUP_MS = 1_800;
const MEASURE_MS = 6_200;
const SAMPLE_INTERVAL_MS = 150;

/**
 * Averaging period for the reported range.
 *
 * The 150ms display sampling is deliberately faster than a round trip so the
 * gauge feels responsive — but a window shorter than the RTT cannot measure
 * throughput. It measures TCP burst arrival: on a 280ms path some 150ms slices
 * catch a burst and others catch nothing, so the percentiles bottom out at
 * zero even though the link never actually stalled. Statistics are therefore
 * built from buckets long enough to span several round trips.
 */
const STATS_BUCKET_MS = 1_000;

function bytesToMbps(bytes: number, ms: number): number {
  if (ms <= 0) return 0;
  return (bytes * 8) / (ms / 1000) / 1_000_000;
}

/**
 * Incompressible payload. An all-zero buffer (the obvious choice) is a
 * correctness bug: anything along the path that applies gzip/brotli —
 * a proxy, a tunnel, an ISP middlebox — collapses it to almost nothing and
 * the measured "upload speed" becomes fiction. Random bytes can't be
 * compressed, so what we send is what actually crosses the wire.
 */
let uploadPayload: Blob | null = null;
function getUploadPayload(): Blob {
  if (uploadPayload) return uploadPayload;
  const buffer = new Uint8Array(UPLOAD_CHUNK_BYTES);
  // getRandomValues caps at 65536 bytes per call, so fill in blocks.
  const BLOCK = 65536;
  for (let offset = 0; offset < buffer.length; offset += BLOCK) {
    crypto.getRandomValues(buffer.subarray(offset, Math.min(offset + BLOCK, buffer.length)));
  }
  uploadPayload = new Blob([buffer], { type: "application/octet-stream" });
  return uploadPayload;
}

// api.ipify.org has no IPv6 (AAAA) DNS record, so any connection to it is
// forced over IPv4 — the only reliable way to learn the caller's IPv4
// address on a dual-stack connection, since our own server only sees
// whichever family the browser happened to route the main request over
// (X-Forwarded-For can't retroactively reveal the other family).
async function fetchIPv4(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ip ?? null;
  } catch {
    return null;
  }
}

export async function fetchClientInfo(signal?: AbortSignal): Promise<ClientInfo> {
  const [whoamiResult, ipv4Result] = await Promise.allSettled([
    // Resolved by our own server (which sees the real client IP) rather than
    // the browser calling a third party directly — same-origin, so it can't
    // be blocked by CSP/CORS/ad-blockers the way a cross-origin fetch can.
    fetch(`${API_BASE}/api/whoami`, { signal, cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json();
    }),
    fetchIPv4(signal),
  ]);

  const data = whoamiResult.status === "fulfilled" ? whoamiResult.value : {};
  const ipv4 = ipv4Result.status === "fulfilled" ? ipv4Result.value : null;

  return {
    ip: ipv4 ?? data.ip ?? "unavailable",
    isp: data.isp ?? "Unknown ISP",
    city: data.city ?? "",
    region: data.region ?? "",
    country: data.country ?? "",
  };
}

/**
 * One round trip. Prefers the Resource Timing entry over the JS wall clock:
 * `performance.now()` around an `await` also counts event-loop scheduling and
 * response parsing, which inflates RTT — `responseStart - requestStart` is the
 * network time the browser itself observed.
 */
async function pingOnce(signal?: AbortSignal): Promise<number> {
  const url = `${API_BASE}/api/ping?_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const wallStart = performance.now();
  await fetch(url, { cache: "no-store", signal });
  const wallElapsed = performance.now() - wallStart;

  const entry = performance
    .getEntriesByType("resource")
    .reverse()
    .find((e) => e.name.includes(url)) as PerformanceResourceTiming | undefined;

  if (entry && entry.responseStart > 0 && entry.requestStart > 0) {
    return entry.responseStart - entry.requestStart;
  }
  return wallElapsed;
}

/**
 * Jitter as mean deviation between *consecutive* samples (the RFC 3550
 * approach). The naive max-minus-min is a range, not jitter: a single
 * outlier — one scheduler hiccup — dominates it and reports wild numbers on
 * a connection that is actually stable.
 */
function computeJitter(samples: number[]): number {
  if (samples.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < samples.length; i++) {
    sum += Math.abs(samples[i] - samples[i - 1]);
  }
  return sum / (samples.length - 1);
}

export async function measurePing(
  onSample?: (ms: number) => void,
  signal?: AbortSignal,
): Promise<LatencyResult> {
  const samples: number[] = [];
  for (let i = 0; i < PING_SAMPLES; i++) {
    const ms = await pingOnce(signal);
    // Discard the first sample: it pays for connection setup, not RTT.
    if (i > 0) {
      samples.push(ms);
      onSample?.(ms);
    }
  }

  if (samples.length === 0) return { pingMs: 0, jitterMs: 0, minMs: 0, maxMs: 0 };

  // Median, not mean: a single stalled request shouldn't move the headline
  // latency figure. Jitter already reports the variability separately.
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const pingMs =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return {
    pingMs,
    jitterMs: computeJitter(samples),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

export type Stability = "very-stable" | "stable" | "variable" | "unstable";

interface TransferOutcome {
  mbps: number;
  /** 25th percentile of in-window samples — the low end of observed rate. */
  lowMbps: number;
  /** 75th percentile of in-window samples. */
  highMbps: number;
  /** How much the rate fluctuated during the measured window. */
  stability: Stability;
  /** RTTs sampled while the link was saturated (bufferbloat probe). */
  loadedPings: number[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Describes the spread of throughput observed during the measured window.
 *
 * Reporting a bare "9.2 Mbps" implies a precision no speed test has: repeat
 * runs on the same link routinely differ by double digits. The range here is
 * not a synthesised error bar — it's the interquartile range of rates actually
 * seen, so "9–11" means the connection genuinely moved between those rates.
 */
function summarize(headlineMbps: number, samples: number[]): {
  lowMbps: number;
  highMbps: number;
  stability: Stability;
} {
  if (samples.length < 4) {
    return { lowMbps: headlineMbps, highMbps: headlineMbps, stability: "stable" };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const lowMbps = percentile(sorted, 0.25);
  const highMbps = percentile(sorted, 0.75);

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance =
    samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
  // Coefficient of variation: spread relative to magnitude, so the thresholds
  // mean the same thing on a 5 Mbps line as on a 500 Mbps one.
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  const stability: Stability =
    cv < 0.1 ? "very-stable" : cv < 0.25 ? "stable" : cv < 0.5 ? "variable" : "unstable";

  return { lowMbps, highMbps, stability };
}

type ProgressFn = (instantMbps: number, fractionDone: number) => void;

/**
 * Shared engine for both directions. Runs N streams concurrently, restarting
 * each as it drains so the pipe never goes idle mid-measurement, and reports
 * throughput from the steady-state window only.
 */
async function runTransfer(
  streamCount: number,
  startStream: (signal: AbortSignal, onBytes: (n: number) => void) => Promise<void>,
  onProgress: ProgressFn,
  externalSignal: AbortSignal | undefined,
  probeLoadedLatency: boolean,
): Promise<TransferOutcome> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);

  let totalBytes = 0;
  const addBytes = (n: number) => {
    totalBytes += n;
  };

  // Keep each stream busy until the phase ends.
  const streamLoop = async () => {
    let consecutiveFailures = 0;
    while (!controller.signal.aborted) {
      try {
        await startStream(controller.signal, addBytes);
        consecutiveFailures = 0;
      } catch {
        if (controller.signal.aborted) return;
        // A single stream failing (reset, server hiccup) shouldn't kill the
        // whole measurement — but retrying at a flat interval turns a
        // persistent failure into a request flood that trips the server's own
        // rate limiter, so back off exponentially.
        consecutiveFailures++;
        const delay = Math.min(2000, 100 * 2 ** (consecutiveFailures - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  };

  const streams = Array.from({ length: streamCount }, streamLoop);

  const phaseStart = performance.now();
  let windowStart: number | null = null;
  let windowStartBytes = 0;
  let lastSampleAt = phaseStart;
  let lastSampleBytes = 0;
  const loadedPings: number[] = [];
  // Only buckets from the steady-state window feed the reported range —
  // including warm-up would widen it with slow-start ramp rates the link
  // isn't actually fluctuating to.
  const windowSamples: number[] = [];
  let bucketStartAt = 0;
  let bucketStartBytes = 0;

  await new Promise<void>((resolve) => {
    const sampler = setInterval(() => {
      const now = performance.now();
      const elapsed = now - phaseStart;

      const sinceLast = now - lastSampleAt;
      if (sinceLast > 0) {
        // Fine-grained, for the live gauge only.
        onProgress(
          bytesToMbps(totalBytes - lastSampleBytes, sinceLast),
          Math.min(elapsed / (WARMUP_MS + MEASURE_MS), 1),
        );
        lastSampleAt = now;
        lastSampleBytes = totalBytes;
      }

      // Warm-up finished: this is where the real measurement starts.
      if (windowStart === null && elapsed >= WARMUP_MS) {
        windowStart = now;
        windowStartBytes = totalBytes;
        bucketStartAt = now;
        bucketStartBytes = totalBytes;
      }

      // Coarse buckets, for the reported range.
      if (windowStart !== null && now - bucketStartAt >= STATS_BUCKET_MS) {
        windowSamples.push(bytesToMbps(totalBytes - bucketStartBytes, now - bucketStartAt));
        bucketStartAt = now;
        bucketStartBytes = totalBytes;
      }

      if (elapsed >= WARMUP_MS + MEASURE_MS || controller.signal.aborted) {
        clearInterval(sampler);
        resolve();
      }
    }, SAMPLE_INTERVAL_MS);
  });

  // Latency under load, sampled once the pipe is saturated. This is the
  // bufferbloat signal: if it's far above idle ping, the path is over-buffered
  // and the connection will feel laggy during downloads even at high Mbps.
  const measuredWindowStart = windowStart;
  const measuredWindowBytes = windowStartBytes;
  if (probeLoadedLatency && !controller.signal.aborted) {
    for (let i = 0; i < 3; i++) {
      try {
        loadedPings.push(await pingOnce(controller.signal));
      } catch {
        break;
      }
    }
  }

  const windowEnd = performance.now();
  controller.abort();
  await Promise.allSettled(streams);
  externalSignal?.removeEventListener("abort", onExternalAbort);

  const mbps =
    measuredWindowStart === null
      ? // Aborted before warm-up completed — fall back to the whole span
        // rather than reporting nothing.
        bytesToMbps(totalBytes, windowEnd - phaseStart)
      : bytesToMbps(totalBytes - measuredWindowBytes, windowEnd - measuredWindowStart);

  return { mbps, ...summarize(mbps, windowSamples), loadedPings };
}

export async function measureDownload(
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<TransferOutcome> {
  return runTransfer(
    DOWNLOAD_STREAMS,
    async (streamSignal, onBytes) => {
      const url = `${API_BASE}/api/download?bytes=${DOWNLOAD_CHUNK_BYTES}&_=${Math.random()
        .toString(36)
        .slice(2)}`;
      const res = await fetch(url, { signal: streamSignal, cache: "no-store" });
      if (!res.ok || !res.body) throw new Error("download failed");
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onBytes(value.byteLength);
      }
    },
    onProgress,
    signal,
    true,
  );
}

export async function measureUpload(
  onProgress: ProgressFn,
  signal?: AbortSignal,
): Promise<TransferOutcome> {
  const payload = getUploadPayload();

  return runTransfer(
    UPLOAD_STREAMS,
    (streamSignal, onBytes) =>
      new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let counted = 0;

        const onAbort = () => xhr.abort();
        streamSignal.addEventListener("abort", onAbort);
        const cleanup = () => streamSignal.removeEventListener("abort", onAbort);

        // Progress events report bytes accepted by the local socket buffer,
        // which runs ahead of the wire. Over a multi-second window that error
        // is bounded by the buffer size and the warm-up discard absorbs it;
        // the server's own byte count reconciles the total below.
        xhr.upload.addEventListener("progress", (e) => {
          if (!e.lengthComputable) return;
          const delta = e.loaded - counted;
          if (delta > 0) {
            counted = e.loaded;
            onBytes(delta);
          }
        });

        xhr.addEventListener("load", () => {
          cleanup();
          // `load` fires for ANY completed response, including 4xx/5xx. Without
          // this check a 429 counted as a finished stream, the loop restarted
          // instantly with no backoff, and the client flooded the server with
          // thousands of rejected requests while measuring zero bytes.
          if (xhr.status < 200 || xhr.status >= 300) {
            // Un-count bytes the socket accepted for a body the server refused.
            if (counted > 0) onBytes(-counted);
            reject(new Error(`upload rejected: ${xhr.status}`));
            return;
          }
          // Reconcile against what the server actually received, so a
          // half-delivered body can't be counted as fully sent.
          try {
            const report = JSON.parse(xhr.responseText);
            if (typeof report.bytes === "number" && report.bytes < counted) {
              onBytes(report.bytes - counted);
            }
          } catch {
            /* server didn't report; progress events stand */
          }
          resolve();
        });
        xhr.addEventListener("error", () => {
          cleanup();
          reject(new Error("upload failed"));
        });
        xhr.addEventListener("abort", () => {
          cleanup();
          resolve();
        });

        xhr.open("POST", `${API_BASE}/api/upload`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.send(payload);
      }),
    onProgress,
    signal,
    false,
  );
}

const HISTORY_KEY = "pulsewire.history";
const HISTORY_LIMIT = 3;

export function loadHistory(): TestResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: TestResult): TestResult[] {
  const next = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}
