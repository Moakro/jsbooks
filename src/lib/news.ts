/**
 * news 공용 헬퍼 — 카테고리 라벨·날짜 포맷·D1 API 타입.
 * 순수 모듈(astro:content 의존 없음) — Astro frontmatter·Svelte 컴포넌트 모두에서 import 가능.
 *
 * 본문은 comments-worker `/api/news` (D1) 에서 fetch. vault 의 `content/news/*.md` 는
 * 더 이상 페이지 렌더에 사용되지 않으나 안전을 위해 파일은 남겨둔다.
 */

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

/** D1 /api/news 응답 row. */
export interface NewsItem {
  id: string;
  slug: string;
  title: string;
  category: NewsCategory;
  body_md: string;
  body_html: string;
  summary: string | null;
  draft: number;            // 0=published, 1=draft
  published_at: string | null;
  author_id: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 본문 마크다운 첫 단락에서 한 줄 요약 자동 추출.
 * heading(`#`), 리스트(`-`,`*`,숫자.), blockquote(`>`), code fence 라인은 skip.
 * 마크다운 강조 표식 제거 후 빈 줄까지 한 단락 → 200자까지.
 */
export function extractSummary(bodyMd: string | null | undefined): string {
  if (!bodyMd) return "";
  const lines = bodyMd.split("\n");
  const para: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (!line) {
      if (para.length > 0) break;
      continue;
    }
    if (/^(#{1,6}\s|[-*]\s|\d+\.\s|>\s)/.test(line)) continue;
    para.push(line);
  }
  const joined = para.join(" ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  return joined.slice(0, 200);
}

/** 'YYYY-MM-DDTHH:MM:SSZ' 또는 'YYYY-MM-DD HH:MM:SS' → 'YYYY.MM.DD'. */
export function fmtNewsDate(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
