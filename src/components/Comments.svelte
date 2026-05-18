<script lang="ts">
  import { onMount, tick } from "svelte";
  import Icon from "./Icon.svelte";
  import FeedItem from "./feed/FeedItem.svelte";
  import PhotoGrid from "./feed/PhotoGrid.svelte";
  import CommentModal from "./feed/CommentModal.svelte";

  type CommentType = "memo" | "question" | "cross" | "cite";
  type CommentStatus = "published" | "deleted";
  type Attachment =
    | { type: "image"; url: string; width?: number; height?: number }
    | { type: "map"; lat: number; lng: number; zoom?: number; label?: string };
  type Comment = {
    id: string;
    parent_id: string | null;
    body: string;
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
  let highlightId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let listEl: HTMLOListElement | undefined = $state();

  // Modal state
  let modalOpen = $state(false);
  let modalMode = $state<"new" | "reply" | "edit">("new");
  let modalEditId = $state<string | null>(null);
  let modalParentId = $state<string | null>(null);
  let modalReplyName = $state<string | null>(null);
  let modalInitialBody = $state("");
  let modalInitialAtts = $state<Attachment[]>([]);
  let pendingScrollToLatest = $state(false);

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
    } catch (e) {
      error = e instanceof Error ? e.message : "불러오기 실패";
    } finally {
      loading = false;
      if (pendingScrollToLatest) {
        pendingScrollToLatest = false;
        await tick();
        scrollToLatest();
      }
    }
  }

  function login() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/login?next=${next}`;
  }

  function openNew() {
    if (!user) return login();
    if (user.needs_nickname) {
      window.location.href = "/account/nickname";
      return;
    }
    modalMode = "new";
    modalEditId = null;
    modalParentId = null;
    modalReplyName = null;
    modalInitialBody = "";
    modalInitialAtts = [];
    modalOpen = true;
  }

  function openReply(c: Comment) {
    if (!user) return login();
    if (c.status === "deleted") return;
    modalMode = "reply";
    modalEditId = null;
    modalParentId = c.id;
    modalReplyName = c.author.display_name;
    modalInitialBody = "";
    modalInitialAtts = [];
    modalOpen = true;
  }

  function openEdit(c: Comment) {
    if (!user || user.id !== c.author_id) return;
    if (c.reply_count > 0) return;
    if (c.status === "deleted") return;
    modalMode = "edit";
    modalEditId = c.id;
    modalParentId = null;
    modalReplyName = null;
    modalInitialBody = c.body ?? "";
    modalInitialAtts = c.attachments ?? [];
    modalOpen = true;
  }

  function closeModal() {
    modalOpen = false;
  }

  async function onModalSubmitted(_data: { id: string; mode: "new" | "reply" | "edit" }) {
    pendingScrollToLatest = _data.mode !== "edit";
    await load();
  }

  async function scrollToLatest() {
    const last = comments[comments.length - 1];
    if (!last) return;
    const el = document.getElementById(`comment-${last.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightId = last.id;
    setTimeout(() => {
      if (highlightId === last.id) highlightId = null;
    }, 1500);
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
          ? { ...x, you_helpful: data.on, helpful_count: x.helpful_count + (data.on ? 1 : -1) }
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

  async function togglePin(c: Comment) {
    if (!user || user.level < 4) return;
    const res = await fetch(`/api/comments/${c.id}/pin`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) await load();
  }

  function jumpToParent(c: Comment) {
    if (!c.parent_id) return;
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
    <span class="head-count">
      <Icon icon="message-square" size={14} strokeWidth={1.8} />
      댓글 {loading ? "…" : comments.length}
    </span>
    {#if comments.length >= 5}
      <button type="button" class="jump-latest" onclick={scrollToLatest} title="최근 댓글로 이동">
        최근 ↓
      </button>
    {/if}
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if !loading && comments.length === 0}
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
              {@html c.body_html}
            {/snippet}

            {#snippet photos()}
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
            {/snippet}

            {#snippet actions()}
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
                <button type="button" class="act" onclick={() => openReply(c)}>↩ 답글</button>
              {/if}
              {#if user && user.id === c.author_id && c.reply_count === 0}
                <button type="button" class="act" onclick={() => openEdit(c)}>수정</button>
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
            {/snippet}
          </FeedItem>
        </li>
      {/each}
    </ol>
  {/if}

  <div class="write-cta-wrap">
    {#if user === null}
      <button type="button" class="write-cta" onclick={login}>로그인하고 댓글 남기기</button>
    {:else if user.needs_nickname}
      <a class="write-cta" href="/account/nickname">먼저 닉네임을 설정하세요 →</a>
    {:else}
      <button type="button" class="write-cta" onclick={openNew}>
        <Icon icon="message-square" size={14} strokeWidth={1.8} />
        댓글 쓰기
      </button>
    {/if}
  </div>
</section>

<CommentModal
  open={modalOpen}
  mode={modalMode}
  {target}
  replyToName={modalReplyName}
  initialBody={modalInitialBody}
  initialAttachments={modalInitialAtts}
  editId={modalEditId}
  parentId={modalParentId}
  userName={user?.display_name ?? null}
  onSubmitted={onModalSubmitted}
  onClose={closeModal}
/>

<style>
  .comments {
    padding: 0 0 5rem 0; /* 하단 CTA 공간 확보 */
  }
  .header-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 0 0.6rem;
  }
  .head-count {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.88rem;
    color: var(--color-fg, #1f1c1a);
    font-weight: 600;
  }
  .jump-latest {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    cursor: pointer;
  }
  .jump-latest:hover {
    color: var(--color-primary, #a8352a);
    border-color: var(--color-primary, #a8352a);
  }

  .empty {
    color: var(--color-muted);
    font-size: 0.92rem;
    margin: 0.5rem 0;
  }
  .error {
    color: var(--color-primary);
    font-size: 0.9rem;
  }
  .list {
    list-style: none;
    margin: 0 0 1rem;
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
  .promoted-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    color: var(--color-secondary);
  }

  .map-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
  .att-map {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    font-size: 0.82rem;
    color: var(--color-secondary);
    text-decoration: none;
    background: var(--color-bg);
  }
  .att-map:hover {
    background: var(--color-secondary-bg);
  }

  .act {
    background: transparent;
    border: none;
    color: var(--color-muted);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .act:hover {
    color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .act.helpful.on,
  .act.pin-btn.on {
    color: var(--color-primary);
    font-weight: 600;
  }
  .act.del:hover {
    color: var(--color-primary);
    background: var(--color-primary-bg);
  }

  /* 하단 CTA — sticky bottom inside SideCard scroll container */
  .write-cta-wrap {
    position: sticky;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.6rem 0;
    background: linear-gradient(
      to top,
      var(--color-bg, #fbf8f4) 0%,
      var(--color-bg, #fbf8f4) 75%,
      transparent 100%
    );
    display: flex;
    justify-content: center;
    z-index: 5;
  }
  .write-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1.4rem;
    background: var(--color-primary, #a8352a);
    color: #fff;
    border: none;
    border-radius: 999px;
    font: inherit;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    text-decoration: none;
    box-shadow: 0 4px 12px rgba(168, 53, 42, 0.3);
  }
  .write-cta:hover {
    filter: brightness(0.95);
    box-shadow: 0 6px 16px rgba(168, 53, 42, 0.4);
  }
</style>
