#!/usr/bin/env node
/**
 * 천지개벽경 sentence-anchor 재분리.
 *
 * 배경: ?가 폰트 미지원 한자 자리로 쓰였던 것을 □로 대체한 뒤, 직전 분리에서 ?를
 * sentence terminator로 잘못 잡아 과분리됐던 paragraph를 다시 합치고 재번호.
 *
 * migrate-sentence-anchors.mjs는 paragraph 단위(빈 줄 사이) 입력을 가정해서, 이미
 * 분리된 markdown(각 문장이 자기 paragraph)을 다시 한 paragraph로 합치는 단계가
 * 별도로 필요하다. 본 스크립트가 그 합치기 + 재분리 + 새 anchor 번호 부여를 한 번에 처리.
 *
 * 입력:
 *   content/scripture/cheonjigaebyeokgyeong/**.md (현재 sentence-anchor 형식)
 *
 * 출력:
 *   - 같은 markdown 덮어쓰기 (백업: content/.bak/sentence-anchor-cleanup-{ts}/)
 *   - content/_data/sentence-anchor-resplit-remap.json
 *     · old_anchor → new_anchor 매핑 dict (canonical-mapping / 댓글 SQL 갱신용)
 *
 * 사용법:
 *   node scripts/resplit-sentence-anchors.mjs --dry-run
 *   node scripts/resplit-sentence-anchors.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VAULT = process.env.VAULT_PATH || path.join(ROOT, "content");
const TARGET_DIR = path.join(VAULT, "scripture/cheonjigaebyeokgyeong");
const REMAP_PATH = path.join(VAULT, "_data/sentence-anchor-resplit-remap.json");

const isDryRun = process.argv.includes("--dry-run");

const SENTENCE_ANCHOR_RE = /\s+\^([\w-]+)\s*$/;

// migrate-sentence-anchors.mjs와 동일한 splitSentences (□는 종결 부호 X).
function splitSentences(text) {
  const sentences = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    buf += ch;
    if (ch === "." || ch === "?" || ch === "!") {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        sentences.push(buf.trim());
        buf = "";
        while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      }
    }
    i++;
  }
  const tail = buf.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const [, raw, body] = m;
  const fm = {};
  for (const line of raw.split("\n")) {
    const km = line.match(/^([^:]+):\s*(.*)$/);
    if (km) fm[km[1].trim()] = km[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fm, raw, body };
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

function processFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) return { filePath, skipped: true, reason: "no frontmatter" };
  const { fm, raw, body } = parsed;
  if (fm.canonical !== "true") return { filePath, skipped: true, reason: "not canonical" };

  const isPreface = fm.section === "preface";
  const anchorPrefix = isPreface ? "preface" : `${fm["권"]}-${fm["장"]}`;
  if (!isPreface && (!fm["권"] || !fm["장"])) {
    return { filePath, skipped: true, reason: "missing 권/장" };
  }

  const lines = body.split("\n");
  const out = [];
  const remap = []; // [{ oldAnchor, newAnchor }]
  let sentenceCounter = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^(##\s+\d+절)\s*(\^[\w-]+)?\s*$/);
    if (headingMatch) {
      out.push(headingMatch[1]);
      out.push("");
      i++;
      while (i < lines.length && lines[i].trim() === "") i++;

      // 그룹 본문: 다음 ## 헤딩 / # 헤딩 / --- 까지.
      // 각 paragraph는 (text, oldAnchor) 페어 — 안 붙어있으면 anchor 없음.
      const paragraphs = [];
      let buf = [];
      while (
        i < lines.length &&
        !/^##\s/.test(lines[i]) &&
        !/^#\s/.test(lines[i]) &&
        !/^---\s*$/.test(lines[i])
      ) {
        if (lines[i].trim() === "") {
          if (buf.length) {
            paragraphs.push(buf.join(" ").trim());
            buf = [];
          }
        } else {
          buf.push(lines[i]);
        }
        i++;
      }
      if (buf.length) paragraphs.push(buf.join(" ").trim());

      // paragraph 끝의 ^anchor를 분리해 oldAnchor 보관, text만 join.
      const oldAnchors = [];
      const texts = [];
      for (const p of paragraphs) {
        const am = p.match(SENTENCE_ANCHOR_RE);
        if (am) {
          oldAnchors.push(am[1]);
          texts.push(p.replace(SENTENCE_ANCHOR_RE, "").trim());
        } else {
          oldAnchors.push(null);
          texts.push(p);
        }
      }
      // 그룹 본문을 하나의 paragraph로 합쳐 재분리.
      const joined = texts.filter(Boolean).join(" ").trim();
      const newSentences = joined ? splitSentences(joined) : [];

      // OLD anchor의 텍스트를 NEW sentence에 매핑하기 위한 위치 추적.
      // 각 NEW 문장이 차지하는 글자 범위를 joined 안에서 찾고, 그 범위에 텍스트가
      // 포함되는 OLD anchor들을 묶음으로 맵핑.
      let cursor = 0;
      const newToOlds = []; // index = new sentence idx, value = [{ oldAnchor, oldIdx }]
      for (const ns of newSentences) {
        const idx = joined.indexOf(ns, cursor);
        if (idx < 0) {
          // 보수적: 못 찾으면 빈 매핑
          newToOlds.push([]);
          continue;
        }
        const start = idx;
        const end = idx + ns.length;
        const olds = [];
        // 이 NEW sentence에 텍스트가 겹치는 OLD paragraph를 모두 포함.
        let acc = 0;
        for (let oi = 0; oi < texts.length; oi++) {
          const t = texts[oi];
          if (!t) continue;
          const oldStart = acc;
          const oldEnd = acc + t.length;
          // overlap check
          if (oldStart < end && oldEnd > start) {
            if (oldAnchors[oi]) olds.push(oldAnchors[oi]);
          }
          acc = oldEnd + 1; // joining space
        }
        newToOlds.push(olds);
        cursor = end;
      }

      // emit new sentences
      for (let ni = 0; ni < newSentences.length; ni++) {
        sentenceCounter++;
        const newAnchor = `${anchorPrefix}-${sentenceCounter}`;
        out.push(`${newSentences[ni]} ^${newAnchor}`);
        out.push("");
        for (const oldA of newToOlds[ni]) {
          remap.push({ oldAnchor: oldA, newAnchor });
        }
      }
      continue;
    }

    out.push(line);
    i++;
  }

  while (out.length && out[out.length - 1] === "") out.pop();

  const newBody = `---\n${raw}\n---\n${out.join("\n")}\n`;
  return {
    filePath,
    original: content,
    transformed: newBody,
    sentenceCount: sentenceCounter,
    remap,
    changed: content !== newBody,
  };
}

// ─── main ────────────────────────────────────────────────────────────────
const files = findMarkdownFiles(TARGET_DIR);

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(VAULT, ".bak", `sentence-anchor-cleanup-${ts}`);

// 멀티 매핑 보존: oldToNews[old] = [new1, new2, ...] / newToOlds[new] = [old1, ...]
const oldToNews = {};
const newToOlds = {};
let totalSentences = 0;
let prevTotalSentences = 0;
let changedFiles = 0;
let mergedCount = 0; // OLD 여러개 → NEW 하나 (?  →  □ 합쳐짐)
let splitCount = 0; // OLD 하나 → NEW 여러개 (단계 5 마침표가 sentence 분할)

for (const f of files) {
  const result = processFile(f);
  if (result.skipped) continue;

  const prevAnchors = (result.original.match(/\^[\w-]+\s*$/gm) ?? []).length;
  prevTotalSentences += prevAnchors;
  totalSentences += result.sentenceCount;

  for (const r of result.remap) {
    (oldToNews[r.oldAnchor] ??= []).push(r.newAnchor);
    (newToOlds[r.newAnchor] ??= []).push(r.oldAnchor);
  }

  if (!result.changed) continue;
  changedFiles++;

  if (isDryRun) {
    const rel = path.relative(VAULT, f);
    console.log(`DRY ${rel}: ${prevAnchors} → ${result.sentenceCount} sentences`);
  } else {
    const rel = path.relative(VAULT, f);
    const bak = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(bak), { recursive: true });
    fs.writeFileSync(bak, result.original);
    fs.writeFileSync(f, result.transformed);
  }
}

// 멀티 매핑 통계
for (const [, news] of Object.entries(oldToNews)) {
  if (news.length > 1) splitCount++;
}
for (const [, olds] of Object.entries(newToOlds)) {
  if (olds.length > 1) mergedCount++;
}

if (!isDryRun) {
  fs.mkdirSync(path.dirname(REMAP_PATH), { recursive: true });
  fs.writeFileSync(
    REMAP_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scripture: "cheonjigaebyeokgyeong",
        description:
          "Sentence anchor remap after ? → □ replacement and re-split. oldToNews maps OLD anchor → list of NEW anchors (1+ new sentences derived from old text). newToOlds maps NEW anchor → list of OLD anchors that merged into it. Used to update canonical-mapping JSON and comment SQL.",
        prevTotal: prevTotalSentences,
        newTotal: totalSentences,
        savedAnchors: prevTotalSentences - totalSentences,
        oldToNews,
        newToOlds,
        stats: {
          mergedNewSentences: mergedCount,
          splitOldSentences: splitCount,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

console.log(`\n=== Summary ===`);
console.log(`Files processed: ${files.length}`);
console.log(`Files changed:   ${changedFiles}`);
console.log(`Old sentences:   ${prevTotalSentences}`);
console.log(`New sentences:   ${totalSentences}`);
console.log(`Saved (merged):  ${prevTotalSentences - totalSentences}`);
console.log(`OLD anchors:     ${Object.keys(oldToNews).length}`);
console.log(`NEW anchors:     ${Object.keys(newToOlds).length}`);
console.log(`Merged (NEW ← N OLD): ${mergedCount}`);
console.log(`Split  (OLD → N NEW): ${splitCount}`);
if (!isDryRun) {
  console.log(`Backup:          ${path.relative(ROOT, backupDir)}`);
  console.log(`Remap dict:      ${path.relative(ROOT, REMAP_PATH)}`);
}
