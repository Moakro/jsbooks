#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Build a per-file git history index at src/data/history.json.
 *
 * Source of truth: this repo's git log. Each commit that touched
 * `content/...` is listed. Because vault edits propagate via `pnpm sync:vault`,
 * the commit messages here are exactly what the operator wrote at deploy time.
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

type Entry = {
  hash: string;
  date: string;
  author: string;
  subject: string;
};

const REPO_URL = "https://github.com/Moakro/jsbooks";

// One git invocation: per-commit headers + file list, only for content/.
// COMMIT marks the start of every commit, FIELD separates fields inside the
// header, EOH marks end of header (file list follows).
const COMMIT = "\x03";
const FIELD = "\x01";
const EOH = "\x02";

// `-c core.quotePath=false` keeps Korean filenames in their literal form
// (otherwise git emits `\xxx\yyy` octal escapes that break the prefix check).
const out = execSync(
  `git -c core.quotePath=false log --pretty=format:"${COMMIT}%H${FIELD}%aI${FIELD}%an${FIELD}%s${EOH}" --name-only -- content`,
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const history: Record<string, Entry[]> = {};

const blocks = out.split(COMMIT).slice(1); // first split is empty
for (const block of blocks) {
  // block format: <hash>FIELD<date>FIELD<author>FIELD<subject>EOH<newline><files...>
  const eohIdx = block.indexOf(EOH);
  if (eohIdx < 0) continue;
  const header = block.slice(0, eohIdx);
  const filesPart = block.slice(eohIdx + 1);
  const [hash, date, author, subject] = header.split(FIELD);
  if (!hash) continue;
  const entry: Entry = {
    hash: hash.slice(0, 7),
    date: date ?? "",
    author: author ?? "",
    subject: subject ?? "",
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
