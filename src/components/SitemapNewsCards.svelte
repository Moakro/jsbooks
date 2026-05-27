<script lang="ts">
  /**
   * 홈 Sitemap 의 '소식' 섹션 카드 3개 — D1 (`/api/news`) 에서 client-fetch.
   * 빌드 시점에 D1 접근 불가하므로 island 로 분리. 발행된 글만, 고정·최근 우선.
   */
  import { onMount } from "svelte";
  import { type NewsItem } from "../lib/news";

  let items = $state<NewsItem[]>([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      // /api/news 는 pinned DESC 우선 정렬 — 홈 카드는 '최근글' 의미라 client 가 다시
      // published_at DESC 로 정렬한 뒤 3건. (게시판 /news/ 리스트는 worker 정렬 그대로 사용.)
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
</script>

<!--
  부모 .sm-grid 가 Astro scoped 라 island 자식에는 grid 가 적용 안 된다.
  자체적으로 같은 grid 를 들고 가서 다른 섹션(자료·뉴스 카드) 과 동일한 톤·반응형 유지.
-->
<div class="sm-news-grid">
  {#if loading}
    <a class="sm-card placeholder" href="/news/"><span class="sm-card-label">불러오는 중…</span></a>
  {:else if items.length === 0}
    <a class="sm-card placeholder" href="/news/"><span class="sm-card-label">아직 소식이 없습니다</span></a>
  {:else}
    {#each items as item (item.id)}
      <a class="sm-card" href={`/news/${encodeURIComponent(item.slug)}/`}>
        <span class="sm-card-label">{item.title}</span>
      </a>
    {/each}
  {/if}
</div>

<style>
  /* Sitemap.astro 의 .sm-grid 와 동일 — 데스크톱 3열, 폭 좁아지면 자동 wrap. */
  .sm-news-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.7rem;
  }
  /* Sitemap.astro 의 .sm-card 와 동일 (값 동기 유지). */
  .sm-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    background: linear-gradient(180deg, #ffffff 0%, var(--color-bg, #fbf8f4) 100%);
    color: var(--color-fg, #1f1c1a);
    text-decoration: none;
    box-shadow:
      0 1px 2px rgba(60, 40, 25, 0.04),
      0 2px 8px rgba(60, 40, 25, 0.06);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
  }
  .sm-card:hover {
    transform: translateY(-2px);
    border-color: var(--color-primary, #a8352a);
    box-shadow:
      0 2px 4px rgba(168, 53, 42, 0.08),
      0 8px 20px rgba(60, 40, 25, 0.1);
  }
  .sm-card.placeholder {
    background: var(--color-surface-2, #f6efe9);
    color: var(--color-muted, #8a807a);
    box-shadow: 0 1px 2px rgba(60, 40, 25, 0.03);
  }
  .sm-card.placeholder:hover {
    transform: translateY(-1px);
    color: var(--color-fg, #1f1c1a);
  }
  @media (max-width: 1023px) {
    .sm-card {
      box-shadow: 0 1px 2px rgba(60, 40, 25, 0.05);
    }
    .sm-card:hover {
      box-shadow: 0 2px 8px rgba(60, 40, 25, 0.08);
    }
  }
  @media (prefers-color-scheme: dark) {
    .sm-card {
      background: linear-gradient(180deg, #2c2418 0%, var(--color-bg, #1f1c1a) 100%);
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.25),
        0 2px 8px rgba(0, 0, 0, 0.35);
    }
    .sm-card:hover {
      box-shadow:
        0 2px 4px rgba(168, 53, 42, 0.25),
        0 8px 20px rgba(0, 0, 0, 0.4);
    }
  }
  .sm-card-label {
    font-weight: 600;
    font-size: 0.95rem;
    line-height: 1.3;
  }
  .sm-card.placeholder .sm-card-label {
    font-weight: 500;
  }
</style>
