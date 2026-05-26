<script lang="ts">
  import { onMount } from "svelte";
  import EventModal from "./EventModal.svelte";
  import {
    type CalendarEvent,
    type OccurrenceEvent,
    expandOccurrences,
    monthRange,
    categoryBadgeClass,
    categoryFullLabel,
    lunarShortFromSource,
  } from "../../lib/calendar-events";
  import { linkifyPlain } from "../../lib/linkify";

  // 현재 표시 중인 월. Calendar.svelte 가 `jsbooks:calendar-month` 이벤트로 알린다.
  let year = $state(new Date().getFullYear());
  let month = $state(new Date().getMonth() + 1);
  let events = $state<CalendarEvent[]>([]);
  let loading = $state(false);
  let isAuthed = $state<boolean | null>(null);

  let modalOpen = $state(false);
  let editing = $state<CalendarEvent | null>(null);

  async function checkAuth() {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) {
        isAuthed = false;
        return;
      }
      const data = await res.json() as { user: { id: string } | null };
      isAuthed = !!data.user;
    } catch {
      isAuthed = false;
    }
  }

  async function fetchEvents() {
    if (isAuthed === false) {
      events = [];
      return;
    }
    loading = true;
    try {
      const { from, to } = monthRange(year, month);
      const res = await fetch(`/api/events?from=${from}&to=${to}`, {
        credentials: "same-origin",
      });
      if (res.status === 401) {
        isAuthed = false;
        events = [];
        return;
      }
      if (!res.ok) {
        events = [];
        return;
      }
      const data = await res.json() as { events: CalendarEvent[] };
      events = data.events ?? [];
    } catch {
      events = [];
    } finally {
      loading = false;
    }
  }

  function onMonthChange(e: Event) {
    const ev = e as CustomEvent<{ year: number; month: number }>;
    const d = ev.detail;
    if (!d) return;
    if (Number.isInteger(d.year) && Number.isInteger(d.month)) {
      year = d.year;
      month = d.month;
    }
  }

  $effect(() => {
    // year, month, isAuthed 변화에 따라 재조회.
    year; month;
    if (isAuthed === null) return;
    fetchEvents();
  });

  /** 그 달에 표시될 occurrence (연례·음력 전개 후) */
  const occurrences = $derived<OccurrenceEvent[]>(expandOccurrences(events, year, month));

  onMount(() => {
    checkAuth();
    window.addEventListener("jsbooks:calendar-month", onMonthChange);
    window.addEventListener("jsbooks:events-updated", fetchEvents as EventListener);
    return () => {
      window.removeEventListener("jsbooks:calendar-month", onMonthChange);
      window.removeEventListener("jsbooks:events-updated", fetchEvents as EventListener);
    };
  });

  function openAdd() {
    editing = null;
    modalOpen = true;
  }
  function openEdit(occ: OccurrenceEvent) {
    if (occ.source.is_mine === 0) return; // 타인 공개 일정 — 편집 불가
    editing = occ.source;
    modalOpen = true;
  }
  function onSaved() {
    fetchEvents();
    // 달력 셀 뱃지 (별도 island) 도 갱신 트리거
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("jsbooks:events-updated"));
    }
  }

  /** 상세박스 알약 스타일 — 'M.D' 짧은 양력 prefix. 종료일 있으면 'M.D-DD'. */
  function shortDateRange(occ: OccurrenceEvent): string {
    const [, sm, sd] = occ.occursOn.split("-").map(Number);
    const start = `${sm}.${sd}`;
    if (!occ.endOn || occ.endOn === occ.occursOn) return start;
    const endParts = occ.endOn.split("-").map(Number);
    return `${start}-${endParts[2]}`;
  }

</script>

<div class="cme-block">
  <div class="cme-head">
    <h3>{month}월 일정</h3>
    {#if isAuthed}
      <button type="button" class="cme-add" onclick={openAdd} aria-label="일정 추가">+</button>
    {/if}
  </div>

  {#if isAuthed === null}
    <p class="cme-empty">불러오는 중…</p>
  {:else if isAuthed === false}
    <p class="cme-empty">로그인하시면 개인 일정을 등록·조회할 수 있습니다.</p>
  {:else if loading && occurrences.length === 0}
    <p class="cme-empty">불러오는 중…</p>
  {:else if occurrences.length === 0}
    <p class="cme-empty">등록된 일정이 없습니다.</p>
  {:else}
    <ul class="cme-list">
      {#each occurrences as occ (occ.source.id + "@" + occ.occursOn)}
        {@const src = occ.source}
        {@const own = src.is_mine !== 0}
        {@const lunar = lunarShortFromSource(src)}
        <li class="cme-item" class:foreign={!own}>
          <button
            type="button"
            class="cme-item-btn"
            onclick={() => openEdit(occ)}
            disabled={!own}
            title={own ? "편집" : "공개 일정 (편집 불가)"}
            aria-label={categoryFullLabel(src.category)}
          >
            <span class="cme-pill {categoryBadgeClass(src.category)}">
              <span class="cme-pill-date">{shortDateRange(occ)}{#if lunar}<span class="cme-pill-lunar">(음{lunar})</span>{/if}</span>
              <span class="cme-pill-title">{src.title}</span>
            </span>
            {#if src.memo}
              <!-- URL 자동 변환: 내부=pill 상대경로, 외부=새창 + ↗. comments-worker 와 동일 정책. -->
              <span class="cme-memo">{@html linkifyPlain(src.memo)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<EventModal
  bind:open={modalOpen}
  event={editing}
  defaultDate={`${year}-${String(month).padStart(2, "0")}-01`}
  onClose={() => { modalOpen = false; }}
  onSaved={onSaved}
/>

<style>
  .cme-block {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--color-rule);
  }
  .cme-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .cme-head h3 {
    font-size: 0.78rem;
    color: var(--color-muted);
    margin: 0;
    font-weight: 600;
  }
  .cme-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule);
    border-radius: 50%;
    color: var(--color-fg);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }
  .cme-add:hover {
    background: var(--color-primary-bg);
    color: var(--color-primary);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 35%, var(--color-rule));
  }
  .cme-empty {
    margin: 0;
    padding: 0.35rem 0;
    color: var(--color-muted);
    font-size: 0.84rem;
    line-height: 1.4;
  }
  .cme-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .cme-item.foreign {
    opacity: 0.92;
  }
  /* 한 항목 = 위 row(상세박스 알약 스타일 제목) + 아래 row(메모 전체, wrap). */
  .cme-item-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    width: 100%;
    padding: 0.45rem 0.5rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    text-align: left;
    color: var(--color-fg);
    cursor: pointer;
    font: inherit;
    line-height: 1.3;
  }
  .cme-item-btn:disabled {
    cursor: default;
  }
  .cme-item-btn:not(:disabled):hover {
    background: var(--color-primary-bg);
  }
  /* 상세박스·HomeAgenda 와 동일 둥근 알약 — `M.D(음M.D) 제목` */
  .cme-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.6rem;
    border-radius: 999px;
    font-size: 0.82rem;
    line-height: 1.3;
    max-width: 100%;
  }
  .cme-pill-date {
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    flex-shrink: 0;
  }
  .cme-pill-lunar {
    font-size: 0.7rem;
    opacity: 0.78;
    margin-left: 0.1rem;
  }
  .cme-pill-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 아래 행 — 메모 전체. 길면 wrap. */
  .cme-memo {
    color: var(--color-muted);
    font-size: 0.82rem;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
    padding-left: 0.15rem;
  }
  /* ─── Category palette — 셀·사이드바·상세박스 통일 ─── */
  .cat-anniversary {
    background: var(--color-primary, #a8352a);
    color: #fff;
  }
  .cat-plan {
    background: var(--color-secondary, #1e6e6e);
    color: #fff;
  }
  .cat-other {
    background: color-mix(in srgb, var(--color-muted, #8a807a) 30%, #fff);
    color: #1f1c1a;
  }
</style>
