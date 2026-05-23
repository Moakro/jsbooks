#!/usr/bin/env node
/**
 * 동곡비서·화은당실기 문장 anchor 마이그 후 correspondences.yml 안의 curator/community
 * 항목의 OLD anchor 를 NEW anchor 로 일괄 갱신.
 *
 * 입력:
 *   content/_data/correspondences.yml
 *   content/_data/sentence-anchor-mapping-donggokbiseo.json
 *   content/_data/sentence-anchor-mapping-hwaeundang-silgi.json
 *
 * 동작:
 *   - `target: donggokbiseo#OLD` / `source: donggokbiseo#OLD` → 새 anchor 치환
 *   - `id: cheonjigaebyeokgyeong-...__donggokbiseo-OLD` → 새 anchor 반영
 *   - `hwaeundang-silgi` 도 동일
 *   - 누락된 OLD → 그대로 두고 [warn] 로그
 *
 * 사용법:
 *   node scripts/remap-correspondences-others.mjs
 *   node scripts/remap-correspondences-others.mjs --dry-run
 *
 * 이후 `pnpm build:correspondences -- 0.85` 로 AI 갱신 + id 정합성 재계산.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const YAML_PATH = path.join(ROOT, "content/_data/correspondences.yml");

const isDryRun = process.argv.includes("--dry-run");

const SLUGS = ["donggokbiseo", "hwaeundang-silgi"];

function loadMapping(slug) {
  const p = path.join(ROOT, "content/_data", `sentence-anchor-mapping-${slug}.json`);
  if (!fs.existsSync(p)) {
    console.error(`mapping JSON not found: ${p}. Run build-sentence-anchor-migration-others.mjs first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8")).mapping;
}

const mappings = {};
for (const slug of SLUGS) mappings[slug] = loadMapping(slug);

const raw = fs.readFileSync(YAML_PATH, "utf-8");

let changed = 0;
let warned = 0;
const warnings = [];

function remapAnchor(slug, oldAnchor) {
  const map = mappings[slug];
  const newAnchor = map[oldAnchor];
  if (!newAnchor) {
    warnings.push(`[${slug}] no mapping for OLD anchor "${oldAnchor}"`);
    warned++;
    return null;
  }
  return newAnchor;
}

const out = raw.replace(
  // (donggokbiseo|hwaeundang-silgi)#<anchor> 패턴 (id 필드 내 `__slug-anchor` hyphen 형식 포함)
  // `__donggokbiseo-244` 같이 `_` 앞은 `\b` 가 없으므로 negative lookbehind 로 처리.
  /(?<![a-zA-Z])(donggokbiseo|hwaeundang-silgi)([-#])([\w-]+?)(?=[\s,"']|$)/gm,
  (full, slug, sep, oldAnchor) => {
    const newAnchor = remapAnchor(slug, oldAnchor);
    if (!newAnchor) return full;
    changed++;
    return `${slug}${sep}${newAnchor}`;
  },
);

if (!isDryRun) {
  fs.writeFileSync(YAML_PATH, out);
}

console.log(`Remapped ${changed} anchor references in ${YAML_PATH}${isDryRun ? " (DRY RUN)" : ""}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warnings:`);
  for (const w of warnings.slice(0, 30)) console.log(`  ${w}`);
  if (warnings.length > 30) console.log(`  ... and ${warnings.length - 30} more`);
}
