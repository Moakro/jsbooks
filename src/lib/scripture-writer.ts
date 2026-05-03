/**
 * Markdown serialization for scripture chapter files.
 *
 * - Verses are written sequentially: `## N절 ^anchor\n\n<text>\n\n`.
 * - When the input verse list omits an `id`, a fresh anchor is generated using
 *   the chapter context (e.g. `編-章-N` or `preface-N`).
 * - Blank `text` is allowed (placeholder verses) — they serialize as the
 *   heading followed by a blank body block.
 *
 * Pure functions only — no filesystem.
 */

export interface VerseInput {
  /** Existing anchor id (e.g. "1-1-3"). If omitted, will be generated. */
  id?: string;
  /** Verse body text. May be empty for placeholder. */
  text: string;
}

export interface SerializeContext {
  /** Heading text printed once before the verses (e.g. `# 1장`, `# 서(序)`). */
  chapterHeading: string;
  /** Frontmatter to preserve verbatim (already includes the surrounding `---`). */
  frontmatter: string;
  /** Anchor prefix for new verse ids. e.g. "1-1" → ids become "1-1-N". */
  anchorPrefix: string;
}

export interface SerializedChapter {
  markdown: string;
  /** Final ordered list of verses with their assigned anchors. */
  verses: { id: string; num: number; text: string }[];
  /**
   * Anchor migrations: oldId → newId. Includes only entries where the id
   * actually changed (e.g. due to renumbering after a merge/delete/split or
   * because an input had no id and one was generated).
   */
  migrations: Map<string, string>;
  /**
   * Anchors removed entirely (no replacement) — typical of merges where two
   * verses collapse into one. Mapping references should be combined or pruned.
   */
  removed: string[];
}

/**
 * Serialize a list of verses into a chapter markdown file.
 * Anchors are reassigned sequentially using `anchorPrefix-{N}` (1-indexed).
 *
 * If a verse has an existing id matching the new sequential anchor, no
 * migration is recorded for it. Otherwise the migration map gets `oldId → newId`.
 */
export function serializeChapter(
  verses: VerseInput[],
  ctx: SerializeContext,
): SerializedChapter {
  const lines: string[] = [];
  lines.push(ctx.frontmatter.trimEnd());
  lines.push("");
  lines.push(ctx.chapterHeading);
  lines.push("");

  const migrations = new Map<string, string>();
  const final: { id: string; num: number; text: string }[] = [];

  verses.forEach((v, i) => {
    const num = i + 1;
    const newId = `${ctx.anchorPrefix}-${num}`;
    const oldId = v.id;
    if (oldId && oldId !== newId) migrations.set(oldId, newId);
    if (!oldId) {
      // brand-new verse; record the assigned id under a synthetic key for callers
      // that need to map "this new verse" → newId. Convention: ":new:<index>".
      migrations.set(`:new:${i}`, newId);
    }
    final.push({ id: newId, num, text: v.text });

    lines.push(`## ${num}절 ^${newId}`);
    lines.push("");
    if (v.text.trim().length > 0) {
      lines.push(v.text.trim());
      lines.push("");
    } else {
      lines.push("");
    }
  });

  // removed = nothing intrinsic to this function; callers compute it by diffing
  // their previous verse list against the new one and pass the result on.
  return {
    markdown: lines.join("\n").replace(/\n{3,}$/, "\n") + (lines[lines.length - 1] === "" ? "" : "\n"),
    verses: final,
    migrations,
    removed: [],
  };
}

/**
 * Compute removed anchors: ids present in `before` but not in `after`'s ids
 * AND not present as keys (oldId) in migrations.
 */
export function computeRemoved(
  beforeIds: string[],
  afterIds: string[],
  migrations: Map<string, string>,
): string[] {
  const afterSet = new Set(afterIds);
  const movedFrom = new Set(migrations.keys());
  const removed: string[] = [];
  for (const old of beforeIds) {
    if (afterSet.has(old)) continue; // anchor still in same position
    if (movedFrom.has(old)) continue; // moved (renumbered); not removed
    removed.push(old);
  }
  return removed;
}

/**
 * Extract the frontmatter block (including --- delimiters) from a raw markdown file.
 * Returns the frontmatter string (or "") and the body without it.
 */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const m = raw.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[1], body: m[2] ?? "" };
}

/**
 * Extract the chapter heading line (`# ...`) from a body. Returns the heading
 * and the body with that heading removed.
 */
export function splitChapterHeading(body: string): { heading: string; rest: string } {
  const m = body.match(/^\s*(#\s[^\n]+)\n+([\s\S]*)$/);
  if (!m) return { heading: "", rest: body };
  return { heading: m[1].trim(), rest: m[2] };
}
