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

      // Frontmatter `aliases` 필드 — 카드 본 이름 외 다른 호칭으로도 wikilink 해결.
      // 예: 강증산.md의 aliases: [대선생, 상제, 옥황상제] → [[대선생]] 등 모두 강증산으로.
      const aliases = (entry.data as { aliases?: string[] }).aliases;
      if (Array.isArray(aliases)) {
        for (const alias of aliases) {
          if (typeof alias === "string" && alias && !byName.has(alias)) {
            byName.set(alias, { kind, canonical: entry.id });
          }
        }
      }

      // 한자 alias — 천지개벽경처럼 본문이 한자 텍스트인 경전에서 매치되도록.
      // 예: 목천포.md `name_hanja: 木川浦` → `木川浦`도 목천포 카드로 라우팅.
      const data = entry.data as { name_hanja?: string; 호_한자?: string };
      const nameHanja = data.name_hanja ?? data.호_한자;
      if (typeof nameHanja === "string" && nameHanja && !byName.has(nameHanja)) {
        byName.set(nameHanja, { kind, canonical: entry.id });
      }
    }
  }

  return { byName };
}
