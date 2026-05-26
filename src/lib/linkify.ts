/**
 * 일반 텍스트를 안전한 HTML 로 변환하면서 URL 만 `<a class="comment-link …">` 로 감싼다.
 *
 * 동작 — comments-worker 의 `linkifyEscaped` 와 동일 정책:
 *  - 내부 (jsbooks.wiki / www.jsbooks.wiki): 같은 탭, 표시는 상대경로 `./path/#anchor` (pill 톤)
 *  - 외부: 새 탭(`target="_blank" rel="noopener noreferrer nofollow ugc"`),
 *    표시는 원본 URL + `↗`
 *  - URL 끝의 일반 구두점은 anchor 밖으로 빼서 자연 흐름 유지
 *  - 줄바꿈은 `<br>`, 빈 줄로 단락을 나누지는 않음 (단일 영역용)
 *
 * 댓글이 worker 서버에서 sanitize/linkify 되는 것과 달리, 이 함수는
 * 클라이언트 사이드 plain-text 필드(달력 이벤트 memo 등)에 쓰인다.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/g;
const INTERNAL_HOSTS = new Set(["jsbooks.wiki", "www.jsbooks.wiki"]);

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function linkifyEscaped(esc: string): string {
  return esc.replace(URL_RE, (raw) => {
    let trailing = "";
    const m = raw.match(/[.,!?;:)\]}]+$/);
    if (m) {
      trailing = m[0];
      raw = raw.slice(0, raw.length - trailing.length);
    }
    const hostMatch = raw.match(/^https?:\/\/([^/?#]+)/i);
    const host = hostMatch ? hostMatch[1].toLowerCase() : "";
    if (INTERNAL_HOSTS.has(host)) {
      const pathFrag = raw.slice((hostMatch?.[0] ?? "").length) || "/";
      const display = `.${pathFrag}`;
      return `<a class="comment-link internal" href="${raw}">${display}</a>${trailing}`;
    }
    return `<a class="comment-link external" href="${raw}" target="_blank" rel="noopener noreferrer nofollow ugc">${raw} <span aria-hidden="true">↗</span></a>${trailing}`;
  });
}

/**
 * plain text → 안전한 HTML (URL → comment-link <a>, 줄바꿈 → <br>).
 * Svelte 의 `{@html …}` 또는 Astro 의 `set:html` 에 그대로 넣는 용도.
 */
export function linkifyPlain(text: string | null | undefined): string {
  if (!text) return "";
  const esc = escapeHTML(text);
  const withLinks = linkifyEscaped(esc);
  return withLinks.replace(/\n/g, "<br>");
}
