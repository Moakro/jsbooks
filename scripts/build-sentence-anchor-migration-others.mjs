#!/usr/bin/env node
/**
 * 동곡비서·화은당실기 절 anchor → 문장 anchor 마이그레이션의 후속 작업.
 * (천지개벽경판 = build-sentence-anchor-comment-migration.mjs)
 *
 * 입력:
 *   - 마이그레이션 후 markdown:
 *     · content/scripture/donggokbiseo/01_본문.md, 02_후기.md
 *     · content/scripture/hwaeundang-silgi/01_제1장.md … 08_제8장.md
 *   - 각 `## N절` 그룹의 첫 sentence anchor가 OLD 절 anchor에 대응.
 *
 * OLD anchor 형식 (마이그 전):
 *   · donggokbiseo: `^NNN` (zero-padded 3-digit, ## N절 → `^${pad3(N)}`)
 *   · hwaeundang-silgi: `^${장}-${절}` (frontmatter 장 + `## N절` → `^${장}-${N}`)
 *
 * 출력:
 *   - content/_data/sentence-anchor-mapping-{slug}.json — old → new dict (검수용)
 *   - comments-worker/migrations/2026-05-23-comment-anchor-mapping-others.sql
 *     · target_type='verse' 댓글의 target_id 를 (slug 와 별개로) OLD→NEW 갱신
 *     · 식별성 매핑(old===new) 은 SQL 에서 생략
 *
 * 사용법:
 *   node scripts/build-sentence-anchor-migration-others.mjs
 *
 * 운영 적용: 사용자가 검수 후 직접 `wrangler d1 execute --remote --file=...` 실행.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SQL_OUT = path.join(
  ROOT,
  "comments-worker/migrations/2026-05-23-comment-anchor-mapping-others.sql",
);

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

function pad3(n) {
  return String(n).padStart(3, "0");
}

/**
 * 슬러그별 OLD anchor 산출 규칙. fm: file frontmatter, headingNum: ## N절 의 N.
 * 반환: 마이그 전에 그 절이 가졌던 anchor (slug prefix 없이 ID 만).
 */
const OLD_ANCHOR_BUILDERS = {
  donggokbiseo: (_fm, headingNum) => pad3(headingNum),
  "hwaeundang-silgi": (fm, headingNum) => `${fm["장"]}-${headingNum}`,
};

const SLUGS = ["donggokbiseo", "hwaeundang-silgi"];

function deriveMappingForFile(slug, filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) return [];
  const { fm, body } = parsed;
  // preface/appendix 는 마이그 대상 X → 매핑 X
  if (fm.section === "preface" || fm.section === "appendix") return [];
  if (fm.type === "preface") return [];

  const buildOld = OLD_ANCHOR_BUILDERS[slug];
  if (!buildOld) return [];

  // `## N절` 헤딩 위치 수집.
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
    // 그룹 내 첫 sentence anchor 검출.
    let firstAnchor = null;
    for (const para of groupBody.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      if (/^#+\s/.test(trimmed)) continue;
      const am = trimmed.match(SENTENCE_ANCHOR_RE);
      if (am) {
        firstAnchor = am[1];
        break;
      }
    }
    if (!firstAnchor) continue;
    const oldAnchor = buildOld(fm, h.num);
    out.push({ oldAnchor, newAnchor: firstAnchor, file: filePath });
  }
  return out;
}

// 슬러그별 매핑 build.
const allMappings = {};
for (const slug of SLUGS) {
  const dir = path.join(ROOT, "content/scripture", slug);
  const entries = [];
  for (const f of findMarkdownFiles(dir)) {
    entries.push(...deriveMappingForFile(slug, f));
  }
  // 중복 OLD anchor 검사 (절대 일어나면 안 됨).
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.oldAnchor)) {
      console.error(
        `[${slug}] duplicate OLD anchor ${e.oldAnchor}: ${seen.get(e.oldAnchor).file} vs ${e.file}`,
      );
      process.exit(2);
    }
    seen.set(e.oldAnchor, e);
  }
  allMappings[slug] = entries;
}

// JSON 출력 (슬러그별 한 파일).
for (const slug of SLUGS) {
  const entries = allMappings[slug];
  const dict = {};
  for (const e of entries) dict[e.oldAnchor] = e.newAnchor;
  const jsonOut = path.join(ROOT, "content/_data", `sentence-anchor-mapping-${slug}.json`);
  const changed = entries.filter((e) => e.oldAnchor !== e.newAnchor).length;
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scripture: slug,
        description: `OLD verse anchor → NEW first-sentence anchor for ${slug} sentence-anchor migration.`,
        total: entries.length,
        changed,
        identical: entries.length - changed,
        mapping: dict,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[${slug}] mapping JSON: ${path.relative(ROOT, jsonOut)} — ${entries.length} entries (changed: ${changed})`,
  );
}

// 합본 SQL.
// 모든 slug 에 대해 변경 매핑만 emit (identity 생략).
// 댓글 target_id 는 slug prefix 없는 raw anchor 이므로 모든 slug 의 OLD→NEW 가 같은
// 네임스페이스에 섞여있다. 충돌 가능성 검사 후 prefix 트릭으로 안전 보장.
const TMP_PREFIX = "__m2__";
const PASS2_CHUNK = 200;

// 전 slug 변경 매핑 평탄화.
const allChanged = [];
for (const slug of SLUGS) {
  for (const e of allMappings[slug]) {
    if (e.oldAnchor !== e.newAnchor) {
      allChanged.push({ slug, oldAnchor: e.oldAnchor, newAnchor: e.newAnchor });
    }
  }
}

// raw target_id 네임스페이스에서 OLD 중복 검사 (다른 slug 가 같은 anchor 사용 시 경고).
const rawOldSeen = new Map();
for (const e of allChanged) {
  if (rawOldSeen.has(e.oldAnchor)) {
    const prev = rawOldSeen.get(e.oldAnchor);
    console.error(
      `[warning] cross-slug OLD anchor collision on raw target_id "${e.oldAnchor}" — ${prev.slug}:${prev.newAnchor} vs ${e.slug}:${e.newAnchor}.`,
    );
    console.error(
      `  D1 댓글 target_id 만으로는 두 경전 구분 불가. comments-worker DB 에서 OLD anchor 별 row 수 확인 후 별도 처리 필요할 수 있음.`,
    );
  }
  rawOldSeen.set(e.oldAnchor, e);
}

const lines = [];
lines.push(
  "-- Migrate verse-anchor comments to sentence-anchor for 동곡비서·화은당실기.",
  "--",
  "-- Background: 두 경전의 markdown 절 anchor 가 문장 anchor 로 마이그됐다.",
  "--   · 동곡비서: `^NNN` (3-digit) → `^1-1-K` (단일 권/장 평면)",
  "--   · 화은당실기: `^장-절` → `^1-장-K` (장별 카운터)",
  "-- target_type='verse' 댓글의 target_id 는 OLD anchor 그대로이므로, 각 절 그룹의",
  "-- 첫 문장 anchor 로 remap 한다.",
  "--",
  "-- Scope: target_type='verse' 만 갱신. identity (old===new) 는 생략.",
  "--",
  `-- Strategy: 천지개벽경 마이그와 동일한 prefix '${TMP_PREFIX}' 두-패스. Pass 1 으로`,
  "-- 모든 OLD anchor 에 prefix 를 붙여 어떤 OLD/NEW key 와도 충돌하지 않게 한 뒤,",
  "-- Pass 2 청크로 final NEW anchor 로 rename.",
  "--",
  "-- Caveat: target_id 만으로는 source scripture 구분 불가. 두 경전이 raw anchor 를",
  "-- 공유하는 경우 (예: 화은당 `1-1` 와 가상의 다른 경전 `1-1`) 분리 처리 필요.",
  "-- comments-worker 의 target_type='verse' 댓글이 실제로 없으면 (이 마이그 시점에",
  "-- 공개 UI 는 verse 댓글을 거의 사용하지 않음) 적용은 안전한 no-op 에 가깝다.",
  "--",
  "-- Apply once against the live D1 DB:",
  "--   wrangler d1 execute jsbooks-db --remote --file=comments-worker/migrations/2026-05-23-comment-anchor-mapping-others.sql",
  "--",
  "-- Pre-flight (recommended):",
  "--   wrangler d1 execute jsbooks-db --remote --command \\",
  "--     \"SELECT target_id, COUNT(*) FROM comments WHERE target_type='verse' GROUP BY target_id;\"",
  "--",
  `-- Generated at: ${new Date().toISOString()}`,
  `-- Total changed mappings: ${allChanged.length}`,
  "",
);

if (allChanged.length === 0) {
  lines.push("-- (no anchor changes — all OLD anchors already match NEW; SQL is a no-op)");
  lines.push("");
} else {
  lines.push("BEGIN TRANSACTION;");
  lines.push("");
  lines.push("-- ─── Pass 1: prefix OLD anchors so they no longer collide with any anchor key.");
  const oldList = allChanged.map((e) => `'${e.oldAnchor}'`).join(", ");
  lines.push(
    `UPDATE comments SET target_id = '${TMP_PREFIX}' || target_id`,
    `WHERE target_type = 'verse' AND target_id IN (${oldList});`,
    "",
    "-- ─── Pass 2: rename each prefixed value to its NEW anchor (chunked).",
  );

  for (let i = 0; i < allChanged.length; i += PASS2_CHUNK) {
    const batch = allChanged.slice(i, i + PASS2_CHUNK);
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
}

fs.writeFileSync(SQL_OUT, lines.join("\n"));
console.log(`SQL migration: ${path.relative(ROOT, SQL_OUT)} — ${allChanged.length} changed mappings`);
