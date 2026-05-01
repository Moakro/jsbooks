/**
 * Promise-based confirm dialog API.
 *
 * Usage:
 *   import { confirmDialog } from "$lib/confirmDialog";
 *   const ok = await confirmDialog({
 *     title: "검색 결과 초기화",
 *     message: "저장된 검색 결과를 모두 비웁니다. 계속할까요?",
 *     confirmLabel: "초기화",
 *     danger: true,
 *   });
 *   if (ok) reset();
 *
 * The dialog UI is rendered by the global <ConfirmDialog client:load /> island
 * mounted in Base.astro, which listens for the "jsbooks:confirm" CustomEvent.
 */

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the danger (primary/단심) accent. */
  danger?: boolean;
};

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(
      new CustomEvent("jsbooks:confirm", {
        detail: { ...opts, resolve },
      }),
    );
  });
}
