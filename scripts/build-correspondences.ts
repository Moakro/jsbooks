#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Build cross-scripture verse correspondences from the embedding NDJSON.
 *
 * Reads `.vectorize/vectors.ndjson` produced by `pnpm embed -- --no-upload`,
 * filters scripture-verse records (kind === "scripture", with verseId),
 * and computes pairwise cosine similarity ACROSS DIFFERENT SCRIPTURES only.
 *
 * Pairs with similarity >= THRESHOLD are written to
 * `content/_data/correspondences.yml` with origin: ai, status: active.
 *
 * Existing entries (origin: curator | community, or status: hidden / confirmed)
 * are preserved on rebuild — only origin: ai entries are refreshed.
 *
 * Usage:
 *   pnpm build:correspondences          # default threshold 0.85
 *   pnpm build:correspondences -- 0.90  # custom threshold
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const NDJSON_PATH = "./.vectorize/vectors.ndjson";
const OUT_PATH = "./content/_data/correspondences.yml";
const args = process.argv.slice(2);
const thresholdArg = args.find((a) => /^[0-9]*\.?[0-9]+$/.test(a));
const THRESHOLD = thresholdArg ? parseFloat(thresholdArg) : 0.85;

// ── 1. Load NDJSON ─────────────────────────────────────────
if (!existsSync(NDJSON_PATH)) {
  console.error(`NDJSON not found at ${NDJSON_PATH}.`);
  console.error("Run: pnpm embed -- --no-upload   first.");
  process.exit(1);
}

type Vector = {
  id: string;
  values: number[];
  metadata: {
    kind: string;
    title: string;
    href: string;
    snippet: string;
    scriptureSlug?: string;
    vol?: number;
    chap?: number;
    verse?: number;
    verseId?: string;
  };
};

const raw = readFileSync(NDJSON_PATH, "utf8").trim();
const lines = raw.split("\n").filter(Boolean);
const all: Vector[] = lines.map((l) => JSON.parse(l));

// Keep only scripture verses with embeddings + verseId
const verses = all.filter(
  (v) =>
    v.metadata.kind === "scripture" &&
    v.metadata.verseId &&
    v.metadata.scriptureSlug &&
    Array.isArray(v.values) &&
    v.values.length > 0,
);

if (verses.length === 0) {
  console.error("No scripture verse records with embeddings found.");
  console.error("Did you run with --dry-run? Re-run: pnpm embed -- --no-upload");
  process.exit(1);
}

console.log(
  `loaded ${verses.length} scripture verses ` +
    `(${[...new Set(verses.map((v) => v.metadata.scriptureSlug))].join(", ")})`,
);

// ── 2. Pre-normalize each vector for cosine = dot product ──
function normalize(v: number[]): Float32Array {
  const out = new Float32Array(v.length);
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  const norm = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

const normed: Float32Array[] = verses.map((v) => normalize(v.values));

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// Group verse indices by scripture slug
const bySlug = new Map<string, number[]>();
for (let i = 0; i < verses.length; i++) {
  const slug = verses[i].metadata.scriptureSlug!;
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug)!.push(i);
}
const slugs = [...bySlug.keys()];

// ── 3. Cross-scripture pairwise similarity ─────────────────
type Match = {
  source: string;
  target: string;
  similarity: number;
  source_title: string;
  target_title: string;
};

const matches: Match[] = [];
let pairsChecked = 0;

for (let s = 0; s < slugs.length; s++) {
  for (let t = s + 1; t < slugs.length; t++) {
    const aIndices = bySlug.get(slugs[s])!;
    const bIndices = bySlug.get(slugs[t])!;
    for (const i of aIndices) {
      for (const j of bIndices) {
        pairsChecked++;
        const sim = dot(normed[i], normed[j]);
        if (sim >= THRESHOLD) {
          const va = verses[i];
          const vb = verses[j];
          const sourceKey = `${slugs[s]}#${va.metadata.verseId}`;
          const targetKey = `${slugs[t]}#${vb.metadata.verseId}`;
          matches.push({
            source: sourceKey,
            target: targetKey,
            similarity: Math.round(sim * 10000) / 10000,
            source_title: va.metadata.title,
            target_title: vb.metadata.title,
          });
        }
      }
    }
  }
}

console.log(
  `checked ${pairsChecked.toLocaleString()} cross-scripture pairs, ` +
    `found ${matches.length} matches at similarity ≥ ${THRESHOLD}`,
);

matches.sort((a, b) => b.similarity - a.similarity);

// ── 4. Merge with existing curator/community entries ───────
type Existing = {
  source: string;
  matches: Array<{
    target: string;
    similarity?: number;
    origin?: string;
    status?: string;
    note?: string;
  }>;
};

let existing: Existing[] = [];
if (existsSync(OUT_PATH)) {
  // very small YAML reader for the format we own
  try {
    const existingRaw = readFileSync(OUT_PATH, "utf8");
    existing = parseSimpleYaml(existingRaw);
  } catch (e) {
    console.warn(`could not read existing ${OUT_PATH}, starting fresh`);
  }
}

// Build map: source → existing matches preserved (curator / community / hidden / confirmed)
const preserved = new Map<string, Existing["matches"]>();
for (const e of existing) {
  const keep = e.matches.filter(
    (m) => m.origin && m.origin !== "ai", // curator/community always preserved
  );
  // also preserve any AI-origin entry that operator marked
  const aiKept = e.matches.filter(
    (m) =>
      (!m.origin || m.origin === "ai") &&
      m.status &&
      m.status !== "active", // hidden / confirmed / disputed
  );
  if (keep.length || aiKept.length) {
    preserved.set(e.source, [...keep, ...aiKept]);
  }
}

// Group fresh AI matches by source
const grouped = new Map<string, Match[]>();
for (const m of matches) {
  if (!grouped.has(m.source)) grouped.set(m.source, []);
  grouped.get(m.source)!.push(m);
}

// Combine: for each source seen in either AI or preserved
const allSources = new Set<string>([...grouped.keys(), ...preserved.keys()]);

// ── 5. Emit YAML ───────────────────────────────────────────
function correspondenceId(source: string, target: string): string {
  // dgb-047-cgbg-02-03-03 style is more verbose; use a flatter slug
  return `${source.replace("#", "-").replace(/\//g, "-")}__${target.replace("#", "-").replace(/\//g, "-")}`;
}

const lines_out: string[] = [
  "# Auto-generated by scripts/build-correspondences.ts",
  "# DO NOT delete entries with origin: curator or origin: community.",
  "# AI-origin entries with status != active are also preserved on rebuild.",
  `# Threshold: ${THRESHOLD}   Generated: ${new Date().toISOString()}`,
  "",
];

const sortedSources = [...allSources].sort();
let totalEmitted = 0;
for (const source of sortedSources) {
  const aiMatches = grouped.get(source) ?? [];
  const preservedMatches = preserved.get(source) ?? [];

  // Skip preserved AI ones from being re-added by AI fresh pass (avoid duplicates)
  const preservedTargets = new Set(preservedMatches.map((m) => m.target));
  const freshAi = aiMatches.filter((m) => !preservedTargets.has(m.target));

  const all = [
    // preserved first (curator/community/non-active)
    ...preservedMatches.map((m) => ({
      target: m.target,
      similarity: m.similarity,
      origin: m.origin ?? "ai",
      status: m.status ?? "active",
      note: m.note,
    })),
    // fresh AI matches
    ...freshAi.map((m) => ({
      target: m.target,
      similarity: m.similarity,
      origin: "ai",
      status: "active",
      note: undefined as string | undefined,
    })),
  ];
  if (all.length === 0) continue;
  totalEmitted += all.length;

  lines_out.push(`- source: ${source}`);
  lines_out.push(`  matches:`);
  for (const m of all) {
    lines_out.push(`    - target: ${m.target}`);
    lines_out.push(`      id: ${correspondenceId(source, m.target)}`);
    if (typeof m.similarity === "number") lines_out.push(`      similarity: ${m.similarity}`);
    lines_out.push(`      origin: ${m.origin}`);
    lines_out.push(`      status: ${m.status}`);
    if (m.note) lines_out.push(`      note: ${JSON.stringify(m.note)}`);
  }
  lines_out.push("");
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, lines_out.join("\n"));
console.log(`wrote ${totalEmitted} matches across ${sortedSources.length} sources → ${OUT_PATH}`);

// Also emit a bidirectional JSON map for runtime lookup without fs.
const JSON_OUT = OUT_PATH.replace(/\.yml$/, ".json");
const jsonMap: Record<string, Array<{
  id: string;
  source: string;
  target: string;
  similarity?: number;
  origin: string;
  status: string;
  note?: string;
  source_slug: string;
  source_anchor: string;
  target_slug: string;
  target_anchor: string;
}>> = {};

function pushBoth(source: string, m: any) {
  const [s_slug, s_anchor] = source.split("#");
  const [t_slug, t_anchor] = m.target.split("#");
  if (!s_slug || !s_anchor || !t_slug || !t_anchor) return;
  const id = `${s_slug}-${s_anchor}__${t_slug}-${t_anchor}`;
  const status = m.status ?? "active";
  if (status === "hidden") return;
  const fwd = {
    id,
    source,
    target: m.target,
    similarity: m.similarity,
    origin: m.origin ?? "ai",
    status,
    note: m.note,
    source_slug: s_slug,
    source_anchor: s_anchor,
    target_slug: t_slug,
    target_anchor: t_anchor,
  };
  if (!jsonMap[source]) jsonMap[source] = [];
  jsonMap[source].push(fwd);
  if (!jsonMap[m.target]) jsonMap[m.target] = [];
  jsonMap[m.target].push({
    ...fwd,
    source: m.target,
    target: source,
    source_slug: t_slug,
    source_anchor: t_anchor,
    target_slug: s_slug,
    target_anchor: s_anchor,
  });
}

for (const source of sortedSources) {
  const aiMatches = grouped.get(source) ?? [];
  const preservedMatches = preserved.get(source) ?? [];
  const preservedTargets = new Set(preservedMatches.map((m) => m.target));
  for (const m of preservedMatches) pushBoth(source, m);
  for (const m of aiMatches) {
    if (preservedTargets.has(m.target)) continue;
    pushBoth(source, { target: m.target, similarity: m.similarity, origin: "ai", status: "active" });
  }
}

writeFileSync(JSON_OUT, JSON.stringify(jsonMap));
console.log(`wrote runtime lookup map → ${JSON_OUT}`);

// ── helpers ─────────────────────────────────────────────────
function parseSimpleYaml(text: string): Existing[] {
  // Owns its own format produced above. Parses single-doc YAML of:
  //   - source: <id>
  //     matches:
  //       - target: <id>
  //         similarity: <num>
  //         origin: <str>
  //         status: <str>
  //         note: "<json-encoded>"
  const out: Existing[] = [];
  let cur: Existing | null = null;
  let curMatch: any = null;
  for (const ln of text.split("\n")) {
    if (!ln.trim() || ln.trim().startsWith("#")) continue;
    const sourceMatch = ln.match(/^- source:\s*(.+)$/);
    if (sourceMatch) {
      if (cur) out.push(cur);
      cur = { source: sourceMatch[1].trim(), matches: [] };
      curMatch = null;
      continue;
    }
    if (/^\s*matches:\s*$/.test(ln)) continue;
    const targetMatch = ln.match(/^\s+- target:\s*(.+)$/);
    if (targetMatch && cur) {
      curMatch = { target: targetMatch[1].trim() };
      cur.matches.push(curMatch);
      continue;
    }
    const fieldMatch = ln.match(/^\s+(id|similarity|origin|status|note):\s*(.+)$/);
    if (fieldMatch && curMatch) {
      const k = fieldMatch[1];
      let v: any = fieldMatch[2].trim();
      if (k === "similarity") v = parseFloat(v);
      if (k === "note" && /^".*"$/.test(v)) v = JSON.parse(v);
      curMatch[k] = v;
    }
  }
  if (cur) out.push(cur);
  return out;
}
