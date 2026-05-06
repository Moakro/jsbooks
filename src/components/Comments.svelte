<script lang="ts">
  import { onMount } from "svelte";
  import { uploadResizedImage } from "../lib/resize-image";

  type CommentType = "memo" | "question" | "cross" | "cite";
  type Attachment =
    | { type: "image"; url: string; width?: number; height?: number }
    | { type: "map"; lat: number; lng: number; zoom?: number; label?: string };
  type Comment = {
    id: string;
    parent_id: string | null;
    body_html: string;
    type: CommentType;
    created_at: string;
    updated_at: string;
    attachments?: Attachment[];
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
    needs_nickname: boolean;
    level: number;
  } | null;

  let { target }: { target: string } = $props();

  let comments = $state<Comment[]>([]);
  let loading = $state(true);
  let user = $state<User>(null);
  let draft = $state("");
  let draftType = $state<CommentType>("memo");
  let draftAttachments = $state<Attachment[]>([]);
  let uploading = $state(false);
  let fileInputEl: HTMLInputElement | undefined = $state();
  let posting = $state(false);
  let error = $state<string | null>(null);

  const TYPE_LABEL: Record<CommentType, string> = {
    memo: "메모",
    question: "질문",
    cross: "교차참조",
    cite: "학술인용",
  };

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
    const res = await fetch(`/api/comments/${c.id}/react`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "helpful" }),
    });
    if (res.ok) {
      const data = await res.json();
      // optimistic local update
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
    if (!user || c.author.display_name !== user.display_name) return;
    if (!confirm("이 댓글을 삭제할까요?")) return;
    const res = await fetch(`/api/comments/${c.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) await load();
  }

  function shortDate(iso: string): string {
    return iso.replace("T", " ").slice(0, 16);
  }

  onMount(load);
</script>

<section class="comments">
  <h2>주해 ({comments.length})</h2>

  {#if loading}
    <p class="muted">불러오는 중…</p>
  {:else}
    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if comments.length === 0}
      <p class="muted">아직 주해가 없습니다. 첫 메모를 남겨보세요.</p>
    {:else}
      <ol class="list">
        {#each comments as c (c.id)}
          <li class="comment c-{c.type}">
            <header>
              <span class="who">
                {#if c.author.avatar_url}
                  <img class="avatar" src={c.author.avatar_url} alt="" />
                {/if}
                <span class="name">{c.author.display_name}</span>
                {#if c.author.affiliation}
                  <span class="affil">{c.author.affiliation}</span>
                {/if}
                {#if c.author.level >= 3}
                  <span class="badge curator">큐레이터</span>
                {:else if c.author.level === 2}
                  <span class="badge verified">검증</span>
                {/if}
              </span>
              <span class="meta">
                <span class="ctype">{TYPE_LABEL[c.type]}</span>
                <time>{shortDate(c.created_at)}</time>
              </span>
            </header>
            <div class="body">{@html c.body_html}</div>
            {#if c.attachments && c.attachments.length > 0}
              <div class="attachments">
                {#each c.attachments as att (att.type === "image" ? att.url : `${att.lat},${att.lng}`)}
                  {#if att.type === "image"}
                    <a class="att-img" href={att.url} target="_blank" rel="noopener">
                      <img src={att.url} alt="" loading="lazy" />
                    </a>
                  {:else if att.type === "map"}
                    <a
                      class="att-map"
                      href={`https://map.kakao.com/link/map/${encodeURIComponent(att.label ?? "위치")},${att.lat},${att.lng}`}
                      target="_blank"
                      rel="noopener"
                      title="카카오맵에서 열기"
                    >
                      📍 {att.label ?? `${att.lat.toFixed(4)}, ${att.lng.toFixed(4)}`}
                    </a>
                  {/if}
                {/each}
              </div>
            {/if}
            <footer>
              <button
                type="button"
                class="helpful"
                class:on={c.you_helpful}
                onclick={() => toggleHelpful(c)}
                title={user ? "도움됨 표시 토글" : "로그인 필요"}
              >
                도움됨 {c.helpful_count > 0 ? c.helpful_count : ""}
              </button>
              {#if user && user.display_name === c.author.display_name}
                <button class="del" type="button" onclick={() => remove(c)}>삭제</button>
              {/if}
            </footer>
          </li>
        {/each}
      </ol>
    {/if}

    <form class="composer" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      {#if user === null}
        <p class="login-cta">
          <button type="button" class="cta" onclick={login}>로그인하고 주해 남기기</button>
        </p>
      {:else if user.needs_nickname}
        <p class="login-cta">
          <a class="cta" href="/account/nickname">먼저 닉네임을 설정하세요 →</a>
        </p>
      {:else}
        <div class="row type-row">
          <label class="type-pick">
            <select bind:value={draftType}>
              <option value="memo">메모</option>
              <option value="question">질문</option>
              <option value="cross">교차참조</option>
              <option value="cite">학술인용</option>
            </select>
          </label>
          <span class="muted asuser">{user.display_name}</span>
        </div>
        <textarea
          bind:value={draft}
          placeholder="이 절·카드에 대한 주해를 남기세요. (마크다운 일부 지원)"
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
            title={`사진 첨부 (최대 ${MAX_ATTACHMENTS}장, 자동 800px 리사이즈)`}
          >
            {uploading ? "업로드 중…" : `📷 사진 (${draftAttachments.length}/${MAX_ATTACHMENTS})`}
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
  .comments h2 {
    font-size: 1.1rem;
    color: var(--color-primary);
    margin: 0 0 1rem;
  }
  .muted {
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
    gap: 0.7rem;
  }
  .comment {
    border: 1px solid var(--color-rule);
    border-radius: 7px;
    padding: 0.7rem 0.85rem;
    background: var(--color-bg);
  }
  .c-question {
    border-left: 3px solid var(--color-secondary);
  }
  .c-cross {
    border-left: 3px solid var(--color-secondary-soft);
  }
  .c-cite {
    border-left: 3px solid var(--color-primary);
  }
  .c-memo {
    border-left: 3px solid var(--color-rule);
  }
  .comment header {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: var(--color-muted);
    margin-bottom: 0.4rem;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
  }
  .name {
    font-weight: 600;
    color: var(--color-fg);
  }
  .affil {
    font-size: 0.78rem;
    color: var(--color-secondary);
    border: 1px solid var(--color-secondary);
    border-radius: 999px;
    padding: 0 6px;
  }
  .badge {
    font-size: 0.72rem;
    border-radius: 999px;
    padding: 1px 6px;
  }
  .badge.curator {
    color: var(--color-bg);
    background: var(--color-primary);
  }
  .badge.verified {
    color: var(--color-secondary);
    border: 1px solid var(--color-secondary);
  }
  .meta {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .ctype {
    color: var(--color-secondary);
    font-weight: 500;
  }
  .body {
    line-height: 1.6;
    color: var(--color-fg);
  }
  .body :global(p) {
    margin: 0.3rem 0;
  }
  .comment footer {
    margin-top: 0.5rem;
    display: flex;
    gap: 0.5rem;
  }
  .helpful, .del {
    background: transparent;
    border: 1px solid var(--color-rule);
    color: var(--color-muted);
    padding: 0.2rem 0.55rem;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 0.82rem;
  }
  .helpful:hover {
    border-color: var(--color-secondary);
    color: var(--color-secondary);
  }
  .helpful.on {
    background: var(--color-secondary-bg);
    border-color: var(--color-secondary);
    color: var(--color-secondary);
  }
  .del:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .composer {
    border: 1px solid var(--color-rule);
    border-radius: 8px;
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

  /* ── attachments ── */
  .attachments {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .att-img {
    display: inline-block;
    line-height: 0;
    border-radius: 5px;
    overflow: hidden;
    border: 1px solid var(--color-rule);
  }
  .att-img img {
    max-width: 100%;
    max-height: 320px;
    display: block;
  }
  .att-map {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--color-secondary);
    color: var(--color-secondary);
    background: var(--color-secondary-bg);
    border-radius: 5px;
    text-decoration: none;
    font-size: 0.88rem;
  }
  .att-map:hover {
    background: var(--color-secondary);
    color: var(--color-bg);
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
