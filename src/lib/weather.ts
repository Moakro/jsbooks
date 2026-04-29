/**
 * Open-Meteo client (Phase A — Seoul fixed location).
 *
 * No auth, no rate limit registration. We fetch a tiny "current weather"
 * payload, cache it in localStorage for 30 minutes, and translate the
 * WMO weather code to a Lucide icon name + Korean label.
 *
 * Phase B will swap the location source to a `/api/weather` endpoint that
 * reads `cf-iplatitude/longitude/city` and KV-caches per-region.
 */

export type WeatherIconName =
  | "sun"
  | "cloud"
  | "cloud-sun"
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
  fetchedAt: number;   // ms epoch
};

const DEFAULT_LOC = {
  lat: 37.5665,
  lon: 126.9780,
  region: "서울",
};

const CACHE_KEY = "jsbooks:weather:v1";
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

/** Map WMO weather codes (https://open-meteo.com/en/docs) → icon. */
function wmoToIcon(code: number): WeatherIconName {
  if (code === 0) return "sun";
  if (code === 1) return "cloud-sun";
  if (code === 2) return "cloud-sun";
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

export async function getWeather(): Promise<WeatherSnapshot | null> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${DEFAULT_LOC.lat}&longitude=${DEFAULT_LOC.lon}` +
      `&current=temperature_2m,weather_code` +
      `&timezone=Asia%2FSeoul`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const code: number = data?.current?.weather_code ?? 3;
    const temp: number = data?.current?.temperature_2m ?? 0;
    const snap: WeatherSnapshot = {
      iconName: wmoToIcon(code),
      label: wmoToLabel(code),
      tempC: Math.round(temp),
      region: DEFAULT_LOC.region,
      fetchedAt: Date.now(),
    };
    writeCache(snap);
    return snap;
  } catch {
    return null;
  }
}
