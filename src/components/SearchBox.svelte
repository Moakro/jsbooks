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

  type SearchMode = "keyword" | "semantic";
  type ResultRow = {
    url: string;
    title: string;
    kind: string;
    excerpt: string;
    score?: number;
  };

  let pagefind = $state<any>(null);
  let pagefindError = $state<string | null>(null);
  let query = $state("");
  let open = $state(false);
  let mode = $state<SearchMode>("keyword");
  let results = $state<ResultRow[]>([]);
  let loading = $state(false);
  let semanticError = $state<string | null>(null);

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

  async function runSemanticSearch(q: string) {
    if (!q.trim()) {
      results = [];
      semanticError = null;
      return;
    }
    loading = true;
    semanticError = null;
    try {
      const url = `/api/semantic-search?q=${encodeURIComponent(q)}&topK=15`;
      const res = await fetch(url);
      if (!res.ok) {
        results = [];
        semanticError = `검색 실패 (${res.status}) — 서버 인덱스가 아직 준비되지 않았을 수 있습니다.`;
        return;
      }
      const data = await res.json();
      const KIND_MAP: Record<string, string> = {
        scripture: "경전",
        people: "인물",
        places: "지명",
        dosu: "도수",
        terms: "용어",
        dates: "시기",
      };
      results = (data.results ?? []).map((r: any) => ({
        url: r.href,
        title: r.title,
        kind: KIND_MAP[r.kind] ?? r.kind,
        excerpt: r.snippet ?? "",
        score: r.score,
      }));
    } catch (e: any) {
      results = [];
      semanticError = e?.message ?? "검색 실패";
    } finally {
      loading = false;
    }
  }

  function dispatchSearch(q: string) {
    if (mode === "semantic") return runSemanticSearch(q);
    return runSearch(q);
  }

  function onInput() {
    if (debouncer) clearTimeout(debouncer);
    const delay = mode === "semantic" ? 350 : 180;
    debouncer = setTimeout(() => dispatchSearch(query), delay);
  }

  function setMode(next: SearchMode) {
    if (mode === next) return;
    mode = next;
    semanticError = null;
    results = [];
    if (query.trim()) dispatchSearch(query);
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
          placeholder={mode === "semantic"
            ? "의미로 검색 (예: 강증산이 일본을 어떻게 봤는지)"
            : "검색어 (예: 이마두, 단주, 의통, 금산사)"}
          autocomplete="off"
          spellcheck="false"
        />
        <button class="close" onclick={closeSearch} aria-label="닫기 (Esc)">✕</button>
      </div>

      <div class="mode-tabs" role="tablist" aria-label="검색 방식">
        <button
          type="button"
          class:active={mode === "keyword"}
          role="tab"
          aria-selected={mode === "keyword"}
          onclick={() => setMode("keyword")}
        >키워드</button>
        <button
          type="button"
          class:active={mode === "semantic"}
          role="tab"
          aria-selected={mode === "semantic"}
          onclick={() => setMode("semantic")}
        >의미 (AI)</button>
      </div>

      {#if mode === "keyword" && pagefindError}
        <p class="hint">{pagefindError}</p>
      {:else if mode === "semantic" && semanticError}
        <p class="hint">{semanticError}</p>
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
                {#if r.score !== undefined}
                  <span class="r-score" title="유사도">{(r.score * 100).toFixed(0)}%</span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">
          {#if mode === "semantic"}
            의미 기반으로 절·카드를 검색합니다. 예: "강증산이 일본을 어떻게 봤나"
          {:else}
            단축키: <kbd>/</kbd> 또는 <kbd>Cmd</kbd>+<kbd>K</kbd> 로 검색 열기
          {/if}
        </p>
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
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    color: var(--color-fg, #1f1c1a);
    font-size: 0.92rem;
  }
  .trigger:hover {
    background: var(--color-secondary-bg, #f0f7f6);
    border-color: var(--color-secondary, #1e6e6e);
  }
  .trigger-label {
    color: var(--color-muted, #8a807a);
  }
  kbd {
    font: inherit;
    font-size: 0.78em;
    padding: 0 6px;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 4px;
    color: var(--color-muted, #8a807a);
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 10vh;
  }
  .modal {
    background: var(--color-bg, #fbf8f4);
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
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
  }
  .search-row input {
    flex: 1;
    padding: 0.9rem 1rem;
    border: none;
    outline: none;
    font: inherit;
    font-size: 1.05rem;
    background: transparent;
    color: var(--color-fg, #1f1c1a);
  }
  .search-row .close {
    background: transparent;
    border: none;
    padding: 0 1rem;
    cursor: pointer;
    color: var(--color-muted, #8a807a);
    font-size: 1rem;
  }
  .mode-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
  }
  .mode-tabs button {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 0.25rem 0.7rem;
    cursor: pointer;
    color: var(--color-muted, #8a807a);
    font: inherit;
    font-size: 0.85rem;
  }
  .mode-tabs button.active {
    color: var(--color-primary, #a8352a);
    border-color: var(--color-primary, #a8352a);
    background: var(--color-primary-bg, #fbf3f1);
  }
  .r-score {
    font-size: 0.72rem;
    color: var(--color-muted, #8a807a);
    margin-left: 0.4rem;
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
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    text-decoration: none;
    color: var(--color-fg, #1f1c1a);
  }
  .results li a:hover {
    background: var(--color-primary-bg, #fbf3f1);
  }
  .r-kind {
    font-size: 0.78rem;
    color: var(--color-secondary, #1e6e6e);
    grid-row: 1 / span 2;
    align-self: center;
  }
  .r-title {
    font-weight: 600;
  }
  .r-excerpt {
    grid-column: 2;
    font-size: 0.88rem;
    color: var(--color-muted, #8a807a);
    line-height: 1.5;
  }
  .r-excerpt :global(mark) {
    background: var(--color-primary-bg, #fbf3f1);
    color: var(--color-primary, #a8352a);
    padding: 0 2px;
    border-radius: 2px;
  }
  .hint {
    padding: 1rem;
    color: var(--color-muted, #8a807a);
    font-size: 0.92rem;
  }
</style>
