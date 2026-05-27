<script lang="ts">
  /**
   * /news/ 목록 — comments-worker `/api/news` 에서 fetch. 카테고리 분류 없음.
   * (운영자 '+ 새 글' 버튼은 NewsAdminBar 가 별도 처리.)
   */
  import { onMount } from "svelte";
  import { fmtNewsDate, type NewsItem } from "../../lib/news";

  let items = $state<NewsItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const res = await fetch("/api/news?limit=100", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { news: NewsItem[] };
      items = data.news ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });
</script>

{#if loading}
  <p class="status">불러오는 중…</p>
{:else if error}
  <p class="status error">목록을 불러오지 못했습니다: {error}</p>
{:else if items.length === 0}
  <p class="status empty">아직 소식이 없습니다.</p>
{:else}
  <ul class="news-list">
    {#each items as item (item.id)}
      <li class="news-item">
        <a href={`/news/${encodeURIComponent(item.slug)}/`} class="news-link">
          <div class="news-meta">
            <time datetime={item.published_at ?? item.created_at}>
              {fmtNewsDate(item.published_at ?? item.created_at)}
            </time>
            {#if item.pinned === 1}
              <span class="pinned-badge" title="상단 고정">📌</span>
            {/if}
          </div>
          <h2 class="news-title">{item.title}</h2>
          {#if item.summary}
            <p class="news-summary">{item.summary}</p>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .news-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .news-link {
    display: block;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    background: var(--color-surface, #fff);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .news-link:hover {
    border-color: var(--color-primary, #a8352a);
    transform: translateY(-1px);
  }
  .news-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    margin-bottom: 0.3rem;
  }
  .pinned-badge {
    font-size: 0.85rem;
    line-height: 1;
  }
  .news-title {
    margin: 0;
    color: var(--color-primary, #a8352a);
    font-size: 1.05rem;
    line-height: 1.4;
  }
  .news-summary {
    margin: 0.35rem 0 0;
    color: var(--color-muted, #8a807a);
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .status {
    color: var(--color-muted, #8a807a);
    margin: 0.5rem 0;
  }
  .status.error {
    color: var(--color-primary, #a8352a);
  }
</style>
