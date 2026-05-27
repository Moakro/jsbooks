<script lang="ts">
  /**
   * '소식' 박스 우측상단에 absolute 로 떠 있는 운영자용 '+ 새 글' 버튼.
   * 비로그인/일반 회원에게는 아무것도 안 보임.
   */
  import { onMount } from "svelte";

  let isAdmin = $state(false);

  onMount(async () => {
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (!res.ok) return;
      const me = await res.json().catch(() => null);
      isAdmin = (me?.user?.level ?? 0) >= 4;
    } catch { /* silent */ }
  });
</script>

{#if isAdmin}
  <a class="btn-new" href="/admin/news/">+ 새 글</a>
{/if}

<style>
  .btn-new {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary, #a8352a) 7%, transparent);
    color: var(--color-primary, #a8352a);
    text-decoration: none;
    font-size: 0.86rem;
    font-weight: 600;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .btn-new:hover {
    background: var(--color-primary, #a8352a);
    color: #fff;
  }
</style>
