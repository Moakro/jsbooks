import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildCardManifest } from "../lib/manifest";
import { renderWikilinks } from "../lib/wikilink";
import { parseVerses, parseSentencesFlat } from "../lib/verse-parser";

export const prerender = true;

type VerseEntry = {
  scriptureSlug: string;
  scriptureName: string;
  anchor: string;
  verseNum: number;
  vol: number | null;
  chap: number | null;
  title: string;
  bodyHTML: string;
  pageHref: string;
};

export const GET: APIRoute = async () => {
  const all = await getCollection("scripture");
  const manifest = await buildCardManifest();
  const out: Record<string, VerseEntry> = {};

  for (const entry of all) {
    const slashIdx = entry.id.indexOf("/");
    const slug = slashIdx > 0 ? entry.id.slice(0, slashIdx) : entry.id;
    const isHierarchical = !!(entry.data.권 && entry.data.장);
    const isFlatVerses = entry.data.type === "verses";
    if (!isHierarchical && !isFlatVerses) continue;

    const body = entry.body ?? "";
    const scriptureName = (entry.data as any).scripture ?? slug;
    const volName = (entry.data as any).권_이름 ?? null;
    const vol = (entry.data as any).권 ?? null;
    const chap = (entry.data as any).장 ?? null;

    // Sentence-anchor format (천지개벽경) emits one entry per sentence; the
    // legacy verse-anchor format (다른 경전) emits one entry per `## N절` block.
    // Both parsers return mutually exclusive matches on the same body, so try
    // the sentence parser first and fall back when it returns nothing.
    const sentenceVerses = parseSentencesFlat(body);
    const verses = sentenceVerses.length > 0 ? sentenceVerses : parseVerses(body);

    for (const v of verses) {
      const paragraphs = v.text.split(/\n\s*\n/).filter(Boolean);
      const inner = paragraphs.map((p) => renderWikilinks(p, manifest)).join("\n\n");
      const title = isHierarchical
        ? `${scriptureName} 권${vol} ${volName ?? ""} · ${chap}장 · ^${v.id}`
        : `${scriptureName} · ^${v.id}`;
      const pageHref = isHierarchical
        ? `/library/${slug}/${vol}/${chap}/#${v.id}`
        : `/library/${slug}/#${v.id}`;
      out[`${slug}#${v.id}`] = {
        scriptureSlug: slug,
        scriptureName,
        anchor: v.id,
        verseNum: v.num,
        vol,
        chap,
        title,
        bodyHTML: inner,
        pageHref,
      };
    }
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
