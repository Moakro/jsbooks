import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildCardManifest } from "../../../../lib/manifest";
import { renderWikilinks } from "../../../../lib/wikilink";

export const prerender = true;

const VERSE_RE = /^## (\d+)절 \^(\S+)\s*\n([\s\S]*?)(?=^## \d+절|\Z)/gm;

type VerseProps = {
  slug: string;
  anchor: string;
  verseNum: number;
  verseBody: string;
  vol: number | null;
  chap: number | null;
  scriptureName: string;
  volName: string | null;
};

export async function getStaticPaths() {
  const all = await getCollection("scripture");
  const out: { params: { slug: string; anchor: string }; props: VerseProps }[] = [];
  for (const entry of all) {
    const slashIdx = entry.id.indexOf("/");
    const slug = slashIdx > 0 ? entry.id.slice(0, slashIdx) : entry.id;
    const isHierarchical = !!(entry.data.권 && entry.data.장);
    const isFlatVerses = entry.data.type === "verses";
    if (!isHierarchical && !isFlatVerses) continue;
    const body = entry.body ?? "";
    const scriptureName = (entry.data as any).scripture ?? slug;
    const volName = (entry.data as any).권_이름 ?? null;
    VERSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VERSE_RE.exec(body)) !== null) {
      const anchor = m[2];
      out.push({
        params: { slug, anchor },
        props: {
          slug,
          anchor,
          verseNum: parseInt(m[1], 10),
          verseBody: m[3].trim(),
          vol: (entry.data as any).권 ?? null,
          chap: (entry.data as any).장 ?? null,
          scriptureName,
          volName,
        },
      });
    }
  }
  return out;
}

export const GET: APIRoute = async ({ props }) => {
  const v = props as unknown as VerseProps;
  const manifest = await buildCardManifest();
  const paragraphs = v.verseBody.split(/\n\s*\n/).filter(Boolean);
  const inner = paragraphs.map((p) => renderWikilinks(p, manifest)).join("\n\n");

  const isHierarchical = !!(v.vol && v.chap);
  const title = isHierarchical
    ? `${v.scriptureName} 권${v.vol} ${v.volName ?? ""} · ${v.chap}장 ${v.verseNum}절`
    : `${v.scriptureName} · ${v.verseNum}절`;
  const pageHref = isHierarchical
    ? `/wiki/${v.slug}/${v.vol}/${v.chap}/#${v.anchor}`
    : `/wiki/${v.slug}/#${v.anchor}`;

  return new Response(
    JSON.stringify({
      kind: "verse",
      scriptureSlug: v.slug,
      scriptureName: v.scriptureName,
      anchor: v.anchor,
      verseNum: v.verseNum,
      vol: v.vol,
      chap: v.chap,
      title,
      bodyHTML: inner,
      pageHref,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
};
