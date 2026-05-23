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
const NO_UPLOAD = args.has("--no-upload"); // embed + write NDJSON, skip Vectorize

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
    /** Scripture slug (for cross-scripture correspondence matching). */
    scriptureSlug?: string;
    /** Optional verse anchors */
    vol?: number;
    chap?: number;
    verse?: number;
    /** Block-id anchor (e.g. "1-1-1" or "047"). */
    verseId?: string;
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

// 1a. scripture verses + preface — walk all scripture slugs under content/scripture/
const scriptureRoot = join(CONTENT, "scripture");

// Admin-only 한글 백업본은 한자본과 동일 본문이라 near-1.0 가짜 매칭을 만든다.
// 임베딩(검색·correspondence)에서 완전히 제외. (사이트 검색·feed·AI 에서도 차단됨)
const EXCLUDED_SCRIPTURE_SLUGS = new Set<string>([
  "cheonjigaebyeokgyeong-hangeul",
]);

// 두 markdown 포맷의 절 추출 (src/lib/verse-parser.ts 와 동일 로직을 fs 환경으로 포팅):
//   (A) Legacy verse-anchor: `## N절 ^anchor` 헤딩 + 본문 단락
//        — 동곡비서(`^001`), 화은당실기(`^장-절`), 천지개벽경 한글 백업본
//   (B) Sentence-anchor: 본문 단락 끝 인라인 `^anchor` (천지개벽경, 마이그레이션 후)
//        — `## N절` 그룹 헤딩 유무 무관. 서문은 `^preface-N`.
// verses.json.ts / backlinks.ts 와 동일하게: sentence 파서를 먼저 시도하고,
// 0건이면 legacy 파서로 fallback (두 파서는 같은 body 에서 상호배타적).

interface ParsedItem {
  /** Anchor id like "1-1-1", "preface-3", "001", "1-3". */
  id: string;
  /** Running 1-based index for display titles. */
  num: number;
  text: string;
}

const LEGACY_HEADING_RE = /^## (\d+)절 \^(\S+)[^\n]*$/gm;
const GROUP_HEADING_RE = /^## (\d+)절\s*$/gm;
const SENTENCE_ANCHOR_RE = /\s+\^([\w.-]+)\s*$/;

/** Format (B): inline sentence anchors, flattened to one item per anchor. */
function parseSentencesFlat(body: string): ParsedItem[] {
  if (!body) return [];
  // collect `## N절` group headings (may be absent → flat mode)
  const headings: { start: number; bodyStart: number }[] = [];
  GROUP_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GROUP_HEADING_RE.exec(body)) !== null) {
    headings.push({ start: m.index, bodyStart: m.index + m[0].length });
  }

  const collectFrom = (chunk: string, push: (anchor: string, text: string) => void) => {
    for (const para of chunk.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      if (/^#+\s/.test(trimmed)) continue; // skip heading lines
      const am = trimmed.match(SENTENCE_ANCHOR_RE);
      if (!am) continue;
      push(am[1], trimmed.replace(SENTENCE_ANCHOR_RE, "").trim());
    }
  };

  const out: ParsedItem[] = [];
  let n = 0;
  if (headings.length === 0) {
    collectFrom(body, (anchor, text) => {
      n++;
      out.push({ id: anchor, num: n, text });
    });
  } else {
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
      collectFrom(body.slice(h.bodyStart, end), (anchor, text) => {
        n++;
        out.push({ id: anchor, num: n, text });
      });
    }
  }
  return out;
}

/** Format (A): `## N절 ^anchor` heading blocks. */
function parseLegacyVerses(body: string): ParsedItem[] {
  if (!body) return [];
  const headings: { num: number; id: string; start: number; bodyStart: number }[] = [];
  LEGACY_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEGACY_HEADING_RE.exec(body)) !== null) {
    headings.push({
      num: parseInt(m[1], 10),
      id: m[2],
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  const out: ParsedItem[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
    out.push({ id: h.id, num: h.num, text: body.slice(h.bodyStart, end).trim() });
  }
  return out;
}

function processVerseFile(opts: {
  scriptureSlug: string;
  scriptureName: string;
  fm: any;
  body: string;
  hierarchical: boolean;
}) {
  const { scriptureSlug, scriptureName, fm, body, hierarchical } = opts;
  const vol = hierarchical ? fm["권"] : undefined;
  const chap = hierarchical ? fm["장"] : undefined;
  if (hierarchical && (!vol || !chap)) return;

  // sentence-anchor first, fall back to legacy (mutually exclusive on same body)
  const sentenceItems = parseSentencesFlat(body);
  const items = sentenceItems.length > 0 ? sentenceItems : parseLegacyVerses(body);

  for (const item of items) {
    const verseId = item.id;
    const verseNum = item.num;
    const text = stripWikilinks(item.text);
    if (!text) continue;

    const id = hierarchical
      ? `scripture:${scriptureSlug}:${vol}:${chap}:${verseId}`
      : `scripture:${scriptureSlug}:${verseId}`;
    const href = hierarchical
      ? `/library/${scriptureSlug}/${vol}/${chap}/#${verseId}`
      : `/library/${scriptureSlug}/#${verseId}`;
    const title = hierarchical
      ? `${scriptureName} 권${vol} ${fm["권_이름"] ?? ""} ${chap}장 ^${verseId}`
      : `${scriptureName} ^${verseId}`;

    records.push({
      id,
      text,
      metadata: {
        kind: "scripture",
        title,
        href,
        snippet: snippet(text),
        scriptureSlug,
        ...(hierarchical ? { vol, chap, verse: verseNum } : { verse: verseNum }),
        verseId,
      },
    });
  }
}

for (const slug of readdirSync(scriptureRoot)) {
  const slugPath = join(scriptureRoot, slug);
  if (!statSync(slugPath).isDirectory()) continue;
  if (EXCLUDED_SCRIPTURE_SLUGS.has(slug)) continue; // 한글 백업본 제외

  // First pass: collect scripture display name from any file's frontmatter
  let scriptureName = slug;
  for (const item of readdirSync(slugPath)) {
    const itemPath = join(slugPath, item);
    if (!statSync(itemPath).isDirectory() && item.endsWith(".md")) {
      const { fm } = readMd(itemPath);
      if (fm.scripture) {
        scriptureName = fm.scripture;
        break;
      }
    }
  }

  // Second pass: process each .md (single file = preface/verses/afterword)
  // and each subdirectory (hierarchical chapter files like cheonjigaebyeokgyeong).
  for (const item of readdirSync(slugPath)) {
    const itemPath = join(slugPath, item);

    if (statSync(itemPath).isDirectory()) {
      // hierarchical 권 directory — chapters inside
      for (const fname of readdirSync(itemPath)) {
        if (!fname.endsWith(".md")) continue;
        const { fm, body } = readMd(join(itemPath, fname));
        processVerseFile({ scriptureSlug: slug, scriptureName, fm, body, hierarchical: true });
      }
      continue;
    }

    if (!item.endsWith(".md")) continue;
    const { fm, body } = readMd(itemPath);
    const type = fm.type;
    const isPreface = type === "preface" || fm.section === "preface";

    if (isPreface) {
      // 천지개벽경 서(序)는 본문 단락 끝에 인라인 `^preface-N` 문장 anchor 를
      // 가진다(마이그레이션 후). anchor 단위로 추출해 correspondence source 키
      // (`cheonjigaebyeokgyeong#preface-N`)를 보존. anchor 가 없는 서문
      // (동곡비서 등)은 본문 전체를 단일 record 로.
      const prefaceItems = parseSentencesFlat(body);
      if (prefaceItems.length > 0) {
        for (const item of prefaceItems) {
          const text = stripWikilinks(item.text);
          if (!text) continue;
          records.push({
            id: `scripture:${slug}:${item.id}`,
            text,
            metadata: {
              kind: "scripture",
              title: `${scriptureName} 서(序) ^${item.id}`,
              href: `/library/${slug}/preface/#${item.id}`,
              snippet: snippet(text),
              scriptureSlug: slug,
              verseId: item.id,
            },
          });
        }
      } else {
        const text = stripWikilinks(body);
        if (text) {
          records.push({
            id: `scripture:${slug}:preface`,
            text,
            metadata: {
              kind: "scripture",
              title: `${scriptureName} 서(序)`,
              href: `/library/${slug}/preface/`,
              snippet: snippet(text),
              scriptureSlug: slug,
            },
          });
        }
      }
    } else if (type === "verses") {
      processVerseFile({ scriptureSlug: slug, scriptureName, fm, body, hierarchical: false });
    } else if (type === "afterword") {
      // skip — publishing note, not a doctrinal verse
    } else if (fm["권"] || fm["장"]) {
      // legacy format: hierarchical chapter file at top level
      processVerseFile({ scriptureSlug: slug, scriptureName, fm, body, hierarchical: true });
    }
  }
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
        href: `/library/${kind}/${encodeURIComponent(slug)}/`,
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
  if (NO_UPLOAD) {
    console.log("no-upload: skipped Vectorize upsert (NDJSON written for downstream tools)");
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
