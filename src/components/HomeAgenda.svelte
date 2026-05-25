<script lang="ts">
  import { onMount } from "svelte";
  import {
    expandOccurrences,
    categoryBadgeClass,
    lunarShortFromSource,
    type CalendarEvent,
    type OccurrenceEvent,
  } from "../lib/calendar-events";

  let todayEvents = $state<OccurrenceEvent[]>([]);
  let monthEvents = $state<OccurrenceEvent[]>([]);
  let loading = $state(true);

  function isoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  onMount(async () => {
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;
      const from = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const res = await fetch(`/api/events?from=${from}&to=${to}&scope=all`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        loading = false;
        return;
      }
      const data = (await res.json()) as { events: CalendarEvent[] };
      // 홈 배너는 기념일만 노출 (일정/기타는 사이드바·달력에서)
      const annivOnly = (data.events ?? []).filter((e) => e.category === "기념일");
      const all = expandOccurrences(annivOnly, y, m);
      const todayIso = isoDate(now);
      todayEvents = all.filter((o) => o.occursOn === todayIso);
      // 월간(오늘 제외) — 미래 우선, 과거 다음. 간결 N건 cap.
      monthEvents = all
        .filter((o) => o.occursOn !== todayIso)
        .sort((a, b) => {
          const aFuture = a.occursOn >= todayIso ? 0 : 1;
          const bFuture = b.occursOn >= todayIso ? 0 : 1;
          if (aFuture !== bFuture) return aFuture - bFuture;
          return a.occursOn < b.occursOn ? -1 : 1;
        })
        .slice(0, 6);
    } catch {
      /* silent */
    } finally {
      loading = false;
    }
  });

  function shortDate(iso: string): string {
    const [, m, d] = iso.split("-").map(Number);
    return `${m}.${d}`;
  }
</script>

{#if !loading && (todayEvents.length > 0 || monthEvents.length > 0)}
  <div class="ha">
    {#if todayEvents.length > 0}
      <div class="ha-row">
        <span class="ha-label">오늘</span>
        <div class="ha-list">
          {#each todayEvents as occ (occ.source.id + "@" + occ.occursOn)}
            <span class="ha-pill {categoryBadgeClass(occ.source.category)}" title={occ.source.title}>
              <span class="ha-title">{occ.source.title}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
    {#if monthEvents.length > 0}
      <div class="ha-row">
        <span class="ha-label">이번 달</span>
        <div class="ha-list">
          {#each monthEvents as occ (occ.source.id + "@" + occ.occursOn)}
            {@const lunar = lunarShortFromSource(occ.source)}
            <span class="ha-pill {categoryBadgeClass(occ.source.category)}" title={`${occ.source.title} · ${occ.occursOn}`}>
              <span class="ha-date">{shortDate(occ.occursOn)}{#if lunar}<span class="ha-lunar">(음{lunar})</span>{/if}</span>
              <span class="ha-title">{occ.source.title}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* DayBox 안 하단 영역 — 어두운 배너 배경 위 흰 톤. 항목 여러 개면 column 으로 stack. */
  .ha {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.95rem 0.6rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
  }
  .ha-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .ha-label {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.55);
    font-weight: 600;
    flex-shrink: 0;
    min-width: 3.2em;
    line-height: 1.6;
  }
  /* 여러 기념일은 column (세로 stack) */
  .ha-list {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    min-width: 0;
  }
  .ha-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    font-size: 0.82rem;
    text-decoration: none;
    line-height: 1.3;
    max-width: 100%;
  }
  .ha-pill .ha-lunar {
    font-size: 0.72rem;
    opacity: 0.85;
    margin-left: 0.1rem;
  }
  .ha-pill .ha-date {
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
    flex-shrink: 0;
  }
  .ha-pill .ha-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ha-pill:global(.cat-anniversary) {
    background: var(--color-primary, #a8352a);
    color: #fff;
  }
  .ha-pill:global(.cat-event) {
    background: var(--color-secondary, #1e6e6e);
    color: #fff;
  }
  .ha-pill:global(.cat-etc) {
    background: var(--color-rule, #d4cbc4);
    color: #2a2622;
  }
</style>
