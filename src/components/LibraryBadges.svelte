<script lang="ts">
  /**
   * 라이브러리 카드에 "새 댓글" 빨간 배지를 주입.
   *
   *  mode="scriptures" — `/library/` 카드 그리드:
   *     `[data-scripture-slug]` 요소들에 그 경전 전체 새 댓글 합계를 배지로.
   *
   *  mode="chapters" — 경전 intro 페이지 (e.g. `/library/cheonjigaebyeokgyeong/`):
   *     `[data-chapter-anchor]` 요소들에 그 장의 새 댓글 수를 배지로.
   *     scriptureSlug prop 필수.
   *
   * 비로그인: API total을 받고 localStorage의 `lv:<slug>:<chapter>`로 미방문이면
   *   total을 new로 간주, 방문했으면 0 (server timestamps 없음).
   */
  import { onMount } from "svelte";

  let { mode, scriptureSlug }: { mode: "scriptures" | "chapters"; scriptureSlug?: string } = $props();

  type Entry = { total: number; new: number };

  function applyBadge(el: HTMLElement, entry: Entry) {
    // 기존 배지 정리
    el.querySelectorAll(".lb-badge").forEach((b) => b.remove());
    if (entry.new <= 0) return;
    const span = document.createElement("span");
    span.className = "lb-badge";
    span.textContent = entry.new > 99 ? "99+" : String(entry.new);
    span.setAttribute("aria-label", `새 댓글 ${entry.new}개`);
    span.title = `새 댓글 ${entry.new}개`;
    el.appendChild(span);
  }

  function getLastVisit(slug: string, chapter: string): string | null {
    try {
      return localStorage.getItem(`lv:${slug}:${chapter}`);
    } catch {
      return null;
    }
  }

  async function run() {
    if (mode === "scriptures") {
      try {
        const res = await fetch("/api/visits/badges", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json() as { scriptures?: Record<string, Entry>; anonymous?: boolean };
        const scriptures = data.scriptures ?? {};
        document.querySelectorAll<HTMLElement>("[data-scripture-slug]").forEach((el) => {
          const slug = el.dataset.scriptureSlug!;
          const entry = scriptures[slug];
          if (!entry) return;
          let resolved: Entry = { total: entry.total, new: entry.new };
          if (data.anonymous) {
            // anonymous → API new 는 0. 회원 본인 방문 기록 없음 — total을 그대로 노출하기보단,
            // localStorage의 가장 최근 chapter 방문 기록이 어느 것이든 있는지로 단순 판단.
            // 키 prefix 검사: `lv:<slug>:` 가 하나라도 있으면 방문한 적이 있다고 보고 0 노출,
            // 없으면 total을 new로 가정.
            let hasAny = false;
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(`lv:${slug}:`)) { hasAny = true; break; }
              }
            } catch {}
            resolved.new = hasAny ? 0 : entry.total;
          }
          applyBadge(el, resolved);
        });
      } catch {}
      return;
    }

    if (mode === "chapters" && scriptureSlug) {
      try {
        const res = await fetch(`/api/visits/badges?scripture=${encodeURIComponent(scriptureSlug)}`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = await res.json() as {
          chapters?: Record<string, Entry>;
          anonymous?: boolean;
        };
        const chapters = data.chapters ?? {};
        document.querySelectorAll<HTMLElement>("[data-chapter-anchor]").forEach((el) => {
          const anchor = el.dataset.chapterAnchor!;
          const entry = chapters[anchor];
          if (!entry) return;
          let resolved: Entry = { total: entry.total, new: entry.new };
          if (data.anonymous) {
            const lv = getLastVisit(scriptureSlug, anchor);
            resolved.new = lv ? 0 : entry.total;
          }
          applyBadge(el, resolved);
        });
      } catch {}
    }
  }

  onMount(run);
</script>

<style>
  :global(.lb-badge) {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 1.4em;
    height: 1.4em;
    padding: 0 0.4em;
    border-radius: 999px;
    background: #c43025;
    color: #fff;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.4em;
    text-align: center;
    box-shadow: 0 1px 4px rgba(196, 48, 37, 0.35);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    z-index: 2;
  }
  /* 배지를 띄울 부모는 position: relative여야 한다. 콜러 페이지가 보장. */
</style>
