#!/usr/bin/env node
/**
 * canonical-mapping JSON 자체에는 손대지 않고, 현재 상태를 기준으로 검수 큐만 재생성.
 *
 * 천지개벽경 절 heading 폐기 + 평면 anchor 모델 전환 직후, mapping의 anchor 키와
 * markdown의 sentence anchor가 1:1 일치하는지 확인하고, 빈 hangeul·미검수 entry를
 * markdown 등장 순서로 정리한 review queue를 다시 만든다.
 *
 * 사용법:
 *   node scripts/refresh-canonical-mapping-queue.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VAULT = process.env.VAULT_PATH || path.join(ROOT, "content");
const MAPPING_PATH = path.join(VAULT, "scripture/_mappings/cheonjigaebyeokgyeong-canonical.json");
const QUEUE_PATH = path.join(VAULT, "_data/canonical-mapping-review-queue.md");
const HANJA_DIR = path.join(VAULT, "scripture/cheonjigaebyeokgyeong");

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
function findMd(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

// markdown에서 등장 순서대로 (anchor, hanja text, chapter label) 수집
const items = [];
for (const f of findMd(HANJA_DIR)) {
  const content = fs.readFileSync(f, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) continue;
  const { fm, body } = parsed;
  if (fm.canonical !== "true") continue;
  const isPreface = fm.section === "preface";
  const chapLabel = isPreface
    ? "서(序)"
    : `권 ${fm["권"]} ${fm["권_이름"] ?? ""} · ${fm["장"]}장`;
  for (const para of body.split(/\n\s*\n/)) {
    const t = para.trim();
    if (!t || /^#\s/.test(t) || /^##\s/.test(t)) continue;
    const am = t.match(SENTENCE_ANCHOR_RE);
    if (!am) continue;
    const anchor = am[1];
    const hanjaText = t.replace(SENTENCE_ANCHOR_RE, "").trim();
    items.push({ anchor, hanjaText, chapLabel });
  }
}

const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf-8"));
const verses = mapping.verses;

const mappingAnchors = new Set(Object.keys(verses));
const mdAnchors = new Set(items.map((x) => x.anchor));
const onlyMapping = [...mappingAnchors].filter((a) => !mdAnchors.has(a));
const onlyMd = [...mdAnchors].filter((a) => !mappingAnchors.has(a));

const queue = items.filter((it) => {
  const m = verses[it.anchor];
  if (!m) return true; // 매핑 entry 자체 없음
  if (!m.hangeul) return true; // 빈 string
  if (!m.reviewed) return true; // 미검수
  return false;
});

const stats = {
  total: items.length,
  mapped: items.filter((it) => verses[it.anchor]?.hangeul).length,
  reviewed: items.filter((it) => verses[it.anchor]?.reviewed).length,
  emptyHangeul: items.filter((it) => verses[it.anchor] && !verses[it.anchor].hangeul).length,
  unreviewedNonEmpty: items.filter(
    (it) => verses[it.anchor]?.hangeul && !verses[it.anchor]?.reviewed,
  ).length,
  missingEntry: items.filter((it) => !verses[it.anchor]).length,
};

// ── write queue ─────────────────────────────────────────────────────────
const lines = [];
lines.push(
  "# 천지개벽경 canonical-mapping — 검수 큐 (평면 anchor 모델)",
  "",
  `생성일: ${new Date().toISOString().slice(0, 10)}`,
  "",
  "절 heading 폐기 + 평면 anchor 모델 전환 후 mapping을 markdown 기준으로 재정렬한 검수 큐.",
  "",
  "## 통계",
  "",
  `- 전체 sentence anchor: ${stats.total}`,
  `- 매핑된 sentence (hangeul 비어있지 않음): ${stats.mapped} (${stats.total ? Math.round((stats.mapped * 100) / stats.total) : 0}%)`,
  `- 검수 완료: ${stats.reviewed} (${stats.total ? Math.round((stats.reviewed * 100) / stats.total) : 0}%)`,
  `- 빈 hangeul: ${stats.emptyHangeul}`,
  `- hangeul 있지만 미검수: ${stats.unreviewedNonEmpty}`,
  `- mapping entry 자체 없음: ${stats.missingEntry}`,
  "",
);

if (onlyMapping.length || onlyMd.length) {
  lines.push("## 동기화 경고", "");
  if (onlyMapping.length) {
    lines.push(`- mapping에만 있고 markdown에 없는 anchor (${onlyMapping.length})`);
    for (const a of onlyMapping.slice(0, 20)) lines.push(`  - ${a}`);
    if (onlyMapping.length > 20) lines.push(`  - …외 ${onlyMapping.length - 20}건`);
  }
  if (onlyMd.length) {
    lines.push(`- markdown에만 있고 mapping에 없는 anchor (${onlyMd.length})`);
    for (const a of onlyMd.slice(0, 20)) lines.push(`  - ${a}`);
    if (onlyMd.length > 20) lines.push(`  - …외 ${onlyMd.length - 20}건`);
  }
  lines.push("");
}

lines.push("## 검수 가이드", "");
lines.push(
  "- **빈 hangeul**: 한글 매핑이 비어 있음. admin `/admin/canonical-mapping/<vol>/<chap>/`에서 입력.",
  "- **hangeul 있지만 미검수**: 자동 매핑 결과가 그대로 남아 있음. 합본·분할 자연스러운지 확인 후 검수 완료 토글.",
  "- **mapping entry 없음**: markdown에는 있지만 mapping JSON에 키가 없음 (sync 깨진 상태).",
  "",
  "---",
  "",
);

// 章 단위로 묶어 표시
const grouped = {};
for (const it of queue) {
  if (!grouped[it.chapLabel]) grouped[it.chapLabel] = [];
  grouped[it.chapLabel].push(it);
}
for (const [chap, list] of Object.entries(grouped)) {
  lines.push(`## ${chap} (${list.length})`, "");
  for (const it of list) {
    const m = verses[it.anchor];
    const status = !m
      ? "(entry 없음)"
      : !m.hangeul
        ? "(빈 hangeul)"
        : !m.reviewed
          ? "(미검수)"
          : "";
    lines.push(`- **^${it.anchor}** ${status}`);
    lines.push(`  - 한자: ${it.hanjaText}`);
    if (m?.hangeul) lines.push(`  - 한글: ${m.hangeul}`);
    lines.push("");
  }
}

fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
fs.writeFileSync(QUEUE_PATH, lines.join("\n") + "\n");

console.log(`Mapping anchors: ${mappingAnchors.size}`);
console.log(`Markdown anchors: ${mdAnchors.size}`);
console.log(`In sync: ${onlyMapping.length === 0 && onlyMd.length === 0}`);
console.log(`Queue items: ${queue.length}`);
console.log(`  · empty hangeul: ${stats.emptyHangeul}`);
console.log(`  · unreviewed non-empty: ${stats.unreviewedNonEmpty}`);
console.log(`  · missing entry: ${stats.missingEntry}`);
console.log(`Wrote: ${path.relative(ROOT, QUEUE_PATH)}`);
