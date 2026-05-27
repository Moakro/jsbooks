<script lang="ts">
  /**
   * 홈 Sitemap 의 '소식' 섹션 — D1 (`/api/news`) 에서 최근 3건을 client-fetch.
   * 시간순 누적 컨텐츠이므로 스레드형: 단일 카드 안에 항목 리스트 stack
   * (Changelog.astro 패턴 동일). 빌드 시점에 D1 접근 불가하므로 island.
   */
  import { onMount } from "svelte";
  import { type NewsItem } from "../lib/news";
  import { relativeTime, absoluteTime } from "../lib/relative-time";

  let items = $state<NewsItem[]>([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      // /api/news 는 pinned DESC 우선. 홈 카드는 '최근글' 의미라 client 가 다시
      // published_at DESC 로 정렬한 뒤 3건. (게시판 /news/ 는 worker 정렬 그대로.)
      const res = await fetch("/api/news?limit=20", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { news: NewsItem[] };
      const all = data.news ?? [];
      items = [...all]
        .sort((a, b) => {
          const at = a.published_at ?? a.created_at ?? "";
          const bt = b.published_at ?? b.created_at ?? "";
          return at < bt ? 1 : at > bt ? -1 : 0;
        })
        .slice(0, 3);
    } catch { /* silent */ } finally {
      loading = false;
    }
  });

  function newsDate(iso: string | null | undefined): { label: string; abs: string } {
    if (!iso) return { label: "", abs: "" };
    const now = new Date();
    const t = new Date(iso);
    const days = (now.getTime() - t.getTime()) / 86_400_000;
    const abs = absoluteTime(iso);
    if (days <= 7) return { label: relativeTime(iso, now), abs };
    const yy = String(t.getFullYear() % 100).padStart(2, "0");
    const mm = String(t.getMonth() + 1).padStart(2, "0");
    const dd = String(t.getDate()).padStart(2, "0");
    return { label: `${yy}.${mm}.${dd}`, abs };
  }
</script>

{#if loading}
  <p class="state muted">불러오는 중…</p>
{:else if items.length === 0}
  <p class="state muted">아직 소식이 없습니다.</p>
{:else}
  <ol class="news-list">
    {#each items as item (item.id)}
      {@const iso = item.published_at ?? item.created_at}
      {@const d = newsDate(iso)}
      <li>
        <time class="date" datetime={iso ?? ""} title={d.abs}>{d.label}</time>
        <a class="title" href={`/news/${encodeURIComponent(item.slug)}/`}>{item.title}</a>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .state,
  .news-list {
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

  .news-list {
    list-style: none;
    margin: 0;
    padding: 0.6rem 1.2rem 0.5rem;
    display: flex;
    flex-direction: column;
  }
  .news-list li {
    display: grid;
    grid-template-columns: 6.5em 1fr;
    column-gap: 0.7rem;
    align-items: baseline;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    font-size: 0.92rem;
  }
  .news-list li:last-child {
    border-bottom: none;
  }
  .date {
    color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .title {
    color: var(--color-fg, #1f1c1a);
    text-decoration: none;
    line-height: 1.5;
    word-break: keep-all;
    overflow-wrap: anywhere;
    font-weight: 500;
  }
  .title:hover {
    color: var(--color-primary, #a8352a);
  }

  @media (max-width: 640px) {
    .news-list li {
      grid-template-columns: 1fr;
      row-gap: 0.15rem;
    }
    .date {
      font-size: 0.78rem;
    }
  }
  @media (max-width: 1023px) {
    .state,
    .news-list {
      box-shadow: 0 1px 2px rgba(60, 40, 25, 0.05);
    }
  }
  @media (prefers-color-scheme: dark) {
    .state,
    .news-list {
      background: linear-gradient(180deg, #2c2418 0%, var(--color-bg, #1f1c1a) 100%);
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.25),
        0 2px 8px rgba(0, 0, 0, 0.35);
    }
  }
</style>
