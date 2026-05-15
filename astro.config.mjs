// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import canonicalMappingDev from './scripts/vite-canonical-mapping.mjs';
import notePromotionDev from './scripts/vite-note-promotion.mjs';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],

  vite: {
    plugins: [canonicalMappingDev(), notePromotionDev()],
    server: {
      // Allow Tailscale magic-DNS names + localhost in dev so we can preview
      // builds running on the home server (azgianlab) from any device on the
      // Tailnet. Has no effect on production (Cloudflare Pages builds only).
      allowedHosts: ['azgianlab', 'localhost', '127.0.0.1', '.ts.net'],
      watch: {
        // 어드민 도구가 vault 매핑 JSON과 markdown을 수정할 때마다 Astro dev server가
        // content collection 변경을 감지해 페이지 전체를 reload하던 문제 해결.
        // 어드민 작업 중 스크롤·textarea 상태 보존을 위해 watcher 무시.
        ignored: [
          '**/content/scripture/_mappings/**',
          '**/content/scripture/cheonjigaebyeokgyeong/**',
          '**/content/scripture/cheonjigaebyeokgyeong-hangeul/**',
          '**/content/.bak/**',
        ],
      },
    },
  },

  // dev 모드에서 workerd 런타임 emulation 비활성 — node SSR로 단순화.
  // workerd@1.20260504.1에서 일부 페이지(`/`, `/archive/*/`) SSR 도중 stream을
  // close 안 하고 `Cannot read properties of null (reading 'function')` throw하던
  // 이슈 회피. production 빌드(Pages)는 영향 없음.
  adapter: cloudflare({
    platformProxy: { enabled: false },
  }),
});