/**
 * Landmark tour.
 *
 * The attract pilot aims wherever the fight is, which is right for reviewing
 * gameplay and useless for reviewing a specific object. You cannot ask "does
 * the Dalida bust read correctly" if the only frames you have are ones where an
 * enemy happened to stand near it.
 *
 * So this parks the camera at chosen points on the rail, aims it at chosen
 * landmarks, freezes the simulation, and screenshots. These are the frames the
 * visual critic reviews for WORLD quality, as opposed to shoot.mjs's frames
 * which are for FEEL.
 *
 *   node tools/verify/tour.mjs [--out DIR]
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
const OUT = resolve(arg('out', join(ROOT, 'artifacts/tour')));

/**
 * The shot list.
 *
 * Each entry parks at a waypoint and either aims at a landmark or takes a free
 * bearing. These are chosen to be the views a resident would judge the level
 * on — see docs/ROUTE.md, "The things that must be right".
 */
const SHOTS = [
  { name: '01_station_arrival',  at: 'lamarck_station', lateral: -2, yaw: 250,
    why: 'The opening frame. Twin staircases flanking the metro mouth.' },
  { name: '02_stairs_climb',     at: 'escalier_foot',   yaw: 235,
    why: 'Looking up the Lamarck flight. Tread rhythm must read.' },
  { name: '03_girardon_climb',   at: 'lamarck_girardon', yaw: 200,
    why: 'The turn south into rue Girardon. Gradient must be visible.' },
  { name: '04_brouillards',      at: 'brouillards',     yaw: 195,
    why: 'Allee des Brouillards. Green shade on one side, sun on the other.' },
  { name: '05_dalida_bust',      at: 'place_dalida', lateral: -4, look: 'place_dalida',
    why: 'THE landmark. Polished chest, swept hair, facing east.' },
  { name: '06_abreuvoir_view',   at: 'place_dalida',    look: 'maison_rose',
    why: 'The sightline down rue de l Abreuvoir. Most photographed view here.' },
  { name: '07_moulin',           at: 'moulin_galette',  yaw: 210,
    why: 'The Blute-fin on its mound. Crest of the level.' },
  { name: '08_orchampt_gate',    at: 'maison_dalida',   yaw: 230,
    why: '11 bis. The gate is shut and only the roofline shows. That is correct.' },
  { name: '09_goudeau',          at: 'emile_goudeau',   yaw: 170,
    why: 'Place Emile-Goudeau. Wallace fountain, plane trees, Bateau-Lavoir.' },
  { name: '10_ravignan_drop',    at: 'ravignan_stairs', yaw: 165,
    why: 'The descent. Sightline opens over the rooftops of the 9th.' },
  { name: '11_abbesses',         at: 'place_abbesses',  yaw: 180,
    why: 'The finish. Guimard edicule in green iron and amber glass.' },
  { name: '12_sacre_coeur',      at: 'moulin_galette',  look: 'sacre_coeur',
    why: 'The basilica on the skyline. A silhouette, nothing more.' },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const body = await readFile(join(DIST, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${port}/?demo=1&fixed=${1 / 60}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });

// Let the scene settle and the HUD banner clear so the world is unobstructed.
await page.evaluate(async () => {
  for (let i = 0; i < 200; i++) await new Promise((r) => requestAnimationFrame(() => r()));
});

const manifest = [];
for (const shot of SHOTS) {
  const ok = await page.evaluate((s) => {
    try {
      window.__tour.freeze(true);
      window.__tour.at(s.at, { lateral: s.lateral ?? 0 });
      if (s.look) window.__tour.look(s.look);
      else window.__tour.aim(s.yaw ?? 180, s.pitch ?? 0);
      return true;
    } catch (e) { return String(e.message); }
  }, shot);

  if (ok !== true) { console.log(`[tour] ${shot.name} FAILED: ${ok}`); continue; }

  // One frame to draw the parked camera.
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  });
  const file = join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  manifest.push({ ...shot, file: `${shot.name}.png` });
  console.log(`[tour] ${shot.name}  ${shot.why}`);
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ errors, shots: manifest }, null, 2));
console.log(`[tour] wrote ${manifest.length} shots to ${OUT}`);
if (errors.length) console.log('[tour] console errors:', errors.slice(0, 8));

await browser.close();
server.close();
