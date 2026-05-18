#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Wikilink 검수 큐 적용 도구.
 *
 * `content/_data/wikilink-review-queue.md` 의 항목을 파싱해서 본문에 wikilink 박음.
 *
 * 사용:
 *   node scripts/apply-wikilink-queue.ts                 # 체크된 (- [x]) 항목만
 *   node scripts/apply-wikilink-queue.ts --all           # 모든 항목 (- [ ] 포함)
 *   node scripts/apply-wikilink-queue.ts --dry-run       # 적용 시뮬레이션만
 *
 * 한 entry 형식:
 *   - [x] L30 `고부` → `[[고부]]` *(places/고부)*
 *     > context line preview
 *
 * 적용 로직:
 *   - 파일별로 모음
 *   - 한 라인에 같은 단어가 여러 번 나오면 entry 순서대로 첫 unwrapped 위치 치환
 *   - 이미 `[[..]]` 안인 위치는 건너뜀
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const QUEUE_FILE = join(ROOT, "content", "_data", "wikilink-review-queue.md");

const args = process.argv.slice(2);
const applyAll = args.includes("--all");
const dryRun = args.includes("--dry-run");

interface Entry {
  checked: boolean;
  file: string;
  line: number;
  matchedText: string;
  suggested: string;
}

function parseQueue(raw: string): Entry[] {
  const lines = raw.split("\n");
  const out: Entry[] = [];
  let currentFile: string | null = null;
  // 파일 헤더: "## content/scripture/..."
  // 항목 라인: "- [ ] L<line> `<text>` → `<suggested>` *(...)*"
  const fileRe = /^##\s+(content\/scripture\/.+\.md)\s*$/;
  const entryRe =
    /^-\s+\[([ x])\]\s+L(\d+)\s+`([^`]+)`\s+→\s+`([^`]+)`/;
  for (const ln of lines) {
    const fm = ln.match(fileRe);
    if (fm) {
      currentFile = fm[1];
      continue;
    }
    const em = ln.match(entryRe);
    if (em && currentFile) {
      out.push({
        checked: em[1] === "x",
        file: currentFile,
        line: parseInt(em[2], 10),
        matchedText: em[3],
        suggested: em[4],
      });
    }
  }
  return out;
}

function maskedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\[\[[^\]]*\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function inMaskedRange(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) if (pos >= s && pos < e) return true;
  return false;
}

// 라인에서 처음으로 unwrapped 위치를 찾아 치환. 못 찾으면 null.
function replaceFirstUnwrapped(
  line: string,
  needle: string,
  replacement: string,
): { line: string; replaced: boolean } {
  const masks = maskedRanges(line);
  let pos = 0;
  while ((pos = line.indexOf(needle, pos)) >= 0) {
    if (!inMaskedRange(pos, masks)) {
      return {
        line: line.slice(0, pos) + replacement + line.slice(pos + needle.length),
        replaced: true,
      };
    }
    pos += 1;
  }
  return { line, replaced: false };
}

// ─────────────────────── MAIN ───────────────────────

const queueRaw = readFileSync(QUEUE_FILE, "utf8");
const entries = parseQueue(queueRaw);
console.log(`Parsed ${entries.length} entries from queue.`);

const targets = applyAll ? entries : entries.filter((e) => e.checked);
console.log(
  `${applyAll ? "All" : "Checked only"}: ${targets.length} entries to apply.`,
);
if (targets.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

// 파일별 그룹화 + 라인 번호 순 (안정)
const byFile = new Map<string, Entry[]>();
for (const e of targets) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file)!.push(e);
}

let totalApplied = 0;
let totalSkipped = 0;

for (const [file, fileEntries] of byFile) {
  const abs = join(ROOT, file);
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split("\n");

  let fileApplied = 0;
  let fileSkipped = 0;

  for (const e of fileEntries) {
    const idx = e.line - 1; // 0-indexed
    if (idx < 0 || idx >= lines.length) {
      console.warn(`  [skip] ${file}:${e.line} out of range`);
      fileSkipped += 1;
      continue;
    }
    const original = lines[idx];
    const { line: replaced, replaced: ok } = replaceFirstUnwrapped(
      original,
      e.matchedText,
      e.suggested,
    );
    if (!ok) {
      console.warn(
        `  [skip] ${file}:${e.line} "${e.matchedText}" 위치 못 찾음 (이미 wikilink 됐거나 텍스트 변경됨)`,
      );
      fileSkipped += 1;
      continue;
    }
    lines[idx] = replaced;
    fileApplied += 1;
  }

  if (fileApplied > 0 && !dryRun) {
    writeFileSync(abs, lines.join("\n"));
  }
  console.log(
    `${file}: ${fileApplied} applied${fileSkipped > 0 ? `, ${fileSkipped} skipped` : ""}`,
  );
  totalApplied += fileApplied;
  totalSkipped += fileSkipped;
}

console.log(
  `\nTotal: ${totalApplied} applied${totalSkipped > 0 ? `, ${totalSkipped} skipped` : ""}${dryRun ? " (dry-run, no files written)" : ""}`,
);
