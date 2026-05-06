import data from "../data/history.json";
import displayData from "../../content/_data/changelog-display.json";

export type HistoryEntry = {
  hash: string;
  date: string;
  author: string;
  subject: string;
  /** When commit body had `--public ...`, the parsed user-facing message. */
  publicMessage?: string;
};

export type ChangelogOverride = {
  /** When false, hide the commit even if it has a publicMessage. */
  visible?: boolean;
  /** Custom user-facing message; takes priority over publicMessage. */
  message?: string;
};

const repo: string = (data as any).repo ?? "";
const files: Record<string, HistoryEntry[]> = (data as any).files ?? {};
const overrides: Record<string, ChangelogOverride> =
  (displayData as any)?.overrides ?? {};

/** Build a GitHub commit URL for a 7-char short hash. */
export function commitURL(hash: string): string {
  if (!repo) return "#";
  return `${repo}/commit/${hash}`;
}

/** Get history entries for a content path (relative to repo root). */
export function historyFor(relPath: string): HistoryEntry[] {
  return files[relPath] ?? [];
}

/**
 * Compute the user-facing message for a commit, or null when it should stay hidden.
 *
 * Resolution:
 *   1. override.visible === false → null (force-hidden)
 *   2. override.message → use as-is (force-shown with custom text)
 *   3. override.visible === true → fall back to publicMessage or subject
 *   4. publicMessage (from `--public` token) → auto-show
 *   5. otherwise → null (default-hidden)
 */
export function displayMessageForCommit(
  entry: HistoryEntry,
  ovr: ChangelogOverride | undefined = overrides[entry.hash],
): string | null {
  if (ovr?.visible === false) return null;
  if (ovr?.message && ovr.message.trim()) return ovr.message.trim();
  if (ovr?.visible === true) return entry.publicMessage ?? entry.subject;
  if (entry.publicMessage) return entry.publicMessage;
  return null;
}

/** Read-only access to the override map. */
export function getChangelogOverrides(): Record<string, ChangelogOverride> {
  return overrides;
}

/** Reconstruct content/ paths for site pages. */
export function scripturePath(volNum: number, chapNum: number, dirName: string, fileName: string) {
  // dirName = "01_신축편" etc., derived from collection entry id.
  return `content/scripture/cheonjigaebyeokgyeong/${dirName}/${fileName}`;
}

export function cardPath(kind: string, slug: string): string {
  return `content/${kind}/${slug}.md`;
}
