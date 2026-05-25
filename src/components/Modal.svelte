<script lang="ts">
  // 공용 Modal 컴포넌트.
  // portal(document.body) + backdrop + ESC + body scroll lock + ARIA + focus trap 를 통합.
  // variant="center" (기본): 가운데 카드 레이아웃 (header/body/footer slot 제공).
  // variant="custom": portal/backdrop/ESC/scroll-lock/ARIA 만 제공, 카드 레이아웃은 호출부가 자유 구성.
  import { tick, type Snippet } from "svelte";

  interface Props {
    open: boolean;
    title?: string;
    onClose: () => void;
    maxWidth?: string;
    closeOnBackdrop?: boolean;
    closeOnEsc?: boolean;
    zIndex?: number;
    variant?: "center" | "custom";
    /** title 없을 때 ARIA label 폴백 */
    ariaLabel?: string;
    /** center variant 에서 카드 width 제어 (기본 100%) */
    width?: string;
    /** dialog 컨테이너 추가 class */
    dialogClass?: string;
    header?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    open,
    title,
    onClose,
    maxWidth = "460px",
    closeOnBackdrop = true,
    closeOnEsc = true,
    zIndex = 1100,
    variant = "center",
    ariaLabel,
    width,
    dialogClass,
    header,
    children,
    footer,
  }: Props = $props();

  let dialogEl: HTMLDivElement | undefined = $state();
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode === document.body) node.remove();
      },
    };
  }

  // Body scroll lock + ESC + focus trap (open 동안).
  $effect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function focusables(): HTMLElement[] {
      if (!dialogEl) return [];
      return Array.from(
        dialogEl.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("aria-hidden"));
    }

    function onKey(e: KeyboardEvent) {
      if (closeOnEsc && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogEl) return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        dialogEl.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialogEl.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogEl.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    // 초기 포커스 — 첫 focusable 또는 dialog 자체.
    tick().then(() => {
      if (!dialogEl) return;
      const list = focusables();
      if (list.length > 0) list[0].focus();
      else dialogEl.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  });

  function handleBackdrop() {
    if (closeOnBackdrop) onClose();
  }
</script>

{#if open}
  <div
    class="modal-root"
    class:modal-center={variant === "center"}
    style:--modal-z={zIndex}
    use:portal
  >
    <div
      class="modal-backdrop"
      role="presentation"
      onclick={handleBackdrop}
      onkeydown={null}
    ></div>

    {#if variant === "center"}
      <div
        bind:this={dialogEl}
        class={"modal-card" + (dialogClass ? " " + dialogClass : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
        tabindex="-1"
        style:max-width={maxWidth}
        style:width={width ?? "100%"}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        {#if header}
          <div class="modal-header">{@render header()}</div>
        {:else if title}
          <div class="modal-header">
            <h2 id={titleId} class="modal-title">{title}</h2>
            <button
              type="button"
              class="modal-close"
              onclick={onClose}
              aria-label="닫기"
            >✕</button>
          </div>
        {/if}
        <div class="modal-body">
          {#if children}{@render children()}{/if}
        </div>
        {#if footer}
          <div class="modal-footer">{@render footer()}</div>
        {/if}
      </div>
    {:else}
      <div
        bind:this={dialogEl}
        class={"modal-custom" + (dialogClass ? " " + dialogClass : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
        tabindex="-1"
      >
        {#if children}{@render children()}{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .modal-root {
    position: fixed;
    inset: 0;
    z-index: var(--modal-z, 1100);
  }
  .modal-root.modal-center {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 18, 16, 0.5);
    animation: modal-fade 0.15s ease;
  }
  .modal-card {
    position: relative;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.22);
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    animation: modal-pop 0.15s ease;
    outline: none;
  }
  .modal-card:focus-visible {
    box-shadow:
      0 20px 50px rgba(0, 0, 0, 0.22),
      0 0 0 3px color-mix(in srgb, var(--color-primary, #a8352a) 35%, transparent);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.95rem 1.1rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    flex: 0 0 auto;
  }
  .modal-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .modal-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-muted, #8a807a);
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
  }
  .modal-close:hover {
    background: var(--color-primary-bg, color-mix(in srgb, var(--color-primary, #a8352a) 10%, transparent));
    color: var(--color-primary, #a8352a);
  }
  .modal-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 1rem 1.1rem 1.1rem;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
    padding: 0.7rem 1.1rem;
    border-top: 1px solid var(--color-rule, #e8dfd9);
    flex: 0 0 auto;
  }
  .modal-custom {
    outline: none;
  }
  @keyframes modal-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes modal-pop {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (max-width: 480px) {
    .modal-root.modal-center {
      padding: 0.5rem;
    }
  }
</style>
