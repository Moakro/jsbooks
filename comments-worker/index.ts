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
 *   POST /api/comments/:id/pin     — toggle pin (level >= 4)
 *   POST /api/upload/image         — upload resized image (optional X-Upload-Hash for dedup)
 *   POST /api/upload/check         — body { hash } → check user's prior upload
 *
 * Session: signed JWT in HttpOnly cookie (`jb_session`).
 * SameSite=Lax, Secure, ~30 day expiry. JWT signing uses HS256 with AUTH_SECRET.
 */

interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AUTH_SECRET: string; // any 32+ char random string
  SITE_ORIGIN: string;
  UPLOADS_PUBLIC_BASE: string;
}

const COOKIE_NAME = "jb_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const NICKNAME_RESERVED = [
  // 운영자
  "관리자", "admin", "운영자", "moakro", "system", "support",
  // 단체명 부분 매치
  "본부", "공식", "총무", "총회", "회장", "교주",
  // 교리적 권위
  "상제", "강증산", "미륵", "미륵존불", "옥황", "옥황상제",
  "대선생", "진인", "성인", "도주",
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

      // ──── Admin (level >= 4) ────
      if (path === "/api/admin/users" && req.method === "GET") return adminListUsers(req, env);
      if (path === "/api/admin/comments" && req.method === "GET") return adminListComments(req, env);
      const promoteMatch = path.match(/^\/api\/admin\/comments\/([^/]+)\/promote$/);
      if (promoteMatch && req.method === "POST") return adminPromoteComment(req, env, promoteMatch[1]);

      // ──── Uploads (R2) ────
      if (path === "/api/upload/image" && req.method === "POST") return uploadImage(req, env);

      // ──── Comments ────
      if (path === "/api/comments" && req.method === "GET") return listComments(req, env);
      if (path === "/api/comments" && req.method === "POST") return createComment(req, env);
      if (path === "/api/comments/counts" && req.method === "GET") return countComments(req, env);

      const m = path.match(/^\/api\/comments\/([^/]+)(?:\/(react|flag|pin))?$/);
      if (m) {
        const id = m[1];
        const sub = m[2];
        if (sub === "react" && req.method === "POST") return toggleReaction(req, env, id);
        if (sub === "flag" && req.method === "POST") return flagComment(req, env, id);
        if (sub === "pin" && req.method === "POST") return pinComment(req, env, id);
        if (req.method === "PATCH") return editComment(req, env, id);
        if (req.method === "DELETE") return deleteComment(req, env, id);
      }

      // ──── Upload check (dedup) ────
      if (path === "/api/upload/check" && req.method === "POST") return checkUpload(req, env);

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
    return json({ error: "운영자·단체명·교리적 권위를 유추할 수 있는 닉네임입니다" }, 400);
  }
  // 중복 확인은 의도적으로 하지 않음. 프로필 이미지로 사용자를 구분.

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

// ───────────────────── admin ─────────────────────

interface AdminUserRow {
  id: string;
  created_at: string;
  avatar_url: string | null;
  display_name: string | null;
  email: string;
  level: number;
  is_seed: number;
  last_seen_at: string | null;
  comments_count: number;
  flags_received: number;
}

async function adminListUsers(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);

  const rs = await env.DB.prepare(
    `
    SELECT
      u.id,
      u.created_at,
      u.avatar_url,
      u.display_name,
      u.email,
      u.level,
      u.is_seed,
      u.last_seen_at,
      (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.status = 'published') AS comments_count,
      (SELECT COUNT(*) FROM flags f
         JOIN comments c ON c.id = f.comment_id
        WHERE c.user_id = u.id AND f.status = 'open') AS flags_received
    FROM users u
    ORDER BY
      CASE WHEN u.last_seen_at IS NULL THEN 1 ELSE 0 END,
      u.last_seen_at DESC,
      u.created_at DESC
    `,
  ).all<AdminUserRow>();

  return json({ users: rs.results ?? [] });
}

interface AdminCommentRow {
  id: string;
  target_type: string;
  target_id: string;
  body: string;
  type: string;
  status: string;
  promoted_to_note_id: string | null;
  created_at: string;
  user_id: string;
  display_name: string | null;
  helpful_count: number;
}

// List comments for admin promotion UI. Filters:
//   ?unpromoted=1   (default 1) — only comments NOT yet promoted
//   ?type=question  — restrict to one comment type
//   ?limit=N        — max rows (default 100, max 500)
async function adminListComments(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const unpromoted = (url.searchParams.get("unpromoted") ?? "1") === "1";
  const typeFilter = url.searchParams.get("type");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);

  const where: string[] = ["c.status = 'published'"];
  const binds: unknown[] = [];
  if (unpromoted) where.push("c.promoted_to_note_id IS NULL");
  if (typeFilter && ALLOWED_TYPES.has(typeFilter)) {
    where.push("c.type = ?");
    binds.push(typeFilter);
  }

  const sql = `
    SELECT c.id, c.target_type, c.target_id, c.body, c.type, c.status,
           c.promoted_to_note_id, c.created_at,
           u.id AS user_id, u.display_name,
           (SELECT COUNT(*) FROM reactions r WHERE r.comment_id=c.id AND r.type='helpful') AS helpful_count
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE ${where.join(" AND ")}
    ORDER BY c.created_at DESC
    LIMIT ?`;
  const rs = await env.DB.prepare(sql).bind(...binds, limit).all<AdminCommentRow>();
  return json({ comments: rs.results ?? [] });
}

// Mark a comment as promoted into a vault note.
// Body: { note_id: string }   (e.g. "uc-2026-05-15-1")
// To clear an accidental promotion: { note_id: null }
async function adminPromoteComment(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "unauthenticated" }, 401);
  const me = await loadUser(env, uid);
  if (!me || me.level < 4) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({})) as { note_id?: string | null };
  const noteId = body.note_id;
  if (noteId !== null && (typeof noteId !== "string" || !/^uc-\d{4}-\d{2}-\d{2}-\d+$/.test(noteId))) {
    return json({ error: "note_id 형식이 잘못되었습니다 (uc-YYYY-MM-DD-N)" }, 400);
  }

  const found = await env.DB.prepare("SELECT id FROM comments WHERE id=?").bind(id).first();
  if (!found) return json({ error: "not found" }, 404);

  await env.DB.prepare(
    `UPDATE comments SET promoted_to_note_id=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(noteId, id).run();

  return json({ ok: true, id, promoted_to_note_id: noteId });
}

// ───────────────────── comments ─────────────────────

const ALLOWED_TYPES = new Set(["memo", "question", "cross", "cite"]);
const ALLOWED_TARGET_TYPES = new Set(["verse", "card", "chapter"]);
const MAX_ATTACHMENTS = 6;

type Attachment =
  | { type: "image"; url: string; width?: number; height?: number }
  | { type: "map"; lat: number; lng: number; zoom?: number; label?: string };

function sanitizeAttachments(input: unknown, env: Env): Attachment[] {
  if (!Array.isArray(input)) return [];
  const allowedHosts = new Set<string>();
  try {
    const u = new URL(env.UPLOADS_PUBLIC_BASE);
    allowedHosts.add(u.host);
  } catch {}
  const out: Attachment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const t = (raw as any).type;
    if (t === "image") {
      const url = String((raw as any).url ?? "");
      try {
        const u = new URL(url);
        if (!allowedHosts.has(u.host)) continue;
      } catch {
        continue;
      }
      const width = Number((raw as any).width);
      const height = Number((raw as any).height);
      out.push({
        type: "image",
        url,
        ...(Number.isFinite(width) ? { width } : {}),
        ...(Number.isFinite(height) ? { height } : {}),
      });
    } else if (t === "map") {
      const lat = Number((raw as any).lat);
      const lng = Number((raw as any).lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const zoomNum = Number((raw as any).zoom);
      const labelRaw = (raw as any).label;
      const label = typeof labelRaw === "string" ? labelRaw.slice(0, 80) : undefined;
      out.push({
        type: "map",
        lat,
        lng,
        ...(Number.isFinite(zoomNum) ? { zoom: Math.min(20, Math.max(1, zoomNum)) } : {}),
        ...(label ? { label } : {}),
      });
    }
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

// Batch count: GET /api/comments/counts?targets=verse:slug:1,verse:slug:2,...
// Returns { counts: { "<target>": N, ... } } — only entries with N > 0 are guaranteed present;
// callers should default missing keys to 0.
async function countComments(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("targets");
  if (!raw) return json({ counts: {} });
  const targets = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (targets.length === 0) return json({ counts: {} });

  // Group by target_type for a single SQL per type
  const byType = new Map<string, string[]>();
  for (const t of targets) {
    if (!t.includes(":")) continue;
    const [type, ...rest] = t.split(":");
    if (!ALLOWED_TARGET_TYPES.has(type)) continue;
    const id = rest.join(":");
    if (!id) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(id);
  }

  const counts: Record<string, number> = {};
  for (const [type, ids] of byType) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT target_id, COUNT(*) AS n
         FROM comments
        WHERE target_type=? AND status='published' AND target_id IN (${placeholders})
        GROUP BY target_id`,
    ).bind(type, ...ids).all<{ target_id: string; n: number }>();
    for (const r of rows.results ?? []) {
      counts[`${type}:${r.target_id}`] = r.n;
    }
  }
  return json({ counts });
}

async function listComments(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get("target");
  if (!target || !target.includes(":")) return json({ error: "missing target" }, 400);
  const [targetType, ...rest] = target.split(":");
  const targetId = rest.join(":");
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return json({ error: "invalid target type" }, 400);

  // published + deleted 모두 반환. deleted는 답글이 있어 placeholder로 남은 행.
  // hidden(큐레이터 숨김)은 노출 안 함.
  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.parent_id, c.body_html, c.type,
            c.status, c.attachments, c.is_pinned, c.promoted_to_note_id, c.created_at, c.updated_at,
            u.id AS user_id, u.display_name AS author_name,
            u.avatar_url AS author_avatar, u.affiliation AS author_affiliation,
            u.level AS author_level,
            (SELECT COUNT(*) FROM reactions r WHERE r.comment_id=c.id AND r.type='helpful') AS helpful_count,
            (SELECT COUNT(*) FROM comments cc WHERE cc.parent_id=c.id AND cc.status IN ('published','deleted')) AS reply_count
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.target_type=? AND c.target_id=? AND c.status IN ('published','deleted')
     ORDER BY c.is_pinned DESC, c.created_at ASC`,
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

  const comments = (rows.results ?? []).map((r: any) => {
    const isDeleted = r.status === "deleted";
    let attachments: any[] = [];
    if (!isDeleted && r.attachments) {
      try {
        const parsed = JSON.parse(r.attachments);
        if (Array.isArray(parsed)) attachments = parsed;
      } catch {}
    }
    return {
      id: r.id,
      parent_id: r.parent_id,
      body_html: isDeleted ? "" : r.body_html,
      type: r.type,
      status: r.status,
      is_pinned: r.is_pinned === 1,
      reply_count: r.reply_count ?? 0,
      created_at: r.created_at,
      updated_at: r.updated_at,
      attachments,
      promoted_to_note_id: r.promoted_to_note_id ?? null,
      author: isDeleted
        ? { display_name: "", avatar_url: null, affiliation: null, level: 0 }
        : {
            display_name: r.author_name,
            avatar_url: r.author_avatar,
            affiliation: r.author_affiliation,
            level: r.author_level,
          },
      helpful_count: isDeleted ? 0 : r.helpful_count,
      you_helpful: !isDeleted && myReactions.has(r.id),
      author_id: isDeleted ? null : r.user_id,
    };
  });

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
    attachments?: unknown;
  };
  const target = body.target ?? "";
  if (!target.includes(":")) return json({ error: "missing target" }, 400);
  const [targetType, ...rest] = target.split(":");
  const targetId = rest.join(":");
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return json({ error: "invalid target type" }, 400);
  const attachments = sanitizeAttachments(body.attachments, env);
  const text = (body.body ?? "").trim();
  if (attachments.length === 0 && (text.length === 0 || text.length > 4000)) {
    return json({ error: "댓글은 1~4000자여야 합니다 (또는 첨부 1개 이상)" }, 400);
  }
  if (text.length > 4000) {
    return json({ error: "댓글은 1~4000자여야 합니다" }, 400);
  }
  const type = body.type ?? "memo";
  if (!ALLOWED_TYPES.has(type)) return json({ error: "invalid type" }, 400);

  const id = uuid();
  const attJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
  await env.DB.prepare(
    `INSERT INTO comments (id, target_type, target_id, user_id, parent_id, body, body_html, type, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, targetType, targetId, uid, body.parent_id ?? null, text, sanitizeHTML(text), type, attJson).run();

  return json({ ok: true, id });
}

async function editComment(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const owner = await env.DB.prepare("SELECT user_id FROM comments WHERE id=?").bind(id).first<{ user_id: string }>();
  if (!owner) return json({ error: "not found" }, 404);
  if (owner.user_id !== uid) return json({ error: "forbidden" }, 403);

  // 답글이 하나라도 있으면 수정 잠금 (published + deleted 모두 카운트, hidden 제외)
  const replyCount = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE parent_id=? AND status IN ('published','deleted')",
  ).bind(id).first<{ n: number }>();
  if ((replyCount?.n ?? 0) > 0) {
    return json({ error: "답글이 있어 수정할 수 없습니다" }, 403);
  }

  const body = await req.json().catch(() => ({})) as {
    body?: string;
    type?: string;
    attachments?: unknown;
  };
  const text = (body.body ?? "").trim();
  const hasAttachmentField = body.attachments !== undefined;
  const attachments = hasAttachmentField ? sanitizeAttachments(body.attachments, env) : null;
  if (text.length === 0 && (!hasAttachmentField || (attachments?.length ?? 0) === 0)) {
    return json({ error: "댓글은 1~4000자여야 합니다 (또는 첨부 1개 이상)" }, 400);
  }
  if (text.length > 4000) return json({ error: "댓글은 1~4000자여야 합니다" }, 400);
  if (body.type && !ALLOWED_TYPES.has(body.type)) return json({ error: "invalid type" }, 400);

  if (hasAttachmentField) {
    const attJson = (attachments?.length ?? 0) > 0 ? JSON.stringify(attachments) : null;
    await env.DB.prepare(
      `UPDATE comments SET body=?, body_html=?, type=COALESCE(?, type), attachments=?, updated_at=datetime('now') WHERE id=?`,
    ).bind(text, sanitizeHTML(text), body.type ?? null, attJson, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE comments SET body=?, body_html=?, type=COALESCE(?, type), updated_at=datetime('now') WHERE id=?`,
    ).bind(text, sanitizeHTML(text), body.type ?? null, id).run();
  }

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

  if (isOwner) {
    // 답글 유무에 따라 hard vs soft. published+deleted 모두 답글로 카운트.
    const replyCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE parent_id=? AND status IN ('published','deleted')",
    ).bind(id).first<{ n: number }>();
    if ((replyCount?.n ?? 0) === 0) {
      // hard delete. reactions/flags는 ON DELETE CASCADE로 함께 정리.
      // R2 첨부는 보존 (orphan cleanup 별도 트랙).
      await env.DB.prepare("DELETE FROM comments WHERE id=?").bind(id).run();
      return json({ ok: true, status: "removed" });
    }
    await env.DB.prepare(
      `UPDATE comments SET status='deleted', body='', body_html='', attachments=NULL, updated_at=datetime('now') WHERE id=?`,
    ).bind(id).run();
    return json({ ok: true, status: "deleted" });
  }

  // 큐레이터(level>=3) — 숨김 처리 (현행 유지)
  await env.DB.prepare(
    `UPDATE comments SET status='hidden', updated_at=datetime('now') WHERE id=?`,
  ).bind(id).run();
  return json({ ok: true, status: "hidden" });
}

async function pinComment(req: Request, env: Env, id: string): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || (u.level ?? 0) < 4) return json({ error: "forbidden" }, 403);
  const row = await env.DB.prepare("SELECT is_pinned FROM comments WHERE id=?").bind(id).first<{ is_pinned: number }>();
  if (!row) return json({ error: "not found" }, 404);
  const next = row.is_pinned === 1 ? 0 : 1;
  await env.DB.prepare(
    `UPDATE comments SET is_pinned=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(next, id).run();
  return json({ ok: true, is_pinned: next === 1 });
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

// ───────────────────── uploads ─────────────────────

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // 2.5 MB hard cap; client resizes to ≤1600px webp Q85 first.
const UPLOAD_RATE_LIMIT_PER_HOUR = 30;

function extFromContentType(ct: string): string {
  if (ct === "image/jpeg") return "jpg";
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  return "bin";
}

async function uploadImage(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const u = await loadUser(env, uid);
  if (!u || !u.display_name) return json({ error: "닉네임 설정 필요" }, 403);
  if ((u.level ?? 0) < 1) return json({ error: "업로드 권한 없음" }, 403);

  const ct = req.headers.get("Content-Type") ?? "";
  if (!ALLOWED_IMAGE_TYPES.has(ct)) {
    return json({ error: "허용된 형식: jpeg/png/webp" }, 415);
  }
  const lenHeader = req.headers.get("Content-Length");
  const len = lenHeader ? parseInt(lenHeader, 10) : NaN;
  if (Number.isFinite(len) && len > MAX_IMAGE_BYTES) {
    return json({ error: `파일이 너무 큼 (max ${Math.round(MAX_IMAGE_BYTES / 1024)} KB)` }, 413);
  }

  // 클라이언트가 헤더로 sha256 hex(64자)를 보내면 dedup index에 등록한다.
  // 동일 (uid, hash) 이미 있으면 기존 url을 그대로 반환하고 새 업로드는 skip.
  const hashHeader = req.headers.get("X-Upload-Hash");
  const widthHeader = req.headers.get("X-Image-Width");
  const heightHeader = req.headers.get("X-Image-Height");
  const hash = hashHeader && /^[0-9a-f]{64}$/i.test(hashHeader) ? hashHeader.toLowerCase() : null;
  const width = widthHeader ? Math.max(0, parseInt(widthHeader, 10)) : 0;
  const height = heightHeader ? Math.max(0, parseInt(heightHeader, 10)) : 0;

  if (hash) {
    const existing = await env.DB.prepare(
      "SELECT url, width, height FROM user_uploaded_photos WHERE user_id=? AND hash=?",
    ).bind(uid, hash).first<{ url: string; width: number; height: number }>();
    if (existing) {
      return json({ ok: true, deduped: true, url: existing.url, width: existing.width, height: existing.height });
    }
  }

  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: `파일이 너무 큼 (max ${Math.round(MAX_IMAGE_BYTES / 1024)} KB)` }, 413);
  }

  // Rate limit: count user's uploads in the current hour by listing prefix.
  // Acceptable for low traffic; can move to KV-backed counters later.
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const userPrefix = `comments/${yyyy}/${mm}/${dd}/${hh}/${uid}/`;
  const list = await env.UPLOADS.list({ prefix: userPrefix, limit: 100 });
  if ((list.objects?.length ?? 0) >= UPLOAD_RATE_LIMIT_PER_HOUR) {
    return json({ error: "업로드 한도 초과 (시간당)" }, 429);
  }

  const ext = extFromContentType(ct);
  const id = uuid();
  const key = `${userPrefix}${id}.${ext}`;

  await env.UPLOADS.put(key, buf, {
    httpMetadata: { contentType: ct, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { uid, originalSize: String(buf.byteLength), ...(hash ? { hash } : {}) },
  });

  const base = (env.UPLOADS_PUBLIC_BASE || "").replace(/\/$/, "");
  const url = `${base}/${key}`;

  if (hash) {
    // INSERT OR IGNORE — 동시성 race에서도 안전. 충돌 시 기존 url 유지.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_uploaded_photos
         (user_id, hash, url, r2_key, width, height, size_bytes, content_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, hash, url, key, width, height, buf.byteLength, ct).run();
  }

  return json({ ok: true, url, key, bytes: buf.byteLength, contentType: ct });
}

async function checkUpload(req: Request, env: Env): Promise<Response> {
  const uid = await currentUserId(req, env);
  if (!uid) return json({ error: "not authenticated" }, 401);
  const body = await req.json().catch(() => ({})) as { hash?: string };
  const hash = body.hash;
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return json({ error: "invalid hash" }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT url, width, height FROM user_uploaded_photos WHERE user_id=? AND hash=?",
  ).bind(uid, hash.toLowerCase()).first<{ url: string; width: number; height: number }>();
  if (!row) return json({ exists: false });
  return json({ exists: true, url: row.url, width: row.width, height: row.height });
}
