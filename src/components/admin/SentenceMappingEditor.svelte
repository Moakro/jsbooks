<script lang="ts">
  /**
   * 천지개벽경 canonical-mapping v2 sentence-string 편집기.
   *
   *   - 한자 sentence 별 textarea로 한글 string 입력 → /api/admin/canonical-mapping/save-sentence
   *   - sentence 구조 조작 액션 4종 (dev plugin endpoint 호출):
   *       · merge-with-prev: 직전 sentence와 합치고 현재 anchor 제거
   *       · drop: 현재 sentence 제거 + 이후 anchor -1 시프트
   *       · split-into-sub: 현재 sentence를 컨테이너(^X-Y-Z) + sub(^X-Y-Z.N)로 분리
   *       · toggle-verse: 한자 markdown에 `> ` 접두사 toggle
   *     각 액션은 vault markdown을 직접 수정하므로 호출 직전 .bak/<ts>/에 자동 백업.
   *     액션 성공 시 페이지 reload로 변경 사항 반영.
   */
  import { onMount } from "svelte";
  import { confirmDialog } from "../../lib/confirmDialog";
  import { showSnackbar } from "../../lib/admin-snackbar";

  type Sentence = {
    anchor: string;
    hanja: string;
    hangeul: string;
    reviewed: boolean;
    isVerse: boolean;
  };
  type Group = { num: number; sentences: Sentence[] };

  export let groups: Group[];
  export let vol: number;
  export let chap: number;

  let localGroups: Group[] = groups.map((g) => ({
    num: g.num,
    sentences: g.sentences.map((s) => ({ ...s })),
  }));

  type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
  let saveState: Record<string, SaveState> = {};
  let saveError: Record<string, string> = {};

  // 액션 진행 상태: anchor → action label (예: "삭제 중…")
  let actionStatus: Record<string, string> = {};
  let actionError: Record<string, string> = {};

  // split 모달 상태
  let splitModalAnchor: string | null = null;
  let splitContainerText = "";
  let splitSubTexts: { text: string; isVerse: boolean }[] = [];

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
      showSnackbar(`^${sentence.anchor} 저장됨`, "success", 1800);
      setTimeout(() => {
        if (saveState[sentence.anchor] === "saved") {
          saveState = { ...saveState, [sentence.anchor]: "idle" };
        }
      }, 1500);
    } catch (e: any) {
      saveState = { ...saveState, [sentence.anchor]: "error" };
      saveError = { ...saveError, [sentence.anchor]: e?.message ?? String(e) };
      showSnackbar(`저장 실패 ^${sentence.anchor}: ${e?.message ?? String(e)}`, "error");
    }
  }

  function toggleReviewed(group: Group, sentence: Sentence) {
    sentence.reviewed = !sentence.reviewed;
    localGroups = [...localGroups];
    markDirty(sentence.anchor);
  }

  function handleHangeulInput(group: Group, sentence: Sentence, ev: Event) {
    const t = (ev.target as HTMLTextAreaElement).value;
    sentence.hangeul = t;
    localGroups = [...localGroups];
    markDirty(sentence.anchor);
  }

  function handleHangeulBlur(_group: Group, _sentence: Sentence) {
    // 자동 저장 폐기. dirty 상태만 표시하고 상단 저장 버튼으로 명시적 저장.
  }

  // dirty 상태인 sentence 수
  $: dirtyCount = Object.values(saveState).filter((s) => s === "dirty" || s === "error").length;

  async function saveAllDirty() {
    const targets: { group: Group; sentence: Sentence }[] = [];
    for (const g of localGroups) {
      for (const s of g.sentences) {
        const st = saveState[s.anchor];
        if (st === "dirty" || st === "error") targets.push({ group: g, sentence: s });
      }
    }
    if (targets.length === 0) {
      showSnackbar("변경 사항 없음", "info", 1500);
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const { group, sentence } of targets) {
      try {
        await saveSentence(group, sentence);
        if (saveState[sentence.anchor] === "saved" || saveState[sentence.anchor] === "idle") ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    if (fail === 0) {
      showSnackbar(`${ok}건 저장 완료`, "success", 2200);
    } else {
      showSnackbar(`${ok}건 저장, ${fail}건 실패`, "error", 3500);
    }
  }

  function statusLabel(s: SaveState): string {
    if (s === "saving") return "저장 중…";
    if (s === "saved") return "✓ 저장됨";
    if (s === "dirty") return "● 변경됨 — 상단 저장 버튼으로 저장";
    if (s === "error") return "⚠ 오류";
    return "";
  }

  // ─── textarea auto-grow ─────────────────────────────────────────────────
  function autosize(ta: HTMLTextAreaElement) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }
  function autosizeInit(node: HTMLTextAreaElement) {
    // 초기 마운트 시 1회 + 폰트 로드 후 한번 더 (한글 폰트 늦게 로드되면 height 부족 가능)
    requestAnimationFrame(() => autosize(node));
    setTimeout(() => autosize(node), 200);
    return {};
  }

  function onKeyDown(e: KeyboardEvent) {
    // Cmd/Ctrl+S → dirty 항목 일괄 저장
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      saveAllDirty();
      return;
    }
    if (e.key === "Escape" && splitModalAnchor) {
      closeSplitModal();
    }
  }

  // 페이지 떠나기 전 dirty 있으면 경고
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (dirtyCount > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  }

  // ─── Action handlers ─────────────────────────────────────────────────────
  /**
   * endpoint 호출 후 응답의 groups로 localGroups를 inline 갱신. 페이지 reload 없음.
   * 성공 메시지는 호출부에서 showSnackbar로 직접 띄움.
   */
  async function callAction(
    endpoint: string,
    body: Record<string, unknown>,
    anchor: string,
    label: string,
  ): Promise<any> {
    actionStatus = { ...actionStatus, [anchor]: label };
    actionError = { ...actionError, [anchor]: "" };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? `${endpoint} failed`);
      // 서버가 응답에 새 groups를 보내주면 localGroups를 그것으로 교체 (inline 갱신, reload 없음)
      if (Array.isArray(out?.groups)) {
        localGroups = out.groups.map((g: Group) => ({
          num: g.num,
          sentences: g.sentences.map((s) => ({ ...s })),
        }));
      }
      // 기존 액션 상태 표시는 cleanup (해당 anchor가 사라졌을 수 있음)
      delete actionStatus[anchor];
      actionStatus = { ...actionStatus };
      return out;
    } catch (e: any) {
      actionStatus = { ...actionStatus, [anchor]: "오류" };
      actionError = { ...actionError, [anchor]: e?.message ?? String(e) };
      showSnackbar(`오류: ${e?.message ?? String(e)}`, "error");
      return null;
    }
  }

  async function doMergeWithPrev(s: Sentence) {
    const ok = await confirmDialog({
      title: "직전 sentence와 합치기",
      message: `^${s.anchor} 을(를) 직전 sentence와 합치고 anchor를 제거합니다. 한자 markdown + canonical-mapping JSON + 한글본 백업이 함께 수정됩니다. 계속할까요?`,
      confirmLabel: "합치기",
      danger: true,
    });
    if (!ok) return;
    const out = await callAction(
      "/api/admin/sentence/merge-with-prev",
      { vol, chap, anchor: s.anchor },
      s.anchor,
      "합치는 중…",
    );
    if (out) showSnackbar(`^${s.anchor}를 ^${out.merged_into}와 합쳤습니다 (anchor 제거)`, "success");
  }

  async function doDrop(s: Sentence) {
    const ok = await confirmDialog({
      title: "sentence 삭제",
      message: `^${s.anchor} 을(를) 영구 삭제합니다. 같은 장 안에서 이후 anchor가 한 칸씩 시프트됩니다(한자 markdown + canonical-mapping JSON + 한글본 백업 동시 갱신). 계속할까요?`,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    const out = await callAction("/api/admin/sentence/drop", { vol, chap, anchor: s.anchor }, s.anchor, "삭제 중…");
    if (out) showSnackbar(`^${s.anchor} 삭제 및 이후 anchor 시프트 완료`, "success");
  }

  async function doToggleVerse(s: Sentence) {
    const verb = s.isVerse ? "시구 표시 해제" : "시구 표시 추가";
    const out = await callAction(
      "/api/admin/sentence/toggle-verse",
      { vol, chap, anchor: s.anchor },
      s.anchor,
      `${verb} 중…`,
    );
    if (out) {
      const verb2 = out.isVerse ? "시구 markup 추가" : "시구 markup 제거";
      showSnackbar(`^${s.anchor}: ${verb2}`, "success");
    }
  }

  function openSplitModal(s: Sentence) {
    splitModalAnchor = s.anchor;
    splitContainerText = s.hanja;
    splitSubTexts = [
      { text: "", isVerse: true },
      { text: "", isVerse: true },
    ];
  }
  function closeSplitModal() {
    splitModalAnchor = null;
    splitContainerText = "";
    splitSubTexts = [];
  }
  function addSubLine() {
    splitSubTexts = [...splitSubTexts, { text: "", isVerse: true }];
  }
  function removeSubLine(idx: number) {
    splitSubTexts = splitSubTexts.filter((_, i) => i !== idx);
  }
  async function submitSplit() {
    if (!splitModalAnchor) return;
    const subs = splitSubTexts.filter((s) => s.text.trim());
    if (subs.length === 0) {
      alert("sub 텍스트가 1개 이상 필요합니다.");
      return;
    }
    if (!splitContainerText.trim()) {
      alert("컨테이너(도입부) 텍스트가 비어 있습니다.");
      return;
    }
    const anchor = splitModalAnchor;
    closeSplitModal();
    const out = await callAction(
      "/api/admin/sentence/split-into-sub",
      {
        vol,
        chap,
        anchor,
        container_text: splitContainerText,
        sub_texts: subs.map((s) => s.text),
        are_verses: subs.map((s) => s.isVerse),
      },
      anchor,
      "분리 중…",
    );
    if (out) {
      showSnackbar(
        `^${anchor}를 컨테이너 + sub ${out.subs?.length ?? 0}개로 분리 완료`,
        "success",
      );
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
      on:click={saveAllDirty}
      disabled={dirtyCount === 0}
      title="Cmd/Ctrl+S"
    >
      💾 저장 {dirtyCount > 0 ? `(${dirtyCount})` : ""}
    </button>
    <span class="toolbar-hint">
      {#if dirtyCount > 0}
        변경 {dirtyCount}건 — 저장 버튼 또는 Cmd/Ctrl+S
      {:else}
        변경 사항 없음
      {/if}
    </span>
  </div>

  <p class="legend">
    한글 textarea에 입력 후 상단 <strong>저장</strong> 버튼(또는 Cmd/Ctrl+S)으로 일괄 저장합니다.
    상태 라벨: <code class="lex">●</code> 변경 / <code class="lex">…</code> 저장 중 / <code class="lex">✓</code> 저장됨.
    <strong>검수 완료</strong>는 매핑 확정 표시. 액션 버튼은 한자 markdown + 매핑 JSON + 한글본 백업을 함께 수정합니다 (백업 자동).
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
        <article class="sentence" class:unmapped={!s.hangeul} class:reviewed={s.reviewed} class:verse-mark={s.isVerse}>
          <div class="hanja">
            <span class="anchor-pill" class:reviewed={s.reviewed} title={`${i + 1}/${g.sentences.length}`}>
              <code>^{s.anchor}</code>
              {#if s.isVerse}<span class="vmark" title="시구 (blockquote)">📜</span>{/if}
            </span>
            <span class="hanja-text">{s.hanja}</span>
          </div>
          <div class="hangeul-wrap">
            <textarea
              data-anchor={s.anchor}
              value={s.hangeul}
              on:input={(ev) => { handleHangeulInput(g, s, ev); autosize(ev.currentTarget as HTMLTextAreaElement); }}
              on:focus={(ev) => autosize(ev.currentTarget as HTMLTextAreaElement)}
              on:blur={() => handleHangeulBlur(g, s)}
              use:autosizeInit
              placeholder="한글 번역을 입력…"
              rows={2}
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
              <span
                class="status"
                class:dirty={saveState[s.anchor] === "dirty"}
                class:saving={saveState[s.anchor] === "saving"}
                class:ok={saveState[s.anchor] === "saved"}
                class:err={saveState[s.anchor] === "error"}
              >
                {statusLabel(saveState[s.anchor] ?? "idle")}
              </span>
              {#if saveState[s.anchor] === "error"}
                <span class="err-msg">{saveError[s.anchor] ?? ""}</span>
              {/if}
            </div>
            <div class="actions">
              <button
                type="button"
                class="act"
                title="직전 sentence와 합치기 (anchor 제거)"
                disabled={!localGroups[0] || (localGroups[0].sentences[0]?.anchor === s.anchor)}
                on:click={() => doMergeWithPrev(s)}
              >
                ⬆ 합치기
              </button>
              <button
                type="button"
                class="act danger"
                title="sentence 삭제 (이후 anchor 시프트)"
                on:click={() => doDrop(s)}
              >
                🗑 삭제
              </button>
              <button
                type="button"
                class="act"
                title="sub-anchor로 분리 (컨테이너 + sub들)"
                on:click={() => openSplitModal(s)}
              >
                ✂️ 분리
              </button>
              <button
                type="button"
                class="act"
                class:toggled={s.isVerse}
                title="시구 markup toggle (> blockquote)"
                on:click={() => doToggleVerse(s)}
              >
                {s.isVerse ? "📜 시구 해제" : "📜 시구"}
              </button>
              {#if actionStatus[s.anchor]}
                <span class="act-status" class:err={actionStatus[s.anchor] === "오류"}>
                  {actionStatus[s.anchor]}
                </span>
                {#if actionError[s.anchor]}
                  <span class="err-msg">{actionError[s.anchor]}</span>
                {/if}
              {/if}
            </div>
          </div>
        </article>
      {/each}
    </section>
  {/each}
</div>

{#if splitModalAnchor}
  <div class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal">
      <header>
        <h3>^{splitModalAnchor} 을(를) 컨테이너 + sub로 분리</h3>
        <button type="button" class="x" on:click={closeSplitModal} aria-label="닫기">✕</button>
      </header>
      <div class="modal-body">
        <label>
          <span>컨테이너(도입부) 텍스트</span>
          <textarea bind:value={splitContainerText} rows={2} placeholder="예: 大哉라"></textarea>
        </label>
        <div class="subs">
          <p class="sub-head">Sub 줄 (^{splitModalAnchor}.N) — 시구 체크 시 `> ` 접두사 추가</p>
          {#each splitSubTexts as sub, i}
            <div class="sub-row">
              <span class="sub-idx">.{i + 1}</span>
              <textarea bind:value={sub.text} rows={2} placeholder="sub 줄 텍스트"></textarea>
              <label class="vchk">
                <input type="checkbox" bind:checked={sub.isVerse} />
                시구
              </label>
              <button type="button" class="x" on:click={() => removeSubLine(i)} aria-label="제거">✕</button>
            </div>
          {/each}
          <button type="button" class="add-sub" on:click={addSubLine}>+ sub 줄 추가</button>
        </div>
      </div>
      <footer>
        <button type="button" class="cancel" on:click={closeSplitModal}>취소</button>
        <button type="button" class="primary" on:click={submitSplit}>분리 실행</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .editor {
    font-size: 0.92rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.8rem;
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    margin-bottom: -0.4rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  .toolbar.has-dirty {
    border-color: var(--color-primary);
    background: var(--color-primary-bg, #fbeae6);
  }
  .save-all {
    padding: 0.45rem 0.95rem;
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    background: var(--color-surface-2);
    color: var(--color-muted);
    cursor: not-allowed;
    font-size: 0.95rem;
    font-weight: 600;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .save-all.active {
    background: var(--color-primary, #a8352a);
    color: #fff;
    border-color: var(--color-primary, #a8352a);
    cursor: pointer;
  }
  .save-all.active:hover {
    filter: brightness(1.08);
  }
  .save-all:disabled {
    opacity: 0.6;
  }
  .toolbar-hint {
    color: var(--color-muted);
    font-size: 0.85rem;
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
  .legend .lex {
    padding: 0 0.25rem;
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 3px;
    font-size: 0.78rem;
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
  .group-meta { font-size: 0.78rem; color: var(--color-muted); }
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
    grid-template-columns: 1fr 1.2fr;
    gap: 0.7rem;
    padding: 0.65rem 0.85rem;
    border-top: 1px solid var(--color-rule);
    align-items: start;
  }
  .sentence:first-of-type { border-top: none; }
  .sentence.unmapped { background: #fff7ed; }
  .sentence.verse-mark .hanja {
    border-left: 4px solid var(--color-secondary);
    padding-left: 0.55rem;
  }
  .hanja {
    position: relative;
    background: #e8d8b8;
    color: #2a221a;
    padding: 1.6rem 0.7rem 0.55rem;
    border-radius: 5px;
    font-size: 0.92em;
    line-height: 1.65;
  }
  .anchor-pill {
    position: absolute;
    top: 0.35rem;
    right: 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    line-height: 1;
    color: var(--color-primary);
    padding: 0.12rem 0.4rem;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.6);
  }
  .anchor-pill code {
    background: transparent;
    padding: 0;
    border: 0;
    font-size: inherit;
  }
  .anchor-pill.reviewed {
    background: var(--color-primary);
    color: var(--color-bg);
    border-color: var(--color-primary);
  }
  .anchor-pill .vmark { font-size: 0.78rem; }
  .hanja-text { display: block; }
  @media (prefers-color-scheme: dark) {
    .hanja { background: #2c2418; color: #f0e6d0; }
    .anchor-pill { background: rgba(0, 0, 0, 0.3); }
    .sentence.unmapped { background: #382c1a; }
  }
  .hangeul-wrap { display: flex; flex-direction: column; gap: 0.3rem; }
  textarea {
    width: 100%;
    min-height: 3.2em;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    background: var(--color-bg);
    color: var(--color-fg);
    font: inherit;
    font-size: 0.93rem;
    line-height: 1.6;
    resize: none;
    overflow: hidden;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
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
    font-size: 0.74rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .status.dirty { color: #b45309; background: rgba(180, 83, 9, 0.1); }
  .status.saving { color: var(--color-secondary); background: var(--color-secondary-bg); }
  .status.ok { color: var(--color-secondary); background: var(--color-secondary-bg); font-weight: 600; }
  .status.err { color: var(--color-primary); background: var(--color-primary-bg); font-weight: 600; }
  .err-msg { color: var(--color-primary); font-size: 0.74rem; }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
    font-size: 0.78rem;
  }
  .act {
    padding: 0.18rem 0.5rem;
    border: 1px solid var(--color-rule);
    background: var(--color-bg);
    color: var(--color-fg);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.78rem;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .act:hover:not(:disabled) {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
    color: var(--color-primary);
  }
  .act:disabled { opacity: 0.4; cursor: not-allowed; }
  .act.danger:hover {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #dc2626;
  }
  .act.toggled {
    background: var(--color-secondary-bg);
    border-color: var(--color-secondary);
    color: var(--color-secondary);
  }
  .act-status {
    font-size: 0.72rem;
    color: var(--color-muted);
    margin-left: 0.2rem;
  }
  .act-status.err { color: var(--color-primary); }

  /* ─ modal ───────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal {
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 8px;
    max-width: 720px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }
  .modal header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--color-rule);
    background: var(--color-surface-2);
  }
  .modal header h3 { margin: 0; flex: 1; font-size: 1rem; color: var(--color-primary); }
  .modal .x {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-muted);
    font-size: 1rem;
    padding: 0.2rem 0.4rem;
  }
  .modal .x:hover { color: var(--color-fg); }
  .modal-body {
    padding: 0.9rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  .modal-body label > span {
    display: block;
    font-size: 0.78rem;
    margin-bottom: 0.25rem;
    color: var(--color-muted);
  }
  .sub-head { font-size: 0.78rem; color: var(--color-muted); margin: 0 0 0.4rem; }
  .sub-row {
    display: grid;
    grid-template-columns: 3em 1fr 5em 2em;
    gap: 0.4rem;
    align-items: start;
    padding: 0.4rem;
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    margin-bottom: 0.4rem;
  }
  .sub-idx {
    font-family: ui-monospace, monospace;
    color: var(--color-muted);
    padding-top: 0.5rem;
  }
  .vchk { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.78rem; padding-top: 0.5rem; }
  .add-sub {
    padding: 0.3rem 0.7rem;
    background: transparent;
    border: 1px dashed var(--color-rule);
    border-radius: 4px;
    color: var(--color-muted);
    cursor: pointer;
    font-size: 0.78rem;
  }
  .add-sub:hover { color: var(--color-primary); border-color: var(--color-primary); }
  .modal footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    padding: 0.7rem 0.9rem;
    border-top: 1px solid var(--color-rule);
    background: var(--color-surface-2);
  }
  .modal .cancel {
    padding: 0.4rem 0.85rem;
    background: var(--color-bg);
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-fg);
  }
  .modal .primary {
    padding: 0.4rem 0.95rem;
    background: var(--color-primary);
    color: var(--color-bg);
    border: 1px solid var(--color-primary);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }
</style>
