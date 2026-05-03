/**
 * Parse `## N절 ^anchor`-style verses from a markdown body.
 *
 * Replaces the legacy regex `/^## (\d+)절 \^(\S+)\s*\n([\s\S]*?)(?=^## \d+절|\Z)/gm`
 * which silently dropped the last verse because `\Z` is not a valid JS regex anchor.
 */
export interface ParsedVerse {
  num: number;
  id: string;
  /** Raw verse body text, trimmed. May contain multiple paragraphs separated by blank lines. */
  text: string;
}

const HEADING_RE = /^## (\d+)절 \^(\S+)[^\n]*$/gm;

export function parseVerses(body: string): ParsedVerse[] {
  if (!body) return [];
  const headings: { num: number; id: string; start: number; bodyStart: number }[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(body)) !== null) {
    headings.push({
      num: parseInt(m[1], 10),
      id: m[2],
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  const out: ParsedVerse[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
    const text = body.slice(h.bodyStart, end).trim();
    out.push({ num: h.num, id: h.id, text });
  }
  return out;
}
