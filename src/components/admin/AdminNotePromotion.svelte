<script lang="ts">
  import { onMount } from "svelte";

  type Comment = {
    id: string;
    target_type: string;
    target_id: string;
    body: string;
    type: string;
    status: string;
    promoted_to_note_id: string | null;
    created_at: string;
    user_id: string;
    display_name: string | null;
    helpful_count: number;
  };

  type TargetSuggest = {
    file: string;       // vault-상대 prefix (확장자 X)
    anchor: string | null;
    headingHint: string | null;
  };

  let comments = $state<Comment[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let typeFilter = $state<string>("");
  let working = $state<string | null>(null); // 진행 중인 comment id

  // 모달 상태
  let editing = $state<Comment | null>(null);
  let editFile = $state("");
  let editAnchor = $state("");
  let editHeading = $state("");
  let editBody = $state("");
  let editFootnoteId = $state("");

  const TYPE_LABEL: Record<string, string> = {
    memo: "메모",
    question: "질문",
    cross: "교차참조",
    cite: "학술인용",
  };

  function fmtDate(s: string): string {
    return s.replace("T", " ").slice(0, 16);
  }

  function fmtDateDot(s: string): string {
    // "YYYY-MM-DD ..." → "YYYY.MM.DD"
    const d = s.slice(0, 10).replace(/-/g, ".");
    return d;
  }

  function todayId(seq: number): string {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, "0");
    const d = String(today.getUTCDate()).padStart(2, "0");
    return `uc-${y}-${m}-${d}-${seq}`;
  }

  // 같은 날짜에 이미 승격된 가장 큰 seq + 1 추정 (로컬 리스트 기반).
  // 정확도가 필요하면 target 파일 read도 옵션. MVP는 단순 시퀀스.
  function nextFootnoteSeq(): number {
    const today = new Date();
    const prefix = `uc-${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}-`;
    let max = 0;
    for (const c of comments) {
      const id = c.promoted_to_note_id;
      if (!id || !id.startsWith(prefix)) continue;
      const n = parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max + 1;
  }

  function suggestTarget(c: Comment): TargetSuggest {
    // target 형식:
    //   target_type='card', target_id='kind:slug'  → kind/slug
    //   target_type='verse', target_id='X-Y-Z'    → scripture chapter (heuristic)
    //   target_type='chapter', target_id='vol:chap' → scripture chapter (천지개벽경)
    if (c.target_type === "card") {
      const [kind, ...rest] = c.target_id.split(":");
      const slug = rest.join(":");
      return { file: `${kind}/${slug}`, anchor: null, headingHint: null };
    }
    if (c.target_type === "verse") {
      // X-Y-Z 또는 preface-N
      const anchor = c.target_id;
      // 천지개벽경 chapter md 파일 경로는 추정 불가하므로 운영자가 수정.
      return { file: "scripture/cheonjigaebyeokgyeong/", anchor, headingHint: null };
    }
    if (c.target_type === "chapter") {
      // vol:chap
      return { file: "scripture/cheonjigaebyeokgyeong/", anchor: null, headingHint: null };
    }
    return { file: "", anchor: null, headingHint: null };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const url = new URL("/api/admin/comments", window.location.origin);
      url.searchParams.set("unpromoted", "1");
      if (typeFilter) url.searchParams.set("type", typeFilter);
      url.searchParams.set("limit", "200");
      const res = await fetch(url.toString(), { credentials: "same-origin" });
      if (res.status === 401 || res.status === 403) {
        error = "권한이 필요합니다.";
        return;
      }
      if (!res.ok) {
        error = `요청 실패 (${res.status})`;
        return;
      }
      const data = await res.json();
      comments = data.comments ?? [];
    } catch (e: any) {
      error = e?.message ?? "네트워크 오류";
    } finally {
      loading = false;
    }
  }

  function startEdit(c: Comment) {
    const sug = suggestTarget(c);
    editing = c;
    editFile = sug.file;
    editAnchor = sug.anchor ?? "";
    editHeading = "";
    editBody = c.body.replace(/\s+/g, " ").trim();
    editFootnoteId = todayId(nextFootnoteSeq());
  }

  function cancelEdit() {
    editing = null;
  }

  async function confirmPromote() {
    if (!editing) return;
    if (!editFile.trim()) {
      alert("target file 경로가 비어 있습니다");
      return;
    }
    working = editing.id;
    error = null;
    try {
      // 1) vault md 파일에 footnote 삽입 (dev-only)
      const mdRes = await fetch("/api/admin/notes/promote-md", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetFile: editFile.trim(),
          anchor: editAnchor.trim() || null,
          headingSlug: editHeading.trim() || null,
          footnoteId: editFootnoteId,
          body: editBody,
          author: editing.display_name ?? "익명",
          authorDate: fmtDateDot(editing.created_at),
          commentId: editing.id,
        }),
      });
      if (!mdRes.ok) {
        const j = await mdRes.json().catch(() => ({}));
        error = `마크다운 쓰기 실패: ${j.error ?? mdRes.status}`;
        return;
      }
      // 2) D1: promoted_to_note_id 채움
      const dbRes = await fetch(`/api/admin/comments/${editing.id}/promote`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: editFootnoteId }),
      });
      if (!dbRes.ok) {
        const j = await dbRes.json().catch(() => ({}));
        error = `DB 갱신 실패 (md는 이미 쓰임): ${j.error ?? dbRes.status}`;
        return;
      }
      // 성공 — 로컬 리스트에서 제거
      comments = comments.filter((x) => x.id !== editing!.id);
      editing = null;
    } catch (e: any) {
      error = e?.message ?? "네트워크 오류";
    } finally {
      working = null;
    }
  }

  onMount(load);
</script>

<section class="filters">
  <label>
    유형
    <select bind:value={typeFilter} onchange={load}>
      <option value="">전체</option>
      <option value="memo">메모</option>
      <option value="question">질문</option>
      <option value="cross">교차참조</option>
      <option value="cite">학술인용</option>
    </select>
  </label>
  <button type="button" class="btn-secondary" onclick={load} disabled={loading}>
    새로고침
  </button>
</section>

{#if loading}
  <p class="hint">불러오는 중…</p>
{:else if error}
  <p class="hint err">{error}</p>
{:else if comments.length === 0}
  <p class="hint">승격 대상 댓글이 없습니다.</p>
{:else}
  <ol class="comments">
    {#each comments as c (c.id)}
      <li class="comment">
        <header>
          <span class="type">{TYPE_LABEL[c.type] ?? c.type}</span>
          <span class="target">{c.target_type}:{c.target_id}</span>
          <span class="who">{c.display_name ?? "익명"}</span>
          <time>{fmtDate(c.created_at)}</time>
          {#if c.helpful_count > 0}
            <span class="helpful">도움됨 {c.helpful_count}</span>
          {/if}
        </header>
        <p class="body">{c.body}</p>
        <footer>
          <button
            type="button"
            class="btn"
            disabled={working === c.id}
            onclick={() => startEdit(c)}
          >
            주석으로 승격
          </button>
        </footer>
      </li>
    {/each}
  </ol>
{/if}

{#if editing}
  <div class="modal-bg" onclick={cancelEdit} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <h2>댓글을 자료 주석으로 승격</h2>
      <p class="meta">
        대상 vault 파일 경로(content/&lt;…&gt;.md 의 prefix)와 inline 삽입 위치를
        지정합니다. 두 위치 옵션 중 하나만 지정해도 됩니다. 둘 다 비우면 본문 마지막 문단에 추가.
      </p>

      <label class="row">
        <span>target 파일 (확장자 없이)</span>
        <input
          type="text"
          bind:value={editFile}
          placeholder="people/객망리 · scripture/cheonjigaebyeokgyeong/01_신축편/01-01_장"
        />
      </label>

      <div class="row-split">
        <label class="row">
          <span>sentence anchor (옵션)</span>
          <input
            type="text"
            bind:value={editAnchor}
            placeholder="1-1-3"
          />
        </label>
        <label class="row">
          <span>heading 단서 (옵션)</span>
          <input
            type="text"
            bind:value={editHeading}
            placeholder="명호"
          />
        </label>
      </div>

      <label class="row">
        <span>footnote id</span>
        <input type="text" bind:value={editFootnoteId} pattern="uc-\d{'{'}4{'}'}-\d{'{'}2{'}'}-\d{'{'}2{'}'}-\d+" />
      </label>

      <label class="row">
        <span>주석 본문 (마크다운 1줄)</span>
        <textarea bind:value={editBody} rows="3"></textarea>
      </label>

      <div class="preview">
        <div class="preview-label">미리보기</div>
        <code>{`[^${editFootnoteId}]`}</code>
        <span class="preview-arrow">→</span>
        <code class="preview-def">
          {`[^${editFootnoteId}]: ${editBody.trim()} — 사용자 ${editing.display_name ?? "익명"} (${fmtDateDot(editing.created_at)}) [원댓글](/feed/comments/?id=${editing.id})`}
        </code>
      </div>

      <div class="actions">
        <button type="button" class="btn-secondary" onclick={cancelEdit}>취소</button>
        <button
          type="button"
          class="btn"
          disabled={working === editing.id}
          onclick={confirmPromote}
        >
          {working === editing.id ? "처리 중…" : "확정 — 파일에 쓰기"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .filters {
    display: flex;
    gap: 0.7rem;
    align-items: center;
    margin: 0 0 1rem;
  }
  .filters label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.88rem;
  }
  select, input, textarea {
    font: inherit;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    padding: 0.3rem 0.5rem;
    background: var(--color-bg);
    color: var(--color-fg);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .hint { color: var(--color-muted); }
  .hint.err { color: var(--color-primary); }
  .comments {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .comment {
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    padding: 0.7rem 0.9rem;
    background: var(--color-surface);
  }
  .comment header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    font-size: 0.8rem;
    color: var(--color-muted);
    margin-bottom: 0.4rem;
  }
  .comment .type {
    color: var(--color-secondary);
    font-weight: 600;
  }
  .comment .target {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    background: var(--color-surface-2);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .comment .who { font-weight: 600; color: var(--color-fg); }
  .comment .helpful {
    color: var(--color-secondary);
    border: 1px solid var(--color-secondary);
    border-radius: 999px;
    padding: 0 6px;
  }
  .comment .body {
    margin: 0 0 0.5rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .comment footer {
    display: flex;
    justify-content: flex-end;
  }
  .btn {
    border: none;
    background: var(--color-primary);
    color: var(--color-bg);
    border-radius: 5px;
    padding: 0.4rem 0.9rem;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--color-primary-soft); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    border: 1px solid var(--color-rule);
    background: var(--color-bg);
    color: var(--color-fg);
    border-radius: 5px;
    padding: 0.35rem 0.8rem;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .btn-secondary:hover:not(:disabled) { background: var(--color-surface-2); }

  .modal-bg {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 8px;
    padding: 1.2rem;
    max-width: 720px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
  }
  .modal h2 { margin: 0 0 0.4rem; font-size: 1.1rem; }
  .modal .meta { color: var(--color-muted); font-size: 0.85rem; margin: 0 0 0.8rem; }
  .row { display: flex; flex-direction: column; gap: 0.25rem; margin: 0.5rem 0; }
  .row > span { font-size: 0.82rem; color: var(--color-muted); }
  .row-split { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .preview {
    margin: 1rem 0 0.4rem;
    padding: 0.6rem 0.8rem;
    border: 1px dashed var(--color-rule);
    border-radius: 5px;
    background: var(--color-surface-2);
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.84rem;
  }
  .preview-label {
    font-size: 0.75rem;
    color: var(--color-muted);
    width: 100%;
  }
  .preview code {
    background: var(--color-bg);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.82rem;
  }
  .preview-def { display: block; width: 100%; word-break: break-all; }
  .preview-arrow { color: var(--color-muted); }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
