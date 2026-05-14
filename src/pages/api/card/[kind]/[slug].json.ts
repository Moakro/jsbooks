import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildCardManifest } from "../../../../lib/manifest";
import { renderMarkdownBody } from "../../../../lib/wikilink";
import {
  buildBacklinkIndex,
  backlinksFor,
  type Backlink,
} from "../../../../lib/backlinks";

export const prerender = true;

const KINDS = ["people", "places", "dosu", "terms", "dates"] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = {
  people: "인물",
  places: "지명",
  dosu: "도수",
  terms: "용어",
  dates: "시기",
};

export async function getStaticPaths() {
  const paths: { params: { kind: Kind; slug: string } }[] = [];
  for (const kind of KINDS) {
    const entries = await getCollection(kind);
    for (const entry of entries) {
      paths.push({ params: { kind, slug: entry.id } });
    }
  }
  return paths;
}

export const GET: APIRoute = async ({ params }) => {
  const kind = params.kind as Kind;
  const slug = params.slug as string;

  if (!KINDS.includes(kind)) {
    return new Response(JSON.stringify({ error: "unknown kind" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const entries = await getCollection(kind);
  const entry = entries.find((e) => e.id === slug);
  if (!entry) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const manifest = await buildCardManifest();
  const bodyHTML = renderMarkdownBody(entry.body ?? "", manifest);
  const backlinks = backlinksFor(await buildBacklinkIndex(), kind, slug);

  return new Response(
    JSON.stringify({
      kind,
      kindLabel: KIND_LABEL[kind],
      slug,
      name: entry.data.name,
      name_hanja: (entry.data as any).name_hanja ?? null,
      meta: extractMeta(entry.data, kind),
      status: entry.data.status ?? null,
      bodyHTML,
      pageHref: `/library/${kind}/${encodeURIComponent(slug)}/`,
      backlinks: backlinks.map((b) => ({
        ...b,
        href: backlinkHref(b),
      })),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
};

function backlinkHref(b: Backlink): string {
  if (b.kind === "scripture") {
    const anchor = b.verseId ? `#${b.verseId}` : "";
    if (b.vol && b.chap) {
      return `/library/${b.scriptureSlug}/${b.vol}/${b.chap}/${anchor}`;
    }
    return `/library/${b.scriptureSlug}/${anchor}`;
  }
  // 자료 카드(인물·지명·도수·용어·시기)는 /archive/ 섹션 (commit e6ec2d0 이후)
  return `/archive/${b.kind}/${encodeURIComponent(b.slug)}/`;
}

function extractMeta(data: any, kind: Kind): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (kind === "people") {
    if (data.birth) out.push({ label: "생", value: data.birth });
    if (data.birth_place) out.push({ label: "출생지", value: data.birth_place });
    if (data["本貫"]) out.push({ label: "본관", value: data["本貫"] });
  } else if (kind === "places" && data.region) {
    out.push({ label: "지역", value: data.region });
  } else if (kind === "dates") {
    if (data.ganji) out.push({ label: "간지", value: data.ganji });
    if (data.year) out.push({ label: "연도", value: String(data.year) });
  }
  return out;
}
