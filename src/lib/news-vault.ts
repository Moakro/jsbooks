/**
 * vault 기반 뉴스 헬퍼 — content collection 의 잔존 글(seed) 을 읽는다.
 *
 * 본 페이지(`/news/*`) 는 D1 fetch 로 전환되었지만 RSS·Sitemap 같이 빌드 타임에
 * 정적으로 생성되는 산출물은 vault 1차 데이터로 유지된다(추후 SSR 화 시 제거).
 */
import { getCollection, type CollectionEntry } from "astro:content";

/** 발행된 뉴스(draft 제외)를 date 내림차순으로 반환. */
export async function getPublishedNews(): Promise<CollectionEntry<"news">[]> {
  const all = await getCollection("news", (e) => !e.data.draft);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
