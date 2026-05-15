/**
 * Sidebar layout per site section.
 *
 * The sidebar is a section-local tool: it shows different sub-navigation
 * depending on where the user is. The 경전 section reserves the top of its
 * sidebar for the user's personal scripture library (rendered dynamically).
 *
 * `auth: true` items are visible only to logged-in users.
 */
import type { SectionSlug } from "./site-nav";

export type SidebarBlock =
  | {
      type: "scriptures-list";
    }
  | {
      type: "section";
      label: string;
      items: { label: string; path: string; auth?: boolean }[];
    }
  | {
      type: "link";
      label: string;
      path: string;
      auth?: boolean;
      icon?: "settings";
    };

export const SIDEBAR_BY_SECTION: Record<SectionSlug, SidebarBlock[]> = {
  home: [],

  scripture: [
    { type: "scriptures-list" },
    {
      type: "section",
      label: "자료",
      items: [
        { label: "인물", path: "/archive/people/" },
        { label: "장소", path: "/archive/places/" },
        { label: "도수", path: "/archive/dosu/" },
        { label: "용어", path: "/archive/terms/" },
        { label: "시기", path: "/archive/dates/" },
      ],
    },
    {
      type: "link",
      label: "경전 설정",
      path: "/account/library/",
      auth: true,
      icon: "settings",
    },
  ],

  archive: [
    {
      type: "section",
      label: "자료",
      items: [
        { label: "인물", path: "/archive/people/" },
        { label: "장소", path: "/archive/places/" },
        { label: "도수", path: "/archive/dosu/" },
        { label: "용어", path: "/archive/terms/" },
        { label: "시기", path: "/archive/dates/" },
      ],
    },
  ],

  news: [
    {
      type: "section",
      label: "카테고리",
      items: [
        { label: "공지", path: "/news/category/notice/" },
        { label: "업데이트", path: "/news/category/update/" },
        { label: "릴리스", path: "/news/category/release/" },
        { label: "로드맵", path: "/news/category/roadmap/" },
      ],
    },
    {
      type: "section",
      label: "최근",
      items: [
        { label: "1주", path: "/news/?since=7d" },
        { label: "1달", path: "/news/?since=30d" },
        { label: "전체", path: "/news/" },
      ],
    },
  ],

  feed: [
    {
      type: "section",
      label: "종류",
      items: [
        { label: "전체", path: "/feed/" },
        { label: "댓글", path: "/feed/comments/" },
        { label: "짧은 글", path: "/feed/posts/" },
        { label: "답사기", path: "/feed/visits/" },
        { label: "사진", path: "/feed/photos/" },
      ],
    },
    {
      type: "section",
      label: "시점",
      items: [
        { label: "오늘", path: "/feed/?since=1d" },
        { label: "1주", path: "/feed/?since=7d" },
        { label: "1달", path: "/feed/?since=30d" },
      ],
    },
    {
      type: "section",
      label: "댓글 종류",
      items: [
        { label: "메모", path: "/feed/comments/?type=memo" },
        { label: "질문", path: "/feed/comments/?type=question" },
        { label: "교차참조", path: "/feed/comments/?type=cross" },
        { label: "학술인용", path: "/feed/comments/?type=cite" },
      ],
    },
    {
      type: "link",
      label: "내 활동",
      path: "/feed/me/",
      auth: true,
    },
  ],

  calendar: [
    {
      type: "section",
      label: "보기",
      items: [
        { label: "월간", path: "/calendar/" },
        { label: "오늘", path: "/calendar/today/" },
      ],
    },
    {
      type: "link",
      label: "내 일정",
      path: "/calendar/me/",
      auth: true,
    },
  ],

  account: [
    {
      type: "section",
      label: "계정",
      items: [
        { label: "닉네임", path: "/account/nickname/" },
        { label: "내 서재", path: "/account/library/" },
      ],
    },
  ],

  admin: [
    {
      type: "link",
      label: "메인",
      path: "/admin/",
    },
    {
      type: "link",
      label: "회원관리",
      path: "/admin/users/",
    },
    {
      type: "link",
      label: "댓글 → 주석",
      path: "/admin/notes/",
    },
    {
      type: "section",
      label: "천지개벽경",
      items: [
        { label: "한자/한글 매핑", path: "/admin/canonical-mapping/" },
        { label: "한글본 백업", path: "/library/cheonjigaebyeokgyeong-hangeul/" },
      ],
    },
  ],
};

/** Pages that intentionally render full-width with no sidebar. */
export const NO_SIDEBAR_PATHS: ReadonlyArray<string> = [
  "/",
  "/search/",
  "/about/",
  "/changelog/",
];

export function shouldShowSidebar(pathname: string): boolean {
  if (NO_SIDEBAR_PATHS.includes(pathname)) return false;
  return true;
}
