<script lang="ts">
  import { onMount } from "svelte";
  import EventModal from "./EventModal.svelte";
  import {
    type CalendarEvent,
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

  onMount(() => {
    checkAuth();
    window.addEventListener("jsbooks:calendar-month", onMonthChange);
    return () => {
      window.removeEventListener("jsbooks:calendar-month", onMonthChange);
    };
  });

  function openAdd() {
    editing = null;
    modalOpen = true;
  }
  function openEdit(ev: CalendarEvent) {
    editing = ev;
    modalOpen = true;
  }
  function onSaved() {
    fetchEvents();
  }

  function dayLabel(iso: string): string {
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    const d = Number(parts[2]);
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, d);
    return `${d}일 (${WEEKDAYS[date.getDay()]})`;
  }

  function rangeLabel(ev: CalendarEvent): string {
    const start = dayLabel(ev.start_date);
    if (!ev.end_date || ev.end_date === ev.start_date) return start;
    const endParts = ev.end_date.split("-");
    return `${start} – ${Number(endParts[2])}일`;
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
  {:else if loading && events.length === 0}
    <p class="cme-empty">불러오는 중…</p>
  {:else if events.length === 0}
    <p class="cme-empty">등록된 일정이 없습니다.</p>
  {:else}
    <ul class="cme-list">
      {#each events as ev (ev.id)}
        <li class="cme-item">
          <button type="button" class="cme-item-btn" onclick={() => openEdit(ev)}>
            <div class="cme-date">{rangeLabel(ev)}</div>
            <div class="cme-title">
              {#if ev.category}
                <span class="cme-cat">{ev.category}</span>
              {/if}
              <span>{ev.title}</span>
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
  .cme-item-btn:hover {
    background: var(--color-primary-bg);
  }
  .cme-date {
    font-size: 0.74rem;
    color: var(--color-muted);
    line-height: 1.2;
  }
  .cme-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.9rem;
    line-height: 1.3;
  }
  .cme-cat {
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 12%, transparent);
    color: var(--color-primary, #a8352a);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }
</style>
