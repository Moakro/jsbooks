<script lang="ts">
  /**
   * /admin/news/ 본체 — 좌측 목록 + 우측 에디터(미리보기 토글).
   * AdminGate 안에서 마운트되므로 권한 체크는 페이지/워커 양쪽이 보장.
   */
  import { onMount } from "svelte";
  import {
    categoryLabel,
    fmtNewsDate,
    NEWS_CATEGORIES,
    type NewsCategory,
    type NewsItem,
  } from "../../lib/news";
  import { renderNewsMarkdown } from "../../lib/news-renderer";

  type Mode = "new" | "edit";

  let items = $state<NewsItem[]>([]);
  let loading = $state(true);
  let listError = $state<string | null>(null);
  let filterDraft = $state<"all" | "published" | "draft">("all");

  let mode = $state<Mode>("new");
  let editingId = $state<string | null>(null);

  // form state
  let title = $state("");
  let category = $state<NewsCategory>("notice");
  let slug = $state("");
  let summary = $state("");
  let bodyMd = $state("");
  let draftFlag = $state(false);

  let saving = $state(false);
  let deleting = $state(false);
  let saveError = $state<string | null>(null);
  let lastSavedSlug = $state<string | null>(null);
  let showPreview = $state(false);

  const previewHtml = $derived(showPreview ? renderNewsMarkdown(bodyMd) : "");
  const filtered = $derived(
    filterDraft === "all"
      ? items
      : filterDraft === "draft"
        ? items.filter((n) => n.draft === 1)
        : items.filter((n) => n.draft === 0),
  );

  onMount(async () => {
    await loadList();
    // URL 의 ?edit=<id> 처리.
    const url = new URL(window.location.href);
    const editId = url.searchParams.get("edit");
    if (editId) {
      const target = items.find((n) => n.id === editId);
      if (target) openEdit(target);
    }
  });

  async function loadList() {
    loading = true;
    listError = null;
    try {
      const res = await fetch("/api/news?include_drafts=1&limit=200", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { news: NewsItem[] };
      items = data.news ?? [];
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    mode = "new";
    editingId = null;
    title = "";
    category = "notice";
    slug = "";
    summary = "";
    bodyMd = "";
    draftFlag = false;
    saveError = null;
    lastSavedSlug = null;
  }

  function openEdit(item: NewsItem) {
    mode = "edit";
    editingId = item.id;
    title = item.title;
    category = item.category;
    slug = item.slug;
    summary = item.summary ?? "";
    bodyMd = item.body_md;
    draftFlag = item.draft === 1;
    saveError = null;
    lastSavedSlug = item.slug;
  }

  async function save() {
    saveError = null;
    if (!title.trim()) { saveError = "제목을 입력하세요."; return; }
    if (!bodyMd.trim()) { saveError = "본문을 입력하세요."; return; }
    saving = true;
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        category,
        body_md: bodyMd,
        summary: summary.trim() || null,
        draft: draftFlag ? 1 : 0,
      };
      if (slug.trim()) payload.slug = slug.trim();

      const isNew = mode === "new";
      const url = isNew ? "/api/news" : `/api/news/${editingId}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { news: NewsItem };
      lastSavedSlug = data.news.slug;
      slug = data.news.slug;
      mode = "edit";
      editingId = data.news.id;
      await loadList();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (mode !== "edit" || !editingId) return;
    if (!confirm(`"${title}" 글을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    deleting = true;
    saveError = null;
    try {
      const res = await fetch(`/api/news/${editingId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      resetForm();
      await loadList();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      deleting = false;
    }
  }
</script>

<div class="news-admin">
  <aside class="list-pane">
    <div class="list-header">
      <button class="btn btn-primary" type="button" onclick={resetForm}>+ 새 글</button>
      <div class="filter">
        <label>
          <input type="radio" bind:group={filterDraft} value="all" /> 전체
        </label>
        <label>
          <input type="radio" bind:group={filterDraft} value="published" /> 발행
        </label>
        <label>
          <input type="radio" bind:group={filterDraft} value="draft" /> 드래프트
        </label>
      </div>
    </div>
    {#if loading}
      <p class="status">불러오는 중…</p>
    {:else if listError}
      <p class="status error">{listError}</p>
    {:else if filtered.length === 0}
      <p class="status empty">표시할 글이 없습니다.</p>
    {:else}
      <ul class="list">
        {#each filtered as item (item.id)}
          <li class:active={item.id === editingId}>
            <button type="button" class="row" onclick={() => openEdit(item)}>
              <div class="row-top">
                <span class="cat">{categoryLabel(item.category)}</span>
                {#if item.draft === 1}
                  <span class="draft">드래프트</span>
                {/if}
                <time>{fmtNewsDate(item.published_at ?? item.updated_at)}</time>
              </div>
              <div class="row-title">{item.title}</div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="editor-pane">
    <div class="editor-header">
      <h2>{mode === "new" ? "새 글 작성" : "글 수정"}</h2>
      <div class="editor-actions">
        <label class="preview-toggle">
          <input type="checkbox" bind:checked={showPreview} /> 미리보기
        </label>
        {#if mode === "edit" && lastSavedSlug}
          <a class="btn" href={`/news/${encodeURIComponent(lastSavedSlug)}/`} target="_blank" rel="noopener">사이트 열기 ↗</a>
        {/if}
        {#if mode === "edit"}
          <button class="btn btn-danger" type="button" disabled={deleting} onclick={remove}>
            {deleting ? "삭제 중…" : "삭제"}
          </button>
        {/if}
        <button class="btn btn-primary" type="button" disabled={saving} onclick={save}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>

    {#if saveError}
      <p class="status error">{saveError}</p>
    {/if}

    <div class="editor-grid" class:with-preview={showPreview}>
      <div class="form">
        <label class="field">
          <span class="label">제목 *</span>
          <input type="text" bind:value={title} placeholder="공지 제목" maxlength="200" />
        </label>
        <div class="field-row">
          <label class="field">
            <span class="label">카테고리 *</span>
            <select bind:value={category}>
              {#each NEWS_CATEGORIES as cat (cat)}
                <option value={cat}>{categoryLabel(cat)}</option>
              {/each}
            </select>
          </label>
          <label class="field">
            <span class="label">slug</span>
            <input type="text" bind:value={slug} placeholder="자동 생성 (제목 기반)" maxlength="120" />
          </label>
        </div>
        <label class="field">
          <span class="label">요약</span>
          <input type="text" bind:value={summary} placeholder="목록 카드에 표시될 한 줄 요약" maxlength="500" />
        </label>
        <label class="field">
          <span class="label">본문 (마크다운) *</span>
          <textarea bind:value={bodyMd} rows="20" placeholder="# 제목

본문 단락을 빈 줄로 구분합니다.

- 리스트 항목
- **굵게**, *기울임*, [링크](https://example.com)"></textarea>
        </label>
        <label class="field draft">
          <input type="checkbox" bind:checked={draftFlag} />
          <span>드래프트(발행 안 함)</span>
        </label>
      </div>
      {#if showPreview}
        <div class="preview prose-body">
          {@html previewHtml}
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .news-admin {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 1.2rem;
    min-height: 70vh;
  }
  @media (max-width: 880px) {
    .news-admin {
      grid-template-columns: 1fr;
    }
  }
  .list-pane {
    border-right: 1px solid var(--color-rule, #e8dfd9);
    padding-right: 1rem;
  }
  .list-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.8rem;
  }
  .filter {
    display: flex;
    gap: 0.6rem;
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
  }
  .filter label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .list li.active .row {
    border-color: var(--color-primary, #a8352a);
    background: color-mix(in srgb, var(--color-primary, #a8352a) 6%, transparent);
  }
  .row {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 8px;
    background: var(--color-surface, #fff);
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .row:hover {
    border-color: var(--color-primary, #a8352a);
  }
  .row-top {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: var(--color-muted, #8a807a);
    margin-bottom: 0.2rem;
  }
  .cat {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 12%, transparent);
    color: var(--color-primary, #a8352a);
    font-weight: 600;
  }
  .draft {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, #c89a30 18%, transparent);
    color: #946a10;
    font-weight: 600;
  }
  .row-title {
    font-weight: 600;
    line-height: 1.35;
  }
  .editor-pane {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .editor-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .editor-header h2 {
    margin: 0;
    font-size: 1.15rem;
  }
  .editor-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .preview-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--color-muted, #8a807a);
  }
  .btn {
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    background: var(--color-surface, #fff);
    color: var(--color-fg, #1f1c1a);
    text-decoration: none;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .btn:hover {
    border-color: var(--color-primary, #a8352a);
    color: var(--color-primary, #a8352a);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    border-color: var(--color-primary, #a8352a);
    color: var(--color-primary, #a8352a);
    background: color-mix(in srgb, var(--color-primary, #a8352a) 7%, transparent);
  }
  .btn-danger {
    color: var(--color-primary, #a8352a);
  }
  .btn-danger:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
  }
  .editor-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .editor-grid.with-preview {
    grid-template-columns: 1fr 1fr;
  }
  @media (max-width: 1100px) {
    .editor-grid.with-preview {
      grid-template-columns: 1fr;
    }
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .field .label {
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
  }
  .field input[type="text"],
  .field select,
  .field textarea {
    padding: 0.45rem 0.65rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    background: var(--color-surface, #fff);
    color: var(--color-fg, #1f1c1a);
    font: inherit;
  }
  .field textarea {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.92rem;
    line-height: 1.55;
    resize: vertical;
  }
  .field-row {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 0.7rem;
  }
  .field.draft {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .preview {
    padding: 1rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 8px;
    background: var(--color-surface, #fff);
    overflow-y: auto;
    max-height: 80vh;
  }
  .preview :global(p),
  .preview :global(li) {
    line-height: 1.7;
  }
  .preview :global(pre) {
    padding: 0.7rem;
    background: color-mix(in srgb, var(--color-muted, #8a807a) 7%, transparent);
    border-radius: 6px;
    overflow-x: auto;
  }
  .status {
    color: var(--color-muted, #8a807a);
    margin: 0.5rem 0;
  }
  .status.error {
    color: var(--color-primary, #a8352a);
  }
</style>
