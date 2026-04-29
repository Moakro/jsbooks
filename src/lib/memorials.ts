/**
 * Memorial / 기념일 dataset.
 *
 * For now this is an in-source dataset. When entries grow, migrate to an
 * Astro content collection (`content/memorials/*.md`) so users can edit
 * via Obsidian like other content.
 *
 * Date semantics:
 * - `solar`: anchored to a fixed Gregorian m/d (recurs every solar year).
 * - `lunar`: anchored to a fixed lunar m/d (recurs every lunar year — we
 *   resolve to the matching solar date per requested year via
 *   `KoreanLunarCalendar.setLunarDate`).
 * - `intercalation`: applies only when `lunar` is set; if true, only
 *   appears in years that have the matching leap month.
 */
// @ts-ignore
import KoreanLunarCalendar from "korean-lunar-calendar";

export type TraditionKey =
  | "increase"   // 증산도
  | "daesoon"    // 대순진리회
  | "boch"       // 보천교
  | "jeungsan"   // 증산교본부
  | "common"     // 교단 공통 / 객관 사적
  | "other";

export type Memorial = {
  id: string;
  name: string;
  hanja?: string;
  date:
    | { kind: "solar"; month: number; day: number }
    | { kind: "lunar"; month: number; day: number; intercalation?: boolean };
  tradition: TraditionKey;
  /** Free description, optional source citation. */
  description?: string;
  source?: string;
};

/**
 * Empty by default — populate with verified entries (상제님 등천일·생신
 * 등 핵심부터). Keeping this small and curated until a content-collection
 * migration. New entries can be added inline; the calendar / DayBox will
 * pick them up automatically.
 */
export const MEMORIALS: Memorial[] = [];

/** Resolve a memorial to its concrete Date in the given Gregorian year. */
export function resolveMemorialDate(
  m: Memorial,
  gregorianYear: number,
): Date | null {
  if (m.date.kind === "solar") {
    return new Date(gregorianYear, m.date.month - 1, m.date.day);
  }
  // lunar → solar
  const cal = new KoreanLunarCalendar();
  const ok = cal.setLunarDate(
    gregorianYear,
    m.date.month,
    m.date.day,
    !!m.date.intercalation,
  );
  if (!ok) return null;
  const sc = cal.getSolarCalendar();
  return new Date(sc.year, sc.month - 1, sc.day);
}

/** Memorials whose resolved date falls inside [from, to] (inclusive). */
export function listMemorialsBetween(from: Date, to: Date): Memorial[] {
  const out: Memorial[] = [];
  // Resolve against the year(s) the range spans (range is at most a week so 1~2 years).
  const years = new Set<number>([from.getFullYear(), to.getFullYear()]);
  for (const m of MEMORIALS) {
    for (const y of years) {
      const d = resolveMemorialDate(m, y);
      if (!d) continue;
      if (d.getTime() >= startOfDay(from).getTime() && d.getTime() <= startOfDay(to).getTime()) {
        out.push(m);
        break;
      }
    }
  }
  return out;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
