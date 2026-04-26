<script lang="ts">
  import { onMount } from "svelte";

  type PagefindResult = {
    id: string;
    score: number;
    data: () => Promise<{
      url: string;
      excerpt: string;
      meta: Record<string, string>;
      filters: Record<string, string[]>;
    }>;
  };

  let pagefind = $state<any>(null);
  let pagefindError = $state<string | null>(null);
  let query = $state("");
  let open = $state(false);
  let results = $state<{ url: string; excerpt: string; title: string; kind: string }[]>([]);
  let loading = $state(false);

  let inputEl: HTMLInputElement | undefined = $state();
  let debouncer: ReturnType<typeof setTimeout> | undefined;

  async function loadPagefind() {
    if (pagefind) return;
    try {
      // Use a runtime-built URL so Vite/Rollup don't try to resolve at build time.
      const url = new URL("/pagefind/pagefind.js", window.location.href).toString();
      const m = await import(/* @vite-ignore */ url);
      pagefind = m;
      await pagefind.options({ excerptLength: 30 });
      pagefindError = null;
    } catch {
      pagefindError = "검색 인덱스를 불러올 수 없습니다 (빌드 후에만 작동)";
    }
  }

  async function runSearch(q: string) {
    if (!pagefind) return;
    if (!q.trim()) {
      results = [];
      return;
    }
    loading = true;
    try {
      const r = await pagefind.search(q);
      const top = r.results.slice(0, 20);
      const data = await Promise.all(top.map((x: PagefindResult) => x.data()));
      results = data.map((d: any) => ({
        url: d.url,
        excerpt: d.excerpt,
        title: d.meta?.title ?? d.url,
        kind: d.filters?.kind?.[0] ?? "",
      }));
    } catch (e) {
      results = [];
    } finally {
      loading = false;
    }
  }

  function onInput() {
    if (debouncer) clearTimeout(debouncer);
    debouncer = setTimeout(() => runSearch(query), 180);
  }

  function openSearch() {
    open = true;
    loadPagefind();
    queueMicrotask(() => inputEl?.focus());
  }
  function closeSearch() {
    open = false;
    query = "";
    results = [];
  }

  function stopProp(e: Event) {
    e.stopPropagation();
  }

  function onKey(e: KeyboardEvent) {
    if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !open) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      closeSearch();
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
</script>

<button class="trigger" onclick={openSearch} title="검색 (/)">
  <span aria-hidden="true">🔍</span><span class="trigger-label">검색</span>
  <kbd>/</kbd>
</button>

{#if open}
  <div
    class="overlay"
    role="presentation"
    onclick={closeSearch}
    onkeydown={null}
  >
    <div
      class="modal"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="사이트 검색"
      onclick={stopProp}
      onkeydown={null}
    >
      <div class="search-row">
        <input
          bind:this={inputEl}
          bind:value={query}
          oninput={onInput}
          type="search"
          placeholder="검색어 (예: 이마두, 단주, 의통, 금산사)"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="close" onclick={closeSearch} aria-label="닫기 (Esc)">✕</button>
      </div>

      {#if pagefindError}
        <p class="hint">{pagefindError}</p>
      {:else if loading}
        <p class="hint">검색 중…</p>
      {:else if query && results.length === 0}
        <p class="hint">결과 없음</p>
      {:else if results.length > 0}
        <ul class="results">
          {#each results as r (r.url)}
            <li>
              <a href={r.url} onclick={closeSearch}>
                <span class="r-kind">{r.kind || "—"}</span>
                <span class="r-title">{@html r.title}</span>
                <span class="r-excerpt">{@html r.excerpt}</span>
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">단축키: <kbd>/</kbd> 또는 <kbd>Cmd</kbd>+<kbd>K</kbd> 로 검색 열기</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--rule, #e5e5e0);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    color: var(--fg, #222);
    font-size: 0.92rem;
  }
  .trigger:hover {
    background: rgba(0, 0, 0, 0.03);
  }
  .trigger-label {
    color: var(--muted, #888);
  }
  kbd {
    font: inherit;
    font-size: 0.78em;
    padding: 0 6px;
    border: 1px solid var(--rule, #e5e5e0);
    border-radius: 4px;
    color: var(--muted, #888);
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 10vh;
  }
  .modal {
    background: var(--bg, #fafaf7);
    width: min(640px, 92vw);
    max-height: 78vh;
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .search-row {
    display: flex;
    border-bottom: 1px solid var(--rule, #e5e5e0);
  }
  .search-row input {
    flex: 1;
    padding: 0.9rem 1rem;
    border: none;
    outline: none;
    font: inherit;
    font-size: 1.05rem;
    background: transparent;
    color: var(--fg, #222);
  }
  .search-row .close {
    background: transparent;
    border: none;
    padding: 0 1rem;
    cursor: pointer;
    color: var(--muted, #888);
    font-size: 1rem;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  .results li a {
    display: grid;
    grid-template-columns: 4.5em 1fr;
    column-gap: 0.7rem;
    row-gap: 0.2rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--rule, #e5e5e0);
    text-decoration: none;
    color: var(--fg, #222);
  }
  .results li a:hover {
    background: rgba(37, 99, 235, 0.06);
  }
  .r-kind {
    font-size: 0.78rem;
    color: var(--muted, #888);
    grid-row: 1 / span 2;
    align-self: center;
  }
  .r-title {
    font-weight: 600;
  }
  .r-excerpt {
    grid-column: 2;
    font-size: 0.88rem;
    color: var(--muted, #888);
    line-height: 1.5;
  }
  .r-excerpt :global(mark) {
    background: rgba(255, 220, 100, 0.5);
    padding: 0 2px;
  }
  .hint {
    padding: 1rem;
    color: var(--muted, #888);
    font-size: 0.92rem;
  }
</style>
