/**
 * Capture the game mid-fight.
 *
 * shoot.mjs screenshots at fixed simulated times, which is reproducible and
 * almost useless for reviewing combat: an arcade fight's readable moments are
 * events, not timestamps, and a fixed clock lands between them. Eighteen
 * frames were captured that way and not one contained an enemy.
 *
 * This instead steps the simulation until a CONDITION holds, then shoots. The
 * conditions are the moments a Time Crisis screenshot is supposed to show:
 * an enemy telegraphing, two enemies committed at once, a tracer in flight,
 * the frame of a confirmed hit, the player behind cover.
 *
 *   node tools/verify/action.mjs [--out DIR] [--seed N]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(arg('out', join(ROOT, 'artifacts/action')));
const SEED = arg('seed', '41234');

/**
 * Each shot names a predicate evaluated inside the page against the live game.
 * `maxFrames` bounds the search so a condition that never occurs fails loudly
 * instead of hanging.
 */
const SHOTS = [
  {
    name: '01_enemy_emerging',
    why: 'An enemy rising out of a real doorway.',
    when: () => window.__game.director.enemies.some((e) => e.state === 'SPAWNING'),
  },
  {
    name: '02_telegraph_flash',
    why: 'The flash stage. Two hard beats, unmissable in peripheral vision.',
    when: () => window.__game.director.enemies.some((e) => e.telegraphStage === 'flash'),
  },
  {
    name: '03_committed_shot',
    why: 'An enemy committed. The shot WILL fire; the player must duck or kill.',
    when: () => window.__game.director.enemies.some((e) => e.telegraphStage === 'commit'),
  },
  {
    name: '04_two_committed',
    why: 'The fire-discipline cap: never more than two at once.',
    when: () => window.__game.director.enemies.filter((e) => e.telegraphStage === 'commit').length >= 2,
  },
  {
    name: '05_bullet_in_flight',
    why: 'An enemy round travelling. Ducking now still saves you.',
    when: () => window.__game.bullets.bullets.some((b) => b.active),
  },
  {
    name: '06_player_covered',
    why: 'Behind cover. The camera drops and the foreground occluder rises.',
    when: () => window.__game.snapshot().coverState === 'COVERED'
             && window.__game.director.enemies.length > 0,
  },
  {
    name: '07_crowded_area',
    why: 'Three or more live enemies at readable mid-distance.',
    when: () => window.__game.director.targets().length >= 3,
  },
  {
    name: '08_dying_enemy',
    why: 'Stagger and fall. An enemy that vanishes on hit reads as a target, not a person.',
    when: () => window.__game.director.enemies.some((e) => e.state === 'DYING'),
  },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const b = await readFile(join(DIST, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  s.listen(0, () => ok(s));
});
const port = server.address().port;
await mkdir(OUT, { recursive: true });

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(PINNED) ? PINNED : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-gpu-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`http://localhost:${port}/?demo=1&seed=${SEED}&fixed=${1 / 60}`,
  { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
console.log('[action] game ready');

const manifest = [];

/**
 * Watch for every condition on ONE pass through the game.
 *
 * Searching for each condition in turn means replaying the level once per
 * shot, and under a software rasteriser that is tens of minutes. Every
 * condition is instead evaluated on each step, and whichever fire get
 * captured. The whole set is usually satisfied inside a single area.
 */
const pending = new Map(SHOTS.map((s) => [s.name, s]));
const MAX_STEPS = 400;           // 400 x 20 frames = ~133 simulated seconds
let steps = 0;

while (pending.size > 0 && steps < MAX_STEPS) {
  steps++;
  const fired = await page.evaluate(async (srcs) => {
    const preds = srcs.map(([name, src]) => {
      // eslint-disable-next-line no-new-func
      return [name, new Function(`return (${src})()`)];
    });
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => requestAnimationFrame(() => res()));
      for (const [name, p] of preds) {
        try { if (p()) return name; } catch { /* not yet live */ }
      }
    }
    return null;
  }, [...pending.entries()].map(([n, s]) => [n, s.when.toString()]));

  if (!fired) continue;
  const shot = pending.get(fired);
  pending.delete(fired);

  const snap = await page.evaluate(() => {
    const g = window.__game;
    const s = g.snapshot();
    return {
      area: s.area, score: s.score, lives: s.lives, cover: s.coverState,
      rounds: s.rounds, weapon: s.weapon,
      enemies: g.director.enemies.map((e) => ({ t: e.typeKey, st: e.state, tg: e.telegraphStage })),
      bullets: g.bullets.bullets.filter((b) => b.active).length,
    };
  });

  await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
  manifest.push({ name: shot.name, why: shot.why, file: `${shot.name}.png`, found: true, snap });
  console.log(`[action] ${shot.name.padEnd(22)} ${shot.why}`);
  console.log(`          area=${snap.area} enemies=${snap.enemies.length} ` +
              `[${snap.enemies.map((e) => `${e.t}:${e.tg ?? e.st}`).join(' ')}] ` +
              `bullets=${snap.bullets} cover=${snap.cover}`);
}

for (const [name, shot] of pending) {
  console.log(`[action] ${name.padEnd(22)} CONDITION NEVER HELD`);
  manifest.push({ name, why: shot.why, file: null, found: false });
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ seed: SEED, errors, shots: manifest }, null, 2));
console.log(`[action] wrote ${manifest.filter((m) => m.found).length}/${SHOTS.length} shots to ${OUT}`);
await browser.close();
server.close();
