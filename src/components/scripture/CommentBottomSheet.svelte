<script lang="ts">
  import { onMount } from "svelte";
  import Comments from "../Comments.svelte";

  let { target, anchor, onClose }: {
    target: string;
    anchor: string;
    onClose: () => void;
  } = $props();

  let sheetEl: HTMLDivElement | undefined = $state();
  let expanded = $state(false);
  let dragStartY = 0;
  let dragDeltaY = $state(0);
  let dragging = $state(false);

  function onTouchStart(e: TouchEvent) {
    if (!e.touches[0]) return;
    dragStartY = e.touches[0].clientY;
    dragDeltaY = 0;
    dragging = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!dragging || !e.touches[0]) return;
    dragDeltaY = e.touches[0].clientY - dragStartY;
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;
    if (dragDeltaY < -60 && !expanded) {
      expanded = true;
    } else if (dragDeltaY > 80) {
      if (expanded) expanded = false;
      else onClose();
    }
    dragDeltaY = 0;
  }

  onMount(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  });
</script>

<div class="sheet-backdrop" onclick={onClose} role="presentation"></div>

<div
  class="sheet"
  class:expanded
  bind:this={sheetEl}
  role="dialog"
  aria-modal="true"
  aria-label={`${anchor} 댓글`}
  style={dragging && dragDeltaY > 0 ? `transform: translateY(${dragDeltaY}px)` : ""}
>
  <button
    type="button"
    class="grabber"
    aria-label="드래그하여 크기 조절"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
    onclick={() => (expanded = !expanded)}
  >
    <span class="grab-bar"></span>
  </button>
  <header class="sheet-head">
    <div class="anchor-label">
      <span class="anchor-text">^{anchor}</span>
      <a class="anchor-jump" href={`#${anchor}`} title="본문으로 이동" onclick={onClose}>↗</a>
    </div>
    <button type="button" class="close-btn" aria-label="닫기" onclick={onClose}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </header>
  <div class="sheet-body">
    {#key target}
      <Comments {target} />
    {/key}
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 49;
    animation: fade-in 0.15s ease-out;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 60vh;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.18);
    z-index: 50;
    animation: slide-up 0.22s ease-out;
    transition: height 0.22s ease, transform 0.05s linear;
    overflow: hidden;
  }
  .sheet.expanded {
    height: 92vh;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  .grabber {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: grab;
    touch-action: none;
  }
  .grab-bar {
    width: 38px;
    height: 4px;
    background: var(--color-rule);
    border-radius: 999px;
  }
  .sheet-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0.95rem 0.55rem;
    border-bottom: 1px solid var(--color-rule);
  }
  .anchor-label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .anchor-text {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.88rem;
    color: var(--color-muted);
  }
  .anchor-jump {
    font-size: 0.85rem;
    color: var(--color-primary);
    text-decoration: none;
    padding: 0 0.2rem;
  }
  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    border-radius: 4px;
  }
  .close-btn:hover {
    background: var(--color-rule);
    color: var(--color-text);
  }
  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.6rem 0.95rem 1rem;
    -webkit-overflow-scrolling: touch;
  }
</style>
