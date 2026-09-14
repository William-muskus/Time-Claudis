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
    /**
     * The default target is es2020, which predates top-level await.
     *
     * Raising it rather than restructuring the code is the honest choice here:
     * this game already requires WebGL2, getUserMedia and a MediaPipe WASM
     * runtime, so every browser that can run it at all has supported top-level
     * await for years. Contorting the boot sequence around a target we do not
     * actually ship to would be pure ceremony.
     */
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bench: resolve(__dirname, 'bench.html'),
      },
    },
  },
});
