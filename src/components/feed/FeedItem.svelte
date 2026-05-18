<script lang="ts">
  import type { Snippet } from "svelte";
  import UserAvatar from "./UserAvatar.svelte";
  import UserName from "./UserName.svelte";
  import RelativeTime from "./RelativeTime.svelte";
  import Icon from "../Icon.svelte";

  type User = {
    id?: string | null;
    nickname: string;
    avatar_url?: string | null;
    is_admin?: boolean;
    level?: number;
    affiliation?: string | null;
  };

  let {
    user,
    createdAt,
    updatedAt = null,
    isPinned = false,
    isDeleted = false,
    highlighted = false,
    promoted = false,
    variant = null,
    avatarSize = "sm",
    deletedLabel = "(작성자가 삭제한 댓글입니다)",
    id = null,
    meta,
    body,
    photos,
    actions,
  }: {
    user: User;
    createdAt: string;
    updatedAt?: string | null;
    isPinned?: boolean;
    isDeleted?: boolean;
    highlighted?: boolean;
    promoted?: boolean;
    /** Optional style hook — e.g., comment type "memo"/"question"/"cross"/"cite". */
    variant?: string | null;
    avatarSize?: "xs" | "sm" | "md" | "lg";
    deletedLabel?: string;
    id?: string | null;
    meta?: Snippet;
    body?: Snippet;
    photos?: Snippet;
    actions?: Snippet;
  } = $props();

  const edited = $derived(!!updatedAt && updatedAt !== createdAt);
</script>

<article
  class="feed-item"
  class:pinned={isPinned}
  class:deleted={isDeleted}
  class:highlighted
  class:promoted
  data-variant={variant ?? undefined}
  id={id ?? undefined}
>
  {#if isDeleted}
    <div class="deleted-placeholder">{deletedLabel}</div>
  {:else}
    <div class="row">
      <div class="main">
        <header class="head">
          <UserAvatar nickname={user.nickname} avatarUrl={user.avatar_url ?? null} size={avatarSize} />
          <UserName {user} />
          <span class="dot" aria-hidden="true">·</span>
          <RelativeTime iso={createdAt} />
          {#if edited}
            <span class="edited" title={updatedAt ?? undefined}>(수정됨)</span>
          {/if}
          {#if isPinned}
            <span class="pin-badge" title="운영자 고정" aria-label="운영자 고정">
              <Icon icon="pin" size={12} strokeWidth={1.8} />
            </span>
          {/if}
        </header>

        {#if meta}
          <div class="meta">{@render meta()}</div>
        {/if}

        {#if body}
          <div class="body">{@render body()}</div>
        {/if}

        {#if photos}
          <div class="photos">{@render photos()}</div>
        {/if}

        {#if actions}
          <footer class="actions">{@render actions()}</footer>
        {/if}
      </div>
    </div>
  {/if}
</article>

<style>
  .feed-item {
    display: block;
    padding: var(--feed-card-padding, 0.7rem 0.85rem);
    border-radius: var(--feed-card-radius, 8px);
    background: var(--color-surface, #fdfaf4);
    border: 1px solid var(--color-rule, #e8dfd9);
    transition:
      background 0.3s ease,
      border-color 0.3s ease,
      box-shadow 0.3s ease;
  }
  .feed-item.highlighted {
    background: var(--color-secondary-bg, #f0f7f6);
    border-color: var(--color-secondary, #1e6e6e);
  }
  .feed-item.pinned {
    background: var(--color-primary-bg, #fbf3f1);
    border-color: var(--color-primary, #a8352a);
  }
  .feed-item.promoted {
    background: var(--color-secondary-bg, #f0f7f6);
  }
  .feed-item.deleted {
    background: transparent;
    border-style: dashed;
  }
  .feed-item[data-variant="question"] { border-left: 3px solid var(--color-secondary, #1e6e6e); }
  .feed-item[data-variant="cross"]    { border-left: 3px solid var(--color-secondary-soft, #2c8585); }
  .feed-item[data-variant="cite"]     { border-left: 3px solid var(--color-primary, #a8352a); }
  .feed-item[data-variant="memo"]     { border-left: 3px solid var(--color-rule, #e8dfd9); }

  .deleted-placeholder {
    color: var(--color-muted, #8a807a);
    font-size: 0.9rem;
    font-style: italic;
    padding: 0.15rem 0;
  }

  .row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    font-size: 0.86rem;
    color: var(--color-muted, #8a807a);
    margin-bottom: 0.25rem;
  }
  .dot {
    color: var(--color-muted, #8a807a);
    opacity: 0.6;
  }
  .edited {
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
  }
  .pin-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 0.1rem;
    color: var(--color-primary, #a8352a);
  }
  .meta {
    margin: 0 0 0.3rem;
    font-size: 0.85rem;
  }
  .body {
    line-height: 1.6;
    color: var(--color-fg, #1f1c1a);
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .body :global(p) {
    margin: 0.3rem 0;
  }
  .body :global(p:first-child) { margin-top: 0; }
  .body :global(p:last-child) { margin-bottom: 0; }
  .photos {
    margin-top: 0.4rem;
  }
  .actions {
    margin-top: 0.5rem;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }
</style>
