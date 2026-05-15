#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Build content/_data/scripture-versions.json from git log per scripture slug.
 *
 * For each subdirectory under content/scripture/ (excluding underscore-prefixed
 * meta dirs like _mappings), record the latest commit that touched it and emit
 * a v{yy.mm.dd} version derived from the committer date.
 *
 * Output shape:
 *   {
 *     "<slug>": { "version": "v26.05.14", "hash": "8bb4098", "iso": "2026-05-14T16:39:00+09:00" },
 *     ...
 *   }
 *
 * Consumers: scripture intro pages (display) + future PWA update-notice hook.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Version = { version: string; hash: string; iso: string };

const SCRIPTURE_ROOT = "content/scripture";
const LIBRARY_ROUTES = "src/pages/library";
const OUT_PATH = "content/_data/scripture-versions.json";

// A slug is "registered" only if it has a corresponding route directory.
// This skips legacy Korean-named source dirs under content/scripture/.
function listScriptureSlugs(): string[] {
  return readdirSync(SCRIPTURE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .filter((name) => existsSync(join(LIBRARY_ROUTES, name)));
}

function formatVersion(iso: string): string {
  // iso e.g. "2026-05-14T16:39:00+09:00" → "v26.05.14" (committer-local date part)
  const datePart = iso.slice(0, 10); // "2026-05-14"
  const [, mm, dd] = datePart.split("-");
  const yy = datePart.slice(2, 4);
  return `v${yy}.${mm}.${dd}`;
}

function readLatestCommit(slug: string): Version | null {
  const path = join(SCRIPTURE_ROOT, slug);
  const out = execSync(`git log -1 --format="%cI %h" -- "${path}"`, {
    encoding: "utf8",
  }).trim();
  if (!out) return null;
  const [iso, hash] = out.split(/\s+/);
  if (!iso || !hash) return null;
  return { version: formatVersion(iso), hash, iso };
}

const slugs = listScriptureSlugs();
const versions: Record<string, Version> = {};
for (const slug of slugs) {
  const v = readLatestCommit(slug);
  if (v) versions[slug] = v;
}

mkdirSync("content/_data", { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(versions, null, 2) + "\n", "utf8");

const summary = Object.entries(versions)
  .map(([slug, v]) => `  ${slug}: ${v.version} (${v.hash})`)
  .join("\n");
console.log(`scripture-versions: ${slugs.length} slugs → ${OUT_PATH}\n${summary}`);
