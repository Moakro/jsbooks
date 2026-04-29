import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildCardManifest } from "../../../../lib/manifest";
import { renderWikilinks } from "../../../../lib/wikilink";

type Pair = { slug: string; anchor: string };

const VERSE_RE = /^## (\d+)절 \^(\S+)\s*\n([\s\S]*?)(?=^## \d+절|\Z)/gm;

async function collectAllVerses(): Promise<
  Array<Pair & { entry: any; verseNum: number; verseBody: string; vol?: number; chap?: number }>
> {
  const all = await getCollection("scripture");
  const out: any[] = [];
  for (const entry of all) {
    const slashIdx = entry.id.indexOf("/");
    const slug = slashIdx > 0 ? entry.id.slice(0, slashIdx) : entry.id;
    const isHierarchical = !!(entry.data.권 && entry.data.장);
    const isFlatVerses = entry.data.type === "verses";
    if (!isHierarchical && !isFlatVerses) continue;
    const body = entry.body ?? "";
    VERSE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VERSE_RE.exec(body)) !== null) {
      out.push({
        slug,
        anchor: m[2],
        verseNum: parseInt(m[1], 10),
        verseBody: m[3].trim(),
        entry,
        vol: entry.data.권,
        chap: entry.data.장,
      });
    }
  }
  return out;
}

export async function getStaticPaths() {
  const verses = await collectAllVerses();
  return verses.map((v) => ({
    params: { slug: v.slug, anchor: v.anchor },
    props: v,
  }));
}

export const GET: APIRoute = async ({ props }) => {
  const v = props as any;
  const manifest = await buildCardManifest();
  const paragraphs = (v.verseBody as string).split(/\n\s*\n/).filter(Boolean);
  const inner = paragraphs.map((p: string) => renderWikilinks(p, manifest)).join("\n\n");

  const scriptureName = v.entry.data.scripture ?? v.slug;
  const isHierarchical = !!(v.vol && v.chap);
  const title = isHierarchical
    ? `${scriptureName} 권${v.vol} ${v.entry.data.권_이름 ?? ""} · ${v.chap}장 ${v.verseNum}절`
    : `${scriptureName} · ${v.verseNum}절`;
  const pageHref = isHierarchical
    ? `/wiki/${v.slug}/${v.vol}/${v.chap}/#${v.anchor}`
    : `/wiki/${v.slug}/#${v.anchor}`;

  return new Response(
    JSON.stringify({
      kind: "verse",
      scriptureSlug: v.slug,
      scriptureName,
      anchor: v.anchor,
      verseNum: v.verseNum,
      vol: v.vol ?? null,
      chap: v.chap ?? null,
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
