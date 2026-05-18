<script lang="ts">
  import { onMount, tick } from "svelte";
  import Icon from "./Icon.svelte";
  import Comments from "./Comments.svelte";
  import RelativeTime from "./feed/RelativeTime.svelte";
  import UserName from "./feed/UserName.svelte";

  // ──────────────────────────── Types ─────────────────────────────
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
    correspondenceMeta?: { similarity: number | null; origin: string };
  };

  type ScriptureRef = { slug: string; anchor: string; title: string };
  type CardRef = { kind: string; slug: string; name: string; anchors: string[] };
  type ChapterContext = {
    scripture_refs: ScriptureRef[];
    card_refs: CardRef[];
    verse_anchors: string[];
  };

  type TabKey = "library" | "archive" | "feed";

  type LibraryItem = {
    key: string;
    slug: string;
    anchor: string;
    loading: boolean;
    error: string | null;
    data: VerseData | null;
  };
  type ArchiveItem = {
    key: string;
    kind: string;
    slug: string;
    loading: boolean;
    error: string | null;
    data: CardData | null;
  };
  type FeedItem = {
    key: string; // "feed:verse:1-1-3" 또는 "feed:chapter:1-1"
    kind: "chapter" | "verse";
    anchor: string; // verse: "1-1-3" · chapter: "1-1" (vol-chap)
    label: string;
  };

  type Stacks = {
    library: LibraryItem[];
    archive: ArchiveItem[];
    feed: FeedItem[];
  };

  const KIND_PILL: Record<string, string> = {
    scripture: "경전",
    people: "인물",
    places: "장소",
    dosu: "도수",
    terms: "용어",
    dates: "시기",
  };
  const SCRIPTURE_NAME: Record<string, string> = {
    cheonjigaebyeokgyeong: "천지개벽경",
    donggokbiseo: "동곡비서",
    "hwaeundang-silgi": "화은당실기",
  };

  // ──────────────────────────── Props ─────────────────────────────
  let {
    scriptureSlug = null,
    chapterAnchor = null,
    chapterLabel = null,
  }: {
    scriptureSlug?: string | null;
    chapterAnchor?: string | null;
    chapterLabel?: string | null;
  } = $props();

  let scriptureMode = $derived(!!(scriptureSlug && chapterAnchor));

  // ──────────────────────────── State ─────────────────────────────
  const TAB_STORAGE_KEY = "sidecard-last-tab";
  function readStoredTab(): TabKey {
    if (typeof window === "undefined") return "archive";
    try {
      const v = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (v === "library" || v === "archive" || v === "feed") return v;
    } catch {}
    return "archive";
  }

  let sheetOpen = $state(false);
  let activeTab = $state<TabKey>(readStoredTab());
  let viewMode = $state<Record<TabKey, "list" | "detail">>({
    library: "list",
    archive: "list",
    feed: "list",
  });
  let stacks = $state<Stacks>({ library: [], archive: [], feed: [] });
  let currentIdx = $state<Record<TabKey, number>>({ library: 0, archive: 0, feed: 0 });

  let chapterContext = $state<ChapterContext | null>(null);
  let chapterContextLoading = $state(false);
  let chapterBadges = $state<Record<string, { total: number; new: number }> | null>(null);
  let verseCounts = $state<Record<string, number>>({});

  type VerseFeedEntry = {
    anchor: string;
    count: number;
    latest: {
      body: string;
      user_nickname: string;
      is_admin: boolean;
      created_at: string;
      has_photos: boolean;
    };
  };
  let verseFeedData = $state<VerseFeedEntry[] | null>(null);

  let detailEls = $state<Record<TabKey, HTMLElement | undefined>>({
    library: undefined,
    archive: undefined,
    feed: undefined,
  });

  // ─────────────────────────── Derived ────────────────────────────
  const stackTotal = $derived(
    stacks.library.length + stacks.archive.length + stacks.feed.length,
  );
  const handleVisible = $derived(scriptureMode || stackTotal > 0);
  const sheetVisible = $derived(sheetOpen && handleVisible);

  // 핸들 배지: 새 댓글이 있으면 +N (빨강), 0이면 totalCount (회색), 0/0이면 숨김.
  const handleNewCount = $derived(
    scriptureMode && chapterBadges && chapterAnchor
      ? (chapterBadges[chapterAnchor]?.new ?? 0)
      : 0,
  );
  const handleTotalCount = $derived(
    scriptureMode && chapterBadges && chapterAnchor
      ? (chapterBadges[chapterAnchor]?.total ?? 0)
      : 0,
  );
  const handleCountText = $derived(
    scriptureMode
      ? handleNewCount > 0
        ? `+${handleNewCount}`
        : handleTotalCount > 0
          ? String(handleTotalCount)
          : ""
      : stackTotal > 0
        ? String(stackTotal)
        : "",
  );

  $effect(() => {
    if (typeof document === "undefined") return;
    if (sheetVisible) document.body.setAttribute("data-sidecard", "open");
    else if (handleVisible) document.body.setAttribute("data-sidecard", "minimized");
    else document.body.removeAttribute("data-sidecard");
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {}
  });

  // ─────────────────────────── Mount ──────────────────────────────
  onMount(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("jsbooks:minimize-sidecard", onMinimizeRequest);

    loadFromURL();

    if (scriptureMode) {
      touchVisit();
      loadChapterContext();
      loadChapterBadges();
      loadVerseFeed();
      // verse 댓글 카운트는 chapter context 로딩 직후 verse_anchors가 있어야 fetch
      tick().then(() => injectVerseCommentBadges());
    }

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("jsbooks:minimize-sidecard", onMinimizeRequest);
    };
  });

  // ─────────────────────── visit touch & badges ───────────────────
  async function touchVisit() {
    if (!scriptureSlug || !chapterAnchor) return;
    // localStorage fallback for anonymous
    try {
      localStorage.setItem(
        `lv:${scriptureSlug}:${chapterAnchor}`,
        new Date().toISOString(),
      );
    } catch {}
    try {
      await fetch("/api/visits/touch", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripture: scriptureSlug, chapter: chapterAnchor }),
      });
    } catch {}
  }

  async function loadChapterBadges() {
    if (!scriptureSlug) return;
    try {
      const res = await fetch(`/api/visits/badges?scripture=${encodeURIComponent(scriptureSlug)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.anonymous) {
        // 비로그인: total 받아서 localStorage 비교로 new 계산
        const out: Record<string, { total: number; new: number }> = {};
        for (const [key, val] of Object.entries(data.chapters ?? {})) {
          const v = val as { total: number; new: number };
          const lvKey = `lv:${scriptureSlug}:${key}`;
          const lv = localStorage.getItem(lvKey);
          // anonymous 응답에는 latest가 없으므로 단순화: 미방문이면 total을 new로,
          // 방문했으면 0으로 (정확한 timestamp 비교는 서버에서만 가능).
          out[key] = { total: v.total, new: lv ? 0 : v.total };
        }
        chapterBadges = out;
      } else {
        chapterBadges = data.chapters ?? {};
      }
    } catch {
      chapterBadges = {};
    }
  }

  // ─────────────────── chapter-context.json ───────────────────────
  let chapterContextCache: Record<string, ChapterContext> | null = null;
  async function loadChapterContext() {
    if (!scriptureSlug || !chapterAnchor) return;
    chapterContextLoading = true;
    try {
      if (!chapterContextCache) {
        const res = await fetch("/chapter-context.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        chapterContextCache = await res.json();
      }
      const key = `${scriptureSlug}/${chapterAnchor}`;
      chapterContext = chapterContextCache![key] ?? { scripture_refs: [], card_refs: [], verse_anchors: [] };
      // verse counts batch
      loadVerseCounts();
    } catch {
      chapterContext = { scripture_refs: [], card_refs: [], verse_anchors: [] };
    } finally {
      chapterContextLoading = false;
    }
  }

  async function loadVerseCounts() {
    if (!scriptureSlug || !chapterContext) return;
    const anchors = chapterContext.verse_anchors;
    const list: string[] = anchors.map((a) => `verse:${scriptureSlug}:${a}`);
    // chapter-level target (cheonjigaebyeokgyeong vol-chap만)
    if (chapterAnchor && /^\d+-\d+$/.test(chapterAnchor)) {
      const [vol, chap] = chapterAnchor.split("-");
      list.push(`chapter:${vol}:${chap}`);
    }
    if (list.length === 0) return;
    try {
      const res = await fetch(`/api/comments/counts?targets=${encodeURIComponent(list.join(","))}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = await res.json();
      verseCounts = data.counts ?? {};
      updateBadgeCounts();
    } catch {}
  }

  async function loadVerseFeed() {
    if (!scriptureSlug || !chapterAnchor) return;
    try {
      const res = await fetch(
        `/api/comments/verse-feed?scripture=${encodeURIComponent(scriptureSlug)}&chapter=${encodeURIComponent(chapterAnchor)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) return;
      const data = await res.json();
      verseFeedData = Array.isArray(data.verses) ? data.verses : [];
    } catch {
      verseFeedData = [];
    }
  }

  // ──────────────────── verse-comment-badge inject ─────────────────
  function injectVerseCommentBadges() {
    const sections = document.querySelectorAll<HTMLElement>("section.verse");
    sections.forEach((sec) => {
      if (sec.querySelector(".verse-comment-badge")) return;
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
        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` +
        `<span class="vcb-count" data-count="0">0</span>`;
      const label = sec.querySelector(".verse-label") ?? sec.querySelector(".verse-label-meta");
      if (label) label.appendChild(badge);
      else sec.insertBefore(badge, sec.firstChild);
    });
    updateBadgeCounts();
  }

  function updateBadgeCounts() {
    if (!scriptureSlug) return;
    const sections = document.querySelectorAll<HTMLElement>("section.verse");
    sections.forEach((sec) => {
      const idEl = sec.querySelector<HTMLElement>("[id]");
      if (!idEl) return;
      const anchor = idEl.id;
      const n = verseCounts[`verse:${scriptureSlug}:${anchor}`] ?? 0;
      const badge = sec.querySelector<HTMLElement>(".verse-comment-badge");
      if (!badge) return;
      const span = badge.querySelector<HTMLElement>(".vcb-count");
      if (span) {
        span.textContent = String(n);
        span.dataset.count = String(n);
      }
      badge.classList.toggle("is-empty", n === 0);
    });
  }

  // ─────────────────────── push functions ─────────────────────────
  async function fetchCard(kind: string, slug: string): Promise<CardData> {
    const url = `/api/card/${kind}/${encodeURIComponent(slug)}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  let versesIndexCache: Record<string, VerseData> | null = null;
  async function loadVersesIndex(): Promise<Record<string, VerseData>> {
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

  function openTab(tab: TabKey, view: "list" | "detail") {
    activeTab = tab;
    viewMode = { ...viewMode, [tab]: view };
    sheetOpen = true;
  }

  // 탭 클릭: 비활성 탭 → 전환, 활성 탭 재클릭 → 목록으로 복귀(스택 보존)
  function onTabClick(tab: TabKey) {
    if (activeTab === tab) {
      if (viewMode[tab] === "detail") {
        viewMode = { ...viewMode, [tab]: "list" };
      }
      return;
    }
    activeTab = tab;
  }

  function setIdx(tab: TabKey, idx: number) {
    currentIdx = { ...currentIdx, [tab]: idx };
  }

  // ─────────────────────── horizontal swipe ───────────────────────
  // 같은 탭 내 카드 스택을 좌우 스와이프로 전환. 세로 스크롤은 native 그대로.
  let swipeStart: { x: number; y: number } | null = null;
  function onCardTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) { swipeStart = null; return; }
    const t = e.touches[0];
    swipeStart = { x: t.clientX, y: t.clientY };
  }
  function onCardTouchEnd(e: TouchEvent, tab: TabKey, len: number) {
    if (!swipeStart || len < 2) { swipeStart = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.x;
    const dy = t.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    const idx = currentIdx[tab];
    if (dx < 0 && idx < len - 1) setIdx(tab, idx + 1);
    else if (dx > 0 && idx > 0) setIdx(tab, idx - 1);
  }

  async function pushArchive(kind: string, slug: string) {
    const key = `${kind}:${slug}`;
    const existing = stacks.archive.findIndex((s) => s.key === key);
    if (existing >= 0) {
      setIdx("archive", existing);
      openTab("archive", "detail");
      syncURL();
      return;
    }
    const item: ArchiveItem = { key, kind, slug, loading: true, error: null, data: null };
    stacks.archive = [...stacks.archive, item];
    setIdx("archive", stacks.archive.length - 1);
    openTab("archive", "detail");
    syncURL();
    try {
      const data = await fetchCard(kind, slug);
      stacks.archive = stacks.archive.map((s) => (s.key === key ? { ...s, data, loading: false } : s));
    } catch (e: any) {
      stacks.archive = stacks.archive.map((s) => (s.key === key ? { ...s, error: e?.message ?? "load failed", loading: false } : s));
    }
  }

  async function pushLibrary(slug: string, anchor: string, meta?: { similarity: number | null; origin: string }) {
    const key = `${slug}#${anchor}`;
    const existing = stacks.library.findIndex((s) => s.key === key);
    if (existing >= 0) {
      setIdx("library", existing);
      openTab("library", "detail");
      syncURL();
      return;
    }
    const item: LibraryItem = { key, slug, anchor, loading: true, error: null, data: null };
    stacks.library = [...stacks.library, item];
    setIdx("library", stacks.library.length - 1);
    openTab("library", "detail");
    syncURL();
    try {
      const data = await fetchVerse(slug, anchor);
      if (meta) data.correspondenceMeta = meta;
      stacks.library = stacks.library.map((s) => (s.key === key ? { ...s, data, loading: false } : s));
    } catch (e: any) {
      stacks.library = stacks.library.map((s) => (s.key === key ? { ...s, error: e?.message ?? "load failed", loading: false } : s));
    }
  }

  function pushFeed(kind: "chapter" | "verse", anchor: string, label?: string) {
    const key = `feed:${kind}:${anchor}`;
    const existing = stacks.feed.findIndex((s) => s.key === key);
    if (existing >= 0) {
      setIdx("feed", existing);
      openTab("feed", "detail");
      return;
    }
    const item: FeedItem = {
      key,
      kind,
      anchor,
      label: label ?? (kind === "chapter" ? `${anchor}장 전체` : `^${anchor}`),
    };
    stacks.feed = [...stacks.feed, item];
    setIdx("feed", stacks.feed.length - 1);
    openTab("feed", "detail");
  }

  function closeItem(tab: TabKey, key: string) {
    const arr = stacks[tab];
    const idx = arr.findIndex((s: any) => s.key === key);
    if (idx < 0) return;
    const next = arr.filter((s: any) => s.key !== key);
    stacks = { ...stacks, [tab]: next };
    const nextIdx = Math.min(currentIdx[tab], next.length - 1);
    setIdx(tab, Math.max(0, nextIdx));
    if (next.length === 0) viewMode = { ...viewMode, [tab]: "list" };
    syncURL();
  }

  // ─────────────────── feed target helper ─────────────────────────
  function feedTarget(item: FeedItem): string {
    if (item.kind === "chapter") {
      const [vol, chap] = item.anchor.split("-");
      return `chapter:${vol}:${chap}`;
    }
    return `verse:${scriptureSlug}:${item.anchor}`;
  }

  function feedLabelForVerse(anchor: string): string {
    return `^${anchor}`;
  }

  // ────────────────────── click intercept ─────────────────────────
  function handleClick(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const target = e.target as HTMLElement;

    // sparkle / verse-compare-link → library 탭
    const verseLink = target.closest("a.verse-compare-link") as HTMLAnchorElement | null;
    if (verseLink) {
      const slug = verseLink.dataset.targetSlug;
      const anchor = verseLink.dataset.targetAnchor;
      if (slug && anchor) {
        e.preventDefault();
        const simRaw = verseLink.dataset.similarity;
        const sim = simRaw ? parseFloat(simRaw) : null;
        const origin = verseLink.dataset.origin ?? "ai";
        pushLibrary(slug, anchor, { similarity: Number.isFinite(sim) ? sim : null, origin });
      }
      return;
    }

    // 💬 verse-comment-badge → feed 탭 verse detail
    const vcb = target.closest(".verse-comment-badge") as HTMLElement | null;
    if (vcb && scriptureMode) {
      e.preventDefault();
      e.stopPropagation();
      const anchor = vcb.dataset.anchor;
      if (anchor) pushFeed("verse", anchor, feedLabelForVerse(anchor));
      return;
    }

    // verse anchor link (verse-label 내부 #anchor) → feed 탭 verse detail
    if (scriptureMode) {
      const verseSecLabel = target.closest(".verse-label a[href^='#']") as HTMLAnchorElement | null;
      if (verseSecLabel) {
        const href = verseSecLabel.getAttribute("href") ?? "";
        const anchor = href.replace(/^#/, "");
        if (anchor && chapterContext?.verse_anchors.includes(anchor)) {
          e.preventDefault();
          pushFeed("verse", anchor, feedLabelForVerse(anchor));
          return;
        }
      }
    }

    // wikilink → archive 탭
    const a = target.closest("a.wikilink:not(.page)") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    const ref = hrefToCardRef(href);
    if (!ref) return;
    e.preventDefault();
    pushArchive(ref.kind, ref.slug);
  }

  function hrefToCardRef(href: string): { kind: string; slug: string } | null {
    const m = href.match(/^\/(?:archive|library)\/(people|places|dosu|terms|dates)\/([^/]+)\/?$/);
    if (!m) return null;
    return { kind: m[1], slug: decodeURIComponent(m[2]) };
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
  function minimizeSheet() {
    sheetOpen = false;
  }
  function openHandle() {
    sheetOpen = true;
  }

  // ────────────────────── URL sync ────────────────────────────────
  // 기존 호환: ?cards=kind:slug,... (archive 스택만 유지)
  function syncURL() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (stacks.archive.length === 0 && stacks.library.length === 0) {
      url.searchParams.delete("cards");
    } else {
      const tokens: string[] = [];
      for (const a of stacks.archive) tokens.push(`${a.kind}:${a.slug}`);
      for (const v of stacks.library) tokens.push(`verse:${v.slug}#${v.anchor}`);
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
      if (tok.startsWith("verse:")) {
        const rest = tok.slice("verse:".length);
        const hashIdx = rest.indexOf("#");
        if (hashIdx > 0) {
          const slug = rest.slice(0, hashIdx);
          const anchor = rest.slice(hashIdx + 1);
          pushLibrary(slug, anchor);
        }
      } else {
        const [kind, slug] = tok.split(":");
        if (kind && slug) pushArchive(kind, slug);
      }
    }
  }

  // ────────────────── tab data for views ──────────────────────────
  const tabMeta: Record<TabKey, { label: string; color: string }> = {
    library: { label: "서재", color: "var(--color-primary, #a8352a)" },
    archive: { label: "자료", color: "var(--color-muted, #8a807a)" },
    feed: { label: "피드", color: "var(--color-secondary, #1e6e6e)" },
  };

  // 장 전체 댓글 entry는 cheonjigaebyeokgyeong vol-chap 페이지에서만 (worker가
  // chapter:vol:chap 형식만 지원). 다른 페이지는 verse-level만 노출.
  const hasChapterLevel = $derived(!!chapterAnchor && /^\d+-\d+$/.test(chapterAnchor));

  const chapterLevelCount = $derived.by(() => {
    if (!hasChapterLevel || !chapterAnchor) return 0;
    const [vol, chap] = chapterAnchor.split("-");
    return verseCounts[`chapter:${vol}:${chap}`] ?? 0;
  });

  const tabCount = $derived({
    library: chapterContext?.scripture_refs.length ?? 0,
    archive: chapterContext?.card_refs.length ?? 0,
    feed:
      (chapterContext?.verse_anchors.filter(
        (a) => (verseCounts[`verse:${scriptureSlug}:${a}`] ?? 0) > 0,
      ).length ?? 0) + (chapterLevelCount > 0 ? 1 : 0),
  });

  // sibling links — 자료 탭 detail에서 같은 chapter의 다른 카드들
  const archiveSiblings = $derived<CardRef[]>(
    chapterContext && stacks.archive[currentIdx.archive]
      ? chapterContext.card_refs.filter(
          (r) =>
            !(r.kind === stacks.archive[currentIdx.archive].kind && r.slug === stacks.archive[currentIdx.archive].slug),
        )
      : [],
  );
  const currentCardAnchors = $derived<string[]>(
    chapterContext && stacks.archive[currentIdx.archive]
      ? chapterContext.card_refs.find(
          (r) =>
            r.kind === stacks.archive[currentIdx.archive].kind &&
            r.slug === stacks.archive[currentIdx.archive].slug,
        )?.anchors ?? []
      : [],
  );

  function onAppearanceClick(anchor: string, kind: string, slug: string) {
    // Base.astro의 document-level click 핸들러가 href="#anchor" 클릭을 가로채
    // pushState + jumpAndFlash(절 box-shadow flash)를 먼저 수행. 그 다음 우리는
    // 절 안의 해당 카드 wikilink를 강조하고 sidecard를 minimize.
    setTimeout(() => {
      flashWikilinksInVerse(anchor, kind, slug);
      minimizeSheet();
    }, 0);
  }

  function flashWikilinksInVerse(anchor: string, kind: string, slug: string) {
    // anchor id는 <h4 class="verse-anchor-heading">에 있고 wikilink는 형제 div
    // (original-box / verse-body)에 있다. 따라서 검색 루트는 부모 section.verse.
    const headingEl = document.getElementById(anchor);
    const verseEl = headingEl?.closest("section.verse");
    if (!verseEl) return;
    const sel = `a.wikilink[data-card-kind="${cssAttr(kind)}"][data-card-slug="${cssAttr(slug)}"]`;
    const wls = verseEl.querySelectorAll<HTMLElement>(sel);
    wls.forEach((wl) => {
      wl.classList.remove("target-flash");
      void wl.offsetWidth;
      wl.classList.add("target-flash");
      window.setTimeout(() => wl.classList.remove("target-flash"), 2500);
    });
  }

  // attribute selector 값으로 쓰기 위해 따옴표/백슬래시를 이스케이프.
  function cssAttr(v: string): string {
    return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  const librarySiblings = $derived<ScriptureRef[]>(
    chapterContext && stacks.library[currentIdx.library]
      ? chapterContext.scripture_refs.filter(
          (r) =>
            !(r.slug === stacks.library[currentIdx.library].slug && r.anchor === stacks.library[currentIdx.library].anchor),
        )
      : [],
  );
</script>

{#snippet tabBar()}
  <div class="tab-bar" role="tablist">
    {#each (["library", "archive", "feed"] as TabKey[]) as tk}
      <button
        type="button"
        role="tab"
        class="tab"
        class:active={activeTab === tk}
        style:--tab-color={tabMeta[tk].color}
        aria-selected={activeTab === tk}
        onclick={() => onTabClick(tk)}
      >
        <span class="tab-label">{tabMeta[tk].label}</span>
        {#if tabCount[tk] > 0}
          <span class="tab-count">{tabCount[tk]}</span>
        {/if}
      </button>
    {/each}
  </div>
{/snippet}

{#snippet dots(tab: TabKey, len: number)}
  {#if len > 1}
    <footer class="indicator" style:--tab-color={tabMeta[tab].color}>
      {#if len <= 7}
        {#each Array(len) as _, i}
          <button
            type="button"
            class="dot"
            class:active={i === currentIdx[tab]}
            aria-label={`${i + 1}번째 항목`}
            onclick={() => setIdx(tab, i)}
          ></button>
        {/each}
      {:else}
        <span class="count-text">{currentIdx[tab] + 1} / {len}</span>
      {/if}
    </footer>
  {/if}
{/snippet}

{#snippet chevrons(tab: TabKey, len: number)}
  {#if len >= 2}
    {@const idx = currentIdx[tab]}
    {#if idx > 0}
      <button
        type="button"
        class="nav-chevron prev"
        style:--tab-color={tabMeta[tab].color}
        aria-label="이전 항목"
        title="이전 항목"
        onclick={() => setIdx(tab, idx - 1)}
      >
        <Icon icon="chevron-left" size={20} />
      </button>
    {/if}
    {#if idx < len - 1}
      <button
        type="button"
        class="nav-chevron next"
        style:--tab-color={tabMeta[tab].color}
        aria-label="다음 항목"
        title="다음 항목"
        onclick={() => setIdx(tab, idx + 1)}
      >
        <Icon icon="chevron-right" size={20} />
      </button>
    {/if}
  {/if}
{/snippet}

{#snippet detailHeader(tab: TabKey, title: import("svelte").Snippet, key: string)}
  <div class="detail-head" style:--tab-color={tabMeta[tab].color}>
    {#if scriptureMode}
      <button
        type="button"
        class="back-list"
        title="목록으로"
        aria-label="목록으로"
        onclick={() => (viewMode = { ...viewMode, [tab]: "list" })}
      >
        <Icon icon="arrow-left" size={14} />
        <span>목록</span>
      </button>
    {/if}
    <span class="detail-title">{@render title()}</span>
    <button
      type="button"
      class="card-close"
      aria-label="이 항목 닫기"
      title="이 항목 닫기"
      onclick={() => closeItem(tab, key)}
    >
      <Icon icon="x" size={14} />
    </button>
  </div>
{/snippet}

<aside class:open={sheetVisible} aria-hidden={!sheetVisible}>
  <header class="sb-head">
    {#if scriptureMode && chapterLabel}
      <span class="title">{chapterLabel}</span>
    {:else}
      <span class="title">관련 카드</span>
    {/if}
    <button class="close" onclick={minimizeSheet} title="시트 닫기" aria-label="시트 닫기">
      <Icon icon="chevron-down" size={20} />
    </button>
  </header>

  {@render tabBar()}

  <div class="tab-body">
    {#if activeTab === "library"}
      {#if viewMode.library === "list" || stacks.library.length === 0}
        <div class="list-view">
          {#if !scriptureMode}
            <p class="muted center">이 탭은 경전 페이지에서 사용할 수 있습니다.</p>
          {:else if chapterContextLoading}
            <p class="muted center">불러오는 중…</p>
          {:else if (chapterContext?.scripture_refs.length ?? 0) === 0}
            <p class="muted center">유사한 다른 경전의 절이 없습니다.</p>
          {:else}
            <ul class="list">
              {#each chapterContext!.scripture_refs as r (r.slug + r.anchor)}
                <li>
                  <button
                    type="button"
                    class="list-item lib"
                    onclick={() => pushLibrary(r.slug, r.anchor)}
                  >
                    <span class="li-pill lib-pill">{SCRIPTURE_NAME[r.slug] ?? r.slug}</span>
                    <span class="li-title">^{r.anchor}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        {@const item = stacks.library[currentIdx.library]}
        {#if item}
          {#snippet libTitle()}
            <span class="kind-pill lib-pill">{item.data?.scriptureName ?? SCRIPTURE_NAME[item.slug] ?? item.slug}</span>
            <span class="title-text">
              ^{item.anchor}
              {#if item.data?.correspondenceMeta?.similarity}
                <span class="hanja">({(item.data.correspondenceMeta.similarity * 100).toFixed(0)}%)</span>
              {/if}
            </span>
          {/snippet}
          <div
            class="detail-wrap"
            ontouchstart={onCardTouchStart}
            ontouchend={(e) => onCardTouchEnd(e, "library", stacks.library.length)}
          >
          {@render detailHeader("library", libTitle, item.key)}
          {@render chevrons("library", stacks.library.length)}
          <div class="detail-body" bind:this={detailEls.library}>
            {#if item.loading}
              <p class="muted">불러오는 중…</p>
            {:else if item.error}
              <p class="muted">불러오기 실패: {item.error}</p>
            {:else if item.data}
              <p class="verse-meta">
                {item.data.title}
                {#if item.data.correspondenceMeta}
                  <span class="muted">
                    ·
                    {item.data.correspondenceMeta.origin === "curator"
                      ? "운영자 확정"
                      : item.data.correspondenceMeta.origin === "community"
                        ? "회원 발견"
                        : "AI 자동 매칭"}
                  </span>
                {/if}
              </p>
              <div class="card-html">{@html item.data.bodyHTML}</div>
              {#if librarySiblings.length > 0}
                <section class="siblings">
                  <h4>이 절의 다른 유사 절</h4>
                  <ul>
                    {#each librarySiblings as r}
                      <li>
                        <button type="button" class="sib-btn" onclick={() => pushLibrary(r.slug, r.anchor)}>
                          <span class="li-pill lib-pill">{SCRIPTURE_NAME[r.slug] ?? r.slug}</span>
                          <span>^{r.anchor}</span>
                        </button>
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
          {@render dots("library", stacks.library.length)}
          </div>
        {/if}
      {/if}
    {:else if activeTab === "archive"}
      {#if viewMode.archive === "list" || stacks.archive.length === 0}
        <div class="list-view">
          {#if !scriptureMode}
            <p class="muted center">본문에서 위키링크를 누르면 이곳에 카드가 쌓입니다.</p>
          {:else if chapterContextLoading}
            <p class="muted center">불러오는 중…</p>
          {:else if (chapterContext?.card_refs.length ?? 0) === 0}
            <p class="muted center">참조된 카드가 없습니다.</p>
          {:else}
            <ul class="list">
              {#each chapterContext!.card_refs as r (r.kind + r.slug)}
                <li>
                  <button
                    type="button"
                    class="list-item arc"
                    onclick={() => pushArchive(r.kind, r.slug)}
                  >
                    <span class="li-pill arc-pill">{KIND_PILL[r.kind] ?? r.kind}</span>
                    <span class="li-title">{r.name}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        {@const item = stacks.archive[currentIdx.archive]}
        {#if item}
          {#snippet arcTitle()}
            <span class="kind-pill arc-pill">{item.data?.kindLabel ?? KIND_PILL[item.kind] ?? item.kind}</span>
            <span class="title-text">
              {item.data?.name ?? item.slug}
              {#if item.data?.name_hanja}
                <span class="hanja">({item.data.name_hanja})</span>
              {/if}
            </span>
          {/snippet}
          <div
            class="detail-wrap"
            ontouchstart={onCardTouchStart}
            ontouchend={(e) => onCardTouchEnd(e, "archive", stacks.archive.length)}
          >
          {@render detailHeader("archive", arcTitle, item.key)}
          {@render chevrons("archive", stacks.archive.length)}
          <div class="detail-body" bind:this={detailEls.archive}>
            {#if item.loading}
              <p class="muted">불러오는 중…</p>
            {:else if item.error}
              <p class="muted">불러오기 실패: {item.error}</p>
            {:else if item.data}
              {#if item.data.status === "stub"}
                <p class="stub">※ 스텁(stub) — 보강 예정</p>
              {/if}
              {#if currentCardAnchors.length > 0}
                <section class="appearances">
                  <h4>이 페이지에서 등장 ({currentCardAnchors.length})</h4>
                  <ul>
                    {#each currentCardAnchors as a (a)}
                      <li>
                        <a
                          class="appearance-link"
                          href={`#${a}`}
                          onclick={() => onAppearanceClick(a, item.kind, item.slug)}
                        >^{a}</a>
                      </li>
                    {/each}
                  </ul>
                </section>
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
              {#if archiveSiblings.length > 0}
                <section class="siblings">
                  <h4>이 절의 다른 카드</h4>
                  <ul>
                    {#each archiveSiblings as r}
                      <li>
                        <button type="button" class="sib-btn" onclick={() => pushArchive(r.kind, r.slug)}>
                          <span class="li-pill arc-pill">{KIND_PILL[r.kind] ?? r.kind}</span>
                          <span>{r.name}</span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                </section>
              {/if}
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
          {@render dots("archive", stacks.archive.length)}
          </div>
        {/if}
      {/if}
    {:else}
      {#if viewMode.feed === "list" || stacks.feed.length === 0}
        <div class="list-view">
          {#if !scriptureMode}
            <p class="muted center">이 탭은 경전 페이지에서 사용할 수 있습니다.</p>
          {:else if chapterContextLoading || verseFeedData === null}
            <p class="muted center">불러오는 중…</p>
          {:else}
            {@const feedEntries = verseFeedData ?? []}
            {@const openedVerses = new Set(stacks.feed.filter((s) => s.kind === "verse").map((s) => s.anchor))}
            {@const chapterOpened = stacks.feed.some((s) => s.kind === "chapter")}
            <ul class="list">
              {#if hasChapterLevel && chapterLevelCount > 0}
                <li>
                  <button
                    type="button"
                    class="list-item fd"
                    class:opened={chapterOpened}
                    onclick={() => pushFeed("chapter", chapterAnchor!, "이 장 전체 댓글")}
                  >
                    <span class="li-pill fd-pill">전체</span>
                    <span class="li-title">이 장 댓글</span>
                    <span class="li-count">{chapterLevelCount}</span>
                  </button>
                </li>
              {/if}
              {#each feedEntries as e (e.anchor)}
                <li>
                  <button
                    type="button"
                    class="list-item fd verse-row"
                    class:opened={openedVerses.has(e.anchor)}
                    onclick={() => pushFeed("verse", e.anchor, feedLabelForVerse(e.anchor))}
                  >
                    <div class="vr-head">
                      <span class="li-pill fd-pill">절</span>
                      <span class="li-title">^{e.anchor}</span>
                      <span class="li-count">{e.count}</span>
                      <span class="vr-time">
                        <RelativeTime iso={e.latest.created_at} interval={60_000} />
                      </span>
                    </div>
                    <div class="vr-preview">
                      <span class="vr-body">{e.latest.body}</span>
                      <span class="vr-author">
                        <UserName user={{ nickname: e.latest.user_nickname, is_admin: e.latest.is_admin }} />
                      </span>
                    </div>
                  </button>
                </li>
              {/each}
              {#if feedEntries.length === 0 && !(hasChapterLevel && chapterLevelCount > 0)}
                <li class="muted center small">아직 댓글이 없습니다.</li>
              {/if}
            </ul>
          {/if}
        </div>
      {:else}
        {@const item = stacks.feed[currentIdx.feed]}
        {#if item}
          {#snippet fdTitle()}
            <span class="kind-pill fd-pill">댓글</span>
            <span class="title-text">{item.label}</span>
          {/snippet}
          <div
            class="detail-wrap"
            ontouchstart={onCardTouchStart}
            ontouchend={(e) => onCardTouchEnd(e, "feed", stacks.feed.length)}
          >
          {@render detailHeader("feed", fdTitle, item.key)}
          {@render chevrons("feed", stacks.feed.length)}
          <div class="detail-body feed-body" bind:this={detailEls.feed}>
            {#key feedTarget(item)}
              <Comments target={feedTarget(item)} />
            {/key}
          </div>
          {@render dots("feed", stacks.feed.length)}
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</aside>

{#if handleVisible && !sheetVisible}
  <button
    class="reopen-handle"
    class:has-new={handleNewCount > 0}
    type="button"
    onclick={openHandle}
    aria-label={handleNewCount > 0
      ? `새 댓글 ${handleNewCount}개`
      : handleTotalCount > 0
        ? `댓글 ${handleTotalCount}개`
        : `관련 카드 ${stackTotal}개`}
    title={handleNewCount > 0
      ? `새 댓글 ${handleNewCount}개`
      : handleTotalCount > 0
        ? `댓글 ${handleTotalCount}개`
        : `관련 카드 ${stackTotal}개`}
  >
    <span class="handle-icon handle-icon--desktop" aria-hidden="true">
      <Icon icon="panel-right-open" size={22} strokeWidth={1.8} />
    </span>
    <span class="handle-icon handle-icon--mobile" aria-hidden="true">
      <Icon icon="chevron-up" size={20} strokeWidth={2} />
    </span>
    {#if handleCountText}
      <span class="handle-count">{handleCountText}</span>
    {/if}
  </button>
{/if}

<style>
  aside {
    position: fixed;
    background: var(--color-bg, #fbf8f4);
    border-left: 1px solid var(--color-rule, #e8dfd9);
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.18);
    transform: translateX(100%);
    transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 80;
  }
  aside.open { transform: translateX(0); }
  @media (min-width: 1024px) {
    aside { top: 0; right: 0; bottom: 0; width: 420px; max-width: 36vw; }
  }
  @media (max-width: 1023px) {
    aside {
      left: 0; right: 0; bottom: 0; height: 78vh;
      transform: translateY(100%);
      border-left: none;
      border-top: 1px solid var(--rule, #e5e5e0);
      border-radius: 12px 12px 0 0;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.1);
    }
    aside.open { transform: translateY(0); }
  }

  .sb-head {
    display: flex; align-items: center; gap: 0.5rem;
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
  .sb-head button.close {
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent;
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 4px; padding: 0.25rem 0.4rem;
    cursor: pointer;
    color: var(--color-primary, #a8352a);
  }
  .sb-head button.close:hover {
    background: var(--color-primary, #a8352a);
    color: var(--color-bg, #fbf8f4);
  }
  @media (min-width: 1024px) {
    .sb-head button.close :global(svg) { transform: rotate(-90deg); }
  }

  .tab-bar {
    display: flex; align-items: stretch;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
    flex-shrink: 0;
  }
  .tab {
    flex: 1;
    display: inline-flex; align-items: center; justify-content: center;
    gap: 0.3rem;
    padding: 0.55rem 0.4rem 0.5rem;
    background: transparent; border: none; cursor: pointer;
    color: var(--color-muted, #8a807a);
    font-size: 0.88rem;
    border-bottom: 2px solid transparent;
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    --tab-color: var(--color-muted, #8a807a);
  }
  .tab:hover { background: var(--color-surface-2, rgba(0,0,0,0.04)); }
  .tab.active {
    color: var(--tab-color);
    border-bottom-color: var(--tab-color);
    font-weight: 600;
  }
  .tab-count {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 0.35em;
    font-size: 0.74rem;
    border-radius: 999px;
    background: transparent;
    color: var(--tab-color);
    border: 1px solid var(--tab-color);
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    opacity: 0.85;
  }
  .tab.active .tab-count {
    background: var(--tab-color);
    color: var(--color-bg, #fbf8f4);
    border-color: var(--tab-color);
    opacity: 1;
  }

  .tab-body {
    flex: 1;
    min-height: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  /* List view */
  .list-view {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 0.4rem 0.4rem;
  }
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .list-item {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%; text-align: left;
    padding: 0.55rem 0.7rem;
    background: var(--color-bg, #fbf8f4);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
    font: inherit; color: var(--color-fg, #1f1c1a);
  }
  .list-item:hover { transform: translateY(-1px); }
  .list-item.lib:hover { border-color: var(--color-primary, #a8352a); background: var(--color-primary-bg, #fbf3f1); }
  .list-item.arc:hover { border-color: var(--color-muted, #8a807a); background: var(--color-surface-2, #f6efe9); }
  .list-item.fd:hover { border-color: var(--color-secondary, #1e6e6e); background: var(--color-secondary-bg, #f0f7f6); }

  .li-pill {
    font-size: 0.72rem;
    border-radius: 999px;
    padding: 1px 8px;
    border: 1px solid currentColor;
    flex-shrink: 0;
  }
  .lib-pill { color: var(--color-primary, #a8352a); }
  .arc-pill { color: var(--color-muted, #8a807a); }
  .fd-pill { color: var(--color-secondary, #1e6e6e); }

  .li-title { flex: 1; font-size: 0.92rem; }
  .li-count {
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
    background: var(--color-rule, #e8dfd9);
    border-radius: 999px;
    padding: 1px 8px;
    min-width: 1.4em;
    text-align: center;
  }

  /* 이미 열어본 리스트 항목 하이라이트 */
  .list-item.opened {
    background: var(--color-surface-2, #f6efe9);
    border-left: 3px solid var(--color-secondary, #1e6e6e);
    padding-left: calc(0.7rem - 3px);
  }
  .list-item.lib.opened { border-left-color: var(--color-primary, #a8352a); }
  .list-item.arc.opened { border-left-color: var(--color-muted, #8a807a); }
  .list-item.fd.opened { border-left-color: var(--color-secondary, #1e6e6e); }

  /* 피드 verse-row: 2단 (header + preview) */
  .list-item.verse-row { flex-direction: column; align-items: stretch; gap: 0.3rem; padding: 0.55rem 0.7rem; }
  .vr-head {
    display: flex; align-items: center; gap: 0.5rem;
    width: 100%;
  }
  .vr-head .li-title { flex: 0 0 auto; }
  .vr-head .li-count { margin-left: auto; }
  .vr-time {
    display: inline-flex;
    font-size: 0.74rem;
  }
  .vr-time :global(time) { font-size: 0.74rem; }
  .vr-preview {
    display: flex; align-items: baseline; gap: 0.5rem;
    font-size: 0.82rem; line-height: 1.4;
    color: var(--color-fg, #1f1c1a);
    width: 100%;
    overflow: hidden;
  }
  .vr-body {
    flex: 1;
    color: var(--color-fg, #1f1c1a);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  }
  .vr-author {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--color-muted, #8a807a);
    display: inline-flex; align-items: center; gap: 0.2rem;
  }
  .vr-author :global(.user-name) { font-size: 0.78rem; gap: 0.25rem; }
  .vr-author :global(.user-name .name) { font-weight: 600; max-width: 8em; }
  .vr-author :global(.user-name .badge) { font-size: 0.66rem; padding: 0 5px; }

  /* Detail wrapper — holds header + body + chevrons + dots */
  .detail-wrap {
    position: relative;
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
  }
  .nav-chevron {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px; height: 40px;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--color-bg, #fbf8f4);
    border: 1.5px solid var(--tab-color, var(--color-primary, #a8352a));
    border-radius: 50%;
    color: var(--tab-color, var(--color-primary, #a8352a));
    cursor: pointer;
    box-shadow:
      0 6px 16px rgba(0, 0, 0, 0.2),
      0 2px 4px rgba(0, 0, 0, 0.12),
      0 0 0 4px rgba(255, 255, 255, 0.55);
    z-index: 5;
    opacity: 0.95;
    transition: opacity 0.15s ease, background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    --tab-color: var(--color-primary, #a8352a);
  }
  .nav-chevron:hover, .nav-chevron:focus-visible {
    opacity: 1;
    background: var(--tab-color);
    color: var(--color-bg, #fbf8f4);
    transform: translateY(-50%) scale(1.06);
    box-shadow:
      0 8px 20px rgba(0, 0, 0, 0.25),
      0 3px 6px rgba(0, 0, 0, 0.15),
      0 0 0 4px rgba(255, 255, 255, 0.6);
  }
  .nav-chevron.prev { left: 0.5rem; }
  .nav-chevron.next { right: 0.5rem; }

  /* Detail */
  .detail-head {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.55rem 0.85rem;
    background: var(--color-bg, #fbf8f4);
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    user-select: none;
    flex-shrink: 0;
    --tab-color: var(--color-primary, #a8352a);
  }
  .back-list {
    display: inline-flex; align-items: center; gap: 0.25rem;
    background: transparent; border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 4px; padding: 0.18rem 0.5rem;
    cursor: pointer; color: var(--color-muted, #8a807a);
    font-size: 0.78rem;
    flex-shrink: 0;
  }
  .back-list:hover { color: var(--tab-color); border-color: var(--tab-color); }
  .detail-title {
    flex: 1;
    display: inline-flex; align-items: center; gap: 0.4rem;
    font-weight: 600; font-size: 0.95rem;
  }
  .detail-title .kind-pill {
    font-size: 0.72rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 1px 8px;
    flex-shrink: 0;
    color: var(--tab-color);
  }
  .detail-title .title-text { flex: 1; font-size: 0.96rem; }
  .detail-title .hanja {
    font-weight: normal; color: var(--hanja, #555); font-size: 0.78em;
  }
  .card-close {
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; cursor: pointer;
    color: var(--muted, #888); padding: 2px 4px; border-radius: 3px;
  }
  .card-close:hover { color: var(--fg, #222); background: var(--rule, #e5e5e0); }
  .detail-body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 0.6rem 1rem 4.5rem;
    font-size: 0.95rem; line-height: 1.6;
  }
  .detail-body.feed-body { padding: 0.4rem 0.6rem 4.5rem; }

  /* Siblings */
  .siblings {
    margin-top: 1.2rem;
    padding-top: 0.8rem;
    border-top: 1px dashed var(--color-rule, #e8dfd9);
  }
  .siblings h4 {
    font-size: 0.82rem; color: var(--color-muted, #8a807a);
    margin: 0 0 0.5rem; font-weight: 600;
  }
  .siblings ul { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .sib-btn {
    display: inline-flex; align-items: center; gap: 0.3rem;
    background: var(--color-bg, #fbf8f4);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px; padding: 0.25rem 0.55rem;
    cursor: pointer; font: inherit; font-size: 0.82rem;
    color: var(--color-fg, #1f1c1a);
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .sib-btn:hover { border-color: var(--color-primary, #a8352a); background: var(--color-primary-bg, #fbf3f1); }

  /* Appearances — 이 페이지에서 등장 */
  .appearances {
    margin: 0 0 0.9rem;
    padding: 0.5rem 0.7rem;
    background: var(--color-secondary-bg, #f0f7f6);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 6px;
  }
  .appearances h4 {
    font-size: 0.82rem;
    margin: 0 0 0.4rem;
    color: var(--color-secondary, #1e6e6e);
    font-weight: 600;
  }
  .appearances ul {
    list-style: none;
    padding: 0; margin: 0;
    display: flex; flex-wrap: wrap; gap: 0.3rem;
  }
  .appearance-link {
    display: inline-flex; align-items: center;
    padding: 0.18rem 0.55rem;
    background: var(--color-bg, #fbf8f4);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 999px;
    color: var(--color-secondary, #1e6e6e);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .appearance-link:hover,
  .appearance-link:focus-visible {
    background: var(--color-secondary, #1e6e6e);
    color: var(--color-bg, #fbf8f4);
  }

  /* Dots */
  .indicator {
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    border-top: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
    --tab-color: var(--color-primary, #a8352a);
  }
  .dot {
    width: 9px; height: 9px;
    border-radius: 50%;
    background: var(--color-disabled, #b8b0aa);
    border: none; padding: 0; cursor: pointer;
    transition: background 0.15s ease, transform 0.15s ease;
  }
  .dot.active { background: var(--tab-color); transform: scale(1.3); }
  .count-text {
    font-size: 0.82rem; color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
  }

  /* Reopen handle */
  .reopen-handle {
    position: fixed; z-index: 70;
    background: var(--color-primary, #a8352a);
    color: #fff; border: none; cursor: pointer;
    font: inherit; font-weight: 700; font-size: 0.95rem;
    line-height: 1; font-variant-numeric: tabular-nums;
    display: inline-flex; align-items: center; justify-content: center;
    transition: transform 0.18s ease, opacity 0.2s ease, box-shadow 0.18s ease;
    animation: handle-in 0.25s ease both;
  }
  .reopen-handle.has-new {
    background: #c43025;
    box-shadow: 0 0 0 3px rgba(196, 48, 37, 0.18);
  }
  .handle-icon {
    display: none;
    align-items: center; justify-content: center;
    transition: transform 0.18s ease;
    color: #fff;
  }
  .handle-icon--mobile { display: inline-flex; }
  .handle-count {
    position: absolute;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: #fff;
    color: var(--color-primary, #a8352a);
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 18px;
    box-shadow: 0 0 0 1.5px var(--color-primary, #a8352a);
    text-align: center;
    box-sizing: border-box;
  }
  .reopen-handle.has-new .handle-count {
    color: #c43025;
    box-shadow: 0 0 0 1.5px #c43025;
  }
  @keyframes handle-in {
    from { opacity: 0; transform: scale(0.6); }
    to { opacity: 1; }
  }

  @media (max-width: 1023px) {
    .reopen-handle {
      bottom: 0; left: 50%; transform: translateX(-50%);
      min-width: 56px; height: 44px;
      border-radius: 64px 64px 0 0;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.18);
      padding: 0 14px 6px;
    }
    .reopen-handle:hover .handle-icon--mobile,
    .reopen-handle:focus-visible .handle-icon--mobile {
      transform: translateY(-2px);
    }
    .handle-count {
      top: 2px;
      right: 6px;
    }
    @keyframes handle-in {
      from { opacity: 0; transform: translateX(-50%) scale(0.6); }
      to { opacity: 1; transform: translateX(-50%) scale(1); }
    }
  }
  @media (min-width: 1024px) {
    .reopen-handle {
      right: 0; top: 50%; transform: translateY(-50%);
      width: 40px; height: 84px;
      border-radius: 84px 0 0 84px;
      box-shadow: -4px 0 14px rgba(0, 0, 0, 0.22);
      padding-right: 6px;
    }
    .handle-icon--mobile { display: none; }
    .handle-icon--desktop { display: inline-flex; }
    .reopen-handle:hover, .reopen-handle:focus-visible {
      transform: translate(-3px, -50%);
      box-shadow: -6px 0 18px rgba(0, 0, 0, 0.28);
    }
    .reopen-handle:hover .handle-icon--desktop,
    .reopen-handle:focus-visible .handle-icon--desktop {
      transform: translateX(-4px);
    }
    .handle-count {
      top: 6px;
      right: 6px;
    }
    @keyframes handle-in {
      from { opacity: 0; transform: translateY(-50%) scale(0.6); }
      to { opacity: 1; transform: translateY(-50%) scale(1); }
    }
  }

  :global(body[data-sidecard="minimized"]) { padding-bottom: 0; }
  @media (max-width: 1023px) {
    :global(body[data-sidecard="minimized"]) { padding-bottom: 56px; }
  }

  /* Inline helpers */
  .muted { color: var(--color-muted, #8a807a); font-size: 0.9rem; }
  .muted.center { text-align: center; padding: 2rem 0.8rem; }
  .muted.small { font-size: 0.82rem; padding: 1rem 0.6rem; }
  .stub { font-size: 0.82rem; color: var(--color-primary, #a8352a); margin: 0 0 0.6rem; }
  .meta-list {
    margin: 0.4rem 0 1rem;
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.7rem; row-gap: 0.2rem;
    font-size: 0.85rem;
  }
  .meta-list dt { color: var(--muted, #888); }
  .meta-list dd { margin: 0; }
  .verse-meta { font-size: 0.85rem; color: var(--color-muted, #8a807a); margin: 0.2rem 0 0.6rem; }
  .open-full {
    margin-top: 1rem; padding-top: 0.7rem;
    border-top: 1px dashed var(--color-rule, #e8dfd9);
    font-size: 0.85rem;
  }
  .open-full :global(a) {
    color: var(--color-secondary, #1e6e6e);
    border-bottom: 1px solid var(--color-secondary, #1e6e6e);
    text-decoration: none;
  }
  .bl {
    margin-top: 1.4rem; padding-top: 0.9rem;
    border-top: 1px solid var(--color-rule, #e8dfd9);
  }
  .bl h3 { font-size: 0.9rem; color: var(--color-primary, #a8352a); margin: 0 0 0.5rem; }
  .bl ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .bl li {
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 5px; padding: 0.4rem 0.6rem;
    background: var(--color-secondary-bg, #f0f7f6);
    font-size: 0.86rem;
  }
  .bl a {
    display: inline-flex; align-items: center; gap: 0.4rem;
    text-decoration: none; color: var(--color-fg, #1f1c1a);
  }
  .bl-pill {
    font-size: 0.7rem; color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 999px; padding: 1px 6px; flex-shrink: 0;
  }
  .bl-title { font-weight: 600; }
  .bl-excerpt { margin: 0.25rem 0 0; color: var(--color-muted, #8a807a); font-size: 0.78rem; line-height: 1.5; }

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
  .card-html :global(h1), .card-html :global(h2), .card-html :global(h3) {
    font-size: 1rem; color: var(--color-primary, #a8352a);
    margin: 1.2rem 0 0.4rem;
  }
  .card-html :global(p) { margin: 0.4rem 0; }
  .card-html :global(ul), .card-html :global(ol) { padding-left: 1.2rem; }

  /* verse-comment-badge — 본문에 동적 주입 */
  :global(.verse-comment-badge) {
    display: inline-flex; align-items: center; gap: 0.3rem;
    margin-left: 0.6rem;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem; line-height: 1.2;
    color: var(--color-secondary, #1e6e6e);
    background: var(--color-secondary-bg, #f0f7f6);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 999px;
    cursor: pointer;
    transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease, background 0.15s ease, transform 0.1s ease;
    vertical-align: middle;
    box-shadow: 0 1px 2px rgba(30, 110, 110, 0.08);
  }
  :global(.verse-comment-badge:hover),
  :global(.verse-comment-badge:focus-visible) {
    color: #fff;
    border-color: var(--color-secondary, #1e6e6e);
    background: var(--color-secondary, #1e6e6e);
    opacity: 1;
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(30, 110, 110, 0.2);
  }
  :global(.verse-comment-badge.is-empty) { opacity: 0.7; }
  :global(.verse-comment-badge.is-empty:hover) { opacity: 1; }
  :global(.verse-comment-badge svg) { flex-shrink: 0; }
  :global(.verse-comment-badge .vcb-count) {
    font-variant-numeric: tabular-nums; font-weight: 500;
  }
  :global(.verse-comment-badge.is-empty .vcb-count) { display: none; }
</style>
