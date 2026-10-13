// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // NOTE: no adapter on purpose — the site is fully static (SSG), no client JS is required.
  vite: {
    server: {
      // Dev-server only. Keeps Vite's host check while allowing the sandbox /
      // hosting preview to proxy the app through *.e2b.app (localhost works too).
      allowedHosts: ['.e2b.app'],
    },
  },
});
