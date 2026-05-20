<script lang="ts">
  /**
   * 카카오맵 공유 컴포넌트 (Svelte island, client:only="svelte" 권장).
   *
   * mode="input"  — 어드민 좌표 입력. 지도 클릭/마커 드래그로 좌표를 고르면
   *   window CustomEvent `jsbooks:coord-pick` ({lat,lng}) 을 dispatch.
   *   외부(vanilla 폼)에서 window event `jsbooks:map-goto` ({lat,lng} | {clear:true})
   *   를 보내면 지도 중심 이동 + 마커 표시/제거.
   *
   * mode="display" — 공개 지도. places 의 좌표마다 마커를 찍고,
   *   클릭하면 `/archive/places/<slug>/` 로 이동. 마커가 여러 개면 bounds fit.
   *
   * 키 미설정/로드 실패 시 throw 하지 않고 안내 박스를 렌더한다.
   */
  import { onMount } from "svelte";
  import { loadKakaoMaps } from "../lib/kakao-maps";

  type DisplayPlace = {
    slug: string;
    name: string;
    name_hanja?: string;
    region?: string;
    coord: [number, number];
  };

  let {
    mode,
    places = [],
    initial = null,
    level = 8,
    height = "420px",
  }: {
    mode: "input" | "display";
    places?: DisplayPlace[];
    initial?: [number, number] | null;
    level?: number;
    height?: string;
  } = $props();

  let container: HTMLDivElement;
  let errorMsg = $state<string | null>(null);

  // 정읍·고부 일대 (장소 다수가 모인 호남권) 기본 중심
  const DEFAULT_CENTER: [number, number] = [35.5703, 126.8557];

  onMount(() => {
    let map: any = null;
    let inputMarker: any = null;
    let gotoHandler: ((e: Event) => void) | null = null;

    loadKakaoMaps()
      .then((kakao) => {
        const center = initial ?? DEFAULT_CENTER;
        map = new kakao.maps.Map(container, {
          center: new kakao.maps.LatLng(center[0], center[1]),
          level,
          draggable: true,
          scrollwheel: true,
        });

        if (mode === "input") {
          setupInput(kakao);
        } else {
          setupDisplay(kakao);
        }
      })
      .catch((err: unknown) => {
        errorMsg = err instanceof Error ? err.message : String(err);
      });

    function dispatchPick(lat: number, lng: number) {
      window.dispatchEvent(
        new CustomEvent("jsbooks:coord-pick", { detail: { lat, lng } }),
      );
    }

    function setupInput(kakao: any) {
      function placeMarker(lat: number, lng: number) {
        const pos = new kakao.maps.LatLng(lat, lng);
        if (!inputMarker) {
          inputMarker = new kakao.maps.Marker({ position: pos, draggable: true });
          inputMarker.setMap(map);
          kakao.maps.event.addListener(inputMarker, "dragend", () => {
            const p = inputMarker.getPosition();
            dispatchPick(p.getLat(), p.getLng());
          });
        } else {
          inputMarker.setPosition(pos);
          inputMarker.setMap(map);
        }
      }

      if (initial) placeMarker(initial[0], initial[1]);

      // 지도 클릭 → 마커 이동 + 좌표 dispatch
      kakao.maps.event.addListener(map, "click", (e: any) => {
        const latlng = e.latLng;
        const lat = latlng.getLat();
        const lng = latlng.getLng();
        placeMarker(lat, lng);
        dispatchPick(lat, lng);
      });

      // 외부(폼) → 지도: 장소 선택/좌표 변경 시 중심 이동 + 마커
      gotoHandler = (e: Event) => {
        const d = (e as CustomEvent).detail ?? {};
        if (d.clear) {
          if (inputMarker) inputMarker.setMap(null);
          return;
        }
        const lat = Number(d.lat);
        const lng = Number(d.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const pos = new kakao.maps.LatLng(lat, lng);
        map.setCenter(pos);
        if (d.recenterLevel) map.setLevel(Number(d.recenterLevel));
        placeMarker(lat, lng);
      };
      window.addEventListener("jsbooks:map-goto", gotoHandler);
    }

    function setupDisplay(kakao: any) {
      const valid = places.filter(
        (p) => Array.isArray(p.coord) && Number.isFinite(p.coord[0]) && Number.isFinite(p.coord[1]),
      );
      if (valid.length === 0) return;

      const bounds = new kakao.maps.LatLngBounds();
      for (const p of valid) {
        const pos = new kakao.maps.LatLng(p.coord[0], p.coord[1]);
        bounds.extend(pos);
        const marker = new kakao.maps.Marker({ position: pos, map, title: p.name });

        const label = new kakao.maps.CustomOverlay({
          position: pos,
          yAnchor: 2.2,
          content: `<div class="kakao-pin-label">${escapeHtml(p.name)}</div>`,
        });
        label.setMap(map);

        kakao.maps.event.addListener(marker, "click", () => {
          window.location.href = `/archive/places/${encodeURIComponent(p.slug)}/`;
        });
      }

      if (valid.length === 1) {
        map.setCenter(new kakao.maps.LatLng(valid[0].coord[0], valid[0].coord[1]));
        map.setLevel(6);
      } else {
        map.setBounds(bounds);
      }
    }

    return () => {
      if (gotoHandler) window.removeEventListener("jsbooks:map-goto", gotoHandler);
    };
  });

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
</script>

{#if errorMsg}
  <div class="map-fallback" style={`height:${height}`}>
    <div class="map-fallback-inner">
      <strong>지도를 표시할 수 없습니다</strong>
      <p>{errorMsg}</p>
      <p class="hint">
        <code>PUBLIC_KAKAO_JS_KEY</code> 환경변수를 설정하면 지도가 표시됩니다.
      </p>
    </div>
  </div>
{:else}
  <div class="map-container" bind:this={container} style={`height:${height}`}></div>
{/if}

<style>
  .map-container {
    width: 100%;
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    overflow: hidden;
  }
  .map-fallback {
    width: 100%;
    border: 1px dashed var(--color-rule);
    border-radius: 6px;
    background: var(--color-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
    box-sizing: border-box;
  }
  .map-fallback-inner {
    color: var(--color-muted);
    max-width: 28rem;
  }
  .map-fallback-inner strong {
    color: var(--color-fg);
    display: block;
    margin-bottom: 0.4rem;
  }
  .map-fallback-inner p {
    margin: 0.3rem 0;
    font-size: 0.88rem;
  }
  .map-fallback-inner .hint {
    font-size: 0.8rem;
  }
  .map-fallback-inner code {
    font-size: 0.85em;
  }
  /* 핀 라벨 (CustomOverlay) — 전역 주입이라 :global */
  :global(.kakao-pin-label) {
    background: var(--color-surface-1, #fff);
    border: 1px solid var(--color-rule, #ccc);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-fg, #222);
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    pointer-events: none;
  }
</style>
