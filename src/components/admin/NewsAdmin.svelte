<script lang="ts">
  /**
   * /admin/news/ — 폼 단일 (작성·수정·삭제). 좌측 글 목록 패널 제거.
   *
   * 진입 경로:
   *  - 기본 진입: 새 글 작성 모드
   *  - ?edit=<id>: 그 글의 수정 모드 (목록·본문 페이지의 '수정' 버튼이 보내는 깊은 링크)
   *
   * 제거 사항 (사용자 요청):
   *  - 좌측 목록·필터 패널 — 사이트 진입점(/news/, /news/[slug]/) 의 '+ 새 글' 버튼으로 유입
   *  - slug 입력 — 제목 기반 자동 (worker `slugifyNews`)
   *  - 요약 입력 — 본문 첫 단락에서 자동 추출 (`extractSummary`)
   *  - 미리보기 토글 — 화면만 차지, 사이트 실제 렌더와 다를 위험
   */
  import { onMount } from "svelte";
  import {
    categoryLabel,
    extractSummary,
    NEWS_CATEGORIES,
    type NewsCategory,
    type NewsItem,
  } from "../../lib/news";

  type Mode = "new" | "edit";

  let mode = $state<Mode>("new");
  let editingId = $state<string | null>(null);

  // form state
  let title = $state("");
  let category = $state<NewsCategory>("notice");
  let bodyMd = $state("");
  let draftFlag = $state(false);

  let loading = $state(false);
  let saving = $state(false);
  let deleting = $state(false);
  let saveError = $state<string | null>(null);
  let lastSavedSlug = $state<string | null>(null);

  onMount(async () => {
    const url = new URL(window.location.href);
    const editId = url.searchParams.get("edit");
    if (editId) await loadForEdit(editId);
  });

  async function loadForEdit(id: string) {
    loading = true;
    try {
      // id 로 직접 조회 가능한 단건 엔드포인트가 없으니 목록에서 찾는다 (include_drafts).
      const res = await fetch("/api/news?include_drafts=1&limit=500", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { news: NewsItem[] };
      const target = (data.news ?? []).find((n) => n.id === id);
      if (!target) {
        saveError = "수정할 글을 찾지 못했습니다.";
        return;
      }
      mode = "edit";
      editingId = target.id;
      title = target.title;
      category = target.category;
      bodyMd = target.body_md;
      draftFlag = target.draft === 1;
      lastSavedSlug = target.slug;
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save() {
    saveError = null;
    if (!title.trim()) { saveError = "제목을 입력하세요."; return; }
    if (!bodyMd.trim()) { saveError = "본문을 입력하세요."; return; }
    saving = true;
    try {
      // summary 자동 추출 — 비어 있어도 worker 가 받아주지만, 목록 카드에 노출되므로 채워서 보낸다.
      const payload: Record<string, unknown> = {
        title: title.trim(),
        category,
        body_md: bodyMd,
        summary: extractSummary(bodyMd) || null,
        draft: draftFlag ? 1 : 0,
      };
      // slug 는 worker 가 제목 기반 자동 생성 (slugifyNews + ensureUniqueSlug).
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
      mode = "edit";
      editingId = data.news.id;
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
      // 삭제 후엔 목록(/news/)으로 이동.
      window.location.href = "/news/";
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      deleting = false;
    }
  }
</script>

<section class="news-admin">
  <header class="hdr">
    <h2>{mode === "new" ? "새 글 작성" : "글 수정"}</h2>
    <div class="hdr-actions">
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
  </header>

  {#if loading}
    <p class="status">불러오는 중…</p>
  {/if}
  {#if saveError}
    <p class="status error">{saveError}</p>
  {/if}

  <form class="form" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label class="field">
      <span class="label">제목 *</span>
      <input type="text" bind:value={title} placeholder="공지 제목" maxlength="200" />
    </label>
    <label class="field">
      <span class="label">카테고리 *</span>
      <select bind:value={category}>
        {#each NEWS_CATEGORIES as cat (cat)}
          <option value={cat}>{categoryLabel(cat)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span class="label">본문 (마크다운) *</span>
      <textarea bind:value={bodyMd} rows="22" placeholder="# 제목

본문 단락을 빈 줄로 구분합니다.

- 리스트 항목
- **굵게**, *기울임*, [링크](https://example.com)"></textarea>
    </label>
    <label class="field draft">
      <input type="checkbox" bind:checked={draftFlag} />
      <span>드래프트로 저장(발행 안 함)</span>
    </label>
  </form>
</section>

<style>
  .news-admin {
    max-width: 820px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .hdr h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .hdr-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .btn {
    padding: 0.35rem 0.85rem;
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
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary {
    border-color: var(--color-primary, #a8352a);
    color: var(--color-primary, #a8352a);
    background: color-mix(in srgb, var(--color-primary, #a8352a) 7%, transparent);
  }
  .btn-danger { color: var(--color-primary, #a8352a); }
  .btn-danger:hover { background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent); }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field .label {
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
  }
  .field input[type="text"],
  .field select,
  .field textarea {
    padding: 0.5rem 0.7rem;
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
  .field.draft {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .status {
    color: var(--color-muted, #8a807a);
    margin: 0;
  }
  .status.error {
    color: var(--color-primary, #a8352a);
  }
</style>
