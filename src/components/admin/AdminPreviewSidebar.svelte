<script lang="ts">
  /**
   * 어드민 미리보기 사이드바 — 우측에서 슬라이드 인. iframe 안에 외부 URL을 띄워
   * 어드민 작업과 동시에 공개 페이지·한글본 백업 등을 참고할 수 있다.
   *
   * SideCard.svelte의 톤·핸들·transition 패턴 차용.
   */
  import { onMount } from "svelte";

  let url = $state<string | null>(null);
  let title = $state<string>("");
  let sheetOpen = $state(true);
  let iframeKey = $state(0); // 새로고침용 (key 변경 → iframe 재마운트)

  let hasUrl = $derived(url !== null);
  let sheetVisible = $derived(sheetOpen && hasUrl);
  let handleVisible = $derived(!sheetOpen && hasUrl);

  $effect(() => {
    if (typeof document === "undefined") return;
    if (sheetVisible) document.body.setAttribute("data-admin-preview", "open");
    else if (handleVisible) document.body.setAttribute("data-admin-preview", "minimized");
    else document.body.removeAttribute("data-admin-preview");
  });

  export function openUrl(nextUrl: string, nextTitle: string) {
    url = nextUrl;
    title = nextTitle;
    sheetOpen = true;
    iframeKey++;
  }

  function close() {
    url = null;
    sheetOpen = false;
  }
  function minimize() {
    sheetOpen = false;
  }
  function reopen() {
    sheetOpen = true;
  }
  function refresh() {
    iframeKey++;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && sheetVisible) {
      e.preventDefault();
      minimize();
    }
  }

  onMount(() => {
    // window 레벨로 노출 — 어드민 페이지에서 직접 호출 가능
    (window as any).__adminPreview = {
      open: (u: string, t: string) => openUrl(u, t),
      close,
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
</script>

<aside class:open={sheetVisible} aria-hidden={!sheetVisible}>
  {#if hasUrl}
    <header class="sb-head">
      <span class="title" title={url ?? ""}>{title}</span>
      <button class="hbtn" onclick={refresh} title="새로고침" aria-label="새로고침">⟳</button>
      <a class="hbtn" href={url ?? "#"} target="_blank" rel="noopener" title="새 탭 열기" aria-label="새 탭 열기">↗</a>
      <button class="hbtn close" onclick={minimize} title="시트 닫기 (URL 유지)" aria-label="시트 닫기">›</button>
      <button class="hbtn" onclick={close} title="완전 닫기" aria-label="완전 닫기">✕</button>
    </header>
    {#key iframeKey}
      <iframe src={url ?? ""} title={title} loading="lazy"></iframe>
    {/key}
  {/if}
</aside>

{#if handleVisible}
  <button
    class="reopen-handle"
    type="button"
    onclick={reopen}
    aria-label="미리보기 다시 열기"
    title={title}
  >
    👁
  </button>
{/if}

<style>
  aside {
    position: fixed;
    background: var(--color-bg, #fbf8f4);
    border-left: 1px solid var(--color-rule, #e8dfd9);
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.18);
    transform: translateX(100%);
    transition: transform 0.22s ease;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 80;
  }
  aside.open {
    transform: translateX(0);
  }
  @media (min-width: 1024px) {
    aside {
      top: 0;
      right: 0;
      bottom: 0;
      width: 520px;
      max-width: 42vw;
    }
  }
  @media (max-width: 1023px) {
    aside {
      left: 0;
      right: 0;
      bottom: 0;
      height: 80vh;
      transform: translateY(100%);
      border-left: none;
      border-top: 1px solid var(--color-rule, #e8dfd9);
      border-radius: 12px 12px 0 0;
    }
    aside.open {
      transform: translateY(0);
    }
  }

  .sb-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--color-rule, #e8dfd9);
    background: var(--color-primary-bg, #fbf3f1);
    flex-shrink: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: 0.85rem;
    color: var(--color-primary, #a8352a);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.85rem;
    height: 1.85rem;
    border: 1px solid var(--color-primary, #a8352a);
    border-radius: 4px;
    background: transparent;
    color: var(--color-primary, #a8352a);
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1;
    text-decoration: none;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .hbtn:hover {
    background: var(--color-primary, #a8352a);
    color: var(--color-bg, #fbf8f4);
  }

  iframe {
    flex: 1;
    border: 0;
    width: 100%;
    background: var(--color-bg, #fbf8f4);
  }

  .reopen-handle {
    position: fixed;
    z-index: 70;
    background: var(--color-primary, #a8352a);
    color: #fff;
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    transition: transform 0.18s ease, opacity 0.2s ease;
  }
  @media (min-width: 1024px) {
    .reopen-handle {
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 38px;
      height: 76px;
      border-radius: 76px 0 0 76px;
      box-shadow: -4px 0 14px rgba(0, 0, 0, 0.22);
      padding-right: 6px;
    }
    .reopen-handle:hover {
      transform: translate(-4px, -50%);
    }
  }
  @media (max-width: 1023px) {
    .reopen-handle {
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 64px;
      height: 32px;
      border-radius: 64px 64px 0 0;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.18);
      padding-bottom: 4px;
    }
  }
</style>
