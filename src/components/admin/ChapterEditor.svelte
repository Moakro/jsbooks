<script lang="ts">
  import VerseCard from "./VerseCard.svelte";

  export let hanjaEntryId: string;
  export let hangeulEntryId: string;
  export let initialHanja: { id: string; text: string }[];
  export let initialHangeul: { id: string; text: string }[];
  /** mapping[hanjaAnchor] = { hangeul: string[], reviewed: boolean, confidence?: number } */
  export let initialMapping: Record<
    string,
    { hangeul: string[]; reviewed: boolean; confidence?: number }
  >;

  type Verse = { id?: string; text: string };

  let hanja: Verse[] = initialHanja.map((v) => ({ ...v }));
  let hangeul: Verse[] = initialHangeul.map((v) => ({ ...v }));

  // Map local index of hanja verse → mapping state. Using anchor when available,
  // otherwise a synthetic key for newly inserted verses.
  type MapState = { hangeul: string[]; reviewed: boolean; confidence?: number };
  function initMapState(): MapState[] {
    return hanja.map((v) => {
      const m = v.id ? initialMapping[v.id] : null;
      return {
        hangeul: m?.hangeul ? [...m.hangeul] : [],
        reviewed: !!m?.reviewed,
        ...(m?.confidence != null ? { confidence: m.confidence } : {}),
      };
    });
  }
  let mapState: MapState[] = initMapState();

  let saveStatus = "";
  let saving = false;

  function syntheticHangeulId(text: string): string {
    return `:new:${Math.random().toString(36).slice(2, 9)}`;
  }

  // Re-pair mappings 1:1 by row index, starting at `from` (0-based).
  // Rows before `from` keep their existing mapping unchanged.
  function repairMappingsFrom(from: number) {
    const prefix = mapState.slice(0, from);
    const suffix = hanja.slice(from).map((_, k) => {
      const target = hangeul[from + k];
      return {
        hangeul: target && target.id ? [target.id] : [],
        reviewed: false,
      };
    });
    mapState = [...prefix, ...suffix];
  }

  // ─── hanja mutators ───
  function updateHanja(i: number, ev: CustomEvent<{ text: string }>) {
    hanja[i] = { ...hanja[i], text: ev.detail.text };
    hanja = [...hanja];
  }
  function mergeHanjaUp(i: number) {
    if (i === 0) return;
    const merged = (hanja[i - 1].text + "\n" + hanja[i].text).trim();
    hanja = [
      ...hanja.slice(0, i - 1),
      { id: hanja[i - 1].id, text: merged },
      ...hanja.slice(i + 1),
    ];
    // 매핑은 병합 지점(i-1)부터 1:1로 자동 재정렬. 사용자가 의도적으로
    // 불일치 매핑을 만들어둔 경우라면 저장 전 체크박스로 다시 조정 가능.
    repairMappingsFrom(i - 1);
  }
  function mergeHanjaDown(i: number) {
    if (i >= hanja.length - 1) return;
    mergeHanjaUp(i + 1);
  }
  function deleteHanja(i: number) {
    if (!confirm(`${i + 1}절을 삭제하시겠습니까?`)) return;
    hanja = [...hanja.slice(0, i), ...hanja.slice(i + 1)];
    repairMappingsFrom(i);
  }
  function insertHanja(i: number, where: "above" | "below") {
    const at = where === "above" ? i : i + 1;
    hanja = [...hanja.slice(0, at), { text: "" }, ...hanja.slice(at)];
    repairMappingsFrom(at);
  }

  // ─── hangeul mutators ───
  function updateHangeul(i: number, ev: CustomEvent<{ text: string }>) {
    const oldId = hangeul[i].id;
    hangeul[i] = { ...hangeul[i], text: ev.detail.text };
    hangeul = [...hangeul];
  }
  function mergeHangeulUp(i: number) {
    if (i === 0) return;
    const keptId = hangeul[i - 1].id;
    const merged = (hangeul[i - 1].text + "\n" + hangeul[i].text).trim();
    hangeul = [
      ...hangeul.slice(0, i - 1),
      { id: keptId, text: merged },
      ...hangeul.slice(i + 1),
    ];
    // 한글 병합 후 매핑도 i-1부터 1:1로 재정렬
    repairMappingsFrom(i - 1);
  }
  function mergeHangeulDown(i: number) {
    if (i >= hangeul.length - 1) return;
    mergeHangeulUp(i + 1);
  }
  function deleteHangeul(i: number) {
    if (!confirm(`한글 ${i + 1}절을 삭제하시겠습니까?`)) return;
    hangeul = [...hangeul.slice(0, i), ...hangeul.slice(i + 1)];
    repairMappingsFrom(Math.max(0, i - 1));
  }
  function insertHangeul(i: number, where: "above" | "below") {
    const at = where === "above" ? i : i + 1;
    hangeul = [...hangeul.slice(0, at), { text: "" }, ...hangeul.slice(at)];
    repairMappingsFrom(Math.max(0, at - 1));
  }
  function appendHangeul() {
    hangeul = [...hangeul, { text: "" }];
  }

  // ─── mapping toggles ───
  function toggleMap(hanjaIdx: number, hangeulId: string) {
    if (!hangeulId) return;
    // a hangeul can only belong to one hanja → uncheck elsewhere
    mapState = mapState.map((m, j) => {
      const has = m.hangeul.includes(hangeulId);
      if (j === hanjaIdx) {
        return { ...m, hangeul: has ? m.hangeul.filter((h) => h !== hangeulId) : [...m.hangeul, hangeulId] };
      }
      if (has) return { ...m, hangeul: m.hangeul.filter((h) => h !== hangeulId) };
      return m;
    });
  }
  function setReviewed(i: number, value: boolean) {
    mapState = mapState.map((m, j) => (j === i ? { ...m, reviewed: value } : m));
  }
  function autoPair() {
    mapState = hanja.map((_, i) => {
      const hg = hangeul[i];
      return {
        hangeul: hg && hg.id ? [hg.id] : [],
        reviewed: false,
      };
    });
  }

  // ─── save ───
  async function save() {
    saving = true;
    saveStatus = "저장 중…";
    try {
      // 1) save chapter (rewrites both files + migrates mapping JSON)
      const chapterRes = await fetch("/api/admin/scripture-editor/save-chapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hanja: { entryId: hanjaEntryId, verses: hanja },
          hangeul: { entryId: hangeulEntryId, verses: hangeul },
        }),
      });
      const chapterOut = await chapterRes.json();
      if (!chapterRes.ok) throw new Error(chapterOut.error || "save-chapter failed");

      // 2) save mapping with NEW anchor ids (from server response)
      const newHanjaAnchors: string[] = chapterOut.hanja.anchors;
      const hanjaMigrations = new Map<string, string>(chapterOut.hanja.migrations);
      const hangeulMigrations = new Map<string, string>(chapterOut.hangeul?.migrations ?? []);

      const mappingEntries = mapState.map((m, i) => {
        const anchor = newHanjaAnchors[i];
        const hangeulIds = m.hangeul.map((h) => hangeulMigrations.get(h) ?? h);
        return {
          anchor,
          hangeul: hangeulIds,
          reviewed: m.reviewed,
          ...(m.confidence != null ? { confidence: m.confidence } : {}),
        };
      });

      const bulkRes = await fetch("/api/admin/canonical-mapping/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: mappingEntries }),
      });
      const bulkOut = await bulkRes.json();
      if (!bulkRes.ok) throw new Error(bulkOut.error || "mapping bulk failed");

      saveStatus = `저장 완료 (한자 ${newHanjaAnchors.length}절 / 매핑 ${bulkOut.count})`;
      // Re-sync local state with server new anchor ids
      hanja = hanja.map((v, i) => ({ id: newHanjaAnchors[i], text: v.text }));
      hangeul = hangeul.map((v, i) => ({
        id: chapterOut.hangeul?.anchors?.[i] ?? v.id,
        text: v.text,
      }));
      mapState = mappingEntries.map((e) => ({
        hangeul: e.hangeul,
        reviewed: e.reviewed,
        ...(e.confidence != null ? { confidence: e.confidence } : {}),
      }));
    } catch (err: any) {
      saveStatus = `오류: ${err.message ?? err}`;
    } finally {
      saving = false;
    }
  }

  $: progress = (() => {
    const total = mapState.length;
    const reviewed = mapState.filter((m) => m.reviewed).length;
    const mapped = mapState.filter((m) => m.hangeul.length > 0).length;
    return { total, reviewed, mapped };
  })();
</script>

<div class="editor">
  <div class="toolbar">
    <button type="button" class="primary" on:click={save} disabled={saving}>
      {saving ? "저장 중…" : "저장"}
    </button>
    <button type="button" on:click={autoPair}>1:1 자동매핑</button>
    <span class="status">{saveStatus}</span>
    <span class="progress">
      검수 {progress.reviewed}/{progress.mapped}/{progress.total}
    </span>
  </div>

  <div class="grid">
    <header><strong>한자 원문</strong> ({hanja.length}절)</header>
    <header><strong>임시 한글본</strong> ({hangeul.length}절)</header>
    <header class="map-hd">매핑 / 검수</header>

    {#each hanja as hv, i (i)}
      <div class="col-hanja">
        <VerseCard
          verse={hv}
          num={i + 1}
          isFirst={i === 0}
          isLast={i === hanja.length - 1}
          side="hanja"
          on:update={(e) => updateHanja(i, e)}
          on:mergeUp={() => mergeHanjaUp(i)}
          on:mergeDown={() => mergeHanjaDown(i)}
          on:delete={() => deleteHanja(i)}
          on:insertAbove={() => insertHanja(i, "above")}
          on:insertBelow={() => insertHanja(i, "below")}
        />
      </div>

      <div class="col-hangeul">
        {#if hangeul[i]}
          <VerseCard
            verse={hangeul[i]}
            num={i + 1}
            isFirst={i === 0}
            isLast={i === hangeul.length - 1}
            side="hangeul"
            on:update={(e) => updateHangeul(i, e)}
            on:mergeUp={() => mergeHangeulUp(i)}
            on:mergeDown={() => mergeHangeulDown(i)}
            on:delete={() => deleteHangeul(i)}
            on:insertAbove={() => insertHangeul(i, "above")}
            on:insertBelow={() => insertHangeul(i, "below")}
          />
        {:else}
          <div class="empty-slot">
            <em>(한글 누락)</em>
            <button type="button" on:click={appendHangeul}>+ 한글 절 추가</button>
          </div>
        {/if}
      </div>

      <div class="col-map">
        <div class="hangeul-checks">
          {#each hangeul as hg, j (hg.id ?? `g${j}`)}
            {@const cur = mapState[i]}
            <label class:selected={cur.hangeul.includes(hg.id ?? "") && hg.id}>
              <input
                type="checkbox"
                checked={!!hg.id && cur.hangeul.includes(hg.id)}
                disabled={!hg.id}
                on:change={() => hg.id && toggleMap(i, hg.id)}
              />
              <span class="hgnum">{j + 1}</span>
            </label>
          {/each}
        </div>
        <label class="reviewed-toggle">
          <input
            type="checkbox"
            checked={mapState[i].reviewed}
            on:change={(e) => setReviewed(i, (e.target as HTMLInputElement).checked)}
          />
          검수
        </label>
      </div>
    {/each}

    {#if hangeul.length > hanja.length}
      {#each hangeul.slice(hanja.length) as hv, k (`extra-${k}`)}
        <div class="col-hanja">
          <div class="empty-slot">
            <em>(한자 없음)</em>
          </div>
        </div>
        <div class="col-hangeul">
          <VerseCard
            verse={hv}
            num={hanja.length + k + 1}
            isFirst={false}
            isLast={k === hangeul.length - hanja.length - 1}
            side="hangeul"
            on:update={(e) => updateHangeul(hanja.length + k, e)}
            on:mergeUp={() => mergeHangeulUp(hanja.length + k)}
            on:mergeDown={() => mergeHangeulDown(hanja.length + k)}
            on:delete={() => deleteHangeul(hanja.length + k)}
            on:insertAbove={() => insertHangeul(hanja.length + k, "above")}
            on:insertBelow={() => insertHangeul(hanja.length + k, "below")}
          />
        </div>
        <div class="col-map"></div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .editor { font-size: 0.92rem; }
  .toolbar {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    padding: 0.6rem 0.8rem;
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    margin-bottom: 0.8rem;
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .toolbar button {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-bg);
    color: var(--color-fg);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .toolbar button.primary {
    background: var(--color-primary);
    color: var(--color-bg);
    border-color: var(--color-primary);
  }
  .toolbar button[disabled] { opacity: 0.5; cursor: wait; }
  .status { font-size: 0.85rem; color: var(--color-muted); }
  .progress { margin-left: auto; font-size: 0.82rem; color: var(--color-muted); }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr 100px;
    gap: 0.5rem;
    align-items: stretch;
  }
  .grid > header {
    grid-column: span 1;
    font-size: 0.85rem;
    color: var(--color-muted);
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid var(--color-rule);
  }
  .col-hanja, .col-hangeul, .col-map {
    align-self: start;
  }
  .col-map {
    padding: 0.4rem;
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    background: var(--color-bg);
    margin-bottom: 0.5rem;
  }
  .hangeul-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    margin-bottom: 0.4rem;
  }
  .hangeul-checks label {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .hangeul-checks label.selected {
    background: var(--color-primary-bg);
    border: 1px solid var(--color-primary);
  }
  .reviewed-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .empty-slot {
    padding: 0.7rem;
    border: 1px dashed var(--color-rule);
    border-radius: 6px;
    text-align: center;
    color: var(--color-muted);
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }
  .empty-slot button {
    margin-top: 0.4rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--color-rule);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.75rem;
  }
</style>
