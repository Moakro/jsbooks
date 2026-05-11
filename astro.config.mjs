// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import canonicalMappingDev from './scripts/vite-canonical-mapping.mjs';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],

  vite: {
    plugins: [canonicalMappingDev()],
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

  adapter: cloudflare(),
});