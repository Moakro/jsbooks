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
  let selectedDate = $state<Date | null>(null);

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  onMount(() => {
    const now = new Date();
    today = now;
    // URL query 우선 — 새로고침 후에도 동일 월 유지.
    const params = new URLSearchParams(location.search);
    const qy = Number(params.get("y"));
    const qm = Number(params.get("m"));
    if (Number.isInteger(qy) && qy >= 1900 && qy <= 2200) year = qy;
    if (Number.isInteger(qm) && qm >= 1 && qm <= 12) month = qm;
    // 초기 선택일: 표시 월이 오늘 포함하면 오늘, 아니면 해당 월 1일.
    if (now.getFullYear() === year && now.getMonth() + 1 === month) {
      selectedDate = now;
    } else {
      selectedDate = new Date(year, month - 1, 1);
    }
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
    selectedDate = pickDefaultForMonth(y, m);
    pushState(y, m);
  }

  function shiftYear(delta: number) {
    year += delta;
    selectedDate = pickDefaultForMonth(year, month);
    pushState(year, month);
  }

  function goToday() {
    const now = new Date();
    today = now;
    year = now.getFullYear();
    month = now.getMonth() + 1;
    selectedDate = now;
    pushState(year, month);
  }

  function pickDefaultForMonth(y: number, m: number): Date {
    if (today && today.getFullYear() === y && today.getMonth() + 1 === m) {
      return today;
    }
    return new Date(y, m - 1, 1);
  }

  function selectCell(d: Date) {
    selectedDate = d;
    const ny = d.getFullYear();
    const nm = d.getMonth() + 1;
    if (ny !== year || nm !== month) {
      year = ny;
      month = nm;
      pushState(year, month);
    }
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

  // 1–30 → 한자 숫자 (一, 二, …, 十, 十一, …, 二十, 二十一, …, 三十)
  function toChineseNumeral(n: number): string {
    const digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (n <= 0) return String(n);
    if (n < 10) return digits[n];
    if (n === 10) return "十";
    if (n < 20) return "十" + digits[n - 10];
    if (n === 20) return "二十";
    if (n < 30) return "二十" + digits[n - 20];
    if (n === 30) return "三十";
    return String(n);
  }

  // "丁酉年 丙午月 戊子日" → "丁酉년 丙午월 戊子일"
  function chineseGapjaKo(chinese_gapja: string | null): string | null {
    if (!chinese_gapja) return null;
    return chinese_gapja
      .replace(/年/g, "년")
      .replace(/月/g, "월")
      .replace(/日/g, "일");
  }

  type Cell = {
    date: Date;
    day: number;
    inMonth: boolean;
    isToday: boolean;
    dow: number; // 0=일 6=토
    lunarShort: string | null;
    chineseDay: string | null;
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
        jeolgiName: info.jeolgi.daysSince === 0 ? info.jeolgi.current.name : null,
        jeolgiHanja: info.jeolgi.daysSince === 0 ? info.jeolgi.current.hanja : null,
      });
    }
    return out;
  });

  // 표시 중인 월이 오늘을 포함하는가 — 오늘 버튼 active 상태에 사용.
  const isCurrentMonth = $derived(
    !!today && today.getFullYear() === year && today.getMonth() + 1 === month,
  );

  // 선택된 날짜 상세 정보.
  type SelectedInfo = {
    solar: string;     // "2026년 5월 30일 (토)"
    lunar: string;     // "4월(四) 十四" 또는 "윤 4월(四) 十四"
    gapjaKo: string;   // "丙午년 癸巳월 甲辰일"
    jeolgiName: string | null;
    jeolgiHanja: string | null;
    isToday: boolean;
  };

  const selectedInfo = $derived.by<SelectedInfo | null>(() => {
    if (!selectedDate) return null;
    const d = selectedDate;
    const info = getDayInfo(d);
    const dow = WEEKDAYS[d.getDay()];
    const solar = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`;
    let lunar = "";
    if (info.lunar) {
      const leap = info.lunar.intercalation ? "윤 " : "";
      const m = info.lunar.month;
      const dd = info.lunar.day;
      lunar = `${leap}${m}월(${toChineseNumeral(m)}) ${toChineseNumeral(dd)}`;
    }
    return {
      solar,
      lunar,
      gapjaKo: chineseGapjaKo(info.lunar?.chinese_gapja ?? null) ?? "",
      jeolgiName: info.jeolgi.daysSince === 0 ? info.jeolgi.current.name : null,
      jeolgiHanja: info.jeolgi.daysSince === 0 ? info.jeolgi.current.hanja : null,
      isToday: today ? sameDay(d, today) : false,
    };
  });
</script>

<div class="calendar">
  <div class="nav" role="toolbar" aria-label="달력 탐색">
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 년" onclick={() => shiftYear(-1)}>‹</button>
      <span class="label year-label">{year}년</span>
      <button type="button" class="step" aria-label="다음 년" onclick={() => shiftYear(1)}>›</button>
    </div>
    <button
      type="button"
      class="today-btn"
      class:active={isCurrentMonth}
      onclick={goToday}
    >오늘</button>
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 월" onclick={() => shiftMonth(-1)}>‹</button>
      <span class="label month-label">{month}월</span>
      <button type="button" class="step" aria-label="다음 월" onclick={() => shiftMonth(1)}>›</button>
    </div>
  </div>

  {#if selectedInfo}
    <div class="detail-box" class:today={selectedInfo.isToday}>
      <div class="detail-line line-1">
        <span class="d-solar">{selectedInfo.solar}</span>
        {#if selectedInfo.lunar}
          <span class="dot" aria-hidden="true">·</span>
          <span class="d-lunar">{selectedInfo.lunar}</span>
        {/if}
        {#if selectedInfo.jeolgiName}
          <span class="jeolgi-badge" title={selectedInfo.jeolgiHanja ?? ""}>
            {selectedInfo.jeolgiName}
            {#if selectedInfo.jeolgiHanja}<span class="jeolgi-hanja">({selectedInfo.jeolgiHanja})</span>{/if}
          </span>
        {/if}
      </div>
      {#if selectedInfo.gapjaKo}
        <div class="detail-line line-2">
          <span class="d-gapja">{selectedInfo.gapjaKo}</span>
        </div>
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
          class:selected={selectedDate ? sameDay(c.date, selectedDate) : false}
          class:sun={c.dow === 0}
          class:sat={c.dow === 6}
          role="gridcell"
          tabindex="0"
          onclick={() => selectCell(c.date)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectCell(c.date);
            }
          }}
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
    flex-wrap: nowrap;
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
  .today-btn.active {
    background: var(--color-primary, #a8352a);
    border-color: var(--color-primary, #a8352a);
    color: #fff;
  }
  .today-btn.active:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 90%, #000);
    color: #fff;
  }

  /* 선택된 날짜 상세 박스 — 오늘이면 황색, 다른 날짜면 회색 그라데이션 */
  .detail-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem 0.9rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    background: linear-gradient(135deg, #f5f2ee 0%, #ece7e0 100%);
  }
  .detail-box.today {
    background: linear-gradient(135deg, #fff7d6 0%, #fde9a4 100%);
    border-color: #e9c879;
  }
  .detail-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.95rem;
  }
  .d-solar {
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .d-lunar {
    color: var(--color-fg, #1f1c1a);
  }
  .d-gapja {
    color: var(--color-muted, #6b5d52);
    letter-spacing: 0.04em;
    font-size: 0.9rem;
  }
  .detail-box.today .d-gapja {
    color: #6b5b1f;
  }
  .dot {
    color: var(--color-muted, #8a807a);
    opacity: 0.6;
  }
  .jeolgi-badge {
    margin-left: auto;
    padding: 0.12rem 0.55rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 14%, transparent);
    color: var(--color-primary, #a8352a);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .jeolgi-hanja {
    font-weight: 600;
    opacity: 0.85;
    margin-left: 0.15rem;
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
    cursor: pointer;
    background: transparent;
    transition: background-color 0.12s ease;
  }
  .cell:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 5%, transparent);
  }
  .cell:focus-visible {
    outline: 2px solid var(--color-primary, #a8352a);
    outline-offset: -2px;
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
  .cell.selected:not(.today) {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 6%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary, #a8352a) 55%, transparent);
  }

  .cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.25rem;
  }
  .solar {
    font-size: 0.95rem;
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

  @media (max-width: 600px) {
    .nav {
      gap: 0.35rem;
    }
    .nav-group {
      padding: 0.1rem 0.15rem;
      gap: 0.05rem;
    }
    .step {
      min-width: 1.35rem;
      height: 1.35rem;
      padding: 0 0.2rem;
      font-size: 0.9rem;
    }
    .label {
      min-width: 2.4rem;
      padding: 0 0.15rem;
      font-size: 0.88rem;
    }
    .year-label {
      min-width: 3rem;
    }
    .today-btn {
      padding: 0.15rem 0.55rem;
      font-size: 0.78rem;
    }

    .detail-box {
      padding: 0.55rem 0.7rem;
    }
    .detail-line {
      font-size: 0.85rem;
      gap: 0.3rem;
    }
    .d-gapja {
      font-size: 0.8rem;
    }
    .jeolgi-badge {
      font-size: 0.68rem;
      padding: 0.08rem 0.4rem;
    }

    .cell {
      min-height: 64px;
      padding: 0.25rem 0.28rem 0.35rem;
      gap: 0.12rem;
    }
    .cell-head {
      gap: 0.15rem;
    }
    .solar {
      font-size: 0.82rem;
    }
    .chinese-day {
      font-size: 0.6rem;
      letter-spacing: 0;
    }
    .lunar {
      font-size: 0.62rem;
    }
    .jeolgi {
      font-size: 0.58rem;
      padding: 0.04rem 0.32rem;
    }
  }

  @media (max-width: 380px) {
    .label {
      min-width: 2.1rem;
      font-size: 0.82rem;
    }
    .year-label {
      min-width: 2.7rem;
    }
    .today-btn {
      padding: 0.12rem 0.45rem;
      font-size: 0.72rem;
    }
    .chinese-day {
      font-size: 0.56rem;
    }
  }

  @media (prefers-color-scheme: dark) {
    .weekday.sat,
    .cell.sat:not(.out) .solar {
      color: #7da9d6;
    }
    .detail-box {
      background: linear-gradient(135deg, #2a2622 0%, #1f1c19 100%);
      border-color: #3a342f;
    }
    .detail-box.today {
      background: linear-gradient(135deg, #4a3c12 0%, #382c0c 100%);
      border-color: #7a5f1c;
      color: #f5e9c4;
    }
    .detail-box.today .d-solar,
    .detail-box.today .d-lunar {
      color: #fae8b5;
    }
    .detail-box.today .d-gapja {
      color: #d6b66a;
    }
  }
</style>
