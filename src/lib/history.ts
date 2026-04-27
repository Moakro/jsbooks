import data from "../data/history.json";

export type HistoryEntry = {
  hash: string;
  date: string;
  author: string;
  subject: string;
};

const repo: string = (data as any).repo ?? "";
const files: Record<string, HistoryEntry[]> = (data as any).files ?? {};

/** Build a GitHub commit URL for a 7-char short hash. */
export function commitURL(hash: string): string {
  if (!repo) return "#";
  return `${repo}/commit/${hash}`;
}

/** Get history entries for a content path (relative to repo root). */
export function historyFor(relPath: string): HistoryEntry[] {
  return files[relPath] ?? [];
}

/** Reconstruct content/ paths for site pages. */
export function scripturePath(volNum: number, chapNum: number, dirName: string, fileName: string) {
  // dirName = "01_신축편" etc., derived from collection entry id.
  return `content/scripture/cheonjigaebyeokgyeong/${dirName}/${fileName}`;
}

export function cardPath(kind: string, slug: string): string {
  return `content/${kind}/${slug}.md`;
}
