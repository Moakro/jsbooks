/**
 * Weather client (Phase B — IP geolocation via /api/weather).
 *
 * 서버 endpoint (`src/pages/api/weather.ts`) 가 Cloudflare runtime cf 에서
 * lat/lon/city/country 를 읽고 Open-Meteo 호출 (한반도는 KMA 모델 사용).
 * 클라이언트는 그 결과를 받아 localStorage 에 30분 캐시 후 표시.
 *
 * Fallback: API 실패 시 서울 좌표로 클라이언트에서 직접 Open-Meteo 호출.
 */

export type WeatherIconName =
  | "sun"
  | "moon"
  | "cloud"
  | "cloud-sun"
  | "cloud-moon"
  | "cloud-rain"
  | "cloud-drizzle"
  | "cloud-snow"
  | "cloud-fog"
  | "cloud-lightning";

export type WeatherSnapshot = {
  iconName: WeatherIconName;
  label: string;       // 맑음 / 구름 / 흐림 / 안개 / 비 / 눈 / 천둥 ...
  tempC: number;       // current temperature, rounded to int
  region: string;      // 서울
  isDay: boolean;      // true=낮, false=밤 — 아이콘 sun↔moon 분기에 사용
  fetchedAt: number;   // ms epoch
};

const DEFAULT_LOC = {
  lat: 37.5665,
  lon: 126.9780,
  region: "서울",
};

// v4: KMA hourly 시각 매칭 도입(서버 endpoint 응답 동일하지만 의미가 바뀐 값 → 캐시 강제 invalidate).
const CACHE_KEY = "jsbooks:weather:v4";
const TTL_MS = 30 * 60 * 1000;

function readCache(): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as WeatherSnapshot;
    if (!v || typeof v !== "object") return null;
    if (Date.now() - v.fetchedAt > TTL_MS) return null;
    return v;
  } catch {
    return null;
  }
}

function writeCache(s: WeatherSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    /* quota / SSR — ignore */
  }
}

/** Map WMO weather codes (https://open-meteo.com/en/docs) → icon. 낮/밤 분기 (0·1·2만). */
function wmoToIcon(code: number, isDay: boolean): WeatherIconName {
  if (code === 0) return isDay ? "sun" : "moon";
  if (code === 1 || code === 2) return isDay ? "cloud-sun" : "cloud-moon";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "cloud-fog";
  if (code >= 51 && code <= 57) return "cloud-drizzle";
  if (code >= 61 && code <= 67) return "cloud-rain";
  if (code >= 71 && code <= 77) return "cloud-snow";
  if (code >= 80 && code <= 82) return "cloud-rain";
  if (code === 85 || code === 86) return "cloud-snow";
  if (code >= 95 && code <= 99) return "cloud-lightning";
  return "cloud";
}

function wmoToLabel(code: number): string {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code >= 51 && code <= 57) return "이슬비";
  if (code >= 61 && code <= 65) return "비";
  if (code === 66 || code === 67) return "어는비";
  if (code >= 71 && code <= 77) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code === 85 || code === 86) return "눈 소나기";
  if (code >= 95 && code <= 99) return "천둥";
  return "흐림";
}

function dayFallback(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

function buildSnapshot(
  code: number | null | undefined,
  temp: number | null | undefined,
  isDayRaw: number | null | undefined,
  region: string,
): WeatherSnapshot {
  const isDay: boolean =
    typeof isDayRaw === "number" ? isDayRaw === 1 : dayFallback();
  return {
    iconName: wmoToIcon(code ?? 3, isDay),
    label: wmoToLabel(code ?? 3),
    tempC: Math.round(temp ?? 0),
    region,
    isDay,
    fetchedAt: Date.now(),
  };
}

/**
 * Fallback: 서버 endpoint 실패 시 클라이언트에서 직접 서울 좌표로 Open-Meteo 호출.
 * KMA 모델은 `current` 미지원이라 fallback 은 best_match `current` 만 사용 (정확도는 떨어지지만 안정).
 */
async function fetchDirectFallback(): Promise<WeatherSnapshot | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${DEFAULT_LOC.lat}&longitude=${DEFAULT_LOC.lon}` +
      `&current=temperature_2m,weather_code,is_day` +
      `&timezone=Asia%2FSeoul`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return buildSnapshot(
      data?.current?.weather_code,
      data?.current?.temperature_2m,
      data?.current?.is_day,
      DEFAULT_LOC.region,
    );
  } catch {
    return null;
  }
}

export async function getWeather(): Promise<WeatherSnapshot | null> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const res = await fetch("/api/weather");
    if (res.ok) {
      const data = await res.json();
      const snap = buildSnapshot(
        data?.weather_code,
        data?.temperature_2m,
        data?.is_day,
        data?.city ?? DEFAULT_LOC.region,
      );
      writeCache(snap);
      return snap;
    }
  } catch {
    /* fall through */
  }

  const fb = await fetchDirectFallback();
  if (fb) writeCache(fb);
  return fb;
}
