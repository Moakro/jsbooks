/**
 * Dev-only Vite plugin: exposes admin endpoints for editing the canonical
 * scripture mapping JSON. Only runs in `astro dev` (apply: 'serve'); has
 * zero effect on the production build.
 *
 * Endpoints (all POST, JSON body):
 *   /api/admin/canonical-mapping/save
 *     { anchor, hangeul: string[], reviewed: boolean, confidence?: number }
 *     Updates one verse mapping in BOTH vault and content/ JSON.
 *
 *   /api/admin/canonical-mapping/bulk
 *     { entries: { anchor, hangeul, reviewed, confidence? }[] }
 *     Bulk save (used when saving a whole chapter's edits).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const VAULT_PATH = path.join(
  os.homedir(),
  "Vault-jsbooks/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json"
);
const CONTENT_PATH = path.join(
  process.cwd(),
  "content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json"
);

async function readJson(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function loadMapping() {
  try {
    return await readJson(VAULT_PATH);
  } catch {
    return {
      version: 1,
      scripture: "cheonjigaebyeokgyeong-canonical",
      verses: {},
    };
  }
}

async function persist(mapping) {
  await writeJson(VAULT_PATH, mapping);
  await writeJson(CONTENT_PATH, mapping);
}

function applyEntry(mapping, entry) {
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

export default function canonicalMappingDev() {
  return {
    name: "jsbooks-canonical-mapping-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const isSave = req.url.startsWith("/api/admin/canonical-mapping/save");
        const isBulk = req.url.startsWith("/api/admin/canonical-mapping/bulk");
        if (!isSave && !isBulk) return next();
        if (req.method !== "POST") return json(res, 405, { error: "POST only" });

        try {
          const body = await readBody(req);
          const mapping = await loadMapping();
          if (isSave) {
            applyEntry(mapping, body);
          } else {
            const entries = Array.isArray(body?.entries) ? body.entries : [];
            for (const e of entries) applyEntry(mapping, e);
          }
          await persist(mapping);
          json(res, 200, { ok: true, count: Object.keys(mapping.verses).length });
        } catch (err) {
          json(res, 500, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
