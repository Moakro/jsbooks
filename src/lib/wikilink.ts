/**
 * Resolve an Obsidian-style wikilink target to a site URL.
 * The vault uses links like `[[강증산]]`, `[[강증산|대선생]]`, `[[01-07_장]]`.
 *
 * Strategy:
 *   1. Bare names match a card slug (people / places / dosu / terms / dates).
 *      We resolve them by lookup at build time via a manifest (passed in).
 *   2. Scripture chapter refs `NN-MM_장` route to /scripture/jang/<vol>/<chap>.
 *   3. Unknown targets render as plain text (no link), surfaced as build warning.
 */

export type CardKind = "people" | "places" | "dosu" | "terms" | "dates";

export interface CardEntry {
  kind: CardKind;
  canonical: string;
}

export interface CardManifest {
  /**
   * Map of name → resolved card entry.
   * Aliases (like "신축년" → { canonical: "신축년-1901" }) live here too,
   * pointing to the canonical slug used for the URL path.
   */
  byName: Map<string, CardEntry>;
}

const CHAPTER_RE = /^(\d{2})-(\d{2})_장$/;

export function resolveWikilink(
  target: string,
  manifest: CardManifest,
): { href: string; known: boolean } | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  // Scripture chapter: 01-07_장
  const m = trimmed.match(CHAPTER_RE);
  if (m) {
    const vol = parseInt(m[1], 10);
    const chap = parseInt(m[2], 10);
    return { href: `/scripture/${vol}/${chap}/`, known: true };
  }

  // Card lookup (canonical-aware: aliases resolve to their canonical slug)
  const entry = manifest.byName.get(trimmed);
  if (entry) {
    return {
      href: `/${entry.kind}/${encodeURIComponent(entry.canonical)}/`,
      known: true,
    };
  }

  // Unknown — return null so caller can render as plain text
  return null;
}

/**
 * Convert wikilinks within plain-text body to HTML <a> tags.
 * Format: [[target]] or [[target|display]]
 *
 * Uses placeholders so the markdown parser doesn't mangle [[..]] sequences.
 */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function renderWikilinks(text: string, manifest: CardManifest): string {
  return text.replace(WIKILINK_RE, (whole, target, display) => {
    const resolved = resolveWikilink(target, manifest);
    const label = display ?? target;
    if (!resolved) {
      return `<span class="wikilink-missing" title="대상 카드가 없습니다: ${escapeAttr(target)}">${escapeText(label)}</span>`;
    }
    return `<a class="wikilink" href="${resolved.href}">${escapeText(label)}</a>`;
  });
}

import { marked } from "marked";

/**
 * Render a markdown body to HTML, including wikilink resolution.
 * Wikilinks are resolved BEFORE markdown parsing using placeholders to
 * prevent [[..]] from being misinterpreted by the markdown parser.
 */
export function renderMarkdownBody(text: string, manifest: CardManifest): string {
  const placeholders: string[] = [];
  const PLACEHOLDER = (i: number) => `\x00WL${i}\x00`;

  const withPlaceholders = text.replace(WIKILINK_RE, (whole, target, display) => {
    const resolved = resolveWikilink(target, manifest);
    const label = display ?? target;
    let html: string;
    if (!resolved) {
      html = `<span class="wikilink-missing" title="대상 카드가 없습니다: ${escapeAttr(target)}">${escapeText(label)}</span>`;
    } else {
      html = `<a class="wikilink" href="${resolved.href}">${escapeText(label)}</a>`;
    }
    const idx = placeholders.length;
    placeholders.push(html);
    return PLACEHOLDER(idx);
  });

  let html = marked.parse(withPlaceholders, { async: false }) as string;

  // Restore placeholders
  html = html.replace(/\x00WL(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)]);
  return html;
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/**
 * Parse scripture entry id like "02_임인편/02-01_장" → { vol, chap }.
 */
export function parseScriptureId(id: string): { vol: number; chap: number } | null {
  const m = id.match(/(\d{2})_[^/]+\/(\d{2})-(\d{2})_장$/);
  if (!m) return null;
  return { vol: parseInt(m[1], 10), chap: parseInt(m[3], 10) };
}
