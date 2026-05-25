<script lang="ts">
  import { onMount, tick } from "svelte";
  import Modal from "./Modal.svelte";

  type Resolve = (ok: boolean) => void;
  type Pending = {
    title?: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    danger: boolean;
    resolve: Resolve;
  };

  let pending = $state<Pending | null>(null);
  let confirmBtnEl: HTMLButtonElement | undefined = $state();

  function decide(ok: boolean) {
    if (!pending) return;
    const r = pending.resolve;
    pending = null;
    r(ok);
  }

  function onConfirmEvent(e: Event) {
    const ev = e as CustomEvent<any>;
    const d = ev.detail ?? {};
    if (typeof d.message !== "string" || typeof d.resolve !== "function") return;
    // If another dialog is already open, reject the previous one as cancel.
    if (pending) pending.resolve(false);
    pending = {
      title: typeof d.title === "string" ? d.title : undefined,
      message: d.message,
      confirmLabel: typeof d.confirmLabel === "string" ? d.confirmLabel : "확인",
      cancelLabel: typeof d.cancelLabel === "string" ? d.cancelLabel : "취소",
      danger: !!d.danger,
      resolve: d.resolve,
    };
    // Modal 기본 포커스(첫 focusable)는 취소 버튼이지만, 확인 위주 UX 라 confirm 으로 옮김.
    tick().then(() => confirmBtnEl?.focus());
  }

  // Enter 단축키 — Modal 의 ESC 핸들러와 충돌 없이 별도 처리.
  function onEnterKey(e: KeyboardEvent) {
    if (!pending) return;
    if (e.key === "Enter") {
      e.preventDefault();
      decide(true);
    }
  }

  onMount(() => {
    window.addEventListener("jsbooks:confirm", onConfirmEvent);
    document.addEventListener("keydown", onEnterKey);
    return () => {
      window.removeEventListener("jsbooks:confirm", onConfirmEvent);
      document.removeEventListener("keydown", onEnterKey);
    };
  });
</script>

<Modal
  open={!!pending}
  onClose={() => decide(false)}
  maxWidth="420px"
  zIndex={1300}
  ariaLabel={pending?.title ?? "확인"}
>
  {#snippet header()}
    {#if pending?.title}
      <h2 class="cd-title">{pending.title}</h2>
    {:else}
      <span></span>
    {/if}
  {/snippet}

  {#if pending}
    <p class="cd-message">{pending.message}</p>
  {/if}

  {#snippet footer()}
    {#if pending}
      <button type="button" class="cd-btn cd-cancel" onclick={() => decide(false)}>
        {pending.cancelLabel}
      </button>
      <button
        bind:this={confirmBtnEl}
        type="button"
        class="cd-btn cd-confirm"
        class:danger={pending.danger}
        onclick={() => decide(true)}
      >
        {pending.confirmLabel}
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .cd-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-primary, #a8352a);
  }
  .cd-message {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--color-fg, #1f1c1a);
    white-space: pre-line;
  }
  .cd-btn {
    font: inherit;
    font-size: 0.9rem;
    padding: 0.45rem 0.95rem;
    border-radius: 6px;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .cd-cancel {
    background: transparent;
    border: 1px solid var(--color-rule, #e8dfd9);
    color: var(--color-muted, #8a807a);
  }
  .cd-cancel:hover {
    background: var(--color-rule, #e8dfd9);
    color: var(--color-fg, #1f1c1a);
  }
  .cd-confirm {
    background: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    color: #fff;
  }
  .cd-confirm:hover {
    background: #195d5d;
    border-color: #195d5d;
  }
  .cd-confirm.danger {
    background: var(--color-primary, #a8352a);
    border-color: var(--color-primary, #a8352a);
  }
  .cd-confirm.danger:hover {
    background: #8d2c23;
    border-color: #8d2c23;
  }
  .cd-btn:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: 2px;
  }
</style>
