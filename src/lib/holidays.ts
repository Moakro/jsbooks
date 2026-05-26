/**
 * 한국 국경일·명절 (대한민국 공휴일) 라벨.
 *
 * 셀·상세박스에서 절기(jeolgi) 와 같은 슬롯에 노출. 대체공휴일 룰은 적용하지
 * 않고 본래 날짜만. 설날·추석 전후일은 같은 라벨로 묶음 (`설날`, `설`).
 */
const SOLAR_HOLIDAYS: Record<string, string> = {
  "1-1": "신정",
  "3-1": "삼일절",
  "5-5": "어린이날",
  "6-6": "현충일",
  "8-15": "광복절",
  "10-3": "개천절",
  "10-9": "한글날",
  "12-25": "성탄절",
};

const LUNAR_HOLIDAYS: Record<string, string> = {
  // 설 연휴 (음 12.30 ~ 음 1.2). 윤달은 무시 — 양력 변환 시 자연 처리.
  "12-30": "설 전날",
  "1-1": "설날",
  "1-2": "설 다음날",
  // 정월대보름은 공휴일 X 지만 명절. 사용자 요구 "국경일·명절" 에 부합.
  "1-15": "정월대보름",
  "4-8": "부처님오신날",
  // 추석 연휴 (음 8.14 ~ 8.16)
  "8-14": "추석 전날",
  "8-15": "추석",
  "8-16": "추석 다음날",
};

/**
 * 그 날의 공휴일/명절 이름. 양력 우선 매칭, 음력 fallback. 없으면 null.
 *
 * @param solarMonth 1-12 (양력)
 * @param solarDay   1-31 (양력)
 * @param lunarMonth 1-12 (음력, leap 무시) — getLunar() 결과의 month
 * @param lunarDay   1-30 (음력)
 */
export function holidayName(
  solarMonth: number,
  solarDay: number,
  lunarMonth: number | null,
  lunarDay: number | null,
): string | null {
  const sKey = `${solarMonth}-${solarDay}`;
  if (SOLAR_HOLIDAYS[sKey]) return SOLAR_HOLIDAYS[sKey];
  if (lunarMonth != null && lunarDay != null) {
    const lKey = `${lunarMonth}-${lunarDay}`;
    if (LUNAR_HOLIDAYS[lKey]) return LUNAR_HOLIDAYS[lKey];
  }
  return null;
}
