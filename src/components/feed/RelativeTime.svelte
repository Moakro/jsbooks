<script lang="ts">
  import { onMount } from "svelte";
  import { relativeTime, absoluteTime } from "../../lib/relative-time";

  let {
    iso,
    tooltip = true,
    interval = 30_000,
  }: {
    iso: string;
    tooltip?: boolean;
    interval?: number;
  } = $props();

  let now = $state(Date.now());

  onMount(() => {
    if (!interval || interval <= 0) return;
    const id = window.setInterval(() => {
      now = Date.now();
    }, interval);
    return () => window.clearInterval(id);
  });

  const label = $derived(relativeTime(iso, new Date(now)));
  const abs = $derived(absoluteTime(iso));
</script>

<time datetime={iso} title={tooltip ? abs : undefined} class="rel-time">{label}</time>

<style>
  .rel-time {
    color: var(--color-muted, #8a807a);
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
    white-space: nowrap;
  }
</style>
