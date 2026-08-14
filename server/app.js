import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.join(__dirname, "../web/dist");

const app = express();
const isProd = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
// Trust exactly one hop (the tunnel/reverse proxy in front of us) so req.ip
// reads the real client IP without letting an attacker spoof X-Forwarded-For
// to dodge rate limiting (trusting *all* proxies would allow that).
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", "https://api.ipify.org"],
            imgSrc: ["'self'", "data:"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'"],
            scriptSrc: ["'self'"],
          },
        }
      : false,
  }),
);
// The speed-test payloads are random bytes (incompressible) and streamed by
// hand below; running them through gzip wastes CPU and throttles the write
// loop for zero size benefit, so exclude the /api test endpoints.
app.use(
  compression({
    filter: (req, res) => !req.path.startsWith("/api/") && compression.filter(req, res),
  }),
);
// Open to any origin, deliberately. None of these endpoints use cookies or
// sessions — /api/ping, /api/whoami, /api/download, /api/upload are all
// unauthenticated and don't vary per caller's identity, so there's no
// credentialed data a stricter allow-list would actually be protecting.
// (We tried an allow-list keyed off ALLOWED_ORIGIN first; chasing exact
// origin-string matches and Vercel env var propagation timing wasn't worth
// it for an API with nothing origin-specific to protect.)
app.use(cors({ origin: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api/"))
      console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// The download/upload endpoints move real bandwidth per request; cap request
// rate so a single client can't be used to hammer the box. The limit is high
// because an accurate test opens several parallel streams and restarts them
// as they drain, so one legitimate test is dozens of requests.
const testLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Pre-generate a chunk of random bytes once; reuse (repeat) it to stream
// arbitrary amounts without re-generating randomness on every request.
const CHUNK = crypto.randomBytes(1024 * 1024); // 1 MiB

// The frontend never sends more than UPLOAD_CHUNK_BYTES (16 MiB, speedTest.ts)
// in a single request; double that for headroom and reject anything past it
// outright rather than draining an arbitrarily large body from a caller going
// around the frontend entirely.
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

app.get("/api/ping", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(204).end();
});

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.)/;

// Short-lived cache: geolocation providers rate-limit hard on their free
// tiers, and every "Test again" click would otherwise re-look-up the same IP.
// Note: on Vercel each invocation may be a fresh instance, so this cache
// only helps within a warm instance's lifetime — that's fine, it's an
// optimization, not something correctness depends on.
const geoCache = new Map();
const GEO_CACHE_TTL_MS = 10 * 60 * 1000;

async function lookupIpapiCo(ip, isPrivate) {
  const target = isPrivate ? "" : `${ip}/`;
  const res = await fetch(`https://ipapi.co/${target}json/`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`ipapi.co status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.reason ?? "ipapi.co error");
  return {
    ip: isPrivate ? ip : (data.ip ?? ip),
    isp: data.org ?? data.asn ?? "Unknown ISP",
    city: data.city ?? "",
    region: data.region ?? "",
    country: data.country_name ?? "",
  };
}

// Fallback provider — different free-tier limits than ipapi.co, so a lookup
// that gets rate-limited on one often still succeeds on the other.
async function lookupIpApiCom(ip, isPrivate) {
  if (isPrivate) throw new Error("private ip, nothing to look up");
  const res = await fetch(
    `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,query`,
    { signal: AbortSignal.timeout(4000) },
  );
  if (!res.ok) throw new Error(`ip-api.com status ${res.status}`);
  const data = await res.json();
  if (data.status !== "success") throw new Error(data.message ?? "ip-api.com error");
  return {
    ip: data.query ?? ip,
    isp: data.isp ?? "Unknown ISP",
    city: data.city ?? "",
    region: data.regionName ?? "",
    country: data.country ?? "",
  };
}

// Resolved server-side (not from the browser) so this works regardless of
// the page's CSP/CORS and can't be blocked by the client's own ad-blocker
// the way a direct third-party fetch from the browser can.
app.get("/api/whoami", async (req, res) => {
  const ip = req.ip ?? "";
  const isPrivate = PRIVATE_IP.test(ip);
  res.set("Cache-Control", "no-store");

  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.data);
  }

  for (const lookup of [lookupIpapiCo, lookupIpApiCom]) {
    try {
      const data = await lookup(ip, isPrivate);
      geoCache.set(ip, { data, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
      return res.json(data);
    } catch (err) {
      console.error(`${lookup.name} failed:`, err.message);
    }
  }

  res.json({ ip, isp: "Unknown ISP", city: "", region: "", country: "" });
});

// Where this box itself sits, resolved once at boot and refreshed hourly —
// used to tell the tester the truth about which server they're hitting,
// instead of a hardcoded "Local test server" label that's only "local" from
// the developer's point of view.
let serverInfo = { ip: "", isp: "", city: "", region: "", country: "" };

async function resolveServerInfo() {
  try {
    serverInfo = await lookupIpapiCo("", true);
    if (serverInfo.isp && serverInfo.city) return;
  } catch (err) {
    console.error("server self-lookup (ipapi.co) failed:", err.message);
  }
  try {
    const res = await fetch(
      "http://ip-api.com/json?fields=status,message,country,regionName,city,isp,query",
      { signal: AbortSignal.timeout(4000) },
    );
    const data = await res.json();
    if (data.status === "success") {
      serverInfo = {
        ip: data.query ?? "",
        isp: data.isp ?? "Unknown ISP",
        city: data.city ?? "",
        region: data.regionName ?? "",
        country: data.country ?? "",
      };
    }
  } catch (err) {
    console.error("server self-lookup (ip-api.com) failed:", err.message);
  }
}
// Skipped on Vercel: a serverless instance isn't guaranteed to live long
// enough for an hourly interval to ever fire, and starting one per
// invocation would leak timers across cold starts.
if (!process.env.VERCEL) {
  resolveServerInfo();
  setInterval(resolveServerInfo, 60 * 60 * 1000);
}

app.get("/api/server-info", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(serverInfo);
});

app.get("/api/download", testLimiter, (req, res) => {
  const bytes = Math.min(
    Math.max(parseInt(req.query.bytes, 10) || 20 * 1024 * 1024, 64 * 1024),
    200 * 1024 * 1024,
  );

  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Length": bytes,
    "Cache-Control": "no-store",
  });

  let sent = 0;
  const writeMore = () => {
    // Backpressure-aware write loop so we don't buffer the whole
    // payload in memory or overrun the socket.
    while (sent < bytes) {
      const remaining = bytes - sent;
      const piece = remaining >= CHUNK.length ? CHUNK : CHUNK.subarray(0, remaining);
      sent += piece.length;
      if (!res.write(piece)) {
        res.once("drain", writeMore);
        return;
      }
    }
    res.end();
  };
  writeMore();

  req.on("close", () => {
    sent = bytes; // stop writing if the client aborts early
  });
});

// Drained without buffering (no express.raw) — buffering the whole body would
// hold hundreds of MB in RAM per parallel stream. We also report the byte
// count and duration WE observed, so the client can verify its own numbers
// against the receiving end instead of trusting xhr.upload progress events,
// which only report bytes handed to the local socket buffer.
app.post("/api/upload", testLimiter, (req, res) => {
  const startNs = process.hrtime.bigint();
  let received = 0;
  let firstByteNs = null;

  req.on("data", (chunk) => {
    if (firstByteNs === null) firstByteNs = process.hrtime.bigint();
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) {
      // Tear down the connection rather than keep draining a body far past
      // anything the frontend itself would ever send.
      req.destroy();
      if (!res.headersSent) res.status(413).end();
    }
  });

  req.on("end", () => {
    if (res.headersSent) return; // already answered 413 above
    const endNs = process.hrtime.bigint();
    const totalMs = Number(endNs - startNs) / 1e6;
    // Time from first byte on the wire, excluding the wait for the request to
    // start arriving — that idle period isn't transfer time.
    const transferMs = firstByteNs === null ? totalMs : Number(endNs - firstByteNs) / 1e6;
    res.set("Cache-Control", "no-store");
    res.json({ bytes: received, totalMs, transferMs });
  });

  req.on("error", () => {
    if (!res.headersSent) res.status(400).end();
  });
});

// Only serves the built frontend if it's actually present next to this
// server — true for the same-origin deploy (Render/Railway build both
// workspaces together). In a backend-only deploy (this server on Vercel,
// frontend hosted separately on Netlify/another Vercel project), web/dist
// was never built here, so skip straight to being a pure API — trying to
// serve a missing index.html would 500 on every request instead of just
// not offering a page that isn't this deployment's job.
if (isProd && fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  app.use(express.static(WEB_DIST, { maxAge: "1y", index: false }));
  app.get(/.*/, (req, res) => {
    // This is a single-view app — "/" is the only real page. Anything else
    // still gets the app shell (so a stray or typo'd link doesn't just
    // dead-end) but reports 404, not 200. Serving 200 for every path is a
    // "soft 404": search engines then treat each random URL as a distinct
    // real page with duplicate content, which Search Console flags and
    // which dilutes the one page's ranking instead of consolidating it.
    const status = req.path === "/" ? 200 : 404;
    res.status(status).sendFile(path.join(WEB_DIST, "index.html"));
  });
}

export default app;
