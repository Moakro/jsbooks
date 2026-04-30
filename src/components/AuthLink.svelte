<script lang="ts">
  import { onMount } from "svelte";

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
{:else if user.needs_nickname}
  <a class="auth-link warn" href="/account/nickname">닉네임 설정</a>
{:else}
  <span class="auth-user">
    {#if user.avatar_url}
      <img src={user.avatar_url} alt="" class="avatar" />
    {/if}
    <span class="name">{user.display_name}</span>
  </span>
  <button class="auth-btn ghost" type="button" onclick={logout} title="로그아웃">↩</button>
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
    padding: 0.25rem 0.5rem;
  }
  .auth-btn.ghost:hover {
    background: var(--color-secondary-bg, #f0f7f6);
    color: var(--color-secondary, #1e6e6e);
    border-color: var(--color-secondary, #1e6e6e);
  }
  .auth-link {
    color: var(--color-bg, #fbf8f4);
    background: var(--color-primary, #a8352a);
    text-decoration: none;
    border-radius: 6px;
    padding: 0.25rem 0.7rem;
    font-size: 0.88rem;
  }
  .auth-link.warn {
    background: var(--color-primary, #a8352a);
  }
  .auth-user {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
  }
  .name {
    color: var(--color-fg, #1f1c1a);
  }
</style>
