/**
 * Cross-scripture correspondence lookups.
 *
 * Reads `content/_data/correspondences.yml` (built by
 * `scripts/build-correspondences.ts`) and exposes per-verse lookup so verse
 * pages can render an AI-match badge.
 */
import { readFileSync, existsSync } from "node:fs";

const YAML_PATH = "./content/_data/correspondences.yml";

export type CorrespondenceMatch = {
  /** Stable, deterministic ID — usable as comment thread target_id. */
  id: string;
  /** Source verse key, e.g. "donggokbiseo#047". */
  source: string;
  /** Target verse key, e.g. "cheonjigaebyeokgyeong#02-03-03". */
  target: string;
  similarity?: number;
  origin: "ai" | "curator" | "community";
  status: "active" | "hidden" | "confirmed" | "disputed";
  note?: string;
  /** Resolved scripture slug + anchor for both sides (helper). */
  source_slug: string;
  source_anchor: string;
  target_slug: string;
  target_anchor: string;
};

let cache: Map<string, CorrespondenceMatch[]> | null = null;

function parse(): Map<string, CorrespondenceMatch[]> {
  const out = new Map<string, CorrespondenceMatch[]>();
  if (!existsSync(YAML_PATH)) return out;
  const text = readFileSync(YAML_PATH, "utf8");

  let curSource: string | null = null;
  let curMatch: any = null;
  const flush = () => {
    if (curSource && curMatch && curMatch.target) {
      const m = mkMatch(curSource, curMatch);
      if (m && (m.status === "active" || m.status === "confirmed" || m.status === "disputed")) {
        if (!out.has(curSource)) out.set(curSource, []);
        out.get(curSource)!.push(m);
        // also index by target for reverse lookup
        if (!out.has(m.target)) out.set(m.target, []);
        out.get(m.target)!.push({
          ...m,
          source: m.target,
          target: m.source,
          source_slug: m.target_slug,
          source_anchor: m.target_anchor,
          target_slug: m.source_slug,
          target_anchor: m.source_anchor,
        });
      }
    }
    curMatch = null;
  };

  for (const ln of text.split("\n")) {
    if (!ln.trim() || ln.trim().startsWith("#")) continue;
    const sourceMatch = ln.match(/^- source:\s*(.+)$/);
    if (sourceMatch) {
      flush();
      curSource = sourceMatch[1].trim();
      continue;
    }
    if (/^\s*matches:\s*$/.test(ln)) continue;
    const targetMatch = ln.match(/^\s+- target:\s*(.+)$/);
    if (targetMatch) {
      flush();
      curMatch = { target: targetMatch[1].trim() };
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
  flush();
  return out;
}

function mkMatch(source: string, raw: any): CorrespondenceMatch | null {
  const target = raw.target as string;
  const [s_slug, s_anchor] = source.split("#");
  const [t_slug, t_anchor] = target.split("#");
  if (!s_slug || !s_anchor || !t_slug || !t_anchor) return null;
  return {
    id: raw.id ?? `${s_slug}-${s_anchor}__${t_slug}-${t_anchor}`,
    source,
    target,
    similarity: typeof raw.similarity === "number" ? raw.similarity : undefined,
    origin: (raw.origin ?? "ai") as CorrespondenceMatch["origin"],
    status: (raw.status ?? "active") as CorrespondenceMatch["status"],
    note: raw.note,
    source_slug: s_slug,
    source_anchor: s_anchor,
    target_slug: t_slug,
    target_anchor: t_anchor,
  };
}

function index(): Map<string, CorrespondenceMatch[]> {
  if (!cache) cache = parse();
  return cache;
}

/**
 * Return all correspondence matches for a given verse key,
 * e.g. `correspondencesFor("donggokbiseo", "047")`.
 */
export function correspondencesFor(slug: string, anchor: string): CorrespondenceMatch[] {
  const key = `${slug}#${anchor}`;
  return index().get(key) ?? [];
}

/** Build the URL fragment for a target verse. */
export function targetHref(m: CorrespondenceMatch): string {
  // Hierarchical anchors: e.g. "8-3-10" => /wiki/<slug>/8/3/#8-3-10
  const parts = m.target_anchor.split("-");
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    return `/wiki/${m.target_slug}/${parseInt(parts[0], 10)}/${parseInt(parts[1], 10)}/#${m.target_anchor}`;
  }
  // Flat: /wiki/<slug>/#<anchor>
  return `/wiki/${m.target_slug}/#${m.target_anchor}`;
}
