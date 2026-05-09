#!/usr/bin/env node
/**
 * 천지개벽경 절 anchor → 문장 anchor 마이그레이션의 댓글 후속 작업.
 *
 * 입력:
 *   - 마이그레이션 후 markdown (content/scripture/cheonjigaebyeokgyeong/**)
 *   - 각 `## N절` 그룹의 첫 sentence anchor가 OLD 절 anchor `vol-chap-N`(또는 `preface-N`)에 대응
 *
 * 출력:
 *   - comments-worker/migrations/2026-05-08-comment-anchor-mapping.sql
 *     · target_type='verse'인 댓글의 target_id를 OLD → NEW로 갱신하는 UPDATE 문
 *     · 식별성(identity) 매핑은 생략 (변경이 일어나는 anchor만 emit)
 *   - content/_data/sentence-anchor-comment-mapping.json
 *     · old_anchor → new_anchor 매핑 dictionary (검수용)
 *
 * 사용법:
 *   node scripts/build-sentence-anchor-comment-migration.mjs
 *
 * 실행 시점: 한 번 검수 후 사용자가 직접 wrangler d1 execute로 적용.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPTURE_DIR = path.join(ROOT, "content/scripture/cheonjigaebyeokgyeong");
const SQL_OUT = path.join(
  ROOT,
  "comments-worker/migrations/2026-05-08-comment-anchor-mapping.sql",
);
const JSON_OUT = path.join(ROOT, "content/_data/sentence-anchor-comment-mapping.json");

const GROUP_HEADING_RE = /^## (\d+)절\s*$/gm;
const SENTENCE_ANCHOR_RE = /\s+\^([\w-]+)\s*$/;

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const [, raw, body] = m;
  const fm = {};
  for (const line of raw.split("\n")) {
    const km = line.match(/^([^:]+):\s*(.*)$/);
    if (km) fm[km[1].trim()] = km[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fm, body };
}

function findMarkdownFiles(dir) {
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...findMarkdownFiles(full));
    else if (e.name.endsWith(".md")) files.push(full);
  }
  return files.sort();
}

/**
 * For one chapter file, return mapping entries: each `## N절` group →
 * its first sentence anchor.
 *
 * Result entries: { oldAnchor, newAnchor, file }
 */
function deriveChapterMapping(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) return [];
  const { fm, body } = parsed;
  if (fm.canonical !== "true") return [];

  const isPreface = fm.section === "preface";
  if (!isPreface && (!fm["권"] || !fm["장"])) return [];

  const prefix = isPreface ? "preface" : `${fm["권"]}-${fm["장"]}`;

  // Parse `## N절` groups and their sentence anchors.
  const headings = [];
  GROUP_HEADING_RE.lastIndex = 0;
  let m;
  while ((m = GROUP_HEADING_RE.exec(body)) !== null) {
    headings.push({
      num: parseInt(m[1], 10),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }

  const out = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
    const groupBody = body.slice(h.bodyStart, end);
    let firstAnchor = null;
    for (const para of groupBody.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const am = trimmed.match(SENTENCE_ANCHOR_RE);
      if (am) {
        firstAnchor = am[1];
        break;
      }
    }
    if (!firstAnchor) continue;
    const oldAnchor = `${prefix}-${h.num}`;
    out.push({ oldAnchor, newAnchor: firstAnchor, file: filePath });
  }
  return out;
}

// ── Build ────────────────────────────────────────────────────────────────
const files = findMarkdownFiles(SCRIPTURE_DIR);
const allEntries = [];
for (const f of files) {
  for (const e of deriveChapterMapping(f)) allEntries.push(e);
}

// Detect duplicates / collisions (same OLD anchor appearing twice — should not happen).
const byOld = new Map();
for (const e of allEntries) {
  if (byOld.has(e.oldAnchor)) {
    console.error(
      `[error] duplicate OLD anchor ${e.oldAnchor}:\n  - ${byOld.get(e.oldAnchor).file}\n  - ${e.file}`,
    );
    process.exit(2);
  }
  byOld.set(e.oldAnchor, e);
}

// Identity mappings (oldAnchor === newAnchor) — those are no-ops, skip in SQL.
const changed = allEntries.filter((e) => e.oldAnchor !== e.newAnchor);
const identical = allEntries.length - changed.length;

// ── Emit JSON dictionary (full, for review) ──────────────────────────────
const dict = {};
for (const e of allEntries) dict[e.oldAnchor] = e.newAnchor;
fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
fs.writeFileSync(
  JSON_OUT,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      scripture: "cheonjigaebyeokgyeong",
      description:
        "OLD verse anchor (vol-chap-N or preface-N) → NEW first-sentence anchor of the corresponding `## N절` group, after the sentence-anchor migration.",
      total: allEntries.length,
      changed: changed.length,
      identical,
      mapping: dict,
    },
    null,
    2,
  ) + "\n",
);

// ── Emit SQL migration ───────────────────────────────────────────────────
//
// Two-pass migration to guarantee correctness:
//
//   Pass 1: prefix every OLD anchor with `__m__` so the row no longer
//           matches any anchor key (OLD or NEW).
//   Pass 2: rename each `__m__<old>` to its final NEW anchor, chunked.
//
// A single-pass per-anchor UPDATE would cascade (renamed rows re-matched
// by later statements). A single-pass CASE could collide across chunks
// when a NEW anchor in chunk K equals an OLD anchor in chunk K+1. The
// prefix approach is immune to both.
const TMP_PREFIX = "__m__";
const PASS2_CHUNK = 200;
const lines = [];
lines.push(
  "-- Migrate verse-anchor comments to sentence-anchor for 천지개벽경.",
  "--",
  "-- Background: the markdown was migrated from `## N절 ^vol-chap-N` (one anchor",
  "-- per verse) to per-sentence `^vol-chap-K` anchors. Comments stored with the",
  "-- OLD verse anchor must be remapped to the NEW first-sentence anchor of the",
  "-- corresponding group (so the comment lands on the same `## N절` it was",
  "-- originally written against).",
  "--",
  "-- Scope: only `target_type='verse'` rows are touched. Identity mappings",
  "-- (anchors unchanged because the verse had a single sentence) are omitted.",
  "--",
  `-- Strategy: two-pass via the temporary prefix '${TMP_PREFIX}'. Pass 1 stamps`,
  "-- every OLD anchor with the prefix so rows can no longer match either an OLD",
  "-- or a NEW anchor key. Pass 2 renames each prefixed value to its final NEW",
  "-- anchor. This avoids both intra-pass cascades (statement N renaming row,",
  "-- statement N+1 re-matching it) and inter-chunk collisions where a NEW value",
  "-- written in chunk K equals an OLD key in chunk K+1.",
  "--",
  "-- Caveat: target_id alone does not encode the source scripture. The 한글본",
  "-- 백업 (cheonjigaebyeokgyeong-hangeul) shares the 권-장-N anchor format and",
  "-- was NOT migrated. As of this migration the public UI only posts comments",
  "-- with target_type='chapter'/'preface' (not 'verse'), so the practical",
  "-- ambiguity is expected to be zero. If verse-typed comments on the 한글본",
  "-- exist, run a SELECT first and scope the UPDATE accordingly.",
  "--",
  "-- Apply once against the live D1 DB:",
  "--   wrangler d1 execute jsbooks-db --remote --file=comments-worker/migrations/2026-05-08-comment-anchor-mapping.sql",
  "--",
  "-- Pre-flight (recommended):",
  "--   wrangler d1 execute jsbooks-db --remote --command \\",
  "--     \"SELECT target_id, COUNT(*) FROM comments WHERE target_type='verse' GROUP BY target_id;\"",
  "--",
  "-- Post-flight sanity check (must return zero rows):",
  "--   wrangler d1 execute jsbooks-db --remote --command \\",
  `--     "SELECT COUNT(*) FROM comments WHERE target_type='verse' AND target_id LIKE '${TMP_PREFIX}%';"`,
  "--",
  `-- Generated at: ${new Date().toISOString()}`,
  `-- Total mappings: ${allEntries.length} (changed: ${changed.length}, identity: ${identical})`,
  "",
  "BEGIN TRANSACTION;",
  "",
  "-- ─── Pass 1: prefix OLD anchors so they no longer collide with any anchor key.",
);

const oldList = changed.map((e) => `'${e.oldAnchor}'`).join(", ");
lines.push(
  `UPDATE comments SET target_id = '${TMP_PREFIX}' || target_id`,
  `WHERE target_type = 'verse' AND target_id IN (${oldList});`,
  "",
  "-- ─── Pass 2: rename each prefixed value to its NEW anchor (chunked).",
);

for (let i = 0; i < changed.length; i += PASS2_CHUNK) {
  const batch = changed.slice(i, i + PASS2_CHUNK);
  const inList = batch.map((e) => `'${TMP_PREFIX}${e.oldAnchor}'`).join(", ");
  lines.push(
    `-- Pass-2 batch ${Math.floor(i / PASS2_CHUNK) + 1} (${batch.length} mappings)`,
  );
  lines.push("UPDATE comments SET");
  lines.push("  target_id = CASE target_id");
  for (const e of batch) {
    lines.push(`    WHEN '${TMP_PREFIX}${e.oldAnchor}' THEN '${e.newAnchor}'`);
  }
  lines.push("    ELSE target_id");
  lines.push("  END,");
  lines.push("  updated_at = datetime('now')");
  lines.push(`WHERE target_type = 'verse' AND target_id IN (${inList});`);
  lines.push("");
}

lines.push("COMMIT;", "");

fs.writeFileSync(SQL_OUT, lines.join("\n"));

console.log(`Mapping JSON: ${path.relative(ROOT, JSON_OUT)}`);
console.log(`SQL migration: ${path.relative(ROOT, SQL_OUT)}`);
console.log(
  `Entries: ${allEntries.length} total / ${changed.length} requiring UPDATE / ${identical} identity`,
);
