/**
 * The game against the street.
 *
 * For every photograph in tools/geo/references.json, stands the game camera
 * where that photograph was taken — same position, same compass heading, same
 * horizontal field of view — and renders, then lays the photo and the render
 * one above the other.
 *
 * This exists because the first data-driven Montmartre passed every geometric
 * test (each footprint within a metre of IGN's, the walk on the real
 * centrelines) and someone who lives on the route did not recognise a single
 * street. Geometry was right; colour, ground, walls and greenery were all
 * wrong, and nothing in the harness looked at a real street to notice.
 *
 *   node tools/verify/compare.mjs [--out DIR] [--only NAME[,NAME...]]
 *
 * Photographs are downloaded on first use into DIR/ref (they are CC-BY-SA,
 * credited in references.json, and not committed). Requires `npm run build`.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(arg('out', join(ROOT, 'artifacts/compare')));
const ONLY = arg('only', null);
/** Rebuild the contact sheets from renders already on disk. */
const SHEETS_ONLY = argv.includes('--sheets-only');
// The survey rig's camera height. Immergis's backpack/vehicle frames sit a
// little above a pedestrian's eye; matching it matters more than matching the
// player, because the point is to line up with the photo.
const EYE = Number(arg('eye', '2.3'));

const { references } = JSON.parse(await readFile(join(ROOT, 'tools/geo/references.json'), 'utf8'));
const refs = references.filter((r) => !ONLY || ONLY.split(',').some((o) => r.name.includes(o)));
await mkdir(join(OUT, 'ref'), { recursive: true });
await mkdir(join(OUT, 'game'), { recursive: true });

// curl rather than fetch(): it honours the environment's proxy settings and
// node's fetch does not.
for (const r of refs) {
  const f = join(OUT, 'ref', `${r.name}.jpg`);
  if (existsSync(f)) continue;
  try {
    execFileSync('curl', ['-sSfL', '-m', '60', '-A', 'TimeClaudis/1.0', '-o', f, r.sd]);
  } catch (e) { console.log(`[compare] could not download ${r.name}: ${e.message.split('\n')[0]}`); }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = p.startsWith('/__out/') ? join(OUT, p.slice(7)) : join(DIST, p);
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  s.listen(0, () => ok(s));
});
const port = server.address().port;

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(PINNED) ? PINNED : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-gpu-sandbox', '--ignore-gpu-blocklist'],
});
// 1280x675 is the photos' own 2048x1080 aspect, so the fields of view match.
const page = await browser.newPage({ viewport: { width: 1280, height: 675 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
if (!SHEETS_ONLY) await page.goto(`http://localhost:${port}/?demo=1&fixed=${1 / 60}`, { waitUntil: 'load', timeout: 90000 });
if (!SHEETS_ONLY) await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });
if (!SHEETS_ONLY) await page.evaluate(async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  window.__tour.clearHud();
  window.__tour.freeze(true);
  window.__tour.clearEnemies();
});

const sheet = await browser.newPage({ viewport: { width: 1280, height: 1380 } });
let n = 0;
for (const r of SHEETS_ONLY ? [] : refs) {
  n++;
  await page.evaluate((p) => window.__tour.pose(p), {
    lat: r.lat, lon: r.lon, eye: EYE, heading: r.heading, hfov: r.hfov });
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise((res) => requestAnimationFrame(() => res()));
  });
  await page.screenshot({ path: join(OUT, 'game', `${r.name}.png`) });

  const label = `${String(n).padStart(2, '0')} ${r.name} — photo ${r.taken} by ${r.producer} (CC-BY-SA), heading ${r.heading}°`;
  await sheet.setContent(`<html><body style="margin:0;background:#111;color:#ddd;font:14px sans-serif">
    <div style="padding:6px 10px">${label}</div>
    <img src="http://localhost:${port}/__out/ref/${r.name}.jpg" style="display:block;width:1280px;height:675px;object-fit:fill">
    <img src="http://localhost:${port}/__out/game/${r.name}.png?${Date.now()}" style="display:block;width:1280px;height:675px">
  </body></html>`, { waitUntil: 'load' });
  const file = join(OUT, `${String(n).padStart(2, '0')}_${r.name}.png`);
  await sheet.screenshot({ path: file });
  console.log(`[compare] ${file}`);
}
// Contact sheets: six pairs to an image, photo over render, for scanning the
// whole route at once. The full-size pairs above are for looking closely.
const PER = 6;
for (let k = 0; k < refs.length; k += PER) {
  const cells = refs.slice(k, k + PER).map((r, j) => `
    <div style="width:426px;display:inline-block;vertical-align:top;margin:0 1px 4px 0">
      <div style="font:11px sans-serif;color:#ddd;padding:2px 4px">${k + j + 1} ${r.name}</div>
      <img src="http://localhost:${port}/__out/ref/${r.name}.jpg" style="display:block;width:426px;height:225px;object-fit:fill">
      <img src="http://localhost:${port}/__out/game/${r.name}.png?${Date.now()}" style="display:block;width:426px;height:225px">
    </div>`).join('');
  await sheet.setViewportSize({ width: 1282, height: 980 });
  // font-size 0 on the body: the whitespace between inline blocks is a
  // character wide, and three 426 px cells plus two spaces overflow 1282 px.
  await sheet.setContent(`<html><body style="margin:0;background:#111;font-size:0">${cells}</body></html>`, { waitUntil: 'load' });
  await sheet.screenshot({ path: join(OUT, `sheet_${String(k / PER + 1).padStart(2, '0')}.png`) });
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ errors, references: refs }, null, 2));
if (errors.length) console.log('[compare] page errors:', errors.slice(0, 5));
await browser.close();
server.close();
