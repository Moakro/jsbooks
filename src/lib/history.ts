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

/** Category derived from a content/ path. */
export type ChangelogCategory =
  | { group: "scripture"; slug: string; label: string; href: string }
  | { group: "archive"; kind: ArchiveKind; slug: string; label: string; href: string };

export type ArchiveKind = "dates" | "dosu" | "people" | "places" | "terms";

export type ChangelogEntry = {
  entry: HistoryEntry;
  message: string;
  /** Distinct categories touched by this commit (typically 1). */
  categories: ChangelogCategory[];
  /** Additional commit hashes folded into this entry by aggregation. */
  groupedHashes: string[];
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

/* ───────────────── Site-wide changelog aggregation ───────────────── */

const SCRIPTURE_LABELS: Record<string, string> = {
  cheonjigaebyeokgyeong: "천지개벽경",
  "cheonjigaebyeokgyeong-hangeul": "천지개벽경(한글)",
  donggokbiseo: "동곡비서",
  "hwaeundang-silgi": "화은당실기",
};

const ARCHIVE_KINDS: ReadonlySet<ArchiveKind> = new Set([
  "dates",
  "dosu",
  "people",
  "places",
  "terms",
]);

const ARCHIVE_LABELS: Record<ArchiveKind, string> = {
  dates: "연표",
  dosu: "도수",
  people: "인물",
  places: "장소",
  terms: "용어",
};

/**
 * Map a `content/...` path to its changelog category. Returns null for paths
 * that should not be surfaced (mappings, _data, unknown sub-trees).
 */
export function categorizePath(path: string): ChangelogCategory | null {
  if (!path.startsWith("content/")) return null;
  const rel = path.slice("content/".length);

  if (rel.startsWith("scripture/")) {
    const slug = rel.slice("scripture/".length).split("/", 1)[0];
    if (!slug || slug.startsWith("_")) return null;
    const label = SCRIPTURE_LABELS[slug] ?? slug;
    return { group: "scripture", slug, label, href: `/library/${slug}/` };
  }

  const [maybeKind, ...rest] = rel.split("/");
  if (ARCHIVE_KINDS.has(maybeKind as ArchiveKind) && rest.length === 1) {
    const fileName = rest[0];
    if (!fileName.endsWith(".md")) return null;
    const slug = fileName.slice(0, -3);
    const kind = maybeKind as ArchiveKind;
    return {
      group: "archive",
      kind,
      slug,
      label: ARCHIVE_LABELS[kind],
      href: `/archive/${kind}/${slug}/`,
    };
  }

  return null;
}

/** Stable key that distinguishes one category target from another. */
function categoryKey(c: ChangelogCategory): string {
  return c.group === "scripture" ? `scripture:${c.slug}` : `archive:${c.kind}/${c.slug}`;
}

/**
 * Build the site-wide changelog feed from the per-file history index.
 *
 * - Dedupes by commit hash.
 * - Hides commits whose displayMessageForCommit() returns null.
 * - Drops commits that touched no categorizable path.
 * - Folds adjacent commits with the same effective message and overlapping
 *   category set within `groupWindowMs` into a single entry. Useful when a
 *   logical change is split across several commits (e.g. content fix +
 *   subsequent re-mapping) and they share the same `--public` text.
 */
export function aggregateChangelog(
  options: { groupWindowMs?: number } = {},
): ChangelogEntry[] {
  const groupWindowMs = options.groupWindowMs ?? 60 * 60 * 1000;

  const byHash = new Map<
    string,
    { entry: HistoryEntry; message: string; categoriesByKey: Map<string, ChangelogCategory> }
  >();

  for (const [path, entries] of Object.entries(files)) {
    const cat = categorizePath(path);
    if (!cat) continue;
    for (const e of entries) {
      let bucket = byHash.get(e.hash);
      if (!bucket) {
        const msg = displayMessageForCommit(e);
        if (!msg) continue;
        bucket = { entry: e, message: msg, categoriesByKey: new Map() };
        byHash.set(e.hash, bucket);
      }
      bucket.categoriesByKey.set(categoryKey(cat), cat);
    }
  }

  const items: ChangelogEntry[] = [];
  for (const { entry, message, categoriesByKey } of byHash.values()) {
    items.push({
      entry,
      message,
      categories: Array.from(categoriesByKey.values()),
      groupedHashes: [],
    });
  }

  items.sort((a, b) =>
    a.entry.date < b.entry.date ? 1 : a.entry.date > b.entry.date ? -1 : 0,
  );

  const grouped: ChangelogEntry[] = [];
  for (const item of items) {
    const head = grouped[grouped.length - 1];
    if (
      head &&
      head.message === item.message &&
      sameCategoryKeys(head.categories, item.categories) &&
      Date.parse(head.entry.date) - Date.parse(item.entry.date) <= groupWindowMs
    ) {
      head.groupedHashes.push(item.entry.hash);
      continue;
    }
    grouped.push(item);
  }

  return grouped;
}

function sameCategoryKeys(a: ChangelogCategory[], b: ChangelogCategory[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map(categoryKey));
  for (const c of b) if (!setA.has(categoryKey(c))) return false;
  return true;
}
