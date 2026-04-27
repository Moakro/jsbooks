/**
 * jsbooks comments + auth worker.
 *
 * Routes:
 *   GET  /api/auth/login           — Google OAuth start
 *   GET  /api/auth/callback/google — OAuth callback, sets session cookie
 *   POST /api/auth/logout          — clears session cookie
 *   GET  /api/me                   — current session info
 *   POST /api/me/nickname          — set or change display_name
 *   GET  /api/comments?target=...  — list comments for a target
 *   POST /api/comments             — create comment
 *   PATCH /api/comments/:id        — edit comment (owner only)
 *   DELETE /api/comments/:id       — soft-delete (owner) or hide (curator+)
 *   POST /api/comments/:id/react   — toggle reaction (e.g. helpful)
 *   POST /api/comments/:id/flag    — flag comment
 *
 * Session: signed JWT in HttpOnly cookie (`jb_session`).
 * SameSite=Lax, Secure, ~30 day expiry. JWT signing uses HS256 with AUTH_SECRET.
 */

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AUTH_SECRET: string; // any 32+ char random string
  SITE_ORIGIN: string;
}

const COOKIE_NAME = "jb_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const NICKNAME_RESERVED = [
  "관리자", "admin", "운영자", "본부", "공식", "총무",
  "상제", "강증산", "moakro", "system", "support",
];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // ──── Auth ────
      if (path === "/api/auth/login") return loginStart(req, env);
      if (path === "/api/auth/callback/google") return loginCallback(req, env);
      if (path === "/api/auth/logout") return logout();

      // ──── Session ────
      if (path === "/api/me") return getMe(req, env);
      if (path === "/api/me/nickname") return setNickname(req, env);

      // ──── Comments ────
      if (path === "/api/comments" && req.method === "GET") return listComments(req, env);
      if (path === "/api/comments" && req.method === "POST") return createComment(req, env);

      const m = path.match(/^\/api\/comments\/([^/]+)(?:\/(react|flag))?$/);
      if (m) {
        const id = m[1];
        const sub = m[2];
        if (sub === "react" && req.method === "POST") return toggleReaction(req, env, id);
        if (sub === "flag" && req.method === "POST") return flagComment(req, env, id);
        if (req.method === "PATCH") return editComment(req, env, id);
        if (req.method === "DELETE") return deleteComment(req, env, id);
      }

      return json({ error: "not found" }, 404);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: "server error", detail: msg }, 500);
    }
  },
};

// ───────────────────── helpers ─────────────────────

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...headers,
    },
  });
}

function uuid(): string {
  return crypto.randomUUID();
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === name) return v ?? null;
  }
  return null;
}

function setCookieHeader(name: string, value: string, ttlSeconds: number): string {
  const attrs = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`,
  ];
  return attrs.join("; ");
}

function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ── HMAC-SHA256 JWT (HS256), tiny implementation ──
async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

async function hmacVerify(secret: string, data: string, expected: string): Promise<boolean> {
  const sig = await hmacSign(secret, data);
  // constant-time compare
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(t: string): string {
  return btoa(unescape(encodeURIComponent(t)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeText(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
}

interface SessionPayload {
  sub: string;        // user id
  iat: number;
  exp: number;
}

async function signSession(secret: string, payload: SessionPayload): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const head = b64urlText(JSON.stringify(header));
  const body = b64urlText(JSON.stringify(payload));
  const data = `${head}.${body}`;
  const sig = await hmacSign(secret, data);
  return `${data}.${sig}`;
}

async function verifySession(secret: string, token: string | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  if (!(await hmacVerify(secret, data, s))) return null;
  let payload: SessionPayload;
  try { payload = JSON.parse(b64urlDecodeText(p)); } catch { return null; }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function currentUserId(req: Request, env: Env): Promise<string | null> {
  const sess = await verifySession(env.AUTH_SECRET, getCookie(req, COOKIE_NAME));
  return sess?.sub ?? null;
}

interface UserRow {
  id: string;
  google_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  affiliation: string | null;
  level: number;
}

async function loadUser(env: Env, userId: string): Promise<UserRow | null> {
  return env.DB.prepare(
    "SELECT id, google_id, email, display_name, avatar_url, affiliation, level FROM users WHERE id=?",
  ).bind(userId).first<UserRow>();
}

// ───────────────────── auth flow ─────────────────────

async function loginStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/";
  const state = `${uuid()}.${b64urlText(next)}`;

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${env.SITE_ORIGIN}/api/auth/callback/google`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("access_type", "online");
  auth.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      "Set-Cookie": setCookieHeader("jb_oauth_state", state, 600),
    },
  });
}

async function loginCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = getCookie(req, "jb_oauth_state");
  if (!code || !state || state !== stored) {
    return json({ error: "invalid state" }, 400);
  }

  // Exchange code → tokens
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.SITE_ORIGIN}/api/auth/callback/google`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokRes.ok) {
    const t = await tokRes.text();
    return json({ error: "token exchange failed", detail: t }, 400);
  }
  const tok = await tokRes.json() as { id_token?: string; access_token?: string };
  if (!tok.id_token) return json({ error: "no id_token" }, 400);

  // Decode id_token (JWT). We do NOT verify Google's signature here — we just
  // need profile claims, and the token came directly from Google over TLS.
  // For stronger guarantees, fetch /tokeninfo or verify against Google's JWKS.
  const idParts = tok.id_token.split(".");
  if (idParts.length !== 3) return json({ error: "bad id_token" }, 400);
  let claims: { sub: string; email: string; name: string; picture?: string };
  try {
    claims = JSON.parse(b64urlDecodeText(idParts[1]));
  } catch {
    return json({ error: "bad id_token claims" }, 400);
  }

  // Upsert user. NOTE: google_name (legal name) is stored but never returned.
  const existing = await env.DB.prepare(
    "SELECT id, display_name FROM users WHERE google_id=?",
  ).bind(claims.sub).first<{ id: string; display_name: string | null }>();

  let userId: string;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare(
      "UPDATE users SET email=?, google_name=?, avatar_url=?, last_seen_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
    ).bind(claims.email, claims.name, claims.picture ?? null, userId).run();
  } else {
    userId = uuid();
    await env.DB.prepare(
      `INSERT INTO users (id, google_id, email, google_name, avatar_url, last_seen_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(userId, claims.sub, claims.email, claims.name, claims.picture ?? null).run();
  }

  // Issue session
  const now = Math.floor(Date.now() / 1000);
  const session = await signSession(env.AUTH_SECRET, {
    sub: userId,
    iat: now,
    exp: now + SESSION_TTL,
  });

  // Decode `next` from state suffix
  let nextPath = "/";
  const dot = state.indexOf(".");
  if (dot > 0) {
    try { nextPath = b64urlDecodeText(state.slice(dot + 1)) || "/"; } catch {}
    if (!nextPath.startsWith("/")) nextPath = "/";
  }
  // If user has no nickname yet, send them through the picker first.
  if (!existing || !existing.display_name) {
    nextPath = `/account/nickname?next=${encodeURIComponent(nextPath)}`;
  }

  const headers = new Headers({ Location: `${env.SITE_ORIGIN}${nextPath}` });
  headers.append("Set-Cookie", setCookieHeader(COOKIE_NAME, session, SESSION_TTL));
  headers.append("Set-Cookie", clearCookieHeader("jb_oauth_state"));
  return new Response(null, { status: 302, headers });
}

function logout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearCookieHeader(COOKIE_NAME),
    },
  });
}

async function getMe(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ user: null });
  const u = await loadUser(env, uid);
  if (!u) return json({ user: null });
  return json({
    user: {
      id: u.id,
      display_name: u.display_name,
      avatar_url: u.avatar_url,
      affiliation: u.affiliation,
      level: u.level,
      needs_nickname: !u.display_name,
    },
  });
}

async function setNickname(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({})) as { nickname?: string; affiliation?: string | null };
  const nickname = (body.nickname ?? "").trim();
  if (nickname.length < 2 || nickname.length > 24) {
    return json({ error: "닉네임은 2~24자여야 합니다" }, 400);
  }
  if (!/^[\p{L}\p{N}_\- .]+$/u.test(nickname)) {
    return json({ error: "허용되지 않는 문자가 포함되어 있습니다" }, 400);
  }
  const lower = nickname.toLowerCase();
  if (NICKNAME_RESERVED.some((r) => lower.includes(r.toLowerCase()))) {
    return json({ error: "운영자·단체명으로 오인될 수 있는 닉네임입니다" }, 400);
  }
  const dup = await env.DB.prepare(
    "SELECT 1 FROM users WHERE display_name=? AND id<>?",
  ).bind(nickname, uid).first();
  if (dup) return json({ error: "이미 사용 중인 닉네임입니다" }, 409);

  const old = await env.DB.prepare("SELECT display_name FROM users WHERE id=?").bind(uid).first<{ display_name: string | null }>();
  const oldName = old?.display_name ?? null;

  await env.DB.prepare(
    "UPDATE users SET display_name=?, affiliation=?, updated_at=datetime('now') WHERE id=?",
  ).bind(nickname, body.affiliation ?? null, uid).run();

  if (oldName !== nickname) {
    await env.DB.prepare(
      "INSERT INTO display_name_history (user_id, old_name, new_name) VALUES (?, ?, ?)",
    ).bind(uid, oldName, nickname).run();
  }

  return json({ ok: true });
}

// ───────────────────── comments ─────────────────────

const ALLOWED_TYPES = new Set(["memo", "question", "cross", "cite"]);
const ALLOWED_TARGET_TYPES = new Set(["verse", "card", "chapter"]);

async function listComments(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get("target");
  if (!target || !target.includes(":")) return json({ error: "missing target" }, 400);
  const [targetType, ...rest] = target.split(":");
  const targetId = rest.join(":");
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return json({ error: "invalid target type" }, 400);

  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.parent_id, c.body_html, c.type,
            c.status, c.created_at, c.updated_at,
            u.id AS user_id, u.display_name AS author_name,
            u.avatar_url AS author_avatar, u.affiliation AS author_affiliation,
            u.level AS author_level,
            (SELECT COUNT(*) FROM reactions r WHERE r.comment_id=c.id AND r.type='helpful') AS helpful_count
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.target_type=? AND c.target_id=? AND c.status='published'
     ORDER BY c.created_at ASC`,
  ).bind(targetType, targetId).all();

  const me = await currentUserId(req, env);
  let myReactions: Set<string> = new Set();
  if (me) {
    const r = await env.DB.prepare(
      `SELECT comment_id FROM reactions
       WHERE user_id=? AND comment_id IN (SELECT id FROM comments WHERE target_type=? AND target_id=?)
       AND type='helpful'`,
    ).bind(me, targetType, targetId).all<{ comment_id: string }>();
    myReactions = new Set((r.results ?? []).map((x) => x.comment_id));
  }

  const comments = (rows.results ?? []).map((r: any) => ({
    id: r.id,
    parent_id: r.parent_id,
    body_html: r.body_html,
    type: r.type,
    created_at: r.created_at,
    updated_at: r.updated_at,
    author: {
      display_name: r.author_name,
      avatar_url: r.author_avatar,
      affiliation: r.author_affiliation,
      level: r.author_level,
    },
    helpful_count: r.helpful_count,
    you_helpful: myReactions.has(r.id),
  }));

  return json({ target, count: comments.length, comments });
}

async function createComment(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || !u.display_name) {
    return json({ error: "닉네임 설정 필요" }, 403);
  }
  const body = await req.json().catch(() => ({})) as {
    target?: string;
    parent_id?: string | null;
    body?: string;
    type?: string;
  };
  const target = body.target ?? "";
  if (!target.includes(":")) return json({ error: "missing target" }, 400);
  const [targetType, ...rest] = target.split(":");
  const targetId = rest.join(":");
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return json({ error: "invalid target type" }, 400);
  const text = (body.body ?? "").trim();
  if (text.length === 0 || text.length > 4000) {
    return json({ error: "댓글은 1~4000자여야 합니다" }, 400);
  }
  const type = body.type ?? "memo";
  if (!ALLOWED_TYPES.has(type)) return json({ error: "invalid type" }, 400);

  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO comments (id, target_type, target_id, user_id, parent_id, body, body_html, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, targetType, targetId, uid, body.parent_id ?? null, text, sanitizeHTML(text), type).run();

  return json({ ok: true, id });
}

async function editComment(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const owner = await env.DB.prepare("SELECT user_id FROM comments WHERE id=?").bind(id).first<{ user_id: string }>();
  if (!owner) return json({ error: "not found" }, 404);
  if (owner.user_id !== uid) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({})) as { body?: string; type?: string };
  const text = (body.body ?? "").trim();
  if (text.length === 0 || text.length > 4000) return json({ error: "댓글은 1~4000자여야 합니다" }, 400);
  if (body.type && !ALLOWED_TYPES.has(body.type)) return json({ error: "invalid type" }, 400);

  await env.DB.prepare(
    `UPDATE comments SET body=?, body_html=?, type=COALESCE(?, type), updated_at=datetime('now') WHERE id=?`,
  ).bind(text, sanitizeHTML(text), body.type ?? null, id).run();

  return json({ ok: true });
}

async function deleteComment(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  const owner = await env.DB.prepare("SELECT user_id FROM comments WHERE id=?").bind(id).first<{ user_id: string }>();
  if (!owner) return json({ error: "not found" }, 404);
  const isOwner = owner.user_id === uid;
  const isCurator = (u?.level ?? 0) >= 3;
  if (!isOwner && !isCurator) return json({ error: "forbidden" }, 403);
  const newStatus = isOwner ? "deleted" : "hidden";
  await env.DB.prepare(
    `UPDATE comments SET status=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(newStatus, id).run();
  return json({ ok: true, status: newStatus });
}

async function toggleReaction(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({})) as { type?: string };
  const type = body.type ?? "helpful";
  const exists = await env.DB.prepare(
    "SELECT 1 FROM reactions WHERE comment_id=? AND user_id=? AND type=?",
  ).bind(id, uid, type).first();
  if (exists) {
    await env.DB.prepare(
      "DELETE FROM reactions WHERE comment_id=? AND user_id=? AND type=?",
    ).bind(id, uid, type).run();
    return json({ ok: true, on: false });
  }
  await env.DB.prepare(
    "INSERT INTO reactions (comment_id, user_id, type) VALUES (?, ?, ?)",
  ).bind(id, uid, type).run();
  return json({ ok: true, on: true });
}

async function flagComment(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({})) as { reason?: string };
  const reason = (body.reason ?? "").trim();
  if (!reason || reason.length > 500) return json({ error: "신고 사유 필요 (1~500자)" }, 400);
  await env.DB.prepare(
    "INSERT INTO flags (comment_id, user_id, reason) VALUES (?, ?, ?)",
  ).bind(id, uid, reason).run();
  return json({ ok: true });
}

// ── Minimal HTML sanitizer for comment bodies ──
// Allows a tiny markdown-ish subset converted to HTML with strict escaping.
function sanitizeHTML(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // paragraphs by blank lines, single newline → <br>
  const paras = escaped.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return paras.join("");
}
