/**
 * Drive the viewmodel bench. Seconds instead of minutes, because it loads the
 * weapon and nothing else.
 *
 *   node tools/verify/bench.mjs [--out DIR]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(arg('out', join(ROOT, 'artifacts/bench')));

const SHOTS = [
  { q: 'weapon=HANDGUN',                 name: 'handgun_ready' },
  { q: 'weapon=HANDGUN&fire',            name: 'handgun_firing' },
  { q: 'weapon=MACHINE_GUN',             name: 'machinegun_ready' },
  { q: 'weapon=SHOTGUN&fire',            name: 'shotgun_firing' },
  { q: 'weapon=GRENADE',                 name: 'grenade_ready' },
  { q: 'weapon=HANDGUN&gunup',           name: 'handgun_gunup' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/bench.html';
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'],
});

for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/bench.html?${shot.q}`, { waitUntil: 'load', timeout: 60000 });
  try {
    await page.waitForFunction(() => window.__benchReady === true, { timeout: 60000 });
  } catch {
    console.log(`[bench] ${shot.name} NEVER READY`, errs.slice(0, 2));
    await page.close();
    continue;
  }
  const pos = await page.evaluate(() => window.__pos);
  await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
  console.log(`[bench] ${shot.name.padEnd(20)} centre ${String(pos.xPct).padStart(5)}% , ${String(pos.yPct).padStart(5)}%   ` +
              `size ${pos.widthPct}% x ${pos.heightPct}%` + (errs.length ? `  ERRORS: ${errs[0]}` : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(`[bench] wrote ${SHOTS.length} shots to ${OUT}`);
