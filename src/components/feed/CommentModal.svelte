<script lang="ts">
  import { tick } from "svelte";
  import Icon from "../Icon.svelte";
  import { uploadResizedImage } from "../../lib/resize-image";

  type Attachment =
    | { type: "image"; url: string; width?: number; height?: number }
    | { type: "map"; lat: number; lng: number; zoom?: number; label?: string };

  type Mode = "new" | "reply" | "edit";

  interface Props {
    open: boolean;
    mode: Mode;
    target: string;
    replyToName?: string | null;
    /** Edit 모드 prefill body (원본 plain text — \n 포함). 비어있을 때만 fallbackHtml 사용. */
    initialBody?: string;
    /** Edit 모드 prefill fallback — body_html을 <br>→\n 변환해서 사용 (워커 구버전 호환). */
    initialFallbackHtml?: string;
    initialAttachments?: Attachment[];
    editId?: string | null;
    parentId?: string | null;
    userName?: string | null;
    onSubmitted?: (data: { id: string; mode: Mode }) => void;
    onClose?: () => void;
  }

  let {
    open,
    mode,
    target,
    replyToName = null,
    initialBody = "",
    initialFallbackHtml = "",
    initialAttachments = [],
    editId = null,
    parentId = null,
    userName = null,
    onSubmitted,
    onClose,
  }: Props = $props();

  const MAX_ATTACHMENTS = 6;
  const MAX_LEN = 4000;

  let draft = $state("");
  let attachments = $state<Attachment[]>([]);
  let posting = $state(false);
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();

  // body_html → plain text 변환 (<br>·</p>→\n, 나머지 태그 제거). edit 모드 fallback.
  function htmlToPlainText(html: string): string {
    if (!html) return "";
    if (typeof DOMParser === "undefined") return html;
    const normalized = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n");
    const doc = new DOMParser().parseFromString(normalized, "text/html");
    return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  }

  // open 변화 또는 mode 변화 감지 — initial 값 재설정 + focus.
  let lastOpenKey = $state<string>("");
  $effect(() => {
    if (!open) return;
    const key = `${mode}:${editId ?? ""}:${parentId ?? ""}:${target}`;
    if (key === lastOpenKey) return;
    lastOpenKey = key;
    if (mode === "edit") {
      draft = initialBody || htmlToPlainText(initialFallbackHtml);
    } else if (mode === "reply" && replyToName) {
      draft = `@${replyToName} `;
    } else {
      draft = "";
    }
    attachments = [...(initialAttachments ?? [])];
    error = null;
    tick().then(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      // 답글: @멘션 뒤 커서. 수정: 본문 끝.
      const len = textareaEl.value.length;
      textareaEl.setSelectionRange(len, len);
    });
  });

  $effect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !posting) {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    onClose?.();
  }

  function login() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/login?next=${next}`;
  }

  async function onPickFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    error = null;
    uploading = true;
    try {
      for (const f of files) {
        if (attachments.length >= MAX_ATTACHMENTS) {
          error = `첨부는 최대 ${MAX_ATTACHMENTS}장까지 가능합니다`;
          break;
        }
        try {
          const r = await uploadResizedImage(f);
          attachments = [...attachments, { type: "image", url: r.url, width: r.width, height: r.height }];
        } catch (err) {
          error = err instanceof Error ? err.message : "업로드 실패";
        }
      }
    } finally {
      uploading = false;
      if (input) input.value = "";
    }
  }

  function removeAttachment(i: number) {
    attachments = attachments.filter((_, idx) => idx !== i);
  }

  async function submit() {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    posting = true;
    error = null;
    try {
      let res: Response;
      if (mode === "edit" && editId) {
        res = await fetch(`/api/comments/${editId}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text, attachments }),
        });
      } else {
        res = await fetch("/api/comments", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            parent_id: parentId ?? null,
            body: text,
            type: "memo",
            attachments,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        error = data.error ?? `등록 실패 (${res.status})`;
        return;
      }
      onSubmitted?.({ id: data.id ?? editId ?? "", mode });
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : "네트워크 오류";
    } finally {
      posting = false;
    }
  }

  const headerLabel = $derived(
    mode === "edit" ? "댓글 수정" : mode === "reply" ? `↳ @${replyToName ?? ""}에게 답글` : "댓글 쓰기",
  );

  // SideCard(aside.overflow:hidden) 안에 mount 되면 모달이 갇히므로 document.body 로 portal.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

{#if open}
  <div class="cm-portal" use:portal>
    <div class="cm-backdrop" onclick={close} role="presentation"></div>
    <div class="cm-modal" role="dialog" aria-modal="true" aria-label={headerLabel}>
      <header class="cm-head">
        <span class="cm-title">{headerLabel}</span>
        {#if userName}
          <span class="cm-asuser">· <strong>{userName}</strong></span>
        {/if}
        <button type="button" class="cm-close" onclick={close} aria-label="닫기" disabled={posting}>✕</button>
      </header>

      <!-- 액션바: textarea 위 — 키보드 올라와도 항상 보임 -->
      <div class="cm-actions">
        <input
          bind:this={fileInputEl}
          type="file"
          accept="image/*"
          multiple
          onchange={onPickFiles}
          style="display: none"
        />
        <button
          type="button"
          class="cm-att-btn"
          onclick={() => fileInputEl?.click()}
          disabled={uploading || posting || attachments.length >= MAX_ATTACHMENTS}
          title={`사진 첨부 (최대 ${MAX_ATTACHMENTS}장)`}
        >
          {#if uploading}…{:else}<Icon icon="paperclip" size={14} strokeWidth={1.8} /> {attachments.length}/{MAX_ATTACHMENTS}{/if}
        </button>
        <span class="cm-count">{draft.length}/{MAX_LEN}</span>
        <span class="cm-spacer"></span>
        <button type="button" class="cm-cancel" onclick={close} disabled={posting}>취소</button>
        <button
          type="button"
          class="cm-submit"
          onclick={submit}
          disabled={posting || uploading || (!draft.trim() && attachments.length === 0)}
        >
          {#if posting}{mode === "edit" ? "저장 중…" : "등록 중…"}{:else}{mode === "edit" ? "저장" : "등록"}{/if}
        </button>
      </div>

      <div class="cm-body">
        <textarea
          bind:this={textareaEl}
          bind:value={draft}
          class="cm-textarea"
          placeholder="댓글을 남기세요."
          maxlength={MAX_LEN}
          disabled={posting}
        ></textarea>

        {#if attachments.length > 0}
          <div class="cm-atts">
            {#each attachments as att, i (att.type === "image" ? att.url + i : `${att.lat},${att.lng}-${i}`)}
              {#if att.type === "image"}
                <div class="cm-att">
                  <img src={att.url} alt="" />
                  <button type="button" class="cm-att-x" onclick={() => removeAttachment(i)} aria-label="첨부 제거">✕</button>
                </div>
              {/if}
            {/each}
          </div>
        {/if}

        {#if error}
          <p class="cm-error" role="alert">{error}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .cm-portal { /* portal 마운트 컨테이너 — z-index 만 책임 */ }
  .cm-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 18, 16, 0.4);
    z-index: 9000;
    animation: cm-fade-in 0.15s ease;
  }
  .cm-modal {
    position: fixed;
    z-index: 9001;
    background: var(--color-bg, #fbf8f4);
    display: flex;
    flex-direction: column;
    animation: cm-slide-down 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.2);
  }
  /* 데스크톱: SideCard 와 동일 폭 (우측 fixed) */
  @media (min-width: 1024px) {
    .cm-modal {
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      max-width: 36vw;
    }
  }
  /* 모바일: 화면 최상단부터 풀스크린 (위쪽 여백 없음) */
  @media (max-width: 1023px) {
    .cm-modal {
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }
  }

  .cm-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-surface, #fdfaf4);
  }
  .cm-title {
    font-weight: 600;
    color: var(--color-primary, #a8352a);
    font-size: 0.95rem;
  }
  .cm-asuser {
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cm-asuser strong { color: var(--color-fg, #1f1c1a); font-weight: 600; }
  .cm-close {
    margin-left: auto;
    background: transparent;
    border: none;
    font-size: 1.1rem;
    color: var(--color-muted, #8a807a);
    cursor: pointer;
    padding: 0.3rem 0.5rem;
    line-height: 1;
  }
  .cm-close:hover { color: var(--color-fg, #1f1c1a); }
  .cm-close:disabled { opacity: 0.4; cursor: not-allowed; }

  /* 액션바 — textarea 위. 키보드와 무관하게 항상 보임 */
  .cm-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
  }
  .cm-att-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted, #8a807a);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .cm-att-btn:hover:not(:disabled) {
    background: var(--color-surface, #fdfaf4);
    border-color: var(--color-muted, #8a807a);
  }
  .cm-att-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cm-count {
    font-size: 0.76rem;
    color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
  }
  .cm-spacer { flex: 1; }
  .cm-cancel,
  .cm-submit {
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .cm-cancel {
    background: transparent;
    color: var(--color-muted, #8a807a);
    border-color: var(--color-rule, #e8dfd9);
  }
  .cm-cancel:hover:not(:disabled) {
    color: var(--color-fg, #1f1c1a);
    border-color: var(--color-fg, #1f1c1a);
  }
  .cm-submit {
    background: var(--color-primary, #a8352a);
    color: #fff;
    border-color: var(--color-primary, #a8352a);
  }
  .cm-submit:hover:not(:disabled) { filter: brightness(0.95); }
  .cm-submit:disabled,
  .cm-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

  .cm-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0.7rem 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .cm-textarea {
    width: 100%;
    min-height: 22vh;
    max-height: 30vh;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 8px;
    font: inherit;
    font-size: 0.95rem;
    line-height: 1.55;
    resize: vertical;
    background: #ffffff;
    box-sizing: border-box;
  }
  @media (min-width: 1024px) {
    .cm-textarea {
      min-height: 28vh;
      max-height: 45vh;
    }
  }
  .cm-textarea:focus {
    outline: none;
    border-color: var(--color-primary, #a8352a);
    box-shadow: 0 0 0 3px var(--color-primary-bg, #fbf3f1);
  }

  .cm-atts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .cm-att {
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--color-rule, #e8dfd9);
  }
  .cm-att img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cm-att-x {
    position: absolute;
    top: 2px; right: 2px;
    width: 18px; height: 18px;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border-radius: 50%;
    font-size: 0.7rem;
    cursor: pointer;
    line-height: 1;
    padding: 0;
  }
  .cm-error {
    margin: 0;
    color: var(--color-primary, #a8352a);
    font-size: 0.85rem;
  }

  @keyframes cm-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes cm-slide-down {
    from { transform: translateY(-30px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
