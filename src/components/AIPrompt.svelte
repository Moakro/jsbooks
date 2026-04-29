<script lang="ts">
  import Icon from "./Icon.svelte";
  import DayBox from "./DayBox.svelte";

  const PLACEHOLDER = "AI로 경전을 검색하세요";

  const SUGGESTIONS = [
    "상제님이 일본을 어떻게 보셨나",
    "단주의 원한",
    "무신납월공사 요약",
    "이마두는 누구",
    "1908년의 공사",
  ];

  let query = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    const max = 220;
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, max) + "px";
  }

  function submit() {
    const q = query.trim();
    if (!q) return;
    window.dispatchEvent(
      new CustomEvent("jsbooks:ai-search", { detail: { q } }),
    );
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function pickSuggestion(s: string) {
    query = s;
    queueMicrotask(() => {
      autoResize();
      textareaEl?.focus();
    });
  }

</script>

<section class="ai-prompt">
  <DayBox />

  <div class="box">
    <textarea
      bind:this={textareaEl}
      bind:value={query}
      oninput={autoResize}
      onkeydown={onKeydown}
      placeholder={PLACEHOLDER}
      rows="1"
      autocomplete="off"
      spellcheck="false"
    ></textarea>
    <div class="bar">
      <button
        type="button"
        class="ghost"
        title="첨부 (준비 중)"
        aria-label="첨부 (준비 중)"
        disabled
      >
        <span class="plus">+</span>
      </button>
      <span class="spacer"></span>
      <span class="hint">Enter ↵</span>
      <button
        type="button"
        class="send"
        onclick={submit}
        disabled={!query.trim()}
        aria-label="물어보기"
        title="물어보기"
      >
        <Icon icon="arrow-right" size={18} />
      </button>
    </div>
  </div>

  <ul class="suggestions">
    {#each SUGGESTIONS as s}
      <li>
        <button type="button" class="chip" onclick={() => pickSuggestion(s)}>
          {s}
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .ai-prompt {
    margin: -1rem 0 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.8rem;
    align-items: stretch;
  }
  .box {
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 16px;
    background: var(--color-bg, #fbf8f4);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
    overflow: hidden;
  }
  .box:focus-within {
    border-color: var(--color-primary, #a8352a);
    box-shadow: 0 2px 14px rgba(168, 53, 42, 0.08);
  }
  textarea {
    display: block;
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-fg, #1f1c1a);
    font: inherit;
    font-size: 1.05rem;
    line-height: 1.55;
    padding: 1rem 1.1rem 0.4rem;
    min-height: 1.55em;
    max-height: 220px;
  }
  textarea::placeholder {
    color: var(--color-muted, #8a807a);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem 0.55rem;
  }
  .spacer {
    flex: 1;
  }
  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 50%;
    color: var(--color-muted, #8a807a);
    cursor: pointer;
  }
  .ghost .plus {
    font-size: 1.15rem;
    line-height: 1;
    transform: translateY(-1px);
  }
  .ghost:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .hint {
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    user-select: none;
  }
  .send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    background: var(--color-primary, #a8352a);
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 50%;
    color: var(--color-bg, #fbf8f4);
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .send:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .send:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .suggestions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    justify-content: center;
  }
  .suggestions li {
    display: inline-flex;
  }
  .chip {
    background: transparent;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    font-size: 0.88rem;
    color: var(--color-fg, #1f1c1a);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .chip:hover {
    background: var(--color-secondary-bg, #f0f7f6);
    border-color: var(--color-secondary, #1e6e6e);
    color: var(--color-secondary, #1e6e6e);
  }
  @media (max-width: 640px) {
    textarea {
      font-size: 1rem;
      padding: 0.85rem 0.95rem 0.3rem;
    }
    .chip {
      font-size: 0.84rem;
      padding: 0.35rem 0.7rem;
    }
  }
</style>
