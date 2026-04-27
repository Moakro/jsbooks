<script lang="ts">
  import { onMount } from "svelte";

  let user = $state<{ display_name: string | null; affiliation: string | null } | null>(null);
  let nickname = $state("");
  let affiliation = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let next = $state("/");

  async function load() {
    try {
      const url = new URL(window.location.href);
      next = url.searchParams.get("next") || "/";
      const res = await fetch("/api/me", { credentials: "same-origin" });
      const data = await res.json();
      user = data.user;
      if (user) {
        nickname = user.display_name ?? "";
        affiliation = user.affiliation ?? "";
      }
    } finally {
      loading = false;
    }
  }

  async function save() {
    error = null;
    saving = true;
    try {
      const res = await fetch("/api/me/nickname", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim(),
          affiliation: affiliation.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.error ?? `등록 실패 (${res.status})`;
        return;
      }
      window.location.href = next;
    } finally {
      saving = false;
    }
  }

  onMount(load);
</script>

<div class="wrap">
  {#if loading}
    <p class="muted">불러오는 중…</p>
  {:else if user === null}
    <p class="muted">로그인이 필요합니다.</p>
    <p>
      <a href={`/api/auth/login?next=${encodeURIComponent("/account/nickname?next=" + encodeURIComponent(next))}`} class="cta">
        로그인
      </a>
    </p>
  {:else}
    <p class="lead">
      구글 본명은 사이트 어디에도 표시되지 않습니다. 사이트에서 사용할 닉네임만 정해주세요.
    </p>

    <form onsubmit={(e) => { e.preventDefault(); save(); }}>
      <label class="field">
        <span>닉네임 <em>(2~24자)</em></span>
        <input bind:value={nickname} maxlength="24" minlength="2" required autofocus
          placeholder="예: 학암독자" />
      </label>

      <label class="field">
        <span>분파 자가 표시 <em>(선택)</em></span>
        <input bind:value={affiliation} maxlength="40"
          placeholder="예: 무종파 / 학술 / 본인 표기 자유" />
      </label>

      <details class="rules">
        <summary>닉네임 정책 (펼침)</summary>
        <ul>
          <li>운영자·단체명을 유추할 수 있는 닉네임은 거부됩니다 (관리자, 본부, 공식, 총무, 상제 등).</li>
          <li>중복 확인은 정확 일치 기준입니다. 프로필 이미지로 사용자를 구분합니다.</li>
          <li>닉네임 변경은 가능하지만 변경 이력이 보존됩니다 (도주 방지).</li>
          <li>분파 자가 표시는 댓글 옆에 작은 라벨로 표시됩니다. 비워두면 표시 안 됩니다.</li>
        </ul>
      </details>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <button type="submit" class="cta" disabled={saving || nickname.trim().length < 2}>
          {saving ? "저장 중…" : "저장하고 계속"}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .wrap {
    max-width: 480px;
    margin: 1rem auto;
  }
  .lead {
    color: var(--color-muted);
    margin: 0 0 1.2rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 1rem;
  }
  .field span {
    font-size: 0.92rem;
  }
  .field em {
    color: var(--color-muted);
    font-style: normal;
    font-size: 0.82rem;
    margin-left: 0.3rem;
  }
  input {
    font: inherit;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--color-rule);
    border-radius: 5px;
    background: var(--color-bg);
    color: var(--color-fg);
  }
  input:focus {
    outline: none;
    border-color: var(--color-primary);
    background: var(--color-primary-bg);
  }
  .rules {
    margin: 1rem 0;
    font-size: 0.88rem;
    color: var(--color-muted);
  }
  .rules summary {
    cursor: pointer;
    color: var(--color-secondary);
  }
  .rules ul {
    margin: 0.5rem 0 0;
    padding-left: 1.2rem;
    line-height: 1.6;
  }
  .error {
    color: var(--color-primary);
    margin: 0.6rem 0;
  }
  .actions {
    text-align: right;
  }
  .cta {
    background: var(--color-primary);
    color: var(--color-bg);
    border: none;
    border-radius: 5px;
    padding: 0.55rem 1.1rem;
    font: inherit;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  .cta:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cta:hover:not(:disabled) {
    background: var(--color-primary-soft);
  }
  .muted {
    color: var(--color-muted);
  }
</style>
