import type { APIRoute } from "astro";

/**
 * Weather endpoint — IP geolocation (Cloudflare runtime cf object).
 *
 * - city/lat/lon: cf 객체에서 직접. 누락 또는 접근 실패 시 서울 fallback.
 * - country: 향후 KMA hourly 통합 시 분기용 (현재 best_match 만).
 *
 * 견고성: 모든 단계 try-catch. cf 접근 실패해도 fallback 좌표로 계속 진행 → 절대 500 X.
 * 디버깅용 `debug` 쿼리 파라미터: `/api/weather?debug=1` 시 cf 메타 + url 같이 반환.
 *
 * CDN 캐시 15분, 클라이언트 localStorage 30분(weather.ts).
 */

export const prerender = false;

const FALLBACK = {
  lat: 37.5665,
  lon: 126.978,
  city: "서울",
  country: "KR",
};

function readCf(locals: unknown): Record<string, unknown> {
  try {
    const runtime = (locals as { runtime?: { cf?: Record<string, unknown> } })?.runtime;
    return runtime?.cf ?? {};
  } catch {
    return {};
  }
}

/** Astro Cloudflare adapter / Worker request 의 모든 가능한 cf 노출 path 진단 (debug 전용). */
function diagnose(context: { locals: unknown; request: Request }): Record<string, unknown> {
  const locals = context.locals as Record<string, unknown> | undefined;
  const request = context.request as Request & { cf?: Record<string, unknown> };
  const runtime = (locals?.runtime ?? {}) as Record<string, unknown>;
  return {
    hasLocals: !!locals,
    localsKeys: locals ? Object.keys(locals) : [],
    hasRuntime: !!locals?.runtime,
    runtimeKeys: Object.keys(runtime),
    runtimeCfKeys: Object.keys((runtime.cf ?? {}) as Record<string, unknown>),
    requestCfKeys: Object.keys((request?.cf ?? {}) as Record<string, unknown>),
    headerCfIpcountry: request?.headers?.get("cf-ipcountry") ?? null,
    headerCfIplatitude: request?.headers?.get("cf-iplatitude") ?? null,
    headerCfIplongitude: request?.headers?.get("cf-iplongitude") ?? null,
    headerCfIpcity: request?.headers?.get("cf-ipcity") ?? null,
  };
}

export const GET: APIRoute = async (context) => {
  const debug = new URL(context.request.url).searchParams.get("debug") === "1";

  const cf = readCf(context.locals);
  const cfKeys = Object.keys(cf);

  let lat = FALLBACK.lat;
  let lon = FALLBACK.lon;
  let city = FALLBACK.city;
  let country = FALLBACK.country;

  try {
    const latRaw = cf.latitude;
    const lonRaw = cf.longitude;
    const latNum = latRaw !== undefined ? Number(latRaw) : NaN;
    const lonNum = lonRaw !== undefined ? Number(lonRaw) : NaN;
    if (Number.isFinite(latNum)) lat = latNum;
    if (Number.isFinite(lonNum)) lon = lonNum;
    if (typeof cf.city === "string" && cf.city) city = cf.city;
    if (typeof cf.country === "string" && cf.country) country = cf.country;
  } catch {
    /* fallback 좌표 유지 */
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,is_day` +
    `&timezone=Asia%2FSeoul`;
  void country;

  let upstreamStatus: number | string = "init";
  let upstreamBody: unknown = null;

  try {
    const res = await fetch(url);
    upstreamStatus = res.status;
    if (res.ok) {
      const data = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
      };
      upstreamBody = data;
      const body: Record<string, unknown> = {
        lat,
        lon,
        city,
        country,
        temperature_2m: data.current?.temperature_2m ?? null,
        weather_code: data.current?.weather_code ?? null,
        is_day: data.current?.is_day ?? null,
      };
      if (debug) {
        body.debug = { cfKeys, url, upstreamStatus, paths: diagnose(context) };
      }
      return new Response(JSON.stringify(body), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=900",
        },
      });
    }
  } catch (e) {
    upstreamStatus = `throw: ${String(e)}`;
  }

  // upstream 실패 — fallback 좌표 + 최소 응답. status 200 으로 클라이언트 graceful 처리.
  return new Response(
    JSON.stringify({
      lat,
      lon,
      city,
      country,
      temperature_2m: null,
      weather_code: null,
      is_day: null,
      ...(debug ? { debug: { cfKeys, url, upstreamStatus, upstreamBody } } : {}),
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
};
