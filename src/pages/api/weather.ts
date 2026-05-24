import type { APIRoute } from "astro";

/**
 * Weather endpoint — IP geolocation 기반 (Cloudflare runtime cf object).
 *
 * - 한국(KR) 접속: KMA LDAPS 모델(`models=kma_seamless`) + `hourly` 시각 매칭 — 한국 기상청과 거의 일치.
 *   KMA seamless 는 `current` 미지원이라 hourly array 에서 현재 시각에 가장 가까운 non-null index 를 선택.
 *   KMA upstream 이 null/실패면 best_match `current` 로 fallback.
 * - 그 외: Open-Meteo best_match `current` (글로벌 모델).
 *
 * CDN 캐시 15분(동일 IP·지역 반복 요청 줄임). 클라이언트 localStorage 30분(weather.ts).
 */

export const prerender = false;

const FALLBACK = {
  lat: 37.5665,
  lon: 126.978,
  city: "서울",
  country: "KR",
};

type Snapshot = {
  temperature_2m: number | null;
  weather_code: number | null;
  is_day: number | null;
};

type HourlyResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    weather_code?: (number | null)[];
    is_day?: (number | null)[];
  };
};

type CurrentResponse = {
  current?: {
    temperature_2m?: number | null;
    weather_code?: number | null;
    is_day?: number | null;
  };
};

/**
 * Asia/Seoul 현재 시각의 정시(HH:00) 를 ISO 8601 로컬 문자열로 반환 (e.g. "2026-05-24T10:00").
 * Open-Meteo 가 `timezone=Asia/Seoul` 로 응답할 때 `hourly.time` 형식과 일치.
 */
function seoulHourIsoNow(): string {
  // ko-KR + Asia/Seoul → 2026. 05. 24. 오전 10:00:00 같은 출력 대신
  // Intl 의 parts API 로 정확히 조립.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // en-CA → YYYY-MM-DD, hour 24h. 분은 무시하고 정시로 맞춤.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:00`;
}

/** hourly array 에서 nowIso 와 가장 가까운 non-null temperature_2m index 를 찾는다. */
function pickClosestIndex(
  times: string[],
  temps: (number | null)[],
  nowIso: string,
): number {
  const target = Date.parse(nowIso);
  let bestIdx = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    if (typeof temps[i] !== "number") continue;
    const t = Date.parse(times[i]);
    if (Number.isNaN(t)) continue;
    const delta = Math.abs(t - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

async function fetchKmaHourly(lat: number, lon: number): Promise<Snapshot | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,weather_code,is_day` +
    `&timezone=Asia%2FSeoul` +
    `&forecast_days=2&past_days=1` +
    `&models=kma_seamless`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as HourlyResponse;
  const times = data.hourly?.time;
  const temps = data.hourly?.temperature_2m;
  const codes = data.hourly?.weather_code;
  const days = data.hourly?.is_day;
  if (!Array.isArray(times) || !Array.isArray(temps) || times.length === 0) {
    return null;
  }
  const idx = pickClosestIndex(times, temps, seoulHourIsoNow());
  if (idx < 0) return null;
  const temp = temps[idx];
  if (typeof temp !== "number") return null;
  return {
    temperature_2m: temp,
    weather_code: typeof codes?.[idx] === "number" ? codes[idx]! : null,
    is_day: typeof days?.[idx] === "number" ? days[idx]! : null,
  };
}

async function fetchBestMatchCurrent(
  lat: number,
  lon: number,
): Promise<Snapshot | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,is_day` +
    `&timezone=Asia%2FSeoul`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as CurrentResponse;
  const temp = data.current?.temperature_2m;
  if (typeof temp !== "number") return null;
  return {
    temperature_2m: temp,
    weather_code:
      typeof data.current?.weather_code === "number"
        ? data.current.weather_code
        : null,
    is_day:
      typeof data.current?.is_day === "number" ? data.current.is_day : null,
  };
}

export const GET: APIRoute = async (context) => {
  // Cloudflare adapter 는 runtime cf object 를 locals.runtime.cf 에 노출.
  const runtime = (context.locals as { runtime?: { cf?: Record<string, unknown> } }).runtime;
  const cf = runtime?.cf ?? {};

  const latRaw = cf.latitude as string | number | undefined;
  const lonRaw = cf.longitude as string | number | undefined;
  const lat =
    latRaw !== undefined ? Number(latRaw) || FALLBACK.lat : FALLBACK.lat;
  const lon =
    lonRaw !== undefined ? Number(lonRaw) || FALLBACK.lon : FALLBACK.lon;
  const city = (cf.city as string | undefined) ?? FALLBACK.city;
  const country = (cf.country as string | undefined) ?? FALLBACK.country;

  try {
    let snap: Snapshot | null = null;
    if (country === "KR") {
      snap = await fetchKmaHourly(lat, lon);
    }
    if (!snap) {
      snap = await fetchBestMatchCurrent(lat, lon);
    }
    if (!snap) {
      return new Response(
        JSON.stringify({ error: "upstream", message: "no data" }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        lat,
        lon,
        city,
        country,
        temperature_2m: snap.temperature_2m,
        weather_code: snap.weather_code,
        is_day: snap.is_day,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=900",
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "fetch", message: String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
};
