import { getCollection } from "astro:content";
import { buildCardManifest } from "./manifest";
import type { CardKind } from "./wikilink";
import { parseVerses, parseSentencesFlat } from "./verse-parser";

/**
 * Source location of a wikilink reference.
 * - For scripture: { kind: "scripture", vol, chap, verse?, label }
 * - For other cards: { kind, slug, label }
 */
export type Backlink =
  | {
      kind: "scripture";
      scriptureSlug: string;     // e.g. "cheonjigaebyeokgyeong" | "donggokbiseo"
      vol?: number;              // present for hierarchical scripture (권/장)
      chap?: number;
      verseId?: string;
      title: string;
      excerpt: string;
    }
  | {
      kind: CardKind;
      slug: string;
      title: string;
      excerpt: string;
    };

/** Map: target canonical key (e.g. "people:이마두") → list of backlinks */
export type BacklinkIndex = Map<string, Backlink[]>;

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const CHAPTER_REF = /^(\d{2})-(\d{2})_장$/;

/**
 * Build backlink index by scanning every collection's body.
 * Result is keyed by `kind:canonicalSlug` and stores ALL inbound references.
 */
export async function buildBacklinkIndex(): Promise<BacklinkIndex> {
  const manifest = await buildCardManifest();
  const index: BacklinkIndex = new Map();

  function add(targetKey: string, link: Backlink) {
    if (!index.has(targetKey)) index.set(targetKey, []);
    index.get(targetKey)!.push(link);
  }

  function extractTargets(body: string): string[] {
    const targets: string[] = [];
    let m: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      targets.push(m[1].trim());
    }
    return targets;
  }

  function shortExcerpt(body: string, around: string, max = 140): string {
    // strip wikilink syntax for excerpt readability
    const plain = body.replace(WIKILINK_RE, (_, t, d) => d ?? t);
    const idx = plain.indexOf(around);
    if (idx < 0) {
      return plain.slice(0, max).replace(/\s+/g, " ").trim();
    }
    const start = Math.max(0, idx - 40);
    const end = Math.min(plain.length, idx + around.length + 80);
    return (
      (start > 0 ? "…" : "") +
      plain.slice(start, end).replace(/\s+/g, " ").trim() +
      (end < plain.length ? "…" : "")
    );
  }

  // ------- Scripture (verses, with verse-level granularity) -------
  const scripture = await getCollection("scripture");
  for (const entry of scripture) {
    // entry.id is "<scripture-slug>/<path>" — first segment is the scripture slug
    const slashIdx = entry.id.indexOf("/");
    const scriptureSlug = slashIdx > 0 ? entry.id.slice(0, slashIdx) : entry.id;

    const vol = entry.data.권;
    const chap = entry.data.장;
    const isHierarchical = !!(vol && chap);
    const isFlatVerses = entry.data.type === "verses";
    if (!isHierarchical && !isFlatVerses) continue;

    const scriptureName = entry.data.scripture ?? scriptureSlug;
    // Sentence-anchor format (천지개벽경) emits one entry per sentence; legacy
    // verse-anchor format (다른 경전) emits one per `## N절`. The two parsers
    // are mutually exclusive on the same body — try sentence first, fall back.
    const sentenceVerses = parseSentencesFlat(entry.body ?? "");
    const isSentenceAnchor = sentenceVerses.length > 0;
    const verseList = isSentenceAnchor ? sentenceVerses : parseVerses(entry.body ?? "");
    for (const v of verseList) {
      const targets = extractTargets(v.text);
      const seen = new Set<string>();
      const verseLabel = isSentenceAnchor ? `^${v.id}` : `${v.num}절`;
      const title = isHierarchical
        ? `권 ${vol} ${entry.data.권_이름 ?? ""} · ${chap}장 ${verseLabel}`
        : `${scriptureName} · ${verseLabel}`;
      for (const target of targets) {
        const key = resolveKey(target, manifest);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        add(key, {
          kind: "scripture",
          scriptureSlug,
          ...(isHierarchical ? { vol, chap } : {}),
          verseId: v.id,
          title,
          excerpt: shortExcerpt(v.text, target),
        });
      }
    }
  }

  // ------- Cards (people / places / dosu / terms / dates) -------
  const cardKinds: CardKind[] = ["people", "places", "dosu", "terms", "dates"];
  for (const kind of cardKinds) {
    const entries = await getCollection(kind);
    for (const entry of entries) {
      const body = entry.body ?? "";
      const targets = extractTargets(body);
      const seen = new Set<string>();
      for (const target of targets) {
        const key = resolveKey(target, manifest);
        if (!key) continue;
        // self-reference skip
        if (key === `${kind}:${entry.id}`) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        add(key, {
          kind,
          slug: entry.id,
          title: (entry.data as any).name ?? entry.id,
          excerpt: shortExcerpt(body, target),
        });
      }
    }
  }

  return index;
}

function resolveKey(target: string, manifest: Awaited<ReturnType<typeof buildCardManifest>>): string | null {
  const trimmed = target.trim();
  // Preface alias
  if (trimmed === "00_서" || trimmed === "서") {
    return "scripture:preface";
  }
  // Scripture chapter reference like "01-07_장" -> "scripture:1:7"
  const m = trimmed.match(CHAPTER_REF);
  if (m) {
    return `scripture:${parseInt(m[1], 10)}:${parseInt(m[2], 10)}`;
  }
  const entry = manifest.byName.get(trimmed);
  if (!entry) return null;
  return `${entry.kind}:${entry.canonical}`;
}

/** Lookup helpers used by pages */
export function backlinksFor(
  index: BacklinkIndex,
  kind: CardKind,
  slug: string,
): Backlink[] {
  return index.get(`${kind}:${slug}`) ?? [];
}
