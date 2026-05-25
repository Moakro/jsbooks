<script lang="ts">
  import { tick } from "svelte";
  import type { CalendarEvent, EventCategory } from "../../lib/calendar-events";
  import { getLunar, formatLunarShort } from "../../lib/date";
  import Modal from "../Modal.svelte";

  interface Props {
    open: boolean;
    /** 편집 모드면 기존 이벤트, 아니면 null. */
    event?: CalendarEvent | null;
    /** 새 일정 추가 시 기본 시작일 (YYYY-MM-DD). */
    defaultDate?: string;
    onClose: () => void;
    /** 저장 또는 삭제 성공 후 호출. 사이드바 갱신 트리거. */
    onSaved: () => void;
  }

  let { open = $bindable(), event = null, defaultDate, onClose, onSaved }: Props = $props();

  const CATEGORIES: { id: EventCategory; label: string }[] = [
    { id: "기념일", label: "기념일" },
    { id: "일정",   label: "일정" },
    { id: "기타",   label: "기타" },
  ];

  let title = $state("");
  let startDate = $state("");
  let hasEndDate = $state(false);
  let endDate = $state("");
  let category = $state<EventCategory>("기념일");
  let isAnnual = $state(false);
  let isLunar = $state(false);
  let isPublic = $state(false);
  let memo = $state("");
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let titleInputEl = $state<HTMLInputElement | undefined>();

  const isEditMode = $derived(!!event);

  // 카테고리 변경 시 무관 옵션 자동 해제 (서버 정합성 보장 + UX)
  $effect(() => {
    if (category === "기념일") {
      isPublic = false;
    } else {
      isAnnual = false;
      isLunar = false;
    }
  });

  $effect(() => {
    if (!open) return;
    if (event) {
      title = event.title;
      startDate = event.start_date;
      hasEndDate = !!event.end_date && event.end_date !== event.start_date;
      endDate = event.end_date ?? "";
      const cat = (event.category as EventCategory) ?? "기념일";
      category = CATEGORIES.some((c) => c.id === cat) ? cat : "기념일";
      isAnnual = event.is_annual === 1;
      isLunar = event.is_lunar === 1;
      isPublic = event.is_public === 1;
      memo = event.memo ?? "";
    } else {
      title = "";
      startDate = defaultDate || todayIso();
      hasEndDate = false;
      endDate = "";
      category = "기념일";
      isAnnual = false;
      isLunar = false;
      isPublic = false;
      memo = "";
    }
    errorMessage = null;
    tick().then(() => titleInputEl?.focus());
  });

  function todayIso(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  /** 입력된 양력 startDate 의 음력 표기 — 라벨 옆 실시간 보조. */
  const lunarHint = $derived.by(() => {
    if (!startDate) return null;
    const parts = startDate.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    const info = getLunar(new Date(y, m - 1, d));
    if (!info) return null;
    return formatLunarShort(info.month, info.day, info.intercalation);
  });

  function handleClose() {
    if (isSubmitting) return;
    open = false;
    onClose();
  }

  async function handleSubmit() {
    const t = title.trim();
    if (!t) {
      errorMessage = "제목을 입력해주세요.";
      return;
    }
    if (!startDate) {
      errorMessage = "일자를 선택해주세요.";
      return;
    }
    if (hasEndDate && endDate && endDate < startDate) {
      errorMessage = "종료일은 시작일 이후여야 합니다.";
      return;
    }
    isSubmitting = true;
    errorMessage = null;
    try {
      // 음력 체크 시 양력 input 을 음력 형식으로 변환해 저장 (occurrence 코드는 DB 가 음력 형식이라 가정).
      let savedStart = startDate;
      if (category === "기념일" && isLunar) {
        const [sy, sm, sd] = startDate.split("-").map(Number);
        const { getLunar } = await import("../../lib/date");
        const l = getLunar(new Date(sy, sm - 1, sd));
        if (l) {
          savedStart = `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}`;
        }
      }
      const body = {
        title: t,
        start_date: savedStart,
        end_date: hasEndDate && endDate ? endDate : null,
        category,
        is_annual: category === "기념일" && isAnnual ? 1 : 0,
        is_lunar:  category === "기념일" && isLunar  ? 1 : 0,
        is_public: category !== "기념일" && isPublic ? 1 : 0,
        memo: memo.trim() || null,
      };
      const url = isEditMode && event ? `/api/events/${event.id}` : "/api/events";
      const method = isEditMode ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        errorMessage = "로그인이 필요합니다.";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        errorMessage = data.error ?? "일정 저장에 실패했습니다.";
        return;
      }
      open = false;
      onSaved();
      onClose();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "일정 저장에 실패했습니다.";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleDelete() {
    if (!event) return;
    if (!confirm("이 일정을 삭제할까요?")) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        errorMessage = data.error ?? "삭제에 실패했습니다.";
        return;
      }
      open = false;
      onSaved();
      onClose();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "삭제에 실패했습니다.";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<Modal
  {open}
  title={isEditMode ? "일정 수정" : "일정 추가"}
  onClose={handleClose}
  maxWidth="460px"
  closeOnBackdrop={!isSubmitting}
  closeOnEsc={!isSubmitting}
>
  <form
    class="em-body"
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
  >
    <div class="em-field">
      <label for="em-input-title">제목</label>
      <input
        id="em-input-title"
        type="text"
        bind:value={title}
        bind:this={titleInputEl}
        placeholder="일정 제목"
        maxlength="200"
        required
      />
    </div>

    <div class="em-field">
      <label for="em-cat">카테고리</label>
      <select id="em-cat" bind:value={category}>
        {#each CATEGORIES as c}
          <option value={c.id}>{c.label}</option>
        {/each}
      </select>
    </div>

    {#if category === "기념일"}
      <div class="em-checkgroup">
        <label>
          <input type="checkbox" bind:checked={isAnnual} />
          <span>연례 <small>(매년 같은 날)</small></span>
        </label>
        <label>
          <input type="checkbox" bind:checked={isLunar} />
          <span>음력 <small>(입력일을 음력 기준으로)</small></span>
        </label>
      </div>
      <p class="em-lunar-note">
        연례 체크 시 시작 연도를 기준으로 입력하세요. 음력 기념일은 <strong>양력 날짜 입력 후 음력 체크</strong> — 저장 시 자동으로 음력으로 변환됩니다.<br />
        <small>예: 천강절 = 1871년 11월 1일 입력 + 음력 체크 (= 음력 1871.9.19)</small>
      </p>
    {:else}
      <div class="em-checkgroup">
        <label>
          <input type="checkbox" bind:checked={isPublic} />
          <span>공개 <small>(전체 사용자에게 노출)</small></span>
        </label>
      </div>
    {/if}

    <div class="em-field">
      <label for="em-start">
        일자
        {#if lunarHint}
          <span class="em-lunar-hint">({lunarHint})</span>
        {/if}
      </label>
      <input id="em-start" type="date" bind:value={startDate} required />
    </div>

    <div class="em-checkbox">
      <label>
        <input type="checkbox" bind:checked={hasEndDate} />
        <span>기간 있음</span>
      </label>
    </div>

    {#if hasEndDate}
      <div class="em-field">
        <label for="em-end">종료일</label>
        <input id="em-end" type="date" bind:value={endDate} min={startDate} />
      </div>
    {/if}

    <div class="em-field">
      <label for="em-memo">메모</label>
      <textarea id="em-memo" rows="3" bind:value={memo} placeholder="메모 (선택)" maxlength="2000"></textarea>
    </div>

    {#if errorMessage}
      <div class="em-error" role="alert">{errorMessage}</div>
    {/if}

    <div class="em-actions">
      {#if isEditMode}
        <button
          type="button"
          class="em-btn em-delete"
          onclick={handleDelete}
          disabled={isSubmitting}
        >삭제</button>
      {/if}
      <button type="button" class="em-btn em-cancel" onclick={handleClose} disabled={isSubmitting}>취소</button>
      <button type="submit" class="em-btn em-submit" disabled={isSubmitting}>
        {isSubmitting ? "저장 중…" : "저장"}
      </button>
    </div>
  </form>
</Modal>

<style>
  .em-body {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .em-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .em-field label {
    font-size: 0.82rem;
    color: var(--color-muted, #8a807a);
    font-weight: 600;
  }
  .em-lunar-hint {
    margin-left: 0.4rem;
    font-weight: 500;
    color: var(--color-secondary, #1e6e6e);
    font-size: 0.78rem;
  }
  .em-lunar-note {
    margin: 0 0 0.2rem;
    font-size: 0.78rem;
    color: var(--color-muted, #8a807a);
    background: color-mix(in srgb, var(--color-primary, #a8352a) 4%, transparent);
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    border-left: 2px solid color-mix(in srgb, var(--color-primary, #a8352a) 30%, transparent);
  }
  .em-field input[type="text"],
  .em-field input[type="date"],
  .em-field select,
  .em-field textarea {
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--color-rule, #e8dfd9);
    border-radius: 8px;
    font: inherit;
    background: var(--color-surface, #fff);
    color: var(--color-fg, #1f1c1a);
    outline: none;
    box-sizing: border-box;
    width: 100%;
  }
  .em-field input:focus,
  .em-field select:focus,
  .em-field textarea:focus {
    border-color: var(--color-primary, #a8352a);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #a8352a) 18%, transparent);
  }
  .em-field textarea {
    resize: vertical;
    min-height: 70px;
  }
  .em-checkbox label,
  .em-checkgroup label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.92rem;
    color: var(--color-fg, #1f1c1a);
  }
  .em-checkgroup {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.1rem;
    padding: 0.3rem 0.1rem;
  }
  .em-checkgroup small {
    color: var(--color-muted, #8a807a);
    font-weight: 400;
    margin-left: 0.15rem;
  }
  .em-checkbox input[type="checkbox"],
  .em-checkgroup input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--color-primary, #a8352a);
  }
  .em-error {
    padding: 0.45rem 0.65rem;
    background: color-mix(in srgb, #d92d20 14%, transparent);
    color: #962014;
    border-radius: 6px;
    font-size: 0.86rem;
  }
  .em-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--color-rule, #e8dfd9);
    margin-top: 0.35rem;
  }
  .em-btn {
    padding: 0.5rem 1.05rem;
    border-radius: 8px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .em-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .em-cancel {
    background: var(--color-surface, #fff);
    color: var(--color-fg, #1f1c1a);
    border: 1px solid var(--color-rule, #e8dfd9);
  }
  .em-cancel:hover:not(:disabled) {
    background: var(--color-bg, #fbf8f4);
  }
  .em-submit {
    background: var(--color-primary, #a8352a);
    color: #fff;
    border: 1px solid var(--color-primary, #a8352a);
  }
  .em-submit:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary, #a8352a) 88%, #000);
  }
  .em-delete {
    background: var(--color-surface, #fff);
    color: #962014;
    border: 1px solid color-mix(in srgb, #962014 40%, var(--color-rule, #e8dfd9));
    margin-right: auto;
  }
  .em-delete:hover:not(:disabled) {
    background: color-mix(in srgb, #962014 8%, var(--color-surface, #fff));
  }

  @media (max-width: 480px) {
    .em-actions {
      flex-wrap: wrap;
    }
    .em-actions .em-delete {
      order: 3;
      margin-right: 0;
      margin-top: 0.4rem;
      width: 100%;
    }
  }
</style>
