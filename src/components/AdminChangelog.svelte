<script lang="ts">
  type Entry = {
    hash: string;
    date: string;
    author: string;
    subject: string;
    publicMessage?: string;
  };
  type Override = { visible?: boolean; message?: string };

  interface Props {
    entries: Entry[];
    initialOverrides: Record<string, Override>;
  }
  let { entries, initialOverrides }: Props = $props();

  let overrides = $state<Record<string, Override>>({ ...initialOverrides });
  let editing = $state<Record<string, string>>({}); // hash → in-progress message edit
  let savingHash = $state<string | null>(null);
  let errMsg = $state<string | null>(null);

  function shortDate(iso: string): string {
    return iso.slice(0, 10);
  }

  function effectiveMessage(e: Entry): string | null {
    const ovr = overrides[e.hash];
    if (ovr?.visible === false) return null;
    if (ovr?.message && ovr.message.trim()) return ovr.message.trim();
    if (ovr?.visible === true) return e.publicMessage ?? e.subject;
    if (e.publicMessage) return e.publicMessage;
    return null;
  }

  function isVisible(e: Entry): boolean {
    return effectiveMessage(e) !== null;
  }

  async function postSave(payload: any) {
    savingHash = payload.hash;
    errMsg = null;
    try {
      const res = await fetch("/api/admin/changelog/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      overrides = { ...(j.overrides ?? {}) };
    } catch (e: any) {
      errMsg = e?.message ?? "저장 실패";
    } finally {
      savingHash = null;
    }
  }

  async function toggleVisible(e: Entry) {
    const cur = isVisible(e);
    // Force-flip:
    //  - currently visible → set visible:false (override hides it)
    //  - currently hidden  → set visible:true (override shows it)
    await postSave({ hash: e.hash, visible: !cur });
  }

  async function saveCustom(e: Entry) {
    const msg = (editing[e.hash] ?? "").trim();
    await postSave({ hash: e.hash, visible: true, message: msg || null });
    editing = { ...editing, [e.hash]: "" };
  }

  async function clearOverride(e: Entry) {
    await postSave({ hash: e.hash, clear: true });
    editing = { ...editing, [e.hash]: "" };
  }

  function startEdit(e: Entry) {
    const cur =
      overrides[e.hash]?.message ?? e.publicMessage ?? "";
    editing = { ...editing, [e.hash]: cur };
  }
  function cancelEdit(hash: string) {
    const next = { ...editing };
    delete next[hash];
    editing = next;
  }
</script>

{#if errMsg}
  <p class="err">{errMsg}</p>
{/if}

<table class="changelog-table">
  <thead>
    <tr>
      <th class="c-date">날짜</th>
      <th class="c-meta">commit · subject</th>
      <th class="c-display">노출 메시지 / 상태</th>
      <th class="c-actions">조작</th>
    </tr>
  </thead>
  <tbody>
    {#each entries as e (e.hash)}
      {@const ovr = overrides[e.hash]}
      {@const visible = isVisible(e)}
      {@const display = effectiveMessage(e)}
      {@const isEditing = editing[e.hash] !== undefined}
      <tr class:visible class:hidden-row={!visible}>
        <td class="c-date">{shortDate(e.date)}</td>
        <td class="c-meta">
          <code class="hash">{e.hash}</code>
          <span class="subject">{e.subject}</span>
          {#if e.publicMessage}
            <div class="public-tag">
              <span class="badge">--public</span>
              <span class="public-msg">{e.publicMessage}</span>
            </div>
          {/if}
        </td>
        <td class="c-display">
          {#if isEditing}
            <textarea
              bind:value={editing[e.hash]}
              rows="2"
              placeholder="사용자에게 보일 메시지"
            ></textarea>
          {:else if display}
            <span class="display-msg">{display}</span>
          {:else}
            <span class="muted">— 비공개 —</span>
          {/if}
          {#if ovr}
            <div class="ovr-tag">
              override: {ovr.visible === false ? "강제 비공개" : ovr.message ? "사용자 메시지" : "강제 공개"}
            </div>
          {/if}
        </td>
        <td class="c-actions">
          {#if isEditing}
            <button onclick={() => saveCustom(e)} disabled={savingHash === e.hash}>저장</button>
            <button class="ghost" onclick={() => cancelEdit(e.hash)}>취소</button>
          {:else}
            <button onclick={() => toggleVisible(e)} disabled={savingHash === e.hash}>
              {visible ? "숨기기" : "공개"}
            </button>
            <button class="ghost" onclick={() => startEdit(e)}>편집</button>
            {#if ovr}
              <button class="ghost" onclick={() => clearOverride(e)}>override 제거</button>
            {/if}
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .err {
    background: var(--color-primary-bg, #fbf3f1);
    color: var(--color-primary, #a8352a);
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 6px;
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
  }
  .changelog-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .changelog-table th,
  .changelog-table td {
    text-align: left;
    vertical-align: top;
    padding: 0.6rem 0.5rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
  }
  .changelog-table th {
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    font-weight: 600;
    border-bottom: 2px solid var(--color-rule, #e8dfd9);
  }
  .c-date {
    width: 6.5em;
    color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
  }
  .c-meta {
    width: 38%;
  }
  .c-display {
    width: 38%;
  }
  .c-actions {
    width: 12em;
    text-align: right;
  }
  .hash {
    font-family: ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, monospace;
    font-size: 0.78rem;
    color: var(--color-secondary, #1e6e6e);
    margin-right: 0.4rem;
  }
  .subject {
    color: var(--color-fg, #1f1c1a);
  }
  .public-tag {
    margin-top: 0.3rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
  }
  .badge {
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    font-family: ui-monospace, monospace;
  }
  .public-msg {
    font-size: 0.85rem;
    color: var(--color-secondary, #1e6e6e);
  }
  .display-msg {
    color: var(--color-fg, #1f1c1a);
    line-height: 1.5;
  }
  .muted {
    color: var(--color-disabled, #b8b0aa);
    font-size: 0.85rem;
  }
  .ovr-tag {
    margin-top: 0.3rem;
    font-size: 0.72rem;
    color: var(--color-primary, #a8352a);
  }
  .hidden-row {
    background: rgba(0, 0, 0, 0.02);
  }
  textarea {
    width: 100%;
    padding: 0.4rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 5px;
    font: inherit;
    font-size: 0.9rem;
    background: var(--color-bg, #fbf8f4);
    color: var(--color-fg, #1f1c1a);
    resize: vertical;
  }
  button {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.3rem 0.65rem;
    border-radius: 5px;
    border: 1px solid var(--color-secondary, #1e6e6e);
    background: var(--color-secondary, #1e6e6e);
    color: #fff;
    cursor: pointer;
    margin: 0 0 0.3rem 0.25rem;
    white-space: nowrap;
  }
  button:hover {
    background: #195d5d;
  }
  button.ghost {
    background: transparent;
    color: var(--color-muted, #8a807a);
    border-color: var(--color-rule, #e8dfd9);
  }
  button.ghost:hover {
    background: var(--color-rule, #e8dfd9);
    color: var(--color-fg, #1f1c1a);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
