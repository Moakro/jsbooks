#!/usr/bin/env node
/**
 * Vault에 손대지 않는 격리 검증 — vite-canonical-mapping.mjs의 sentence 액션
 * 헬퍼(파싱/anchor 비교/시프트/직렬화)가 정상 동작하는지 본문 sample에 대해 확인.
 *
 * 실제 endpoint는 dev server가 plugin 변경 후 재시작되어야 라우팅 됨. 본 스크립트는
 * helper 단위 검증으로 그 사이 신뢰도 확보.
 */
import fs from "node:fs";

const SENTENCE_ANCHOR_LINE_RE = /\^([\w.-]+)\s*$/;

function getAnchorParts(anchor) {
  if (anchor.startsWith("preface-")) {
    const rest = anchor.slice("preface-".length);
    const parts = rest.split(".");
    return { kind: "preface", vol: 0, chap: 0, sent: Number(parts[0]), subs: parts.slice(1).map(Number) };
  }
  const parts = anchor.split(".");
  const main = parts[0].split("-");
  return { kind: "normal", vol: Number(main[0]), chap: Number(main[1]), sent: Number(main[2]), subs: parts.slice(1).map(Number) };
}
function buildAnchor(p) {
  const base = p.kind === "preface" ? `preface-${p.sent}` : `${p.vol}-${p.chap}-${p.sent}`;
  return p.subs.length ? `${base}.${p.subs.join(".")}` : base;
}
function compareAnchors(a, b) {
  const pa = getAnchorParts(a);
  const pb = getAnchorParts(b);
  if (pa.kind !== pb.kind) return pa.kind === "preface" ? -1 : 1;
  if (pa.vol !== pb.vol) return pa.vol - pb.vol;
  if (pa.chap !== pb.chap) return pa.chap - pb.chap;
  if (pa.sent !== pb.sent) return pa.sent - pb.sent;
  const n = Math.max(pa.subs.length, pb.subs.length);
  for (let i = 0; i < n; i++) {
    const va = pa.subs[i] ?? -1;
    const vb = pb.subs[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

// ─── anchor 파싱 ───
console.log("\n[anchor parse]");
eq(getAnchorParts("1-1-3"), { kind: "normal", vol: 1, chap: 1, sent: 3, subs: [] }, "1-1-3");
eq(getAnchorParts("1-2-10.1"), { kind: "normal", vol: 1, chap: 2, sent: 10, subs: [1] }, "1-2-10.1");
eq(getAnchorParts("1-2-10.1.5"), { kind: "normal", vol: 1, chap: 2, sent: 10, subs: [1, 5] }, "1-2-10.1.5");
eq(getAnchorParts("preface-7"), { kind: "preface", vol: 0, chap: 0, sent: 7, subs: [] }, "preface-7");
eq(getAnchorParts("preface-7.2"), { kind: "preface", vol: 0, chap: 0, sent: 7, subs: [2] }, "preface-7.2");

// ─── anchor 직렬화 ───
console.log("\n[anchor build]");
eq(buildAnchor({ kind: "normal", vol: 1, chap: 1, sent: 3, subs: [] }), "1-1-3", "1-1-3");
eq(buildAnchor({ kind: "normal", vol: 1, chap: 2, sent: 10, subs: [1] }), "1-2-10.1", "1-2-10.1");
eq(buildAnchor({ kind: "preface", vol: 0, chap: 0, sent: 7, subs: [2] }), "preface-7.2", "preface-7.2");

// ─── natural sort ───
console.log("\n[anchor sort — natural]");
const unsorted = ["1-1-10", "1-1-2", "1-1-2.10", "1-1-2.2", "1-1-3", "preface-1", "preface-1.1"];
const sorted = [...unsorted].sort(compareAnchors);
eq(sorted, ["preface-1", "preface-1.1", "1-1-2", "1-1-2.2", "1-1-2.10", "1-1-3", "1-1-10"], "natural sort with sub-anchors + preface");

// ─── 한자 markdown sentence 파싱 (실제 chapter 1-1) ───
console.log("\n[parseHanjaSentences chapter 1-1]");
const ch11 = fs.readFileSync("content/scripture/cheonjigaebyeokgyeong/01_신축편/01-01_장.md", "utf-8");
const body = ch11.replace(/^---\n[\s\S]*?\n---\n/, "");
function parseHanjaSentences(body) {
  const lines = body.split("\n");
  const sentences = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim() || /^#\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^#\s/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    const text = buf.join(" ").trim();
    const am = text.match(SENTENCE_ANCHOR_LINE_RE);
    if (!am) continue;
    let inner = text.replace(SENTENCE_ANCHOR_LINE_RE, "").trim();
    let isVerse = false;
    if (inner.startsWith("> ")) { isVerse = true; inner = inner.slice(2).trim(); }
    sentences.push({ anchor: am[1], text: inner, isVerse });
  }
  return sentences;
}
const sentences = parseHanjaSentences(body);
eq(sentences.length, 4, "ch1-1 has 4 sentences");
eq(sentences[0].anchor, "1-1-1", "first anchor");
eq(sentences[3].anchor, "1-1-4", "last anchor");
eq(sentences[0].isVerse, false, "first is not verse");

// ─── drop 시뮬레이션: 1-1-2 제거 시 1-1-3 → 1-1-2, 1-1-4 → 1-1-3 ───
console.log("\n[shift sim — drop 1-1-2]");
function shiftIfAfter(anchor, refAnchor, delta) {
  const r = getAnchorParts(refAnchor);
  const a = getAnchorParts(anchor);
  if (a.kind !== r.kind) return anchor;
  if (a.kind === "normal" && (a.vol !== r.vol || a.chap !== r.chap)) return anchor;
  if (a.sent > r.sent) return buildAnchor({ ...a, sent: a.sent + delta });
  return anchor;
}
eq(shiftIfAfter("1-1-1", "1-1-2", -1), "1-1-1", "before: unchanged");
eq(shiftIfAfter("1-1-3", "1-1-2", -1), "1-1-2", "after: shifted");
eq(shiftIfAfter("1-1-4", "1-1-2", -1), "1-1-3", "after: shifted");
eq(shiftIfAfter("1-1-5.1", "1-1-2", -1), "1-1-4.1", "sub-anchor: parent shifted");
eq(shiftIfAfter("2-1-3", "1-1-2", -1), "2-1-3", "other chap: unchanged");
eq(shiftIfAfter("preface-3", "1-1-2", -1), "preface-3", "preface kind mismatch: unchanged");

// ─── 결과 ───
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
