#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Build a per-file git history index at src/data/history.json.
 *
 * Source of truth: this repo's git log. Each commit that touched
 * `content/...` is listed. The vault root *is* `content/` (no sync step), so
 * commit messages here are exactly what the operator wrote at edit time.
 *
 * Output shape:
 *   {
 *     "<relPath>": [
 *       { "hash": "abc1234", "date": "2026-04-26T...", "author": "Moakro", "subject": "..." },
 *       ...
 *     ]
 *   }
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

// Cloudflare Pages 등 shallow clone(depth=1) 환경에서는 git log가 최신 커밋만
// 봐서 그 이전 커밋의 `--public` 토큰이 누락된다. 가능하면 전체 히스토리로 펼친다.
// 이미 unshallow된 저장소나 remote 없는 환경에서는 조용히 실패.
try {
  execSync("git fetch --unshallow", { stdio: "ignore" });
} catch {
  /* already unshallow, no remote, or offline — proceed with what we have */
}

type Entry = {
  hash: string;
  date: string;
  author: string;
  subject: string;
  /** When commit body contains a `--public ...` block, the extracted user-facing message. */
  publicMessage?: string;
};

const REPO_URL = "https://github.com/Moakro/jsbooks";

// One git invocation: per-commit headers + body + file list, only for content/.
// COMMIT marks the start of every commit, FIELD separates fields inside the
// header, EOH marks end of header (file list follows).
const COMMIT = "\x03";
const FIELD = "\x01";
const EOH = "\x02";

// `-c core.quotePath=false` keeps Korean filenames in their literal form
// (otherwise git emits `\xxx\yyy` octal escapes that break the prefix check).
const out = execSync(
  `git -c core.quotePath=false log --pretty=format:"${COMMIT}%H${FIELD}%aI${FIELD}%an${FIELD}%s${FIELD}%b${EOH}" --name-only -- content`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

/**
 * Extract the multi-line message that follows a `--public` line in the body.
 * The block ends at a blank line, another `--token` line, or end of body.
 * Returns undefined when no `--public` token is present.
 */
function extractPublic(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "--public" || trimmed.startsWith("--public ")) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const collected: string[] = [];
  // Same-line text after `--public ` belongs to the message.
  const sameLine = lines[start].trim().replace(/^--public\s*/, "");
  if (sameLine) collected.push(sameLine);
  for (let j = start + 1; j < lines.length; j++) {
    const raw = lines[j];
    if (raw.trim() === "") break;
    if (/^--\S/.test(raw.trim())) break;
    collected.push(raw);
  }
  const msg = collected.join("\n").trim();
  return msg || undefined;
}

const history: Record<string, Entry[]> = {};

const blocks = out.split(COMMIT).slice(1); // first split is empty
for (const block of blocks) {
  // block format: <hash>FIELD<date>FIELD<author>FIELD<subject>FIELD<body>EOH<newline><files...>
  const eohIdx = block.indexOf(EOH);
  if (eohIdx < 0) continue;
  const header = block.slice(0, eohIdx);
  const filesPart = block.slice(eohIdx + 1);
  const [hash, date, author, subject, ...bodyParts] = header.split(FIELD);
  if (!hash) continue;
  const body = bodyParts.join(FIELD); // body may legitimately contain FIELD chars; rejoin
  const publicMessage = extractPublic(body);
  const entry: Entry = {
    hash: hash.slice(0, 7),
    date: date ?? "",
    author: author ?? "",
    subject: subject ?? "",
    ...(publicMessage ? { publicMessage } : {}),
  };
  for (const line of filesPart.split("\n")) {
    const f = line.trim();
    if (!f.startsWith("content/")) continue;
    if (!f.endsWith(".md")) continue;
    if (!history[f]) history[f] = [];
    history[f].push(entry);
  }
}

// Add the repo URL once at the top so the component can build hash links.
const payload = {
  repo: REPO_URL,
  files: history,
};

mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/history.json", JSON.stringify(payload), "utf8");

const fileCount = Object.keys(history).length;
const totalCommits = Object.values(history).reduce((n, arr) => n + arr.length, 0);
console.log(`history: ${fileCount} files, ${totalCommits} entries → src/data/history.json`);
