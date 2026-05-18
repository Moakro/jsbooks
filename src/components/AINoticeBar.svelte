<script lang="ts">
  const EMAIL = "hello@jsbooks.wiki";

  let visible = $state(false);
  let timer: number | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(EMAIL);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = EMAIL;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    visible = true;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => (visible = false), 2400);
  }
</script>

<section class="notice">
  <p class="text">
    경전 본문의 인물·장소·용어 연결을 AI로 순차 보강하고 있습니다.
    해당 경전 구절의 댓글 혹은 이메일로 의견 주시면 큰 도움이 됩니다.
  </p>
  <button type="button" class="email" onclick={copy} aria-label={`${EMAIL} 클립보드로 복사`}>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
    <span>{EMAIL}</span>
  </button>
</section>

{#if visible}
  <div class="toast" role="status" aria-live="polite">메일 주소가 복사되었습니다.</div>
{/if}

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem 0.9rem;
    padding: 0.85rem 1rem;
    margin: 0 0 1rem;
    background: var(--color-secondary-bg, #f0f7f6);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-left: 3px solid var(--color-secondary, #1e6e6e);
    border-radius: 8px;
    color: var(--color-fg, #1f1c1a);
    font-size: 0.88rem;
    line-height: 1.55;
  }
  .text {
    margin: 0;
    flex: 1 1 auto;
    min-width: 0;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .email {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    background: var(--color-primary-bg, #fbf3f1);
    color: var(--color-primary, #a8352a);
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 999px;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    flex: 0 0 auto;
    transition: background 0.15s ease, color 0.15s ease, transform 0.05s ease;
  }
  .email:hover { background: var(--color-primary, #a8352a); color: #fff; }
  .email:active { transform: translateY(1px); }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    transform: translateX(-50%);
    z-index: 200;
    padding: 0.7rem 1.1rem;
    background: #14532d;
    color: #f0fdf4;
    border-radius: 8px;
    font-size: 0.9rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    animation: toast-in 0.18s ease;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translate(-50%, 8px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
</style>
