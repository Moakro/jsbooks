/**
 * Dev-only Vite plugin: admin endpoints for canonical scripture editing & mapping.
 * Only runs in `astro dev` (apply: 'serve'); zero effect in production build.
 *
 * Endpoints (POST, JSON body):
 *   /api/admin/canonical-mapping/save  (legacy v1, hangeul=array)
 *     { anchor, hangeul: string[], reviewed: boolean, confidence?: number }
 *
 *   /api/admin/canonical-mapping/bulk  (legacy v1, hangeul=array)
 *     { entries: { anchor, hangeul, reviewed, confidence? }[] }
 *
 *   /api/admin/canonical-mapping/save-sentence  (v2, hangeul=string)
 *     { anchor, hangeul: string, reviewed: boolean }
 *
 *   /api/admin/scripture-editor/save-chapter
 *     {
 *       hanja: { entryId, verses: [{ id?, text }] },
 *       hangeul?: { entryId, verses: [{ id?, text }] },
 *       mappings?: { entries: [{ anchor, hangeul, reviewed, confidence? }] }
 *     }
 *     Re-serializes one or both chapter markdown files with new sequential anchors,
 *     updates mapping JSON applying migrations, writes the canonical content path.
 */
import fs from "node:fs/promises";
import path from "node:path";

// Vault and content are now the same directory (repo `content/`). VAULT_PATH
// from .env can override; defaults to <cwd>/content.
const VAULT_ROOT = process.env.VAULT_PATH || path.join(process.cwd(), "content");
const MAPPING_PATH = path.join(
  VAULT_ROOT,
  "scripture/_mappings/cheonjigaebyeokgyeong-canonical.json",
);
const CHANGELOG_DISPLAY_PATH = path.join(
  VAULT_ROOT,
  "_data/changelog-display.json",
);

// ─── helpers ────────────────────────────────────────────────────────────────

async function readJson(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
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
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
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

// ─── mapping JSON ───────────────────────────────────────────────────────────

async function loadMapping() {
  try {
    return await readJson(MAPPING_PATH);
  } catch {
    return {
      version: 1,
      scripture: "cheonjigaebyeokgyeong-canonical",
      verses: {},
    };
  }
}
async function persistMapping(mapping) {
  await backup(MAPPING_PATH);
  await writeJson(MAPPING_PATH, mapping);
}
function applyMappingEntry(mapping, entry) {
  const { anchor, hangeul, reviewed, confidence } = entry;
  if (!anchor || !Array.isArray(hangeul)) return;
  if (hangeul.length === 0 && !reviewed) {
    delete mapping.verses[anchor];
    return;
  }
  mapping.verses[anchor] = {
    hangeul,
    reviewed: !!reviewed,
    ...(typeof confidence === "number" ? { confidence } : {}),
  };
}

// v2 (sentence-string) 단건 저장. 빈 string + 미검수 = entry 삭제 (v1 array 동작과 동일).
function applySentenceMapping(mapping, { anchor, hangeul, reviewed }) {
  if (!anchor || typeof hangeul !== "string") {
    throw new Error("anchor and hangeul (string) are required");
  }
  if (!hangeul && !reviewed) {
    delete mapping.verses[anchor];
    return;
  }
  mapping.verses[anchor] = {
    hangeul,
    reviewed: !!reviewed,
  };
}

// ─── markdown parsing/serializing ──────────────────────────────────────────

function splitFrontmatter(raw) {
  const m = raw.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[1], body: m[2] ?? "" };
}
function splitChapterHeading(body) {
  const m = body.match(/^\s*(#\s[^\n]+)\n+([\s\S]*)$/);
  if (!m) return { heading: "", rest: body };
  return { heading: m[1].trim(), rest: m[2] };
}
function parseFrontmatterAnchorPrefix(frontmatter) {
  const volM = frontmatter.match(/^권:\s*(\d+)\s*$/m);
  const chapM = frontmatter.match(/^장:\s*(\d+)\s*$/m);
  if (volM && chapM) return `${parseInt(volM[1], 10)}-${parseInt(chapM[1], 10)}`;
  if (/^section:\s*preface\s*$/m.test(frontmatter)) return "preface";
  return null;
}

function serializeChapter(verses, frontmatter, chapterHeading, anchorPrefix) {
  const lines = [];
  lines.push(frontmatter.trimEnd());
  lines.push("");
  if (chapterHeading) {
    lines.push(chapterHeading);
    lines.push("");
  }
  const migrations = new Map();
  const final = [];
  verses.forEach((v, i) => {
    const num = i + 1;
    const newId = `${anchorPrefix}-${num}`;
    if (v.id && v.id !== newId) migrations.set(v.id, newId);
    if (!v.id) migrations.set(`:new:${i}`, newId);
    final.push({ id: newId, num, text: v.text });
    lines.push(`## ${num}절 ^${newId}`);
    lines.push("");
    const t = (v.text ?? "").trim();
    if (t) {
      lines.push(t);
      lines.push("");
    } else {
      lines.push("");
    }
  });
  let md = lines.join("\n").replace(/\n{3,}$/, "\n");
  if (!md.endsWith("\n")) md += "\n";
  return { markdown: md, verses: final, migrations };
}

function parseExistingAnchors(body) {
  const re = /^## (\d+)절 \^(\S+)[^\n]*$/gm;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[2]);
  return out;
}

// ─── save-chapter ──────────────────────────────────────────────────────────

function entryIdToPath(entryId) {
  return path.join(VAULT_ROOT, "scripture", `${entryId}.md`);
}

async function rewriteChapter(side) {
  const { entryId, verses } = side;
  const filePath = entryIdToPath(entryId);
  const raw = await readText(filePath);
  const { frontmatter, body } = splitFrontmatter(raw);
  const { heading, rest } = splitChapterHeading(body);
  const prevAnchors = parseExistingAnchors(rest || body);
  const prefix = parseFrontmatterAnchorPrefix(frontmatter);
  if (!prefix) throw new Error(`Cannot determine anchor prefix for ${entryId}`);
  const ser = serializeChapter(verses, frontmatter, heading, prefix);
  await backup(filePath);
  await writeText(filePath, ser.markdown);
  return {
    prevAnchors,
    newAnchors: ser.verses.map((v) => v.id),
    migrations: ser.migrations,
  };
}

function migrateMapping(mapping, hanjaResult, hangeulResult, mappingEdits) {
  if (hanjaResult) {
    const newVerses = {};
    for (const oldKey of Object.keys(mapping.verses)) {
      const isStill = hanjaResult.newAnchors.includes(oldKey);
      const moved = hanjaResult.migrations.get(oldKey);
      if (isStill) {
        newVerses[oldKey] = mapping.verses[oldKey];
      } else if (moved) {
        newVerses[moved] = mapping.verses[oldKey];
      } else if (hanjaResult.prevAnchors.includes(oldKey)) {
        // deleted/merged-away
      } else {
        newVerses[oldKey] = mapping.verses[oldKey];
      }
    }
    mapping.verses = newVerses;
  }

  if (hangeulResult) {
    const movedMap = hangeulResult.migrations;
    const newSet = new Set(hangeulResult.newAnchors);
    const prevSet = new Set(hangeulResult.prevAnchors);
    for (const key of Object.keys(mapping.verses)) {
      const v = mapping.verses[key];
      if (!v?.hangeul) continue;
      const updated = [];
      for (const h of v.hangeul) {
        if (newSet.has(h)) updated.push(h);
        else if (movedMap.has(h)) updated.push(movedMap.get(h));
        else if (prevSet.has(h)) continue;
        else updated.push(h);
      }
      v.hangeul = [...new Set(updated)];
    }
  }

  if (mappingEdits && Array.isArray(mappingEdits.entries)) {
    for (const e of mappingEdits.entries) applyMappingEntry(mapping, e);
  }
  return mapping;
}

async function saveChapterHandler(body) {
  if (!body?.hanja?.entryId || !Array.isArray(body?.hanja?.verses)) {
    throw new Error("hanja.entryId and hanja.verses are required");
  }
  const hanjaResult = await rewriteChapter(body.hanja);
  let hangeulResult = null;
  if (body.hangeul?.entryId && Array.isArray(body.hangeul.verses)) {
    hangeulResult = await rewriteChapter(body.hangeul);
  }
  const mapping = await loadMapping();
  migrateMapping(mapping, hanjaResult, hangeulResult, body.mappings);
  await persistMapping(mapping);
  return {
    ok: true,
    hanja: {
      migrations: [...hanjaResult.migrations],
      anchors: hanjaResult.newAnchors,
    },
    hangeul: hangeulResult
      ? {
          migrations: [...hangeulResult.migrations],
          anchors: hangeulResult.newAnchors,
        }
      : null,
  };
}

// ─── Vite plugin ────────────────────────────────────────────────────────────

/** @returns {import('vite').Plugin} */
export default function canonicalMappingDev() {
  let viteServer = null;
  function triggerReload(changedPaths = []) {
    if (!viteServer) return;
    try {
      // 1) Notify Vite's file watcher about each changed path so any module
      //    that depends on the file (e.g., Astro content collection loader)
      //    invalidates its cache.
      for (const p of changedPaths) {
        try {
          viteServer.watcher.emit("change", p);
        } catch {
          // best-effort
        }
      }
      // 2) Tell connected browsers to do a full page reload — picks up content
      //    collection changes that Astro might otherwise serve from cache.
      viteServer.ws.send({ type: "full-reload", path: "*" });
    } catch {
      // ignore
    }
  }
  return {
    name: "jsbooks-canonical-mapping-dev",
    apply: "serve",
    configureServer(server) {
      viteServer = server;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        if (req.method !== "POST") return next();
        const isMappingSaveSentence = req.url.startsWith("/api/admin/canonical-mapping/save-sentence");
        // 주의: save-sentence가 save로 시작하므로 먼저 체크. isMappingSave는 그 외 v1 /save만 잡도록.
        const isMappingSave = !isMappingSaveSentence && req.url.startsWith("/api/admin/canonical-mapping/save");
        const isMappingBulk = req.url.startsWith("/api/admin/canonical-mapping/bulk");
        const isChapterSave = req.url.startsWith("/api/admin/scripture-editor/save-chapter");
        const isChangelogSave = req.url.startsWith("/api/admin/changelog/save");
        if (
          !isMappingSave &&
          !isMappingSaveSentence &&
          !isMappingBulk &&
          !isChapterSave &&
          !isChangelogSave
        ) {
          return next();
        }
        try {
          const body = await readBody(req);
          if (isMappingSaveSentence) {
            const mapping = await loadMapping();
            applySentenceMapping(mapping, body);
            await persistMapping(mapping);
            triggerReload([MAPPING_PATH]);
            return json(res, 200, {
              ok: true,
              count: Object.keys(mapping.verses).length,
            });
          }
          if (isMappingSave) {
            const mapping = await loadMapping();
            applyMappingEntry(mapping, body);
            await persistMapping(mapping);
            triggerReload([MAPPING_PATH]);
            return json(res, 200, { ok: true, count: Object.keys(mapping.verses).length });
          }
          if (isMappingBulk) {
            const entries = Array.isArray(body?.entries) ? body.entries : [];
            const mapping = await loadMapping();
            for (const e of entries) applyMappingEntry(mapping, e);
            await persistMapping(mapping);
            triggerReload([MAPPING_PATH]);
            return json(res, 200, { ok: true, count: Object.keys(mapping.verses).length });
          }
          if (isChapterSave) {
            const out = await saveChapterHandler(body);
            // Markdown was rewritten — invalidate Astro content collection cache.
            const changed = [entryIdToPath(body.hanja.entryId)];
            if (body.hangeul?.entryId) {
              changed.push(entryIdToPath(body.hangeul.entryId));
            }
            triggerReload(changed);
            return json(res, 200, out);
          }
          if (isChangelogSave) {
            // body: { hash, visible?: boolean, message?: string|null, clear?: boolean }
            const hash = String(body?.hash ?? "").trim();
            if (!hash) return json(res, 400, { error: "hash required" });
            let store;
            try {
              store = await readJson(CHANGELOG_DISPLAY_PATH);
            } catch {
              store = { overrides: {} };
            }
            if (!store.overrides) store.overrides = {};
            if (body.clear) {
              delete store.overrides[hash];
            } else {
              const ovr = store.overrides[hash] ?? {};
              if (typeof body.visible === "boolean") ovr.visible = body.visible;
              if (typeof body.message === "string") {
                const trimmed = body.message.trim();
                if (trimmed) ovr.message = trimmed;
                else delete ovr.message;
              } else if (body.message === null) {
                delete ovr.message;
              }
              if (
                ovr.visible === undefined &&
                (ovr.message === undefined || ovr.message === "")
              ) {
                delete store.overrides[hash];
              } else {
                store.overrides[hash] = ovr;
              }
            }
            await writeJson(CHANGELOG_DISPLAY_PATH, store);
            triggerReload([CHANGELOG_DISPLAY_PATH]);
            return json(res, 200, { ok: true, overrides: store.overrides });
          }
        } catch (err) {
          return json(res, 500, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
