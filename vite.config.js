import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Two entry points: the game, and a bench page that loads only the
 * first-person weapon.
 *
 * The bench exists because a full page load takes minutes under the software
 * rasteriser the verification harness uses, and iterating on where a gun sits
 * in the frame does not need Montmartre to be built first.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bench: resolve(__dirname, 'bench.html'),
      },
    },
  },
});
