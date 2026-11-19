// Local stand-in for Supabase: /rest/v1 goes to a real PostgREST over a real
// Postgres (so constraints, RLS and SQL functions behave as in production),
// /auth/v1 is a small GoTrue lookalike that issues real JWTs PostgREST trusts.
// Emails GoTrue would send are recorded at /__auth/emails instead.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

export const JWT_SECRET = "sim-jwt-secret-sim-jwt-secret-sim-jwt-secret-0123456789";
const PORT = Number(process.env.GATEWAY_PORT || 54321);
const PGRST = "http://127.0.0.1:3001";
const pool = new pg.Pool({ connectionString: "postgres://postgres@127.0.0.1:54322/havnline", max: 10 });

const b64u = (b) => Buffer.from(b).toString("base64url");
export function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token || "").split(".");
  if (!s) return null;
  const want = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${b}`).digest("base64url");
  if (want !== s) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString());
  if (p.exp && p.exp < Date.now() / 1000) return null;
  return p;
}

const emails = []; // what GoTrue would have emailed
const refreshTokens = new Map(); // token -> user id
const otp = new Map(); // token_hash -> {userId, type}
const codes = new Map(); // auth code -> {userId, challenge}
const stats = { rest: 0, auth: 0, restErrors: 0 };
let captchaRequired = process.env.SIM_CAPTCHA === "1";

const hashPw = (pw) => crypto.createHash("sha256").update("salt:" + pw).digest("hex");
function userJson(r) {
  return {
    id: r.id, aud: "authenticated", role: "authenticated", email: r.email,
    email_confirmed_at: r.email_confirmed_at, confirmed_at: r.email_confirmed_at,
    last_sign_in_at: r.last_sign_in_at, app_metadata: r.raw_app_meta_data || { provider: "email" },
    user_metadata: r.raw_user_meta_data || {}, identities: [], created_at: r.created_at, updated_at: r.updated_at,
  };
}
function session(r) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt({ sub: r.id, role: "authenticated", aud: "authenticated", email: r.email, iat: now, exp: now + 3600, session_id: crypto.randomUUID() });
  const refresh_token = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh_token, r.id);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(r) };
}
const q = (sql, args) => pool.query(sql, args).then((x) => x.rows);
const byEmail = (e) => q("select * from auth.users where lower(email)=lower($1)", [e]).then((r) => r[0]);
const byId = (id) => q("select * from auth.users where id=$1", [id]).then((r) => r[0]);

function send(res, status, obj, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(obj === undefined ? "" : JSON.stringify(obj));
}
const err = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg, message: msg, error: code, error_description: msg });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
function bearerUser(req) {
  const t = (req.headers.authorization || "").replace(/^Bearer /i, "");
  const p = verifyJwt(t);
  return p && p.role === "authenticated" ? p.sub : null;
}
function isServiceRole(req) {
  const p = verifyJwt((req.headers.authorization || "").replace(/^Bearer /i, ""));
  return p?.role === "service_role";
}
function mail(type, user, extra = {}) {
  const token_hash = crypto.randomBytes(20).toString("hex");
  otp.set(token_hash, { userId: user.id, type });
  emails.push({ type, to: user.email, token_hash, at: new Date().toISOString(), ...extra });
  return token_hash;
}

async function auth(req, res, path, url) {
  stats.auth++;
  const raw = await readBody(req);
  const body = raw.length ? JSON.parse(raw.toString()) : {};
  const captcha = body.gotrue_meta_security?.captcha_token;
  const needCaptcha = () => captchaRequired && !captcha;

  if (path === "/signup" && req.method === "POST") {
    if (needCaptcha()) return err(res, 400, "captcha_failed", "captcha verification process failed");
    if (!body.email || !body.password) return err(res, 400, "validation_failed", "Signup requires a valid password");
    if (String(body.password).length < 6) return err(res, 422, "weak_password", "Password should be at least 6 characters.");
    const existing = await byEmail(body.email);
    if (existing) {
      // GoTrue hides existing confirmed accounts: returns a fake user with no identities.
      return send(res, 200, { ...userJson(existing), id: crypto.randomUUID(), identities: [] });
    }
    const [u] = await q(
      "insert into auth.users(email, encrypted_password, raw_user_meta_data) values ($1,$2,$3) returning *",
      [body.email.toLowerCase(), hashPw(body.password), body.data || {}]
    );
    mail("signup", u, { redirect_to: body.options?.emailRedirectTo || url.searchParams.get("redirect_to") });
    if (body.code_challenge) codes.set("pending:" + u.id, body.code_challenge);
    return send(res, 200, userJson(u));
  }
  if (path === "/resend" && req.method === "POST") {
    if (needCaptcha()) return err(res, 400, "captcha_failed", "captcha verification process failed");
    const u = await byEmail(body.email || "");
    if (u && !u.email_confirmed_at) mail(body.type || "signup", u);
    return send(res, 200, {});
  }
  if (path === "/recover" && req.method === "POST") {
    if (needCaptcha()) return err(res, 400, "captcha_failed", "captcha verification process failed");
    const u = await byEmail(body.email || "");
    if (u) mail("recovery", u);
    return send(res, 200, {});
  }
  if (path === "/verify" && req.method === "POST") {
    const rec = otp.get(body.token_hash);
    if (!rec || (body.type && rec.type !== body.type && !(body.type === "email" && rec.type === "signup")))
      return err(res, 403, "otp_expired", "Email link is invalid or has expired");
    otp.delete(body.token_hash);
    await q("update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), last_sign_in_at=now() where id=$1", [rec.userId]);
    const u = await byId(rec.userId);
    return send(res, 200, session(u));
  }
  if (path === "/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      if (needCaptcha()) return err(res, 400, "captcha_failed", "captcha verification process failed");
      const u = await byEmail(body.email || "");
      if (!u || u.encrypted_password !== hashPw(body.password || "")) return err(res, 400, "invalid_credentials", "Invalid login credentials");
      if (!u.email_confirmed_at) return err(res, 400, "email_not_confirmed", "Email not confirmed");
      await q("update auth.users set last_sign_in_at=now() where id=$1", [u.id]);
      return send(res, 200, session(u));
    }
    if (grant === "refresh_token") {
      const id = refreshTokens.get(body.refresh_token);
      if (!id) return err(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(body.refresh_token);
      const u = await byId(id);
      if (!u) return err(res, 400, "user_not_found", "User not found");
      return send(res, 200, session(u));
    }
    if (grant === "pkce") {
      const rec = codes.get(body.auth_code);
      if (!rec) return err(res, 400, "flow_state_not_found", "invalid flow state, no valid flow state found");
      codes.delete(body.auth_code);
      return send(res, 200, session(await byId(rec.userId)));
    }
    return err(res, 400, "unsupported_grant_type", "unsupported grant");
  }
  if (path === "/user" && req.method === "GET") {
    const id = bearerUser(req);
    const u = id && (await byId(id));
    if (!u) return err(res, 403, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    return send(res, 200, userJson(u));
  }
  if (path === "/user" && req.method === "PUT") {
    const id = bearerUser(req);
    const u = id && (await byId(id));
    if (!u) return err(res, 401, "bad_jwt", "invalid JWT");
    if (body.password) {
      if (String(body.password).length < 6) return err(res, 422, "weak_password", "Password should be at least 6 characters.");
      if (u.encrypted_password === hashPw(body.password)) return err(res, 422, "same_password", "New password should be different from the old password.");
      await q("update auth.users set encrypted_password=$2, updated_at=now() where id=$1", [id, hashPw(body.password)]);
    }
    if (body.email) {
      const taken = await byEmail(body.email);
      if (taken && taken.id !== id) return err(res, 422, "email_exists", "A user with this email address has already been registered");
      mail("email_change", { ...u, email: body.email }, { new_email: body.email });
      await q("update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}')||jsonb_build_object('pending_email',$2::text) where id=$1", [id, body.email]);
    }
    if (body.data) await q("update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data,'{}')||$2 where id=$1", [id, body.data]);
    return send(res, 200, userJson(await byId(id)));
  }
  if (path === "/logout") return send(res, 204);

  // Admin API (service role only)
  if (path.startsWith("/admin/")) {
    if (!isServiceRole(req)) return err(res, 403, "not_admin", "User not allowed");
    const m = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
    if (path === "/admin/users" && req.method === "GET") {
      const page = Number(url.searchParams.get("page") || 1), per = Number(url.searchParams.get("per_page") || 50);
      const rows = await q("select * from auth.users order by created_at limit $1 offset $2", [per, (page - 1) * per]);
      const [{ n }] = await q("select count(*)::int n from auth.users");
      return send(res, 200, { users: rows.map(userJson), aud: "authenticated" }, { "x-total-count": String(n) });
    }
    if (m && req.method === "GET") {
      const u = await byId(m[1]);
      return u ? send(res, 200, userJson(u)) : err(res, 404, "user_not_found", "User not found");
    }
    if (m && req.method === "DELETE") {
      await q("delete from auth.users where id=$1", [m[1]]);
      return send(res, 200, {});
    }
  }
  return err(res, 404, "not_found", `sim gotrue: no handler for ${req.method} ${path}`);
}

let dbLatencyMs = Number(process.env.DB_LATENCY_MS || 0);
function proxyRest(req, res, path) {
  stats.rest++;
  if (dbLatencyMs) return setTimeout(() => proxyRestNow(req, res, path), dbLatencyMs * (0.8 + Math.random() * 0.4));
  return proxyRestNow(req, res, path);
}
function proxyRestNow(req, res, path) {
  const headers = { ...req.headers };
  delete headers.host;
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const r = http.request(PGRST + path, { method: req.method, headers }, (up) => {
    if (up.statusCode >= 500) stats.restErrors++;
    res.writeHead(up.statusCode, up.headers);
    up.on("data", (c) => (stats.restBytes = (stats.restBytes || 0) + c.length));
    up.pipe(res);
  });
  r.on("error", (e) => send(res, 503, { message: "sim gateway: PostgREST unreachable " + e.message }));
  req.pipe(r);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    // Browsers on the site call Supabase directly (forgot password, client reads).
    res.setHeader("access-control-allow-origin", req.headers.origin || "*");
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] || "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-expose-headers", "content-range, x-total-count");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    try {
      if (url.pathname.startsWith("/rest/v1")) return proxyRest(req, res, req.url.replace(/^\/rest\/v1/, "") || "/");
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url.pathname.replace(/^\/auth\/v1/, ""), url);
      if (url.pathname === "/__auth/emails") return send(res, 200, emails);
      if (url.pathname === "/__auth/stats") return send(res, 200, stats);
      if (url.pathname === "/__db/latency") { dbLatencyMs = Number(url.searchParams.get("ms") || 0); return send(res, 200, { dbLatencyMs }); }
      if (url.pathname === "/__auth/captcha") { captchaRequired = url.searchParams.get("on") === "1"; return send(res, 200, { captchaRequired }); }
      if (url.pathname === "/__auth/reset") { emails.length = 0; Object.assign(stats, { rest: 0, auth: 0, restErrors: 0, restBytes: 0 }); return send(res, 200, {}); }
      return send(res, 404, { message: "sim gateway: unknown path " + url.pathname });
    } catch (e) {
      console.error("[gateway]", req.method, req.url, e);
      return send(res, 500, { message: String(e.message || e) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log("gateway on", PORT));
