<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  type BacklinkData = {
    kind: string;
    href: string;
    title: string;
    excerpt: string;
  };

  type CardData = {
    kind: string;
    kindLabel: string;
    slug: string;
    name: string;
    name_hanja: string | null;
    meta: { label: string; value: string }[];
    status: string | null;
    bodyHTML: string;
    pageHref: string;
    backlinks?: BacklinkData[];
  };

  /** Verse-comparison data shape — fetched from /api/verse/{slug}/{anchor}.json */
  type VerseData = {
    kind: "verse";
    scriptureSlug: string;
    scriptureName: string;
    anchor: string;
    verseNum: number;
    vol: number | null;
    chap: number | null;
    title: string;
    bodyHTML: string;
    pageHref: string;
    /** Set when this verse was opened via a correspondence badge. */
    correspondenceMeta?: {
      similarity: number | null;
      origin: string;
    };
  };

  const KIND_PILL: Record<string, string> = {
    scripture: "경전",
    people: "인물",
    places: "지명",
    dosu: "도수",
    terms: "용어",
    dates: "시기",
  };

  type StackItem = {
    key: string; // kind:slug | "verse:slug#anchor"
    kind: string;
    slug: string;
    loading: boolean;
    error: string | null;
    data: CardData | null;
    verseData: VerseData | null;
    expanded: boolean;
  };

  let stack = $state<StackItem[]>([]);
  let isOpen = $derived(stack.length > 0);

  $effect(() => {
    if (typeof document === "undefined") return;
    if (isOpen) {
      document.body.setAttribute("data-sidecard", "open");
    } else {
      document.body.removeAttribute("data-sidecard");
    }
  });

  // Wikilink intercept: pages render `<a class="wikilink" href="/library/people/이마두/">…</a>`
  // We intercept clicks and translate the href to a card-stack push.
  function hrefToCardRef(href: string): { kind: string; slug: string } | null {
    const m = href.match(/^\/wiki\/(people|places|dosu|terms|dates)\/([^/]+)\/?$/);
    if (!m) return null;
    return { kind: m[1], slug: decodeURIComponent(m[2]) };
  }

  async function fetchCard(kind: string, slug: string): Promise<CardData> {
    const url = `/api/card/${kind}/${encodeURIComponent(slug)}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function pushCard(kind: string, slug: string) {
    const key = `${kind}:${slug}`;
    // If already in stack, just expand it (collapse others) and move to top
    const existing = stack.findIndex((s) => s.key === key);
    if (existing >= 0) {
      const item = stack[existing];
      const rest = stack.filter((_, i) => i !== existing);
      stack = [
        ...rest.map((s) => ({ ...s, expanded: false })),
        { ...item, expanded: true },
      ];
      syncURL();
      return;
    }
    const newItem: StackItem = {
      key,
      kind,
      slug,
      loading: true,
      error: null,
      data: null,
      verseData: null,
      expanded: true,
    };
    stack = [
      ...stack.map((s) => ({ ...s, expanded: false })),
      newItem,
    ];
    syncURL();

    try {
      const data = await fetchCard(kind, slug);
      stack = stack.map((s) =>
        s.key === key ? { ...s, data, loading: false } : s,
      );
    } catch (e: any) {
      console.error("[SideCard] fetch failed", { kind, slug, error: e });
      stack = stack.map((s) =>
        s.key === key
          ? { ...s, error: e?.message ?? "load failed", loading: false }
          : s,
      );
    }
  }

  let versesIndexCache: Record<string, any> | null = null;
  async function loadVersesIndex(): Promise<Record<string, any>> {
    if (versesIndexCache) return versesIndexCache;
    const res = await fetch("/verses.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    versesIndexCache = await res.json();
    return versesIndexCache!;
  }
  async function fetchVerse(slug: string, anchor: string): Promise<VerseData> {
    const idx = await loadVersesIndex();
    const key = `${slug}#${anchor}`;
    const v = idx[key];
    if (!v) throw new Error(`verse not found: ${key}`);
    return { kind: "verse", ...v };
  }

  async function pushVerse(slug: string, anchor: string, meta?: { similarity: number | null; origin: string }) {
    const key = `verse:${slug}#${anchor}`;
    const existing = stack.findIndex((s) => s.key === key);
    if (existing >= 0) {
      const item = stack[existing];
      const rest = stack.filter((_, i) => i !== existing);
      stack = [
        ...rest.map((s) => ({ ...s, expanded: false })),
        { ...item, expanded: true },
      ];
      syncURL();
      return;
    }
    const newItem: StackItem = {
      key,
      kind: "verse",
      slug: `${slug}#${anchor}`,
      loading: true,
      error: null,
      data: null,
      verseData: null,
      expanded: true,
    };
    stack = [...stack.map((s) => ({ ...s, expanded: false })), newItem];
    syncURL();

    try {
      const verseData = await fetchVerse(slug, anchor);
      if (meta) verseData.correspondenceMeta = meta;
      stack = stack.map((s) =>
        s.key === key ? { ...s, verseData, loading: false } : s,
      );
    } catch (e: any) {
      console.error("[SideCard] verse fetch failed", { slug, anchor, error: e });
      stack = stack.map((s) =>
        s.key === key
          ? { ...s, error: e?.message ?? "load failed", loading: false }
          : s,
      );
    }
  }

  function popCard() {
    if (stack.length === 0) return;
    stack = stack.slice(0, -1);
    if (stack.length > 0) stack[stack.length - 1].expanded = true;
    syncURL();
  }

  function closeCard(key: string) {
    const idx = stack.findIndex((s) => s.key === key);
    if (idx < 0) return;
    stack = stack.filter((s) => s.key !== key);
    if (stack.length > 0) stack[stack.length - 1].expanded = true;
    syncURL();
  }

  function onCloseCardClick(key: string, e: MouseEvent) {
    e.stopPropagation();
    closeCard(key);
  }

  function onCloseCardKey(key: string, e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      closeCard(key);
    }
  }

  function closeAll() {
    stack = [];
    syncURL();
  }

  function toggleExpand(key: string) {
    stack.forEach((s) => (s.expanded = s.key === key ? !s.expanded : false));
    stack = [...stack];
  }

  // ---- URL sync ----
  function syncURL() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (stack.length === 0) {
      url.searchParams.delete("cards");
    } else {
      const tokens = stack.map((s) => `${s.kind}:${s.slug}`);
      url.searchParams.set("cards", tokens.join(","));
    }
    history.replaceState(null, "", url.toString());
  }

  function loadFromURL() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const param = url.searchParams.get("cards");
    if (!param) return;
    const tokens = param.split(",").map((t) => t.trim()).filter(Boolean);
    for (const tok of tokens) {
      const [kind, slug] = tok.split(":");
      if (!kind || !slug) continue;
      pushCard(kind, slug);
    }
  }

  // ---- Click intercept on the whole document ----
  function handleClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const target = e.target as HTMLElement;

    // Correspondence badges → open target verse in side card.
    const verseLink = target.closest("a.verse-compare-link") as HTMLAnchorElement | null;
    if (verseLink) {
      const slug = verseLink.dataset.targetSlug;
      const anchor = verseLink.dataset.targetAnchor;
      if (slug && anchor) {
        e.preventDefault();
        const simRaw = verseLink.dataset.similarity;
        const sim = simRaw ? parseFloat(simRaw) : null;
        const origin = verseLink.dataset.origin ?? "ai";
        pushVerse(slug, anchor, { similarity: Number.isFinite(sim) ? sim : null, origin });
      }
      return;
    }

    // Only intercept side-card links. `.wikilink.page` (chapter / preface) and
    // bare `.page-link` should navigate normally.
    const a = target.closest("a.wikilink:not(.page)") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    const ref = hrefToCardRef(href);
    if (!ref) return;
    e.preventDefault();
    pushCard(ref.kind, ref.slug);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closeAll();
    }
  }

  onMount(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    loadFromURL();
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  });
</script>

<aside class:open={isOpen} aria-hidden={!isOpen}>
  {#if isOpen}
    <header class="sb-head">
      <button class="back" onclick={popCard} title="뒤로 (ESC: 전체 닫기)" aria-label="뒤로">
        <Icon icon="arrow-left" size={18} />
      </button>
      <span class="title">관련 카드 {stack.length}개</span>
      <button class="close" onclick={closeAll} title="전체 닫기" aria-label="전체 닫기">
        <Icon icon="x" size={18} />
      </button>
    </header>
    <div class="cards">
      {#each stack as item (item.key)}
        <article class="card" class:expanded={item.expanded}>
          <button
            class="card-head"
            type="button"
            onclick={() => toggleExpand(item.key)}
            aria-expanded={item.expanded}
          >
            <span class="kind-pill">
              {#if item.kind === "verse"}
                {item.verseData?.scriptureName ?? "경전"}
              {:else}
                {item.data?.kindLabel ?? item.kind}
              {/if}
            </span>
            <span class="card-title">
              {#if item.kind === "verse"}
                {item.verseData?.verseNum ? `${item.verseData.verseNum}절` : item.slug}
                {#if item.verseData?.correspondenceMeta?.similarity}
                  <span class="hanja">({(item.verseData.correspondenceMeta.similarity * 100).toFixed(0)}%)</span>
                {/if}
              {:else}
                {item.data?.name ?? item.slug}
                {#if item.data?.name_hanja}
                  <span class="hanja">({item.data.name_hanja})</span>
                {/if}
              {/if}
            </span>
            <span
              class="card-close"
              role="button"
              tabindex="0"
              aria-label="이 카드만 닫기"
              title="이 카드만 닫기"
              onclick={(e) => onCloseCardClick(item.key, e)}
              onkeydown={(e) => onCloseCardKey(item.key, e)}
            ><Icon icon="x" size={14} /></span>
          </button>
          {#if item.expanded}
            <div class="card-body">
              {#if item.loading}
                <p class="muted">불러오는 중…</p>
              {:else if item.error}
                <p class="muted">불러오기 실패: {item.error}</p>
              {:else if item.kind === "verse" && item.verseData}
                <p class="verse-meta">
                  {item.verseData.title}
                  {#if item.verseData.correspondenceMeta}
                    <span class="muted">
                      ·
                      {item.verseData.correspondenceMeta.origin === "curator"
                        ? "운영자 확정"
                        : item.verseData.correspondenceMeta.origin === "community"
                          ? "회원 발견"
                          : "AI 자동 매칭"}
                    </span>
                  {/if}
                </p>
                <div class="card-html">{@html item.verseData.bodyHTML}</div>
                <p class="open-full">
                  <a href={item.verseData.pageHref}>전체 페이지로 열기 →</a>
                </p>
              {:else if item.data}
                {#if item.data.status === "stub"}
                  <p class="stub">※ 스텁(stub) — 보강 예정</p>
                {/if}
                {#if item.data.meta.length > 0}
                  <dl class="meta-list">
                    {#each item.data.meta as m}
                      <dt>{m.label}</dt>
                      <dd>{m.value}</dd>
                    {/each}
                  </dl>
                {/if}
                <div class="card-html">{@html item.data.bodyHTML}</div>
                {#if item.data.backlinks && item.data.backlinks.length > 0}
                  <section class="bl">
                    <h3>이 카드를 인용한 곳 ({item.data.backlinks.length})</h3>
                    <ul>
                      {#each item.data.backlinks as bl}
                        <li>
                          <a href={bl.href}>
                            <span class="bl-pill">{KIND_PILL[bl.kind] ?? bl.kind}</span>
                            <span class="bl-title">{bl.title}</span>
                          </a>
                          {#if bl.excerpt}
                            <p class="bl-excerpt">{bl.excerpt}</p>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </section>
                {/if}
                <p class="open-full">
                  <a href={item.data.pageHref}>전체 페이지로 열기 →</a>
                </p>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</aside>

<style>
  aside {
    position: fixed;
    background: var(--color-bg, #fbf8f4);
    border-left: 1px solid var(--color-rule, #e8dfd9);
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.18);
    transform: translateX(100%);
    transition: transform 0.22s ease;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 80;
  }
  aside.open {
    transform: translateX(0);
  }

  /* Desktop: right column */
  @media (min-width: 1024px) {
    aside {
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      max-width: 36vw;
    }
  }

  /* Mobile: bottom sheet */
  @media (max-width: 1023px) {
    aside {
      left: 0;
      right: 0;
      bottom: 0;
      height: 70vh;
      transform: translateY(100%);
      border-left: none;
      border-top: 1px solid var(--rule, #e5e5e0);
      border-radius: 12px 12px 0 0;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.1);
    }
    aside.open {
      transform: translateY(0);
    }
  }

  .sb-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-primary-bg, #fbf3f1);
    flex-shrink: 0;
  }
  .sb-head .title {
    flex: 1;
    font-size: 0.9rem;
    color: var(--color-primary, #a8352a);
    font-weight: 600;
  }
  .sb-head button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    cursor: pointer;
    color: var(--color-primary, #a8352a);
  }
  .sb-head button:hover {
    background: var(--color-primary, #a8352a);
    color: var(--color-bg, #fbf8f4);
  }

  .cards {
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .card {
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.85rem;
    cursor: pointer;
    background: var(--color-bg, #fbf8f4);
    user-select: none;
    width: 100%;
    border: none;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .card-head:hover {
    background: var(--color-primary-bg, #fbf3f1);
  }
  .kind-pill {
    font-size: 0.72rem;
    color: var(--color-primary, #a8352a);
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 999px;
    padding: 1px 8px;
    flex-shrink: 0;
  }
  .card-title {
    flex: 1;
    font-weight: 600;
    font-size: 0.96rem;
  }
  .card-title .hanja {
    font-weight: normal;
    color: var(--hanja, #555);
    font-size: 0.78em;
  }
  .card-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--muted, #888);
    padding: 2px 4px;
    border-radius: 3px;
  }
  .card-close:hover {
    color: var(--fg, #222);
    background: var(--rule, #e5e5e0);
  }
  .card-body {
    padding: 0.4rem 1rem 1.2rem;
    font-size: 0.95rem;
    line-height: 1.6;
  }
  .meta-list {
    margin: 0.4rem 0 1rem;
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.7rem;
    row-gap: 0.2rem;
    font-size: 0.85rem;
  }
  .meta-list dt {
    color: var(--muted, #888);
  }
  .meta-list dd {
    margin: 0;
  }
  .stub {
    font-size: 0.82rem;
    color: var(--color-primary, #a8352a);
    margin: 0 0 0.6rem;
  }
  .muted {
    color: var(--color-muted, #8a807a);
    font-size: 0.9rem;
  }
  .open-full {
    margin-top: 1rem;
    padding-top: 0.7rem;
    border-top: 1px dashed var(--color-rule, #e8dfd9);
    font-size: 0.85rem;
  }
  .open-full :global(a) {
    color: var(--color-secondary, #1e6e6e);
    border-bottom: 1px solid var(--color-secondary, #1e6e6e);
    text-decoration: none;
  }
  .bl {
    margin-top: 1.4rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--color-rule, #e8dfd9);
  }
  .bl h3 {
    font-size: 0.9rem;
    color: var(--color-primary, #a8352a);
    margin: 0 0 0.5rem;
  }
  .bl ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .bl li {
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 5px;
    padding: 0.4rem 0.6rem;
    background: var(--color-secondary-bg, #f0f7f6);
    font-size: 0.86rem;
  }
  .bl a {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    text-decoration: none;
    color: var(--color-fg, #1f1c1a);
  }
  .bl-pill {
    font-size: 0.7rem;
    color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 999px;
    padding: 1px 6px;
    flex-shrink: 0;
  }
  .bl-title {
    font-weight: 600;
  }
  .bl-excerpt {
    margin: 0.25rem 0 0;
    color: var(--color-muted, #8a807a);
    font-size: 0.78rem;
    line-height: 1.5;
  }
  .card-html :global(a.wikilink) {
    text-decoration: none;
    border-bottom: 1px dotted var(--color-primary, #a8352a);
    color: var(--color-primary, #a8352a);
  }
  .card-html :global(a.wikilink.page) {
    border-bottom: 1px solid var(--color-secondary, #1e6e6e);
    color: var(--color-secondary, #1e6e6e);
  }
  .card-html :global(.wikilink-missing) {
    color: var(--color-disabled, #b8b0aa);
    border-bottom: 1px dotted var(--color-disabled, #b8b0aa);
    cursor: help;
  }
  .card-html :global(h1),
  .card-html :global(h2),
  .card-html :global(h3) {
    font-size: 1rem;
    color: var(--color-primary, #a8352a);
    margin: 1.2rem 0 0.4rem;
  }
  .card-html :global(p) {
    margin: 0.4rem 0;
  }
  .card-html :global(ul),
  .card-html :global(ol) {
    padding-left: 1.2rem;
  }
  .card-html :global(table) {
    border-collapse: collapse;
    font-size: 0.85rem;
    margin: 0.6rem 0;
  }
  .card-html :global(th),
  .card-html :global(td) {
    border: 1px solid var(--rule, #e5e5e0);
    padding: 0.25rem 0.5rem;
  }
</style>
