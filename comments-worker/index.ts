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
 *   POST /api/visits/touch         — body { scripture, chapter } → upsert last_visited
 *   GET  /api/visits/badges        — ?scripture=<slug> 또는 (없으면) 전 경전 합계
 *   GET  /api/comments/verse-feed  — ?scripture=<slug>&chapter=<anchor> 절별 댓글+최신 미리보기
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
      if (path === "/api/comments/verse-feed" && req.method === "GET") return verseFeed(req, env);
      if (path === "/api/comments/recent" && req.method === "GET") return recentFeed(req, env);
      if (path === "/api/comments/mine" && req.method === "GET") return mineFeed(req, env);

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

      // ──── Visits ────
      if (path === "/api/visits/touch" && req.method === "POST") return touchVisit(req, env);
      if (path === "/api/visits/badges" && req.method === "GET") return visitsBadges(req, env);

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

// GET /api/comments/verse-feed?scripture=<slug>&chapter=<anchor>
// 응답: { verses: [{ anchor, count, latest: {body, user_nickname, is_admin, created_at, has_photos} }] }
// 댓글 0건 절은 제외. 정렬: latest.created_at desc.
// latest 본문은 status='published' 중 최신 1건 (deleted 제외). body는 plain text 30자.
async function verseFeed(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const scripture = url.searchParams.get("scripture")?.trim();
  const chapter = url.searchParams.get("chapter")?.trim();
  if (!scripture || !chapter) return json({ verses: [] });

  const versePrefix = `${scripture}:`;
  // chapter 안 verse anchor 패턴 — chapterKeyPattern 재사용
  const anchorPattern = chapterKeyPattern(scripture, chapter);
  const likePattern = `${versePrefix.replace(/[%_]/g, "\\$&")}${anchorPattern}`;

  // 절별 카운트 + 최신 댓글 행
  const rows = await env.DB.prepare(
    `WITH cnt AS (
       SELECT target_id, COUNT(*) AS n, MAX(created_at) AS latest_at
         FROM comments
        WHERE target_type='verse' AND status='published'
          AND target_id LIKE ? ESCAPE '\\'
        GROUP BY target_id
     )
     SELECT cnt.target_id, cnt.n, cnt.latest_at,
            c.body_html, c.attachments,
            u.display_name AS user_nickname, u.level AS user_level
       FROM cnt
       JOIN comments c ON c.target_type='verse'
                     AND c.target_id=cnt.target_id
                     AND c.status='published'
                     AND c.created_at=cnt.latest_at
       JOIN users u ON u.id=c.user_id
      ORDER BY cnt.latest_at DESC`,
  ).bind(likePattern).all<{
    target_id: string;
    n: number;
    latest_at: string;
    body_html: string | null;
    attachments: string | null;
    user_nickname: string | null;
    user_level: number;
  }>();

  const verses = (rows.results ?? []).map((r) => {
    const anchor = r.target_id.slice(versePrefix.length);
    let photos = 0;
    if (r.attachments) {
      try {
        const arr = JSON.parse(r.attachments);
        if (Array.isArray(arr)) photos = arr.filter((a: any) => a?.type === "image").length;
      } catch {}
    }
    const plain = stripHtmlToPlain(r.body_html ?? "");
    let preview = plain;
    if (!preview && photos > 0) preview = `📷 사진 ${photos}장`;
    return {
      anchor,
      count: r.n,
      latest: {
        body: preview,
        user_nickname: r.user_nickname ?? "",
        is_admin: (r.user_level ?? 0) >= 4,
        created_at: r.latest_at,
        has_photos: photos > 0,
      },
    };
  });

  return json({ verses }, 200, { "Cache-Control": "private, max-age=15" });
}

// 전체 피드 — 최근 발행 댓글을 타깃·작성자 메타 포함해서 반환.
// 클라이언트가 목록 페이지(/feed/)에서 사용.
async function recentFeed(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(Math.max(limitRaw || 30, 1), 100);
  const before = url.searchParams.get("before");

  const where: string[] = ["c.status='published'", "c.parent_id IS NULL"];
  const args: unknown[] = [];
  if (before) {
    where.push("c.created_at < ?");
    args.push(before);
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.body_html, c.attachments, c.created_at,
            u.display_name AS author_name, u.avatar_url AS author_avatar,
            u.level AS author_level
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT ?`,
  ).bind(...args, limit).all<{
    id: string;
    target_type: string;
    target_id: string;
    body_html: string | null;
    attachments: string | null;
    created_at: string;
    author_name: string | null;
    author_avatar: string | null;
    author_level: number;
  }>();

  const items = (rows.results ?? []).map((r) => buildFeedItem(r));
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null;
  return json({ items, nextCursor }, 200, { "Cache-Control": "public, max-age=15" });
}

// /feed/me/ — 로그인 사용자의 댓글 목록.
async function mineFeed(req: Request, env: Env): Promise<Response> {
  const me = await currentUserId(req, env);
  if (!me) return json({ items: [], nextCursor: null }, 200);
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(Math.max(limitRaw || 30, 1), 100);
  const before = url.searchParams.get("before");

  const where: string[] = ["c.status='published'", "c.user_id=?"];
  const args: unknown[] = [me];
  if (before) {
    where.push("c.created_at < ?");
    args.push(before);
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.body_html, c.attachments, c.created_at,
            u.display_name AS author_name, u.avatar_url AS author_avatar,
            u.level AS author_level
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT ?`,
  ).bind(...args, limit).all<{
    id: string;
    target_type: string;
    target_id: string;
    body_html: string | null;
    attachments: string | null;
    created_at: string;
    author_name: string | null;
    author_avatar: string | null;
    author_level: number;
  }>();

  const items = (rows.results ?? []).map((r) => buildFeedItem(r));
  const nextCursor = items.length === limit ? items[items.length - 1].created_at : null;
  return json({ items, nextCursor }, 200, { "Cache-Control": "private, max-age=5" });
}

function buildFeedItem(r: {
  id: string;
  target_type: string;
  target_id: string;
  body_html: string | null;
  attachments: string | null;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_level: number;
}) {
  let photos = 0;
  if (r.attachments) {
    try {
      const arr = JSON.parse(r.attachments);
      if (Array.isArray(arr)) photos = arr.filter((a: { type?: string }) => a?.type === "image").length;
    } catch {}
  }
  const plain = stripHtmlToPlain(r.body_html ?? "");
  const preview = plain || (photos > 0 ? `📷 사진 ${photos}장` : "");
  // target_id 가 "scripture-slug:anchor" 형태(verse) 일 때 분해해서 라우팅 힌트 제공.
  let scripture: string | null = null;
  let anchor: string | null = null;
  if (r.target_type === "verse" && r.target_id.includes(":")) {
    const i = r.target_id.indexOf(":");
    scripture = r.target_id.slice(0, i);
    anchor = r.target_id.slice(i + 1);
  }
  return {
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    scripture,
    anchor,
    preview,
    photos,
    created_at: r.created_at,
    author: {
      display_name: r.author_name ?? "",
      avatar_url: r.author_avatar ?? null,
      is_admin: (r.author_level ?? 0) >= 4,
    },
  };
}

function stripHtmlToPlain(html: string): string {
  // worker 환경(no DOM) — 정규식 기반. 태그 제거 후 엔티티 디코드.
  const noTags = html.replace(/<[^>]*>/g, "");
  return noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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

// ───────────────────── visits ─────────────────────

// chapter anchor 형식 검증 — "vol-chap" 또는 평면 "0" 또는 "preface"
function isValidChapterAnchor(s: string): boolean {
  if (s === "0" || s === "preface" || s === "appendix") return true;
  return /^\d+-\d+$/.test(s) || /^\d+$/.test(s);
}

// POST /api/visits/touch — { scripture, chapter }
// 로그인: D1 upsert. 비로그인: 200 OK (클라이언트가 localStorage 처리).
async function touchVisit(req: Request, env: Env): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { scripture?: string; chapter?: string };
  const scripture = (body.scripture ?? "").trim();
  const chapter = (body.chapter ?? "").trim();
  if (!scripture || !/^[a-z0-9-]+$/.test(scripture)) return json({ error: "invalid scripture" }, 400);
  if (!chapter || !isValidChapterAnchor(chapter)) return json({ error: "invalid chapter" }, 400);

  const uid = await currentUserId(req, env);
  if (!uid) return json({ ok: true, anonymous: true });

  await env.DB.prepare(
    `INSERT INTO user_visits (user_id, scripture_slug, chapter_anchor, last_visited)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, scripture_slug, chapter_anchor)
     DO UPDATE SET last_visited = datetime('now')`,
  ).bind(uid, scripture, chapter).run();
  return json({ ok: true });
}

// GET /api/visits/badges?scripture=<slug>
//   응답: { chapters: { "vol-chap": { total, new } }, scripture_total: { total, new } }
// scripture 미지정 시: 모든 경전 — { scriptures: { "<slug>": { total, new } } }
async function visitsBadges(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const scripture = url.searchParams.get("scripture")?.trim();
  const uid = await currentUserId(req, env);

  const cacheHeaders = { "Cache-Control": "private, max-age=30" };

  if (!scripture) {
    // 경전별 합계 모드 — 모든 verse·chapter 댓글 총수 + new 수 집계.
    // verse target_id 패턴: "<slug>:<anchor>"; chapter target_id: "<vol>:<chap>".
    // 새 댓글 = visits 없거나 created_at > last_visited.
    // 효율을 위해 verse 댓글은 target_id의 첫 segment(slug)로 group.
    const versesRows = await env.DB.prepare(
      `SELECT
         substr(target_id, 1, instr(target_id, ':') - 1) AS slug,
         COUNT(*) AS n,
         MAX(created_at) AS latest
       FROM comments
       WHERE target_type='verse' AND status='published' AND instr(target_id, ':') > 0
       GROUP BY slug`,
    ).all<{ slug: string; n: number; latest: string }>();

    // chapter 댓글: target_id = "vol:chap" — 별도 매핑 테이블이 없으므로 카운트만.
    // chapter target은 cheonjigaebyeokgyeong 한정 사용 — verse 합계에 합치지 않고
    // 응답에서는 verse 슬러그별로만 노출 (chapter 댓글은 chapter 페이지 진입 시 별도).
    const totals: Record<string, { total: number; new: number }> = {};
    for (const r of versesRows.results ?? []) {
      if (r.slug) totals[r.slug] = { total: r.n, new: 0 };
    }

    if (uid) {
      // 회원별 last_visited per (slug, chapter). 단일 슬러그 합계는 전체 chapter
      // last_visited 중 가장 오래된 것을 기준으로 잡으면 "새" 누락이 줄어든다.
      // 단순화: 슬러그 합계의 new 는 (visits에 그 슬러그 항목이 0개면 total, 아니면
      // 가장 오래된 last_visited 기준 새 댓글 수)로 계산.
      const visits = await env.DB.prepare(
        `SELECT scripture_slug, MIN(last_visited) AS oldest_visit
         FROM user_visits WHERE user_id = ?
         GROUP BY scripture_slug`,
      ).bind(uid).all<{ scripture_slug: string; oldest_visit: string }>();
      const oldestBySlug = new Map<string, string>();
      for (const v of visits.results ?? []) oldestBySlug.set(v.scripture_slug, v.oldest_visit);

      for (const slug of Object.keys(totals)) {
        const oldest = oldestBySlug.get(slug);
        if (!oldest) {
          totals[slug].new = totals[slug].total;
          continue;
        }
        const nr = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM comments
           WHERE target_type='verse' AND status='published'
             AND substr(target_id, 1, instr(target_id, ':') - 1) = ?
             AND created_at > ?`,
        ).bind(slug, oldest).first<{ n: number }>();
        totals[slug].new = nr?.n ?? 0;
      }
    } else {
      // 비로그인: total만 응답, new=0. 클라이언트가 localStorage로 다시 계산.
    }

    return json({ scriptures: totals, anonymous: !uid }, 200, cacheHeaders);
  }

  // 단일 scripture 모드: chapter 단위 집계.
  // verse 댓글 target_id 형식 = "<slug>:<anchor>".
  //   - cheonjigaebyeokgyeong anchor = "vol-chap-sentenceNum" → 첫 두 segment가 chapter key.
  //   - donggokbiseo anchor = 평면 숫자 → 모두 chapter "0".
  //   - hwaeundang-silgi anchor = "chap-N" → 첫 segment가 chapter key.
  // chapter 댓글 (target_type='chapter') target_id = "vol:chap" → chapter key = "vol-chap" (replace ":" with "-").
  // 분할은 클라이언트가 chapter key를 SQL에 미리 전달하기 어렵기 때문에
  // 행 단위로 자바스크립트에서 chapter key를 도출한다.

  const versePrefix = `${scripture}:`;
  const verseRows = await env.DB.prepare(
    `SELECT target_id, COUNT(*) AS n, MAX(created_at) AS latest
     FROM comments
     WHERE target_type='verse' AND status='published'
       AND target_id LIKE ? ESCAPE '\\'
     GROUP BY target_id`,
  ).bind(versePrefix.replace(/[%_]/g, "\\$&") + "%").all<{ target_id: string; n: number; latest: string }>();

  // chapter-level 댓글은 천지개벽경에만 존재 (target_id = "vol:chap").
  const chapterRows = scripture === "cheonjigaebyeokgyeong"
    ? await env.DB.prepare(
        `SELECT target_id, COUNT(*) AS n, MAX(created_at) AS latest
         FROM comments
         WHERE target_type='chapter' AND status='published'
         GROUP BY target_id`,
      ).all<{ target_id: string; n: number; latest: string }>()
    : { results: [] as { target_id: string; n: number; latest: string }[] };

  function chapterKeyFromAnchor(anchor: string): string {
    // anchor 형식별 chapter key 추출
    if (scripture === "cheonjigaebyeokgyeong") {
      // "vol-chap-sentenceNum" 또는 "preface-N"
      if (anchor.startsWith("preface")) return "preface";
      const m = anchor.match(/^(\d+)-(\d+)/);
      if (m) return `${m[1]}-${m[2]}`;
      return anchor;
    }
    if (scripture === "hwaeundang-silgi") {
      if (anchor.startsWith("preface")) return "preface";
      if (anchor.startsWith("appendix")) return "appendix";
      const m = anchor.match(/^(\d+)/);
      if (m) return m[1];
      return anchor;
    }
    // 평면 경전 (donggokbiseo)
    return "0";
  }

  const chapters: Record<string, { total: number; new: number; latest: string | null }> = {};

  for (const r of verseRows.results ?? []) {
    const anchor = r.target_id.slice(versePrefix.length);
    if (!anchor) continue;
    const key = chapterKeyFromAnchor(anchor);
    if (!chapters[key]) chapters[key] = { total: 0, new: 0, latest: null };
    chapters[key].total += r.n;
    if (!chapters[key].latest || r.latest > chapters[key].latest) chapters[key].latest = r.latest;
  }
  for (const r of chapterRows.results ?? []) {
    const key = r.target_id.replace(":", "-");
    if (!chapters[key]) chapters[key] = { total: 0, new: 0, latest: null };
    chapters[key].total += r.n;
    if (!chapters[key].latest || r.latest > chapters[key].latest) chapters[key].latest = r.latest;
  }

  let scriptureTotal = 0;
  let scriptureNew = 0;

  if (uid) {
    // 회원 last_visited per (slug, chapter)
    const visits = await env.DB.prepare(
      `SELECT chapter_anchor, last_visited FROM user_visits
       WHERE user_id = ? AND scripture_slug = ?`,
    ).bind(uid, scripture).all<{ chapter_anchor: string; last_visited: string }>();
    const visitMap = new Map<string, string>();
    for (const v of visits.results ?? []) visitMap.set(v.chapter_anchor, v.last_visited);

    for (const [key, entry] of Object.entries(chapters)) {
      scriptureTotal += entry.total;
      const lv = visitMap.get(key);
      if (!lv) {
        entry.new = entry.total;
        scriptureNew += entry.total;
        continue;
      }
      // chapter 안의 새 댓글 수: 정확히는 chapter별 verse/chapter 댓글 created_at > lv 카운트.
      // 효율을 위해 latest만 비교해 "있다/없다" 판단 후, 있다면 정확 카운트.
      if (!entry.latest || entry.latest <= lv) {
        entry.new = 0;
        continue;
      }
      // 정확 카운트
      const verseN = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM comments
         WHERE target_type='verse' AND status='published'
           AND target_id LIKE ? ESCAPE '\\'
           AND created_at > ?`,
      ).bind(`${versePrefix.replace(/[%_]/g, "\\$&")}${chapterKeyPattern(scripture, key)}`, lv)
        .first<{ n: number }>();
      let n = verseN?.n ?? 0;
      if (scripture === "cheonjigaebyeokgyeong") {
        const m = key.match(/^(\d+)-(\d+)$/);
        if (m) {
          const chN = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM comments
             WHERE target_type='chapter' AND status='published'
               AND target_id = ?
               AND created_at > ?`,
          ).bind(`${m[1]}:${m[2]}`, lv).first<{ n: number }>();
          n += chN?.n ?? 0;
        }
      }
      entry.new = n;
      scriptureNew += n;
    }
  } else {
    for (const entry of Object.values(chapters)) scriptureTotal += entry.total;
  }

  const out: Record<string, { total: number; new: number }> = {};
  for (const [k, v] of Object.entries(chapters)) out[k] = { total: v.total, new: v.new };

  return json({
    chapters: out,
    scripture_total: { total: scriptureTotal, new: scriptureNew },
    anonymous: !uid,
  }, 200, cacheHeaders);
}

// chapter key → SQL LIKE 패턴 (verse anchor prefix). 효율적인 LIKE.
function chapterKeyPattern(scripture: string, chapterKey: string): string {
  if (scripture === "cheonjigaebyeokgyeong") {
    if (chapterKey === "preface") return "preface-%";
    return `${chapterKey}-%`;
  }
  if (scripture === "hwaeundang-silgi") {
    if (chapterKey === "preface") return "preface-%";
    if (chapterKey === "appendix") return "appendix-%";
    return `${chapterKey}-%`;
  }
  return "%"; // 평면: 모두 chapter 0
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
