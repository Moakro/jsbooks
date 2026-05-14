<script lang="ts">
  import { onMount, tick } from "svelte";
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
  };

  let stack = $state<StackItem[]>([]);
  let sheetOpen = $state(true);
  let currentIndex = $state(0);
  let cardsEl: HTMLElement | undefined = $state();

  let hasStack = $derived(stack.length > 0);
  let sheetVisible = $derived(sheetOpen && hasStack);
  let handleVisible = $derived(!sheetOpen && hasStack);

  $effect(() => {
    if (typeof document === "undefined") return;
    if (sheetVisible) {
      document.body.setAttribute("data-sidecard", "open");
    } else if (handleVisible) {
      document.body.setAttribute("data-sidecard", "minimized");
    } else {
      document.body.removeAttribute("data-sidecard");
    }
  });

  function hrefToCardRef(href: string): { kind: string; slug: string } | null {
    // 카드는 /archive/ 섹션. 옛 /library/ URL도 호환 (잔존 페이지·외부 링크 대비)
    const m = href.match(/^\/(?:archive|library)\/(people|places|dosu|terms|dates)\/([^/]+)\/?$/);
    if (!m) return null;
    return { kind: m[1], slug: decodeURIComponent(m[2]) };
  }

  async function fetchCard(kind: string, slug: string): Promise<CardData> {
    const url = `/api/card/${kind}/${encodeURIComponent(slug)}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function scrollToIndex(idx: number, smooth = true) {
    if (!cardsEl) return;
    const w = cardsEl.clientWidth;
    if (w === 0) return;
    cardsEl.scrollTo({ left: idx * w, behavior: smooth ? "smooth" : "auto" });
  }

  async function focusIndex(idx: number, smooth = true) {
    sheetOpen = true;
    await tick();
    // DOM may need an extra frame after sheet opens (transform → measurable width)
    requestAnimationFrame(() => {
      currentIndex = idx;
      scrollToIndex(idx, smooth);
    });
  }

  async function pushCard(kind: string, slug: string) {
    const key = `${kind}:${slug}`;
    const existing = stack.findIndex((s) => s.key === key);
    if (existing >= 0) {
      focusIndex(existing);
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
    };
    stack = [...stack, newItem];
    syncURL();
    focusIndex(stack.length - 1);

    try {
      const data = await fetchCard(kind, slug);
      stack = stack.map((s) => (s.key === key ? { ...s, data, loading: false } : s));
    } catch (e: any) {
      console.error("[SideCard] fetch failed", { kind, slug, error: e });
      stack = stack.map((s) =>
        s.key === key ? { ...s, error: e?.message ?? "load failed", loading: false } : s,
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

  async function pushVerse(
    slug: string,
    anchor: string,
    meta?: { similarity: number | null; origin: string },
  ) {
    const key = `verse:${slug}#${anchor}`;
    const existing = stack.findIndex((s) => s.key === key);
    if (existing >= 0) {
      focusIndex(existing);
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
    };
    stack = [...stack, newItem];
    syncURL();
    focusIndex(stack.length - 1);

    try {
      const verseData = await fetchVerse(slug, anchor);
      if (meta) verseData.correspondenceMeta = meta;
      stack = stack.map((s) =>
        s.key === key ? { ...s, verseData, loading: false } : s,
      );
    } catch (e: any) {
      console.error("[SideCard] verse fetch failed", { slug, anchor, error: e });
      stack = stack.map((s) =>
        s.key === key ? { ...s, error: e?.message ?? "load failed", loading: false } : s,
      );
    }
  }

  function closeCard(key: string) {
    const idx = stack.findIndex((s) => s.key === key);
    if (idx < 0) return;
    stack = stack.filter((s) => s.key !== key);
    syncURL();
    if (stack.length === 0) return;
    const nextIdx = Math.min(currentIndex, stack.length - 1);
    requestAnimationFrame(() => {
      currentIndex = nextIdx;
      scrollToIndex(nextIdx, false);
    });
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

  function minimizeSheet() {
    sheetOpen = false;
  }

  function reopenSheet() {
    focusIndex(currentIndex);
  }

  function goPrev() {
    if (currentIndex <= 0) return;
    focusIndex(currentIndex - 1);
  }
  function goNext() {
    if (currentIndex >= stack.length - 1) return;
    focusIndex(currentIndex + 1);
  }

  function onCardsScroll() {
    if (!cardsEl) return;
    const w = cardsEl.clientWidth;
    if (w === 0) return;
    const idx = Math.round(cardsEl.scrollLeft / w);
    if (idx !== currentIndex && idx >= 0 && idx < stack.length) {
      currentIndex = idx;
    }
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
    if (e.key === "Escape" && sheetVisible) {
      e.preventDefault();
      minimizeSheet();
    }
  }

  function onMinimizeRequest() {
    if (sheetVisible) minimizeSheet();
  }

  let resizeObs: ResizeObserver | null = null;
  $effect(() => {
    if (!cardsEl) return;
    if (resizeObs) resizeObs.disconnect();
    resizeObs = new ResizeObserver(() => {
      // Re-snap to currentIndex on width change
      scrollToIndex(currentIndex, false);
    });
    resizeObs.observe(cardsEl);
    return () => {
      resizeObs?.disconnect();
      resizeObs = null;
    };
  });

  onMount(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("jsbooks:minimize-sidecard", onMinimizeRequest);
    loadFromURL();
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("jsbooks:minimize-sidecard", onMinimizeRequest);
    };
  });
</script>

<aside class:open={sheetVisible} aria-hidden={!sheetVisible}>
  {#if hasStack}
    <header class="sb-head">
      <span class="title">관련 카드 {stack.length}개</span>
      <button class="close" onclick={minimizeSheet} title="시트 닫기 (스택 유지)" aria-label="시트 닫기">
        <Icon icon="chevron-down" size={20} />
      </button>
    </header>

    <div class="carousel-wrap">
      {#if stack.length > 1}
        <button
          class="nav prev"
          type="button"
          onclick={goPrev}
          disabled={currentIndex <= 0}
          aria-label="이전 카드"
        >
          <Icon icon="arrow-left" size={20} />
        </button>
      {/if}

      <div class="cards" bind:this={cardsEl} onscroll={onCardsScroll}>
        {#each stack as item (item.key)}
          <article class="card">
            <div class="card-head">
              <span class="kind-pill">
                {#if item.kind === "verse"}
                  {item.verseData?.scriptureName ?? "경전"}
                {:else}
                  {item.data?.kindLabel ?? item.kind}
                {/if}
              </span>
              <span class="card-title">
                {#if item.kind === "verse"}
                  {item.verseData?.anchor ? `^${item.verseData.anchor}` : item.slug}
                  {#if item.verseData?.correspondenceMeta?.similarity}
                    <span class="hanja"
                      >({(item.verseData.correspondenceMeta.similarity * 100).toFixed(0)}%)</span
                    >
                  {/if}
                {:else}
                  {item.data?.name ?? item.slug}
                  {#if item.data?.name_hanja}
                    <span class="hanja">({item.data.name_hanja})</span>
                  {/if}
                {/if}
              </span>
              <button
                class="card-close"
                type="button"
                aria-label="이 카드만 닫기"
                title="이 카드만 닫기"
                onclick={(e) => onCloseCardClick(item.key, e)}
                onkeydown={(e) => onCloseCardKey(item.key, e)}
              ><Icon icon="x" size={14} /></button>
            </div>
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
          </article>
        {/each}
      </div>

      {#if stack.length > 1}
        <button
          class="nav next"
          type="button"
          onclick={goNext}
          disabled={currentIndex >= stack.length - 1}
          aria-label="다음 카드"
        >
          <Icon icon="arrow-right" size={20} />
        </button>
      {/if}
    </div>

    {#if stack.length > 1}
      <footer class="indicator">
        {#if stack.length <= 5}
          {#each stack as _, i}
            <span class="dot" class:active={i === currentIndex} aria-hidden="true"></span>
          {/each}
        {:else}
          <span class="count-text">{currentIndex + 1} / {stack.length}</span>
        {/if}
      </footer>
    {/if}
  {/if}
</aside>

{#if handleVisible}
  <button
    class="reopen-handle"
    type="button"
    onclick={reopenSheet}
    aria-label={`관련 카드 ${stack.length}개 다시 열기`}
    title={`관련 카드 ${stack.length}개`}
  >
    {stack.length}
  </button>
{/if}

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
  /* Desktop (right side panel): rotate chevron-down → chevron-right
     since the panel slides off to the right when dismissed. */
  @media (min-width: 1024px) {
    .sb-head button.close :global(svg) {
      transform: rotate(-90deg);
    }
  }

  .carousel-wrap {
    flex: 1;
    position: relative;
    min-height: 0;
    display: flex;
  }
  .cards {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    scrollbar-width: none;
  }
  .cards::-webkit-scrollbar {
    display: none;
  }
  .card {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    display: flex;
    flex-direction: column;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
    color: var(--color-primary, #a8352a);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transition:
      background 0.15s ease,
      opacity 0.15s ease,
      transform 0.15s ease;
  }
  .nav.prev {
    left: 6px;
  }
  .nav.next {
    right: 6px;
  }
  .nav:hover:not(:disabled) {
    background: var(--color-primary-bg, #fbf3f1);
  }
  .nav:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.85rem;
    background: var(--color-bg, #fbf8f4);
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    user-select: none;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 1;
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

  .indicator {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    border-top: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-disabled, #b8b0aa);
    transition: background 0.15s ease, transform 0.15s ease;
  }
  .dot.active {
    background: var(--color-primary, #a8352a);
    transform: scale(1.3);
  }
  .count-text {
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
  }

  .reopen-handle {
    position: fixed;
    z-index: 70;
    background: var(--color-primary, #a8352a);
    color: #fff;
    border: none;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    transition: transform 0.18s ease, opacity 0.2s ease;
    animation: handle-in 0.25s ease both;
  }
  @keyframes handle-in {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
    }
  }

  /* Mobile: bottom-edge half-circle (flush) */
  @media (max-width: 1023px) {
    .reopen-handle {
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 64px;
      height: 32px;
      border-radius: 64px 64px 0 0;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.18);
      padding-bottom: 4px;
      font-size: 1rem;
    }
    @keyframes handle-in {
      from {
        opacity: 0;
        transform: translateX(-50%) scale(0.6);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) scale(1);
      }
    }
  }

  /* Desktop: right-edge half-circle */
  @media (min-width: 1024px) {
    .reopen-handle {
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 38px;
      height: 76px;
      border-radius: 76px 0 0 76px;
      box-shadow: -4px 0 14px rgba(0, 0, 0, 0.22);
      padding-right: 6px;
      font-size: 1.05rem;
    }
    .reopen-handle:hover {
      transform: translate(-4px, -50%);
    }
    @keyframes handle-in {
      from {
        opacity: 0;
        transform: translateY(-50%) scale(0.6);
      }
      to {
        opacity: 1;
        transform: translateY(-50%) scale(1);
      }
    }
  }

  /* Body padding to keep mobile bottom content above the reopen handle */
  :global(body[data-sidecard="minimized"]) {
    padding-bottom: 0;
  }
  @media (max-width: 1023px) {
    :global(body[data-sidecard="minimized"]) {
      padding-bottom: 56px;
    }
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
