<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    scriptureSlug: string;
    scriptureName?: string;
  }
  let { scriptureSlug, scriptureName }: Props = $props();

  type SubResult = {
    url: string;
    title: string;
    excerpt: string;
    anchor?: { element: string; id: string; text?: string; location: number };
  };
  type ResultRow = {
    pageUrl: string;
    pageTitle: string;
    subs: SubResult[];
  };

  let pagefind = $state<any>(null);
  let pagefindError = $state<string | null>(null);
  let query = $state("");
  let open = $state(false);
  let results = $state<ResultRow[]>([]);
  let loading = $state(false);

  let inputEl: HTMLInputElement | undefined = $state();
  let panelEl: HTMLElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let debouncer: ReturnType<typeof setTimeout> | undefined;

  async function loadPagefind() {
    if (pagefind) return;
    try {
      const url = new URL("/pagefind/pagefind.js", window.location.href).toString();
      const m = await import(/* @vite-ignore */ url);
      pagefind = m;
      await pagefind.options({ excerptLength: 28 });
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
      const r = await pagefind.search(q, {
        filters: { scripture: scriptureSlug },
      });
      const top = r.results.slice(0, 30);
      const data = await Promise.all(top.map((x: any) => x.data()));
      results = data.map((d: any) => {
        const subs: SubResult[] = (d.sub_results ?? []).map((s: any) => ({
          url: s.url,
          title: s.title ?? "",
          excerpt: s.excerpt ?? "",
          anchor: s.anchor,
        }));
        if (subs.length === 0) {
          subs.push({
            url: d.url,
            title: d.meta?.title ?? "",
            excerpt: d.excerpt,
          });
        }
        return {
          pageUrl: d.url,
          pageTitle: d.meta?.title ?? d.url,
          subs,
        };
      });
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

  function openPanel() {
    open = true;
    loadPagefind();
    queueMicrotask(() => inputEl?.focus());
  }
  function closePanel() {
    open = false;
    query = "";
    results = [];
  }
  function togglePanel() {
    if (open) closePanel();
    else openPanel();
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (panelEl?.contains(t)) return;
    if (triggerEl?.contains(t)) return;
    closePanel();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      closePanel();
      triggerEl?.focus();
    }
  }

  onMount(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<button
  bind:this={triggerEl}
  type="button"
  class="s-search-btn"
  class:active={open}
  aria-label="경전 본문 검색"
  aria-expanded={open}
  title="경전 본문 검색"
  onclick={togglePanel}
>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
</button>

{#if open}
  <div class="search-panel" bind:this={panelEl} role="dialog" aria-label="경전 본문 검색">
    <div class="search-row">
      <input
        bind:this={inputEl}
        bind:value={query}
        oninput={onInput}
        type="search"
        placeholder={`${scriptureName ?? "이 경전"} 본문에서 검색`}
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    {#if pagefindError}
      <p class="hint">{pagefindError}</p>
    {:else if loading}
      <p class="hint">검색 중…</p>
    {:else if query && results.length === 0}
      <p class="hint">결과 없음</p>
    {:else if results.length > 0}
      <ul class="results">
        {#each results as r (r.pageUrl)}
          <li class="page-group">
            <div class="page-title">{r.pageTitle}</div>
            <ul class="sub-list">
              {#each r.subs as s, i (r.pageUrl + (s.anchor?.id ?? i))}
                <li>
                  <a
                    href={s.anchor ? `${r.pageUrl}#${s.anchor.id}` : s.url}
                    onclick={closePanel}
                  >
                    {#if s.title && s.title !== r.pageTitle}
                      <span class="s-title">{@html s.title}</span>
                    {/if}
                    <span class="s-excerpt">{@html s.excerpt}</span>
                  </a>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">검색어를 입력하세요</p>
    {/if}
  </div>
{/if}

<style>
  .s-search-btn {
    flex: 0 0 auto;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--color-muted, #8a807a);
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .s-search-btn:hover,
  .s-search-btn.active {
    color: var(--color-primary, #a8352a);
    background: var(--color-primary-bg, #fbf3f1);
    border-color: var(--color-rule, #e8dfd9);
  }
  .s-search-btn:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: 2px;
  }

  .search-panel {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: rgba(22, 20, 18, 0.92);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    color: #f4ece2;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    z-index: 6;
    animation: slide-down 0.15s ease;
  }
  @keyframes slide-down {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .search-row {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .search-row input {
    width: 100%;
    padding: 0.5rem 0.7rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 6px;
    outline: none;
    font: inherit;
    font-size: 0.95rem;
    background: rgba(255, 255, 255, 0.06);
    color: #f4ece2;
  }
  .search-row input::placeholder {
    color: rgba(244, 236, 226, 0.45);
  }
  .search-row input:focus {
    border-color: var(--color-primary, #a8352a);
    background: rgba(255, 255, 255, 0.1);
  }

  .hint {
    padding: 0.9rem 1rem;
    margin: 0;
    color: rgba(244, 236, 226, 0.6);
    font-size: 0.9rem;
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0.3rem 0;
    overflow-y: auto;
  }
  .page-group {
    padding: 0.3rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .page-group:last-child {
    border-bottom: none;
  }
  .page-title {
    padding: 0.3rem 1rem;
    font-size: 0.78rem;
    color: rgba(244, 236, 226, 0.55);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .sub-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sub-list li a {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 1rem;
    text-decoration: none;
    color: #f4ece2;
    border-left: 3px solid transparent;
  }
  .sub-list li a:hover {
    background: rgba(255, 255, 255, 0.06);
    border-left-color: var(--color-primary, #a8352a);
  }
  .s-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ff8a7a;
  }
  .s-excerpt {
    font-size: 0.92rem;
    line-height: 1.55;
    color: #f4ece2;
  }
  .s-excerpt :global(mark) {
    background: rgba(255, 138, 122, 0.22);
    color: #ffb3a6;
    padding: 0 2px;
    border-radius: 2px;
    font-weight: 600;
  }
</style>
