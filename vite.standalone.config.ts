import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds the whole game into ONE html file. `npm run build` copies it to
 * index.html (what websites open) and Play.html (same game). It works on any
 * web host and when double-clicked, with no server needed.
 */
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-play',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: 'dev.html' },
  },
});
