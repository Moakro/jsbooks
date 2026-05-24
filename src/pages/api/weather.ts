import type { APIRoute } from "astro";

/**
 * Weather endpoint — IP geolocation 기반 (Cloudflare runtime cf object).
 *
 * - 한국(KR) 접속: KMA LDAPS 모델 (`models=kma_seamless`) — 한국 기상청과 거의 일치
 * - 그 외: Open-Meteo 기본 best_match (글로벌 모델)
 * - city/lat/lon: cf 객체에서 직접. 누락 시 서울 fallback.
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

  // KMA seamless 는 `current` 미지원(null 반환) → 일단 best_match 만 사용.
  // KMA 정확도(2~4도 차이) 가 필요하면 hourly 응답을 시각 매칭해 사용해야 함 (별도 작업).
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,is_day` +
    `&timezone=Asia%2FSeoul`;

  // `country` 는 향후 KMA hourly 통합 시 분기용으로 보존.
  void country;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "upstream", status: res.status }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
    };
    return new Response(
      JSON.stringify({
        lat,
        lon,
        city,
        country,
        temperature_2m: data.current?.temperature_2m ?? null,
        weather_code: data.current?.weather_code ?? null,
        is_day: data.current?.is_day ?? null,
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
