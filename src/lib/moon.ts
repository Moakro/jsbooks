/**
 * 음력 일자(1~30)로부터 달 위상 8단계 계산.
 * 정확한 천문 계산이 아닌 음력 일자 기반 근사 — DayBox 시각 표현 용도.
 */

export type MoonPhase = {
  /** 0~7. 0=삭(new), 4=망(full) */
  index: number;
  /** 0~1. 0=삭, 0.5=반달, 1=망 */
  illumination: number;
  /** 한자 위상명 */
  name: string;
  /** SVG에서 사용할 lit 비율(0~1) — illumination과 동치 */
  lit: number;
  /** true=차오름(상현·소망·망 방향), false=이지러짐(망 이후) */
  waxing: boolean;
};

export function moonPhaseFromLunarDay(day: number): MoonPhase {
  // day 1~30 → 위상 인덱스 (대략적 — 음력 1=삭, 15=망, 30=다시 삭)
  const map: Array<{ range: [number, number]; index: number; name: string }> = [
    { range: [1, 1],   index: 0, name: "삭(朔)" },
    { range: [2, 6],   index: 1, name: "초승달" },
    { range: [7, 9],   index: 2, name: "상현(上弦)" },
    { range: [10, 13], index: 3, name: "소망(小望)" },
    { range: [14, 16], index: 4, name: "망(望)" },
    { range: [17, 20], index: 5, name: "기망(旣望)" },
    { range: [21, 23], index: 6, name: "하현(下弦)" },
    { range: [24, 29], index: 7, name: "그믐달" },
    { range: [30, 30], index: 0, name: "삭(朔)" },
  ];
  const m = map.find((x) => day >= x.range[0] && day <= x.range[1]) ?? map[0];
  // illumination: index 0=0, 4=1, 8=0 cyclic
  const illumination = 1 - Math.abs(m.index - 4) / 4;
  // 1~15은 waxing(차오름), 16~30은 waning(이지러짐)
  const waxing = day <= 15;
  return { index: m.index, illumination, name: m.name, lit: illumination, waxing };
}
