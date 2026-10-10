import * as THREE from 'three';
import { buildStreet } from './street.js';
import { buildLandmarks } from './landmarks.js';
import { buildProps } from './props.js';
import { buildCover } from './cover.js';
import { EMPTY_REGISTRY } from './assets.js';
import { LANDMARKS, geoToLocal } from '../data/route.js';
import { makeRng } from '../core/rng.js';
import { batchStatic } from './optimize.js';
import { buildSky } from '../render/sky.js';
import { railIndex, insideBuilding, pairs } from './geo.js';
import { buildRealCity, sideStreetAnchors } from './realbuildings.js';
import { buildTerrain } from './terrain.js';
import { buildRealTrees, buildRealFurniture } from './realtrees.js';

/**
 * Assembles Montmartre from the survey.
 *
 * Since October 2026 almost all of it is data: the 1,023 buildings of IGN's
 * BD TOPO at their measured heights, the RGE ALTI terrain, every street in the
 * corridor, the Ville de Paris tree inventory and OpenStreetMap's furniture —
 * converted into the game's frame by tools/geo and loaded from
 * src/data/geo/montmartre.json. What remains authored is what no dataset
 * describes: the landmarks' own models, the rail's street surface and stairs,
 * the player's cover, and the facade detail on the real walls.
 *
 * Returns the scene group plus the anchor list gameplay draws spawns from.
 */
export function buildWorld(rail, seed = 0x4D4F4E54 /* "MONT" */, assets = EMPTY_REGISTRY,
                           { batch = true } = {}) {
  const rng = makeRng(seed);
  const root = new THREE.Group();
  root.name = 'montmartre';
  const near = railIndex(rail);

  root.add(buildStreet(rail));

  const lm = buildLandmarks(rail, assets, rng);
  root.add(lm.group);
  const anchors = [...lm.anchors];

  // Where an authored model stands in for a real building, the cadastral
  // footprint underneath it is left out — otherwise the Maison Rose would be
  // built twice, once pink and once as a grey box through the middle of it.
  const replaced = replacedByLandmarks();
  const city = buildRealCity(rail, near, { skip: (b) => replaced(b) });
  root.add(city.group);
  anchors.push(...city.anchors);
  // Coarse footprints for the line-of-sight test the director runs before it
  // picks a spawn anchor. See src/world/occluders.js.
  const occluders = [...city.occluders];

  anchors.push(...sideStreetAnchors(rail, near, (x, z) => insideBuilding(x, z, 0.3)));

  root.add(buildTerrain(rail, near));
  root.add(buildRealTrees(rail, near, (x, z) => insideBuilding(x, z)));
  root.add(buildRealFurniture(rail, near, assets));
  root.add(buildProps(rail, rng, assets));
  root.add(buildCover(rail, rng));

  const sky = buildSky();
  sky.userData.dynamic = true;   // never batched; it tracks the camera
  root.add(sky);

  // Anchors were captured in world space above, BEFORE batching flattens the
  // hierarchy and disposes the source meshes.
  //
  // `batch: false` is for diagnosis only: afterwards every hit reports as an
  // anonymous merged blob and you cannot ask the scene WHICH builder put a
  // wall a metre in front of the player. Matrices are brought up to date
  // either way, or an unbatched world hands back stale identity matrices and
  // every raycast misses.
  const stats = batch ? batchStatic(root) : (root.updateMatrixWorld(true), { before: 0, after: 0 });
  stats.city = city.stats;
  if (batch && typeof console !== 'undefined') {
    console.info(`[world] ${city.stats.buildings} real buildings, batched ${stats.before} meshes into ${stats.after} draw calls`);
  }

  return { root, anchors, occluders, stats, sky };
}

/**
 * Which cadastral footprints an authored landmark model replaces.
 *
 * The rule is "the footprint under the model's own position", plus the Radet's
 * restaurant: the authored Radet includes the building it stands on, and the
 * cadastre splits that corner into three small commercial plots around the
 * mill, so all of them within six metres go.
 */
function replacedByLandmarks() {
  const pts = [];
  for (const id of ['maison_rose', 'moulin_radet']) {
    const l = LANDMARKS.find((x) => x.id === id);
    if (!l) continue;
    const p = geoToLocal(l.lat, l.lon);
    pts.push({ x: p.x, z: p.z, r: id === 'moulin_radet' ? 6.0 : 3.0 });
  }
  return (b) => {
    const ring = pairs(b.o);
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    return pts.some((p) => Math.hypot(cx - p.x, cz - p.z) < p.r);
  };
}
