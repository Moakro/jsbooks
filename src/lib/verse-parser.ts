/**
 * Verse parsers for two markdown formats:
 *
 *   (A) Legacy verse-anchor format — used by 동곡비서, 화은당실기, 천지개벽경 한글본 백업:
 *       ## N절 ^권-장-N
 *       본문 paragraph(s)
 *
 *   (B) Sentence-anchor format — used by 천지개벽경 (since the sentence-anchor migration):
 *       ## N절
 *       문장1. ^권-장-1
 *
 *       문장2. ^권-장-2
 *
 *   Use `parseVerses()` for (A); use `parseVerseGroups()` for (B).
 */

export interface ParsedVerse {
  num: number;
  id: string;
  /** Raw verse body text, trimmed. May contain multiple paragraphs separated by blank lines. */
  text: string;
}

/** Single sentence inside a verse group (format B). */
export interface ParsedSentence {
  /** Anchor id like `1-1-3`, `preface-2`. */
  anchor: string;
  /** Sentence text with the trailing `^anchor` marker stripped. */
  text: string;
}

/** A `## N절` group containing 1+ sentences (format B). */
export interface ParsedVerseGroup {
  num: number;
  sentences: ParsedSentence[];
}

const HEADING_RE = /^## (\d+)절 \^(\S+)[^\n]*$/gm;
// Group heading without anchor — required for the sentence-anchor format. The
// anchor regex below is non-greedy and excludes `## ` so a heading line is not
// matched as a sentence.
const GROUP_HEADING_RE = /^## (\d+)절\s*$/gm;
// Anchor character class includes `.` so that sub-anchors `X-Y-Z.N[.M...]`
// (인용구 묶음 안의 줄) are recognized by parsers.
const SENTENCE_ANCHOR_RE = /\s+\^([\w.-]+)\s*$/;

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

/**
 * Parse the sentence-anchor format. Returns one entry per `## N절` group,
 * each containing the sentences (paragraphs ending with `^anchor`) inside.
 *
 * Paragraphs without a trailing `^anchor` are silently dropped — they are
 * either incidental whitespace or content that has not been migrated.
 *
 * 평면 모델 (그룹 heading 없음) fallback: body 전체를 1개의 그룹(num=1)으로 처리.
 * 그룹이 없는 markdown(천지개벽경 ## N절 폐기 후)에서도 작동.
 */
export function parseVerseGroups(body: string): ParsedVerseGroup[] {
  if (!body) return [];
  const headings: { num: number; start: number; bodyStart: number }[] = [];
  GROUP_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GROUP_HEADING_RE.exec(body)) !== null) {
    headings.push({
      num: parseInt(m[1], 10),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }

  // 평면 모드: ## N절 heading이 없으면 body 전체가 한 그룹.
  if (headings.length === 0) {
    const sentences: ParsedSentence[] = [];
    // # N장 같은 헤딩 줄을 paragraph 분할 시 자연스럽게 무시.
    for (const para of body.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      if (/^#\s/.test(trimmed)) continue;
      const am = trimmed.match(SENTENCE_ANCHOR_RE);
      if (!am) continue;
      sentences.push({
        anchor: am[1],
        text: trimmed.replace(SENTENCE_ANCHOR_RE, "").trim(),
      });
    }
    return sentences.length > 0 ? [{ num: 1, sentences }] : [];
  }

  const out: ParsedVerseGroup[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const end = i + 1 < headings.length ? headings[i + 1].start : body.length;
    const groupBody = body.slice(h.bodyStart, end).trim();
    const sentences: ParsedSentence[] = [];
    for (const para of groupBody.split(/\n\s*\n/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const am = trimmed.match(SENTENCE_ANCHOR_RE);
      if (!am) continue;
      sentences.push({
        anchor: am[1],
        text: trimmed.replace(SENTENCE_ANCHOR_RE, "").trim(),
      });
    }
    out.push({ num: h.num, sentences });
  }
  return out;
}

/**
 * Flatten a sentence-anchor body into a `ParsedVerse[]` shape — one entry per
 * sentence, where `num` is the running sentence index (1-based) and `id` is
 * the sentence anchor. Used by indexers (verses.json, search) that want a
 * uniform per-anchor list regardless of group structure.
 */
export function parseSentencesFlat(body: string): ParsedVerse[] {
  const out: ParsedVerse[] = [];
  let n = 0;
  for (const g of parseVerseGroups(body)) {
    for (const s of g.sentences) {
      n++;
      out.push({ num: n, id: s.anchor, text: s.text });
    }
  }
  return out;
}
