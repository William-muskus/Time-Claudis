import { defineConfig } from 'vite';
import { resolve, join } from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';

/**
 * Serve MediaPipe's WASM runtime from this origin instead of a CDN.
 *
 * The hand tracker fetched its 11 MB WASM runtime from cdn.jsdelivr.net at
 * runtime. That is one more network that has to be reachable before the game
 * can start, and it is reachable from fewer places than you would think —
 * the container this project is developed in cannot reach it at all, which
 * meant the real tracker had never once been run end to end here.
 *
 * The package is already a declared dependency, so the files are on disk in
 * node_modules. Copying them into the build costs nothing at runtime, removes
 * a whole class of "it doesn't start on our office wifi", and lets the tracker
 * be verified rather than assumed. Nothing binary enters the repository: this
 * runs at build time against the installed package.
 *
 * The CDN stays as a fallback in handtracker.js for a deployment that serves
 * the bundle without these files alongside it.
 */
const WASM_SRC = resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_PUBLIC = '/mediapipe/wasm';

function mediapipeWasm() {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      // Dev server: stream straight out of node_modules, no copy.
      server.middlewares.use(WASM_PUBLIC, (req, res, next) => {
        const file = join(WASM_SRC, req.url.split('?')[0]);
        if (!file.startsWith(WASM_SRC) || !existsSync(file)) return next();
        res.setHeader('Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    async closeBundle() {
      if (!existsSync(WASM_SRC)) {
        this.warn('MediaPipe wasm not found in node_modules; the build will ' +
                  'fall back to the CDN at runtime');
        return;
      }
      const dest = resolve(__dirname, 'dist', WASM_PUBLIC.slice(1));
      await mkdir(dest, { recursive: true });
      await cp(WASM_SRC, dest, { recursive: true });
    },
  };
}

/**
 * Two entry points: the game, and a bench page that loads only the
 * first-person weapon.
 *
 * The bench exists because a full page load takes minutes under the software
 * rasteriser the verification harness uses, and iterating on where a gun sits
 * in the frame does not need Montmartre to be built first.
 */
export default defineConfig({
  plugins: [mediapipeWasm()],
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
