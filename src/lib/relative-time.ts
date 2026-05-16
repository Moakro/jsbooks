/**
 * Relative time formatter — 한국어 SNS-style.
 *
 *   < 1분        → "방금"
 *   < 60분       → "N분 전"
 *   < 24시간     → "N시간 전"
 *   24~48시간    → "어제"
 *   < 7일        → "N일 전"
 *   < 4주        → "N주 전"
 *   < 12개월     → "N개월 전"
 *   그 외        → "YY.MM.DD"  (4자리 연도 ✗)
 *
 * 미래 시각은 입력 오류로 간주하여 "방금"으로 표시.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return "방금";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diffMs < minute) return "방금";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}분 전`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}시간 전`;
  if (diffMs < 2 * day) return "어제";
  if (diffMs < week) return `${Math.floor(diffMs / day)}일 전`;
  if (diffMs < 4 * week) return `${Math.floor(diffMs / week)}주 전`;

  // 개월 — 캘린더 기준 차이 사용 (정확도 ↑)
  const past = new Date(t);
  const months =
    (now.getFullYear() - past.getFullYear()) * 12 +
    (now.getMonth() - past.getMonth()) -
    (now.getDate() < past.getDate() ? 1 : 0);

  if (months < 12) return `${Math.max(1, months)}개월 전`;

  const yy = String(past.getFullYear() % 100).padStart(2, "0");
  const mm = String(past.getMonth() + 1).padStart(2, "0");
  const dd = String(past.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

/**
 * 절대 시각 tooltip 용 — "2026-05-16 03:21:30"
 */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}
