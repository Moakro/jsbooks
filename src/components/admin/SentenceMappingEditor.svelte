<script lang="ts">
  /**
   * 천지개벽경 canonical-mapping v2 통합 편집기.
   *
   * v1 ChapterEditor의 인라인 textarea UX + v2 sentence-string 모델.
   *
   * 각 sentence row:
   *   [^anchor]  [한자 textarea]  [한글 textarea]  [☐ 시구]  [🗑]
   * sentence 사이에 [+ 새 sentence] 버튼.
   *
   * 사용자 의도:
   *   - 분리: 한자 textarea 안에서 자른 뒤 + 새 sentence → 둘째에 후반부 붙여넣기
   *   - 합치기: 둘째 sentence 텍스트를 첫 sentence 끝에 붙이고 둘째 🗑
   *   - 삭제: 🗑 클릭
   *   - 시구: 체크박스
   * 모두 dirty 상태로만 표시 후 우상단 저장 버튼으로 일괄 처리.
   *
   * 저장 흐름:
   *   POST /api/admin/chapter/save-v2 단 1회 fetch.
   *   서버가 한자 markdown + 매핑 JSON + 한글본 백업을 동기 갱신 + 백업 자동.
   *   응답의 groups·new_anchors로 localGroups 갱신, snapshot rebuild.
   */
  import { onMount } from "svelte";
  import { showSnackbar } from "../../lib/admin-snackbar";

  type Sentence = {
    /** 마운트 또는 저장 시점의 anchor — 없으면 신규 sentence. 저장 후 서버가 새 anchor 부여. */
    originalAnchor: string | null;
    /** 표시용 임시 anchor (저장 전 라벨). 저장 후 originalAnchor로 동기화. */
    displayAnchor: string;
    hanja: string;
    hangeul: string;
    isVerse: boolean;
    /** 클라이언트만의 row id — 새 sentence 식별용 (originalAnchor 없을 때). */
    rowId: number;
  };
  type Group = { num: number; sentences: { anchor: string; hanja: string; hangeul: string; isVerse: boolean; reviewed?: boolean }[] };

  export let groups: Group[];
  export let vol: number;
  export let chap: number;

  let nextRowId = 1;
  function makeRow(s: {
    anchor: string;
    hanja: string;
    hangeul: string;
    isVerse: boolean;
  }): Sentence {
    return {
      originalAnchor: s.anchor,
      displayAnchor: s.anchor,
      hanja: s.hanja,
      hangeul: s.hangeul,
      isVerse: s.isVerse,
      rowId: nextRowId++,
    };
  }
  function makeEmptyRow(): Sentence {
    return {
      originalAnchor: null,
      displayAnchor: "new",
      hanja: "",
      hangeul: "",
      isVerse: false,
      rowId: nextRowId++,
    };
  }

  // localSentences는 평면 모델이라 단일 배열로 충분 (groups의 num=1 단일 그룹)
  let localSentences: Sentence[] = [];
  for (const g of groups) {
    for (const s of g.sentences) localSentences.push(makeRow(s));
  }

  // snapshot: 마지막 저장 시점의 상태 (rowId → fields). 새 row(originalAnchor=null)는
  // snapshot에 없음 → 항상 dirty로 표시.
  type Snap = { hanja: string; hangeul: string; isVerse: boolean; originalAnchor: string | null };
  let snapshot: Record<number, Snap> = {};
  let snapshotOrder: number[] = [];
  function rebuildSnapshot() {
    const next: Record<number, Snap> = {};
    const order: number[] = [];
    for (const s of localSentences) {
      next[s.rowId] = {
        hanja: s.hanja,
        hangeul: s.hangeul,
        isVerse: s.isVerse,
        originalAnchor: s.originalAnchor,
      };
      order.push(s.rowId);
    }
    snapshot = next;
    snapshotOrder = order;
  }
  rebuildSnapshot();

  // row별 dirty 여부 — snapshot과 비교
  function isRowDirty(s: Sentence): boolean {
    const snap = snapshot[s.rowId];
    if (!snap) return true; // 새 row (snapshot에 없음)
    return (
      snap.hanja !== s.hanja ||
      snap.hangeul !== s.hangeul ||
      snap.isVerse !== s.isVerse
    );
  }
  // 전체 dirty: row 변경 + 순서 변경 + row 삭제
  $: dirtyCount = (() => {
    let n = 0;
    for (const s of localSentences) if (isRowDirty(s)) n++;
    // 순서·삭제 변화
    const curOrder = localSentences.map((s) => s.rowId);
    const orderChanged =
      curOrder.length !== snapshotOrder.length ||
      curOrder.some((id, i) => id !== snapshotOrder[i]);
    if (orderChanged && n === 0) n = 1; // 정리/이동만 있을 때도 dirty 1건으로
    return n;
  })();

  let saving = false;

  // ─── row 조작 ─────────────────────────────────────────────────────────────
  function updateHanja(i: number, ev: Event) {
    const t = (ev.target as HTMLTextAreaElement).value;
    localSentences[i] = { ...localSentences[i], hanja: t };
    localSentences = [...localSentences];
  }
  function updateHangeul(i: number, ev: Event) {
    const t = (ev.target as HTMLTextAreaElement).value;
    localSentences[i] = { ...localSentences[i], hangeul: t };
    localSentences = [...localSentences];
  }
  function toggleVerse(i: number) {
    localSentences[i] = { ...localSentences[i], isVerse: !localSentences[i].isVerse };
    localSentences = [...localSentences];
  }
  function deleteRow(i: number) {
    if (!confirm(`${i + 1}번 sentence를 삭제하시겠습니까? (저장 버튼 클릭 시 vault에 적용)`)) return;
    localSentences = [...localSentences.slice(0, i), ...localSentences.slice(i + 1)];
  }
  function insertRowAt(at: number) {
    const fresh = makeEmptyRow();
    localSentences = [...localSentences.slice(0, at), fresh, ...localSentences.slice(at)];
    // 새로 추가된 row의 한자 textarea로 포커스 이동
    requestAnimationFrame(() => {
      const ta = document.querySelector(
        `textarea[data-row-id="${fresh.rowId}"][data-kind="hanja"]`,
      ) as HTMLTextAreaElement | null;
      ta?.focus();
    });
  }

  // ─── textarea auto-grow ─────────────────────────────────────────────────
  function autosize(ta: HTMLTextAreaElement) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }
  function autosizeInit(node: HTMLTextAreaElement) {
    requestAnimationFrame(() => autosize(node));
    setTimeout(() => autosize(node), 200);
    return {
      update() {
        requestAnimationFrame(() => autosize(node));
      },
    };
  }

  // ─── 저장 ────────────────────────────────────────────────────────────────
  async function saveAll() {
    if (saving) return;
    if (dirtyCount === 0) {
      showSnackbar("변경 사항 없음", "info", 1500);
      return;
    }
    // 빈 hanja sentence는 자동 제외 (서버도 동일 처리하지만 명시적으로 사용자에게 표시)
    const usable = localSentences.filter((s) => s.hanja.trim());
    const dropped = localSentences.length - usable.length;
    if (usable.length === 0) {
      if (!confirm("저장할 sentence가 없습니다. 정말 모두 비우시겠습니까?")) return;
    }
    saving = true;
    try {
      const res = await fetch("/api/admin/chapter/save-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vol,
          chap,
          sentences: usable.map((s) => ({
            hanja: s.hanja.trim(),
            hangeul: s.hangeul.trim(),
            isVerse: s.isVerse,
            originalAnchor: s.originalAnchor,
          })),
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? "save failed");
      // 응답의 새 anchor로 localSentences 갱신 (groups 전체 재구성보다 row identity 보존)
      const newAnchors: string[] = Array.isArray(out.new_anchors) ? out.new_anchors : [];
      const used = usable;
      const updated: Sentence[] = [];
      for (let i = 0; i < used.length; i++) {
        const anc = newAnchors[i] ?? used[i].originalAnchor ?? `${vol}-${chap}-${i + 1}`;
        updated.push({
          ...used[i],
          originalAnchor: anc,
          displayAnchor: anc,
        });
      }
      localSentences = updated;
      rebuildSnapshot();
      const droppedMsg = dropped > 0 ? ` (빈 ${dropped}건 제외)` : "";
      const migCount = out.migrations ? Object.keys(out.migrations).length : 0;
      showSnackbar(
        `${updated.length}건 저장 완료${droppedMsg} · anchor 이관 ${migCount}`,
        "success",
        2500,
      );
    } catch (e: any) {
      showSnackbar(`저장 실패: ${e?.message ?? String(e)}`, "error", 4000);
    } finally {
      saving = false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      saveAll();
    }
  }
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (dirtyCount > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  }

  onMount(() => {
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  });
</script>

<div class="editor">
  <div class="toolbar" class:has-dirty={dirtyCount > 0}>
    <button
      type="button"
      class="save-all"
      class:active={dirtyCount > 0}
      on:click={saveAll}
      disabled={dirtyCount === 0 || saving}
      title="Cmd/Ctrl+S"
    >
      {saving ? "저장 중…" : `💾 저장 ${dirtyCount > 0 ? `(${dirtyCount})` : ""}`}
    </button>
    <span class="toolbar-hint">
      {#if dirtyCount > 0}
        변경 {dirtyCount}건 — Cmd/Ctrl+S
      {:else}
        변경 사항 없음
      {/if}
    </span>
    <span class="toolbar-meta">
      sentence {localSentences.length}건
    </span>
  </div>

  <p class="legend">
    한자/한글 textarea 인라인 편집. <strong>분리</strong>: 한자 안에서 자른 뒤 <code class="lex">+</code> 새 sentence → 둘째에 후반부 붙여넣기.
    <strong>합치기</strong>: 둘째 텍스트를 첫 sentence 끝에 붙이고 둘째 🗑. <strong>시구</strong> 체크 시 markdown에 <code class="lex">&gt; </code> 접두사 추가.
    저장 = 검수 완료 자동.
  </p>

  <button type="button" class="insert-line top" on:click={() => insertRowAt(0)}>+ 맨 앞에 새 sentence</button>

  {#each localSentences as s, i (s.rowId)}
    <div class="row" class:dirty={isRowDirty(s)} class:new={!s.originalAnchor} class:verse-mark={s.isVerse}>
      <div class="anchor-col">
        <code class="anchor-pill" class:unmapped={!s.hangeul.trim()}>^{s.displayAnchor}</code>
        <span class="idx">{i + 1}</span>
        {#if isRowDirty(s)}
          <span class="dirty-dot" title="변경됨 — 저장 필요">●</span>
        {/if}
      </div>

      <div class="hanja-wrap">
        <textarea
          class="hanja"
          data-row-id={s.rowId}
          data-kind="hanja"
          value={s.hanja}
          on:input={(ev) => { updateHanja(i, ev); autosize(ev.currentTarget as HTMLTextAreaElement); }}
          on:focus={(ev) => autosize(ev.currentTarget as HTMLTextAreaElement)}
          use:autosizeInit
          placeholder="한자 본문 (`>` 없이 — 시구는 체크박스로)"
          rows={2}
        ></textarea>
      </div>

      <div class="hangeul-wrap">
        <textarea
          class="hangeul"
          data-row-id={s.rowId}
          data-kind="hangeul"
          value={s.hangeul}
          on:input={(ev) => { updateHangeul(i, ev); autosize(ev.currentTarget as HTMLTextAreaElement); }}
          on:focus={(ev) => autosize(ev.currentTarget as HTMLTextAreaElement)}
          use:autosizeInit
          placeholder="한글 번역"
          rows={2}
        ></textarea>
      </div>

      <div class="row-actions">
        <label class="verse-toggle" title="시구 markup (markdown `> ` prefix)">
          <input type="checkbox" checked={s.isVerse} on:change={() => toggleVerse(i)} />
          📜
        </label>
        <button
          type="button"
          class="trash"
          title="이 sentence 삭제 (저장 시 vault에 적용)"
          on:click={() => deleteRow(i)}
        >🗑</button>
      </div>
    </div>

    <button type="button" class="insert-line" on:click={() => insertRowAt(i + 1)}>+ 새 sentence</button>
  {/each}

  {#if localSentences.length === 0}
    <p class="empty">sentence가 없습니다. 위의 "+ 맨 앞에 새 sentence"로 추가하세요.</p>
  {/if}
</div>

<style>
  .editor {
    font-size: 0.92rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .toolbar {
    position: fixed;
    top: 0.7rem;
    right: 1rem;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.65rem;
    background: var(--color-bg, #fbf8f4);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    font-size: 0.85rem;
  }
  .toolbar.has-dirty {
    border-color: var(--color-primary);
    box-shadow: 0 2px 10px rgba(168, 53, 42, 0.22);
  }
  .save-all {
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-bg);
    color: var(--color-fg);
    cursor: pointer;
    font-weight: 600;
    font-size: 0.88rem;
  }
  @media (max-width: 640px) {
    .toolbar { top: 0.5rem; right: 0.5rem; }
    .toolbar-hint, .toolbar-meta { display: none; }
  }
  .save-all.active {
    background: var(--color-primary);
    color: var(--color-bg);
    border-color: var(--color-primary);
  }
  .save-all:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .toolbar-hint {
    flex: 1;
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .toolbar-meta {
    font-size: 0.78rem;
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
  }

  .legend {
    margin: 0 0 0.5rem;
    padding: 0.45rem 0.7rem;
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--color-muted);
    line-height: 1.55;
  }
  .legend .lex {
    padding: 0 0.25rem;
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 3px;
    font-size: 0.76rem;
  }

  .row {
    display: grid;
    grid-template-columns: 5.5em 1fr 1.2fr 4.5em;
    gap: 0.5rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    background: var(--color-bg);
    align-items: start;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .row.dirty {
    border-color: #b45309;
    background: rgba(245, 158, 11, 0.04);
  }
  .row.new {
    border-style: dashed;
    border-color: var(--color-secondary);
    background: var(--color-secondary-bg);
  }
  .row.verse-mark .hanja-wrap textarea {
    border-left: 4px solid var(--color-secondary);
    padding-left: 0.6rem;
  }

  .anchor-col {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    align-items: flex-start;
    font-family: ui-monospace, monospace;
  }
  .anchor-pill {
    display: inline-block;
    padding: 0.12rem 0.45rem;
    font-size: 0.7rem;
    border-radius: 999px;
    background: var(--color-primary);
    color: var(--color-bg);
    border: 1px solid var(--color-primary);
    white-space: nowrap;
  }
  .anchor-pill.unmapped {
    background: #fff;
    color: var(--color-primary);
  }
  .row.new .anchor-pill {
    background: var(--color-secondary);
    border-color: var(--color-secondary);
    color: var(--color-bg);
  }
  .anchor-col .idx {
    font-size: 0.7rem;
    color: var(--color-muted);
  }
  .dirty-dot {
    font-size: 0.85rem;
    color: #b45309;
    line-height: 1;
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
    font-size: 0.92rem;
    line-height: 1.55;
    resize: none;
    overflow: hidden;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  textarea.hanja {
    background: #e8d8b8;
    color: #2a221a;
  }
  textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-bg);
  }
  @media (prefers-color-scheme: dark) {
    textarea.hanja { background: #2c2418; color: #f0e6d0; }
    .anchor-pill.unmapped { background: #f4ece2; color: var(--color-primary); }
  }

  .row-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
  }
  .verse-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-bg);
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--color-fg);
    user-select: none;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .verse-toggle:has(input:checked) {
    background: var(--color-secondary-bg);
    border-color: var(--color-secondary);
    color: var(--color-secondary);
  }
  .trash {
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-bg);
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .trash:hover {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #dc2626;
  }

  .insert-line {
    display: block;
    width: 100%;
    padding: 0.25rem 0.5rem;
    border: 1px dashed var(--color-rule);
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.75rem;
    margin: 0.15rem 0;
    transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  }
  .insert-line:hover {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .insert-line.top {
    margin-top: 0.4rem;
  }

  .empty {
    text-align: center;
    color: var(--color-muted);
    font-size: 0.88rem;
    padding: 1.5rem;
    border: 1px dashed var(--color-rule);
    border-radius: 6px;
  }
</style>
