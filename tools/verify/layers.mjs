/**
 * Which layer drew each patch of ground?
 *
 *   node tools/verify/layers.mjs <reference name> [...] [--out DIR]
 *
 * Renders the reference view with every mesh in a flat colour by name
 * (__tour.layerView) next to the normal render and the photo, and prints the
 * legend. For hunting gaps and double-drawn ground. Requires `npm run build`.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const OUT = resolve(oi >= 0 ? argv[oi + 1] : join(ROOT, 'artifacts/layers'));
const names = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
await mkdir(OUT, { recursive: true });
const { references } = JSON.parse(await readFile(join(ROOT, 'tools/geo/references.json'), 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const body = await readFile(join(ROOT, 'dist', p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  s.listen(0, () => ok(s));
});
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: existsSync(PINNED) ? PINNED : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
for (const name of names) {
  const r = references.find((x) => x.name === name);
  const page = await browser.newPage({ viewport: { width: 1280, height: 675 } });
  await page.goto(`http://localhost:${server.address().port}/?demo=1&fixed=${1 / 60}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
  const pose = async () => page.evaluate(async (p) => {
    window.__tour.freeze(true); window.__tour.clearEnemies(); window.__tour.clearHud(); window.__tour.pose(p);
    for (let i = 0; i < 2; i++) await new Promise((ok) => requestAnimationFrame(() => ok()));
  }, { lat: r.lat, lon: r.lon, eye: 2.3, heading: r.heading, hfov: r.hfov });
  await pose();
  await page.screenshot({ path: join(OUT, `${name}_game.png`) });
  const legend = await page.evaluate(() => window.__tour.layerView());
  await pose();
  await page.screenshot({ path: join(OUT, `${name}_layers.png`) });
  console.log(name, JSON.stringify(legend));
  await page.close();
}
await browser.close(); server.close();
