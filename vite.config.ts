import { defineConfig } from 'vite';

/**
 * Development server (npm run dev). The source page is dev.html; the
 * playable index.html is a build output (see vite.standalone.config.ts).
 */
export default defineConfig({
  server: { port: 5173, open: '/dev.html' },
  optimizeDeps: { entries: ['dev.html'] },
  build: { chunkSizeWarningLimit: 1000, rollupOptions: { input: 'dev.html' } },
});
