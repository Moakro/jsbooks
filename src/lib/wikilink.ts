/**
 * Resolve an Obsidian-style wikilink target to a site URL.
 * The vault uses links like `[[강증산]]`, `[[강증산|대선생]]`, `[[01-07_장]]`.
 *
 * Strategy:
 *   1. Bare names match a card slug (people / places / dosu / terms / dates).
 *      We resolve them by lookup at build time via a manifest (passed in).
 *   2. Scripture chapter refs `NN-MM_장` route to /library/jang/<vol>/<chap>.
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

// 천지개벽경 형식: 01-07_장 (편-장 hierarchical)
const CHAPTER_RE = /^(\d{2})-(\d{2})_장$/;
// 화은당실기 형식: 02_제2장 (장 only). 파일명 첫 2자리가 chap 번호.
const HWAEUNDANG_CHAP_RE = /^(\d{2})_제(\d+)장$/;

/**
 * Resolution result.
 *  - `mode: "card"` — opens in side-card sidebar (default behavior of `<a class="wikilink">`).
 *  - `mode: "page"` — full page navigation (chapter, preface, etc.).
 */
export type Resolved = {
  href: string;
  mode: "card" | "page";
};

export function resolveWikilink(
  target: string,
  manifest: CardManifest,
): Resolved | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  // Obsidian-style anchor: [[target#anchor]] 또는 [[target#^block-id]]
  // → 베이스 target 으로 라우팅하고 URL fragment 로 anchor 부여.
  let baseTarget = trimmed;
  let anchor: string | null = null;
  const hashIdx = trimmed.indexOf("#");
  if (hashIdx > 0) {
    baseTarget = trimmed.slice(0, hashIdx);
    const rawAnchor = trimmed.slice(hashIdx + 1);
    // Obsidian block reference: `^X-Y-Z` → URL fragment `X-Y-Z`
    anchor = rawAnchor.startsWith("^") ? rawAnchor.slice(1) : rawAnchor;
  }
  const frag = anchor ? `#${anchor}` : "";

  // Preface alias — full-page move (천지개벽경 only for now)
  if (baseTarget === "00_서" || baseTarget === "서") {
    return { href: `/library/cheonjigaebyeokgyeong/preface/${frag}`, mode: "page" };
  }

  // 천지개벽경 chapter: 01-07_장 → /library/cheonjigaebyeokgyeong/<vol>/<chap>/
  const cjg = baseTarget.match(CHAPTER_RE);
  if (cjg) {
    const vol = parseInt(cjg[1], 10);
    const chap = parseInt(cjg[2], 10);
    return { href: `/library/cheonjigaebyeokgyeong/${vol}/${chap}/${frag}`, mode: "page" };
  }
  // 화은당실기 chapter: 02_제2장 → /library/hwaeundang-silgi/<chap>/
  const hed = baseTarget.match(HWAEUNDANG_CHAP_RE);
  if (hed) {
    const chap = parseInt(hed[2], 10);
    return { href: `/library/hwaeundang-silgi/${chap}/${frag}`, mode: "page" };
  }

  // Card lookup — opens side-card. 카드(인물·장소·도수·용어·시기)는 /archive/ 섹션.
  const entry = manifest.byName.get(baseTarget);
  if (entry) {
    return {
      href: `/archive/${entry.kind}/${encodeURIComponent(entry.canonical)}/${frag}`,
      mode: "card",
    };
  }

  // Unknown — caller renders as missing
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
  return text.replace(WIKILINK_RE, (_whole, target, display) => {
    const resolved = resolveWikilink(target, manifest);
    const label = display ?? target;
    if (!resolved) {
      return `<span class="wikilink-missing" title="아직 보강되지 않은 카드입니다: ${escapeAttr(target)}">${escapeText(label)}</span>`;
    }
    return wikilinkAnchor(resolved, target, label, manifest);
  });
}

// data-card-kind/slug는 SideCard 등에서 절 내 특정 카드 wikilink 식별에 쓰임.
function wikilinkAnchor(
  resolved: Resolved,
  target: string,
  label: string,
  manifest: CardManifest,
): string {
  const cls = resolved.mode === "page" ? "wikilink page" : "wikilink";
  let dataAttrs = "";
  if (resolved.mode === "card") {
    // anchor 포함된 target 도 베이스로만 카드 조회
    const trimmed = target.trim();
    const hashIdx = trimmed.indexOf("#");
    const baseTarget = hashIdx > 0 ? trimmed.slice(0, hashIdx) : trimmed;
    const entry = manifest.byName.get(baseTarget);
    if (entry) {
      dataAttrs =
        ` data-card-kind="${escapeAttr(entry.kind)}"` +
        ` data-card-slug="${escapeAttr(entry.canonical)}"`;
    }
  }
  return `<a class="${cls}" href="${resolved.href}"${dataAttrs}>${escapeText(label)}</a>`;
}

import { marked } from "marked";

/**
 * footnote 정의 라인을 본문에서 분리 + inline ref `[^id]`를
 * `<sup class="fn-ref">` 태그로 치환. 사용자 기여 주석(`uc-` prefix)은
 * `fn-ref--uc` 클래스를 추가로 부여해 시각적으로 구분.
 *
 * 반환: { body: 정의 제거된 본문, footnotes: [{ id, raw }] }
 */
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.+)$/;

export interface FootnoteDef {
  id: string;
  raw: string;
}

export function extractFootnotes(text: string): { body: string; footnotes: FootnoteDef[] } {
  const lines = text.split("\n");
  const keep: string[] = [];
  const footnotes: FootnoteDef[] = [];
  for (const ln of lines) {
    const m = ln.match(FOOTNOTE_DEF_RE);
    if (m) {
      footnotes.push({ id: m[1], raw: m[2] });
    } else {
      keep.push(ln);
    }
  }
  return { body: keep.join("\n"), footnotes };
}

const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g;

function renderFootnoteRefInline(text: string): string {
  return text.replace(FOOTNOTE_REF_RE, (_whole, id) => {
    const isUc = id.startsWith("uc-");
    const cls = isUc ? "fn-ref fn-ref--uc" : "fn-ref";
    const safe = escapeAttr(id);
    return `<sup class="${cls}"><a href="#fn-${safe}" id="fnref-${safe}">${escapeText(id)}</a></sup>`;
  });
}

/**
 * Footnote 정의 목록을 HTML로 렌더링. 사용자 기여(`uc-`)는 `uc` 클래스 추가.
 * 호출자가 본문 아래에 직접 삽입한다.
 *
 * 입력 raw는 wikilink 등이 이미 적용된 HTML 조각이 아니므로, 호출자가 필요하면
 * 사전에 renderWikilinks를 적용해 둔다 (renderMarkdownBody 내부에서 처리).
 */
export function renderFootnotesHTML(footnotes: FootnoteDef[]): string {
  if (footnotes.length === 0) return "";
  const items = footnotes.map((fn) => {
    const isUc = fn.id.startsWith("uc-");
    const cls = isUc ? "fn-def fn-def--uc" : "fn-def";
    const safe = escapeAttr(fn.id);
    return `<li id="fn-${safe}" class="${cls}">${fn.raw} <a class="fn-backref" href="#fnref-${safe}" aria-label="원문으로">↩</a></li>`;
  });
  return `<aside class="footnotes" aria-label="주석"><ol>${items.join("")}</ol></aside>`;
}

/**
 * Render a markdown body to HTML, including wikilink resolution.
 * Wikilinks are resolved BEFORE markdown parsing using placeholders to
 * prevent [[..]] from being misinterpreted by the markdown parser.
 *
 * Footnotes (`[^id]: ...` 정의 + `[^id]` inline ref) 도 함께 처리. 정의는
 * 본문 아래 `<aside class="footnotes">` 블록으로, ref는 `<sup>` 링크로.
 */
export function renderMarkdownBody(text: string, manifest: CardManifest): string {
  const { body: bodyWithoutFootnotes, footnotes } = extractFootnotes(text);

  const placeholders: string[] = [];
  const PLACEHOLDER = (i: number) => `\x00WL${i}\x00`;

  const withWikilinks = bodyWithoutFootnotes.replace(WIKILINK_RE, (_whole, target, display) => {
    const resolved = resolveWikilink(target, manifest);
    const label = display ?? target;
    let html: string;
    if (!resolved) {
      html = `<span class="wikilink-missing" title="아직 보강되지 않은 카드입니다: ${escapeAttr(target)}">${escapeText(label)}</span>`;
    } else {
      html = wikilinkAnchor(resolved, target, label, manifest);
    }
    const idx = placeholders.length;
    placeholders.push(html);
    return PLACEHOLDER(idx);
  });

  // footnote inline ref 치환은 marked 통과 전에 sup HTML로 변환 (marked는 raw HTML 보존)
  const withFootnoteRefs = renderFootnoteRefInline(withWikilinks);

  let html = marked.parse(withFootnoteRefs, { async: false }) as string;
  html = html.replace(/\x00WL(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)]);

  if (footnotes.length > 0) {
    // 정의 본문에도 wikilink + inline markdown(링크) 적용. parseInline은 inline-level
    // markdown만 처리하므로 `<p>` 래핑 없이 깨끗하게 li 안에 들어감.
    const renderedDefs = footnotes.map((fn) => {
      const rawWithWiki = fn.raw.replace(WIKILINK_RE, (_w, target, display) => {
        const resolved = resolveWikilink(target, manifest);
        const label = display ?? target;
        if (!resolved) {
          return `<span class="wikilink-missing">${escapeText(label)}</span>`;
        }
        return wikilinkAnchor(resolved, target, label, manifest);
      });
      const inlineHtml = marked.parseInline(rawWithWiki, { async: false }) as string;
      return { id: fn.id, raw: inlineHtml };
    });
    html += renderFootnotesHTML(renderedDefs);
  }

  return html;
}

/**
 * 천지개벽경 sentence 본문같이 marked를 통과하지 않는 경로용 — wikilink + footnote
 * inline ref를 함께 처리. 정의 분리는 호출자가 별도로 다룬다.
 */
export function renderInlineWithFootnotes(text: string, manifest: CardManifest): string {
  return renderFootnoteRefInline(renderWikilinks(text, manifest));
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
