<script lang="ts">
  import { onMount } from "svelte";
  import { getDayInfo } from "../../lib/date";

  interface Props {
    initialYear: number;
    initialMonth: number; // 1–12
  }

  const { initialYear, initialMonth }: Props = $props();

  let year = $state(initialYear);
  let month = $state(initialMonth);
  let today = $state<Date | null>(null);

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  onMount(() => {
    today = new Date();
    // URL query 우선 — 새로고침 후에도 동일 월 유지.
    const params = new URLSearchParams(location.search);
    const qy = Number(params.get("y"));
    const qm = Number(params.get("m"));
    if (Number.isInteger(qy) && qy >= 1900 && qy <= 2200) year = qy;
    if (Number.isInteger(qm) && qm >= 1 && qm <= 12) month = qm;
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

  function goToday() {
    const now = new Date();
    today = now;
    year = now.getFullYear();
    month = now.getMonth() + 1;
    pushState(year, month);
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
    dow: number; // 0=일 6=토
    lunarShort: string | null;
    chineseDay: string | null;
    chineseMonth: string | null;
    chineseYear: string | null;
    koreanGapja: string | null;
    jeolgiName: string | null;
    jeolgiHanja: string | null;
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
      const cgParts = info.lunar?.chinese_gapja.split(" ") ?? [];
      out.push({
        date: d,
        day: d.getDate(),
        inMonth: d.getMonth() === month - 1,
        isToday: today ? sameDay(d, today) : false,
        dow: d.getDay(),
        lunarShort: info.lunar
          ? lunarShort(info.lunar.month, info.lunar.day, info.lunar.intercalation)
          : null,
        chineseDay: chineseDayGanji(info.lunar?.chinese_gapja),
        chineseMonth: cgParts[1]?.replace(/月$/, "") ?? null,
        chineseYear: cgParts[0]?.replace(/年$/, "") ?? null,
        koreanGapja: info.lunar?.korean_gapja ?? null,
        jeolgiName: info.jeolgi.daysSince === 0 ? info.jeolgi.current.name : null,
        jeolgiHanja: info.jeolgi.daysSince === 0 ? info.jeolgi.current.hanja : null,
      });
    }
    return out;
  });

  // 선택 월 안에 오늘이 있으면 상단 강조 박스에 노출.
  const todayCell = $derived.by(() =>
    today && today.getFullYear() === year && today.getMonth() + 1 === month
      ? cells.find((c) => c.isToday) ?? null
      : null,
  );
</script>

<div class="calendar">
  <div class="nav" role="toolbar" aria-label="달력 탐색">
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 년" onclick={() => shiftYear(-1)}>‹</button>
      <span class="label year-label">{year}년</span>
      <button type="button" class="step" aria-label="다음 년" onclick={() => shiftYear(1)}>›</button>
    </div>
    <button type="button" class="today-btn" onclick={goToday}>오늘</button>
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 월" onclick={() => shiftMonth(-1)}>‹</button>
      <span class="label month-label">{month}월</span>
      <button type="button" class="step" aria-label="다음 월" onclick={() => shiftMonth(1)}>›</button>
    </div>
  </div>

  {#if todayCell}
    <div class="today-strip">
      <span class="t-solar">{year}년 {month}월 {todayCell.day}일</span>
      <span class="t-weekday">({WEEKDAYS[todayCell.dow]})</span>
      {#if todayCell.lunarShort}
        <span class="dot" aria-hidden="true">·</span>
        <span class="t-lunar">음 {todayCell.lunarShort}</span>
      {/if}
      {#if todayCell.koreanGapja}
        <span class="dot" aria-hidden="true">·</span>
        <span class="t-gapja">{todayCell.koreanGapja}</span>
      {/if}
    </div>
  {/if}

  <div class="month-grid">
    <div class="weekday-row" aria-hidden="true">
      {#each WEEKDAYS as w, i}
        <div class="weekday" class:sun={i === 0} class:sat={i === 6}>{w}</div>
      {/each}
    </div>
    <div class="days" role="grid" aria-label={`${year}년 ${month}월 달력`}>
      {#each cells as c (c.date.getTime())}
        <div
          class="cell"
          class:out={!c.inMonth}
          class:today={c.isToday}
          class:sun={c.dow === 0}
          class:sat={c.dow === 6}
          role="gridcell"
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
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .calendar {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
  .nav-group {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 999px;
    padding: 0.15rem 0.25rem;
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
  .label {
    min-width: 3.5rem;
    padding: 0 0.35rem;
    text-align: center;
    font-weight: 600;
    color: var(--color-fg, #1f1c1a);
  }
  .year-label {
    min-width: 4.2rem;
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
  }
  .today-btn:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 10%, transparent);
    color: var(--color-primary, #a8352a);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 30%, var(--color-rule, #e8dfd9));
  }

  .today-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.55rem 0.85rem;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary, #a8352a) 22%, var(--color-rule, #e8dfd9));
    border-radius: 8px;
    font-size: 0.92rem;
  }
  .t-solar {
    font-weight: 700;
    color: var(--color-primary, #a8352a);
  }
  .t-weekday {
    color: var(--color-muted, #8a807a);
  }
  .t-lunar {
    color: var(--color-fg, #1f1c1a);
  }
  .t-gapja {
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.02em;
  }
  .dot {
    color: var(--color-muted, #8a807a);
    opacity: 0.6;
  }

  .month-grid {
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 12px;
    overflow: hidden;
    background: var(--color-surface, #fff);
  }
  .weekday-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
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

  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
  }
  .cell {
    min-height: 92px;
    padding: 0.4rem 0.45rem 0.5rem;
    border-right: 1px solid var(--color-rule, #e8dfd9);
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    position: relative;
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

  .cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem;
  }
  .solar {
    font-size: 1.05rem;
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
    font-size: 0.72rem;
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.04em;
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

  @media (max-width: 600px) {
    .cell {
      min-height: 64px;
      padding: 0.25rem 0.28rem 0.35rem;
    }
    .solar {
      font-size: 0.95rem;
    }
    .chinese-day {
      display: none;
    }
    .lunar {
      font-size: 0.66rem;
    }
    .jeolgi {
      font-size: 0.6rem;
      padding: 0.04rem 0.35rem;
    }
    .today-strip {
      font-size: 0.85rem;
      padding: 0.45rem 0.7rem;
    }
  }

  @media (prefers-color-scheme: dark) {
    .weekday.sat,
    .cell.sat:not(.out) .solar {
      color: #7da9d6;
    }
  }
</style>
