/**
 * 일반 텍스트를 안전한 HTML 로 변환하면서 URL 만 `<a class="comment-link …">` 로 감싼다.
 *
 * 동작 — comments-worker 의 `linkifyEscaped` 와 동일 정책:
 *  - 내부 (jsbooks.wiki / www.jsbooks.wiki): 같은 탭, 표시는 사람이 읽는 한국어
 *    라벨 (예: "화은당실기 6장 2절"). path + hash 에서 자동 파싱.
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

const SCRIPTURE_NAME: Record<string, string> = {
  cheonjigaebyeokgyeong: "천지개벽경",
  "cheonjigaebyeokgyeong-hangeul": "천지개벽경 한글본",
  donggokbiseo: "동곡비서",
  "hwaeundang-silgi": "화은당실기",
};
const ARCHIVE_KIND: Record<string, string> = {
  people: "인물",
  places: "장소",
  dosu: "도수",
  terms: "용어",
  dates: "시기",
};

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 내부 URL 의 path + hash 에서 사람 친화 라벨 생성.
 *
 * 패턴별:
 *  - `/library/cheonjigaebyeokgyeong/<vol>/<chap>/#편-장-절` → "천지개벽경 1편 6장 1절"
 *  - `/library/cheonjigaebyeokgyeong/preface/#preface-N`     → "천지개벽경 서 N문장"
 *  - `/library/hwaeundang-silgi/<chap>/#장-절`              → "화은당실기 6장 2절"
 *  - `/library/donggokbiseo/#N` 또는 `#N-M`                  → "동곡비서 N절" / "동곡비서 N-M"
 *  - `/library/donggokbiseo/afterword/#anchor`              → "동곡비서 부록 anchor"
 *  - `/archive/people/<slug>/`                              → "인물: <slug>"
 *  - `/calendar/`, `/news/`, `/feed/` 등                    → 한국어 섹션 이름
 *  - 매칭 안 되면 fallback `./path#hash`
 *
 * raw 는 host 까지 포함한 절대 URL (escapeHTML 적용 전 원본 도메인).
 */
function readableInternalLabel(rawUrl: string): string {
  // host 제거 → path + hash
  const hostMatch = rawUrl.match(/^https?:\/\/[^/?#]+/i);
  const tail = hostMatch ? rawUrl.slice(hostMatch[0].length) : rawUrl;
  const hashIdx = tail.indexOf("#");
  const pathRaw = hashIdx >= 0 ? tail.slice(0, hashIdx) : tail;
  const hashRaw = hashIdx >= 0 ? tail.slice(hashIdx + 1) : "";
  let hash = "";
  try { hash = decodeURIComponent(hashRaw); } catch { hash = hashRaw; }
  const segments = pathRaw.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });

  const fallback = `.${pathRaw}${hashRaw ? "#" + hashRaw : ""}`;

  if (segments[0] === "library" && segments[1]) {
    const slug = segments[1];
    const name = SCRIPTURE_NAME[slug] ?? slug;

    if (slug === "cheonjigaebyeokgyeong" || slug === "cheonjigaebyeokgyeong-hangeul") {
      if (hash.startsWith("preface-")) {
        const n = hash.slice("preface-".length);
        return n ? `${name} 서 ${n}문장` : `${name} 서`;
      }
      const parts = hash.split("-");
      if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
        return `${name} ${parts[0]}편 ${parts[1]}장 ${parts[2]}절`;
      }
      if (segments[2] === "preface") return `${name} 서`;
      if (segments[2] && segments[3]) return `${name} ${segments[2]}편 ${segments[3]}장`;
      return name;
    }

    if (slug === "hwaeundang-silgi") {
      const parts = hash.split("-");
      if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
        return `${name} ${parts[0]}장 ${parts[1]}절`;
      }
      if (segments[2]) return `${name} ${segments[2]}장`;
      return name;
    }

    if (slug === "donggokbiseo") {
      if (segments[2] === "afterword") {
        return hash ? `${name} 부록 ${hash}` : `${name} 부록`;
      }
      if (/^\d+$/.test(hash)) return `${name} ${hash}절`;
      if (hash) return `${name} ${hash}`;
      return name;
    }

    return hash ? `${name} ^${hash}` : name;
  }

  if (segments[0] === "archive" && segments[1] && segments[2]) {
    const kind = ARCHIVE_KIND[segments[1]] ?? segments[1];
    return `${kind}: ${segments[2]}`;
  }

  if (segments.length === 0) return "홈";
  const SECTION: Record<string, string> = {
    calendar: "달력",
    news: "소식",
    feed: "피드",
    history: "변경 내역",
    admin: "관리자",
  };
  if (segments[0] in SECTION) {
    const label = SECTION[segments[0]];
    return segments[1] ? `${label} · ${segments.slice(1).join(" / ")}` : label;
  }

  return fallback;
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
      const display = readableInternalLabel(raw);
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

// 단위 테스트가 직접 호출할 수 있도록 노출.
export { readableInternalLabel };
