<script lang="ts">
  type User = {
    id?: string | null;
    nickname: string;
    is_admin?: boolean;
    level?: number;
    affiliation?: string | null;
  };

  let {
    user,
    clickable = false,
  }: {
    user: User;
    clickable?: boolean;
  } = $props();

  const isAdmin = $derived(user.is_admin === true || (typeof user.level === "number" && user.level >= 4));
  const isCurator = $derived(!isAdmin && typeof user.level === "number" && user.level >= 3);
  const isVerified = $derived(!isAdmin && !isCurator && user.level === 2);
  const href = $derived(clickable && user.id ? `/u/${encodeURIComponent(user.id)}` : null);
</script>

<span class="user-name">
  {#if href}
    <a class="name" href={href}>{user.nickname}</a>
  {:else}
    <span class="name">{user.nickname}</span>
  {/if}
  {#if isAdmin}
    <span class="badge admin" title="운영자">운영자</span>
  {:else if isCurator}
    <span class="badge curator" title="큐레이터">큐레이터</span>
  {:else if isVerified}
    <span class="badge verified" title="검증 회원">검증</span>
  {/if}
  {#if user.affiliation}
    <span class="affil">{user.affiliation}</span>
  {/if}
</span>

<style>
  .user-name {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .name {
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14em;
  }
  a.name:hover {
    text-decoration: underline;
    text-decoration-color: var(--color-muted, #8a807a);
  }
  .badge {
    font-size: 0.72rem;
    border-radius: 999px;
    padding: 1px 7px;
    line-height: 1.4;
    flex-shrink: 0;
  }
  .badge.admin {
    color: var(--color-primary, #a8352a);
    background: var(--color-primary-bg, #fbf3f1);
    font-weight: 600;
  }
  .badge.curator {
    color: var(--color-bg, #fbf8f4);
    background: var(--color-primary, #a8352a);
  }
  .badge.verified {
    color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    padding: 0 6px;
  }
  .affil {
    font-size: 0.72rem;
    color: var(--color-secondary, #1e6e6e);
    border: 1px solid var(--color-secondary, #1e6e6e);
    border-radius: 999px;
    padding: 0 6px;
    line-height: 1.4;
  }
</style>
