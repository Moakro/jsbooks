#!/usr/bin/env node
/**
 * resplit-sentence-anchors.mjs가 만든 remap을 v2 canonical-mapping에 적용.
 *
 * 입력:
 *   - content/_data/sentence-anchor-resplit-remap.json
 *     (oldToNews, newToOlds dict)
 *   - content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json (v2)
 *
 * 출력:
 *   - 같은 mapping JSON 덮어쓰기 (백업 자동)
 *   - content/_data/canonical-mapping-review-queue.md 갱신
 *
 * 매핑 규칙:
 *   case A (N OLD → 1 NEW, ? 합쳐짐):
 *     newAnchor.hangeul = OLDs의 hangeul을 순서대로 합본 (빈 string 스킵).
 *     reviewed = 모든 OLD가 reviewed=true일 때만 true.
 *   case B (1 OLD → N NEW, 단계 5 마침표 분할):
 *     첫 NEW에 OLD의 hangeul 그대로 / 나머지 NEW는 빈 string.
 *     모두 reviewed=false → 검수 큐.
 *   case C (1 OLD → 1 NEW, 단순 변경 또는 ID 유지):
 *     hangeul·reviewed 그대로 이전.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VAULT = process.env.VAULT_PATH || path.join(ROOT, "content");
const REMAP_PATH = path.join(VAULT, "_data/sentence-anchor-resplit-remap.json");
const MAPPING_PATH = path.join(VAULT, "scripture/_mappings/cheonjigaebyeokgyeong-canonical.json");
const REVIEW_QUEUE_PATH = path.join(VAULT, "_data/canonical-mapping-review-queue.md");
const HANJA_DIR = path.join(VAULT, "scripture/cheonjigaebyeokgyeong");

const isDryRun = process.argv.includes("--dry-run");

// ── 한자 본문에서 NEW 그룹 → sentence anchor list 빌드 (검수 큐 표시용) ──
const SENTENCE_ANCHOR_RE = /\s+\^([\w-]+)\s*$/;
const GROUP_HEADING_RE = /^## (\d+)절\s*$/gm;

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
function findMd(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findMd(f));
    else if (e.name.endsWith(".md")) out.push(f);
  }
  return out.sort();
}
function buildHanjaIndex() {
  // 결과: anchor → text. 추가로 newAnchorOrder (등장 순서, file-grouped).
  const text = {};
  const order = []; // 그룹 안 sentence 순서대로 anchor만 모은 list (chapter file당 reset)
  for (const f of findMd(HANJA_DIR).sort()) {
    const c = fs.readFileSync(f, "utf-8");
    const parsed = parseFrontmatter(c);
    if (!parsed) continue;
    const { fm, body } = parsed;
    if (fm.canonical !== "true") continue;
    const headings = [];
    GROUP_HEADING_RE.lastIndex = 0;
    let m;
    while ((m = GROUP_HEADING_RE.exec(body)) !== null) {
      headings.push({ start: m.index, bodyStart: m.index + m[0].length });
    }
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
      const groupBody = body.slice(h.bodyStart, end);
      for (const para of groupBody.split(/\n\s*\n/)) {
        const t = para.trim();
        if (!t) continue;
        const am = t.match(SENTENCE_ANCHOR_RE);
        if (!am) continue;
        const id = am[1];
        const sentence = t.replace(SENTENCE_ANCHOR_RE, "").trim();
        text[id] = sentence;
        order.push(id);
      }
    }
  }
  return { text, order };
}

// ── load inputs ──────────────────────────────────────────────────────────
const remap = JSON.parse(fs.readFileSync(REMAP_PATH, "utf-8"));
const oldMapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf-8"));
if (oldMapping.version !== 2) {
  console.error(
    `[error] Expected v2 mapping (sentence-string), got version=${oldMapping.version}.`,
  );
  process.exit(2);
}
const { text: hanjaText, order: newAnchorOrder } = buildHanjaIndex();

const oldToNews = remap.oldToNews;
const newToOlds = remap.newToOlds;

// ── derive new mapping ───────────────────────────────────────────────────
const newVerses = {};
const reviewItems = [];
const stats = {
  total: 0,
  caseA_merged: 0,
  caseB_split: 0,
  caseC_identity: 0,
  caseC_renumbered: 0,
  newAnchorsNotInRemap: 0,
};

// 단계 5 마침표 분할로 1-OLD-N-NEW가 발생한 OLD 집합 (review queue + reviewed=false)
const splitOldSet = new Set(
  Object.entries(oldToNews)
    .filter(([, news]) => news.length > 1)
    .map(([old]) => old),
);

for (const newAnchor of newAnchorOrder) {
  stats.total++;
  const olds = newToOlds[newAnchor] ?? [];
  if (olds.length === 0) {
    // remap에 없는 NEW anchor — 비정상 (markdown은 있는데 remap 누락). 빈 매핑.
    stats.newAnchorsNotInRemap++;
    newVerses[newAnchor] = { hangeul: "", reviewed: false };
    reviewItems.push({
      type: "missing-remap",
      newAnchor,
      detail: "remap에 매칭되는 OLD anchor가 없습니다. 빈 매핑으로 초기화.",
    });
    continue;
  }

  if (olds.length > 1) {
    // case A — N OLD → 1 NEW (□ 합쳐짐)
    const pieces = [];
    let allReviewed = true;
    for (const old of olds) {
      const oldM = oldMapping.verses[old];
      if (!oldM) {
        allReviewed = false;
        continue;
      }
      if (oldM.hangeul) pieces.push(oldM.hangeul);
      if (!oldM.reviewed) allReviewed = false;
    }
    const concatenated = pieces.join(" ").replace(/\s+/g, " ").trim();
    newVerses[newAnchor] = {
      hangeul: concatenated,
      reviewed: allReviewed && concatenated.length > 0,
    };
    stats.caseA_merged++;
    if (concatenated) {
      reviewItems.push({
        type: "merged-from-multi",
        newAnchor,
        olds,
        detail: `${olds.length}개의 OLD anchor의 hangeul을 합친 결과. 합본이 자연스러운지 확인 필요.`,
        hangeul: concatenated,
      });
    } else {
      reviewItems.push({
        type: "merged-from-multi-empty",
        newAnchor,
        olds,
        detail: `${olds.length}개의 OLD anchor 모두 hangeul 빈 상태. 한글 신규 입력 필요.`,
      });
    }
    continue;
  }

  // olds.length === 1
  const old = olds[0];
  const oldM = oldMapping.verses[old];
  const news = oldToNews[old] ?? [];
  if (news.length > 1 && splitOldSet.has(old)) {
    // case B — 1 OLD → N NEW (단계 5 마침표 분할)
    // 첫 NEW에만 OLD의 hangeul, 나머지에는 빈 string.
    const isFirstNew = news[0] === newAnchor;
    if (isFirstNew) {
      newVerses[newAnchor] = {
        hangeul: oldM?.hangeul ?? "",
        reviewed: false, // 분할이라 검수 필요
      };
    } else {
      newVerses[newAnchor] = { hangeul: "", reviewed: false };
    }
    stats.caseB_split++;
    reviewItems.push({
      type: "split-into-multi",
      newAnchor,
      old,
      siblings: news,
      detail: `OLD ^${old}이 ${news.length}개의 NEW로 분할됨. ${
        isFirstNew ? "첫 NEW에 OLD의 hangeul 전체를 둠 — 다른 NEW와 분할 입력 필요." : "비어 있음 — 형제 NEW에서 hangeul 분할 후 채울 것."
      }`,
    });
    continue;
  }

  // case C — 1 OLD → 1 NEW (단순 이전 또는 동일 ID)
  if (!oldM) {
    // OLD 매핑이 없는데 remap에는 있는 경우 — 빈 매핑.
    newVerses[newAnchor] = { hangeul: "", reviewed: false };
    stats.caseC_renumbered++;
    continue;
  }
  newVerses[newAnchor] = {
    hangeul: oldM.hangeul,
    reviewed: !!oldM.reviewed,
    ...(oldM.confidence != null ? { confidence: oldM.confidence } : {}),
  };
  if (old === newAnchor) stats.caseC_identity++;
  else stats.caseC_renumbered++;
}

// 새 mapping에 빠진 NEW anchor 확인 (위 newAnchorOrder가 모든 anchor를 커버해야 하지만)
for (const a of Object.keys(newToOlds)) {
  if (!(a in newVerses)) {
    newVerses[a] = { hangeul: "", reviewed: false };
    stats.newAnchorsNotInRemap++;
  }
}

const newMapping = {
  ...oldMapping,
  version: 2,
  schema: "sentence-anchor",
  description: oldMapping.description,
  verses: newVerses,
};

// ── backup + write ───────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(VAULT, ".bak", `canonical-mapping-resplit-${ts}`);

if (isDryRun) {
  console.log("[dry-run] 결과:");
} else {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(MAPPING_PATH, path.join(backupDir, "cheonjigaebyeokgyeong-canonical.json"));
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(newMapping, null, 2) + "\n");
  console.log(`Backup: ${path.relative(ROOT, backupDir)}`);
  console.log(`Wrote:  ${path.relative(ROOT, MAPPING_PATH)}`);
}

// ── review queue ────────────────────────────────────────────────────────
{
  const lines = [];
  lines.push(
    "# 천지개벽경 canonical-mapping — 검수 큐 (resplit 후)",
    "",
    `생성일: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "? → □ 대체 + sentence-anchor 재분리에 따른 v2 mapping 갱신 결과 중 사람 검수 필요 항목.",
    "",
    "## 통계",
    "",
    `- NEW sentence anchor entry: ${stats.total}`,
    `- case A 합쳐짐 (N OLD → 1 NEW): ${stats.caseA_merged}`,
    `- case B 분할됨 (1 OLD → N NEW, 단계 5 마침표): ${stats.caseB_split}`,
    `- case C 단순 이전 (1 OLD → 1 NEW): identity ${stats.caseC_identity} / renumbered ${stats.caseC_renumbered}`,
    `- remap에 없는 NEW anchor: ${stats.newAnchorsNotInRemap}`,
    "",
    "## 검수 가이드",
    "",
    "- **merged-from-multi**: OLD 여러 개의 hangeul을 하나로 합침. 합본이 의미상 한 문장인지, 어색한 띄어쓰기·중복 표현이 없는지 확인.",
    "- **merged-from-multi-empty**: OLD 모두 빈 hangeul이라 NEW도 비어 있음. 신규 입력 필요.",
    "- **split-into-multi**: 단계 5 마침표 분할 결과 NEW가 여러 개. 첫 NEW에만 OLD hangeul을 두었으므로, admin 도구에서 형제 NEW들과 한글 분할 입력 필요.",
    "- **missing-remap**: remap에 없는 NEW anchor. 빈 string으로 초기화. 보강 분리 등.",
    "",
    "---",
    "",
  );

  const grouped = {
    "merged-from-multi": [],
    "merged-from-multi-empty": [],
    "split-into-multi": [],
    "missing-remap": [],
  };
  for (const r of reviewItems) (grouped[r.type] ??= []).push(r);

  const titleFor = {
    "merged-from-multi": "합쳐진 매핑 — 합본 hangeul 검수",
    "merged-from-multi-empty": "합쳐졌지만 hangeul 비어 있음",
    "split-into-multi": "분할된 매핑 — 분할 hangeul 입력 필요",
    "missing-remap": "remap에 없는 NEW anchor",
  };

  for (const [type, items] of Object.entries(grouped)) {
    if (!items.length) continue;
    lines.push(`## ${titleFor[type] ?? type} (${items.length})`, "");
    for (const r of items) {
      lines.push(`### ^${r.newAnchor}`);
      lines.push("");
      if (r.olds) lines.push(`- OLD: ${r.olds.map((a) => "^" + a).join(", ")}`);
      if (r.old) {
        lines.push(`- OLD: ^${r.old}`);
        if (r.siblings) lines.push(`- 형제 NEW: ${r.siblings.map((a) => "^" + a).join(", ")}`);
      }
      lines.push(`- ${r.detail}`);
      const ht = hanjaText[r.newAnchor];
      if (ht) lines.push(`- 한자: ${ht.replace(/\n/g, " ")}`);
      if (r.hangeul) lines.push(`- 한글 합본: ${r.hangeul.replace(/\n/g, " ")}`);
      lines.push("");
    }
  }

  if (isDryRun) {
    console.log(`[dry-run] 검수 큐 ${reviewItems.length}건 (저장 X)`);
  } else {
    fs.mkdirSync(path.dirname(REVIEW_QUEUE_PATH), { recursive: true });
    fs.writeFileSync(REVIEW_QUEUE_PATH, lines.join("\n") + "\n");
    console.log(`Review queue: ${path.relative(ROOT, REVIEW_QUEUE_PATH)} (${reviewItems.length}건)`);
  }
}

// ── summary ─────────────────────────────────────────────────────────────
console.log(`\n=== Summary ===`);
console.log(`OLD mapping entries: ${Object.keys(oldMapping.verses).length}`);
console.log(`NEW mapping entries: ${Object.keys(newVerses).length}`);
console.log(`case A merged:       ${stats.caseA_merged}`);
console.log(`case B split:        ${stats.caseB_split}`);
console.log(`case C identity:     ${stats.caseC_identity}`);
console.log(`case C renumbered:   ${stats.caseC_renumbered}`);
console.log(`missing remap:       ${stats.newAnchorsNotInRemap}`);
console.log(`review queue items:  ${reviewItems.length}`);
