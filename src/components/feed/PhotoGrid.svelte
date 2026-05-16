<script lang="ts">
  type Photo = { url: string; width?: number; height?: number; alt?: string };

  let {
    photos,
    clickable = true,
  }: {
    photos: Photo[];
    clickable?: boolean;
  } = $props();

  const visible = $derived(photos.slice(0, 9));
  const overflow = $derived(Math.max(0, photos.length - 9));
  const layout = $derived(
    visible.length === 1
      ? "one"
      : visible.length === 2
        ? "two"
        : visible.length === 3
          ? "three"
          : visible.length === 4
            ? "four"
            : "many",
  );
</script>

{#if visible.length > 0}
  <div class="grid layout-{layout}">
    {#each visible as p, i (p.url)}
      {#if clickable}
        <a
          class="cell"
          class:has-overflow={i === visible.length - 1 && overflow > 0}
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          style:--overflow-count={`"+${overflow}"`}
        >
          <img src={p.url} alt={p.alt ?? ""} loading="lazy" />
          {#if i === visible.length - 1 && overflow > 0}
            <span class="overflow-badge" aria-hidden="true">+{overflow}</span>
          {/if}
        </a>
      {:else}
        <div class="cell">
          <img src={p.url} alt={p.alt ?? ""} loading="lazy" />
          {#if i === visible.length - 1 && overflow > 0}
            <span class="overflow-badge" aria-hidden="true">+{overflow}</span>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .grid {
    margin-top: 0.5rem;
    display: grid;
    gap: 4px;
    border-radius: var(--radius-md, 10px);
    overflow: hidden;
    max-width: 540px;
  }
  .layout-one {
    grid-template-columns: 1fr;
  }
  .layout-two {
    grid-template-columns: 1fr 1fr;
  }
  .layout-three {
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .layout-three .cell:first-child {
    grid-row: span 2;
  }
  .layout-four {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .layout-many {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }

  .cell {
    display: block;
    position: relative;
    overflow: hidden;
    background: var(--color-surface-2, #fbf8f1);
    aspect-ratio: 1 / 1;
    line-height: 0;
    text-decoration: none;
  }
  .layout-one .cell {
    aspect-ratio: auto;
    max-height: 480px;
  }
  .cell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.18s ease;
  }
  .layout-one .cell img {
    max-height: 480px;
    object-fit: contain;
    width: 100%;
    height: auto;
  }
  a.cell:hover img {
    transform: scale(1.02);
  }
  .overflow-badge {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-weight: 700;
    font-size: 1.2rem;
    pointer-events: none;
  }
</style>
