import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import { GEO, groundAt } from './geo.js';
import { buildBench } from './props.js';
import { buildWallaceFountain } from './landmarks.js';

/**
 * Every tree on the route, from the Ville de Paris inventory.
 *
 * The city records each street and garden tree with its species and height,
 * so the trees stand where they stand and are the trees they are: the horse
 * chestnuts of Place Émile-Goudeau, the limes and Sophoras along the streets,
 * the planes of square Suzanne-Buisson, the cypresses of the cemetery wall.
 * The procedural plane trees that used to be scattered along the kerbs at
 * random intervals are gone.
 *
 * Each species gets a silhouette rather than a model — that is what reads at
 * arcade speed and low poly. A plane is broad and lobed, a chestnut a dense
 * dark dome, a lime a tall oval, a cypress a dark flame.
 */

const SPECIES = {
  plane:     { crown: PALETTE.foliageSun, lobes: 3, r: 0.34, sy: 0.85, bark: new THREE.Color('#8E8270') },
  chestnut:  { crown: PALETTE.foliageDeep, lobes: 2, r: 0.36, sy: 0.95, bark: PALETTE.trunkBark },
  lime:      { crown: PALETTE.foliageMid, lobes: 2, r: 0.27, sy: 1.3, bark: PALETTE.trunkBark },
  sophora:   { crown: new THREE.Color('#7E8E46'), lobes: 2, r: 0.33, sy: 0.85, bark: PALETTE.trunkBark },
  maple:     { crown: new THREE.Color('#8C8A3E'), lobes: 2, r: 0.3, sy: 0.95, bark: PALETTE.trunkBark },
  robinia:   { crown: new THREE.Color('#99A050'), lobes: 3, r: 0.28, sy: 0.9, bark: PALETTE.trunkBark },
  cypress:   { crown: new THREE.Color('#3E4E30'), lobes: 0, r: 0.12, sy: 1, bark: PALETTE.trunkBark },
  mulberry:  { crown: PALETTE.foliageMid, lobes: 2, r: 0.32, sy: 0.85, bark: PALETTE.trunkBark },
  cherry:    { crown: new THREE.Color('#8A6B4E'), lobes: 2, r: 0.3, sy: 0.85, bark: new THREE.Color('#5A3A2E') },
  olive:     { crown: new THREE.Color('#8C9478'), lobes: 2, r: 0.3, sy: 0.8, bark: new THREE.Color('#6E6658') },
  hornbeam:  { crown: PALETTE.foliageMid, lobes: 2, r: 0.3, sy: 1.0, bark: PALETTE.trunkBark },
  celtis:    { crown: PALETTE.foliageSun, lobes: 2, r: 0.3, sy: 0.9, bark: PALETTE.trunkBark },
  ash:       { crown: PALETTE.foliageSun, lobes: 2, r: 0.3, sy: 0.95, bark: PALETTE.trunkBark },
  paulownia: { crown: PALETTE.foliageMid, lobes: 2, r: 0.35, sy: 0.8, bark: PALETTE.trunkBark },
  other:     { crown: PALETTE.foliageMid, lobes: 2, r: 0.3, sy: 0.9, bark: PALETTE.trunkBark },
};

// Shared materials, one per colour, so the static batcher merges every crown
// into a couple of draw calls rather than seven hundred.
const _mats = new Map();
function mat(color, roughness = 0.95) {
  const k = color.getHexString() + roughness;
  if (!_mats.has(k)) _mats.set(k, flat(color, { roughness }));
  return _mats.get(k);
}

function hash(i, k) {
  let x = (i * 2654435761 + k * 40503) | 0;
  x = (x ^ (x >>> 15)) * 2246822519 | 0;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

function buildTree(spec, h, i) {
  const g = new THREE.Group();
  const trunkH = spec.lobes === 0 ? h * 0.12 : h * 0.42;
  const trunkR = Math.max(0.12, h * 0.022);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 5), mat(spec.bark));
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  const col = spec.crown.clone().multiplyScalar(0.92 + hash(i, 1) * 0.16);
  if (spec.lobes === 0) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(h * spec.r, h * 0.9, 6), mat(col));
    cone.position.y = trunkH + h * 0.45;
    cone.castShadow = true;
    g.add(cone);
    return g;
  }
  const R = Math.max(0.9, h * spec.r);
  const cy = trunkH + R * spec.sy * 0.85;
  for (let k = 0; k < spec.lobes; k++) {
    const a = hash(i, 10 + k) * Math.PI * 2;
    const off = k === 0 ? 0 : R * 0.45;
    const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(R * (k === 0 ? 1 : 0.72), 0),
      mat(k === 0 ? col : col.clone().multiplyScalar(1.07)));
    lobe.position.set(Math.cos(a) * off, cy + (k === 0 ? 0 : R * 0.3), Math.sin(a) * off);
    lobe.scale.y = spec.sy;
    lobe.rotation.set(hash(i, 20 + k) * 3, hash(i, 30 + k) * 3, 0);
    lobe.castShadow = true;
    g.add(lobe);
  }
  return g;
}

/**
 * @param {{nearest: Function}} near  railIndex(rail)
 * @param {(x:number, z:number) => boolean} isReserved  landmark exclusion
 */
export function buildRealTrees(rail, near, isReserved = () => false) {
  const group = new THREE.Group();
  group.name = 'trees';
  let placed = 0, skipped = 0;
  GEO.trees.forEach(([x, y, z, h, species], i) => {
    // Keep the trunk out of the camera's path, and nothing more.
    //
    // The first version cleared everything inside the street's half-width,
    // which sounded safe and would have deleted one of the three limes around
    // the Dalida bust: it stands 2.8 m from the rail in an open square, and an
    // open square's "half-width" is a cap, not a kerb. A trunk two metres off
    // the walk is a tree beside you; only one ON the walk is an obstacle.
    const nr = near.nearest(x, z, 8);
    if (nr && nr.dist < 1.5) { skipped++; return; }
    if (isReserved(x, z)) { skipped++; return; }
    const t = buildTree(SPECIES[species] ?? SPECIES.other, h, i);
    t.position.set(x, (groundAt(x, z) ?? y) - 0.05, z);
    t.rotation.y = hash(i, 3) * Math.PI * 2;
    group.add(t);
    placed++;
  });
  group.userData.stats = { placed, skipped };
  return group;
}

/**
 * Street furniture from OpenStreetMap: benches, bollards, bins, and the
 * Wallace fountains, each at its mapped position.
 */
export function buildRealFurniture(rail, near, assets) {
  const group = new THREE.Group();
  group.name = 'furniture';
  const clearOfRail = (x, z, m = 1.6) => {
    const nr = near.nearest(x, z, 10);
    return !nr || nr.dist > m;
  };
  const faceRail = (obj, x, z) => {
    const nr = near.nearest(x, z, 40);
    if (nr) obj.rotation.y = Math.atan2(nr.x - x, nr.z - z);
  };

  for (const [x, , z] of GEO.pois.wallace) {
    const w = assets?.instance?.('wallace_fountain') ?? buildWallaceFountain();
    w.position.set(x, groundAt(x, z) ?? 0, z);
    group.add(w);
  }
  for (const [x, , z] of GEO.pois.bench) {
    if (!clearOfRail(x, z, 2.2)) continue;
    const b = buildBench();
    b.position.set(x, groundAt(x, z) ?? 0, z);
    faceRail(b, x, z);
    group.add(b);
  }
  const iron = mat(PALETTE.ironwork, 0.5);
  for (const [x, , z] of GEO.pois.bollard) {
    if (!clearOfRail(x, z, 1.2)) continue;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.95, 6), iron);
    p.position.set(x, (groundAt(x, z) ?? 0) + 0.47, z);
    p.castShadow = true;
    group.add(p);
  }
  const bin = mat(PALETTE.metroGreen, 0.6);
  for (const [x, , z] of GEO.pois.basket) {
    if (!clearOfRail(x, z, 1.4)) continue;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.75, 7), bin);
    p.position.set(x, (groundAt(x, z) ?? 0) + 0.4, z);
    p.castShadow = true;
    group.add(p);
  }
  return group;
}
