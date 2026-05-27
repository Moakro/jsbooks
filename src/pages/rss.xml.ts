import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { categoryLabel } from "../lib/news";
import { getPublishedNews } from "../lib/news-vault";

/**
 * 사이트 RSS 피드 — 공개 콘텐츠만.
 *
 * 피드 소스:
 *  - 공개 경전 카탈로그 3종(천지개벽경·동곡비서·화은당실기) — 항상 상단 고정.
 *  - news 컬렉션(공지·업데이트·릴리스·로드맵) — date 내림차순, draft 제외.
 *
 * `cheonjigaebyeokgyeong-hangeul`은 admin 전용 백업이므로 제외하며,
 * draft/placeholder 콘텐츠도 싣지 않는다.
 */

const NEWS_LIMIT = 30;

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate?: Date;
  categories?: string[];
}

// 공개 경전 카탈로그. 새 공개 경전이 추가되면 여기에 한 줄 더한다.
const scriptureItems: FeedItem[] = [
  {
    title: "천지개벽경",
    link: "/library/cheonjigaebyeokgyeong/",
    description:
      "학암 이중성이 상제님의 9년 천지공사를 권 9편 96장으로 정리한 종합 경전.",
  },
  {
    title: "동곡비서",
    link: "/library/donggokbiseo/",
    description:
      "동곡 성지에서 비전되던 별본을 1990년 이춘풍이 엮어 출간한 경전. 247절의 도통·도수·천지공사 말씀.",
  },
  {
    title: "화은당실기",
    link: "/library/hwaeundang-silgi/",
    description:
      "정사 김병철이 1960년에 편술한 증산법종교 연혁사. 화은당 강순임의 일대기와 6기초공사를 8장으로 정리.",
  },
];

export async function GET(context: APIContext) {
  const news = await getPublishedNews();
  const newsItems: FeedItem[] = news.slice(0, NEWS_LIMIT).map((entry) => ({
    title: entry.data.title,
    link: `/news/${entry.id}/`,
    description: entry.data.summary ?? entry.data.title,
    pubDate: entry.data.date,
    categories: [categoryLabel(entry.data.category)],
  }));

  // 경전 카탈로그 먼저, 그 다음 news 최신순.
  const items: FeedItem[] = [...scriptureItems, ...newsItems];

  return rss({
    title: "jsbooks — 증산계열 경전 디지털 서재",
    description: "증산계열 경전을 디지털로 보존하고 공개하는 jsbooks의 소식 피드.",
    // astro.config.mjs의 `site`를 재사용 — 도메인 중복 정의 금지.
    site: context.site!,
    items: items.map((item) => ({
      title: item.title,
      link: item.link,
      description: item.description,
      ...(item.pubDate ? { pubDate: item.pubDate } : {}),
      ...(item.categories ? { categories: item.categories } : {}),
    })),
    customData: "<language>ko</language>",
  });
}
