<script lang="ts">
  /**
   * 천지개벽경 canonical-mapping v2 sentence-string 모델용 편집기.
   *
   * v1 모델(ChapterEditor.svelte)과 다름:
   *   - 한자/한글 markdown 자체는 편집하지 않음 (한자 본문은 sentence-anchor 마이그레이션 끝났고, 한글은 매핑 JSON에 string으로 임베드).
   *   - 한자 sentence별로 한글 textarea 입력 → /api/admin/canonical-mapping/save-sentence 로 단건 저장.
   *   - 매핑 안 된 sentence (hangeul=="") · 미검수 sentence를 한눈에 표시.
   */
  import { onMount } from "svelte";

  type Sentence = {
    anchor: string;
    hanja: string;
    hangeul: string;
    reviewed: boolean;
  };
  type Group = { num: number; sentences: Sentence[] };

  export let groups: Group[];

  // 로컬 가변 사본 (서버 저장 전 사용자 수정 반영용)
  let localGroups: Group[] = groups.map((g) => ({
    num: g.num,
    sentences: g.sentences.map((s) => ({ ...s })),
  }));

  // anchor → 저장 상태 map (idle / saving / saved / error)
  type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
  let saveState: Record<string, SaveState> = {};
  let saveError: Record<string, string> = {};

  function markDirty(anchor: string) {
    saveState = { ...saveState, [anchor]: "dirty" };
  }

  async function saveSentence(group: Group, sentence: Sentence) {
    saveState = { ...saveState, [sentence.anchor]: "saving" };
    saveError = { ...saveError, [sentence.anchor]: "" };
    try {
      const res = await fetch("/api/admin/canonical-mapping/save-sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchor: sentence.anchor,
          hangeul: sentence.hangeul,
          reviewed: sentence.reviewed,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? "save failed");
      saveState = { ...saveState, [sentence.anchor]: "saved" };
      // 잠시 후 idle로 (UI 안정)
      setTimeout(() => {
        if (saveState[sentence.anchor] === "saved") {
          saveState = { ...saveState, [sentence.anchor]: "idle" };
        }
      }, 1500);
    } catch (e: any) {
      saveState = { ...saveState, [sentence.anchor]: "error" };
      saveError = { ...saveError, [sentence.anchor]: e?.message ?? String(e) };
    }
  }

  function toggleReviewed(group: Group, sentence: Sentence) {
    sentence.reviewed = !sentence.reviewed;
    localGroups = [...localGroups];
    saveSentence(group, sentence);
  }

  function handleHangeulInput(group: Group, sentence: Sentence, ev: Event) {
    const t = (ev.target as HTMLTextAreaElement).value;
    sentence.hangeul = t;
    localGroups = [...localGroups];
    markDirty(sentence.anchor);
  }

  function handleHangeulBlur(group: Group, sentence: Sentence) {
    if (saveState[sentence.anchor] === "dirty") saveSentence(group, sentence);
  }

  function statusLabel(s: SaveState): string {
    if (s === "saving") return "저장 중…";
    if (s === "saved") return "저장됨";
    if (s === "dirty") return "변경 (포커스 빠지면 저장)";
    if (s === "error") return "오류";
    return "";
  }

  // Cmd/Ctrl+S: 현재 포커스된 textarea의 sentence 즉시 저장
  function onKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      const ta = document.activeElement as HTMLTextAreaElement | null;
      if (!ta || ta.tagName !== "TEXTAREA") return;
      const anchor = ta.dataset.anchor;
      if (!anchor) return;
      e.preventDefault();
      for (const g of localGroups) {
        const s = g.sentences.find((x) => x.anchor === anchor);
        if (s) {
          saveSentence(g, s);
          return;
        }
      }
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
</script>

<div class="editor">
  <p class="legend">
    각 한자 문장에 대응하는 한글 본문을 입력하세요. 포커스가 빠지면 자동 저장 (Ctrl/⌘+S로 즉시 저장).
    <strong>검수 완료</strong>는 매핑 확정 표시입니다.
  </p>

  {#each localGroups as g (g.num)}
    <section class="group">
      <header class="group-head">
        <h2>{g.num}절</h2>
        <span class="group-meta">
          {g.sentences.length}문장
          {#if g.sentences.length > 1}
            <span class="badge multi">1:N</span>
          {/if}
        </span>
      </header>

      {#each g.sentences as s, i (s.anchor)}
        <article class="sentence" class:unmapped={!s.hangeul} class:reviewed={s.reviewed}>
          <div class="anchor-col">
            <code>^{s.anchor}</code>
            <span class="ix">{i + 1}/{g.sentences.length}</span>
          </div>
          <div class="hanja">{s.hanja}</div>
          <div class="hangeul-wrap">
            <textarea
              data-anchor={s.anchor}
              value={s.hangeul}
              on:input={(ev) => handleHangeulInput(g, s, ev)}
              on:blur={() => handleHangeulBlur(g, s)}
              placeholder="한글 번역을 입력…"
              rows={Math.max(2, Math.ceil(s.hangeul.length / 60) || 2)}
            ></textarea>
            <div class="row-foot">
              <label class="reviewed-toggle">
                <input
                  type="checkbox"
                  checked={s.reviewed}
                  on:change={() => toggleReviewed(g, s)}
                />
                검수 완료
              </label>
              <span class="status" class:ok={saveState[s.anchor] === "saved"} class:err={saveState[s.anchor] === "error"}>
                {statusLabel(saveState[s.anchor] ?? "idle")}
              </span>
              {#if saveState[s.anchor] === "error"}
                <span class="err-msg">{saveError[s.anchor] ?? ""}</span>
              {/if}
            </div>
          </div>
        </article>
      {/each}
    </section>
  {/each}
</div>

<style>
  .editor {
    font-size: 0.92rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }
  .legend {
    margin: 0 0 0.4rem;
    padding: 0.5rem 0.7rem;
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    font-size: 0.82rem;
    color: var(--color-muted);
  }
  .group {
    border: 1px solid var(--color-rule);
    border-radius: 8px;
    background: var(--color-bg);
    overflow: hidden;
  }
  .group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.55rem 0.85rem;
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-rule);
  }
  .group-head h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--color-primary);
  }
  .group-meta {
    font-size: 0.78rem;
    color: var(--color-muted);
  }
  .badge.multi {
    margin-left: 0.4rem;
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--color-primary);
    color: var(--color-primary);
    border-radius: 999px;
    font-size: 0.7rem;
  }
  .sentence {
    display: grid;
    grid-template-columns: 7em 1fr 1.2fr;
    gap: 0.7rem;
    padding: 0.65rem 0.85rem;
    border-top: 1px solid var(--color-rule);
    align-items: start;
  }
  .sentence:first-of-type { border-top: none; }
  .sentence.unmapped {
    background: #fff7ed;
  }
  .sentence.reviewed .anchor-col code {
    background: var(--color-primary);
    color: var(--color-bg);
    border-color: var(--color-primary);
  }
  .anchor-col {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  .anchor-col code {
    padding: 0.1rem 0.3rem;
    border: 1px solid var(--color-rule);
    border-radius: 3px;
    background: var(--color-bg);
  }
  .anchor-col .ix {
    font-size: 0.68rem;
    color: var(--color-muted);
  }
  .hanja {
    background: #e8d8b8;
    color: #2a221a;
    padding: 0.5rem 0.7rem;
    border-radius: 5px;
    font-size: 0.92em;
    line-height: 1.65;
  }
  @media (prefers-color-scheme: dark) {
    .hanja {
      background: #2c2418;
      color: #f0e6d0;
    }
    .sentence.unmapped {
      background: #382c1a;
    }
  }
  .hangeul-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  textarea {
    width: 100%;
    min-height: 3.5em;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    font-size: 0.93rem;
    line-height: 1.6;
    resize: vertical;
  }
  textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-bg);
  }
  .row-foot {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
    font-size: 0.78rem;
  }
  .reviewed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
    color: var(--color-fg);
  }
  .status {
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }
  .status.ok { color: var(--color-secondary); }
  .status.err { color: var(--color-primary); }
  .err-msg {
    color: var(--color-primary);
    font-size: 0.74rem;
  }
</style>
