// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import canonicalMappingDev from './scripts/vite-canonical-mapping.mjs';

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],
  vite: {
    plugins: [canonicalMappingDev()],
  },
});
