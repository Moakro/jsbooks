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
