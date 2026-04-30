/**
 * Cross-scripture correspondence lookups.
 *
 * Static import of the JSON lookup map produced by
 * `scripts/build-correspondences.ts`. Avoids `node:fs` so the same
 * module works under Cloudflare Workers prerender (no Node runtime).
 */
import data from "../../content/_data/correspondences.json";

export type CorrespondenceMatch = {
  id: string;
  source: string;
  target: string;
  similarity?: number;
  origin: "ai" | "curator" | "community";
  status: "active" | "hidden" | "confirmed" | "disputed";
  note?: string;
  source_slug: string;
  source_anchor: string;
  target_slug: string;
  target_anchor: string;
};

const index: Record<string, CorrespondenceMatch[]> =
  data as unknown as Record<string, CorrespondenceMatch[]>;

/**
 * Return all correspondence matches for a given verse key,
 * e.g. `correspondencesFor("donggokbiseo", "047")`.
 */
export function correspondencesFor(slug: string, anchor: string): CorrespondenceMatch[] {
  const key = `${slug}#${anchor}`;
  return index[key] ?? [];
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
