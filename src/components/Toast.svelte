<!--
  사이트 전역 스낵바.
  Base layout 에 한 번 mount. 다른 컴포넌트가
  `window.dispatchEvent(new CustomEvent('jsbooks:toast', { detail: { text: '...' } }))`
  로 보내면 우하단에 페이드 인/아웃.
-->
<script lang="ts">
  import { onMount } from "svelte";

  type ToastItem = { id: number; text: string };
  let items = $state<ToastItem[]>([]);
  let nextId = 0;
  const TTL_MS = 2400;

  function show(text: string) {
    const id = ++nextId;
    items = [...items, { id, text }];
    window.setTimeout(() => {
      items = items.filter((t) => t.id !== id);
    }, TTL_MS);
  }

  onMount(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text?: string }>;
      const text = ce.detail?.text?.trim();
      if (text) show(text);
    };
    window.addEventListener("jsbooks:toast", handler);
    return () => window.removeEventListener("jsbooks:toast", handler);
  });
</script>

<div class="toast-stack" role="status" aria-live="polite" aria-atomic="true">
  {#each items as t (t.id)}
    <div class="toast">{t.text}</div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column-reverse;
    gap: 0.45rem;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    background: rgba(31, 28, 26, 0.92);
    color: #fff;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    font-size: 0.88rem;
    line-height: 1.35;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    max-width: min(90vw, 32em);
    text-align: center;
    animation: jsb-toast-in 0.18s ease-out, jsb-toast-out 0.32s ease-in 2.05s forwards;
  }
  @keyframes jsb-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes jsb-toast-out {
    to { opacity: 0; transform: translateY(4px); }
  }
</style>
