<script lang="ts">
  /**
   * Archive(인물·장소) 후보 검수 큐 UI — 좌측 사이드바(kind·체크·검색 필터)
   * + 메인 후보 카드 목록. 각 카드는 slug·name 인라인 편집 가능(한자만 추출된
   * 후보에 한글 slug·name 지정용).
   * /__archive-candidates/load · /scan · /apply 엔드포인트와 통신.
   */
  import { onMount } from "svelte";
  import { showSnackbar } from "../../lib/admin-snackbar";

  type Sample = { file: string; line: number; context: string };
  type Candidate = {
    id: string;
    kind: "people" | "places";
    label: string;
    hanja: string;
    hangeul: string;
    slug: string;
    count: number;
    checked: boolean;
    samples: Sample[];
  };
  type Queue = {
    generatedAt: string | null;
    stats: { total: number; byKind?: Record<string, number> };
    candidates: Candidate[];
  };

  let queue = $state<Queue>({ generatedAt: null, stats: { total: 0 }, candidates: [] });
  let selected = $state<Set<string>>(new Set());
  // id → { slug, name } 편집 오버라이드
  let edits = $state<Record<string, { slug: string; name: string }>>({});
  let loading = $state(false);
  let scanning = $state(false);
  let applying = $state(false);

  let filterKind = $state<"all" | "people" | "places">("all");
  let filterCheck = $state<"all" | "unchecked" | "checked">("all");
  let searchTerm = $state("");

  const KIND_LABEL: Record<string, string> = { people: "인물", places: "장소" };

  function editOf(c: Candidate): { slug: string; name: string } {
    return edits[c.id] ?? { slug: c.slug, name: c.hangeul || c.hanja || c.slug };
  }

  function setEdit(id: string, patch: Partial<{ slug: string; name: string }>) {
    const cur = edits[id] ?? (() => {
      const c = queue.candidates.find((x) => x.id === id);
      return { slug: c?.slug ?? "", name: c?.hangeul || c?.hanja || c?.slug || "" };
    })();
    edits = { ...edits, [id]: { ...cur, ...patch } };
  }

  function passesFilter(c: Candidate): boolean {
    if (filterKind !== "all" && c.kind !== filterKind) return false;
    if (filterCheck === "unchecked" && c.checked) return false;
    if (filterCheck === "checked" && !c.checked) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      if (
        !c.label.toLowerCase().includes(t) &&
        !c.slug.toLowerCase().includes(t) &&
        !c.samples.some((s) => s.context.toLowerCase().includes(t))
      ) {
        return false;
      }
    }
    return true;
  }

  const filtered = $derived(() => queue.candidates.filter(passesFilter));
  const visibleCount = $derived(() => filtered().length);
  const selectedCount = $derived(() => selected.size);

  async function load() {
    loading = true;
    try {
      const res = await fetch("/__archive-candidates/load");
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error ?? "load failed");
      queue = j.queue;
      edits = {};
    } catch (e: any) {
      showSnackbar(`큐 로드 실패: ${e?.message ?? String(e)}`, "error", 4000);
    } finally {
      loading = false;
    }
  }

  async function rescan() {
    if (scanning) return;
    scanning = true;
    try {
      const res = await fetch("/__archive-candidates/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error ?? "scan failed");
      queue = j.queue;
      selected = new Set();
      edits = {};
      showSnackbar(`재스캔 완료 — 후보 ${j.queue.stats.total}건`, "success", 3000);
    } catch (e: any) {
      showSnackbar(`재스캔 실패: ${e?.message ?? String(e)}`, "error", 5000);
    } finally {
      scanning = false;
    }
  }

  async function applySelected() {
    if (applying || selected.size === 0) return;
    const items = queue.candidates
      .filter((c) => selected.has(c.id))
      .map((c) => {
        const e = editOf(c);
        return { id: c.id, kind: c.kind, slug: e.slug.trim(), name: e.name.trim(), hanja: c.hanja };
      });
    const bad = items.find((i) => !i.slug || !i.name);
    if (bad) {
      showSnackbar("slug·name 이 빈 항목이 있습니다.", "error", 4000);
      return;
    }
    if (!confirm(`${items.length}건의 archive 카드(content/{people,places}/<slug>.md)를 생성합니다. 계속할까요?`)) return;
    applying = true;
    try {
      const res = await fetch("/__archive-candidates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "apply failed");
      const lines = [
        `생성 ${j.created}건`,
        j.skipped ? `이미 존재 ${j.skipped}건(건너뜀)` : `이미 존재 0건`,
        j.errors?.length ? `오류 ${j.errors.length}건` : `오류 0건`,
        `큐에서 제거 ${j.removed}건`,
      ];
      showSnackbar(lines.join("\n"), j.errors?.length ? "info" : "success", 6000);
      await load();
      selected = new Set();
    } catch (e: any) {
      showSnackbar(`적용 실패: ${e?.message ?? String(e)}`, "error", 6000);
    } finally {
      applying = false;
    }
  }

  function toggleSelect(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selected = s;
  }

  function isFilterless(): boolean {
    return filterKind === "all" && filterCheck === "all" && searchTerm === "";
  }

  function selectAllVisible() {
    const n = visibleCount();
    if (n === 0) return;
    if (isFilterless() && !confirm(`필터가 적용되지 않았습니다. ${n}건 전체를 선택합니다. 계속하시겠습니까?`)) {
      return;
    }
    const s = new Set(selected);
    for (const c of filtered()) s.add(c.id);
    selected = s;
  }

  function clearSelection() {
    selected = new Set();
  }

  onMount(load);
</script>

<div class="layout">
  <aside class="sidebar">
    <h2>필터</h2>

    <div class="field">
      <label for="ac-search">검색</label>
      <input id="ac-search" type="text" bind:value={searchTerm} placeholder="이름·slug·컨텍스트…" />
    </div>

    <div class="field">
      <div class="lbl">종류</div>
      <div class="opts">
        <button type="button" class="chip" class:active={filterKind === "all"} onclick={() => (filterKind = "all")}>전체</button>
        <button type="button" class="chip" class:active={filterKind === "people"} onclick={() => (filterKind = "people")}>인물 ({queue.stats?.byKind?.people ?? "·"})</button>
        <button type="button" class="chip" class:active={filterKind === "places"} onclick={() => (filterKind = "places")}>장소 ({queue.stats?.byKind?.places ?? "·"})</button>
      </div>
    </div>

    <div class="field">
      <div class="lbl">체크 상태</div>
      <div class="opts">
        <button type="button" class="chip" class:active={filterCheck === "all"} onclick={() => (filterCheck = "all")}>전체</button>
        <button type="button" class="chip" class:active={filterCheck === "unchecked"} onclick={() => (filterCheck = "unchecked")}>미체크</button>
        <button type="button" class="chip" class:active={filterCheck === "checked"} onclick={() => (filterCheck = "checked")}>체크됨</button>
      </div>
    </div>

    <div class="meta">
      <div>총 후보 <strong>{queue.stats.total}</strong>건</div>
      <div>표시 <strong>{visibleCount()}</strong>건</div>
      <div>선택 <strong>{selectedCount()}</strong>건</div>
      {#if queue.generatedAt}
        <div class="ts">생성: {queue.generatedAt}</div>
      {/if}
    </div>
  </aside>

  <main class="main">
    <div class="actionbar">
      <button type="button" class="btn" onclick={rescan} disabled={scanning || applying}>{scanning ? "스캔 중…" : "재스캔"}</button>
      <button type="button" class="btn primary" onclick={applySelected} disabled={applying || selectedCount() === 0}>{applying ? "적용 중…" : `선택 ${selectedCount()}건 카드 생성`}</button>
      <button type="button" class="btn" onclick={selectAllVisible} disabled={visibleCount() === 0}>표시 항목 전체 선택</button>
      <button type="button" class="btn" onclick={clearSelection} disabled={selectedCount() === 0}>선택 해제</button>
      <button type="button" class="btn" onclick={load} disabled={loading}>{loading ? "로드 중…" : "새로고침"}</button>
    </div>

    {#if loading && queue.candidates.length === 0}
      <p class="muted">로딩 중…</p>
    {:else if visibleCount() === 0}
      <p class="muted">표시할 후보가 없습니다.</p>
    {:else}
      <ul class="cards">
        {#each filtered() as c (c.id)}
          {@const e = editOf(c)}
          <li class="card" class:sel={selected.has(c.id)}>
            <div class="top">
              <input type="checkbox" checked={selected.has(c.id)} onchange={() => toggleSelect(c.id)} />
              <span class="kind-badge {c.kind}">{KIND_LABEL[c.kind]}</span>
              <strong class="label">{c.label}</strong>
              <span class="cnt">{c.count}건</span>
            </div>
            <div class="edit">
              <label>slug
                <input type="text" value={e.slug} oninput={(ev) => setEdit(c.id, { slug: (ev.target as HTMLInputElement).value })} />
              </label>
              <label>name
                <input type="text" value={e.name} oninput={(ev) => setEdit(c.id, { name: (ev.target as HTMLInputElement).value })} />
              </label>
              <span class="dest">→ <code>content/{c.kind}/{e.slug || "?"}.md</code></span>
            </div>
            <ul class="samples">
              {#each c.samples as s}
                <li><code class="loc">{s.file}:L{s.line}</code> <span class="ctx">{s.context}</span></li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  </main>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  .sidebar {
    position: sticky;
    top: 1rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    background: var(--color-surface-2);
    font-size: 0.85rem;
  }
  .sidebar h2 {
    font-size: 0.95rem;
    margin: 0 0 0.7rem;
  }
  .field {
    margin-bottom: 0.9rem;
  }
  .field label,
  .lbl {
    display: block;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-muted);
    margin-bottom: 0.3rem;
  }
  .field input[type="text"] {
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-surface);
    color: var(--color-fg);
    font-size: 0.85rem;
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chip {
    border: 1px solid var(--color-rule);
    background: var(--color-surface);
    color: var(--color-fg);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .chip.active {
    background: var(--color-primary-bg);
    border-color: var(--color-primary);
    color: var(--color-primary);
    font-weight: 600;
  }
  .meta {
    margin-top: 1rem;
    padding-top: 0.7rem;
    border-top: 1px dashed var(--color-rule);
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .meta strong {
    color: var(--color-fg);
  }
  .meta .ts {
    margin-top: 0.4rem;
    font-size: 0.72rem;
  }

  .main {
    min-width: 0;
  }
  .actionbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    background: var(--color-surface-2);
    margin-bottom: 1rem;
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .btn {
    border: 1px solid var(--color-rule);
    background: var(--color-surface);
    color: var(--color-fg);
    padding: 0.35rem 0.7rem;
    border-radius: 4px;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }
  .btn:hover:not(:disabled) {
    background: var(--color-primary-bg);
  }
  .btn.primary:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .muted {
    color: var(--color-muted);
    padding: 1rem 0;
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .card {
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    margin-bottom: 0.6rem;
    background: var(--color-surface);
    padding: 0.6rem 0.8rem;
    transition: border-color 0.1s ease;
  }
  .card.sel {
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .top input[type="checkbox"] {
    cursor: pointer;
  }
  .kind-badge {
    font-size: 0.72rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    border: 1px solid var(--color-rule);
    color: var(--color-muted);
  }
  .kind-badge.people {
    color: var(--color-primary);
    border-color: var(--color-primary);
  }
  .label {
    font-size: 0.95rem;
  }
  .cnt {
    color: var(--color-muted);
    font-size: 0.8rem;
    margin-left: auto;
  }
  .edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin: 0.5rem 0 0.4rem;
  }
  .edit label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  .edit input[type="text"] {
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-surface);
    color: var(--color-fg);
    font-size: 0.82rem;
    width: 9rem;
  }
  .edit .dest {
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  .edit .dest code {
    background: var(--color-surface-2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  .samples {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0.4rem 0 0;
    border-top: 1px dashed var(--color-rule);
  }
  .samples li {
    font-size: 0.8rem;
    line-height: 1.45;
    margin-bottom: 0.25rem;
    word-break: break-word;
  }
  .samples .loc {
    color: var(--color-muted);
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
  .samples .ctx {
    color: var(--color-fg-soft, var(--color-muted));
  }
</style>
