<script lang="ts">
  import { onMount } from "svelte";
  import {
    expandOccurrences,
    categoryShortLabel,
    categoryBadgeClass,
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
      const all = expandOccurrences(data.events ?? [], y, m);
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
            <a class="ha-pill {categoryBadgeClass(occ.source.category)}" href="/calendar/" title={occ.source.title}>
              <span class="ha-cat">{categoryShortLabel(occ.source.category)}</span>
              <span class="ha-title">{occ.source.title}</span>
            </a>
          {/each}
        </div>
      </div>
    {/if}
    {#if monthEvents.length > 0}
      <div class="ha-row">
        <span class="ha-label">이번 달</span>
        <div class="ha-list">
          {#each monthEvents as occ (occ.source.id + "@" + occ.occursOn)}
            <a class="ha-pill {categoryBadgeClass(occ.source.category)}" href="/calendar/" title={`${occ.source.title} · ${occ.occursOn}`}>
              <span class="ha-date">{shortDate(occ.occursOn)}</span>
              <span class="ha-cat">{categoryShortLabel(occ.source.category)}</span>
              <span class="ha-title">{occ.source.title}</span>
            </a>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ha {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0.5rem 0 1rem;
    padding: 0.6rem 0.85rem;
    background: linear-gradient(180deg, #ffffff 0%, var(--color-bg, #fbf8f4) 100%);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    box-shadow:
      0 1px 2px rgba(60, 40, 25, 0.04),
      0 2px 8px rgba(60, 40, 25, 0.06);
  }
  .ha-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .ha-label {
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    font-weight: 600;
    flex-shrink: 0;
    min-width: 3.2em;
  }
  .ha-list {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-width: 0;
  }
  .ha-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    font-size: 0.82rem;
    text-decoration: none;
    line-height: 1.3;
    max-width: 100%;
  }
  .ha-pill .ha-cat {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0 0.3rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.28);
    flex-shrink: 0;
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
