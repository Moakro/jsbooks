/**
 * Dev-only Vite plugin: admin endpoints for places coordinates editing.
 * Only runs in `astro dev` (apply: 'serve'); zero effect in production build.
 *
 * Endpoints (POST, JSON body):
 *   /api/admin/places-coordinates/save     { slug, lat, lng }       → coord: [lat, lng]
 *   /api/admin/places-coordinates/save     { slug, none: true }     → coord: none
 *   /api/admin/places-coordinates/delete   { slug }                 → coord 라인 제거
 *
 * 동작:
 *   - frontmatter `coord: [lat, lng]` (또는 `coord: none`) 라인을 정규식 upsert (다른 키 비건드림)
 *   - 변경 전 content/.bak/<ts>/places/<slug>.md 자동 백업
 *   - chokidar full-reload 차단을 위해 places/** unwatch
 */
import fs from "node:fs/promises";
import path from "node:path";

const VAULT_ROOT = process.env.VAULT_PATH || path.join(process.cwd(), "content");
const PLACES_DIR = path.join(VAULT_ROOT, "places");

// ─── helpers (vite-canonical-mapping.mjs 답습) ──────────────────────────────

async function readText(p) {
  return fs.readFile(p, "utf8");
}
async function writeText(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, "utf8");
}
async function backup(p) {
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return;
  } catch {
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(VAULT_ROOT, ".bak", ts);
  const rel = path.relative(VAULT_ROOT, p);
  const dest = rel.startsWith("..")
    ? path.join(dir, "_external", path.basename(p))
    : path.join(dir, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(p, dest);
}
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const data = Buffer.concat(chunks).toString("utf8");
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// ─── frontmatter coord upsert ───────────────────────────────────────────────

// NOTE: JavaScript에서 `\s` 는 `\n` 을 포함하므로 라인 매칭에는 [ \t] 만 사용.
//       `\s*$` 로 쓰면 trailing newline까지 먹어 다음 frontmatter 라인이 깨진다.
// 좌표 튜플(`[..]`) 또는 `none` 둘 다 매칭.
const COORD_LINE_RE = /^coord:[ \t]*(?:\[[^\]]*\]|none)[ \t]*$/m;
const COORD_LINE_WITH_NL_RE = /^coord:[ \t]*(?:\[[^\]]*\]|none)[ \t]*\n?/m;

function upsertCoordLine(content, coordLine) {
  const m = content.match(/^(---\n[\s\S]*?\n)(---\n?)([\s\S]*)$/);
  if (!m) throw new Error("frontmatter not found");
  const [, fmBody, fmEnd, rest] = m;
  if (COORD_LINE_RE.test(fmBody)) {
    const replaced = fmBody.replace(COORD_LINE_RE, coordLine);
    return replaced + fmEnd + rest;
  }
  const fmBodyTrimmed = fmBody.endsWith("\n") ? fmBody : fmBody + "\n";
  return fmBodyTrimmed + coordLine + "\n" + fmEnd + rest;
}

function upsertCoordInFrontmatter(content, lat, lng) {
  return upsertCoordLine(content, `coord: [${lat.toFixed(6)}, ${lng.toFixed(6)}]`);
}

function upsertCoordNoneInFrontmatter(content) {
  return upsertCoordLine(content, "coord: none");
}

function removeCoordFromFrontmatter(content) {
  const m = content.match(/^(---\n[\s\S]*?\n)(---\n?)([\s\S]*)$/);
  if (!m) throw new Error("frontmatter not found");
  const [, fmBody, fmEnd, rest] = m;
  if (!COORD_LINE_RE.test(fmBody)) {
    return content;
  }
  const stripped = fmBody.replace(COORD_LINE_WITH_NL_RE, "");
  return stripped + fmEnd + rest;
}

// ─── slug 안전 검증 ─────────────────────────────────────────────────────────

function resolveSlugPath(slug) {
  if (typeof slug !== "string" || !slug.trim()) {
    throw new Error("invalid slug");
  }
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new Error("invalid slug (path-traversal)");
  }
  const filePath = path.join(PLACES_DIR, slug + ".md");
  const resolved = path.resolve(filePath);
  const placesResolved = path.resolve(PLACES_DIR);
  if (!resolved.startsWith(placesResolved + path.sep) && resolved !== placesResolved) {
    throw new Error("invalid slug (out of places dir)");
  }
  return filePath;
}

function validateLatLng(lat, lng) {
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("invalid lat (must be -90..90)");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error("invalid lng (must be -180..180)");
  }
}

// ─── handlers ───────────────────────────────────────────────────────────────

async function handleSave(body) {
  const { slug, lat, lng, none } = body ?? {};
  const filePath = resolveSlugPath(slug);

  // 광역/추상 장소 → coord: none
  if (none === true) {
    const content = await readText(filePath);
    const next = upsertCoordNoneInFrontmatter(content);
    await backup(filePath);
    await writeText(filePath, next);
    return { ok: true, slug, coord: "none", path: filePath };
  }

  validateLatLng(lat, lng);
  const content = await readText(filePath);
  const next = upsertCoordInFrontmatter(content, lat, lng);
  await backup(filePath);
  await writeText(filePath, next);
  return { ok: true, slug, coord: [Number(lat.toFixed(6)), Number(lng.toFixed(6))], path: filePath };
}

async function handleDelete(body) {
  const { slug } = body ?? {};
  const filePath = resolveSlugPath(slug);
  const content = await readText(filePath);
  const next = removeCoordFromFrontmatter(content);
  if (next === content) {
    return { ok: true, slug, removed: false };
  }
  await backup(filePath);
  await writeText(filePath, next);
  return { ok: true, slug, removed: true, path: filePath };
}

// ─── Vite plugin ────────────────────────────────────────────────────────────

/** @returns {import('vite').Plugin} */
export default function placesCoordinatesDev() {
  let viteServer = null;
  function notifyFileChange(changedPaths = []) {
    if (!viteServer) return;
    try {
      for (const p of changedPaths) {
        try { viteServer.watcher.emit("change", p); } catch {}
      }
    } catch {}
  }
  return {
    name: "jsbooks-places-coordinates-dev",
    apply: "serve",
    configureServer(server) {
      viteServer = server;
      try {
        server.watcher.unwatch([
          path.join(VAULT_ROOT, "places/**"),
          path.join(VAULT_ROOT, ".bak/**"),
        ]);
      } catch {}
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.method !== "POST") return next();
        const isSave = req.url.startsWith("/api/admin/places-coordinates/save");
        const isDelete = req.url.startsWith("/api/admin/places-coordinates/delete");
        if (!isSave && !isDelete) return next();
        try {
          const body = await readBody(req);
          const out = isSave ? await handleSave(body) : await handleDelete(body);
          console.log(
            `[admin] places-coordinates/${isSave ? "save" : "delete"} slug=${body?.slug}`,
            isSave ? (body?.none ? "→ none" : `→ [${body?.lat}, ${body?.lng}]`) : (out.removed ? "→ removed" : "→ noop"),
          );
          notifyFileChange([out.path].filter(Boolean));
          return json(res, 200, out);
        } catch (err) {
          const msg = err?.message ?? String(err);
          const status = /invalid|not found|frontmatter/i.test(msg) ? 400 : 500;
          console.error(`[admin] places-coordinates error:`, msg);
          return json(res, status, { ok: false, error: msg });
        }
      });
    },
  };
}
