<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import CommentPanel from "./CommentPanel.svelte";
  import CommentBottomSheet from "./CommentBottomSheet.svelte";

  let { slug }: { slug: string } = $props();

  type VerseInfo = { anchor: string; section: HTMLElement; badge: HTMLButtonElement };

  let verses: VerseInfo[] = [];
  let counts = $state<Record<string, number>>({});
  let activeAnchor = $state<string | null>(null);
  let isDesktop = $state(false);

  function targetFor(anchor: string): string {
    return `verse:${slug}:${anchor}`;
  }

  function discoverVerses(): VerseInfo[] {
    const out: VerseInfo[] = [];
    const sections = document.querySelectorAll<HTMLElement>("section.verse");
    sections.forEach((sec) => {
      const idEl = sec.querySelector<HTMLElement>("[id]");
      if (!idEl) return;
      const anchor = idEl.id;
      if (!anchor) return;
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "verse-comment-badge";
      badge.dataset.anchor = anchor;
      badge.setAttribute("aria-label", `${anchor} 댓글`);
      badge.innerHTML =
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` +
        `<span class="vcb-count" data-count="0">0</span>`;
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        open(anchor);
      });
      const label = sec.querySelector(".verse-label");
      if (label) label.appendChild(badge);
      else sec.insertBefore(badge, sec.firstChild);
      out.push({ anchor, section: sec, badge });
    });
    return out;
  }

  function updateBadgeCounts() {
    for (const v of verses) {
      const n = counts[targetFor(v.anchor)] ?? 0;
      const span = v.badge.querySelector<HTMLElement>(".vcb-count");
      if (span) {
        span.textContent = String(n);
        span.dataset.count = String(n);
      }
      v.badge.classList.toggle("is-empty", n === 0);
    }
  }

  async function fetchCounts() {
    if (verses.length === 0) return;
    const targets = verses.map((v) => targetFor(v.anchor)).join(",");
    try {
      const res = await fetch(`/api/comments/counts?targets=${encodeURIComponent(targets)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = await res.json();
      counts = data.counts ?? {};
      updateBadgeCounts();
    } catch {
      // ignore — leave counts at 0
    }
  }

  function open(anchor: string) {
    activeAnchor = anchor;
    for (const v of verses) v.section.classList.toggle("verse-active", v.anchor === anchor);
    const hash = `#${anchor}-c`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function close() {
    activeAnchor = null;
    for (const v of verses) v.section.classList.remove("verse-active");
    if (location.hash.endsWith("-c")) {
      const base = location.hash.slice(0, -2);
      history.replaceState(null, "", base || location.pathname + location.search);
    }
    // 패널 닫힐 때 카운트 동기화 — Comments.svelte가 이벤트 발행 안 하므로 최선의 시점
    fetchCounts();
  }

  function onHash() {
    const h = location.hash;
    if (h.endsWith("-c")) {
      const anchor = h.slice(1, -2);
      if (verses.some((v) => v.anchor === anchor)) {
        open(anchor);
        return;
      }
    }
    if (activeAnchor) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && activeAnchor) close();
  }

  function onResize() {
    isDesktop = window.innerWidth >= 1024;
  }

  // 댓글 작성·삭제 후 카운트 새로고침 트리거
  function onCommentsChanged(e: Event) {
    const ce = e as CustomEvent<{ target: string }>;
    if (!ce.detail) return fetchCounts();
    fetchCounts();
  }

  onMount(async () => {
    isDesktop = window.innerWidth >= 1024;
    await tick();
    verses = discoverVerses();
    fetchCounts();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("jsbooks:comments-changed", onCommentsChanged as EventListener);
    // 초기 hash가 #<anchor>-c면 자동 오픈
    if (location.hash.endsWith("-c")) onHash();
  });

  onDestroy(() => {
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("jsbooks:comments-changed", onCommentsChanged as EventListener);
  });
</script>

{#if activeAnchor}
  {#if isDesktop}
    <CommentPanel
      target={targetFor(activeAnchor)}
      anchor={activeAnchor}
      onClose={close}
    />
  {:else}
    <CommentBottomSheet
      target={targetFor(activeAnchor)}
      anchor={activeAnchor}
      onClose={close}
    />
  {/if}
{/if}

<style>
  /* 본문에 주입된 verse-comment-badge에 영향을 주려면 :global이 필요.
     배지는 동적 DOM이라 컴포넌트 scope에 잡히지 않음. */
  :global(.verse-comment-badge) {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: 0.6rem;
    padding: 0.12rem 0.5rem;
    font-size: 0.72rem;
    line-height: 1.2;
    color: var(--color-muted);
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    cursor: pointer;
    transition:
      opacity 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
    vertical-align: middle;
  }
  :global(.verse-comment-badge:hover),
  :global(.verse-comment-badge:focus-visible) {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
    opacity: 1;
  }
  :global(.verse-comment-badge.is-empty) {
    opacity: 0.35;
  }
  :global(.verse-comment-badge.is-empty:hover) {
    opacity: 1;
  }
  :global(.verse-comment-badge svg) {
    flex-shrink: 0;
  }
  :global(.verse-comment-badge .vcb-count) {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  :global(.verse-comment-badge.is-empty .vcb-count) {
    display: none;
  }

  /* 활성 절 하이라이트 */
  :global(section.verse.verse-active) {
    background: var(--color-primary-bg);
    box-shadow: inset 3px 0 0 var(--color-primary);
    border-radius: 4px;
    transition: background 0.18s ease, box-shadow 0.18s ease;
  }
</style>
