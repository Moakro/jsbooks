/**
 * Top header navigation — 3 site sections.
 *
 * Order can be reshuffled later as the site matures (e.g. once user activity
 * grows, the operator may move "피드" or "소식" to the front).
 *
 * The header uses `prefix` to highlight the active section: any URL starting
 * with one of these prefixes lights up the corresponding tab.
 */
export type SectionSlug =
  | "home"
  | "scripture"
  | "reference"
  | "news"
  | "feed"
  | "calendar"
  | "account"
  | "admin";

export interface SectionDef {
  slug: SectionSlug;
  label: string;
  /** Primary entry point. */
  href: string;
  /**
   * URL prefixes that belong to this section. The first match wins, so order
   * the entries here from most-specific to least-specific within each section.
   */
  prefixes: string[];
}

/** ── Header order (rearrangeable) ── */
export const HEADER_NAV: SectionDef[] = [
  {
    slug: "home",
    label: "홈",
    href: "/",
    // Only the exact root acts as the home tab; non-root pages are matched by
    // their own section's prefixes below.
    prefixes: [],
  },
  {
    slug: "scripture",
    label: "서재",
    href: "/library/",
    // 경전 본문 prefix만. `/library/` root(catalog)는 resolveSection 별도 처리.
    prefixes: [
      "/library/cheonjigaebyeokgyeong",
      "/library/cheonjigaebyeokgyeong-hangeul",
      "/library/donggokbiseo",
      "/library/hwaeundang-silgi",
    ],
  },
  {
    slug: "reference",
    label: "자료",
    href: "/library/people/",
    // 카드 도서관 (인물·지명·도수·용어·시기) — 자료 섹션.
    prefixes: [
      "/library/people",
      "/library/places",
      "/library/dosu",
      "/library/terms",
      "/library/dates",
    ],
  },
  {
    slug: "feed",
    label: "피드",
    href: "/feed/",
    prefixes: ["/feed/"],
  },
  {
    slug: "news",
    label: "뉴스",
    href: "/news/",
    prefixes: ["/news/"],
  },
  {
    slug: "calendar",
    label: "달력",
    href: "/calendar/",
    prefixes: ["/calendar/"],
  },
];

/** Account section is reachable from the user menu, not the main header. */
export const ACCOUNT_SECTION: SectionDef = {
  slug: "account",
  label: "계정",
  href: "/account/",
  prefixes: ["/account/"],
};

/** Admin section is reachable from the sidebar bottom link (level >= 4 only). */
export const ADMIN_SECTION: SectionDef = {
  slug: "admin",
  label: "관리자",
  href: "/admin/",
  prefixes: ["/admin/"],
};

/** Resolve which section a URL path belongs to (or null for fully neutral pages). */
export function resolveSection(pathname: string): SectionSlug | null {
  if (pathname === "/") return "home";
  // /library/ root (catalog) — 경전 본문/카드 어느 specific prefix에도 매칭 X. 서재로 fallback.
  if (pathname === "/library/" || pathname === "/library") return "scripture";
  for (const def of HEADER_NAV) {
    if (def.prefixes.some((p) => pathname.startsWith(p))) return def.slug;
  }
  if (ACCOUNT_SECTION.prefixes.some((p) => pathname.startsWith(p))) return "account";
  if (ADMIN_SECTION.prefixes.some((p) => pathname.startsWith(p))) return "admin";
  return null;
}
