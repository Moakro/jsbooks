<script lang="ts">
  import { onMount } from "svelte";
  import { getDayInfo, type DayInfo } from "../lib/date";
  import { getWeather, type WeatherSnapshot } from "../lib/weather";
  import Icon from "./Icon.svelte";

  let info = $state<DayInfo | null>(null);
  let weather = $state<WeatherSnapshot | null>(null);

  onMount(() => {
    info = getDayInfo(new Date());
    getWeather().then((w) => {
      weather = w;
    });
    // Refresh at next midnight so the box updates without a reload.
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      5,
    );
    const ms = nextMidnight.getTime() - now.getTime();
    const t = setTimeout(() => {
      info = getDayInfo(new Date());
    }, ms);
    return () => clearTimeout(t);
  });

  function jeolgiParts(i: DayInfo): { name: string; hanja: string; suffix: string } {
    const j = i.jeolgi;
    if (j.daysSince === 0) {
      return { name: j.current.name, hanja: j.current.hanja, suffix: "오늘" };
    }
    if (j.daysUntil <= 3) {
      return { name: j.next.name, hanja: j.next.hanja, suffix: `${j.daysUntil}일 전` };
    }
    return { name: j.current.name, hanja: j.current.hanja, suffix: `${j.daysSince}일째` };
  }
</script>

<a class="daybox" href="/calendar/" aria-label="달력 페이지로 이동">
  {#if info}
    <div class="left">
      <div class="row top">
        <span class="solar">{info.solar.ymd}</span>
        <span class="weekday">({info.solar.weekday})</span>
        {#if info.lunarKo}
          <span class="dot" aria-hidden="true">·</span>
          <span class="lunar">{info.lunarKo}</span>
        {/if}
      </div>
      <div class="row sub">
        {#if info.lunar}
          <span class="hanja">{info.lunar.chinese_gapja}</span>
          <span class="dot" aria-hidden="true">·</span>
        {/if}
        <span class="jeolgi-text">
          <span class="jeolgi-name">{jeolgiParts(info).name}</span><span class="hanja-sub">({jeolgiParts(info).hanja})</span>
          <span class="jeolgi-suffix">{jeolgiParts(info).suffix}</span>
        </span>
      </div>
      {#if info.weekMemorials.length > 0}
        <div class="row memorials">
          <span class="memo-label">금주</span>
          {#each info.weekMemorials as m, idx}
            {#if idx > 0}<span class="dot" aria-hidden="true">·</span>{/if}
            <span class="memo-name">{m.name}</span>
          {/each}
        </div>
      {/if}
    </div>
    {#if weather}
      <div class="right" aria-label="{weather.label} {weather.tempC}도, {weather.region}">
        <Icon icon={weather.iconName} size={42} strokeWidth={1.6} />
        <div class="info">
          <div class="temp">{weather.tempC}°</div>
          <div class="region">{weather.region}</div>
        </div>
      </div>
    {/if}
  {/if}
</a>

<style>
  .daybox {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0;
    background: linear-gradient(120deg, #f3dcd5 0%, #dbeae8 100%);
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 10px;
    text-decoration: none;
    color: var(--color-fg, #1f1c1a);
    overflow: hidden;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
  }
  @media (prefers-color-scheme: dark) {
    .daybox {
      background: linear-gradient(120deg, #3a1d18 0%, #173030 100%);
    }
  }
  .daybox:hover {
    border-color: var(--color-secondary, #1e6e6e);
    box-shadow: 0 2px 12px rgba(30, 110, 110, 0.08);
  }
  .left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    padding: 0.7rem 0.95rem;
  }
  .right {
    flex-shrink: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 1.1rem;
    border-left: 1px solid var(--color-rule, #e8dfd9);
    color: var(--color-secondary, #1e6e6e);
    min-width: 180px;
  }
  .daybox:hover .right {
    border-left-color: var(--color-secondary, #1e6e6e);
  }
  .right :global(svg) {
    flex-shrink: 0;
  }
  .right .info {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    line-height: 1.15;
  }
  .right .temp {
    font-size: 1.15rem;
    font-weight: 500;
    color: var(--color-fg, #1f1c1a);
  }
  .right .region {
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
  }
  @media (max-width: 720px) {
    .right {
      min-width: 0;
      padding: 0.5rem 0.85rem;
      gap: 0.5rem;
    }
    .right .temp {
      font-size: 1rem;
    }
  }
  .row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .row.top {
    font-size: 0.95rem;
    font-weight: 500;
  }
  .solar {
    color: var(--color-fg, #1f1c1a);
  }
  .weekday {
    color: var(--color-muted, #8a807a);
    font-size: 0.9em;
  }
  .dot {
    color: var(--color-disabled, #b8b0aa);
  }
  .lunar {
    color: var(--color-secondary, #1e6e6e);
  }
  .row.sub {
    font-size: 0.8rem;
    color: var(--color-muted, #8a807a);
    align-items: center;
  }
  .hanja {
    color: var(--color-hanja, #5b504a);
    letter-spacing: 0.03em;
  }
  .jeolgi-text {
    color: var(--color-muted, #8a807a);
  }
  .jeolgi-name {
    color: var(--color-primary, #a8352a);
    font-weight: 500;
  }
  .hanja-sub {
    color: var(--color-hanja, #5b504a);
    font-size: 0.92em;
    margin-left: 0.05rem;
  }
  .jeolgi-suffix {
    margin-left: 0.2rem;
  }
  .row.memorials {
    margin-top: 0.15rem;
    padding-top: 0.3rem;
    border-top: 1px dashed var(--color-rule, #e8dfd9);
    font-size: 0.8rem;
    align-items: center;
  }
  .memo-label {
    color: var(--color-muted, #8a807a);
    font-size: 0.78rem;
  }
  .memo-name {
    color: var(--color-fg, #1f1c1a);
  }

  @media (max-width: 640px) {
    .daybox {
      padding: 0.5rem 0.75rem;
      gap: 0.15rem;
    }
    .row.top {
      font-size: 0.9rem;
    }
    .row.sub {
      font-size: 0.76rem;
    }
  }
</style>
