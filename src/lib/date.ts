/**
 * Date intelligence layer — 양력/음력/간지/절기/기념일.
 *
 * Lunar conversion uses `korean-lunar-calendar` (KARI 기준).
 * Solar terms (24절기) use an average-date table; accuracy is ±1 day.
 * For exact calculation, swap with KASI year-by-year data later.
 */
// @ts-ignore — types are bundled but module resolution can be flaky in Vite/Astro
import KoreanLunarCalendar from "korean-lunar-calendar";

import { listMemorialsBetween, type Memorial } from "./memorials";

// ─────────────────────────── 24 절기 ───────────────────────────

/**
 * Average solar-term dates (Korean reference). [name, hanja, month, day].
 * Sorted in calendar order from 소한(Jan) to 대한(Jan).
 * NOTE: real dates may be ±1 day. Replace with KASI-year-specific data
 * when precision becomes important.
 */
const JEOLGI_TABLE: ReadonlyArray<readonly [string, string, number, number]> = [
  ["소한", "小寒", 1, 6],
  ["대한", "大寒", 1, 20],
  ["입춘", "立春", 2, 4],
  ["우수", "雨水", 2, 19],
  ["경칩", "驚蟄", 3, 6],
  ["춘분", "春分", 3, 21],
  ["청명", "淸明", 4, 5],
  ["곡우", "穀雨", 4, 20],
  ["입하", "立夏", 5, 6],
  ["소만", "小滿", 5, 21],
  ["망종", "芒種", 6, 6],
  ["하지", "夏至", 6, 21],
  ["소서", "小暑", 7, 7],
  ["대서", "大暑", 7, 23],
  ["입추", "立秋", 8, 8],
  ["처서", "處暑", 8, 23],
  ["백로", "白露", 9, 8],
  ["추분", "秋分", 9, 23],
  ["한로", "寒露", 10, 9],
  ["상강", "霜降", 10, 24],
  ["입동", "立冬", 11, 8],
  ["소설", "小雪", 11, 22],
  ["대설", "大雪", 12, 7],
  ["동지", "冬至", 12, 22],
];

export type Jeolgi = {
  name: string;
  hanja: string;
  date: Date;
};

export type JeolgiInfo = {
  /** Most recent solar term that has already passed (or today). */
  current: Jeolgi;
  /** Whole days since `current.date` (0 if today is the term itself). */
  daysSince: number;
  /** Next upcoming solar term. */
  next: Jeolgi;
  /** Whole days until `next.date`. */
  daysUntil: number;
};

function dayDiff(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function jeolgiList(year: number): Jeolgi[] {
  return JEOLGI_TABLE.map(([name, hanja, m, d]) => ({
    name,
    hanja,
    date: new Date(year, m - 1, d),
  }));
}

export function getJeolgiInfo(date: Date): JeolgiInfo {
  const y = date.getFullYear();
  const all = [
    ...jeolgiList(y - 1),
    ...jeolgiList(y),
    ...jeolgiList(y + 1),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const today = startOfDay(date);
  let lastIdx = -1;
  for (let i = 0; i < all.length; i++) {
    if (startOfDay(all[i].date).getTime() <= today.getTime()) lastIdx = i;
    else break;
  }
  const current = all[lastIdx];
  const next = all[lastIdx + 1];
  return {
    current,
    daysSince: dayDiff(current.date, today),
    next,
    daysUntil: dayDiff(today, next.date),
  };
}

// ─────────────────────────── 음력/간지 ───────────────────────────

export type LunarInfo = {
  year: number;
  month: number;
  day: number;
  /** True if the lunar month is a leap (윤달). */
  intercalation: boolean;
  /** "정유년 병오월 무자일" */
  korean_gapja: string;
  /** "丁酉年 丙午月 戊子日" */
  chinese_gapja: string;
};

export function getLunar(date: Date): LunarInfo | null {
  const cal = new KoreanLunarCalendar();
  const ok = cal.setSolarDate(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (!ok) return null;
  const lc = cal.getLunarCalendar();
  const ko = cal.getKoreanGapja();
  const ch = cal.getChineseGapja();
  return {
    year: lc.year,
    month: lc.month,
    day: lc.day,
    intercalation: !!lc.intercalation,
    korean_gapja: `${ko.year} ${ko.month} ${ko.day}`,
    chinese_gapja: `${ch.year} ${ch.month} ${ch.day}`,
  };
}

// ─────────────────────────── 양력 표시 헬퍼 ───────────────────────────

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function formatSolar(date: Date): {
  ymd: string;
  ymdNumeric: string;
  weekday: string;
} {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return {
    ymd: `${y}년 ${m}월 ${d}일`,
    ymdNumeric: `${y}.${mm}.${dd}`,
    weekday: WEEKDAY_KO[date.getDay()],
  };
}

// ─────────────────────────── 음력 한국식 표기 ───────────────────────────

export function formatLunarKo(l: LunarInfo): string {
  const leap = l.intercalation ? "윤" : "";
  return `${leap}${l.month}월 ${l.day}일`;
}

// ─────────────────────────── 통합 ───────────────────────────

export type DayInfo = {
  date: Date;
  solar: { ymd: string; ymdNumeric: string; weekday: string };
  lunar: LunarInfo | null;
  lunarKo: string | null;
  jeolgi: JeolgiInfo;
  /** Memorials within the calendar week containing `date` (Sun~Sat). */
  weekMemorials: Memorial[];
};

function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay()); // back to Sunday
  return s;
}

function endOfWeek(d: Date): Date {
  const e = startOfWeek(d);
  e.setDate(e.getDate() + 6);
  return e;
}

export function getDayInfo(date: Date = new Date()): DayInfo {
  const lunar = getLunar(date);
  const ws = startOfWeek(date);
  const we = endOfWeek(date);
  return {
    date: startOfDay(date),
    solar: formatSolar(date),
    lunar,
    lunarKo: lunar ? formatLunarKo(lunar) : null,
    jeolgi: getJeolgiInfo(date),
    weekMemorials: listMemorialsBetween(ws, we),
  };
}
