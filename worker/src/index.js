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

export default {
  async fetch(request) {
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

      case "/api/download":
        return handleDownload(url);

      case "/api/upload":
        if (request.method !== "POST") {
          return corsJson({ error: "method not allowed" }, { status: 405 });
        }
        return handleUpload(request);

      case "/api/whoami":
        return handleWhoami(request);

      default:
        return corsJson({ error: "not found" }, { status: 404 });
    }
  },
};
