/**
 * Speedtest4u measurement endpoints, running on Cloudflare Workers.
 *
 * Why this exists at all: the Express server in ../server measures the path to
 * ONE machine. A user in Karachi testing against a box in Virginia is measuring
 * an ocean, not their connection. A Worker runs in 300+ cities, so every test
 * terminates at a PoP near the user — the same reason speed.cloudflare.com is
 * accurate everywhere instead of only near one datacentre.
 *
 * That also quietly fixes the parallel-stream problem. A single connection
 * plateaus near `window / RTT`; the client opens several streams to work around
 * it, but over HTTP/2 they all multiplex onto one TCP connection and the
 * workaround does nothing. Cutting RTT from ~250ms to ~20ms raises that ceiling
 * by the same 10x the extra streams were supposed to buy. We don't beat the
 * multiplexing, we make it stop mattering.
 *
 * ../server/app.js is kept as-is for same-origin/self-hosted deploys. This is
 * the edge transport, not a replacement for it.
 */

const MiB = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 200 * MiB;
const MIN_DOWNLOAD_BYTES = 64 * 1024;
const FILLER_BYTES = 1 * MiB;
// The frontend never sends more than UPLOAD_CHUNK_BYTES (16 MiB, speedTest.ts)
// in a single request; double that for headroom and reject anything past it
// outright rather than draining an arbitrarily large body from a caller going
// around the frontend entirely.
const MAX_UPLOAD_BYTES = 32 * MiB;

/**
 * Random filler, generated once per isolate and reused for every response.
 *
 * Generating fresh randomness per request would blow the free tier's 10ms CPU
 * budget outright — 200 MiB of getRandomValues is not a 10ms operation. Built
 * lazily rather than at module scope so isolate startup stays cheap, then
 * amortised across every request that isolate serves.
 *
 * It has to be random rather than zeroes: anything on the path that applies
 * gzip/brotli would collapse a zero-filled body to nothing and the "download
 * speed" becomes fiction. 1 MiB also exceeds gzip's 32 KiB window, so even the
 * repetition across chunks isn't compressible — belt and braces alongside the
 * no-transform header below.
 */
let filler = null;
function getFiller() {
  if (filler) return filler;
  const buf = new Uint8Array(FILLER_BYTES);
  // getRandomValues caps at 65536 bytes per call.
  for (let offset = 0; offset < buf.length; offset += 65536) {
    crypto.getRandomValues(buf.subarray(offset, Math.min(offset + 65536, buf.length)));
  }
  filler = buf;
  return filler;
}

/**
 * Open to any origin, matching ../server/app.js. Nothing here is
 * authenticated or per-caller, so there's no credentialed data an allow-list
 * would be protecting.
 *
 * Expose-Headers matters more than it looks: without it a cross-origin caller
 * cannot READ Server-Timing off the response, even though the header arrives.
 * Hosting the Worker on the same domain as the site avoids the whole issue.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Server-Timing, Content-Length",
};

function corsJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...init.headers },
  });
}

/**
 * Demand-driven so the runtime applies backpressure instead of us buffering
 * the whole payload in memory. Each pull hands back a fresh view over the
 * shared filler — a new view object, not a copy, so this stays allocation-cheap
 * while avoiding any question of the same object being detached on enqueue.
 */
function bytesStream(total) {
  const buf = getFiller();
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const remaining = total - sent;
      const size = Math.min(remaining, buf.byteLength);
      controller.enqueue(buf.subarray(0, size));
      sent += size;
    },
    // The client abandons every download stream the moment its measurement
    // window closes, so cancellation is the normal way these end, not a fault.
    // Declaring the handler means the runtime tears the stream down cleanly
    // instead of treating a routine disconnect as an unhandled stream error.
    cancel() {
      sent = total;
    },
  });
}

function handleDownload(url) {
  const requested = parseInt(url.searchParams.get("bytes"), 10);
  const bytes = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 20 * MiB, MIN_DOWNLOAD_BYTES),
    MAX_DOWNLOAD_BYTES,
  );

  return new Response(bytesStream(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes),
      // no-transform is load-bearing, not boilerplate: without it Cloudflare
      // may brotli the response, and brotli's window is large enough to notice
      // the repeated filler and shrink it — which would report a download speed
      // several times higher than the wire actually carried.
      "Cache-Control": "no-store, no-transform",
      ...CORS,
    },
  });
}

/**
 * Drained without buffering. We report the byte count WE observed so the client
 * can reconcile against it — `xhr.upload` progress events only report bytes
 * handed to the local socket buffer, which runs ahead of the wire and would
 * otherwise let a half-delivered body count as fully sent.
 */
async function handleUpload(request) {
  const startedAt = Date.now();
  let received = 0;
  let aborted = false;

  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_UPLOAD_BYTES) {
          await reader.cancel();
          return corsJson({ error: "payload too large" }, { status: 413 });
        }
      }
    } catch {
      // Expected, not exceptional: the client cuts every in-flight upload the
      // moment the measurement window closes, and a half-read body surfaces
      // here as "Network connection lost". Left unhandled it throws on a
      // request nobody is listening to any more — which crashed `wrangler dev`
      // outright and would fill production logs with errors from a completely
      // healthy test run. Report what we actually received instead.
      aborted = true;
    }
  }

  return corsJson({ bytes: received, transferMs: Date.now() - startedAt, aborted });
}

/**
 * Geolocation straight off the request, which is the whole point of being here.
 *
 * ../server/app.js chains ipapi.co -> ip-api.com and both rate-limit on their
 * free tiers, which is why the live site currently shows "Unknown ISP" and a
 * blank location. `request.cf` carries the same facts with no API call, no key,
 * no quota, and no failure mode — plus `clientTcpRtt`, a real TCP round trip
 * measured at the edge rather than a browser-side estimate that includes
 * event-loop scheduling.
 */
function handleWhoami(request) {
  const cf = request.cf ?? {};
  return corsJson({
    ip: request.headers.get("CF-Connecting-IP") ?? "",
    isp: cf.asOrganization ?? "Unknown ISP",
    city: cf.city ?? "",
    region: cf.region ?? "",
    country: cf.country ?? "",
    // Which PoP served this test. Worth surfacing: it's the honest answer to
    // "what was I actually measuring against?"
    colo: cf.colo ?? "",
    asn: cf.asn ?? null,
    // May be absent depending on how the connection was established; the client
    // treats it as a bonus signal, never as the headline latency figure.
    tcpRttMs: typeof cf.clientTcpRtt === "number" ? cf.clientTcpRtt : null,
  });
}

/**
 * Mints short-lived TURN credentials for the packet-loss probe.
 *
 * Packet loss can't be seen over TCP — it retransmits silently, so a lossy link
 * just looks slow. Measuring it needs UDP, which from a browser means WebRTC
 * over a TURN relay. Cloudflare's own `speed.cloudflare.com/turn-creds` returns
 * 403 to anyone off their domain, so the probe needs a relay we're entitled to
 * use; this mints credentials against our own TURN key.
 *
 * The key's API token never leaves the Worker. It's a `wrangler secret`, not a
 * var and not something the client is ever handed — the browser only receives
 * a credential that expires. Embedding the long-lived token in the bundle would
 * publish it to every visitor.
 *
 * Unconfigured is a normal state, not an error: without the secret this returns
 * 501 and the client quietly reports loss as unknown rather than failing a run.
 */
async function handleTurnCreds(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return corsJson({ error: "turn not configured" }, { status: 501 });
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        // Only has to outlive one probe, which takes seconds. A short TTL keeps
        // a leaked credential worthless almost immediately.
        body: JSON.stringify({ ttl: 600 }),
        // The client's own probe gives up after 12s regardless (packetLoss.ts),
        // so there's no reason to let a hung upstream call hold this open longer.
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    return corsJson(await res.json());
  } catch {
    // Network failure, timeout, non-2xx, or a malformed body all land here.
    // Uncaught, any of these throws out of the fetch handler entirely — the
    // Workers platform's own error page has no CORS headers, so the browser
    // would report an opaque "Failed to fetch" instead of a readable 502.
    return corsJson({ error: "turn credential request failed" }, { status: 502 });
  }
}

/**
 * Per-isolate request counter for /api/download and /api/upload — the two
 * endpoints that move real bandwidth. Mirrors ../server/app.js's testLimiter:
 * same 1200/60s budget, same reasoning (an accurate test is dozens of
 * requests from parallel, restarting streams, not one).
 *
 * Deliberately not a global limit: Workers run many isolates across edge
 * PoPs with no shared memory between them, so this only catches abuse that
 * lands repeatedly on the same isolate, not a distributed attacker spread
 * across colos. A real global per-IP limit needs Cloudflare's Rate Limiting
 * binding or dashboard rules — both need account-side provisioning this file
 * can't do for itself. Still worth having: it's free, and it stops the
 * common case, which is the same justification the Express side used.
 */
const RATE_LIMIT = 1200;
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  // Sweep occasionally instead of on every call, so a long-lived isolate
  // seeing many distinct IPs doesn't grow this map without bound.
  if (rateBuckets.size > 10_000) {
    for (const [key, bucket] of rateBuckets) {
      if (now >= bucket.resetAt) rateBuckets.delete(key);
    }
  }
  const bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    switch (url.pathname) {
      case "/api/ping":
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store", ...CORS },
        });

      case "/api/download": {
        const ip = request.headers.get("CF-Connecting-IP") ?? "";
        if (isRateLimited(ip)) {
          return corsJson({ error: "too many requests" }, { status: 429 });
        }
        return handleDownload(url);
      }

      case "/api/upload": {
        if (request.method !== "POST") {
          return corsJson({ error: "method not allowed" }, { status: 405 });
        }
        const ip = request.headers.get("CF-Connecting-IP") ?? "";
        if (isRateLimited(ip)) {
          return corsJson({ error: "too many requests" }, { status: 429 });
        }
        return handleUpload(request);
      }

      case "/api/whoami":
        return handleWhoami(request);

      case "/api/turn-creds":
        return handleTurnCreds(env);

      default:
        return corsJson({ error: "not found" }, { status: 404 });
    }
  },
};
