/** 사용자 개인 일정 — comments-worker /api/events 응답 1행. */
export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  start_date: string;       // 'YYYY-MM-DD'
  end_date: string | null;  // null → 단일 일자
  all_day: 0 | 1;
  category: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
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
