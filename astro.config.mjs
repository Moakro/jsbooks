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
    },
  },

  adapter: cloudflare(),
});