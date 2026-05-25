/** 사용자 개인 일정 — comments-worker /api/events 응답 1행. */
export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  /** 'YYYY-MM-DD'. is_lunar=1 이면 음력 기준 날짜. */
  start_date: string;
  /** null → 단일 일자 */
  end_date: string | null;
  all_day: 0 | 1;
  /** "기념일" · "일정" · "기타" (구 enum 호환). */
  category: string | null;
  /** 1 = 매년 반복(기념일+연례) */
  is_annual: 0 | 1;
  /** 1 = 음력 기준 (start_date 가 음력) */
  is_lunar: 0 | 1;
  /** 1 = 사이트 전체 공개 (일정/기타+공개) */
  is_public: 0 | 1;
  memo: string | null;
  created_at: string;
  updated_at: string;
  /** GET /api/events 응답 — 작성자 닉네임 (공개 일정 등 타인 일정 표시용) */
  owner_name?: string | null;
  /** GET /api/events 응답 — 1=내 일정, 0=공개된 타인 일정 */
  is_mine?: 0 | 1;
}

export type EventCategory = "기념일" | "일정" | "기타";

/** 카테고리 한 글자 라벨 — 컴팩트 뱃지(셀·사이드바)용. */
export function categoryShortLabel(cat: string | null | undefined): string {
  if (cat === "일정") return "일";
  // '기념일' · '기타' · 미지정 모두 '기'. 색상으로 구분.
  return "기";
}

/** 카테고리 풀 라벨 — 툴팁·접근성용. */
export function categoryFullLabel(cat: string | null | undefined): string {
  if (cat === "기념일") return "기념일";
  if (cat === "일정") return "일정";
  return "기타";
}

/** 카테고리 CSS 클래스 — 셀·사이드바·상세박스 통일. */
export function categoryBadgeClass(cat: string | null | undefined): string {
  if (cat === "기념일") return "cat-anniversary";
  if (cat === "일정") return "cat-plan";
  return "cat-other";
}

/** 음력 일정의 음력 M.D 짧은 라벨 (예: '9.19'). is_lunar=1 일 때만 사용. */
export function lunarShortFromSource(ev: CalendarEvent): string | null {
  if (ev.is_lunar !== 1) return null;
  const parts = ev.start_date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  return `${parts[1]}.${parts[2]}`;
}

/** 'YYYY-MM-DD' 포맷. 로컬 타임존 기준. */
export function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** year, month(1-12) 의 첫·말일 ISO. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * 화면에 표시되는 이벤트 1건 — 원본 + 양력 발생일.
 *  - 비연례·양력 이벤트: occursOn = start_date (그대로)
 *  - 연례·양력 이벤트: occursOn = `${displayYear}-MM-DD` (start_date 의 MM-DD)
 *  - 음력 이벤트(단발): occursOn = 음력→양력 변환 (저장된 연도 기준)
 *  - 연례·음력 이벤트: occursOn = displayYear 의 음력 MM-DD → 양력
 *
 * 표시일이 같은 월 범위 밖이면 occursOn 은 null, 화면에서 제외.
 */
export interface OccurrenceEvent {
  source: CalendarEvent;
  /** 'YYYY-MM-DD' — 표시할 양력 날짜. range 밖이면 null. */
  occursOn: string;
  /** 종료일(범위 일정). 양력 ISO. 단일일정이면 null. */
  endOn: string | null;
}

import { lunarToSolar } from "./date";

/**
 * 주어진 (year, month) 에 표시할 occurrence 들을 계산.
 * 같은 row 가 한 달에 2번 발생할 수도 있는 음력 윤달은 단순화하여 1회만.
 */
export function expandOccurrences(
  events: CalendarEvent[],
  year: number,
  month: number,
): OccurrenceEvent[] {
  const out: OccurrenceEvent[] = [];
  const { from, to } = monthRange(year, month);
  for (const ev of events) {
    const occ = computeOccurrence(ev, year);
    if (!occ) continue;
    if (occ.occursOn < from && (occ.endOn ?? occ.occursOn) < from) continue;
    if (occ.occursOn > to) continue;
    out.push(occ);
  }
  out.sort((a, b) => {
    if (a.occursOn !== b.occursOn) return a.occursOn < b.occursOn ? -1 : 1;
    return a.source.created_at < b.source.created_at ? -1 : 1;
  });
  return out;
}

/** displayYear 에 표시될 양력 occurrence. 변환 실패 시 null. */
function computeOccurrence(ev: CalendarEvent, displayYear: number): OccurrenceEvent | null {
  const parts = ev.start_date.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const [sy, sm, sd] = parts;

  // 연례/음력 기념일: 등록 시작 연도(sy) 이전은 표시 X — "1947년 등록 기념일" 이 1946년 달력에 나타나는 버그 차단.
  if ((ev.is_annual === 1 || ev.is_lunar === 1) && displayYear < sy) {
    return null;
  }

  // 음력 기준
  if (ev.is_lunar === 1) {
    const lunarYear = ev.is_annual === 1 ? displayYear : sy;
    const solar = lunarToSolar(lunarYear, sm, sd, false);
    if (!solar) return null;
    return {
      source: ev,
      occursOn: isoDate(solar),
      endOn: null, // 음력은 기념일 전용이라 단일일자
    };
  }

  // 양력 — 연례면 displayYear 로 연도 치환
  if (ev.is_annual === 1) {
    return {
      source: ev,
      occursOn: isoDate(new Date(displayYear, sm - 1, sd)),
      endOn: null, // 연례 기념일은 단일일자
    };
  }

  // 양력 비연례 — 원본 그대로
  return {
    source: ev,
    occursOn: ev.start_date,
    endOn: ev.end_date,
  };
}
