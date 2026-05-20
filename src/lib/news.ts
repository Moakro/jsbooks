/**
 * news 컬렉션 공용 헬퍼 — 카테고리 라벨·정렬·draft 필터.
 */
import { getCollection, type CollectionEntry } from "astro:content";

export type NewsCategory = "notice" | "update" | "release" | "roadmap";

export const NEWS_CATEGORIES: NewsCategory[] = [
  "notice",
  "update",
  "release",
  "roadmap",
];

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  notice: "공지",
  update: "업데이트",
  release: "릴리스",
  roadmap: "로드맵",
};

export function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat as NewsCategory] ?? cat;
}

/** 발행된 뉴스(draft 제외)를 date 내림차순으로 반환. */
export async function getPublishedNews(): Promise<CollectionEntry<"news">[]> {
  const all = await getCollection("news", (e) => !e.data.draft);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
