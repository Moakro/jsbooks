#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Embed every verse + card body, then upload vectors to Cloudflare Vectorize.
 *
 * Usage:
 *   pnpm embed                          # full rebuild (delete-all + re-insert)
 *   pnpm embed -- --dry-run             # build vector NDJSON only, skip upload
 *   pnpm embed -- --no-delete           # incremental upsert (skip delete-all)
 *
 * Env required:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN   (with Workers AI + Vectorize write permission)
 *
 * Reads ./content/ via fs (same source the Astro build uses).
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

const CONTENT = "./content";
const INDEX = "jsbooks-embeddings";
const MODEL = "@cf/baai/bge-m3";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const NO_DELETE = args.has("--no-delete");
const UPLOAD_ONLY = args.has("--upload-only");

if (!DRY_RUN && (!ACCOUNT || !TOKEN)) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN env vars.");
  process.exit(1);
}

type Record = {
  id: string;
  text: string;
  metadata: {
    kind: "scripture" | "people" | "places" | "dosu" | "terms" | "dates";
    title: string;
    href: string;
    /** Short (~120 char) excerpt shown in search results. */
    snippet: string;
    /** Optional verse anchors */
    vol?: number;
    chap?: number;
    verse?: number;
  };
};

// ---------- 1. Collect records ----------

function readMd(path: string): { fm: any; body: string } {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fmRaw = m[1];
  const body = m[2].trim();
  // very small front-matter parser (key: value per line, scalar only)
  const fm: any = {};
  for (const line of fmRaw.split("\n")) {
    const mm = line.match(/^([^:]+):\s*(.*)$/);
    if (!mm) continue;
    const k = mm[1].trim();
    let v: any = mm[2].trim();
    if (/^\d+$/.test(v)) v = parseInt(v, 10);
    fm[k] = v;
  }
  return { fm, body };
}

function stripWikilinks(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, d) => d ?? t)
    .replace(/\[(.+?)\]/g, "$1") // strip remaining brackets like [天地合德]
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(text: string, max = 140): string {
  const plain = stripWikilinks(text);
  return plain.length > max ? plain.slice(0, max - 1) + "…" : plain;
}

const records: Record[] = [];

// 1a. scripture verses
const scriptureRoot = join(CONTENT, "scripture", "cheonjigaebyeokgyeong");
for (const volDir of readdirSync(scriptureRoot)) {
  const volPath = join(scriptureRoot, volDir);
  if (!statSync(volPath).isDirectory()) continue;
  for (const fname of readdirSync(volPath)) {
    if (!fname.endsWith(".md")) continue;
    const { fm, body } = readMd(join(volPath, fname));
    const vol = fm["권"];
    const chap = fm["장"];
    if (!vol || !chap) continue;
    // Split body into verses
    const verseRe = /^## (\d+)절 \^(\S+)\s*\n([\s\S]*?)(?=^## \d+절|\Z)/gm;
    let mm: RegExpExecArray | null;
    while ((mm = verseRe.exec(body)) !== null) {
      const verseNum = parseInt(mm[1], 10);
      const verseId = mm[2];
      const verseBody = mm[3].trim();
      const text = stripWikilinks(verseBody);
      if (!text) continue;
      records.push({
        id: `scripture:${vol}:${chap}:${verseNum}`,
        text,
        metadata: {
          kind: "scripture",
          title: `권${vol} ${fm["권_이름"] ?? ""} ${chap}장 ${verseNum}절`,
          href: `/scripture/${vol}/${chap}/#${verseId}`,
          snippet: snippet(text),
          vol,
          chap,
          verse: verseNum,
        },
      });
    }
  }
}

// 1b. preface
const prefacePath = join(CONTENT, "scripture", "cheonjigaebyeokgyeong", "00_서.md");
try {
  const { body } = readMd(prefacePath);
  const text = stripWikilinks(body);
  if (text) {
    records.push({
      id: "scripture:preface",
      text,
      metadata: {
        kind: "scripture",
        title: "천지개벽경 서(序)",
        href: "/scripture/preface/",
        snippet: snippet(text),
      },
    });
  }
} catch {
  // optional
}

// 1c. cards
const cardKinds: Record["metadata"]["kind"][] = ["people", "places", "dosu", "terms", "dates"];
const KIND_LABEL: Record<string, string> = {
  people: "인물", places: "지명", dosu: "도수", terms: "용어", dates: "시기",
};
for (const kind of cardKinds) {
  const dir = join(CONTENT, kind);
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith(".md")) continue;
    const slug = basename(fname, ".md");
    const { fm, body } = readMd(join(dir, fname));
    const text = stripWikilinks(body);
    if (!text) continue;
    records.push({
      id: `${kind}:${slug}`,
      text,
      metadata: {
        kind,
        title: `${fm.name ?? slug} (${KIND_LABEL[kind]})`,
        href: `/${kind}/${encodeURIComponent(slug)}/`,
        snippet: snippet(text),
      },
    });
  }
}

console.log(`collected ${records.length} records (${cardKinds.map((k) => `${k}=${records.filter((r) => r.metadata.kind === k).length}`).join(", ")}, scripture=${records.filter((r) => r.metadata.kind === "scripture").length})`);

// ---------- 2. Embed via Workers AI ----------

async function embedBatch(texts: string[]): Promise<number[][]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Workers AI ${res.status}: ${t}`);
  }
  const json: any = await res.json();
  const data = json.result?.data;
  if (!Array.isArray(data)) throw new Error(`unexpected response: ${JSON.stringify(json).slice(0, 200)}`);
  return data;
}

// ---------- 3. Upload to Vectorize ----------

async function upsertVectorize(ndjson: string): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/upsert`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Vectorize upsert ${res.status}: ${t}`);
  }
}

async function deleteAll(ids: string[]): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/delete_by_ids`;
  // Vectorize REST API accepts up to 100 ids per call
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: chunk }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`delete_by_ids ${res.status}: ${t}`);
    }
  }
}

// ---------- 4. Run ----------

async function main() {
  if (UPLOAD_ONLY) {
    const raw = readFileSync("./.vectorize/vectors.ndjson", "utf8").trim();
    const lines = raw.split("\n").filter(Boolean);
    console.log(`upload-only mode: re-using ${lines.length} vectors from disk`);
    if (!NO_DELETE) {
      console.log("deleting existing vectors...");
      await deleteAll(lines.map((l) => JSON.parse(l).id));
    }
    console.log("uploading vectors to Vectorize...");
    const CHUNK = 200;
    for (let k = 0; k < lines.length; k += CHUNK) {
      const part = lines.slice(k, k + CHUNK).join("\n");
      await upsertVectorize(part);
      console.log(`  uploaded ${Math.min(k + CHUNK, lines.length)} / ${lines.length}`);
    }
    console.log("✅ done (upload-only)");
    return;
  }

  // Embed in dynamic batches: cap by both count AND total chars (proxy for tokens).
  // bge-m3 accepts max 60K tokens per request; ~3 chars/token avg → keep total <40K chars.
  const MAX_BATCH = 32;
  const MAX_CHARS_PER_BATCH = 40000;
  const PER_TEXT_CAP = 1500; // ~ a few hundred tokens per item, enough for most verses
  const vectors: { id: string; values: number[]; metadata: any }[] = [];

  let i = 0;
  while (i < records.length) {
    let end = i;
    let chars = 0;
    while (
      end < records.length &&
      end - i < MAX_BATCH &&
      chars + Math.min(records[end].text.length, PER_TEXT_CAP) <= MAX_CHARS_PER_BATCH
    ) {
      chars += Math.min(records[end].text.length, PER_TEXT_CAP);
      end++;
    }
    if (end === i) end = i + 1; // safety: always make progress
    const batch = records.slice(i, end);
    const texts = batch.map((r) => r.text.slice(0, PER_TEXT_CAP));
    if (DRY_RUN) {
      // skip actual API
      vectors.push(
        ...batch.map((r) => ({
          id: r.id,
          values: [],
          metadata: r.metadata,
        })),
      );
    } else {
      const embeddings = await embedBatch(texts);
      for (let j = 0; j < batch.length; j++) {
        vectors.push({
          id: batch[j].id,
          values: embeddings[j],
          metadata: batch[j].metadata,
        });
      }
      console.log(`  embedded ${end} / ${records.length}`);
    }
    i = end;
  }

  // Persist NDJSON snapshot for debugging / re-upload without re-embedding
  mkdirSync("./.vectorize", { recursive: true });
  const ndjson = vectors.map((v) => JSON.stringify(v)).join("\n");
  writeFileSync("./.vectorize/vectors.ndjson", ndjson);
  console.log(`wrote ${vectors.length} vectors to .vectorize/vectors.ndjson`);

  if (DRY_RUN) {
    console.log("dry-run: skipped Vectorize upsert");
    return;
  }

  // Optional: clear existing vectors first (full rebuild)
  if (!NO_DELETE) {
    console.log("deleting existing vectors...");
    await deleteAll(vectors.map((v) => v.id));
  }

  // Upsert (Vectorize accepts NDJSON)
  console.log("uploading vectors to Vectorize...");
  // Vectorize upsert limit ~1000 vectors per request, ~5MB body
  const CHUNK = 200;
  for (let i = 0; i < vectors.length; i += CHUNK) {
    const part = vectors.slice(i, i + CHUNK).map((v) => JSON.stringify(v)).join("\n");
    await upsertVectorize(part);
    console.log(`  uploaded ${Math.min(i + CHUNK, vectors.length)} / ${vectors.length}`);
  }

  console.log("✅ done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
