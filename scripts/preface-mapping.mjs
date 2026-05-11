#!/usr/bin/env node
/**
 * 천지개벽경 서문 한자↔한글 1차 매핑.
 *
 * 한자 본문(content/scripture/cheonjigaebyeokgyeong/00_서.md)에서 31개의
 * ^preface-N sentence anchor를 추출. 한글본 백업
 * (content/scripture/cheonjigaebyeokgyeong-hangeul/00_서.md)에서 본문 paragraph를
 * 마침표(.) 단위로 분리한 후, 짧은 종결 표현("크도다.", "오호라." 등)을
 * 다음 sentence 앞에 흡수해 한자 sentence 수에 맞춤.
 *
 * 31:31 자동 매칭되면 mapping JSON의 preface-N entry에 hangeul 텍스트와
 * reviewed=true를 채움. 아니면 검수 큐 markdown만 출력하고 멈춤.
 *
 * 입력 파일·markdown은 절대 수정하지 않음.
 *
 * 사용법:
 *   node scripts/preface-mapping.mjs --dry-run
 *   node scripts/preface-mapping.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VAULT = process.env.VAULT_PATH || path.join(ROOT, "content");
const HANJA_PATH = path.join(VAULT, "scripture/cheonjigaebyeokgyeong/00_서.md");
const HANGEUL_PATH = path.join(VAULT, "scripture/cheonjigaebyeokgyeong-hangeul/00_서.md");
const MAPPING_PATH = path.join(VAULT, "scripture/_mappings/cheonjigaebyeokgyeong-canonical.json");
const QUEUE_PATH = path.join(VAULT, "_data/preface-mapping-review-queue.md");

const isDryRun = process.argv.includes("--dry-run");

const SENTENCE_ANCHOR_RE = /\s+\^([\w-]+)\s*$/;

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const [, , body] = m;
  return body;
}

// ─── hanja: ^preface-N + 텍스트 추출 ────────────────────────────────────
const hanjaBody = parseFrontmatter(fs.readFileSync(HANJA_PATH, "utf-8"));
const hanjaSentences = [];
for (const para of hanjaBody.split(/\n\s*\n/)) {
  const t = para.trim();
  if (!t || /^#\s/.test(t)) continue;
  const am = t.match(SENTENCE_ANCHOR_RE);
  if (!am) continue;
  hanjaSentences.push({
    anchor: am[1],
    text: t.replace(SENTENCE_ANCHOR_RE, "").trim(),
  });
}

// ─── hangeul: 본문 추출 + 분리 + 흡수 ───────────────────────────────────
const hangeulBody = parseFrontmatter(fs.readFileSync(HANGEUL_PATH, "utf-8"));
// 본문은 `# 헤딩` 다음 paragraph 1개. signature 라인은 별도 paragraph.
// "布敎(포교)" 시작 라인부터 끝까지 제외.
let mainParagraph = "";
for (const para of hangeulBody.split(/\n\s*\n/)) {
  const t = para.trim();
  if (!t) continue;
  if (/^#\s/.test(t)) continue;
  if (/^布敎\(포교\)/.test(t)) break; // 발행 라인부터 종료
  if (/^\[\[이중성/.test(t)) break;
  // 첫 본문 paragraph만 채택
  if (!mainParagraph) {
    mainParagraph = t;
  } else {
    mainParagraph += " " + t;
  }
}

// 마침표 단순 분리. 다음 조건은 분리 X:
//   - 숫자 사이의 `.` (예: "1.5")
//   - 앞에 공백이 있는 경우 (예: "군신 . 부자" 같은 열거 구분자 — 마침표가 sentence 종결이
//     아니라 항목 separator로 쓰임)
function splitByPeriod(text) {
  const out = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (ch === ".") {
      const prev = text[i - 1];
      const next = text[i + 1];
      const prevIsDigit = prev && /\d/.test(prev);
      const nextIsDigit = next && /\d/.test(next);
      const prevIsSpace = prev && /\s/.test(prev);
      if (prevIsDigit && nextIsDigit) continue;
      if (prevIsSpace) continue; // " . " 열거 구분자
      if (next === undefined || /\s/.test(next)) {
        out.push(buf.trim());
        buf = "";
        while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

const rawSentences = splitByPeriod(mainParagraph);

// 흡수 규칙: length < 15 + 짧은 종결어미("도다", "라", "이라", "이오")로 끝남
const SHORT_ENDINGS = ["도다", "이라", "이오", "라"];
function isShortAbsorbable(s) {
  const stripped = s.replace(/\.$/, "").trim();
  if (stripped.length >= 15) return false;
  for (const e of SHORT_ENDINGS) {
    if (stripped.endsWith(e)) return true;
  }
  return false;
}

const absorbed = [];
const absorbLog = []; // 흡수된 항목 로그 (검수 큐용)
let pending = null;
for (const s of rawSentences) {
  if (pending !== null) {
    const merged = `${pending} ${s}`.replace(/\s+/g, " ").trim();
    absorbLog.push({ prefix: pending, into: s, merged });
    absorbed.push(merged);
    pending = null;
    continue;
  }
  if (isShortAbsorbable(s)) {
    pending = s;
    continue;
  }
  absorbed.push(s);
}
if (pending !== null) {
  // 마지막이 짧은 종결이면 그대로 단독 sentence로 추가
  absorbed.push(pending);
}

console.log(`Hanja sentences: ${hanjaSentences.length}`);
console.log(`Hangeul raw split: ${rawSentences.length}`);
console.log(`Hangeul after absorption: ${absorbed.length}`);
console.log(`Absorbed (${absorbLog.length}):`);
for (const a of absorbLog) {
  console.log(`  · "${a.prefix}" → "${a.into.slice(0, 40)}…"`);
}

const progressMsg = `서문 매핑: 한글 분리 후 sentence 수 = ${absorbed.length} (목표 ${hanjaSentences.length})`;
try {
  // Telegram progress notification (best-effort).
  const { execSync } = await import("node:child_process");
  execSync(
    `"$HOME"/.claude/hooks/notify-telegram.sh progress "${progressMsg.replace(/"/g, '\\"')}"`,
    { stdio: "ignore", shell: "/bin/bash" },
  );
} catch {}

// ─── 일치 여부 ───────────────────────────────────────────────────────────
if (absorbed.length !== hanjaSentences.length) {
  // 검수 큐 출력 + 멈춤
  const lines = [];
  lines.push(
    "# 천지개벽경 서문 매핑 — 검수 큐 (수 불일치)",
    "",
    `생성일: ${new Date().toISOString().slice(0, 10)}`,
    "",
    `한자 sentence: **${hanjaSentences.length}**`,
    `한글 sentence (흡수 후): **${absorbed.length}**`,
    "",
    "수가 맞지 않아 자동 매칭 보류. 흡수 규칙 조정 필요.",
    "",
    "## 흡수된 짧은 종결",
    "",
  );
  for (const a of absorbLog) {
    lines.push(`- "${a.prefix}" → 다음 sentence에 흡수`);
    lines.push(`  > ${a.merged.slice(0, 120)}…`);
    lines.push("");
  }
  lines.push("## 한글 sentence 전체", "");
  absorbed.forEach((s, i) => {
    lines.push(`### ${i + 1}`);
    lines.push(`> ${s}`);
    lines.push("");
  });
  lines.push("## 한자 sentence 전체", "");
  hanjaSentences.forEach((s, i) => {
    lines.push(`### ^${s.anchor}`);
    lines.push(`> ${s.text}`);
    lines.push("");
  });

  if (!isDryRun) {
    fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
    fs.writeFileSync(QUEUE_PATH, lines.join("\n") + "\n");
    console.log(`Review queue: ${path.relative(ROOT, QUEUE_PATH)}`);
  }
  console.error(`\n[error] 수 불일치 — 자동 매칭 보류.`);
  try {
    const { execSync } = await import("node:child_process");
    execSync(
      `"$HOME"/.claude/hooks/notify-telegram.sh action "서문 매핑 ${hanjaSentences.length}:${absorbed.length} 불일치 — 검수 필요"`,
      { stdio: "ignore", shell: "/bin/bash" },
    );
  } catch {}
  process.exit(2);
}

// ─── 자동 1:1 매칭 → mapping JSON 갱신 ───────────────────────────────────
const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf-8"));
let updated = 0;
let alreadyMapped = 0;
const changes = []; // [{anchor, before, after}]
for (let i = 0; i < hanjaSentences.length; i++) {
  const anchor = hanjaSentences[i].anchor;
  const newH = absorbed[i].trim();
  const cur = mapping.verses[anchor] ?? {};
  const beforeH = cur.hangeul ?? "";
  if (beforeH === newH && cur.reviewed) {
    alreadyMapped++;
    continue;
  }
  changes.push({ anchor, before: beforeH, after: newH });
  mapping.verses[anchor] = {
    hangeul: newH,
    reviewed: true,
  };
  updated++;
}

// ─── 백업 + 저장 ────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = path.join(VAULT, ".bak", `preface-mapping-${ts}`);

if (isDryRun) {
  console.log(`\n[dry-run] mapping update: ${updated} entries (already ${alreadyMapped})`);
  changes.slice(0, 5).forEach((c) => {
    console.log(`  · ^${c.anchor}:`);
    console.log(`     before: "${c.before.slice(0, 60)}…"`);
    console.log(`     after:  "${c.after.slice(0, 60)}…"`);
  });
} else {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(MAPPING_PATH, path.join(backupDir, "cheonjigaebyeokgyeong-canonical.json"));
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2) + "\n");
  console.log(`\nBackup: ${path.relative(ROOT, backupDir)}`);
  console.log(`Wrote:  ${path.relative(ROOT, MAPPING_PATH)}`);
  console.log(`Updated ${updated} entries (already mapped: ${alreadyMapped}).`);
  try {
    const { execSync } = await import("node:child_process");
    execSync(
      `"$HOME"/.claude/hooks/notify-telegram.sh progress "서문 매핑: 31:31 자동 매칭 완료 (갱신 ${updated} / 기존 ${alreadyMapped})"`,
      { stdio: "ignore", shell: "/bin/bash" },
    );
  } catch {}
}
