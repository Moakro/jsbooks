<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { CalendarEvent } from "../../lib/calendar-events";

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

  const CATEGORIES: { id: string; label: string }[] = [
    { id: "업무", label: "업무" },
    { id: "개인", label: "개인" },
    { id: "교단", label: "교단" },
    { id: "기타", label: "기타" },
  ];

  let title = $state("");
  let startDate = $state("");
  let hasEndDate = $state(false);
  let endDate = $state("");
  let allDay = $state(true);
  let category = $state("개인");
  let memo = $state("");
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let titleInputEl = $state<HTMLInputElement | undefined>();

  const isEditMode = $derived(!!event);

  $effect(() => {
    if (!open) return;
    if (event) {
      title = event.title;
      startDate = event.start_date;
      hasEndDate = !!event.end_date && event.end_date !== event.start_date;
      endDate = event.end_date ?? "";
      allDay = event.all_day === 1;
      category = event.category ?? "개인";
      memo = event.memo ?? "";
    } else {
      title = "";
      startDate = defaultDate || todayIso();
      hasEndDate = false;
      endDate = "";
      allDay = true;
      category = "개인";
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
      errorMessage = "시작일을 선택해주세요.";
      return;
    }
    if (hasEndDate && endDate && endDate < startDate) {
      errorMessage = "종료일은 시작일 이후여야 합니다.";
      return;
    }
    isSubmitting = true;
    errorMessage = null;
    try {
      const body = {
        title: t,
        start_date: startDate,
        end_date: hasEndDate && endDate ? endDate : null,
        all_day: allDay ? 1 : 0,
        category: category || null,
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

  function onBackdropKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  }

  onMount(() => {
    function onDocKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    }
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  });
</script>

{#if open}
  <div
    class="em-backdrop"
    role="presentation"
    onclick={handleClose}
    onkeydown={onBackdropKey}
  >
    <div
      class="em-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="em-title"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="em-header">
        <h2 id="em-title">{isEditMode ? "일정 수정" : "일정 추가"}</h2>
        <button type="button" class="em-close" onclick={handleClose} aria-label="닫기">✕</button>
      </div>

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
          <label for="em-start">시작일</label>
          <input id="em-start" type="date" bind:value={startDate} required />
        </div>

        <div class="em-checkbox">
          <label>
            <input type="checkbox" bind:checked={hasEndDate} />
            <span>종료일 있음</span>
          </label>
        </div>

        {#if hasEndDate}
          <div class="em-field">
            <label for="em-end">종료일</label>
            <input id="em-end" type="date" bind:value={endDate} min={startDate} />
          </div>
        {/if}

        <div class="em-checkbox">
          <label>
            <input type="checkbox" bind:checked={allDay} />
            <span>종일</span>
          </label>
        </div>

        <div class="em-field">
          <label for="em-cat">카테고리</label>
          <select id="em-cat" bind:value={category}>
            {#each CATEGORIES as c}
              <option value={c.id}>{c.label}</option>
            {/each}
          </select>
        </div>

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
    </div>
  </div>
{/if}

<style>
  .em-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }
  .em-modal {
    background: var(--color-surface, #fff);
    border-radius: 14px;
    width: 100%;
    max-width: 460px;
    max-height: 92vh;
    overflow-y: auto;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  }
  .em-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.95rem 1.1rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
  }
  .em-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-fg, #1f1c1a);
  }
  .em-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-muted, #8a807a);
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
  }
  .em-close:hover {
    background: var(--color-primary-bg, color-mix(in srgb, var(--color-primary, #a8352a) 10%, transparent));
    color: var(--color-primary, #a8352a);
  }
  .em-body {
    padding: 1rem 1.1rem 1.1rem;
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
  .em-checkbox label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.92rem;
    color: var(--color-fg, #1f1c1a);
  }
  .em-checkbox input[type="checkbox"] {
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
    .em-modal {
      max-width: 100%;
    }
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
