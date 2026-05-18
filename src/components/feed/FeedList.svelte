<script lang="ts">
  import { onMount } from "svelte";
  import { relativeTime } from "../../lib/relative-time";

  type FeedItem = {
    id: string;
    target_type: string;
    target_id: string;
    scripture: string | null;
    anchor: string | null;
    preview: string;
    photos: number;
    created_at: string;
    author: { display_name: string; avatar_url: string | null; is_admin: boolean };
  };

  type VerseData = {
    scriptureName: string;
    pageHref: string;
    title?: string;
    vol?: number | null;
    chap?: number | null;
  };

  interface Props {
    /** 'recent' = 전체 피드 (공개), 'mine' = 내 활동 (로그인 필요) */
    source: "recent" | "mine";
  }

  let { source }: Props = $props();

  let items = $state<FeedItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let nextCursor = $state<string | null>(null);
  let versesIndex = $state<Record<string, VerseData>>({});

  async function fetchPage(before: string | null = null) {
    const endpoint = source === "mine" ? "/api/comments/mine" : "/api/comments/recent";
    const url = before ? `${endpoint}?before=${encodeURIComponent(before)}` : endpoint;
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { items: FeedItem[]; nextCursor: string | null };
  }

  async function loadVerses() {
    try {
      const res = await fetch("/verses.json", { credentials: "same-origin" });
      if (res.ok) versesIndex = await res.json();
    } catch {}
  }

  onMount(async () => {
    await loadVerses();
    try {
      const r = await fetchPage();
      items = r.items;
      nextCursor = r.nextCursor;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const r = await fetchPage(nextCursor);
      items = [...items, ...r.items];
      nextCursor = r.nextCursor;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function verseContext(item: FeedItem): { name: string; href: string } | null {
    if (!item.scripture || !item.anchor) return null;
    const v = versesIndex[`${item.scripture}#${item.anchor}`];
    if (v) return { name: v.scriptureName, href: v.pageHref };
    // verses.json 에 없는 anchor (구식 데이터) — 일단 slug 페이지 + hash 로 fallback.
    return { name: item.scripture, href: `/library/${item.scripture}/#${item.anchor}` };
  }

  function truncatePreview(s: string, max = 20): string {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
</script>

{#if loading}
  <p class="muted center">불러오는 중…</p>
{:else if error}
  <p class="error">불러올 수 없습니다: {error}</p>
{:else if items.length === 0}
  <p class="muted center">
    {source === "mine" ? "아직 작성한 댓글이 없습니다." : "아직 게시된 댓글이 없습니다."}
  </p>
{:else}
  <ol class="feed">
    {#each items as item (item.id)}
      {@const ctx = verseContext(item)}
      <li class="card">
        <div class="head">
          {#if item.author.avatar_url}
            <img class="avatar" src={item.author.avatar_url} alt="" loading="lazy" />
          {:else}
            <span class="avatar avatar-blank" aria-hidden="true"></span>
          {/if}
          <span class="author">
            {item.author.display_name || "익명"}
            {#if item.author.is_admin}<span class="badge-admin">운영자</span>{/if}
          </span>
          <time class="time" datetime={item.created_at}>{relativeTime(item.created_at)}</time>
        </div>

        <div class="target-row">
          {#if ctx}
            <a class="target" href={`${ctx.href}`}>
              <span class="target-name">{ctx.name}</span>
              {#if item.anchor}<span class="target-anchor">^{item.anchor}</span>{/if}
            </a>
          {:else}
            <span class="target target-plain">
              <span class="target-name">{item.target_type} · {item.target_id}</span>
            </span>
          {/if}
          {#if item.preview}
            <span class="preview">{truncatePreview(item.preview)}</span>
          {/if}
        </div>
        {#if item.photos > 0 && !item.preview.startsWith("📷")}
          <p class="photos">📷 사진 {item.photos}장</p>
        {/if}
      </li>
    {/each}
  </ol>
  {#if nextCursor}
    <div class="more-wrap">
      <button type="button" class="more" onclick={loadMore}>더 보기</button>
    </div>
  {/if}
{/if}

<style>
  .muted { color: var(--color-muted, #8a807a); }
  .center { text-align: center; padding: 2rem 0; }
  .error { color: var(--color-primary, #a8352a); }

  .feed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .card {
    background: #ffffff;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    padding: 0.85rem 1rem;
    box-shadow: 0 1px 2px rgba(60, 40, 25, 0.04);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.4rem;
    font-size: 0.85rem;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--color-bg, #fbf8f4);
    flex-shrink: 0;
  }
  .avatar-blank {
    border: 1px dashed var(--color-rule, #e8dfd9);
  }
  .author {
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .badge-admin {
    margin-left: 0.35rem;
    padding: 0.06em 0.45em;
    font-size: 0.7rem;
    background: var(--color-primary-bg, #fbf3f1);
    color: var(--color-primary, #a8352a);
    border-radius: 999px;
    font-weight: 600;
  }
  .time {
    margin-left: auto;
    color: var(--color-muted, #8a807a);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .target-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.1rem;
  }
  .target {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.2rem 0.5rem;
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 6px;
    font-size: 0.8rem;
    text-decoration: none;
    flex: 0 0 auto;
  }
  .target:hover { background: var(--color-secondary, #1e6e6e); color: #fff; }
  .target-plain {
    cursor: default;
    border-style: dashed;
    opacity: 0.7;
  }
  .target-plain:hover {
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
  }
  .target-anchor {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  .preview {
    color: var(--color-fg, #1f1c1a);
    line-height: 1.5;
    font-size: 0.9rem;
    word-break: keep-all;
    overflow-wrap: anywhere;
    flex: 1 1 auto;
    min-width: 0;
  }
  .photos {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: var(--color-muted, #8a807a);
  }

  .more-wrap {
    display: flex;
    justify-content: center;
    margin-top: 1rem;
  }
  .more {
    background: var(--color-bg, #fbf8f4);
    color: var(--color-fg, #1f1c1a);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font: inherit;
    cursor: pointer;
  }
  .more:hover {
    background: var(--color-primary-bg, #fbf3f1);
    color: var(--color-primary, #a8352a);
    border-color: var(--color-primary, #a8352a);
  }
</style>
