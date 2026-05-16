<script lang="ts">
  type Size = "xs" | "sm" | "md" | "lg";

  let {
    nickname,
    avatarUrl = null,
    size = "sm",
  }: {
    nickname: string;
    avatarUrl?: string | null;
    size?: Size;
  } = $props();

  const SIZE_PX: Record<Size, number> = { xs: 18, sm: 24, md: 36, lg: 48 };

  function hashHue(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }

  const px = $derived(SIZE_PX[size]);
  const initial = $derived((nickname ?? "?").trim().charAt(0).toUpperCase() || "?");
  const hue = $derived(hashHue(nickname ?? ""));
</script>

<span
  class="avatar size-{size}"
  style:--size="{px}px"
  style:--hue={hue}
  aria-hidden="true"
>
  {#if avatarUrl}
    <img src={avatarUrl} alt="" width={px} height={px} loading="lazy" />
  {:else}
    <span class="initial">{initial}</span>
  {/if}
</span>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    flex-shrink: 0;
    border-radius: 50%;
    overflow: hidden;
    background: hsl(var(--hue), 38%, 58%);
    color: #fff;
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    background: var(--color-rule, #e8dfd9);
  }
  .initial {
    font-size: calc(var(--size) * 0.5);
  }
  @media (prefers-color-scheme: dark) {
    .avatar { background: hsl(var(--hue), 32%, 48%); }
  }
</style>
