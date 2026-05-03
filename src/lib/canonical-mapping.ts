/**
 * 천지개벽경 canonical(한자 원문) ↔ 임시 한글본 매핑 헬퍼.
 *
 * - 매핑 JSON 위치: content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json
 * - 한자 anchor (e.g. "1-1-3", "preface-2") → 한글 anchor 1~N개
 */
import { getCollection } from "astro:content";
import { parseVerses } from "./verse-parser";
import mapping from "../../content/scripture/_mappings/cheonjigaebyeokgyeong-canonical.json" with { type: "json" };

export type VerseMapping = {
  hangeul: string[];
  confidence?: number;
  reviewed?: boolean;
};

export type MappingFile = {
  version: number;
  scripture: string;
  description?: string;
  verses: Record<string, VerseMapping>;
};

const MAPPING = mapping as MappingFile;

export function getMapping(anchor: string): VerseMapping | null {
  return MAPPING.verses[anchor] ?? null;
}

export function getAllMappings(): MappingFile {
  return MAPPING;
}

/**
 * Build a lookup table: 한글 anchor (e.g. "1-1-3") → { body, chapterId, num }.
 * Parses the temp 한글본 章 markdown bodies once.
 */
let hangeulCache: Map<string, { body: string; chapterId: string; num: number }> | null = null;

export async function buildHangeulIndex(): Promise<
  Map<string, { body: string; chapterId: string; num: number }>
> {
  if (hangeulCache) return hangeulCache;
  const all = await getCollection("scripture");
  const temp = all.filter((e) => e.id.startsWith("cheonjigaebyeokgyeong/"));
  const map = new Map<string, { body: string; chapterId: string; num: number }>();
  for (const entry of temp) {
    for (const v of parseVerses(entry.body ?? "")) {
      map.set(v.id, { body: v.text, chapterId: entry.id, num: v.num });
    }
  }
  hangeulCache = map;
  return map;
}

/** Resolve a list of 한글 anchors to their bodies. Missing anchors are skipped. */
export async function resolveHangeulVerses(
  anchors: string[]
): Promise<{ id: string; body: string; num: number; chapterId: string }[]> {
  const idx = await buildHangeulIndex();
  const out: { id: string; body: string; num: number; chapterId: string }[] = [];
  for (const a of anchors) {
    const v = idx.get(a);
    if (v) out.push({ id: a, ...v });
  }
  return out;
}

/** Aggregate stats across all 한자 절 anchors of a given canonical chapter. */
export function chapterMappingStats(
  hanjaAnchors: string[]
): { total: number; reviewed: number; mapped: number } {
  let reviewed = 0;
  let mapped = 0;
  for (const a of hanjaAnchors) {
    const m = MAPPING.verses[a];
    if (!m) continue;
    if (m.hangeul.length > 0) mapped++;
    if (m.reviewed) reviewed++;
  }
  return { total: hanjaAnchors.length, reviewed, mapped };
}
