var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var index_default = {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    };
    const json = /* @__PURE__ */ __name((obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }), "json");
    const errJson = /* @__PURE__ */ __name((status, message, extra = {}) => json({ ok: false, error: message, ...extra }, status), "errJson");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    const getBody = /* @__PURE__ */ __name(async () => {
      try {
        return await request.json();
      } catch {
        return {};
      }
    }, "getBody");
    const hashEmail = /* @__PURE__ */ __name(async (email) => {
      const msgUint8 = new TextEncoder().encode(email.toLowerCase().trim());
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
      return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
    }, "hashEmail");
    const getCookie = /* @__PURE__ */ __name((name) => {
      const cookie = request.headers.get("Cookie") || "";
      const m = cookie.match(new RegExp(`${name}=([^;]+)`));
      return m ? m[1] : null;
    }, "getCookie");
    const makeSession = /* @__PURE__ */ __name(async (email) => {
      const userId = await hashEmail(email);
      const sessionId = crypto.randomUUID();
      const data = { email, userId, created: Date.now() };
      await env.SESSIONS.put(sessionId, JSON.stringify(data), { expirationTtl: 7 * 24 * 60 * 60 });
      return { sessionId, ...data };
    }, "makeSession");
    const getSession = /* @__PURE__ */ __name(async () => {
      const sid = getCookie("session");
      if (!sid) return null;
      const raw = await env.SESSIONS.get(sid);
      if (!raw) return null;
      try {
        return { ...JSON.parse(raw), sessionId: sid };
      } catch {
        return null;
      }
    }, "getSession");
    const isAdmin = /* @__PURE__ */ __name((email) => email && env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL.toLowerCase(), "isAdmin");
    if (url.pathname === "/auth/magic-link" && request.method === "POST") {
      try {
        const { email } = await getBody();
        if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return errJson(400, "Invalid email");
        const token = crypto.randomUUID();
        await env.SESSIONS.put(`magic:${token}`, email, { expirationTtl: 900 });
        const verifyUrl = `https://resonmusic.us/?token=${token}`;
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "auth@resonmusic.us",
            to: email,
            subject: "Sign in to Reson",
            html: `<p>Click to sign in: <a href="${verifyUrl}">${verifyUrl}</a></p>`
          })
        });
        if (!r.ok) {
          const details = await r.text();
          return errJson(500, "Failed to send email", { details });
        }
        return json({ ok: true });
      } catch (err) {
        return errJson(500, "Failed to send email", { details: err.message });
      }
    }
    if (url.pathname === "/auth/verify" && request.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) return errJson(400, "Missing token");
      const email = await env.SESSIONS.get(`magic:${token}`);
      if (!email) return errJson(400, "Invalid or expired token");
      const { sessionId } = await makeSession(email);
      const res = new Response(null, { status: 302, headers: { "Location": "https://resonmusic.us/" } });
      res.headers.append("Set-Cookie", `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
      return res;
    }
    if (url.pathname === "/auth/me" && request.method === "GET") {
      const session = await getSession();
      if (!session) return json({ ok: false });
      return json({ ok: true, email: session.email, userId: session.userId, isAdmin: isAdmin(session.email) });
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const session = await getSession();
      if (session) await env.SESSIONS.delete(session.sessionId);
      const res = json({ ok: true });
      res.headers.append("Set-Cookie", "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
      return res;
    }
    if (url.pathname === "/user/songs" && request.method === "GET") {
      const session = await getSession();
      if (!session) return errJson(401, "Not signed in");
      const prefix = `users/${session.userId}/`;
      const page = await env.MUSIC_BUCKET.list({ prefix, limit: 1e3 });
      const keys = (page.objects || []).map((o) => o.key);
      console.log("DEBUG: Prefix search:", prefix, "Files found in bucket:", keys);
      const albums = {};
      for (const key of keys) {
        const parts = key.replace(prefix, "").split("/");
        if (parts.length < 3) continue;
        const [artist, album, file] = parts;
        const albumKey = `${artist}///${album}`;
        if (!albums[albumKey]) albums[albumKey] = { artistName: artist, albumName: album, songs: [] };
        albums[albumKey].songs.push({
          id: key,
          r2Path: key,
          fileName: file,
          title: file.replace(/\.[^/.]+$/, ""),
          artistName: artist,
          albumName: album,
          link: `${url.origin}/?id=${encodeURIComponent(key)}`
        });
      }
      return json(Object.values(albums));
    }
    if (url.pathname === "/requests" && request.method === "POST") {
      const session = await getSession();
      if (!session) return errJson(401, "Not signed in");
      const { text } = await getBody();
      if (!text || text.length < 2) return errJson(400, "Missing request text");
      const id = crypto.randomUUID();
      const req = { id, email: session.email, userId: session.userId, text, status: "pending", createdAt: Date.now() };
      await env.REQUESTS.put(id, JSON.stringify(req));
      return json({ ok: true, id });
    }
    if (url.pathname === "/requests" && request.method === "GET") {
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, "Admin only");
      const list = await env.REQUESTS.list({ limit: 100 });
      const items = [];
      for (const k of list.keys) {
        const raw = await env.REQUESTS.get(k.name);
        if (raw) items.push(JSON.parse(raw));
      }
      return json({ ok: true, items });
    }
    if (url.pathname.startsWith("/requests/") && request.method === "PATCH") {
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, "Admin only");
      const id = url.pathname.split("/").pop();
      const req = await env.REQUESTS.get(id);
      if (!req) return errJson(404, "Not found");
      const { status } = await getBody();
      const updated = { ...JSON.parse(req), status: status || "pending", updatedAt: Date.now() };
      await env.REQUESTS.put(id, JSON.stringify(updated));
      return json({ ok: true });
    }
    if (url.pathname.startsWith("/requests/") && request.method === "POST") {
      const session = await getSession();
      if (!session || !isAdmin(session.email)) return errJson(401, "Admin only");
      const id = url.pathname.split("/")[2];
      const req = await env.REQUESTS.get(id);
      if (!req) return errJson(404, "Not found");
      const { email, text, status } = JSON.parse(req);
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "auth@resonmusic.us",
          to: email,
          subject: `Your request has been updated`,
          html: `<p>Your request "${text}" is now "${status}"</p>`
        })
      });
      return json({ ok: true });
    }
    return json({ ok: false, error: "Route not found" }, 404);
  }
};

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
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

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
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
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-SWhucP/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/common.ts
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

// .wrangler/tmp/bundle-SWhucP/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
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
