import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { buildCardManifest } from "../lib/manifest";
import type { CardManifest } from "../lib/wikilink";
import { parseSentencesFlat, parseVerses } from "../lib/verse-parser";
import { correspondencesFor } from "../lib/correspondences";
import { getMapping } from "../lib/canonical-mapping";

export const prerender = true;

type ScriptureRef = { slug: string; anchor: string; title: string };
type CardRef = { kind: string; slug: string; name: string; anchors: string[] };

type ChapterContext = {
  scripture_refs: ScriptureRef[];
  card_refs: CardRef[];
  verse_anchors: string[];
};

// `[[target]]` 또는 `[[target|display]]` 패턴에서 target 부분만 추출.
function extractWikilinkTargets(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

function resolveCardRef(target: string, manifest: CardManifest): Omit<CardRef, "anchors"> | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  if (trimmed === "00_서" || trimmed === "서") return null;
  if (/^\d{2}-\d{2}_장$/.test(trimmed)) return null;
  const entry = manifest.byName.get(trimmed);
  if (!entry) return null;
  return { kind: entry.kind, slug: entry.canonical, name: entry.canonical };
}

function chapterKeyForEntry(slug: string, data: Record<string, unknown>): string | null {
  const vol = data.권 as number | undefined;
  const chap = data.장 as number | undefined;
  const section = data.section as string | undefined;
  const type = data.type as string | undefined;

  if (slug === "cheonjigaebyeokgyeong") {
    if (section === "preface") return "preface";
    if (typeof vol === "number" && typeof chap === "number") return `${vol}-${chap}`;
    return null;
  }
  if (slug === "hwaeundang-silgi") {
    if (section === "preface") return "preface";
    if (section === "appendix") return "appendix";
    if (typeof chap === "number") return String(chap);
    return null;
  }
  if (slug === "donggokbiseo") {
    // 평면 — 본문 전체가 단일 chapter "0"
    if (type === "verses") return "0";
    if (section === "preface") return "preface";
    if (section === "afterword") return "afterword";
    return null;
  }
  return null;
}

const SCRIPTURE_NAME: Record<string, string> = {
  cheonjigaebyeokgyeong: "천지개벽경",
  donggokbiseo: "동곡비서",
  "hwaeundang-silgi": "화은당실기",
};

export const GET: APIRoute = async () => {
  const all = await getCollection("scripture");
  const manifest = await buildCardManifest();

  // verses.json과 동일 인덱스 — title 채우기 용도
  const verseTitles = new Map<string, string>();
  for (const entry of all) {
    const slashIdx = entry.id.indexOf("/");
    const slug = slashIdx > 0 ? entry.id.slice(0, slashIdx) : entry.id;
    const data = entry.data as Record<string, unknown>;
    const isHierarchical = !!(data.권 && data.장);
    const isFlat = data.type === "verses";
    if (!isHierarchical && !isFlat) continue;
    const body = entry.body ?? "";
    const sentenceVerses = parseSentencesFlat(body);
    const verses = sentenceVerses.length > 0 ? sentenceVerses : parseVerses(body);
    const scriptureName = SCRIPTURE_NAME[slug] ?? slug;
    const volName = (data["권_이름"] as string | undefined) ?? "";
    const vol = data.권 as number | undefined;
    const chap = data.장 as number | undefined;
    for (const v of verses) {
      const title = isHierarchical
        ? `${scriptureName} 권${vol} ${volName} · ${chap}장 · ^${v.id}`.trim()
        : `${scriptureName} · ^${v.id}`;
      verseTitles.set(`${slug}#${v.id}`, title);
    }
  }

  const out: Record<string, ChapterContext> = {};

  for (const entry of all) {
    const slashIdx = entry.id.indexOf("/");
    const slug = slashIdx > 0 ? entry.id.slice(0, slashIdx) : entry.id;
    const data = entry.data as Record<string, unknown>;
    const chapterKey = chapterKeyForEntry(slug, data);
    if (!chapterKey) continue;
    const body = entry.body ?? "";
    if (!body) continue;

    const outKey = `${slug}/${chapterKey}`;
    const ctx: ChapterContext = (out[outKey] ??= {
      scripture_refs: [],
      card_refs: [],
      verse_anchors: [],
    });

    const scriptureRefSeen = new Set<string>();
    const cardRefByKey = new Map<string, CardRef>();
    const verseSeen = new Set<string>(ctx.verse_anchors);

    const sentenceVerses = parseSentencesFlat(body);
    const verses = sentenceVerses.length > 0 ? sentenceVerses : parseVerses(body);

    // DEBUG: hwaeundang/2 만
    if (slug === "hwaeundang-silgi" && chapterKey === "2") {
      console.log(`[DEBUG] ${outKey}: body length=${body.length}, verses=${verses.length}`);
      console.log(`[DEBUG] body[0..400]=`, JSON.stringify(body.slice(0, 400)));
      console.log(`[DEBUG] body[400..800]=`, JSON.stringify(body.slice(400, 800)));
      for (const v of verses) {
        console.log(`  [DEBUG] verse ${v.id}: text=${JSON.stringify(v.text)}`);
      }
    }

    for (const v of verses) {
      if (!verseSeen.has(v.id)) {
        ctx.verse_anchors.push(v.id);
        verseSeen.add(v.id);
      }

      // correspondences → 서재 탭
      for (const m of correspondencesFor(slug, v.id)) {
        if (m.status === "hidden") continue;
        const key = `${m.target_slug}#${m.target_anchor}`;
        if (scriptureRefSeen.has(key)) continue;
        scriptureRefSeen.add(key);
        ctx.scripture_refs.push({
          slug: m.target_slug,
          anchor: m.target_anchor,
          title: verseTitles.get(key) ?? `${SCRIPTURE_NAME[m.target_slug] ?? m.target_slug} · ^${m.target_anchor}`,
        });
      }

      // wikilinks → 자료 탭
      // source: 절 본문 + (cheonjigaebyeokgyeong 한정) canonical mapping의 한글 텍스트.
      const sources: string[] = [v.text];
      if (slug === "cheonjigaebyeokgyeong") {
        const mp = getMapping(v.id);
        if (mp?.hangeul) sources.push(mp.hangeul);
      }
      const seenInVerse = new Set<string>();
      for (const src of sources) {
        for (const target of extractWikilinkTargets(src)) {
          const ref = resolveCardRef(target, manifest);
          if (!ref) continue;
          const key = `${ref.kind}:${ref.slug}`;
          if (seenInVerse.has(key)) continue;
          seenInVerse.add(key);
          let existing = cardRefByKey.get(key);
          if (!existing) {
            existing = { ...ref, anchors: [] };
            cardRefByKey.set(key, existing);
            ctx.card_refs.push(existing);
          }
          existing.anchors.push(v.id);
        }
      }
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
