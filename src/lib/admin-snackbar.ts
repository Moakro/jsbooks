/**
 * 어드민 도구 글로벌 스낵바 — 페이지 전체 상태 알림 (성공·에러·정보).
 *
 * 큐 기반 단순 구현: 한 번에 하나의 메시지 표시, 자동 dismiss 후 다음 큐.
 * 컴포넌트는 `import { snackbarState, showSnackbar } from "$lib/admin-snackbar"` 식으로 사용.
 */

export type SnackbarType = "success" | "error" | "info";
export type SnackbarMessage = {
  id: number;
  text: string;
  type: SnackbarType;
};

let nextId = 1;

// Svelte 5 runes를 사용하는 store 패턴: $state는 컴포넌트 안에서만. 모듈 레벨에서는
// 단순 listener 리스트 + getter 함수로 노출.
type Listener = (msgs: SnackbarMessage[]) => void;

let messages: SnackbarMessage[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...messages];
  for (const l of listeners) l(snapshot);
}

export function subscribeSnackbar(fn: Listener): () => void {
  listeners.add(fn);
  fn([...messages]);
  return () => {
    listeners.delete(fn);
  };
}

export function showSnackbar(text: string, type: SnackbarType = "info", durationMs = 3000): number {
  const id = nextId++;
  const msg: SnackbarMessage = { id, text, type };
  messages = [...messages, msg];
  emit();
  if (durationMs > 0) {
    setTimeout(() => dismissSnackbar(id), durationMs);
  }
  return id;
}

export function dismissSnackbar(id: number): void {
  messages = messages.filter((m) => m.id !== id);
  emit();
}
