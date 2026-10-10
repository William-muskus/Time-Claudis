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
  // EVERY SHOT IS AIMED BY THE WORLD, NOT BY A COMPASS. The previous list used
  // hard yaws tuned to the old hand-placed survey; after the October 2026
  // re-derivation from IGN/OSM every one of them pointed at a wall. `look:`
  // aims at a named landmark and `ahead:` down the rail, and both survive the
  // next correction too.
  { name: '01_station_arrival',  at: 'lamarck_station', ahead: 16,
    why: 'The opening frame. Out of the métro onto the landing, the Pierre-Dac flight rising ahead.' },
  { name: '02_stairs_look_back', at: 'escalier_top', look: 'metro_lamarck', lookHeight: 0.5,
    why: 'From rue Caulaincourt back down the steps to the métro entrance in the wall.' },
  { name: '03_pecqueur',         at: 'constantin_pecqueur', ahead: 20,
    why: 'Place Constantin-Pecqueur: the planted square climbing to the Girardon steps.' },
  { name: '04_girardon_steps',   at: 'girardon_steps', ahead: 18,
    why: 'Up the rue Girardon steps toward Place Dalida.' },
  { name: '05_dalida_bust',      at: 'place_dalida', back: 9, look: 'dalida_bust', lookHeight: 2.4,
    why: 'THE landmark. Polished chest, swept hair, facing east under her three limes.' },
  { name: '05b_dalida_close',    at: 'place_dalida', back: 1, look: 'dalida_bust', lookHeight: 2.3,
    why: 'The bust itself: swept hair, the rubbed-gold chest, weathered bronze elsewhere.' },
  { name: '06_abreuvoir_view',   at: 'place_dalida', look: 'maison_rose', lookHeight: 4,
    why: 'Down rue de l Abreuvoir to La Maison Rose. The most photographed view here.' },
  { name: '06b_chateau',         at: 'place_dalida', look: 'chateau_brouillards', lookHeight: 5,
    why: 'The Château des Brouillards behind its garden, west of the square.' },
  { name: '07_girardon_climb',   at: 'girardon_climb', ahead: 22,
    why: 'Rue Girardon climbing south, square Suzanne-Buisson on the right.' },
  { name: '07b_passe_muraille',  at: 'marcel_ayme', look: 'marcel_ayme', lookHeight: 1.6,
    why: 'Up Place Marcel-Aymé to the Passe-Muraille in its wall.' },
  { name: '08_moulin_radet',     at: 'marcel_ayme', ahead: 30, lookHeight: 4,
    why: 'Toward the rue Lepic corner: the Radet over its restaurant.' },
  { name: '08b_blutefin',        at: 'moulin_galette', look: 'moulin_blutefin', lookHeight: 6,
    why: 'The Blute-fin on its mound above rue Lepic, seen over the garden wall.' },
  { name: '09_orchampt_lane',    at: 'lepic_orchampt', ahead: 14,
    why: 'Into rue d Orchampt: four metres wall to wall.' },
  { name: '10_orchampt_gate',    at: 'maison_dalida', back: 9, look: 'maison_dalida', lookHeight: 2.0,
    why: '11 bis. The garden wall and the shut green gate. You never see the house.' },
  { name: '11_orchampt_bend',    at: 'orchampt_bend', ahead: 18,
    why: 'Where the lane widens and turns: the A4 fight.' },
  { name: '12_goudeau',          at: 'emile_goudeau', look: 'bateau_lavoir', lookHeight: 4,
    why: 'Place Emile-Goudeau: chestnuts, the Wallace fountain, the Bateau-Lavoir across the terrace.' },
  { name: '13_ravignan_drop',    at: 'trois_freres', ahead: 28,
    why: 'The descent down rue Ravignan to rue des Abbesses.' },
  { name: '14_rue_abbesses',     at: 'abbesses_corner', ahead: 22,
    why: 'Rue des Abbesses: shops, awnings, toward the square.' },
  { name: '15_abbesses',         at: 'place_abbesses', back: 16, look: 'edicule_abbesses', lookHeight: 2.5,
    why: 'The finish. Guimard édicule in green iron and amber glass.' },
  { name: '15b_guimard_close',   at: 'place_abbesses', back: 3, look: 'edicule_abbesses', lookHeight: 2.2,
    why: 'The edicule itself: green cast iron, amber glass, the METROPOLITAIN panel.' },
  { name: '16_st_jean',          at: 'rue_abbesses', look: 'st_jean', lookHeight: 10,
    why: 'Saint-Jean-de-Montmartre in red brick on the square.' },
  { name: '17_sacre_coeur',      at: 'emile_goudeau', back: 14, look: 'sacre_coeur', lookHeight: 46,
    why: 'The dome over the rooftops. A glimpse, which is all the streets give you.' },
  { name: '18_weapon_ready',     at: 'place_dalida', back: 6, ahead: 18, weapon: 'HANDGUN',
    why: 'Handgun at rest. Lower right, angled in, not covering the middle third.' },
  { name: '19_weapon_firing',    at: 'place_dalida', back: 6, ahead: 18, weapon: 'HANDGUN', fire: true,
    why: 'Muzzle flash and recoil kick. The flash must bloom.' },
  { name: '20_weapon_shotgun',   at: 'place_dalida', back: 6, ahead: 18, weapon: 'SHOTGUN', fire: true,
    why: 'Different silhouette, bigger kick, fatter flash.' },
  { name: '21_weapon_mg',        at: 'emile_goudeau', ahead: 18, weapon: 'MACHINE_GUN',
    why: 'Long magazine below the receiver is the recognition cue.' },
  { name: '22_weapon_grenade',   at: 'emile_goudeau', ahead: 18, weapon: 'GRENADE', fire: true,
    why: 'The drum. Rare, and the answer to the boss.' },
  { name: '23_gun_up_reload',    at: 'place_dalida', back: 6, ahead: 18, weapon: 'HANDGUN', gunUp: true,
    why: 'Hand raised to reload. The on-screen gun must mirror the gesture: barrel vertical.' },
  { name: '30_wave_windup',      at: 'lamarck_station', ahead: 16, weapon: 'HANDGUN',
    spawn: ['GRUNT', 'GRUNT', 'SOLDIER'], stage: 'windup',
    why: 'A wave out of real doorways, winding up. Enemies must read against the facade.' },
  { name: '31_telegraph_commit', at: 'place_dalida', ahead: 18, weapon: 'HANDGUN',
    spawn: ['RED', 'GRUNT'], stage: 'commit',
    why: 'THE moment. Committed telegraph: white chest flash, unmissable in peripheral vision.' },
  { name: '32_behind_cover',     at: 'place_dalida', ahead: 18, weapon: 'HANDGUN',
    spawn: ['RED', 'GRUNT'], stage: 'flash', duck: true,
    why: 'Ducked. The camera drops and the foreground cover rises across the frame.' },
  { name: '33_crowded_lane',     at: 'orchampt_bend', ahead: 14, weapon: 'SHOTGUN',
    spawn: ['SOLDIER', 'GRUNT', 'BOMBER', 'RED'], stage: 'flash',
    why: 'The claustrophobic area, at the real bend of rue d Orchampt.' },
  { name: '34_heavy_and_sniper', at: 'emile_goudeau', ahead: 20, weapon: 'MACHINE_GUN',
    spawn: ['HEAVY', 'SNIPER', 'GRUNT'], stage: 'windup',
    why: 'Long sightlines. Colour must separate the classes at distance.' },
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
/**
 * 1200x675 rather than 1600x900.
 *
 * Measured on this container: the game renders at 0.8 frames per second under
 * SwiftShader at 1200x675, and SwiftShader is fill-rate bound so 1600x900 is
 * roughly half that. A full tour at the larger size takes long enough that the
 * container often restarts before it finishes. Same image, fewer pixels of it.
 */
const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${port}/?demo=1&fixed=${1 / 60}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });

// Settle the scene, then dismiss the HUD directly rather than waiting out the
// banner's own timeout — on a software rasteriser that wait was minutes.
await page.evaluate(async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(() => r()));
  window.__tour.clearHud();
});

const manifest = [];
for (const shot of SHOTS) {
  if (ONLY && !shot.name.includes(ONLY)) continue;
  const ok = await page.evaluate((s) => {
    try {
      window.__tour.freeze(true);
      // Every shot starts from an empty street. Without this each staged fight
      // inherited every earlier one — sixteen enemies alive by the last combat
      // frame, thirteen of them posed for a camera hundreds of metres back.
      window.__tour.clearEnemies();
      window.__tour.at(s.at, { lateral: s.lateral ?? 0, back: s.back ?? 0 });

      // Force a weapon and a pose so each state can be reviewed deliberately
      // rather than waiting for the attract pilot to happen into it.
      // AIM BEFORE SPAWNING. The spawner places enemies relative to the
      // camera's forward vector, so spawning first and then turning the camera
      // leaves them behind the player — the staged fight happened correctly
      // and none of it was in the frame.
      if (s.look) window.__tour.look(s.look, s.lookHeight);
      else if (s.ahead) window.__tour.lookAhead(s.ahead, s.pitch ?? 0);
      else window.__tour.aim(s.yaw ?? 180, s.pitch ?? 0);

      if (s.weapon) window.__tour.weapon(s.weapon);
      if (s.spawn) window.__tour.spawnWave(s.spawn, s.stage);
      if (s.incoming) window.__tour.incoming();
      if (s.duck) window.__tour.duck();
      if (s.gunUp) window.__tour.gunUp();
      if (s.fire) window.__tour.fire();

      // Re-apply the aim: ducking moves the camera rig.
      if (s.look) window.__tour.look(s.look, s.lookHeight);
      else if (s.ahead) window.__tour.lookAhead(s.ahead, s.pitch ?? 0);
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
  if (shot.spawn) {
    // Not just "are they alive" — where they landed and whether anything is in
    // front of them. The manifest used to report five enemies telegraphing on
    // a frame that contained none, because listing states proves the
    // simulation ran and says nothing about the picture.
    const live = await page.evaluate(() => window.__tour.enemyScreenPos());
    where = `  [${live.map((e) => {
      const mark = e.visible ? '' : e.onScreen ? ' BLOCKED' : ' OFFSCREEN';
      return `${e.type}:${e.stage}@${e.xPct},${e.yPct} ${e.dist}m${mark}`;
    }).join(' | ')}]`;
    const seen = live.filter((e) => e.visible).length;
    if (!seen) console.log(`[tour] ${shot.name} WARNING: staged a fight and not one enemy is visible`);
  } else if (shot.weapon) {
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
