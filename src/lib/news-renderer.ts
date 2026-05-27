/**
 * 클라이언트 측 뉴스 마크다운 렌더러 — admin 미리보기 패널 전용.
 *
 * 워커(comments-worker/index.ts `renderNewsMarkdown`) 와 동일 알고리즘을
 * TS 로 미러링했다(저장 후의 body_html 과 미리보기가 동일해야 하므로).
 * 워커가 캐싱한 body_html 을 표시할 때는 이 함수가 필요 없다.
 *
 * Block: heading(#~####), unordered/ordered list, blockquote, fenced code,
 *        horizontal rule, paragraph(soft break = <br>).
 * Inline: `code`, **bold**, *italic*, [text](url) — 안전 URL(http/https/site-relative)만.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const safe = /^(https?:\/\/|\/)/i.test(url) ? url : "#";
    return `<a href="${safe}" rel="noopener">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

function renderBlock(block: string): string {
  const lines = block.split("\n");

  if (lines.length === 1) {
    const h = lines[0].match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const lvl = h[1].length;
      return `<h${lvl}>${renderInline(h[2])}</h${lvl}>`;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(lines[0])) return "<hr>";
  }

  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    const items = lines.map((l) => `<li>${renderInline(l.replace(/^[-*]\s+/, ""))}</li>`).join("");
    return `<ul>${items}</ul>`;
  }

  if (lines.every((l) => /^\d+\.\s+/.test(l))) {
    const items = lines.map((l) => `<li>${renderInline(l.replace(/^\d+\.\s+/, ""))}</li>`).join("");
    return `<ol>${items}</ol>`;
  }

  if (lines.every((l) => /^>\s?/.test(l))) {
    const inner = lines.map((l) => l.replace(/^>\s?/, "")).join("\n");
    return `<blockquote><p>${renderInline(inner.replace(/\n/g, " "))}</p></blockquote>`;
  }

  const inner = lines.map((l) => renderInline(l)).join("<br>\n");
  return `<p>${inner}</p>`;
}

export function renderNewsMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];
  let fence: string[] | null = null;

  const flush = () => {
    if (buf.length) { blocks.push(renderBlock(buf.join("\n"))); buf = []; }
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^```\s*$/.test(line)) {
        blocks.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flush();
      fence = [];
      continue;
    }
    if (line.trim() === "") {
      flush();
    } else {
      buf.push(line);
    }
  }
  if (fence !== null) {
    blocks.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  }
  flush();
  return blocks.join("\n");
}
