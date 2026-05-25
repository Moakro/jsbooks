<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import {
    expandOccurrences,
    categoryBadgeClass,
    lunarShortFromSource,
    type CalendarEvent,
    type OccurrenceEvent,
  } from "../lib/calendar-events";

  let monthEvents = $state<OccurrenceEvent[]>([]);
  let todayIso = $state<string>("");
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
      todayIso = isoDate(now);
      const res = await fetch(`/api/events?from=${from}&to=${to}&scope=all`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        loading = false;
        return;
      }
      const data = (await res.json()) as { events: CalendarEvent[] };
      // 홈 배너·달력 상세박스 = 월간 기념일 전용. 일정/기타는 사이드바에서만.
      const annivOnly = (data.events ?? []).filter((e) => e.category === "기념일");
      // '오늘' 별도 row 없이 한 목록으로. 발생일 오름차순, 오늘 항목은 체크 아이콘으로 마킹.
      monthEvents = expandOccurrences(annivOnly, y, m)
        .sort((a, b) => (a.occursOn < b.occursOn ? -1 : a.occursOn > b.occursOn ? 1 : 0));
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

{#if !loading && monthEvents.length > 0}
  <div class="ha">
    <div class="ha-row">
      <span class="ha-label">이번 달</span>
      <div class="ha-list">
        {#each monthEvents as occ (occ.source.id + "@" + occ.occursOn)}
          {@const lunar = lunarShortFromSource(occ.source)}
          {@const isToday = occ.occursOn === todayIso}
          <span
            class="ha-pill {categoryBadgeClass(occ.source.category)}"
            class:today={isToday}
            title={`${occ.source.title} · ${occ.occursOn}${isToday ? " (오늘)" : ""}`}
          >
            {#if isToday}
              <span class="ha-check" aria-label="오늘"><Icon icon="badge-check" size={13} strokeWidth={2} /></span>
            {/if}
            <span class="ha-date">{shortDate(occ.occursOn)}{#if lunar}<span class="ha-lunar">(음{lunar})</span>{/if}</span>
            <span class="ha-title">{occ.source.title}</span>
          </span>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* DayBox 안 하단 영역 — 어두운 배너 배경 위 흰 톤. 월간 기념일을 column stack. */
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
  /* 오늘 발생 항목 — 흰 outline 으로 마킹 */
  .ha-pill.today {
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.55);
  }
  .ha-check {
    display: inline-flex;
    align-items: center;
    color: inherit;
    flex-shrink: 0;
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
</style>
