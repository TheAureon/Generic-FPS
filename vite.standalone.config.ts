import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds the whole game into ONE html file (Play.html) that works when
 * double-clicked, without running a server. Run: npm run build:play
 */
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-play',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
