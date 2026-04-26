import { getCollection } from "astro:content";
import type { CardManifest, CardKind } from "./wikilink";

/**
 * Build a name → kind manifest from all card collections.
 * Keys are file slugs (== card names like "강증산").
 *
 * Aliases:
 *   - dates: a slug like "신축년-1901" registers an alias "신축년"
 *     so bare references in scripture work too.
 */
export async function buildCardManifest(): Promise<CardManifest> {
  const byName = new Map<string, { kind: CardKind; canonical: string }>();

  const kinds: CardKind[] = ["people", "places", "dosu", "terms", "dates"];
  for (const kind of kinds) {
    const entries = await getCollection(kind);
    for (const entry of entries) {
      byName.set(entry.id, { kind, canonical: entry.id });

      // Auto-aliases for dates: "신축년-1901" → "신축년"
      if (kind === "dates") {
        const m = entry.id.match(/^(.+?)-\d{4}$/);
        if (m && !byName.has(m[1])) {
          byName.set(m[1], { kind, canonical: entry.id });
        }
      }
    }
  }

  return { byName };
}
