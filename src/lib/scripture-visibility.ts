/**
 * Scripture visibility gating.
 *
 * Some scripture slugs are admin-only (e.g. internal backups) and must never
 * surface to ordinary users — not in search, sidecard 연관/자료, backlinks,
 * the public changelog/feed, RSS, or AI/context JSON.
 *
 * This is the single source of truth: every user-facing surface filters
 * through `isUserVisibleScripture()` so the gating stays robust even when
 * upstream data (e.g. correspondences.json) is regenerated.
 */

/** Scripture slugs that are admin-only and hidden from all user surfaces. */
export const ADMIN_ONLY_SCRIPTURES: ReadonlySet<string> = new Set([
  // 천지개벽경 한글본 백업 — 관리자 전용 보존본.
  "cheonjigaebyeokgyeong-hangeul",
]);

/** True when the given scripture slug may be shown to ordinary users. */
export function isUserVisibleScripture(slug: string | undefined | null): boolean {
  if (!slug) return false;
  return !ADMIN_ONLY_SCRIPTURES.has(slug);
}
