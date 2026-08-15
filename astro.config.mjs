import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://adarshambati.com',
  output: 'server',
  adapter: vercel(),
  server: { port: 4321 },
  security: {
    // Astro's built-in check rejects any non-GET without a matching Origin,
    // which non-browser clients (iOS Shortcuts, curl) never send. We do the
    // equivalent check in middleware, but only for cookie-authenticated
    // requests, where it's actually load-bearing. See src/middleware.ts.
    checkOrigin: false,
  },
});
