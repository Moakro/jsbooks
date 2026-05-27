<script lang="ts">
  /**
   * /news/:slug/ 상세 — `/api/news/:slug` fetch 후 body_html(워커 렌더 캐시) 그대로 표시.
   * 운영자 로그인 시 상단에 [수정][삭제] 액션 노출.
   */
  import { onMount } from "svelte";
  import { categoryLabel, fmtNewsDate, type NewsItem } from "../../lib/news";

  interface Props {
    slug: string;
  }
  const { slug }: Props = $props();

  let item = $state<NewsItem | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state<string | null>(null);
  let isAdmin = $state(false);
  let deleting = $state(false);

  onMount(async () => {
    const [newsRes, meRes] = await Promise.all([
      fetch(`/api/news/${encodeURIComponent(slug)}`, { credentials: "same-origin" }),
      fetch("/api/me", { credentials: "same-origin" }).catch(() => null),
    ]);

    if (newsRes.status === 404) {
      notFound = true;
      loading = false;
      return;
    }
    if (!newsRes.ok) {
      error = `HTTP ${newsRes.status}`;
      loading = false;
      return;
    }
    try {
      const data = (await newsRes.json()) as { news: NewsItem };
      item = data.news;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      loading = false;
      return;
    }

    if (meRes && meRes.ok) {
      try {
        const me = await meRes.json();
        isAdmin = (me?.user?.level ?? 0) >= 4;
      } catch {
        isAdmin = false;
      }
    }
    loading = false;
  });

  async function handleDelete() {
    if (!item) return;
    if (!confirm(`"${item.title}" 글을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    deleting = true;
    try {
      const res = await fetch(`/api/news/${item.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.location.href = "/news/";
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
      deleting = false;
    }
  }
</script>

{#if loading}
  <p class="status">불러오는 중…</p>
{:else if notFound}
  <div class="not-found">
    <h1>찾을 수 없는 글입니다</h1>
    <p>요청하신 뉴스가 존재하지 않거나 발행되지 않았습니다.</p>
    <p><a href="/news/">← 뉴스 목록</a></p>
  </div>
{:else if error}
  <p class="status error">불러오지 못했습니다: {error}</p>
{:else if item}
  <article class="news-detail">
    {#if isAdmin}
      <div class="admin-actions" role="toolbar" aria-label="운영자 액션">
        <a class="btn" href={`/admin/news/?edit=${item.id}`}>수정</a>
        <button
          class="btn btn-danger"
          type="button"
          disabled={deleting}
          onclick={handleDelete}
        >
          {deleting ? "삭제 중…" : "삭제"}
        </button>
        {#if item.draft === 1}
          <span class="draft-badge">드래프트</span>
        {/if}
      </div>
    {/if}
    <div class="news-meta">
      <a class="cat" href={`/news/category/${item.category}/`}>{categoryLabel(item.category)}</a>
      <time datetime={item.published_at ?? item.created_at}>
        {fmtNewsDate(item.published_at ?? item.created_at)}
      </time>
    </div>
    <h1>{item.title}</h1>
    <div class="prose-body">
      {@html item.body_html}
    </div>
    <p class="back"><a href="/news/">← 뉴스 목록</a></p>
  </article>
{/if}

<style>
  .news-detail {
    max-width: 42rem;
  }
  .admin-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem 0.7rem;
    border: 1px dashed var(--color-rule, #e8dfd9);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-muted, #8a807a) 4%, transparent);
  }
  .btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    background: var(--color-surface, #fff);
    color: var(--color-fg, #1f1c1a);
    text-decoration: none;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .btn:hover {
    border-color: var(--color-primary, #a8352a);
    color: var(--color-primary, #a8352a);
  }
  .btn-danger {
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 40%, transparent);
    color: var(--color-primary, #a8352a);
  }
  .btn-danger:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
  }
  .btn-danger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .draft-badge {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, #c89a30 20%, transparent);
    color: #946a10;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .news-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
    margin-bottom: 0.4rem;
  }
  .cat {
    padding: 0.05rem 0.55rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 12%, transparent);
    color: var(--color-primary, #a8352a);
    font-weight: 600;
    text-decoration: none;
  }
  .news-detail h1 {
    margin: 0 0 1.2rem;
    font-size: 1.55rem;
  }
  .prose-body :global(p),
  .prose-body :global(li) {
    line-height: 1.85;
  }
  .prose-body :global(h2),
  .prose-body :global(h3) {
    margin-top: 1.6rem;
  }
  .prose-body :global(pre) {
    overflow-x: auto;
    padding: 0.8rem;
    background: color-mix(in srgb, var(--color-muted, #8a807a) 7%, transparent);
    border-radius: 6px;
  }
  .prose-body :global(blockquote) {
    margin: 1rem 0;
    padding: 0.4rem 0.9rem;
    border-left: 3px solid var(--color-rule, #e8dfd9);
    color: var(--color-muted, #8a807a);
  }
  .back {
    margin-top: 2.5rem;
    font-size: 0.9rem;
  }
  .status {
    color: var(--color-muted, #8a807a);
  }
  .status.error {
    color: var(--color-primary, #a8352a);
  }
  .not-found {
    text-align: center;
    padding: 3rem 0;
  }
</style>
