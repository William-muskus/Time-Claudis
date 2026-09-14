import * as THREE from 'three';
import { buildStreet } from './street.js';
import { buildBuilding } from './buildings.js';
import { buildLandmarks } from './landmarks.js';
import { buildProps } from './props.js';
import { makeRng } from '../core/rng.js';
import { batchStatic } from './optimize.js';
import { buildSky } from '../render/sky.js';
import { PALETTE, flat } from '../render/palette.js';

/**
 * Assembles the whole of Montmartre from the survey.
 *
 * Buildings are laid along both kerbs by walking the rail and consuming
 * frontage. Each block's character is chosen from the waypoint it sits nearest,
 * so the quartier changes as you climb: workaday terraces by the station,
 * grander stone around Place Dalida, tight garden walls on rue d'Orchampt,
 * shopfronts again as you drop into rue des Trois Frères. That progression is
 * the thing a local would actually notice.
 *
 * Returns the scene group plus the anchor list gameplay draws spawns from.
 */
export function buildWorld(rail, seed = 0x4D4F4E54 /* "MONT" */) {
  const rng = makeRng(seed);
  const root = new THREE.Group();
  root.name = 'montmartre';

  root.add(buildStreet(rail));

  const anchors = [];
  root.add(buildBuildingRows(rail, rng, anchors));
  root.add(buildEndCaps(rail, rng, anchors));

  const lm = buildLandmarks(rail);
  root.add(lm.group);
  anchors.push(...lm.anchors);

  root.add(buildProps(rail, rng));
  root.add(buildGroundPlane(rail));

  const sky = buildSky();
  sky.userData.dynamic = true;   // never batched; it tracks the camera
  root.add(sky);

  // Anchors are captured in world space above, BEFORE batching flattens the
  // transform hierarchy. Order matters here: batching disposes the source
  // meshes, so anything that needs their world position must have taken it
  // already.
  const stats = batchStatic(root);
  if (typeof console !== 'undefined') {
    console.info(`[world] batched ${stats.before} meshes into ${stats.after} draw calls`);
  }

  return { root, anchors, stats, sky };
}

/**
 * Character of the street wall, keyed to how far along the walk you are.
 * `t` is 0 at the métro and 1 at Abbesses.
 */
function characterAt(t, rng) {
  if (t < 0.14) {
    // Rue Caulaincourt / Lamarck: tall, plain, a bit sooty. Cafés at the foot.
    return { floors: rng.int(4, 6), style: rng.pick(['plaster', 'grey', 'plaster']),
             shopfront: rng.chance(0.4), width: rng.range(8, 13) };
  }
  if (t < 0.34) {
    // The climb up Girardon. Quieter, residential, garden walls appearing.
    return { floors: rng.int(3, 5), style: rng.pick(['plaster', 'stone', 'ochre']),
             shopfront: rng.chance(0.12), width: rng.range(7, 12) };
  }
  if (t < 0.48) {
    // Place Dalida and its approaches. The best addresses on the Butte.
    return { floors: rng.int(3, 5), style: rng.pick(['stone', 'stone', 'plaster', 'pink']),
             shopfront: rng.chance(0.08), width: rng.range(9, 14) };
  }
  if (t < 0.66) {
    // Lepic / d'Orchampt. Low, secretive, walls higher than the houses.
    return { floors: rng.int(2, 4), style: rng.pick(['plaster', 'ochre', 'grey']),
             shopfront: rng.chance(0.05), width: rng.range(6, 10) };
  }
  if (t < 0.82) {
    // Émile-Goudeau and the Ravignan drop. Artists' storeys, big north glass.
    return { floors: rng.int(3, 5), style: rng.pick(['plaster', 'stone', 'ochre']),
             shopfront: rng.chance(0.25), width: rng.range(7, 12) };
  }
  // Trois Frères into Abbesses: shops, awnings, noise.
  return { floors: rng.int(4, 6), style: rng.pick(['plaster', 'ochre', 'grey', 'pink']),
           shopfront: rng.chance(0.72), width: rng.range(8, 13) };
}

function buildBuildingRows(rail, rng, anchors) {
  const group = new THREE.Group();
  group.name = 'facades';

  for (const side of [-1, 1]) {
    let d = 4;
    let guard = 0;
    while (d < rail.length - 6 && guard++ < 400) {
      const t = d / rail.length;
      const ch = characterAt(t, rng);
      const w = ch.width;

      // Leave an occasional gap: an alley mouth or a courtyard entry. These
      // are gold for a rail shooter — a hole in the street wall the player has
      // to watch — and Montmartre is full of them.
      const isGap = rng.chance(0.11);

      const p = rail.positionAt(d + w / 2);
      const tan = rail.tangentAt(d + w / 2);
      const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const halfW = rail.widthAt(d + w / 2) * 0.5;
      const setback = halfW + 2.4;   // kerb plus pavement

      if (isGap) {
        const alleyPos = new THREE.Vector3().copy(p).addScaledVector(right, side * (setback + 1.5));
        anchors.push({
          id: `alley_${side > 0 ? 'R' : 'L'}_${Math.round(d)}`,
          type: 'alley',
          worldPos: alleyPos,
          railDistance: d + w / 2,
          side,
        });
        // Shadowed side walls so the gap reads as depth, not as missing geometry.
        for (const s2 of [-1, 1]) {
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 9, 9),
            flat(PALETTE.limestoneDeep, { roughness: 0.95 }));
          wall.position.copy(p)
            .addScaledVector(right, side * (setback + 4.5))
            .addScaledVector(tan, s2 * (w / 2));
          wall.position.y += 4.5;
          wall.lookAt(wall.position.clone().add(tan));
          wall.castShadow = wall.receiveShadow = true;
          group.add(wall);
        }
        d += w * 0.55;
        continue;
      }

      const depth = rng.range(9, 15);
      const { group: b, anchors: ba } = buildBuilding({
        width: w, depth, floors: ch.floors, style: ch.style,
        shopfront: ch.shopfront, rng,
      });

      b.position.copy(p).addScaledVector(right, side * (setback + depth / 2));
      b.position.y = p.y;
      // Face the street.
      const facing = p.clone().addScaledVector(right, side * setback);
      b.lookAt(facing.x, b.position.y, facing.z);
      group.add(b);

      // Promote local anchors to world space once, here, so gameplay never has
      // to know about the building's transform.
      b.updateMatrixWorld(true);
      for (const a of ba) {
        anchors.push({
          ...a,
          worldPos: b.localToWorld(a.localPos.clone()),
          railDistance: d + w / 2,
          side,
          facing: right.clone().multiplyScalar(-side),
        });
      }

      d += w + rng.range(0.2, 1.1);
    }
  }
  return group;
}

/**
 * Close the street off at both ends.
 *
 * The building rows run from 4 m to length-6 m along the rail, which leaves
 * both ends of the level open onto bare terrain. Standing at Place des
 * Abbesses and looking south — which is exactly where the player ends up — you
 * saw the distant rooftop sea and nothing else, because the city simply
 * stopped. Montmartre does not stop; it carries on in every direction, and a
 * square is a square precisely because it is enclosed.
 *
 * So both ends get a wall of buildings placed by EXTRAPOLATING the rail's
 * tangent past its endpoints. Extrapolation rather than rail.positionAt()
 * matters: positionAt clamps, so every sample beyond the end returns the same
 * point and the whole cap would collapse into one stack of coincident boxes.
 */
function buildEndCaps(rail, rng, anchors) {
  const group = new THREE.Group();
  group.name = 'endcaps';

  const caps = [
    { at: 0, dir: -1, name: 'north' },              // behind the metro
    { at: rail.length, dir: +1, name: 'south' },    // beyond Abbesses
  ];

  for (const cap of caps) {
    const origin = rail.positionAt(cap.at);
    const tan = rail.tangentAt(cap.at).clone().multiplyScalar(cap.dir);
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const halfW = rail.widthAt(cap.at) * 0.5;

    // A short continuation of the street wall, so the road reads as going
    // somewhere rather than ending.
    for (const side of [-1, 1]) {
      let along = 3;
      for (let i = 0; i < 5; i++) {
        const w = rng.range(7, 12);
        const depth = rng.range(9, 14);
        const { group: b, anchors: ba } = buildBuilding({
          width: w, depth, floors: rng.int(4, 6),
          style: rng.pick(['plaster', 'ochre', 'grey', 'stone']),
          shopfront: rng.chance(0.45), rng,
        });
        b.position.copy(origin)
          .addScaledVector(tan, along + w / 2)
          .addScaledVector(right, side * (halfW + 2.4 + depth / 2));
        b.position.y = origin.y;
        const facing = b.position.clone().addScaledVector(right, -side * depth);
        b.lookAt(facing.x, b.position.y, facing.z);
        group.add(b);

        b.updateMatrixWorld(true);
        for (const a of ba) {
          anchors.push({
            ...a,
            worldPos: b.localToWorld(a.localPos.clone()),
            railDistance: cap.at,
            side,
            facing: right.clone().multiplyScalar(-side),
          });
        }
        along += w + rng.range(0.2, 1.0);
      }
    }

    // And a terrace straight across the far end, which is what actually turns
    // an open road into an enclosed square.
    const acrossAt = origin.clone().addScaledVector(tan, 46);
    for (let i = -2; i <= 2; i++) {
      const w = rng.range(9, 13);
      const { group: b } = buildBuilding({
        width: w, depth: rng.range(10, 15), floors: rng.int(4, 6),
        style: rng.pick(['plaster', 'grey', 'ochre']),
        shopfront: rng.chance(0.35), rng,
      });
      b.position.copy(acrossAt).addScaledVector(right, i * (w + 1.5));
      b.position.y = origin.y;
      const facing = b.position.clone().addScaledVector(tan, -10);
      b.lookAt(facing.x, b.position.y, facing.z);
      group.add(b);
    }
  }
  return group;
}

/**
 * The world beyond the level: the Butte's flank, and the city below it.
 *
 * WHY THIS IS FIDDLY. The route is 552 m long and climbs 39 m, and from the
 * top of the Ravignan steps you are genuinely looking out over the rooftops of
 * the 9th. So there has to be something down there. But the first version of
 * this placed the distant rooftops in a ring 190-620 m from the route's
 * MIDPOINT — and the station end of the route is 289 m from that midpoint, so
 * the ring closed over the camera and the game opened inside a box of unlit
 * geometry. The whole scene rendered black and it looked like a lighting bug.
 *
 * The fix is to derive the safe radius from the route's actual extent rather
 * than guessing a number: find the farthest point on the rail from the centre,
 * add a margin, and start the city beyond that. Recomputed from the rail, so
 * moving a waypoint can never re-open the hole.
 */
function buildGroundPlane(rail) {
  const g = new THREE.Group();
  g.name = 'terrain';

  // Centre and radius of the whole route.
  const samples = [];
  for (let i = 0; i <= 40; i++) samples.push(rail.positionAt((i / 40) * rail.length));
  const centre = samples.reduce((a, p) => a.add(p.clone()), new THREE.Vector3())
    .divideScalar(samples.length);
  const routeRadius = Math.max(...samples.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z)));

  // The city starts well clear of anywhere the player can ever stand.
  const INNER = routeRadius + 140;
  const OUTER = INNER + 520;

  // Lowest point on the route, so the plain below sits under the whole Butte.
  const lowest = Math.min(...samples.map((p) => p.y));
  const PLAIN_Y = lowest - 38;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(3200, 3200, 1, 1),
    flat(PALETTE.limestoneDeep, { roughness: 1.0 }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(centre.x, PLAIN_Y, centre.z);
  plane.receiveShadow = true;
  g.add(plane);

  // The Butte's own flank: a broad cone falling away from the route so the
  // hill has mass when you see it from the descent.
  const flank = new THREE.Mesh(
    new THREE.CylinderGeometry(routeRadius + 60, routeRadius + 210, 46, 10, 1),
    flat(PALETTE.foliageDeep, { roughness: 1.0 }));
  flank.position.set(centre.x, lowest - 23, centre.z);
  flank.receiveShadow = true;
  g.add(flank);

  // The rooftop sea. Deliberately crude and deliberately deep in the fog — it
  // is a horizon, not a place, and anything more detailed would pull the eye
  // off the street where the game actually happens.
  const rng = makeRng(0xC1D1);
  for (let i = 0; i < 170; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const rad = rng.range(INNER, OUTER);
    const h = rng.range(14, 30);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(rng.range(16, 38), h, rng.range(16, 38)),
      flat(rng.chance(0.55) ? PALETTE.limestoneDeep : PALETTE.zincShadow, { roughness: 1 }));
    box.position.set(
      centre.x + Math.sin(ang) * rad,
      PLAIN_Y + h / 2 + rng.range(-3, 7),
      centre.z + Math.cos(ang) * rad,
    );
    box.rotation.y = rng.range(0, Math.PI);
    g.add(box);
  }
  return g;
}
