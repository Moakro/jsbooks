<script lang="ts">
  /**
   * 홈 Sitemap 의 '피드' 섹션 — 사이트 전체 최근 댓글 5건을 client-fetch (D1).
   * 시간순 누적 컨텐츠이므로 스레드형: 단일 카드 안에 항목 리스트 stack
   * (Changelog.astro 패턴 동일).
   */
  import { onMount } from "svelte";
  import { relativeTime } from "../lib/relative-time";
  import { isUserVisibleScripture } from "../lib/scripture-visibility";

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
    limit?: number;
  }

  let { limit = 5 }: Props = $props();

  let items = $state<FeedItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let versesIndex = $state<Record<string, VerseData>>({});

  onMount(async () => {
    try {
      const [feedRes, versesRes] = await Promise.all([
        fetch(`/api/comments/recent?limit=${limit}`, { credentials: "same-origin" }),
        fetch("/verses.json", { credentials: "same-origin" }),
      ]);
      if (versesRes.ok) {
        versesIndex = (await versesRes.json()) as Record<string, VerseData>;
      }
      if (!feedRes.ok) throw new Error(`HTTP ${feedRes.status}`);
      const data = (await feedRes.json()) as { items: FeedItem[] };
      // 클라이언트 측 admin-only 슬러그 방어 (API 가 1차 필터, 여기는 fallback).
      items = (data.items ?? []).filter(
        (it) => !it.scripture || isUserVisibleScripture(it.scripture),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  function verseContext(item: FeedItem): { name: string; href: string } | null {
    if (!item.scripture || !item.anchor) return null;
    const v = versesIndex[`${item.scripture}#${item.anchor}`];
    if (v) return { name: v.scriptureName, href: v.pageHref };
    return { name: item.scripture, href: `/library/${item.scripture}/#${item.anchor}` };
  }

  function truncate(s: string, max = 60): string {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
</script>

{#if loading}
  <p class="state muted">불러오는 중…</p>
{:else if error}
  <p class="state error">불러올 수 없습니다.</p>
{:else if items.length === 0}
  <p class="state muted">아직 댓글이 없습니다.</p>
{:else}
  <ol class="recent-list">
    {#each items as item (item.id)}
      {@const ctx = verseContext(item)}
      <li>
        <div class="head">
          {#if item.author.avatar_url}
            <img class="avatar" src={item.author.avatar_url} alt="" loading="lazy" />
          {:else}
            <span class="avatar avatar-blank" aria-hidden="true"></span>
          {/if}
          <span class="author">{item.author.display_name || "익명"}</span>
          {#if ctx}
            <a class="target" href={ctx.href}>
              <span class="target-name">{ctx.name}</span>
              {#if item.anchor}<span class="target-anchor">^{item.anchor}</span>{/if}
            </a>
          {/if}
          <time class="time" datetime={item.created_at}>{relativeTime(item.created_at)}</time>
        </div>
        {#if item.preview}
          <p class="preview">{truncate(item.preview)}</p>
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<style>
  .state,
  .recent-list {
    grid-column: 1 / -1;
    background: linear-gradient(180deg, #ffffff 0%, var(--color-bg, #fbf8f4) 100%);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    box-shadow:
      0 1px 2px rgba(60, 40, 25, 0.04),
      0 2px 8px rgba(60, 40, 25, 0.06);
  }
  .state {
    margin: 0;
    padding: 0.9rem 1rem;
    font-size: 0.9rem;
    text-align: center;
  }
  .muted { color: var(--color-muted, #8a807a); }
  .error { color: var(--color-primary, #a8352a); }

  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0.4rem 1.1rem 0.3rem;
    display: flex;
    flex-direction: column;
  }
  .recent-list li {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
  }
  .recent-list li:last-child {
    border-bottom: none;
  }

  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    font-size: 0.85rem;
  }
  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--color-bg, #fbf8f4);
    flex-shrink: 0;
  }
  .avatar-blank {
    border: 1px dashed var(--color-rule, #e8dfd9);
  }
  .author {
    font-weight: 600;
    color: var(--color-fg, #1f1c1a);
  }
  .target {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.1rem 0.45rem;
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 6px;
    font-size: 0.78rem;
    text-decoration: none;
  }
  .target:hover {
    background: var(--color-secondary, #1e6e6e);
    color: #fff;
  }
  .target-anchor {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .time {
    margin-left: auto;
    color: var(--color-muted, #8a807a);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .preview {
    margin: 0.3rem 0 0;
    padding-left: calc(22px + 0.45rem);
    color: var(--color-fg, #1f1c1a);
    font-size: 0.85rem;
    line-height: 1.45;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  @media (max-width: 640px) {
    .preview {
      padding-left: 0;
    }
  }
  @media (max-width: 1023px) {
    .state,
    .recent-list {
      box-shadow: 0 1px 2px rgba(60, 40, 25, 0.05);
    }
  }
  @media (prefers-color-scheme: dark) {
    .state,
    .recent-list {
      background: linear-gradient(180deg, #2c2418 0%, var(--color-bg, #1f1c1a) 100%);
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.25),
        0 2px 8px rgba(0, 0, 0, 0.35);
    }
  }
</style>
