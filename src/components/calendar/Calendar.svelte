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
    // 선택 날짜는 오늘로 초기화(현재 월에 오늘이 없으면 그 월 1일).
    selectedDate =
      year === now.getFullYear() && month === now.getMonth() + 1
        ? now
        : new Date(year, month - 1, 1);
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
    selectedDate = now;
    pushState(year, month);
  }

  function selectCell(d: Date) {
    selectedDate = d;
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
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

  // 한자 숫자(일·월 표기용) — 1~31, 1~12 커버.
  const CN_DIGITS = ["○", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  function toChineseNumeral(n: number): string {
    if (n <= 0) return "";
    if (n < 10) return CN_DIGITS[n];
    if (n === 10) return "十";
    if (n < 20) return "十" + CN_DIGITS[n - 10];
    if (n === 20) return "二十";
    if (n < 30) return "二十" + CN_DIGITS[n - 20];
    if (n === 30) return "三十";
    return "三十" + CN_DIGITS[n - 30];
  }

  // 음력 상세 — "4월(四) 十四" 형태
  function lunarDetail(m: number, d: number, leap: boolean): string {
    const lp = leap ? "윤" : "";
    return `${lp}${m}월(${toChineseNumeral(m)}) ${toChineseNumeral(d)}`;
  }

  // 한자 간지 → "丙午년 癸巳월 甲辰일"
  function gapjaKo(chinese_gapja: string | null | undefined): string | null {
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

  // 상세박스용 — 선택된 날짜 정보 (없으면 null).
  const detail = $derived.by(() => {
    if (!selectedDate) return null;
    const info = getDayInfo(selectedDate);
    const lunar = info.lunar;
    const isToday = today ? sameDay(selectedDate, today) : false;
    const isJeolgi = info.jeolgi.daysSince === 0;
    return {
      date: selectedDate,
      isToday,
      solar: `${selectedDate.getFullYear()}년 ${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일`,
      weekday: WEEKDAYS[selectedDate.getDay()],
      lunarDetail: lunar ? lunarDetail(lunar.month, lunar.day, lunar.intercalation) : null,
      gapja: gapjaKo(lunar?.chinese_gapja),
      jeolgiName: isJeolgi ? info.jeolgi.current.name : null,
      jeolgiHanja: isJeolgi ? info.jeolgi.current.hanja : null,
    };
  });

  // 오늘 버튼 active — 현재 보고 있는 년/월에 오늘이 포함되면.
  const todayActive = $derived(
    !!today && today.getFullYear() === year && today.getMonth() + 1 === month,
  );
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
      class:active={todayActive}
      onclick={goToday}
      aria-pressed={todayActive}
    >오늘</button>
    <div class="nav-group">
      <button type="button" class="step" aria-label="이전 월" onclick={() => shiftMonth(-1)}>‹</button>
      <span class="label month-label">{month}월</span>
      <button type="button" class="step" aria-label="다음 월" onclick={() => shiftMonth(1)}>›</button>
    </div>
  </div>

  {#if detail}
    <div class="detail" class:today={detail.isToday}>
      <div class="detail-row solar-row">
        <span class="d-solar">{detail.solar}</span>
        <span class="d-weekday">({detail.weekday})</span>
        {#if detail.lunarDetail}
          <span class="dot" aria-hidden="true">·</span>
          <span class="d-lunar">{detail.lunarDetail}</span>
        {/if}
      </div>
      <div class="detail-row gapja-row">
        {#if detail.gapja}
          <span class="d-gapja">{detail.gapja}</span>
        {/if}
        {#if detail.jeolgiName}
          <span class="d-jeolgi" title={detail.jeolgiHanja ?? ""}>
            {detail.jeolgiName}
            {#if detail.jeolgiHanja}<span class="d-jeolgi-hanja">{detail.jeolgiHanja}</span>{/if}
          </span>
        {/if}
      </div>
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
        <button
          type="button"
          class="cell"
          class:out={!c.inMonth}
          class:today={c.isToday}
          class:selected={selectedDate ? sameDay(c.date, selectedDate) : false}
          class:sun={c.dow === 0}
          class:sat={c.dow === 6}
          aria-label={`${c.date.getFullYear()}년 ${c.date.getMonth() + 1}월 ${c.day}일`}
          aria-pressed={selectedDate ? sameDay(c.date, selectedDate) : false}
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
        </button>
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
    flex-shrink: 0;
  }
  .today-btn:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 10%, transparent);
    color: var(--color-primary, #a8352a);
    border-color: color-mix(in srgb, var(--color-primary, #a8352a) 30%, var(--color-rule, #e8dfd9));
  }
  .today-btn.active {
    background: var(--color-primary, #a8352a);
    color: #fff;
    border-color: var(--color-primary, #a8352a);
  }
  .today-btn.active:hover {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 88%, #000);
    color: #fff;
    border-color: var(--color-primary, #a8352a);
  }

  /* 상세박스 — 기본(회색) */
  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem 0.95rem;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-muted, #8a807a) 8%, var(--color-surface, #fff)) 0%,
      color-mix(in srgb, var(--color-muted, #8a807a) 4%, var(--color-surface, #fff)) 100%
    );
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    font-size: 0.92rem;
  }
  /* 상세박스 — 오늘(황색) */
  .detail.today {
    background: linear-gradient(135deg, #fff4cc 0%, #ffe9a3 100%);
    border-color: #e8c869;
  }
  .detail-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
  }
  .gapja-row {
    justify-content: space-between;
  }
  .d-solar {
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .detail.today .d-solar {
    color: #6b4f00;
  }
  .d-weekday {
    color: var(--color-muted, #8a807a);
  }
  .detail.today .d-weekday {
    color: #8a6a14;
  }
  .d-lunar {
    color: var(--color-fg, #1f1c1a);
    letter-spacing: 0.02em;
  }
  .detail.today .d-lunar {
    color: #6b4f00;
  }
  .d-gapja {
    color: var(--color-fg, #1f1c1a);
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .detail.today .d-gapja {
    color: #6b4f00;
  }
  .d-jeolgi {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    padding: 0.1rem 0.55rem;
    background: var(--color-primary, #a8352a);
    color: #fff;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .d-jeolgi-hanja {
    opacity: 0.85;
    font-weight: 500;
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
    background: transparent;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    position: relative;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .cell:nth-child(7n) {
    border-right: none;
  }
  .cell:hover:not(.selected):not(.today) {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 5%, transparent);
  }
  .cell.out {
    background: color-mix(in srgb, var(--color-bg, #fbf8f4) 60%, var(--color-surface, #fff));
    color: var(--color-muted, #8a807a);
  }
  .cell.today {
    background: color-mix(in srgb, #f5b800 14%, transparent);
    box-shadow: inset 0 0 0 2px #e8c869;
  }
  .cell.selected:not(.today) {
    box-shadow: inset 0 0 0 2px var(--color-primary, #a8352a);
    background: color-mix(in srgb, var(--color-primary, #a8352a) 6%, transparent);
  }
  .cell.selected.today {
    box-shadow: inset 0 0 0 2px var(--color-primary, #a8352a);
  }

  .cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.3rem;
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
    font-size: 0.72rem;
    color: var(--color-muted, #8a807a);
    letter-spacing: 0.04em;
    font-weight: 600;
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
      flex-wrap: nowrap;
    }
    .nav-group {
      padding: 0.1rem 0.15rem;
      gap: 0.05rem;
    }
    .step {
      min-width: 1.35rem;
      height: 1.35rem;
      padding: 0 0.2rem;
      font-size: 0.92rem;
    }
    .label {
      min-width: 2.8rem;
      padding: 0 0.2rem;
      font-size: 0.88rem;
    }
    .year-label {
      min-width: 3.2rem;
    }
    .today-btn {
      padding: 0.2rem 0.55rem;
      font-size: 0.8rem;
    }
    .cell {
      min-height: 64px;
      padding: 0.25rem 0.28rem 0.35rem;
    }
    .solar {
      font-size: 0.82rem;
    }
    .chinese-day {
      font-size: 0.62rem;
      letter-spacing: 0.02em;
    }
    .lunar {
      font-size: 0.62rem;
    }
    .jeolgi {
      font-size: 0.58rem;
      padding: 0.04rem 0.3rem;
    }
    .detail {
      font-size: 0.84rem;
      padding: 0.5rem 0.7rem;
    }
    .d-jeolgi {
      font-size: 0.7rem;
      padding: 0.08rem 0.45rem;
    }
  }

  @media (prefers-color-scheme: dark) {
    .weekday.sat,
    .cell.sat:not(.out) .solar {
      color: #7da9d6;
    }
    .detail {
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-muted, #8a807a) 14%, var(--color-surface, #1f1c1a)) 0%,
        color-mix(in srgb, var(--color-muted, #8a807a) 8%, var(--color-surface, #1f1c1a)) 100%
      );
    }
    .detail.today {
      background: linear-gradient(135deg, #4a3a08 0%, #5a4a14 100%);
      border-color: #8a6a14;
    }
    .detail.today .d-solar,
    .detail.today .d-lunar,
    .detail.today .d-gapja {
      color: #f5d97a;
    }
    .detail.today .d-weekday {
      color: #d4b860;
    }
  }
</style>
