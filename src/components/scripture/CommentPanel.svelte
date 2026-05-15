<script lang="ts">
  import Comments from "../Comments.svelte";

  let { target, anchor, onClose }: {
    target: string;
    anchor: string;
    onClose: () => void;
  } = $props();
</script>

<aside class="comment-panel" role="complementary" aria-label={`${anchor} 댓글`}>
  <header class="panel-head">
    <div class="anchor-label">
      <span class="anchor-text">^{anchor}</span>
      <a class="anchor-jump" href={`#${anchor}`} title="본문으로 이동">↗</a>
    </div>
    <button type="button" class="close-btn" aria-label="닫기" onclick={onClose}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </header>
  <div class="panel-body">
    {#key target}
      <Comments {target} />
    {/key}
  </div>
</aside>

<style>
  .comment-panel {
    position: fixed;
    top: calc(var(--header-h, 64px) + 0.8rem);
    right: 1rem;
    width: 360px;
    max-height: calc(100vh - var(--header-h, 64px) - 1.6rem);
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.18));
    z-index: 40;
    overflow: hidden;
    animation: slide-in 0.18s ease-out;
  }
  @media (min-width: 1600px) {
    .comment-panel {
      width: 400px;
      right: 1.5rem;
    }
  }
  @keyframes slide-in {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  .panel-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-surface-2, var(--color-bg));
  }
  .anchor-label {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
  }
  .anchor-text {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.88rem;
    color: var(--color-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .anchor-jump {
    font-size: 0.85rem;
    color: var(--color-primary);
    text-decoration: none;
    padding: 0 0.2rem;
  }
  .anchor-jump:hover {
    text-decoration: underline;
  }
  .close-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .close-btn:hover {
    background: var(--color-rule);
    color: var(--color-text);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.6rem 0.9rem 0.9rem;
  }
</style>
