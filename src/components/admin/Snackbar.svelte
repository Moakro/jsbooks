<script lang="ts">
  /**
   * 어드민 글로벌 스낵바. 우하단에 fixed, 큐 스택 형태. dismiss 버튼 또는 자동 사라짐.
   * 본 컴포넌트는 어드민 페이지에서 1회 마운트하면 됨 — `admin-snackbar` 모듈에서
   * showSnackbar(...) 호출 시 여기로 들어옴.
   */
  import { onMount } from "svelte";
  import {
    subscribeSnackbar,
    dismissSnackbar,
    type SnackbarMessage,
  } from "../../lib/admin-snackbar";

  let messages = $state<SnackbarMessage[]>([]);

  onMount(() => {
    const unsub = subscribeSnackbar((m) => (messages = m));
    return () => unsub();
  });
</script>

<div class="stack" aria-live="polite" aria-atomic="false">
  {#each messages as m (m.id)}
    <div class="msg" data-type={m.type} role="status">
      <span class="text">{m.text}</span>
      <button
        type="button"
        class="x"
        aria-label="알림 닫기"
        onclick={() => dismissSnackbar(m.id)}
      >✕</button>
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 200;
    display: flex;
    flex-direction: column-reverse;
    gap: 0.5rem;
    pointer-events: none;
  }
  .msg {
    pointer-events: auto;
    min-width: 16rem;
    max-width: 26rem;
    padding: 0.6rem 0.85rem;
    border-radius: 6px;
    background: var(--color-bg, #fbf8f4);
    border: 1px solid var(--color-rule, #e8dfd9);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.88rem;
    color: var(--color-fg, #1f1c1a);
    animation: slide-in 0.18s ease;
  }
  .msg[data-type="success"] {
    border-left: 4px solid #16a34a;
    background: #f0fdf4;
    color: #14532d;
  }
  .msg[data-type="error"] {
    border-left: 4px solid var(--color-primary, #a8352a);
    background: var(--color-primary-bg, #fbf3f1);
    color: var(--color-primary, #a8352a);
  }
  .msg[data-type="info"] {
    border-left: 4px solid var(--color-secondary, #1e6e6e);
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
  }
  .text { flex: 1; line-height: 1.45; }
  .x {
    background: transparent;
    border: none;
    cursor: pointer;
    color: inherit;
    opacity: 0.55;
    padding: 0 0.25rem;
    font-size: 0.95rem;
    line-height: 1;
  }
  .x:hover { opacity: 1; }

  @keyframes slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-color-scheme: dark) {
    .msg { background: #2c2418; color: #f0e6d0; border-color: #4a3a25; }
    .msg[data-type="success"] { background: #0f2a1a; color: #86efac; }
  }
</style>
