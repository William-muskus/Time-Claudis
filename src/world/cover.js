import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import { ENCOUNTERS } from '../gameplay/encounters.js';

/**
 * Player cover, in the foreground of every combat area.
 *
 * This is a Time Crisis requirement, not decoration. docs/GAMEPLAY.md §7 says
 * ducking must change the FRAMING and not merely set a flag — "you must see
 * that you are behind something" — and until now there was nothing to be
 * behind. The bottom third of every screenshot was empty road.
 *
 * Real geometry rather than a HUD overlay that slides up, because real
 * geometry does the job for free: the camera drops 92 cm on duck, and a
 * waist-high object 3.5 m in front therefore rises across the frame and
 * occludes the street on its own, with correct perspective and correct
 * lighting. A sliding sprite would have to fake all three.
 *
 * Each piece is chosen to belong to its area rather than being the same crate
 * five times: you take cover behind what is actually on that stretch of the
 * walk.
 */

/** What the player hides behind in each area, in encounter order. */
const COVER_BY_AREA = {
  A1: 'metro_balustrade',  // the ironwork around the Lamarck stairwell
  A2: 'stone_wall',        // a garden wall on the climb up Girardon
  A3: 'terrace',           // cafe terrace on Place Dalida
  A4: 'planters',          // the walled lane: stone troughs and bins
  A5: 'fountain_bench',    // Place Emile-Goudeau: Wallace fountain and benches
};

export function buildCover(rail, rng = null) {
  // Seeded, for the same reason landmarks.js is: a fixed seed must produce a
  // fixed world or nothing downstream can be measured twice.
  const rnd = rng ? () => rng() : Math.random;
  const group = new THREE.Group();
  group.name = 'cover';

  for (const enc of ENCOUNTERS) {
    let d;
    try { d = rail.distanceToWaypoint(enc.waypoint); } catch { continue; }

    const p = rail.positionAt(d);
    const tan = rail.tangentAt(d);
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();

    // Sit it just in front of where the camera parks, offset the same way the
    // node is, so it lands in the lower third of the frame rather than
    // wandering off to one side.
    const lateral = enc.node?.lateral ?? 0;
    const AHEAD = 3.4;
    const base = p.clone()
      .addScaledVector(tan, AHEAD)
      .addScaledVector(right, lateral);

    const piece = buildPiece(COVER_BY_AREA[enc.areaId] ?? 'stone_wall', rnd);
    piece.position.copy(base);
    piece.position.y = p.y + 0.16;
    // atan2 on the horizontal components only; the tangent climbs and a
    // yaw taken from a tilted vector leans the cover.
    piece.rotation.y = Math.atan2(tan.x, tan.z);
    piece.name = `cover_${enc.areaId}`;
    group.add(piece);
  }
  return group;
}

function buildPiece(kind, rnd) {
  switch (kind) {
    case 'metro_balustrade': return metroBalustrade();
    case 'terrace': return cafeTerrace();
    case 'planters': return planters(rnd);
    case 'fountain_bench': return fountainBench();
    default: return stoneWall(rnd);
  }
}

/** Cast-iron balustrade: vertical rhythm, and you can see through it. */
function metroBalustrade() {
  const g = new THREE.Group();
  const iron = flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.4 });
  const W = 5.4, H = 1.04;

  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.09, 0.09), iron);
  top.position.y = H;
  top.castShadow = true;
  g.add(top);
  const mid = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.06), iron);
  mid.position.y = H * 0.55;
  g.add(mid);

  const n = Math.round(W / 0.26);
  for (let i = 0; i <= n; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, H, 0.04), iron);
    bar.position.set(-W / 2 + (W / n) * i, H / 2, 0);
    bar.castShadow = true;
    g.add(bar);
  }
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, H + 0.16, 0.13), iron);
    post.position.set(s * W / 2, (H + 0.16) / 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}

/** A rendered garden wall with a stone coping and ivy over the top. */
function stoneWall(rnd = Math.random) {
  const g = new THREE.Group();
  const W = 5.0, H = 1.12;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.42),
    flat(PALETTE.plasterCream, { roughness: 0.93 }));
  wall.position.y = H / 2;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);

  const cope = new THREE.Mesh(new THREE.BoxGeometry(W + 0.22, 0.13, 0.6),
    flat(PALETTE.limestoneMid, { roughness: 0.9 }));
  cope.position.y = H + 0.065;
  cope.castShadow = true;
  g.add(cope);

  for (let i = 0; i < 7; i++) {
    const ivy = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.26 + rnd() * 0.18, 0),
      flat(PALETTE.ivyGreen, { roughness: 1 }));
    ivy.position.set(-W / 2 + 0.5 + i * (W - 1) / 6, H + 0.12, 0.12);
    ivy.castShadow = true;
    g.add(ivy);
  }
  return g;
}

/** Cafe terrace: a low rail, two tables, chairs. Place Dalida. */
function cafeTerrace() {
  const g = new THREE.Group();
  const iron = flat(PALETTE.metroGreen, { roughness: 0.5, metalness: 0.3 });
  const W = 5.6, H = 0.98;

  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, 0.14), iron);
  top.position.y = H;
  top.castShadow = true;
  g.add(top);
  // Planter boxes along the rail — the standard Paris terrace screen.
  for (let i = 0; i < 4; i++) {
    const boxw = W / 4 - 0.12;
    const planter = new THREE.Mesh(new THREE.BoxGeometry(boxw, 0.58, 0.36), iron);
    planter.position.set(-W / 2 + boxw / 2 + i * (W / 4) + 0.06, 0.29, 0);
    planter.castShadow = true;
    g.add(planter);
    const green = new THREE.Mesh(
      new THREE.BoxGeometry(boxw * 0.92, 0.3, 0.3),
      flat(PALETTE.foliageMid, { roughness: 1 }));
    green.position.set(planter.position.x, 0.66, 0);
    green.castShadow = true;
    g.add(green);
  }
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), iron);
    post.position.set(s * W / 2, H / 2, 0);
    g.add(post);
  }
  return g;
}

/** Stone troughs and a bin store. The walled lane has no room for furniture. */
function planters(rnd = Math.random) {
  const g = new THREE.Group();
  const stone = flat(PALETTE.limestoneMid, { roughness: 0.94 });
  for (let i = -1; i <= 1; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.86, 0.62), stone);
    t.position.set(i * 1.65, 0.43, 0);
    t.castShadow = t.receiveShadow = true;
    g.add(t);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.44),
      flat(PALETTE.trunkBark, { roughness: 1 }));
    soil.position.set(i * 1.65, 0.9, 0);
    g.add(soil);
    for (let k = 0; k < 3; k++) {
      const shrub = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.3 + rnd() * 0.14, 0),
        flat(k % 2 ? PALETTE.foliageMid : PALETTE.foliageSun, { roughness: 1 }));
      // Chest height, like every other piece of cover on the route.
      //
      // At 1.08 the shrubs topped out around 1.5 m and, with the base offset,
      // sat exactly on the player's 1.66 m eye line — so the one area built
      // around close-quarters fighting in a narrow lane put a hedge across the
      // fight. Cover you cannot see over is a wall.
      shrub.position.set(i * 1.65 - 0.42 + k * 0.42, 0.78, 0);
      shrub.castShadow = true;
      g.add(shrub);
    }
  }
  return g;
}

/** A Wallace fountain flanked by benches. Place Emile-Goudeau. */
function fountainBench() {
  const g = new THREE.Group();
  const iron = flat(PALETTE.metroGreen, { roughness: 0.45, metalness: 0.4 });
  const wood = flat(PALETTE.shutterGreen, { roughness: 0.85 });

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.9, 0.95, 10), iron);
  basin.position.y = 0.48;
  basin.castShadow = basin.receiveShadow = true;
  g.add(basin);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.7, 8), iron);
  shaft.position.y = 1.3;
  shaft.castShadow = true;
  g.add(shaft);

  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.15), wood);
      slat.position.set(s * 2.6, 0.5, -0.2 + i * 0.2);
      slat.castShadow = true;
      g.add(slat);
    }
    for (let i = 0; i < 3; i++) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.15, 0.08), wood);
      back.position.set(s * 2.6, 0.68 + i * 0.19, -0.3);
      back.castShadow = true;
      g.add(back);
    }
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.5), iron);
    leg.position.set(s * 2.6, 0.25, -0.05);
    g.add(leg);
  }
  return g;
}
