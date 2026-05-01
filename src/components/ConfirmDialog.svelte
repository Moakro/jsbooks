<script lang="ts">
  import { onMount, tick } from "svelte";

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
    tick().then(() => confirmBtnEl?.focus());
  }

  function onKey(e: KeyboardEvent) {
    if (!pending) return;
    if (e.key === "Escape") {
      e.preventDefault();
      decide(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      decide(true);
    }
  }

  onMount(() => {
    window.addEventListener("jsbooks:confirm", onConfirmEvent);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("jsbooks:confirm", onConfirmEvent);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

{#if pending}
  <div
    class="cd-backdrop"
    role="presentation"
    onclick={() => decide(false)}
    onkeydown={null}
  >
    <div
      class="cd-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={pending.title ? "cd-title" : undefined}
      aria-describedby="cd-message"
      onclick={(e) => e.stopPropagation()}
      onkeydown={null}
    >
      {#if pending.title}
        <h2 id="cd-title" class="cd-title">{pending.title}</h2>
      {/if}
      <p id="cd-message" class="cd-message">{pending.message}</p>
      <div class="cd-actions">
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
      </div>
    </div>
  </div>
{/if}

<style>
  .cd-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 18, 16, 0.5);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    animation: cd-fade 0.15s ease;
  }
  @keyframes cd-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .cd-modal {
    background: var(--color-bg, #fbf8f4);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    width: min(420px, 100%);
    padding: 1.4rem 1.4rem 1.1rem;
    color: var(--color-fg, #1f1c1a);
    animation: cd-pop 0.15s ease;
  }
  @keyframes cd-pop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  .cd-title {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-primary, #a8352a);
  }
  .cd-message {
    margin: 0 0 1.2rem;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--color-fg, #1f1c1a);
    white-space: pre-line;
  }
  .cd-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
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
