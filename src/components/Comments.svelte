<script lang="ts">
  import { onMount, tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { uploadResizedImage } from "../lib/resize-image";
  import FeedItem from "./feed/FeedItem.svelte";
  import PhotoGrid from "./feed/PhotoGrid.svelte";

  type CommentType = "memo" | "question" | "cross" | "cite";
  type CommentStatus = "published" | "deleted";
  type Attachment =
    | { type: "image"; url: string; width?: number; height?: number }
    | { type: "map"; lat: number; lng: number; zoom?: number; label?: string };
  type Comment = {
    id: string;
    parent_id: string | null;
    body_html: string;
    type: CommentType;
    status: CommentStatus;
    is_pinned: boolean;
    reply_count: number;
    created_at: string;
    updated_at: string;
    attachments?: Attachment[];
    promoted_to_note_id?: string | null;
    author_id: string | null;
    author: {
      display_name: string;
      avatar_url: string | null;
      affiliation: string | null;
      level: number;
    };
    helpful_count: number;
    you_helpful: boolean;
  };

  const MAX_ATTACHMENTS = 6;

  type User = {
    id: string;
    display_name: string | null;
    avatar_url?: string | null;
    affiliation?: string | null;
    needs_nickname: boolean;
    level: number;
  } | null;

  let { target }: { target: string } = $props();

  let comments = $state<Comment[]>([]);
  let loading = $state(true);
  let user = $state<User>(null);
  let expanded = $state(false);
  let draft = $state("");
  let draftType = $state<CommentType>("memo");
  let draftAttachments = $state<Attachment[]>([]);
  let replyTo = $state<Comment | null>(null);
  let editingId = $state<string | null>(null);
  let editingDraft = $state("");
  let editingType = $state<CommentType>("memo");
  let highlightId = $state<string | null>(null);
  let uploading = $state(false);
  let fileInputEl: HTMLInputElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let listEl: HTMLOListElement | undefined = $state();
  let posting = $state(false);
  let error = $state<string | null>(null);

  const TYPE_LABEL: Record<CommentType, string> = {
    memo: "메모",
    question: "질문",
    cross: "교차참조",
    cite: "학술인용",
  };

  function commentById(id: string): Comment | undefined {
    return comments.find((c) => c.id === id);
  }

  async function load() {
    loading = true;
    try {
      const [meRes, listRes] = await Promise.all([
        fetch("/api/me", { credentials: "same-origin" }),
        fetch(`/api/comments?target=${encodeURIComponent(target)}`, { credentials: "same-origin" }),
      ]);
      user = (await meRes.json()).user;
      const data = await listRes.json();
      comments = data.comments ?? [];
    } catch (e: any) {
      error = e?.message ?? "불러오기 실패";
    } finally {
      loading = false;
    }
  }

  function login() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/login?next=${next}`;
  }

  async function toggleExpand() {
    if (expanded) {
      expanded = false;
      return;
    }
    expanded = true;
    await tick();
    listEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit() {
    if (!user) return login();
    const text = draft.trim();
    if (!text && draftAttachments.length === 0) return;
    posting = true;
    error = null;
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          parent_id: replyTo?.id ?? null,
          body: text,
          type: draftType,
          attachments: draftAttachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error ?? `등록 실패 (${res.status})`;
        return;
      }
      draft = "";
      draftAttachments = [];
      replyTo = null;
      await load();
    } finally {
      posting = false;
    }
  }

  async function onPickFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    error = null;
    uploading = true;
    try {
      for (const f of files) {
        if (draftAttachments.length >= MAX_ATTACHMENTS) {
          error = `첨부는 최대 ${MAX_ATTACHMENTS}장까지 가능합니다`;
          break;
        }
        try {
          const r = await uploadResizedImage(f);
          draftAttachments = [
            ...draftAttachments,
            { type: "image", url: r.url, width: r.width, height: r.height },
          ];
        } catch (err: any) {
          error = err?.message ?? "업로드 실패";
        }
      }
    } finally {
      uploading = false;
      if (input) input.value = "";
    }
  }

  function removeAttachment(idx: number) {
    draftAttachments = draftAttachments.filter((_, i) => i !== idx);
  }

  async function toggleHelpful(c: Comment) {
    if (!user) return login();
    if (c.status === "deleted") return;
    const res = await fetch(`/api/comments/${c.id}/react`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "helpful" }),
    });
    if (res.ok) {
      const data = await res.json();
      comments = comments.map((x) =>
        x.id === c.id
          ? {
              ...x,
              you_helpful: data.on,
              helpful_count: x.helpful_count + (data.on ? 1 : -1),
            }
          : x,
      );
    }
  }

  async function remove(c: Comment) {
    if (!user || user.id !== c.author_id) return;
    const msg = c.reply_count > 0
      ? "답글이 있어 댓글이 가려집니다 (placeholder로 남음). 진행할까요?"
      : "이 댓글을 삭제할까요? (되돌릴 수 없음)";
    if (!confirm(msg)) return;
    const res = await fetch(`/api/comments/${c.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) await load();
  }

  function startReply(c: Comment) {
    if (!user) return login();
    if (c.status === "deleted") return;
    replyTo = c;
    const mention = `@${c.author.display_name} `;
    if (!draft.startsWith(mention)) {
      draft = mention + draft.replace(/^@\S+\s*/, "");
    }
    queueMicrotask(() => textareaEl?.focus());
  }

  function cancelReply() {
    replyTo = null;
    draft = draft.replace(/^@\S+\s*/, "");
  }

  function startEdit(c: Comment) {
    if (!user || user.id !== c.author_id) return;
    if (c.reply_count > 0) return;
    if (c.status === "deleted") return;
    editingId = c.id;
    editingType = c.type;
    const tmp = document.createElement("div");
    tmp.innerHTML = c.body_html;
    editingDraft = (tmp.textContent ?? "").trim();
  }

  function cancelEdit() {
    editingId = null;
    editingDraft = "";
  }

  async function saveEdit(c: Comment) {
    const text = editingDraft.trim();
    if (!text) return;
    const res = await fetch(`/api/comments/${c.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text, type: editingType }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error = data?.error ?? `수정 실패 (${res.status})`;
      return;
    }
    editingId = null;
    editingDraft = "";
    await load();
  }

  async function togglePin(c: Comment) {
    if (!user || user.level < 4) return;
    const res = await fetch(`/api/comments/${c.id}/pin`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) await load();
  }

  async function jumpToParent(c: Comment) {
    if (!c.parent_id) return;
    const parent = commentById(c.parent_id);
    if (!parent) return;
    const el = document.getElementById(`comment-${c.parent_id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightId = c.parent_id;
    setTimeout(() => {
      if (highlightId === c.parent_id) highlightId = null;
    }, 1500);
  }

  function parentMentionLabel(c: Comment): string | null {
    if (!c.parent_id) return null;
    const p = commentById(c.parent_id);
    if (!p) return null;
    if (p.status === "deleted") return "(삭제된 댓글에 답글)";
    return `@${p.author.display_name}`;
  }

  function imageAtts(c: Comment) {
    return (c.attachments ?? []).filter(
      (a): a is Extract<Attachment, { type: "image" }> => a.type === "image",
    );
  }
  function mapAtts(c: Comment) {
    return (c.attachments ?? []).filter(
      (a): a is Extract<Attachment, { type: "map" }> => a.type === "map",
    );
  }

  function toUser(c: Comment) {
    return {
      id: c.author_id ?? undefined,
      nickname: c.author.display_name,
      avatar_url: c.author.avatar_url,
      affiliation: c.author.affiliation,
      level: c.author.level,
    };
  }

  onMount(load);
</script>

<section class="comments">
  <div class="header-bar">
    <button
      type="button"
      class="toggle"
      onclick={toggleExpand}
      aria-expanded={expanded}
      disabled={loading}
    >
      <Icon icon="message-square" size={14} strokeWidth={1.8} />
      {#if !loading && comments.length === 0}
        첫 댓글을 남겨주세요
      {:else}
        댓글 {loading ? "…" : comments.length}{expanded ? " 접기" : "개 보기"}
      {/if}
    </button>
  </div>

  {#if expanded}
    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if comments.length === 0}
      <p class="empty">아직 댓글이 없습니다. 첫 댓글을 남겨주세요.</p>
    {:else}
      <ol class="list" bind:this={listEl}>
        {#each comments as c (c.id)}
          {@const isReply = !!c.parent_id}
          <li class="comment-wrap" class:is-reply={isReply}>
            {#if isReply}
              <span class="reply-rail" aria-hidden="true"></span>
            {/if}
            <FeedItem
              id={`comment-${c.id}`}
              user={toUser(c)}
              createdAt={c.created_at}
              updatedAt={c.updated_at}
              isPinned={c.is_pinned}
              isDeleted={c.status === "deleted"}
              highlighted={highlightId === c.id}
              promoted={!!c.promoted_to_note_id}
              variant={c.type}
            >
              {#snippet meta()}
                <div class="meta-line">
                  <span class="ctype c-{c.type}">{TYPE_LABEL[c.type]}</span>
                  {#if parentMentionLabel(c)}
                    <button
                      type="button"
                      class="parent-link"
                      onclick={() => jumpToParent(c)}
                      title="원 댓글로 이동"
                    >
                      <Icon icon="corner-down-right" size={13} strokeWidth={1.8} />
                      {parentMentionLabel(c)}에게 답글
                    </button>
                  {/if}
                  {#if c.promoted_to_note_id}
                    <a
                      class="promoted-badge"
                      href={`#fn-${c.promoted_to_note_id}`}
                      title="이 댓글이 자료 주석으로 반영되었습니다"
                    >
                      <span class="promoted-icon" aria-hidden="true">
                        <Icon icon="pencil" size={12} strokeWidth={1.8} />
                      </span>
                      자료에 반영됨
                      <span class="promoted-id">{c.promoted_to_note_id}</span>
                    </a>
                  {/if}
                </div>
              {/snippet}

              {#snippet body()}
                {#if editingId === c.id}
                  <div class="edit-area">
                    <select bind:value={editingType}>
                      <option value="memo">메모</option>
                      <option value="question">질문</option>
                      <option value="cross">교차참조</option>
                      <option value="cite">학술인용</option>
                    </select>
                    <textarea bind:value={editingDraft} rows="3" maxlength="4000"></textarea>
                    <div class="edit-actions">
                      <button
                        type="button"
                        class="cta"
                        onclick={() => saveEdit(c)}
                        disabled={!editingDraft.trim()}
                      >저장</button>
                      <button type="button" class="ghost" onclick={cancelEdit}>취소</button>
                    </div>
                  </div>
                {:else}
                  {@html c.body_html}
                {/if}
              {/snippet}

              {#snippet photos()}
                {#if editingId !== c.id}
                  {@const imgs = imageAtts(c)}
                  {@const maps = mapAtts(c)}
                  {#if imgs.length > 0}
                    <PhotoGrid photos={imgs.map((i) => ({ url: i.url, width: i.width, height: i.height }))} />
                  {/if}
                  {#if maps.length > 0}
                    <div class="map-list">
                      {#each maps as att (`${att.lat},${att.lng}`)}
                        <a
                          class="att-map"
                          href={`https://map.kakao.com/link/map/${encodeURIComponent(att.label ?? "위치")},${att.lat},${att.lng}`}
                          target="_blank"
                          rel="noopener"
                          title="카카오맵에서 열기"
                        >
                          <Icon icon="map-pin" size={14} strokeWidth={1.8} />
                          {att.label ?? `${att.lat.toFixed(4)}, ${att.lng.toFixed(4)}`}
                        </a>
                      {/each}
                    </div>
                  {/if}
                {/if}
              {/snippet}

              {#snippet actions()}
                {#if editingId !== c.id}
                  <button
                    type="button"
                    class="act helpful"
                    class:on={c.you_helpful}
                    onclick={() => toggleHelpful(c)}
                    title={user ? "도움됨 표시 토글" : "로그인 필요"}
                  >
                    👍 도움됨 {c.helpful_count > 0 ? c.helpful_count : ""}
                  </button>
                  {#if user}
                    <button type="button" class="act" onclick={() => startReply(c)}>↩ 답글</button>
                  {/if}
                  {#if user && user.id === c.author_id && c.reply_count === 0}
                    <button type="button" class="act" onclick={() => startEdit(c)}>수정</button>
                  {/if}
                  {#if user && user.id === c.author_id}
                    <button class="act del" type="button" onclick={() => remove(c)}>삭제</button>
                  {/if}
                  {#if user && user.level >= 4}
                    <button
                      type="button"
                      class="act pin-btn"
                      class:on={c.is_pinned}
                      onclick={() => togglePin(c)}
                      title="운영자 고정 토글"
                    >
                      <Icon icon="pin" size={13} strokeWidth={1.8} />
                      {c.is_pinned ? "해제" : "고정"}
                    </button>
                  {/if}
                {/if}
              {/snippet}
            </FeedItem>
          </li>
        {/each}
      </ol>
    {/if}

    <form class="composer" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      {#if user === null}
        <p class="login-cta">
          <button type="button" class="cta" onclick={login}>로그인하고 댓글 남기기</button>
        </p>
      {:else if user.needs_nickname}
        <p class="login-cta">
          <a class="cta" href="/account/nickname">먼저 닉네임을 설정하세요 →</a>
        </p>
      {:else}
        {#if replyTo}
          <div class="reply-bar">
            <span>@{replyTo.author.display_name}에게 답글</span>
            <button type="button" class="ghost" onclick={cancelReply}>취소</button>
          </div>
        {/if}
        <div class="row type-row">
          <label class="type-pick">
            <select bind:value={draftType}>
              <option value="memo">메모</option>
              <option value="question">질문</option>
              <option value="cross">교차참조</option>
              <option value="cite">학술인용</option>
            </select>
          </label>
          <span class="asuser">{user.display_name}</span>
        </div>
        <textarea
          bind:this={textareaEl}
          bind:value={draft}
          placeholder="이 절·카드에 대한 댓글을 남기세요. (마크다운 일부 지원)"
          rows="3"
          maxlength="4000"
          disabled={posting}
        ></textarea>
        {#if draftAttachments.length > 0}
          <div class="draft-atts">
            {#each draftAttachments as att, i (att.type === "image" ? att.url : `${att.lat},${att.lng}-${i}`)}
              {#if att.type === "image"}
                <div class="draft-att">
                  <img src={att.url} alt="" />
                  <button
                    type="button"
                    class="att-remove"
                    onclick={() => removeAttachment(i)}
                    aria-label="이 첨부 제거"
                  >×</button>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
        <div class="row submit-row">
          <input
            type="file"
            accept="image/*"
            multiple
            bind:this={fileInputEl}
            onchange={onPickFiles}
            style="display: none"
          />
          <button
            type="button"
            class="att-btn"
            onclick={() => fileInputEl?.click()}
            disabled={uploading || posting || draftAttachments.length >= MAX_ATTACHMENTS}
            title={`사진 첨부 (최대 ${MAX_ATTACHMENTS}장, 자동 1600px 리사이즈)`}
          >
            {#if uploading}
              업로드 중…
            {:else}
              <Icon icon="paperclip" size={14} strokeWidth={1.8} />
              사진 ({draftAttachments.length}/{MAX_ATTACHMENTS})
            {/if}
          </button>
          <span class="counter">{draft.length} / 4000</span>
          <button
            class="cta"
            type="submit"
            disabled={posting || uploading || (!draft.trim() && draftAttachments.length === 0)}
          >
            {posting ? "등록 중…" : "등록"}
          </button>
        </div>
      {/if}
    </form>
  {/if}
</section>

<style>
  .comments {
    margin-top: 3rem;
    padding-top: 1.2rem;
    border-top: 1px solid var(--color-rule);
  }
  .header-bar {
    display: flex;
    align-items: center;
    margin-bottom: 0.8rem;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
    font: inherit;
    font-size: 0.92rem;
    color: var(--color-primary);
    cursor: pointer;
  }
  .toggle:hover:not(:disabled) {
    background: var(--color-primary-bg);
  }
  .toggle:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .empty {
    color: var(--color-muted);
    font-size: 0.92rem;
  }
  .error {
    color: var(--color-primary);
    font-size: 0.9rem;
  }
  .list {
    list-style: none;
    margin: 0 0 1.2rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .comment-wrap {
    position: relative;
  }
  .comment-wrap.is-reply {
    margin-left: 1.6rem;
    padding-left: 0.9rem;
  }
  .reply-rail {
    position: absolute;
    left: 0;
    top: 0.2rem;
    bottom: 0.2rem;
    width: 2px;
    border-radius: 2px;
    background: var(--color-rule);
  }
  .comment-wrap.is-reply:hover .reply-rail {
    background: var(--color-secondary);
  }

  .meta-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.82rem;
  }
  .ctype {
    font-weight: 500;
  }
  .ctype.c-memo { color: var(--color-muted); }
  .ctype.c-question { color: var(--color-secondary); }
  .ctype.c-cross { color: var(--color-secondary-soft); }
  .ctype.c-cite { color: var(--color-primary); }

  .parent-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: transparent;
    border: none;
    color: var(--color-secondary);
    font: inherit;
    font-size: 0.82rem;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .parent-link:hover {
    text-decoration: underline;
  }
  .promoted-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--color-secondary);
    color: var(--color-secondary);
    background: var(--color-bg);
    border-radius: 999px;
    font-size: 0.76rem;
    text-decoration: none;
    line-height: 1.3;
  }
  .promoted-badge:hover {
    background: var(--color-secondary-bg);
  }
  .promoted-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    color: var(--color-muted);
  }

  .edit-area {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0.1rem 0;
  }
  .edit-area select {
    align-self: flex-start;
    font: inherit;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    padding: 0.2rem 0.5rem;
    background: var(--color-bg);
    color: var(--color-fg);
  }
  .edit-area textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    padding: 0.5rem;
    font: inherit;
    font-size: 0.95rem;
    background: var(--color-bg);
    color: var(--color-fg);
    resize: vertical;
    min-height: 4em;
  }
  .edit-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .map-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }
  .att-map {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--color-secondary);
    color: var(--color-secondary);
    background: var(--color-secondary-bg);
    border-radius: 999px;
    text-decoration: none;
    font-size: 0.85rem;
  }
  .att-map:hover {
    background: var(--color-secondary);
    color: var(--color-bg);
  }

  .act, .ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--feed-action-color, var(--color-muted));
    padding: 0.18rem 0.45rem;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }
  .act:hover, .ghost:hover {
    color: var(--feed-action-hover, var(--color-secondary));
    background: var(--color-secondary-bg);
  }
  .act.on, .pin-btn.on {
    background: var(--color-secondary-bg);
    border-color: var(--feed-action-hover, var(--color-secondary));
    color: var(--feed-action-hover, var(--color-secondary));
  }
  .act.del:hover {
    color: var(--feed-action-danger, var(--color-primary));
    background: var(--color-primary-bg);
  }

  .reply-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.6rem;
    margin-bottom: 0.4rem;
    background: var(--color-secondary-bg);
    border: 1px solid var(--color-secondary);
    border-radius: 5px;
    font-size: 0.85rem;
    color: var(--color-secondary);
  }
  .composer {
    border: 1px solid var(--color-rule);
    border-radius: var(--feed-card-radius, 8px);
    padding: 0.8rem;
    background: var(--color-primary-bg);
  }
  .composer textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    padding: 0.6rem;
    font: inherit;
    font-size: 0.95rem;
    background: var(--color-bg);
    color: var(--color-fg);
    resize: vertical;
    min-height: 4em;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 0;
  }
  .type-row {
    justify-content: space-between;
  }
  .submit-row {
    justify-content: flex-end;
  }
  .type-pick select {
    font: inherit;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    padding: 0.25rem 0.5rem;
    background: var(--color-bg);
    color: var(--color-fg);
  }
  .asuser {
    font-size: 0.85rem;
    color: var(--color-muted);
  }
  .counter {
    color: var(--color-muted);
    font-size: 0.78rem;
    margin-right: auto;
  }
  .cta {
    border: none;
    background: var(--color-primary);
    color: var(--color-bg);
    border-radius: 5px;
    padding: 0.4rem 0.9rem;
    font: inherit;
    font-size: 0.92rem;
    cursor: pointer;
    text-decoration: none;
  }
  .cta:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cta:hover:not(:disabled) {
    background: var(--color-primary-soft);
  }
  .login-cta {
    margin: 0;
    text-align: center;
  }

  .draft-atts {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .draft-att {
    position: relative;
    width: 96px;
    height: 96px;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    overflow: hidden;
    background: var(--color-bg);
  }
  .draft-att img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .att-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font: inherit;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }
  .att-remove:hover {
    background: rgba(0, 0, 0, 0.85);
  }
  .att-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.85rem;
    color: var(--color-secondary);
    cursor: pointer;
    margin-right: auto;
  }
  .att-btn:hover:not(:disabled) {
    background: var(--color-secondary-bg);
    border-color: var(--color-secondary);
  }
  .att-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
