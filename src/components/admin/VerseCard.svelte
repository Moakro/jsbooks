<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let verse: { id?: string; text: string };
  export let num: number;
  export let isFirst: boolean;
  export let isLast: boolean;
  export let side: "hanja" | "hangeul" = "hanja";

  const dispatch = createEventDispatcher<{
    update: { text: string };
    mergeUp: void;
    mergeDown: void;
    delete: void;
    insertAbove: void;
    insertBelow: void;
  }>();

  let editing = false;
  let draft = verse.text;

  function startEdit() {
    draft = verse.text;
    editing = true;
  }
  function commit() {
    if (draft !== verse.text) dispatch("update", { text: draft });
    editing = false;
  }
  function cancel() {
    draft = verse.text;
    editing = false;
  }

  // Svelte action: auto-grow textarea to fit content (no scroll, no cap).
  function autosize(node: HTMLTextAreaElement) {
    const resize = () => {
      node.style.height = "auto";
      node.style.height = node.scrollHeight + "px";
    };
    // Delay one frame so the browser has rendered the textarea before measuring.
    requestAnimationFrame(resize);
    node.addEventListener("input", resize);
    return {
      destroy() {
        node.removeEventListener("input", resize);
      },
    };
  }
</script>

<div class="card" class:hangeul={side === "hangeul"} class:empty={!verse.text.trim()}>
  <div class="head">
    <span class="num">{num}절</span>
    {#if verse.id}
      <span class="anchor">^{verse.id}</span>
    {:else}
      <span class="anchor new">신규</span>
    {/if}
  </div>

  {#if editing}
    <textarea
      use:autosize
      bind:value={draft}
      rows="2"
      placeholder={verse.text ? "" : "본문을 입력하세요"}
    ></textarea>
    <div class="edit-actions">
      <button type="button" class="primary" on:click={commit}>저장</button>
      <button type="button" on:click={cancel}>취소</button>
    </div>
  {:else}
    <div class="body" on:click={startEdit} role="button" tabindex="0">
      {#if verse.text.trim()}
        {verse.text}
      {:else}
        <em class="placeholder">(본문 없음 — 클릭하여 입력)</em>
      {/if}
    </div>
    <div class="actions">
      {#if !isFirst}
        <button type="button" title="위 절과 병합" on:click={() => dispatch("mergeUp")}>↑병합</button>
      {/if}
      {#if !isLast}
        <button type="button" title="아래 절과 병합" on:click={() => dispatch("mergeDown")}>↓병합</button>
      {/if}
      <button type="button" title="이 절 위에 새 절 삽입" on:click={() => dispatch("insertAbove")}>+위</button>
      <button type="button" title="이 절 아래에 새 절 삽입" on:click={() => dispatch("insertBelow")}>+아래</button>
      <button type="button" class="danger" title="이 절 삭제" on:click={() => dispatch("delete")}>✕</button>
    </div>
  {/if}
</div>

<style>
  .card {
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    background: var(--color-bg);
    margin-bottom: 0.5rem;
  }
  .card.hangeul {
    background: var(--color-surface-2);
  }
  .card.empty {
    border-style: dashed;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--color-muted);
    margin-bottom: 0.3rem;
  }
  .num {
    font-weight: 600;
    color: var(--color-fg);
    font-size: 0.85rem;
  }
  .anchor {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
  }
  .anchor.new {
    color: var(--color-secondary, #d97706);
    font-style: italic;
  }
  .body {
    line-height: 1.7;
    cursor: text;
    padding: 0.2rem 0;
    min-height: 1.7em;
    white-space: pre-wrap;
  }
  .body:hover {
    background: var(--color-primary-bg);
    border-radius: 3px;
  }
  .placeholder {
    color: var(--color-muted);
    font-style: italic;
  }
  textarea {
    width: 100%;
    border: 1px solid var(--color-primary);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    font: inherit;
    line-height: 1.7;
    resize: none;
    overflow: hidden;
    box-sizing: border-box;
    min-height: 2.4em;
  }
  .edit-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }
  .actions {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.4rem;
    flex-wrap: wrap;
  }
  button {
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-bg);
    color: var(--color-fg);
    font-size: 0.75rem;
    cursor: pointer;
  }
  button:hover {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
  }
  button.primary {
    background: var(--color-primary);
    color: var(--color-bg);
    border-color: var(--color-primary);
  }
  button.danger:hover {
    background: #fee2e2;
    border-color: #ef4444;
    color: #991b1b;
  }
</style>
