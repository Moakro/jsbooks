// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import canonicalMappingDev from './scripts/vite-canonical-mapping.mjs';
import notePromotionDev from './scripts/vite-note-promotion.mjs';
import wikilinkQueueDev from './scripts/vite-wikilink-queue.mjs';
import placesCoordinatesDev from './scripts/vite-places-coordinates.mjs';
import archiveCandidatesDev from './scripts/vite-archive-candidates.mjs';

import cloudflare from '@astrojs/cloudflare';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // 운영 도메인 — sitemap·RSS 절대 URL 생성에 사용. 도메인 변경 시 여기 한 곳만 수정.
  site: 'https://jsbooks.wiki',

  // /admin/ 경로(dev 전용 매핑 도구 등)와 admin 전용 경전(한글본 백업)은 sitemap에서 제외.
  integrations: [
    svelte(),
    sitemap({
      filter: (page) =>
        !page.includes('/admin/') &&
        !page.includes('/library/cheonjigaebyeokgyeong-hangeul/'),
    }),
  ],

  vite: {
    plugins: [canonicalMappingDev(), notePromotionDev(), wikilinkQueueDev(), placesCoordinatesDev(), archiveCandidatesDev()],
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
          '**/content/places/**',
          '**/content/people/**',
          '**/content/_data/archive-candidate-queue.md',
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