<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  type User = {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    needs_nickname: boolean;
    level: number;
  } | null;

  let user = $state<User>(null);
  let loading = $state(true);

  async function load() {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) {
        user = null;
        return;
      }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        user = null;
        return;
      }
      const data = await res.json();
      user = data.user;
    } catch {
      user = null;
    } finally {
      loading = false;
    }
  }

  function login() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/auth/login?next=${next}`;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.reload();
  }

  onMount(load);
</script>

{#if loading}
  <span class="auth-placeholder" aria-hidden="true"></span>
{:else if user === null}
  <button class="auth-btn" type="button" onclick={login}>로그인</button>
{:else}
  <a
    class="auth-user"
    class:needs-nickname={user.needs_nickname}
    href={user.needs_nickname ? "/account/nickname" : "/account/library/"}
    title={user.needs_nickname ? "닉네임 설정 필요" : "내 서재"}
  >
    {#if user.avatar_url}
      <img src={user.avatar_url} alt="" class="avatar" />
    {:else}
      <span class="avatar avatar-fallback" aria-hidden="true"></span>
    {/if}
    {#if !user.needs_nickname && user.display_name}
      <span class="name">{user.display_name}</span>
    {/if}
    {#if user.needs_nickname}
      <span class="badge-dot" aria-label="닉네임 설정 필요"></span>
    {/if}
  </a>
  <button class="auth-btn ghost" type="button" onclick={logout} title="로그아웃" aria-label="로그아웃">
    <Icon icon="log-out" size={16} />
  </button>
{/if}

<style>
  .auth-placeholder {
    display: inline-block;
    width: 4rem;
    height: 1.6rem;
  }
  .auth-btn {
    background: transparent;
    border: 1px solid var(--color-primary, #a8352a);
    color: var(--color-primary, #a8352a);
    border-radius: 6px;
    padding: 0.25rem 0.7rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
  }
  .auth-btn:hover {
    background: var(--color-primary, #a8352a);
    color: var(--color-bg, #fbf8f4);
  }
  .auth-btn.ghost {
    border-color: var(--color-rule, #e8dfd9);
    color: var(--color-muted, #8a807a);
    padding: 0.25rem 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .auth-btn.ghost:hover {
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
    border-color: var(--color-secondary, #1e6e6e);
  }
  .auth-user {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    text-decoration: none;
    color: var(--color-fg, #1f1c1a);
    border-radius: 999px;
    padding: 0.15rem 0.45rem 0.15rem 0.15rem;
    transition: background 0.15s ease;
  }
  .auth-user:hover {
    background: var(--color-primary-bg, #fbf3f1);
  }
  .auth-user.needs-nickname {
    padding-right: 0.15rem;
  }
  .avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .avatar-fallback {
    background: var(--color-rule, #e8dfd9);
    background-image: linear-gradient(
      135deg,
      var(--color-rule, #e8dfd9),
      var(--color-disabled, #b8b0aa)
    );
  }
  .name {
    color: var(--color-fg, #1f1c1a);
  }
  .badge-dot {
    position: absolute;
    top: 0;
    right: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary, #a8352a);
    box-shadow: 0 0 0 2px var(--color-bg, #fbf8f4);
    pointer-events: none;
  }
</style>
