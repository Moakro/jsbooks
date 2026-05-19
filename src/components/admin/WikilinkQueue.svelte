<script lang="ts">
  /**
   * Wikilink 검수 큐 UI — 좌측 사이드바(slug·kind·체크 필터) + 메인 카드 목록.
   * /__wikilink-queue/load · /__wikilink-queue/scan · /__wikilink-queue/apply 엔드포인트와 통신.
   */
  import { onMount } from "svelte";
  import { showSnackbar } from "../../lib/admin-snackbar";

  type Match = {
    id: string;
    line: number;
    matchedText: string;
    suggested: string;
    kind: string;
    canonical: string;
    contextLine: string;
    checked: boolean;
  };
  type FileEntry = { file: string; slug: string; matches: Match[] };
  type Queue = {
    generatedAt: string | null;
    stats: { total: number; byKind?: Record<string, number> };
    files: FileEntry[];
  };

  let queue = $state<Queue>({ generatedAt: null, stats: { total: 0 }, files: [] });
  let selected = $state<Set<string>>(new Set());
  let loading = $state(false);
  let scanning = $state(false);
  let applying = $state(false);

  // 필터 상태
  let filterSlug = $state<string>("all");
  let filterKind = $state<Set<string>>(new Set()); // 비어 있으면 = 전체
  let filterCheck = $state<"all" | "unchecked" | "checked">("all");
  let searchTerm = $state("");

  const slugs = $derived(() => {
    const s = new Set<string>();
    for (const f of queue.files) if (f.slug) s.add(f.slug);
    return [...s].sort();
  });

  const kinds = $derived(() => {
    const s = new Set<string>();
    for (const f of queue.files) for (const m of f.matches) s.add(m.kind);
    return [...s].sort();
  });

  function passesFilter(file: FileEntry, m: Match): boolean {
    if (filterSlug !== "all" && file.slug !== filterSlug) return false;
    if (filterKind.size > 0 && !filterKind.has(m.kind)) return false;
    if (filterCheck === "unchecked" && m.checked) return false;
    if (filterCheck === "checked" && !m.checked) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      if (
        !m.matchedText.toLowerCase().includes(t) &&
        !m.canonical.toLowerCase().includes(t) &&
        !m.contextLine.toLowerCase().includes(t)
      ) {
        return false;
      }
    }
    return true;
  }

  const filteredFiles = $derived(() => {
    return queue.files
      .map((f) => ({ ...f, matches: f.matches.filter((m) => passesFilter(f, m)) }))
      .filter((f) => f.matches.length > 0);
  });

  const visibleCount = $derived(() =>
    filteredFiles().reduce((n, f) => n + f.matches.length, 0),
  );

  const selectedCount = $derived(() => selected.size);

  async function load() {
    loading = true;
    try {
      const res = await fetch("/__wikilink-queue/load");
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error ?? "load failed");
      queue = j.queue;
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
      const body =
        filterSlug !== "all" ? { scripture: filterSlug } : {};
      const res = await fetch("/__wikilink-queue/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error ?? "scan failed");
      queue = j.queue;
      selected = new Set(); // 큐 갱신 시 선택 초기화
      showSnackbar(
        `재스캔 완료 — 후보 ${j.queue.stats.total}건`,
        "success",
        3000,
      );
    } catch (e: any) {
      showSnackbar(`재스캔 실패: ${e?.message ?? String(e)}`, "error", 5000);
    } finally {
      scanning = false;
    }
  }

  async function applySelected() {
    if (applying || selected.size === 0) return;
    if (!confirm(`${selected.size}건의 wikilink를 본문에 적용합니다. 계속할까요?`)) return;
    applying = true;
    try {
      const ids = [...selected];
      const res = await fetch("/__wikilink-queue/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error ?? j?.stderr ?? "apply failed");
      const bak = j.backupDir ? `\n백업: ${j.backupDir}` : "";
      showSnackbar(
        `적용 ${j.applied}건${j.skipped ? `, 스킵 ${j.skipped}건` : ""}${bak}`,
        j.skipped ? "info" : "success",
        5000,
      );
      // 큐 다시 로드 (적용된 라인 제거됨)
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

  function selectAllVisible() {
    const s = new Set(selected);
    for (const f of filteredFiles()) for (const m of f.matches) s.add(m.id);
    selected = s;
  }

  function clearSelection() {
    selected = new Set();
  }

  function toggleKind(k: string) {
    const s = new Set(filterKind);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    filterKind = s;
  }

  /** matchedText 위치를 강조한 contextLine HTML 반환. */
  function highlight(ctx: string, needle: string): string {
    const escapeHtml = (t: string) =>
      t
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    if (!ctx || !needle) return escapeHtml(ctx);
    const idx = ctx.indexOf(needle);
    if (idx < 0) return escapeHtml(ctx);
    return (
      escapeHtml(ctx.slice(0, idx)) +
      `<mark>${escapeHtml(needle)}</mark>` +
      escapeHtml(ctx.slice(idx + needle.length))
    );
  }

  onMount(load);
</script>

<div class="layout">
  <aside class="sidebar">
    <h2>필터</h2>

    <div class="field">
      <label for="wl-search">검색</label>
      <input
        id="wl-search"
        type="text"
        bind:value={searchTerm}
        placeholder="단어·canonical·컨텍스트…"
      />
    </div>

    <div class="field">
      <div class="lbl">경전</div>
      <div class="opts">
        <button
          type="button"
          class="chip"
          class:active={filterSlug === "all"}
          onclick={() => (filterSlug = "all")}
        >전체</button>
        {#each slugs() as slug}
          <button
            type="button"
            class="chip"
            class:active={filterSlug === slug}
            onclick={() => (filterSlug = slug)}
          >{slug}</button>
        {/each}
      </div>
    </div>

    <div class="field">
      <div class="lbl">카드 종류</div>
      <div class="opts">
        {#each kinds() as k}
          <button
            type="button"
            class="chip"
            class:active={filterKind.has(k)}
            onclick={() => toggleKind(k)}
          >{k} ({queue.stats?.byKind?.[k] ?? "·"})</button>
        {/each}
      </div>
      <div class="hint">없음 = 전체</div>
    </div>

    <div class="field">
      <div class="lbl">체크 상태</div>
      <div class="opts">
        <button
          type="button"
          class="chip"
          class:active={filterCheck === "all"}
          onclick={() => (filterCheck = "all")}
        >전체</button>
        <button
          type="button"
          class="chip"
          class:active={filterCheck === "unchecked"}
          onclick={() => (filterCheck = "unchecked")}
        >미체크</button>
        <button
          type="button"
          class="chip"
          class:active={filterCheck === "checked"}
          onclick={() => (filterCheck = "checked")}
        >체크됨</button>
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
      <button
        type="button"
        class="btn"
        onclick={rescan}
        disabled={scanning || applying}
      >{scanning ? "스캔 중…" : "재스캔"}</button>
      <button
        type="button"
        class="btn primary"
        onclick={applySelected}
        disabled={applying || selectedCount() === 0}
      >{applying ? "적용 중…" : `선택 ${selectedCount()}건 적용`}</button>
      <button
        type="button"
        class="btn"
        onclick={selectAllVisible}
        disabled={visibleCount() === 0}
      >표시 항목 전체 선택</button>
      <button
        type="button"
        class="btn"
        onclick={clearSelection}
        disabled={selectedCount() === 0}
      >선택 해제</button>
      <button
        type="button"
        class="btn"
        onclick={load}
        disabled={loading}
      >{loading ? "로드 중…" : "새로고침"}</button>
    </div>

    {#if loading && queue.files.length === 0}
      <p class="muted">로딩 중…</p>
    {:else if visibleCount() === 0}
      <p class="muted">표시할 후보가 없습니다.</p>
    {:else}
      {#each filteredFiles() as f}
        <section class="file">
          <h3>{f.file} <span class="cnt">({f.matches.length})</span></h3>
          <ul class="matches">
            {#each f.matches as m}
              <li class="match" class:sel={selected.has(m.id)}>
                <label class="row">
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onchange={() => toggleSelect(m.id)}
                  />
                  <div class="body">
                    <div class="head">
                      <code class="kind">{m.kind}/{m.canonical}</code>
                      <span class="sep">·</span>
                      <span class="loc">L{m.line}</span>
                      <span class="sep">·</span>
                      <code class="word">{m.matchedText}</code>
                      <span class="arr">→</span>
                      <code class="sug">{m.suggested}</code>
                    </div>
                    {#if m.contextLine}
                      <div class="ctx">{@html highlight(m.contextLine, m.matchedText)}</div>
                    {/if}
                  </div>
                </label>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
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
  .hint {
    font-size: 0.72rem;
    color: var(--color-muted);
    margin-top: 0.25rem;
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

  .file {
    margin: 0 0 1.2rem;
  }
  .file h3 {
    margin: 0 0 0.5rem;
    font-size: 0.92rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
  .file .cnt {
    color: var(--color-muted);
    font-weight: normal;
  }
  .matches {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .match {
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    margin-bottom: 0.35rem;
    background: var(--color-surface);
    transition: border-color 0.1s ease;
  }
  .match.sel {
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .row {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0.7rem;
    align-items: flex-start;
    cursor: pointer;
  }
  .row input[type="checkbox"] {
    margin-top: 0.25rem;
    cursor: pointer;
  }
  .body {
    min-width: 0;
    flex: 1;
  }
  .head {
    font-size: 0.85rem;
    margin-bottom: 0.2rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: baseline;
  }
  .head code {
    background: var(--color-surface-2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.8rem;
  }
  .head .kind {
    color: var(--color-muted);
  }
  .head .word {
    font-weight: 600;
    color: var(--color-fg);
  }
  .head .sug {
    color: var(--color-primary);
  }
  .head .sep,
  .head .arr {
    color: var(--color-muted);
  }
  .head .loc {
    color: var(--color-muted);
    font-size: 0.78rem;
    font-family: ui-monospace, monospace;
  }
  .ctx {
    color: var(--color-fg-soft, var(--color-muted));
    font-size: 0.82rem;
    line-height: 1.4;
    margin-top: 0.15rem;
    padding-left: 0.1rem;
    word-break: break-word;
  }
  .ctx :global(mark) {
    background: rgba(255, 220, 0, 0.35);
    padding: 0 0.1rem;
    border-radius: 2px;
  }
</style>
