var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var MiB = 1024 * 1024;
var MAX_DOWNLOAD_BYTES = 200 * MiB;
var MIN_DOWNLOAD_BYTES = 64 * 1024;
var FILLER_BYTES = 1 * MiB;
var filler = null;
function getFiller() {
  if (filler) return filler;
  const buf = new Uint8Array(FILLER_BYTES);
  for (let offset = 0; offset < buf.length; offset += 65536) {
    crypto.getRandomValues(buf.subarray(offset, Math.min(offset + 65536, buf.length)));
  }
  filler = buf;
  return filler;
}
__name(getFiller, "getFiller");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Server-Timing, Content-Length"
};
function corsJson(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...init.headers }
  });
}
__name(corsJson, "corsJson");
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
    }
  });
}
__name(bytesStream, "bytesStream");
function handleDownload(url) {
  const requested = parseInt(url.searchParams.get("bytes"), 10);
  const bytes = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 20 * MiB, MIN_DOWNLOAD_BYTES),
    MAX_DOWNLOAD_BYTES
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
      ...CORS
    }
  });
}
__name(handleDownload, "handleDownload");
async function handleUpload(request) {
  const startedAt = Date.now();
  let received = 0;
  let aborted = false;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
      }
    } catch {
      aborted = true;
    }
  }
  return corsJson({ bytes: received, transferMs: Date.now() - startedAt, aborted });
}
__name(handleUpload, "handleUpload");
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
    tcpRttMs: typeof cf.clientTcpRtt === "number" ? cf.clientTcpRtt : null
  });
}
__name(handleWhoami, "handleWhoami");
var src_default = {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    switch (url.pathname) {
      case "/api/ping":
        return new Response(null, {
          status: 204,
          headers: { "Cache-Control": "no-store", ...CORS }
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
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-alvjzu/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-alvjzu/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
