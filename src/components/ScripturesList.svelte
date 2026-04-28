<script lang="ts">
  import { onMount } from "svelte";

  type ScriptureMeta = {
    slug: string;
    name: string;
    name_hanja: string | null;
    editor: string | null;
    edition_date: string | null;
    href: string;
  };

  type Pref = {
    scripture: string;
    status: "active" | "hidden" | "blocked";
    display_order: number;
  };

  /**
   * `all` is provided by Astro at build time (every scripture meta), so the
   * sidebar works for logged-out visitors without any API call. Logged-in
   * users additionally fetch their preferences and we filter & reorder.
   */
  let { all, currentSlug = null }: { all: ScriptureMeta[]; currentSlug?: string | null } = $props();

  let user = $state<{ id: string } | null>(null);
  let prefs = $state<Pref[] | null>(null);
  let loading = $state(true);

  async function load() {
    try {
      const me = await fetch("/api/me", { credentials: "same-origin" });
      const meData = await me.json();
      user = meData.user ? { id: meData.user.id } : null;
      // /api/me/scriptures is reserved for Phase B (per-user library prefs).
      // Until that endpoint exists we don't call it — calling a known-404 URL
      // pollutes the browser console with red errors that try/catch can't
      // suppress. Default behavior (= show all scriptures, default order)
      // already handles both logged-in and logged-out cases here.
      prefs = null;
    } finally {
      loading = false;
    }
  }

  // Compute the visible list. Logged-out: show all in default order.
  // Logged-in with no prefs: same. Logged-in with prefs: filter+sort.
  const visible = $derived.by((): ScriptureMeta[] => {
    if (!prefs || prefs.length === 0) return all;
    const byPref = new Map(prefs.map((p) => [p.scripture, p]));
    return all
      .filter((s) => {
        const p = byPref.get(s.slug);
        if (!p) return false; // not in user's library
        return p.status === "active";
      })
      .sort((a, b) => {
        const oa = byPref.get(a.slug)?.display_order ?? 0;
        const ob = byPref.get(b.slug)?.display_order ?? 0;
        return oa - ob;
      });
  });

  onMount(load);
</script>

<div class="block">
  <h3>내 경전</h3>

  {#if loading}
    <p class="muted small">불러오는 중…</p>
  {:else if visible.length === 0}
    <p class="muted small">표시할 경전이 없습니다.</p>
  {:else}
    <ul class="scriptures">
      {#each visible as s (s.slug)}
        <li class:active={s.slug === currentSlug}>
          <a href={s.href}>
            <span class="name">{s.name}</span>
            {#if s.name_hanja}
              <span class="hanja">({s.name_hanja})</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !user}
    <p class="login-hint">
      로그인 후 경전 목록을 설정할 수 있습니다.
    </p>
  {/if}
</div>

<style>
  .block {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--color-rule);
  }
  h3 {
    font-size: 0.78rem;
    color: var(--color-muted);
    margin: 0 0 0.5rem;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
  }
  .scriptures {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .scriptures li a {
    display: block;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    text-decoration: none;
    color: var(--color-fg);
    font-size: 0.92rem;
    line-height: 1.35;
  }
  .scriptures li a:hover {
    background: var(--color-primary-bg);
  }
  .scriptures li.active a {
    background: var(--color-primary-bg);
    color: var(--color-primary);
    font-weight: 600;
    border-left: 3px solid var(--color-primary);
    padding-left: calc(0.5rem - 3px);
  }
  .name {
    font-weight: inherit;
  }
  .hanja {
    color: var(--color-hanja);
    font-size: 0.78em;
    margin-left: 0.2rem;
  }
  .muted.small {
    color: var(--color-muted);
    font-size: 0.82rem;
    margin: 0;
  }
  .login-hint {
    margin: 0.6rem 0 0;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--color-rule);
    color: var(--color-muted);
    font-size: 0.78rem;
    line-height: 1.5;
  }
</style>
