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

/**
 * Cloudflare cf.city 는 영문. 주요 한국 도시는 한글로 매핑 (UI 톤 일관).
 * 매핑 없으면 영문 그대로 (해외 도시 등).
 */
const CITY_KO: Record<string, string> = {
  // 특별시·광역시
  Seoul: "서울",
  Busan: "부산",
  Incheon: "인천",
  Daegu: "대구",
  Daejeon: "대전",
  Gwangju: "광주",
  Ulsan: "울산",
  Sejong: "세종",
  // 도청 소재지·주요 도시
  Suwon: "수원",
  Changwon: "창원",
  Cheongju: "청주",
  Jeonju: "전주",
  Cheonan: "천안",
  Chuncheon: "춘천",
  Wonju: "원주",
  Pohang: "포항",
  Andong: "안동",
  Mokpo: "목포",
  Yeosu: "여수",
  Jinju: "진주",
  Jeju: "제주",
  Seogwipo: "서귀포",
  // 수도권 위성도시
  Goyang: "고양",
  Yongin: "용인",
  Seongnam: "성남",
  Bucheon: "부천",
  Ansan: "안산",
  Anyang: "안양",
  Namyangju: "남양주",
  Hwaseong: "화성",
  Pyeongtaek: "평택",
  Uijeongbu: "의정부",
  Siheung: "시흥",
  Paju: "파주",
  Gimpo: "김포",
  Gwangmyeong: "광명",
  Gunpo: "군포",
  Osan: "오산",
  Icheon: "이천",
  Yangju: "양주",
  Anseong: "안성",
  Guri: "구리",
  Pocheon: "포천",
  Hanam: "하남",
  Dongducheon: "동두천",
  Gwacheon: "과천",
};

function toKoreanCity(city: string): string {
  return CITY_KO[city] ?? city;
}

function readCf(request: Request): Record<string, unknown> {
  // Astro v6 부터 `Astro.locals.runtime.cf` 는 제거. `Astro.request.cf` 사용.
  // Cloudflare Workers runtime 의 Request 객체는 cf 메타를 직접 노출.
  try {
    const req = request as Request & { cf?: Record<string, unknown> };
    return req.cf ?? {};
  } catch {
    return {};
  }
}

/** debug 전용 진단 — request.cf (Astro v6+) 메타. */
function diagnose(context: { request: Request }): Record<string, unknown> {
  try {
    const request = context.request as Request & { cf?: Record<string, unknown> };
    return {
      requestCfKeys: Object.keys((request?.cf ?? {}) as Record<string, unknown>),
      headerCfIpcountry: request?.headers?.get("cf-ipcountry") ?? null,
      headerCfIplatitude: request?.headers?.get("cf-iplatitude") ?? null,
      headerCfIplongitude: request?.headers?.get("cf-iplongitude") ?? null,
      headerCfIpcity: request?.headers?.get("cf-ipcity") ?? null,
    };
  } catch (e) {
    return { error: String(e) };
  }
}

export const GET: APIRoute = async (context) => {
  const debug = new URL(context.request.url).searchParams.get("debug") === "1";

  const cf = readCf(context.request);
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
    if (typeof cf.city === "string" && cf.city) city = toKoreanCity(cf.city);
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
