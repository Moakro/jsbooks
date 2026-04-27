/**
 * Top header navigation — 3 site sections.
 *
 * Order can be reshuffled later as the site matures (e.g. once user activity
 * grows, the operator may move "피드" or "소식" to the front).
 *
 * The header uses `prefix` to highlight the active section: any URL starting
 * with one of these prefixes lights up the corresponding tab.
 */
export type SectionSlug = "scripture" | "news" | "feed" | "account";

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
    slug: "scripture",
    label: "경전",
    href: "/scripture/",
    // Cards (인물·지명·도수·용어·시기) and the legacy /scripture/N/M/ paths
    // also belong to the 경전 section.
    prefixes: [
      "/scripture/",
      "/people/",
      "/places/",
      "/dosu/",
      "/terms/",
      "/dates/",
    ],
  },
  {
    slug: "news",
    label: "소식",
    href: "/news/",
    prefixes: ["/news/"],
  },
  {
    slug: "feed",
    label: "피드",
    href: "/feed/",
    prefixes: ["/feed/"],
  },
];

/** Account section is reachable from the user menu, not the main header. */
export const ACCOUNT_SECTION: SectionDef = {
  slug: "account",
  label: "계정",
  href: "/account/",
  prefixes: ["/account/"],
};

/** Resolve which section a URL path belongs to (or null for fully neutral pages). */
export function resolveSection(pathname: string): SectionSlug | null {
  for (const def of HEADER_NAV) {
    if (def.prefixes.some((p) => pathname.startsWith(p))) return def.slug;
  }
  if (ACCOUNT_SECTION.prefixes.some((p) => pathname.startsWith(p))) return "account";
  return null;
}
