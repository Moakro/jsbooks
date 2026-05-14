<script lang="ts">
  /**
   * 달 위상 SVG 아이콘.
   *
   * 어두운 원 위에 lit 영역을 path로 덧칠. 위상별 path는 외곽 반원(밝은 쪽) +
   * 내부 반타원(terminator)으로 구성. terminator의 rx = r * |1 - 2*lit|.
   *
   * waxing(차오름): 오른쪽이 밝음
   * waning(이지러짐): 왼쪽이 밝음
   * 보름(lit=1): 전체 원, 삭(lit=0): path 없음 (어두운 원만 보임)
   */
  import type { MoonPhase } from "../lib/moon";

  let {
    phase,
    size = 42,
    color = "rgba(255, 235, 200, 0.95)",
    dim = "rgba(255, 255, 255, 0.12)",
  }: {
    phase: MoonPhase;
    size?: number;
    color?: string;
    dim?: string;
  } = $props();

  const r = 10;

  function pathFor(lit: number, waxing: boolean): string {
    if (lit <= 0.02) return ""; // 삭 — 아무것도 안 그림
    if (lit >= 0.98) {
      // 망 — 전체 원
      return `M ${-r},0 a ${r},${r} 0 1 0 ${2 * r},0 a ${r},${r} 0 1 0 ${-2 * r},0 Z`;
    }
    // 외곽 반원 방향: waxing → 오른쪽(sweep=1, screen상 시계방향), waning → 왼쪽(sweep=0)
    const outerSweep = waxing ? 1 : 0;
    // 내부 반타원 rx 크기
    const rxMag = r * Math.abs(1 - 2 * lit);
    // 내부 sweep: crescent(lit<0.5)면 외곽과 같은 방향(같은 쪽으로 꺾임), gibbous(lit>0.5)면 반대.
    const innerSweep = waxing
      ? lit < 0.5 ? 1 : 0
      : lit < 0.5 ? 0 : 1;
    return `M 0,${-r} A ${r},${r} 0 0 ${outerSweep} 0,${r} A ${rxMag},${r} 0 0 ${innerSweep} 0,${-r} Z`;
  }

  let d = $derived(pathFor(phase.lit, phase.waxing));
  let isFull = $derived(phase.lit >= 0.98);
  let isNew = $derived(phase.lit <= 0.02);
</script>

<svg
  width={size}
  height={size}
  viewBox="-12 -12 24 24"
  role="img"
  aria-label={`달 위상 — ${phase.name}`}
  class:full={isFull}
  class:new-moon={isNew}
>
  <!-- 어두운 면 (달 전체 윤곽) -->
  <circle cx="0" cy="0" r={r} fill={dim} />
  <!-- 밝은 면 -->
  {#if d}
    <path {d} fill={color} />
  {/if}
  <!-- 외곽선 — 살짝 -->
  <circle cx="0" cy="0" r={r} fill="none" stroke="rgba(255, 255, 255, 0.25)" stroke-width="0.5" />
  <!-- 삭일 때 작은 별 두 개 (어두움 강조) -->
  {#if isNew}
    <circle cx="-6" cy="-7" r="0.5" fill="rgba(255, 255, 255, 0.6)" />
    <circle cx="7" cy="-3" r="0.6" fill="rgba(255, 255, 255, 0.5)" />
    <circle cx="-3" cy="6" r="0.4" fill="rgba(255, 255, 255, 0.55)" />
  {/if}
</svg>

<style>
  svg {
    display: inline-block;
    vertical-align: middle;
  }
  /* 보름달 — 따스한 골드 글로우 */
  svg.full {
    filter: drop-shadow(0 0 6px rgba(255, 220, 150, 0.45));
  }
</style>
