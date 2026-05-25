<script lang="ts">
  import { onMount } from "svelte";
  import { getDayInfo, formatLunarKo } from "../../lib/date";
  import {
    type CalendarEvent,
    type OccurrenceEvent,
    expandOccurrences,
    monthRange,
    categoryBadgeClass,
    categoryFullLabel,
    lunarShortFromSource,
  } from "../../lib/calendar-events";

  interface Props {
    initialYear: number;
    initialMonth: number; // 1–12
  }

  const { initialYear, initialMonth }: Props = $props();

  let year = $state(initialYear);
  let month = $state(initialMonth);
  let today = $state<Date | null>(null);
  let selectedDate = $state<Date | null>(null);
  let monthEvents = $state<CalendarEvent[]>([]);

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const YEAR_OPTIONS = Array.from({ length: 301 }, (_, i) => 1800 + i);
  const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

  onMount(() => {
    const now = new Date();
    today = now;
    // URL query 우선 — 새로고침 후에도 동일 월 유지.
    const params = new URLSearchParams(location.search);
    const qy = Number(params.get("y"));
    const qm = Number(params.get("m"));
    if (Number.isInteger(qy) && qy >= 1800 && qy <= 2100) year = qy;
    if (Number.isInteger(qm) && qm >= 1 && qm <= 12) month = qm;
    selectedDate = startOfDay(now);
    void fetchMonthEvents();
    window.addEventListener("jsbooks:events-updated", onEventsUpdated);
    return () => {
      window.removeEventListener("jsbooks:events-updated", onEventsUpdated);
    };
  });

  function onEventsUpdated() {
    void fetchMonthEvents();
  }

  $effect(() => {
    // year, month 가 바뀌면 셀 뱃지용 events 도 다시 조회.
    year; month;
    if (today === null) return; // mount 전엔 skip
    void fetchMonthEvents();
  });

  async function fetchMonthEvents() {
    try {
      const { from, to } = monthRange(year, month);
      const res = await fetch(`/api/events?from=${from}&to=${to}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        monthEvents = [];
        return;
      }
      const data = await res.json() as { events: CalendarEvent[] };
      monthEvents = data.events ?? [];
    } catch {
      monthEvents = [];
    }
  }

  /** 셀 뱃지용 — '양력 YYYY-MM-DD' → 그날 발생하는 occurrence 들. */
  const occurrencesByDate = $derived.by<Map<string, OccurrenceEvent[]>>(() => {
    const map = new Map<string, OccurrenceEvent[]>();
    for (const occ of expandOccurrences(monthEvents, year, month)) {
      const list = map.get(occ.occursOn) ?? [];
      list.push(occ);
      map.set(occ.occursOn, list);
    }
    return map;
  });

  function isoFor(d: Date): string {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  // 사이드바 "N월 일정" 패널은 같은 페이지의 다른 island 라 props 공유가 안 된다.
  // window CustomEvent 로 현재 표시 월을 브로드캐스트해서 사이드바가 동기화한다.
  $effect(() => {
    if (typeof window === "undefined") return;
    const detail = { year, month };
    window.dispatchEvent(new CustomEvent("jsbooks:calendar-month", { detail }));
  });

  function pushState(y: number, m: number) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(location.search);
    params.set("y", String(y));
    params.set("m", String(m));
    history.pushState({ y, m }, "", `${location.pathname}?${params}`);
  }

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    year = y;
    month = m;
    pushState(y, m);
  }

  function shiftYear(delta: number) {
    year += delta;
    pushState(year, month);
  }

  function setYear(y: number) {
    year = y;
    pushState(year, month);
  }
  function setMonth(m: number) {
    month = m;
    pushState(year, month);
  }

  function goToday() {
    const now = new Date();
    today = now;
    year = now.getFullYear();
    month = now.getMonth() + 1;
    selectedDate = startOfDay(now);
    pushState(year, month);
  }

  function selectCell(d: Date) {
    selectedDate = startOfDay(d);
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
      pushState(year, month);
    }
  }

  function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  // 한자 일진(예 戊戌) — chinese_gapja 의 세 번째 토큰에서 日 제거.
  function chineseDayGanji(chinese_gapja: string | undefined): string | null {
    if (!chinese_gapja) return null;
    const parts = chinese_gapja.split(" ");
    return parts[2]?.replace(/日$/, "") ?? null;
  }

  function lunarShort(month_: number, day: number, leap: boolean): string {
    return `${month_}.${day}${leap ? "(윤)" : ""}`;
  }

  type Cell = {
    date: Date;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
    dow: number; // 0=일 6=토
    lunarShort: string | null;
    chineseDay: string | null;
    jeolgiName: string | null;
    jeolgiHanja: string | null;
    /** 그 날 표시할 occurrence 들 (사용자 일정 + 공개 일정 전개 후) */
    events: OccurrenceEvent[];
  };

  // 6주 풀 그리드 (42셀) — 첫 주 일요일 정렬, prev/next 달 셀 포함.
  const cells = $derived.by<Cell[]>(() => {
    const firstOfMonth = new Date(year, month - 1, 1);
    const leadBlanks = firstOfMonth.getDay();
    const start = new Date(year, month - 1, 1 - leadBlanks);
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const info = getDayInfo(d);
      const iso = isoFor(d);
      out.push({
        date: d,
        day: d.getDate(),
        inMonth: d.getMonth() === month - 1,
        isToday: today ? sameDay(d, today) : false,
        isSelected: selectedDate ? sameDay(d, selectedDate) : false,
        dow: d.getDay(),
        lunarShort: info.lunar
          ? lunarShort(info.lunar.month, info.lunar.day, info.lunar.intercalation)
          : null,
        chineseDay: chineseDayGanji(info.lunar?.chinese_gapja),
        jeolgiName: info.jeolgi.daysSince === 0 ? info.jeolgi.current.name : null,
        jeolgiHanja: info.jeolgi.daysSince === 0 ? info.jeolgi.current.hanja : null,
        events: occurrencesByDate.get(iso) ?? [],
      });
    }
    return out;
  });

  // '오늘' 버튼 active: 현재 표시 월에 오늘이 포함될 때만. (선택 날짜와 무관 — 다른 달 이동 시 무조건 비활성)
  const todayInDisplay = $derived(
    !!today && today.getFullYear() === year && today.getMonth() + 1 === month,
  );

  type DetailView = {
    solar: string;        // "2026년 5월 30일"
    weekday: string;      // "토"
    lunar: string | null; // "4월 11일"
    gapja: string | null; // "丙午년 癸巳월 甲辰일"
    jeolgi: { name: string; hanja: string } | null;
    isToday: boolean;
  };

  const detail = $derived.by<DetailView | null>(() => {
    if (!selectedDate) return null;
    const info = getDayInfo(selectedDate);
    const gapja = info.lunar
      ? info.lunar.chinese_gapja
          .replace(/年/g, "년")
          .replace(/月/g, "월")
          .replace(/日/g, "일")
      : null;
    return {
      solar: info.solar.ymd,
      weekday: WEEKDAYS[selectedDate.getDay()],
      lunar: info.lunar ? formatLunarKo(info.lunar) : null,
      gapja,
      jeolgi:
        info.jeolgi.daysSince === 0
          ? { name: info.jeolgi.current.name, hanja: info.jeolgi.current.hanja }
          : null,
      isToday: !!today && sameDay(selectedDate, today),
    };
  });

  /** 선택 날짜에 해당하는 occurrence 들 — 상세박스 하단 events row 용. */
  const detailEvents = $derived<OccurrenceEvent[]>(
    selectedDate ? (occurrencesByDate.get(isoFor(selectedDate)) ?? []) : [],
  );
</script>

<div class="calendar">
  <div class="nav" role="toolbar" aria-label="달력 탐색">
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 년" onclick={() => shiftYear(-1)}>‹</button>
      <span class="label-wrap year-label">
        <span class="label-text">{year}년</span>
        <select
          aria-label="년 선택"
          value={year}
          onchange={(e) => setYear(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each YEAR_OPTIONS as y}
            <option value={y}>{y}년</option>
          {/each}
        </select>
      </span>
      <button type="button" class="step" aria-label="다음 년" onclick={() => shiftYear(1)}>›</button>
    </div>
    <button
      type="button"
      class="today-btn"
      class:active={todayInDisplay}
      onclick={goToday}
    >오늘</button>
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 월" onclick={() => shiftMonth(-1)}>‹</button>
      <span class="label-wrap month-label">
        <span class="label-text">{month}월</span>
        <select
          aria-label="월 선택"
          value={month}
          onchange={(e) => setMonth(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each MONTH_OPTIONS as m}
            <option value={m}>{m}월</option>
          {/each}
        </select>
      </span>
      <button type="button" class="step" aria-label="다음 월" onclick={() => shiftMonth(1)}>›</button>
    </div>
  </div>

  {#if detail}
    <div class="detail-box" class:is-today={detail.isToday}>
      <div class="detail-line primary">
        <span class="d-solar">{detail.solar}</span>
        <span class="d-weekday">({detail.weekday})</span>
        {#if detail.lunar}
          <span class="dot" aria-hidden="true">·</span>
          <span class="d-lunar">{detail.lunar}</span>
        {/if}
        {#if detail.jeolgi}
          <span class="d-jeolgi" title={detail.jeolgi.hanja}>{detail.jeolgi.name}</span>
        {/if}
      </div>
      {#if detail.gapja}
        <div class="detail-line gapja">{detail.gapja}</div>
      {/if}
      {#if detailEvents.length > 0}
        <div class="detail-events">
          {#each detailEvents as occ (occ.source.id + "@" + occ.occursOn)}
            {@const cat = occ.source.category}
            {@const lunar = lunarShortFromSource(occ.source)}
            <span
              class="ev-pill {categoryBadgeClass(cat)}"
              title={`${categoryFullLabel(cat)} · ${occ.source.title}`}
            >
              <span class="ev-cat">{categoryFullLabel(cat)}</span>
              <span class="ev-title">{occ.source.title}</span>
              {#if lunar}
                <span class="ev-lunar">(음 {lunar})</span>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid-scroll">
    <div class="month-grid">
      <div class="weekday-row" aria-hidden="true">
        {#each WEEKDAYS as w, i}
          <div class="weekday" class:sun={i === 0} class:sat={i === 6}>{w}</div>
        {/each}
      </div>
      <div class="days" role="grid" aria-label={`${year}년 ${month}월 달력`}>
        {#each cells as c (c.date.getTime())}
          <button
            type="button"
            class="cell"
            class:out={!c.inMonth}
            class:today={c.isToday}
            class:selected={c.isSelected}
            class:sun={c.dow === 0}
            class:sat={c.dow === 6}
            onclick={() => selectCell(c.date)}
          >
            <div class="cell-head">
              <span class="solar">{c.day}</span>
              {#if c.chineseDay}
                <span class="chinese-day">{c.chineseDay}</span>
              {/if}
            </div>
            {#if c.lunarShort}
              <span class="lunar">{c.lunarShort}</span>
            {/if}
            {#if c.jeolgiName}
              <span class="jeolgi" title={c.jeolgiHanja ?? ""}>{c.jeolgiName}</span>
            {/if}
            {#if c.events.length > 0}
              <div class="ev-titles" aria-label={`일정 ${c.events.length}건`}>
                {#each c.events.slice(0, 2) as occ (occ.source.id + "@" + occ.occursOn)}
                  <span
                    class="ev-title-pill {categoryBadgeClass(occ.source.category)}"
                    title={`${categoryFullLabel(occ.source.category)} · ${occ.source.title}`}
                  >{occ.source.title}</span>
                {/each}
                {#if c.events.length > 2}
                  <span class="ev-more">+{c.events.length - 2}</span>
                {/if}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  /* ─── Nav ─────────────────────────────────────────── */
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    flex-wrap: nowrap;
  }
  .nav-group {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    padding: 0.15rem 0.25rem;
    flex-shrink: 0;
  }
  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.35rem;
    background: transparent;
    border: none;
    border-radius: 999px;
    color: var(--color-fg, #1f1c1a);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
  }
  .step:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    color: var(--color-primary, #a8352a);
  }

  .label-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.45rem;
    min-width: 3.5rem;
    height: 1.6rem;
    border-radius: 999px;
    cursor: pointer;
  }
  .label-wrap:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 6%, transparent);
  }
  .label-wrap.year-label {
    min-width: 4.2rem;
  }
  .label-text {
    font-weight: 600;
    color: var(--color-fg, #1f1c1a);
    pointer-events: none;
  }
  .label-wrap select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
  }

  .today-btn {
    padding: 0.25rem 0.85rem;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    color: var(--color-fg, #1f1c1a);
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }
  .today-btn:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 10%, transparent);
    color: var(--color-primary, #a8352a);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 30%, var(--color-rule, #e8dfd9));
  }
  .today-btn.active {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, var(--color-surface, #fff));
    color: var(--color-primary, #a8352a);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 45%, var(--color-rule, #e8dfd9));
  }

  /* ─── Detail box ──────────────────────────────────── */
  .detail-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem 0.9rem;
    background: color-mix(in srgb, var(--color-muted, #8a807a) 8%, var(--color-surface, #fff));
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    font-size: 0.92rem;
  }
  .detail-box.is-today {
    background: linear-gradient(135deg, #fff7d6 0%, #ffe9a3 100%);
    border-color: #e6b94c;
  }
  .detail-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
  }
  .d-solar {
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .detail-box.is-today .d-solar {
    color: #6e4a00;
  }
  .d-weekday {
    color: var(--color-muted, #8a807a);
  }
  .detail-box.is-today .d-weekday {
    color: #8a6310;
  }
  .d-lunar {
    color: var(--color-fg, #1f1c1a);
  }
  .detail-box.is-today .d-lunar {
    color: #6e4a00;
  }
  .d-jeolgi {
    margin-left: 0.35rem;
    padding: 0.08rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, transparent);
    color: var(--color-primary, #a8352a);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .detail-box.is-today .d-jeolgi {
    background: rgba(168, 53, 42, 0.18);
    color: #8b2a20;
  }
  .gapja {
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.02em;
    font-size: 0.86rem;
  }
  .detail-box.is-today .gapja {
    color: #7c5410;
  }
  .dot {
    color: var(--color-muted, #8a807a);
    opacity: 0.6;
  }

  /* ─── Grid scroller ──────────────────────────────── */
  .grid-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: 12px;
  }
  .month-grid {
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 12px;
    overflow: hidden;
    background: var(--color-surface, #fff);
    min-width: 360px;
  }
  .weekday-row,
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .weekday-row {
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-bg, #fbf8f4);
  }
  .weekday {
    padding: 0.5rem 0;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--color-muted, #8a807a);
  }
  .weekday.sun {
    color: var(--color-primary, #a8352a);
  }
  .weekday.sat {
    color: #3a6ea5;
  }

  /* ─── Cell ────────────────────────────────────────── */
  .cell {
    all: unset;
    box-sizing: border-box;
    min-height: 88px;
    padding: 0.4rem 0.45rem 0.5rem;
    border-right: 1px solid var(--color-rule, #e8dfd9);
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    position: relative;
    cursor: pointer;
    background: var(--color-surface, #fff);
  }
  .cell:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: -2px;
  }
  .cell:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 4%, var(--color-surface, #fff));
  }
  .cell:nth-child(7n) {
    border-right: none;
  }
  .cell.out {
    background: color-mix(in srgb, var(--color-bg, #fbf8f4) 60%, var(--color-surface, #fff));
    color: var(--color-muted, #8a807a);
  }
  .cell.today {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    box-shadow: inset 0 0 0 2px var(--color-primary, #a8352a);
  }
  /* 다른 날짜 선택 — 청록 계열 테두리로 오늘(빨강)과 구분 */
  .cell.selected:not(.today) {
    box-shadow: inset 0 0 0 2px var(--color-secondary, #1e6e6e);
  }

  .cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem;
  }
  .solar {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
    line-height: 1.1;
  }
  .cell.out .solar {
    color: color-mix(in srgb, var(--color-muted, #8a807a) 80%, transparent);
    font-weight: 600;
  }
  .cell.sun:not(.out) .solar {
    color: var(--color-primary, #a8352a);
  }
  .cell.sat:not(.out) .solar {
    color: #3a6ea5;
  }
  .chinese-day {
    font-size: 0.7rem;
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .cell.out .chinese-day {
    opacity: 0.6;
  }
  .lunar {
    font-size: 0.72rem;
    color: var(--color-muted, #8a807a);
    line-height: 1.1;
  }
  .cell.out .lunar {
    opacity: 0.7;
  }
  .jeolgi {
    align-self: flex-start;
    margin-top: 0.15rem;
    padding: 0.08rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, transparent);
    color: var(--color-primary, #a8352a);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .cell.out .jeolgi {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    color: color-mix(in srgb, var(--color-primary, #a8352a) 65%, var(--color-muted, #8a807a));
  }
  /* ─── Cell event titles (replace dots) ─────────────── */
  .ev-titles {
    margin-top: auto;
    padding-top: 0.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .ev-title-pill {
    display: block;
    width: 100%;
    padding: 0.05rem 0.32rem;
    border-radius: 3px;
    font-size: 0.64rem;
    font-weight: 600;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.01em;
  }
  .cell.out .ev-title-pill {
    opacity: 0.6;
  }
  .ev-more {
    align-self: flex-start;
    padding: 0 0.2rem;
    font-size: 0.6rem;
    color: var(--color-muted, #8a807a);
    line-height: 1.2;
  }

  /* ─── Detail-box events row ────────────────────────── */
  .detail-events {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.15rem;
    padding-top: 0.45rem;
    border-top: 1px dashed color-mix(in srgb, var(--color-rule, #e8dfd9) 80%, transparent);
  }
  .ev-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem 0.12rem;
    border-radius: 4px;
    font-size: 0.78rem;
    line-height: 1.3;
  }
  .ev-pill .ev-cat {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    opacity: 0.85;
  }
  .ev-pill .ev-title {
    font-weight: 600;
  }
  .ev-pill .ev-lunar {
    font-size: 0.7rem;
    opacity: 0.78;
  }

  /* ─── Category palette — 셀·상세박스 통일 ─────────── */
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

  /* ─── Mobile ──────────────────────────────────────── */
  @media (max-width: 600px) {
    .nav {
      gap: 0.35rem;
    }
    .nav-group {
      padding: 0.1rem 0.2rem;
    }
    .step {
      min-width: 1.4rem;
      height: 1.4rem;
      font-size: 0.9rem;
      padding: 0 0.25rem;
    }
    .label-wrap {
      padding: 0 0.3rem;
      min-width: 3rem;
      height: 1.4rem;
      font-size: 0.88rem;
    }
    .label-wrap.year-label {
      min-width: 3.6rem;
    }
    .today-btn {
      padding: 0.2rem 0.6rem;
      font-size: 0.82rem;
    }
    .detail-box {
      font-size: 0.86rem;
      padding: 0.55rem 0.7rem;
    }
    .gapja {
      font-size: 0.8rem;
    }
    .cell {
      min-height: 70px;
      padding: 0.28rem 0.3rem 0.36rem;
    }
    .cell-head {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.05rem;
    }
    .solar {
      font-size: 0.82rem;
    }
    .chinese-day {
      font-size: 0.6rem;
      letter-spacing: 0.02em;
    }
    .lunar {
      font-size: 0.62rem;
    }
    .jeolgi {
      font-size: 0.58rem;
      padding: 0.03rem 0.32rem;
    }
    .ev-title-pill {
      font-size: 0.58rem;
      padding: 0.03rem 0.24rem;
    }
    .ev-more {
      font-size: 0.54rem;
    }
    .ev-pill {
      font-size: 0.72rem;
      padding: 0.08rem 0.4rem;
    }
    .ev-pill .ev-cat {
      font-size: 0.6rem;
    }
    .ev-pill .ev-lunar {
      font-size: 0.64rem;
    }
  }

  @media (prefers-color-scheme: dark) {
    .weekday.sat,
    .cell.sat:not(.out) .solar {
      color: #7da9d6;
    }
    .detail-box.is-today {
      background: linear-gradient(135deg, #4a3a10 0%, #6b5118 100%);
      border-color: #b89544;
    }
    .detail-box.is-today .d-solar,
    .detail-box.is-today .d-lunar {
      color: #ffe9a3;
    }
    .detail-box.is-today .d-weekday {
      color: #d4b85e;
    }
    .detail-box.is-today .gapja {
      color: #c9a850;
    }
    .detail-box.is-today .d-jeolgi {
      background: rgba(255, 200, 180, 0.18);
      color: #ffc9b0;
    }
  }
</style>
