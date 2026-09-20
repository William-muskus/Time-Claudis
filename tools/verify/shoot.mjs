/**
 * Visual verification harness.
 *
 * Serves the built game, drives it in headless Chromium with the attract-mode
 * pilot, and writes screenshots plus a gameplay trace to artifacts/.
 *
 * This exists because the only honest way to review a game's look and feel is
 * to look at it. A change that cannot be screenshotted cannot be reviewed, so
 * every visual claim in this repo is backed by a file in artifacts/shots/.
 *
 * Chromium here has no GPU, so WebGL runs on SwiftShader. That is slow but
 * pixel-correct, and the game is driven on a FIXED TIMESTEP rather than wall
 * clock so a 4 fps software render produces exactly the same frames a 60 fps
 * hardware one would. Without the fixed step the screenshots would be
 * unreproducible and the critic loop would be chasing noise.
 *
 *   node tools/verify/shoot.mjs [--out DIR] [--seed N] [--shots a,b,c]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { rmSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};

const OUT = resolve(arg('out', join(ROOT, 'artifacts/shots')));
const SEED = arg('seed', '41234');
/**
 * Port 0 lets the OS assign a free one. A fixed port strands the harness
 * whenever a previous run's server is still holding it, which happens often
 * because a SwiftShader render can outlive the shell that started it.
 */
const PORT = Number(arg('port', '0'));
/** Simulated seconds at which to capture. Chosen to land on real beats. */
const SHOT_TIMES = (arg('shots', '0.4,2.5,6,11,17,24,33,44,58,72,88,104'))
  .split(',').map(Number);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
};

function serve(dir, port) {
  return new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const file = join(dir, p);
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    srv.listen(port, () => ok(srv));
  });
}

/**
 * Single-instance lock.
 *
 * A SwiftShader render can take minutes and outlives the shell that started
 * it, so it is very easy to end up with several runs competing for four cores.
 * That does not just slow things down — it makes every run appear to hang, and
 * the obvious diagnosis (the game is broken) is wrong. One run at a time.
 */
const LOCK = join(ROOT, 'artifacts/.verify.lock');
await mkdir(join(ROOT, 'artifacts'), { recursive: true });
try {
  const prev = Number(await readFile(LOCK, 'utf8'));
  if (prev && prev !== process.pid) {
    try {
      process.kill(prev, 0);          // throws if it is gone
      console.error(`[verify] another run (pid ${prev}) is already going. ` +
        `Wait for it, or kill it and delete ${LOCK}.`);
      process.exit(2);
    } catch { /* stale lock, ours now */ }
  }
} catch { /* no lock */ }
await writeFile(LOCK, String(process.pid));
const releaseLock = async () => { try { await rm(LOCK, { force: true }); } catch { /* ignore */ } };
// `require` does not exist in an ES module, so the synchronous exit handler
// needs the real sync API imported up front.
process.on('exit', () => { try { rmSync(LOCK, { force: true }); } catch { /* ignore */ } });

const server = await serve(DIST, PORT);
const boundPort = server.address().port;
await mkdir(OUT, { recursive: true });

/**
 * The environment ships a Chromium that predates this Playwright build, and
 * the network policy blocks `playwright install`. Point at the preinstalled
 * binary rather than downloading one. Falls back to Playwright's own
 * resolution if the pinned path is ever absent.
 */
const { existsSync } = await import('node:fs');
const PINNED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = existsSync(PINNED_CHROME) ? PINNED_CHROME : undefined;

const browser = await chromium.launch({
  executablePath,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

// Fixed timestep: each rAF advances exactly 1/60 s of simulated time no matter
// how long the software renderer actually took.
const url = `http://localhost:${boundPort}/?demo=1&seed=${SEED}&fixed=${1 / 60}`;
console.log(`[verify] ${url}`);
await page.goto(url, { waitUntil: 'load', timeout: 60000 });

await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
console.log('[verify] game ready, driving attract mode');

const trace = [];
const FRAMES_PER_SEC = 60;
let simTime = 0;
let shotIndex = 0;

/** Let the page run n animation frames. */
async function step(frames) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  }, frames);
}

const t0 = Date.now();
while (shotIndex < SHOT_TIMES.length) {
  const target = SHOT_TIMES[shotIndex];
  const need = Math.max(1, Math.round((target - simTime) * FRAMES_PER_SEC));
  // Chunk so a long gap does not hit the evaluate timeout on SwiftShader.
  let done = 0;
  while (done < need) {
    const chunk = Math.min(30, need - done);
    await step(chunk);
    done += chunk;
  }
  simTime = target;

  const snap = await page.evaluate(() => {
    const g = window.__game;
    const s = g.snapshot();
    return {
      ...s,
      enemies: g.director.enemies.map((e) => ({
        id: e.id, type: e.typeKey, state: e.state, stage: e.telegraphStage,
        anchor: e.anchor?.type,
      })),
      frames: window.__frames,
      cameraDistance: window.__game.railCamera?.distance,
    };
  });

  const label = `t${String(target).padStart(5, '0')}`;
  const file = join(OUT, `${label}.png`);
  await page.screenshot({ path: file });
  trace.push({ t: target, file: `${label}.png`, ...snap });
  console.log(`[verify] ${label}  area=${snap.area || '-'}  state=${snap.directorState}  ` +
              `score=${snap.score} lives=${snap.lives} ammo=${snap.rounds}/${snap.magSize} ` +
              `cover=${snap.coverState} enemies=${snap.enemies.length}`);
  shotIndex++;
}

await writeFile(join(OUT, 'trace.json'), JSON.stringify({
  seed: SEED, simSeconds: simTime, wallSeconds: (Date.now() - t0) / 1000,
  errors, trace,
}, null, 2));

console.log(`[verify] wrote ${trace.length} shots to ${OUT}`);
if (errors.length) {
  console.log(`[verify] ${errors.length} console error(s):`);
  for (const e of errors.slice(0, 12)) console.log('   ', e);
}

await browser.close();
server.close();
await releaseLock();
process.exit(errors.length ? 1 : 0);
