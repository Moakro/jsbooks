<script lang="ts">
  import { onMount } from "svelte";
  import EventModal from "./EventModal.svelte";
  import {
    type CalendarEvent,
    type OccurrenceEvent,
    expandOccurrences,
    monthRange,
  } from "../../lib/calendar-events";

  // 현재 표시 중인 월. Calendar.svelte 가 `jsbooks:calendar-month` 이벤트로 알린다.
  let year = $state(new Date().getFullYear());
  let month = $state(new Date().getMonth() + 1);
  let events = $state<CalendarEvent[]>([]);
  let loading = $state(false);
  let isAuthed = $state<boolean | null>(null);

  let modalOpen = $state(false);
  let editing = $state<CalendarEvent | null>(null);

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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

  function dayLabel(iso: string): string {
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    const d = Number(parts[2]);
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, d);
    return `${d}일 (${WEEKDAYS[date.getDay()]})`;
  }

  function rangeLabel(occ: OccurrenceEvent): string {
    const start = dayLabel(occ.occursOn);
    if (!occ.endOn || occ.endOn === occ.occursOn) return start;
    const endParts = occ.endOn.split("-");
    return `${start} – ${Number(endParts[2])}일`;
  }

  function categoryClass(cat: string | null): string {
    if (cat === "기념일") return "cat-anniversary";
    if (cat === "일정")   return "cat-plan";
    if (cat === "기타")   return "cat-other";
    return "cat-other";
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
        <li class="cme-item" class:foreign={!own}>
          <button
            type="button"
            class="cme-item-btn"
            onclick={() => openEdit(occ)}
            disabled={!own}
            title={own ? "편집" : `${src.owner_name ?? "다른 사용자"} 의 공개 일정`}
          >
            <div class="cme-date">
              {rangeLabel(occ)}
              {#if src.is_annual === 1}
                <span class="cme-flag" title="매년 반복">연례</span>
              {/if}
              {#if src.is_lunar === 1}
                <span class="cme-flag flag-lunar" title="음력 기준">음</span>
              {/if}
              {#if src.is_public === 1}
                <span class="cme-flag flag-public" title="사이트 공개">공개</span>
              {/if}
            </div>
            <div class="cme-title">
              {#if src.category}
                <span class="cme-cat {categoryClass(src.category)}">{src.category}</span>
              {/if}
              <span class="cme-title-text">{src.title}</span>
              {#if !own && src.owner_name}
                <span class="cme-owner">· {src.owner_name}</span>
              {/if}
            </div>
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
  .cme-item-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    width: 100%;
    padding: 0.4rem 0.5rem;
    background: transparent;
    border: none;
    border-radius: 4px;
    text-align: left;
    color: var(--color-fg);
    cursor: pointer;
    font: inherit;
  }
  .cme-item-btn:disabled {
    cursor: default;
  }
  .cme-item-btn:not(:disabled):hover {
    background: var(--color-primary-bg);
  }
  .cme-date {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    font-size: 0.74rem;
    color: var(--color-muted);
    line-height: 1.2;
  }
  .cme-flag {
    padding: 0.02rem 0.32rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-secondary, #1e6e6e) 14%, transparent);
    color: var(--color-secondary, #1e6e6e);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.2;
  }
  .flag-lunar {
    background: color-mix(in srgb, #6b4ca6 16%, transparent);
    color: #6b4ca6;
  }
  .flag-public {
    background: color-mix(in srgb, #1e7a3b 14%, transparent);
    color: #1e7a3b;
  }
  .cme-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    font-size: 0.9rem;
    line-height: 1.3;
  }
  .cme-title-text {
    word-break: break-word;
  }
  .cme-owner {
    color: var(--color-muted);
    font-size: 0.78rem;
  }
  .cme-cat {
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  .cat-anniversary {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, transparent);
    color: var(--color-primary, #a8352a);
  }
  .cat-plan {
    background: color-mix(in srgb, var(--color-secondary, #1e6e6e) 14%, transparent);
    color: var(--color-secondary, #1e6e6e);
  }
  .cat-other {
    background: color-mix(in srgb, var(--color-muted, #8a807a) 14%, transparent);
    color: var(--color-muted, #8a807a);
  }
</style>
