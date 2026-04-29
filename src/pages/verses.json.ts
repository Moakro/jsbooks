import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildCardManifest } from "../lib/manifest";
import { renderWikilinks } from "../lib/wikilink";

export const prerender = true;

const VERSE_RE = /^## (\d+)절 \^(\S+)\s*\n([\s\S]*?)(?=^## \d+절|\Z)/gm;

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

    VERSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VERSE_RE.exec(body)) !== null) {
      const verseNum = parseInt(m[1], 10);
      const anchor = m[2];
      const verseBody = m[3].trim();
      const paragraphs = verseBody.split(/\n\s*\n/).filter(Boolean);
      const inner = paragraphs.map((p) => renderWikilinks(p, manifest)).join("\n\n");
      const title = isHierarchical
        ? `${scriptureName} 권${vol} ${volName ?? ""} · ${chap}장 ${verseNum}절`
        : `${scriptureName} · ${verseNum}절`;
      const pageHref = isHierarchical
        ? `/wiki/${slug}/${vol}/${chap}/#${anchor}`
        : `/wiki/${slug}/#${anchor}`;
      out[`${slug}#${anchor}`] = {
        scriptureSlug: slug,
        scriptureName,
        anchor,
        verseNum,
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
