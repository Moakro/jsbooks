<script lang="ts">
  /**
   * /news/ · /news/category/:cat/ 목록 — comments-worker `/api/news` 에서 fetch.
   * vault 시절 markup 톤(카드·카테고리 알약·요약) 유지.
   */
  import { onMount } from "svelte";
  import { categoryLabel, fmtNewsDate, type NewsItem } from "../../lib/news";

  interface Props {
    /** 'notice'·'update'·'release'·'roadmap' — 미지정 시 전체. */
    category?: string;
  }
  const { category }: Props = $props();

  let items = $state<NewsItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let isAdmin = $state(false);

  onMount(async () => {
    try {
      const url = new URL("/api/news", window.location.origin);
      if (category) url.searchParams.set("category", category);
      url.searchParams.set("limit", "100");
      const [listRes, meRes] = await Promise.all([
        fetch(url.toString(), { credentials: "same-origin" }),
        fetch("/api/me", { credentials: "same-origin" }).catch(() => null),
      ]);
      if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
      const data = (await listRes.json()) as { news: NewsItem[] };
      items = data.news ?? [];
      if (meRes && meRes.ok) {
        const me = await meRes.json().catch(() => null);
        isAdmin = (me?.user?.level ?? 0) >= 4;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });
</script>

{#if isAdmin}
  <div class="admin-bar">
    <a class="btn-new" href="/admin/news/">+ 새 글</a>
  </div>
{/if}
{#if loading}
  <p class="status">불러오는 중…</p>
{:else if error}
  <p class="status error">목록을 불러오지 못했습니다: {error}</p>
{:else if items.length === 0}
  <p class="status empty">
    {category ? "이 카테고리에는 아직 소식이 없습니다." : "아직 소식이 없습니다."}
  </p>
{:else}
  <ul class="news-list">
    {#each items as item (item.id)}
      <li class="news-item">
        <a href={`/news/${encodeURIComponent(item.slug)}/`} class="news-link">
          <div class="news-meta">
            {#if !category}
              <span class="cat">{categoryLabel(item.category)}</span>
            {/if}
            <time datetime={item.published_at ?? item.created_at}>
              {fmtNewsDate(item.published_at ?? item.created_at)}
            </time>
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
  .admin-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.7rem;
  }
  .btn-new {
    display: inline-flex;
    align-items: center;
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 7%, transparent);
    color: var(--color-primary, #a8352a);
    text-decoration: none;
    font-size: 0.86rem;
    font-weight: 600;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .btn-new:hover {
    background: var(--color-primary, #a8352a);
    color: #fff;
  }
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
    gap: 0.6rem;
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    margin-bottom: 0.3rem;
  }
  .cat {
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 12%, transparent);
    color: var(--color-primary, #a8352a);
    font-weight: 600;
  }
  .news-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }
  .news-summary {
    margin: 0.3rem 0 0;
    font-size: 0.88rem;
    color: var(--color-muted, #8a807a);
  }
  .status {
    color: var(--color-muted, #8a807a);
    margin: 1rem 0;
  }
  .status.error {
    color: var(--color-primary, #a8352a);
  }
</style>
