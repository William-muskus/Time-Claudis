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
 * Substring filter over shot names. A full tour is eighteen software-rendered
 * frames and several minutes; when only the weapon changed, re-shooting the
 * whole of Montmartre to look at it is waste.
 */
const ONLY = arg('only', null);

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
  // Backed off and raised: parked ON the bust's own waypoint we were four
  // metres from it and it filled the frame as an unreadable dark block.
  { name: '05_dalida_bust',      at: 'place_dalida', back: 13, lateral: -2.5,
    look: 'place_dalida', lookHeight: 2.4,
    why: 'THE landmark. Polished chest, swept hair, facing east.' },
  { name: '06_abreuvoir_view',   at: 'place_dalida',    look: 'maison_rose',
    why: 'The sightline down rue de l Abreuvoir. Most photographed view here.' },
  { name: '07_moulin',           at: 'moulin_galette', back: 26, yaw: 214, pitch: 6,
    why: 'The Blute-fin on its mound. Crest of the level.' },
  { name: '07b_moulin_close',    at: 'moulin_galette', back: 12, yaw: 250, pitch: 10,
    why: 'The mill itself: tower, cap, and the four sails on their hub.' },
  // Backed off down the lane: parked on the waypoint in a six-metre street we
  // were within touching distance of a wall and it filled the whole frame.
  { name: '08_orchampt_gate',    at: 'maison_dalida', back: 16, look: 'maison_dalida', lookHeight: 2.0,
    why: '11 bis. The gate is shut and only the roofline shows. That is correct.' },
  { name: '09_goudeau',          at: 'emile_goudeau',   yaw: 170,
    why: 'Place Emile-Goudeau. Wallace fountain, plane trees, Bateau-Lavoir.' },
  { name: '10_ravignan_drop',    at: 'ravignan_stairs', yaw: 165,
    why: 'The descent. Sightline opens over the rooftops of the 9th.' },
  // Backed off and turned around: yaw 180 at the final waypoint pointed
  // straight off the end of the level, at bare terrain.
  { name: '11_abbesses',         at: 'place_abbesses', back: 18, yaw: 172,
    why: 'The finish. Guimard edicule in green iron and amber glass.' },
  { name: '12_sacre_coeur',      at: 'moulin_galette',  look: 'sacre_coeur', lookHeight: 30,
    why: 'The basilica on the skyline. A silhouette, nothing more.' },

  // --- the first-person weapon, in each of its states --------------------
  { name: '13_weapon_ready',     at: 'place_dalida', back: 6, yaw: 195, weapon: 'HANDGUN',
    why: 'Handgun at rest. Lower right, angled in, not covering the middle third.' },
  { name: '14_weapon_firing',    at: 'place_dalida', back: 6, yaw: 195, weapon: 'HANDGUN', fire: true,
    why: 'Muzzle flash and recoil kick. The flash must bloom.' },
  { name: '15_weapon_shotgun',   at: 'place_dalida', back: 6, yaw: 195, weapon: 'SHOTGUN', fire: true,
    why: 'Different silhouette, bigger kick, fatter flash.' },
  { name: '16_weapon_mg',        at: 'emile_goudeau', back: 5, yaw: 175, weapon: 'MACHINE_GUN',
    why: 'Long magazine below the receiver is the recognition cue.' },
  { name: '17_weapon_grenade',   at: 'emile_goudeau', back: 5, yaw: 175, weapon: 'GRENADE', fire: true,
    why: 'The drum. Rare, and the answer to the boss.' },
  { name: '18_gun_up_reload',    at: 'place_dalida', back: 6, yaw: 195, weapon: 'HANDGUN', gunUp: true,
    why: 'Hand raised to reload. The on-screen gun must mirror the gesture: barrel vertical.' },
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

// Settle the scene, then dismiss the HUD directly rather than waiting out the
// banner's own timeout — on a software rasteriser that wait was minutes.
await page.evaluate(async () => {
  for (let i = 0; i < 24; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  window.__tour.clearHud();
});

const manifest = [];
for (const shot of SHOTS) {
  if (ONLY && !shot.name.includes(ONLY)) continue;
  const ok = await page.evaluate((s) => {
    try {
      window.__tour.freeze(true);
      window.__tour.at(s.at, { lateral: s.lateral ?? 0, back: s.back ?? 0 });

      // Force a weapon and a pose so each state can be reviewed deliberately
      // rather than waiting for the attract pilot to happen into it.
      if (s.weapon) window.__tour.weapon(s.weapon);
      if (s.gunUp) window.__tour.gunUp();
      if (s.fire) window.__tour.fire();

      if (s.look) window.__tour.look(s.look, s.lookHeight);
      else window.__tour.aim(s.yaw ?? 180, s.pitch ?? 0);
      window.__tour.clearHud();
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

  // For weapon shots, report where the gun actually landed on screen. A
  // viewmodel that is off-frame looks identical to one that failed to render,
  // and the difference matters.
  let where = '';
  if (shot.weapon) {
    const pos = await page.evaluate(() => window.__tour.weaponScreenPos());
    where = pos && pos.xPct !== undefined ? `  [gun at ${pos.xPct}%, ${pos.yPct}%]` : '';
  }
  manifest.push({ ...shot, file: `${shot.name}.png`, where });
  console.log(`[tour] ${shot.name}  ${shot.why}${where}`);
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ errors, shots: manifest }, null, 2));
console.log(`[tour] wrote ${manifest.length} shots to ${OUT}`);
if (errors.length) console.log('[tour] console errors:', errors.slice(0, 8));

await browser.close();
server.close();
