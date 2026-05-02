<script lang="ts">
  import { onMount } from "svelte";

  type AdminUser = {
    id: string;
    created_at: string;
    avatar_url: string | null;
    display_name: string | null;
    email: string;
    level: number;
    is_seed: number;
    last_seen_at: string | null;
    comments_count: number;
    flags_received: number;
  };

  const LEVEL_LABEL: Record<number, string> = {
    0: "대기",
    1: "일반",
    2: "검증",
    3: "큐레이터",
    4: "운영자",
  };

  let users = $state<AdminUser[] | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function fmtDate(s: string | null): string {
    if (!s) return "—";
    // SQLite datetime("now") = "YYYY-MM-DD HH:MM:SS" UTC
    const d = new Date(s.replace(" ", "T") + "Z");
    if (isNaN(d.getTime())) return s;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  }

  async function load() {
    try {
      const res = await fetch("/api/admin/users", { credentials: "same-origin" });
      if (res.status === 401) {
        error = "로그인이 필요합니다.";
        return;
      }
      if (res.status === 403) {
        error = "운영자 권한이 필요합니다.";
        return;
      }
      if (!res.ok) {
        error = `요청 실패 (${res.status})`;
        return;
      }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        error = "응답 형식 오류";
        return;
      }
      const data = await res.json();
      users = data.users ?? [];
    } catch (e: any) {
      error = e?.message ?? "네트워크 오류";
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

{#if loading}
  <p class="hint">불러오는 중…</p>
{:else if error}
  <p class="hint err">{error}</p>
{:else if users && users.length > 0}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>가입일</th>
          <th>프로필</th>
          <th>닉네임</th>
          <th>등급</th>
          <th>이메일</th>
          <th>최근접속</th>
          <th class="num">댓글</th>
          <th class="num">신고</th>
          <th>시드</th>
        </tr>
      </thead>
      <tbody>
        {#each users as u (u.id)}
          <tr>
            <td>{fmtDate(u.created_at)}</td>
            <td>
              {#if u.avatar_url}
                <img src={u.avatar_url} alt="" class="avatar" />
              {:else}
                <span class="avatar avatar-fallback" aria-hidden="true"></span>
              {/if}
            </td>
            <td>{u.display_name ?? "—"}</td>
            <td><span class={`level-badge level-${u.level}`}>{LEVEL_LABEL[u.level] ?? u.level}</span></td>
            <td class="email">{u.email}</td>
            <td>{fmtDate(u.last_seen_at)}</td>
            <td class="num">{u.comments_count}</td>
            <td class="num" class:flagged={u.flags_received > 0}>{u.flags_received}</td>
            <td>{u.is_seed ? "✓" : ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="meta">총 {users.length}명</p>
{:else}
  <p class="hint">회원이 없습니다.</p>
{/if}

<style>
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--color-rule);
    border-radius: var(--radius-md, 10px);
    background: var(--color-surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: 0.55rem 0.7rem;
    text-align: left;
    border-bottom: 1px solid var(--color-rule);
    white-space: nowrap;
  }
  th {
    background: var(--color-surface-2);
    font-weight: 600;
    color: var(--color-muted);
    font-size: 0.78rem;
    letter-spacing: 0.02em;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  tbody tr:hover {
    background: var(--color-primary-bg);
  }
  td.email {
    color: var(--color-muted);
  }
  td.num,
  th.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td.flagged {
    color: var(--color-primary);
    font-weight: 600;
  }
  .avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    display: inline-block;
    vertical-align: middle;
  }
  .avatar-fallback {
    background: var(--color-rule);
    background-image: linear-gradient(135deg, var(--color-rule), var(--color-disabled));
  }
  .level-badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78rem;
    background: var(--color-rule);
    color: var(--color-fg);
  }
  .level-badge.level-4 {
    background: var(--color-primary);
    color: #fff;
  }
  .level-badge.level-3 {
    background: var(--color-secondary);
    color: #fff;
  }
  .level-badge.level-2 {
    background: var(--color-secondary-bg);
    color: var(--color-secondary);
  }
  .level-badge.level-0 {
    background: var(--color-rule);
    color: var(--color-disabled);
  }
  .hint {
    color: var(--color-muted);
    padding: 0.6rem 0;
  }
  .hint.err {
    color: var(--color-primary);
  }
  .meta {
    color: var(--color-muted);
    font-size: 0.85rem;
    margin-top: 0.7rem;
  }
</style>
