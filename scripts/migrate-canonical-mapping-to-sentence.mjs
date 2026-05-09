#!/usr/bin/env node
/**
 * canonical-mapping JSON 절 단위 → 문장 단위 마이그레이션.
 *
 * 입력:
 *   - 옛 mapping: content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json
 *     키: 한자 절 anchor (vol-chap-N), value.hangeul: 한글 백업 anchor 배열 (대부분 1개)
 *   - 한자 본문 (문장 단위 anchor): content/scripture/cheonjigaebyeokgyeong/**.md
 *     `## N절` 그룹 안에 sentence anchor (^vol-chap-K) 1개 이상
 *   - 한글 백업: content/scripture/cheonjigaebyeokgyeong-hangeul/**.md
 *     `## N절 ^vol-chap-N` 형식 그대로 (마이그레이션 X)
 *
 * 출력:
 *   - 새 mapping JSON (옛 위치 덮어쓰기, 작업 전 .bak 백업)
 *     키: 한자 sentence anchor, value.hangeul: 한글 텍스트 string (1개)
 *   - 검수 큐: content/_data/canonical-mapping-review-queue.md
 *     1:N / N:1 / 한글 누락 케이스 모두 나열
 *
 * 매핑 알고리즘:
 *   각 옛 절 anchor `vol-chap-N`에 대해:
 *     1. 그 절의 새 sentence anchor 목록 가져오기 (그룹 N의 모든 문장 anchor)
 *     2. 옛 매핑의 한글 백업 anchor → 텍스트 (한글 백업 markdown 파싱)
 *     3. 그 텍스트를 마침표/?/! 단위로 split
 *     4. 한자 sentence 수 == 한글 sentence 수 → 1:1 매핑
 *        그 외 → 첫 한자 sentence에만 전체 한글 텍스트, 나머지 빈 string + 검수 큐
 *
 * 사용법:
 *   node scripts/migrate-canonical-mapping-to-sentence.mjs --dry-run
 *   node scripts/migrate-canonical-mapping-to-sentence.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VAULT = process.env.VAULT_PATH || path.join(ROOT, "content");
const HANJA_DIR = path.join(VAULT, "scripture/cheonjigaebyeokgyeong");
const HANGEUL_DIR = path.join(VAULT, "scripture/cheonjigaebyeokgyeong-hangeul");
const MAPPING_PATH = path.join(VAULT, "scripture/_mappings/cheonjigaebyeokgyeong-canonical.json");
const REVIEW_QUEUE_PATH = path.join(VAULT, "_data/canonical-mapping-review-queue.md");

const isDryRun = process.argv.includes("--dry-run");

const GROUP_HEADING_RE = /^## (\d+)절\s*$/gm;
const VERSE_HEADING_WITH_ANCHOR_RE = /^## (\d+)절 \^(\S+)[^\n]*$/gm;
const SENTENCE_ANCHOR_RE = /\s+\^([\w-]+)\s*$/;

// ─── frontmatter / file walk ─────────────────────────────────────────────
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

function findMarkdown(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...findMarkdown(full));
    else if (e.name.endsWith(".md")) files.push(full);
  }
  return files.sort();
}

// ─── 한자 본문 → 그룹별 sentence anchor 목록 ─────────────────────────────
/**
 * 결과: { [anchorPrefix]: { [groupNum]: string[] } }
 * 예: { "2-6": { 1: ["2-6-1", "2-6-2", "2-6-3"], 2: ["2-6-4"], ... } }
 */
function buildHanjaGroupIndex() {
  const index = {};
  for (const f of findMarkdown(HANJA_DIR)) {
    const content = fs.readFileSync(f, "utf-8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;
    const { fm, body } = parsed;
    if (fm.canonical !== "true") continue;
    const isPreface = fm.section === "preface";
    if (!isPreface && (!fm["권"] || !fm["장"])) continue;
    const prefix = isPreface ? "preface" : `${fm["권"]}-${fm["장"]}`;

    const headings = [];
    GROUP_HEADING_RE.lastIndex = 0;
    let m;
    while ((m = GROUP_HEADING_RE.exec(body)) !== null) {
      headings.push({ num: parseInt(m[1], 10), start: m.index, bodyStart: m.index + m[0].length });
    }
    const groupMap = {};
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
      const groupBody = body.slice(h.bodyStart, end);
      const anchors = [];
      for (const para of groupBody.split(/\n\s*\n/)) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const am = trimmed.match(SENTENCE_ANCHOR_RE);
        if (am) anchors.push(am[1]);
      }
      if (anchors.length) groupMap[h.num] = anchors;
    }
    index[prefix] = groupMap;
  }
  return index;
}

// ─── 한글 백업 → anchor → 텍스트 ─────────────────────────────────────────
function buildHangeulIndex() {
  const index = {};
  for (const f of findMarkdown(HANGEUL_DIR)) {
    const content = fs.readFileSync(f, "utf-8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;
    const { body } = parsed;
    // `## N절 ^anchor` headings + paragraph body until next heading.
    const headings = [];
    VERSE_HEADING_WITH_ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = VERSE_HEADING_WITH_ANCHOR_RE.exec(body)) !== null) {
      headings.push({ id: m[2], start: m.index, bodyStart: m.index + m[0].length });
    }
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
      const text = body.slice(h.bodyStart, end).trim();
      if (text) index[h.id] = text;
    }
  }
  return index;
}

// ─── sentence split (한글) ───────────────────────────────────────────────
// 마침표/?/! 기준. 따옴표·괄호 안 마침표는 분할 X (가장 보수적).
function splitHangeulSentences(text) {
  if (!text) return [];
  const out = [];
  let buf = "";
  let depth = 0; // 따옴표·괄호 depth (간이 추적)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (ch === "(" || ch === "[" || ch === "{" || ch === "「") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === "」") depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    if (ch === "." || ch === "?" || ch === "!") {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        const s = buf.trim();
        if (s) out.push(s);
        buf = "";
        while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

// ─── main ────────────────────────────────────────────────────────────────
const oldMapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf-8"));
const hanjaIndex = buildHanjaGroupIndex();
const hangeulText = buildHangeulIndex();

const newVerses = {};
const reviewItems = [];
const stats = {
  oldEntries: Object.keys(oldMapping.verses).length,
  newEntries: 0,
  oneToOne: 0,
  oneToManyHanja: 0, // 한자 1 → 한글 N (한자가 sentence 1개일 때 한글이 여러 sentence)
  manyToOneHanja: 0, // 한자 N → 한글 1 또는 한자 N → 한글 M (M<N)
  hangeulMissing: 0,
  hangeulNotFound: 0,
  unmatchedOldKeys: [],
};

for (const [oldAnchor, oldEntry] of Object.entries(oldMapping.verses)) {
  // oldAnchor 예: "2-6-3" 또는 "preface-3" → prefix·groupNum 추출
  let prefix, groupNum;
  const prefM = oldAnchor.match(/^preface-(\d+)$/);
  const verseM = oldAnchor.match(/^(\d+)-(\d+)-(\d+)$/);
  if (prefM) {
    prefix = "preface";
    groupNum = parseInt(prefM[1], 10);
  } else if (verseM) {
    prefix = `${verseM[1]}-${verseM[2]}`;
    groupNum = parseInt(verseM[3], 10);
  } else {
    stats.unmatchedOldKeys.push(oldAnchor);
    continue;
  }

  const newAnchors = hanjaIndex[prefix]?.[groupNum];
  if (!newAnchors || newAnchors.length === 0) {
    stats.unmatchedOldKeys.push(oldAnchor);
    reviewItems.push({
      type: "no-hanja-group",
      oldAnchor,
      detail: `한자 본문에서 ${prefix} 그룹 ${groupNum}를 못 찾았습니다.`,
    });
    continue;
  }

  const hangeulAnchors = Array.isArray(oldEntry.hangeul) ? oldEntry.hangeul : [];
  // 한글 anchor list → 텍스트 합본 (대부분 1개라 한 글자 차이 없음).
  const hangeulPieces = [];
  const missingHangeul = [];
  for (const ha of hangeulAnchors) {
    const t = hangeulText[ha];
    if (t) hangeulPieces.push(t);
    else missingHangeul.push(ha);
  }
  const hangeulCombined = hangeulPieces.join("\n\n").trim();

  if (!hangeulCombined) {
    stats.hangeulMissing++;
    if (missingHangeul.length) {
      stats.hangeulNotFound++;
      reviewItems.push({
        type: "hangeul-not-found",
        oldAnchor,
        newAnchors,
        detail: `한글 백업 anchor [${missingHangeul.join(", ")}] 텍스트를 찾지 못했습니다.`,
      });
    } else {
      reviewItems.push({
        type: "hangeul-empty",
        oldAnchor,
        newAnchors,
        detail: "옛 매핑에 한글 anchor가 없거나 빈 배열이었습니다.",
      });
    }
    // 빈 string으로 저장
    for (const a of newAnchors) {
      newVerses[a] = { hangeul: "", reviewed: false };
    }
    continue;
  }

  const sentences = splitHangeulSentences(hangeulCombined);

  if (sentences.length === newAnchors.length) {
    // 1:1
    sentences.forEach((s, i) => {
      newVerses[newAnchors[i]] = {
        hangeul: s,
        reviewed: !!oldEntry.reviewed,
        ...(oldEntry.confidence != null ? { confidence: oldEntry.confidence } : {}),
      };
    });
    stats.oneToOne += newAnchors.length;
  } else {
    // 개수 불일치 → 첫 한자 sentence에 전체 한글 텍스트, 나머지 빈 string. reviewed=false.
    if (newAnchors.length > sentences.length) stats.manyToOneHanja++;
    else stats.oneToManyHanja++;
    newAnchors.forEach((a, i) => {
      newVerses[a] = {
        hangeul: i === 0 ? hangeulCombined : "",
        reviewed: false,
      };
    });
    reviewItems.push({
      type: newAnchors.length > sentences.length ? "many-to-one" : "one-to-many",
      oldAnchor,
      newAnchors,
      detail: `한자 ${newAnchors.length}문장 ↔ 한글 ${sentences.length}문장. 첫 anchor에만 합본 매핑, 나머지는 빈 string + 미검수.`,
      hangeulCombined,
      hangeulSentences: sentences,
    });
  }
}

// 한자 sentence anchor 중에 옛 매핑에 없던 것들도 빈 string으로 등록 (보강 분리 등).
let unmatchedHanjaCount = 0;
for (const [prefix, groups] of Object.entries(hanjaIndex)) {
  for (const [groupNum, anchors] of Object.entries(groups)) {
    for (const a of anchors) {
      if (!(a in newVerses)) {
        newVerses[a] = { hangeul: "", reviewed: false };
        unmatchedHanjaCount++;
        reviewItems.push({
          type: "new-hanja-anchor",
          newAnchor: a,
          detail: `옛 매핑에 매칭되는 키가 없는 새 sentence anchor (그룹 ${groupNum} 내 보강 분리 sentence 등). 빈 string으로 초기화.`,
        });
      }
    }
  }
}
stats.newEntries = Object.keys(newVerses).length;
stats.unmatchedNewHanja = unmatchedHanjaCount;

// ─── 백업 + 새 mapping 저장 ──────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(VAULT, ".bak", `canonical-mapping-${ts}`);

const newMapping = {
  ...oldMapping,
  version: 2,
  schema: "sentence-anchor",
  description:
    "Maps each 한자 sentence anchor (canonical) to its embedded 한글 sentence text. v2: per-sentence string instead of legacy per-verse anchor array.",
  verses: newVerses,
};

if (isDryRun) {
  console.log("[dry-run] 마이그레이션 결과 (저장 X):");
} else {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(MAPPING_PATH, path.join(backupDir, "cheonjigaebyeokgyeong-canonical.json"));
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(newMapping, null, 2) + "\n");
  console.log(`Backup: ${path.relative(ROOT, backupDir)}`);
  console.log(`Wrote:  ${path.relative(ROOT, MAPPING_PATH)}`);
}

// ─── 검수 큐 markdown ────────────────────────────────────────────────────
{
  const lines = [];
  lines.push(
    "# 천지개벽경 canonical-mapping 마이그레이션 — 검수 큐",
    "",
    `생성일: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "v1(절 단위) → v2(문장 단위) 자동 변환 결과 중 사람 검수가 필요한 항목.",
    "",
    "## 통계",
    "",
    `- 옛 절 매핑 entry: ${stats.oldEntries}`,
    `- 새 sentence anchor entry: ${stats.newEntries}`,
    `- 1:1 자동 매핑된 sentence: ${stats.oneToOne}`,
    `- 한자 ${"1"} ↔ 한글 N (one-to-many): ${stats.oneToManyHanja}건의 옛 절`,
    `- 한자 N ↔ 한글 ${"1 or M<N"} (many-to-one): ${stats.manyToOneHanja}건의 옛 절`,
    `- 한글 텍스트 누락 (옛 매핑에 한글 X): ${stats.hangeulMissing}건`,
    `- 한글 백업 anchor 텍스트 못 찾음: ${stats.hangeulNotFound}건`,
    `- 옛 매핑에 없던 새 sentence anchor (빈 string 초기화): ${stats.unmatchedNewHanja}건`,
    `- 매칭 실패한 옛 키: ${stats.unmatchedOldKeys.length}건`,
    "",
    "## 검수 가이드",
    "",
    "- **one-to-many / many-to-one**: 한자 본문 분할 수와 한글 본문 분할 수가 다름. 첫 anchor에만 합본 매핑, 나머지 빈 string. → admin 도구에서 직접 한글 sentence를 나눠 입력.",
    "- **new-hanja-anchor**: 마침표 보강으로 새로 분리된 sentence이거나 옛 매핑에 없던 것. 한글 입력 필요.",
    "- **hangeul-not-found / hangeul-empty**: 옛 매핑이 손상되었거나 한글 백업 anchor 자체가 비었음. 한글본 markdown 직접 보강.",
    "",
  );

  const grouped = {
    "many-to-one": [],
    "one-to-many": [],
    "hangeul-not-found": [],
    "hangeul-empty": [],
    "new-hanja-anchor": [],
    "no-hanja-group": [],
  };
  for (const r of reviewItems) (grouped[r.type] ?? (grouped[r.type] = [])).push(r);

  const titleFor = {
    "many-to-one": "한자 N ↔ 한글 1 (한글 더 짧음)",
    "one-to-many": "한자 1 ↔ 한글 N (한글 더 김)",
    "hangeul-not-found": "한글 백업 anchor 텍스트 미발견",
    "hangeul-empty": "한글 매핑 자체가 비어 있음",
    "new-hanja-anchor": "옛 매핑에 없던 새 sentence anchor",
    "no-hanja-group": "한자 본문에서 그룹을 못 찾음",
  };

  for (const [type, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    lines.push(`## ${titleFor[type] ?? type} (${items.length})`, "");
    for (const r of items) {
      if (r.oldAnchor) {
        lines.push(`### ^${r.oldAnchor}${r.newAnchors ? ` → [${r.newAnchors.map((a) => "^" + a).join(", ")}]` : ""}`);
      } else {
        lines.push(`### ^${r.newAnchor}`);
      }
      lines.push("");
      lines.push(`- ${r.detail}`);
      if (r.hangeulCombined) {
        lines.push(`- 한글 합본:`);
        lines.push(`  > ${r.hangeulCombined.replace(/\n/g, " ")}`);
      }
      if (r.hangeulSentences) {
        lines.push(`- 한글 분할 (${r.hangeulSentences.length}문장):`);
        r.hangeulSentences.forEach((s, i) => {
          lines.push(`  ${i + 1}. ${s}`);
        });
      }
      lines.push("");
    }
  }

  if (isDryRun) {
    console.log(`[dry-run] 검수 큐 ${reviewItems.length}건 생성 (저장 X)`);
  } else {
    fs.mkdirSync(path.dirname(REVIEW_QUEUE_PATH), { recursive: true });
    fs.writeFileSync(REVIEW_QUEUE_PATH, lines.join("\n") + "\n");
    console.log(`Review queue: ${path.relative(ROOT, REVIEW_QUEUE_PATH)} (${reviewItems.length}건)`);
  }
}

// ─── stats summary ───────────────────────────────────────────────────────
console.log(`\n=== Summary ===`);
console.log(`옛 절 매핑 entry: ${stats.oldEntries}`);
console.log(`새 sentence anchor entry: ${stats.newEntries}`);
console.log(`1:1 자동 매핑: ${stats.oneToOne} sentence`);
console.log(`one-to-many: ${stats.oneToManyHanja}건의 옛 절`);
console.log(`many-to-one: ${stats.manyToOneHanja}건의 옛 절`);
console.log(`한글 누락: ${stats.hangeulMissing}건 (백업 anchor 못 찾음 ${stats.hangeulNotFound}건 포함)`);
console.log(`옛 매핑에 없던 새 sentence anchor: ${stats.unmatchedNewHanja}건`);
console.log(`매칭 실패한 옛 키: ${stats.unmatchedOldKeys.length}건`);
console.log(`검수 큐 항목: ${reviewItems.length}건`);
