import * as THREE from 'three';
import { buildStreet } from './street.js';
import { buildBuilding } from './buildings.js';
import { buildLandmarks } from './landmarks.js';
import { buildProps } from './props.js';
import { buildCover } from './cover.js';
import { EMPTY_REGISTRY } from './assets.js';
import { LANDMARKS, geoToLocal } from '../data/route.js';
import { makeRng } from '../core/rng.js';
import { batchStatic } from './optimize.js';
import { buildSky } from '../render/sky.js';
import { occluder } from './occluders.js';
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
export function buildWorld(rail, seed = 0x4D4F4E54 /* "MONT" */, assets = EMPTY_REGISTRY) {
  const rng = makeRng(seed);
  const root = new THREE.Group();
  root.name = 'montmartre';

  root.add(buildStreet(rail));

  // Landmarks are placed FIRST and their footprints reserved, so the
  // procedural street wall cannot be built on top of them.
  //
  // This was a real bug and an invisible one: the gate of 11 bis rue
  // d'Orchampt sits seven metres off the centreline of a six-metre lane,
  // which is exactly where the building row wants to put a terrace, so the
  // most sensitive landmark on the route was being swallowed by a generated
  // house. The authored geometry always wins over the generated geometry.
  const lm = buildLandmarks(rail, assets, rng);
  root.add(lm.group);

  const anchors = [...lm.anchors];
  // Coarse boxes for the line-of-sight test the director runs before it picks
  // a spawn anchor. See src/world/occluders.js for why this is not a raycast.
  const occluders = [];
  const reserved = landmarkFootprints(rail);
  root.add(buildBuildingRows(rail, rng, anchors, reserved, occluders));
  root.add(buildEndCaps(rail, rng, anchors, occluders));

  // Rue de l'Abreuvoir, which the player never walks but always looks down.
  root.add(buildAbreuvoirSpur(rail, rng, occluders));

  root.add(buildProps(rail, rng, assets));
  root.add(buildCover(rail, rng));
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

  return { root, anchors, occluders, stats, sky };
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
    //
    // DO NOT REWEIGHT THESE LISTS TO CHANGE THE COLOUR BALANCE. Different
    // styles consume different numbers of draws inside buildBuilding, so
    // changing which style comes out of a pick shifts the whole rng stream
    // after it and relays the entire street wall. Tried once, to make pink
    // rarer: the reshuffled layout put an unlit façade across half the frame
    // at the station and failed the forward-arc test at Girardon. Adjust the
    // palette entry instead — it moves no geometry at all.
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

/**
 * Circles on the ground plane that the procedural street wall must avoid.
 *
 * Radii are generous on purpose: a landmark needs breathing room around it to
 * read, not merely non-intersection. The Moulin's mound is nine metres across
 * before the tower even starts, and Place Dalida has to stay a square.
 */
function landmarkFootprints(rail) {
  const zones = [];
  const add = (waypointId, radius, lateral = 0) => {
    let d;
    try { d = rail.distanceToWaypoint(waypointId); } catch { return; }
    const p = rail.positionAt(d);
    const tan = rail.tangentAt(d);
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    zones.push({
      x: p.x + right.x * lateral,
      z: p.z + right.z * lateral,
      r: radius,
      id: waypointId,
    });
  };

  const addLandmark = (landmarkId, radius) => {
    const l = LANDMARKS.find((x) => x.id === landmarkId);
    if (!l) return;
    const p = geoToLocal(l.lat, l.lon, l.elev);
    zones.push({ x: p.x, z: p.z, r: radius, id: landmarkId });
  };

  add('lamarck_station', 16);     // the metro mouth and its twin staircases
  // The allée des Brouillards is a PEDESTRIAN alley, not a street. Reserving
  // it keeps the procedural terrace off both sides so the authored château
  // wall and pavilions can stand there instead — see buildChateauBrouillards.
  // Without this the most distinctive stretch of the climb was six storeys of
  // generated Haussmann on both flanks, which is the one thing it is not.
  add('brouillards', 22);
  add('place_dalida', 15);        // the bust, and the square it needs
  // The Blute-fin's mound is nine metres across before the tower starts, and
  // it now sits at its own coordinate rather than a rail offset, so the
  // reservation is taken there.
  addLandmark('moulin_blutefin', 20);
  add('maison_dalida', 12, -7);   // the wall and gate of 11 bis
  add('emile_goudeau', 17);       // the square, fountain and Bateau-Lavoir
  add('place_abbesses', 18);      // the edicule, carousel and Saint-Jean
  return zones;
}

/**
 * Rue de l'Abreuvoir: a street the rail never touches.
 *
 * WHY IT HAS TO EXIST. The world is built by walking the rail, so only streets
 * the player walks get buildings. That was invisible while the Maison Rose sat
 * 58 m from the bust, because the main street wall around Place Dalida reached
 * most of the way to it. Correcting the survey moved the house out to its real
 * 136 m and left the most photographed view in Montmartre as a lone pink box
 * across open ground — the error had been hiding behind another error.
 *
 * The survey note for Place Dalida is explicit that this sightline "must be
 * preserved exactly", so the street gets built even though nobody walks it.
 *
 * It is deliberately NOT the Haussmann terrace the generator makes elsewhere.
 * L'Abreuvoir is a village street: two and three storeys, cream and ochre
 * render, shutters, low roofs, and a bend in the middle that is the reason
 * every photograph of it works — you cannot see the far end from the near one,
 * so La Maison Rose arrives as a reveal.
 */
function buildAbreuvoirSpur(rail, rng, occluders = []) {
  const group = new THREE.Group();
  group.name = 'abreuvoir';
  void rail;

  // Both ends are cited coordinates; the middle carries the bend.
  const spine = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(42, -1.5, 20),
    new THREE.Vector3(82, -2.5, 41),
    new THREE.Vector3(119, -3.0, 65),
  ];
  const HALF = 3.6;   // a seven-metre street

  const slate = flat(PALETTE.slateDark, { roughness: 0.7 });
  const cobble = flat(PALETTE.cobbleWarm, { roughness: 0.96 });
  const kerb = flat(PALETTE.kerbStone, { roughness: 0.9 });

  /** Point and heading a fraction of the way along the spine. */
  const atFrac = (t) => {
    const f = Math.min(0.999, Math.max(0, t)) * (spine.length - 1);
    const i = Math.floor(f), u = f - i;
    const a = spine[i], b = spine[i + 1];
    return {
      p: new THREE.Vector3(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u),
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
    };
  };

  // GROUND FIRST, or the street floats.
  //
  // buildApron() models the Butte falling away from the rail — 95 m of reach
  // dropping 7 m as the square of the distance — because that is what the hill
  // does. A real street 136 m out from the rail is therefore built over a
  // surface that has already fallen several metres below it, and the roadway
  // showed up as a pale slab hanging in mid-air with a hard edge. Measured, it
  // sat 0.75 m proud at the square and had no ground at all under its far half.
  //
  // So the spur carries its own apron: a strip at the street's own elevation
  // that blends outward, which is the truth about a street cut into a slope.
  // polygonOffset because it necessarily overlaps the main apron at the
  // junction, and the one carrying the road has to win.
  {
    const REACH = 46, DROP = 5.5;
    const BANDS = [0, 0.18, 0.45, 1.0];
    const pos = [], idx = [];
    const STEPS = 24;
    for (let i = 0; i <= STEPS; i++) {
      const f = atFrac(i / STEPS);
      for (const side of [-1, 1]) {
        for (const b of BANDS) {
          const off = side * (HALF + 0.9 + b * REACH);
          pos.push(
            f.p.x + Math.cos(f.yaw) * off,
            f.p.y - 0.08 - DROP * b * b,
            f.p.z - Math.sin(f.yaw) * off);
        }
      }
    }
    const perRow = BANDS.length * 2;
    for (let i = 0; i < STEPS; i++) {
      for (let side = 0; side < 2; side++) {
        const base = i * perRow + side * BANDS.length;
        const next = base + perRow;
        for (let b = 0; b < BANDS.length - 1; b++) {
          const a = base + b, c = a + 1, d = next + b, e = d + 1;
          if (side === 1) idx.push(a, d, c, c, d, e);
          else idx.push(a, c, d, c, e, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = flat(PALETTE.cobbleCool, { roughness: 0.98 });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const apron = new THREE.Mesh(geo, mat);
    apron.receiveShadow = true;
    group.add(apron);
  }

  // Roadway: one quad per span, so it follows the bend.
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i], b = spine[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const road = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 0.12, len + 0.6), cobble);
    road.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 - 0.06, (a.z + b.z) / 2);
    road.rotation.y = yaw;
    road.receiveShadow = true;
    group.add(road);
    for (const side of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, len + 0.6), kerb);
      k.position.set(
        (a.x + b.x) / 2 + Math.cos(yaw) * side * HALF, (a.y + b.y) / 2 + 0.04,
        (a.z + b.z) / 2 - Math.sin(yaw) * side * HALF);
      k.rotation.y = yaw;
      k.receiveShadow = true;
      group.add(k);
    }
  }

  const total = spine.reduce((acc, p, i) =>
    i ? acc + Math.hypot(p.x - spine[i - 1].x, p.z - spine[i - 1].z) : 0, 0);

  const RENDERS = [PALETTE.plasterCream, PALETTE.plasterOchre, PALETTE.limestoneMid,
                   PALETTE.limestoneLit];
  for (const side of [-1, 1]) {
    // Start clear of Place Dalida's own reserved circle, stop short of the
    // Maison Rose so the corner house is the thing you see at the end.
    let d = 14;
    for (let n = 0; n < 14 && d < total - 16; n++) {
      const w = rng.range(7, 12);
      const floors = rng.int(2, 3);
      const h = floors * 3.0 + 0.6;
      const depth = rng.range(8, 12);
      const f = atFrac((d + w / 2) / total);
      const off = HALF + 0.9 + depth / 2;
      const cx = f.p.x + Math.cos(f.yaw) * side * off;
      const cz = f.p.z - Math.sin(f.yaw) * side * off;

      const body = new THREE.Mesh(new THREE.BoxGeometry(depth, h, w),
        flat(RENDERS[rng.int(0, RENDERS.length - 1)], { roughness: 0.92 }));
      body.position.set(cx, f.p.y + h / 2, cz);
      body.rotation.y = f.yaw;
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.6, 0.5, w + 0.5), slate);
      roof.position.set(cx, f.p.y + h + 0.25, cz);
      roof.rotation.y = f.yaw;
      roof.castShadow = true;
      group.add(roof);

      // Shutters on the street face — the only detail that reads at 130 m, and
      // the thing that makes a row of boxes a row of houses.
      const shutter = flat(rng.chance(0.5) ? PALETTE.shutterBlue : PALETTE.shutterGreen,
        { roughness: 0.8 });
      const cols = Math.max(2, Math.round(w / 3));
      for (let fl = 0; fl < floors; fl++) {
        for (let c = 0; c < cols; c++) {
          const alongOff = -w / 2 + (w / cols) * (c + 0.5);
          const faceOff = off - depth / 2 - 0.07;
          const sx = f.p.x + Math.cos(f.yaw) * side * faceOff - Math.sin(f.yaw) * alongOff;
          const sz = f.p.z - Math.sin(f.yaw) * side * faceOff - Math.cos(f.yaw) * alongOff;
          const sh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.45, 0.95), shutter);
          sh.position.set(sx, f.p.y + 1.9 + fl * 3.0, sz);
          sh.rotation.y = f.yaw;
          group.add(sh);
        }
      }

      occluders.push(occluder(
        { x: cx, z: cz },
        { x: Math.cos(f.yaw) * side, z: -Math.sin(f.yaw) * side },
        w / 2, depth / 2, f.p.y, h));

      d += w + rng.range(0.3, 1.4);
    }
  }
  return group;
}

function buildBuildingRows(rail, rng, anchors, reserved = [], occluders = []) {
  const group = new THREE.Group();
  group.name = 'facades';

  /** Last storey count placed on each side, so neighbours cannot agree. */
  const lastFloors = { '-1': null, 1: null };

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
      // Same rule as src/world/street.js: the survey width is building to
      // building, so the setback is half of it. Anything else and the facades
      // stop agreeing with the kerb they are supposed to stand behind.
      const setback = Math.max(2.6, rail.widthAt(d + w / 2) * 0.5);

      // Skip anything that would land inside a landmark's reserved circle.
      const centre = p.clone().addScaledVector(right, side * (setback + 6));
      const blocked = reserved.some(
        (z) => Math.hypot(centre.x - z.x, centre.z - z.z) < z.r + w * 0.5);
      if (blocked) { d += w * 0.5; continue; }

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
          // Level the tangent before aiming. The rail climbs 39 m over its
          // length, so its tangent has a real vertical component — on the
          // Girardon slope, aiming a nine-metre wall down it tips the whole
          // slab about thirty degrees and it reads, correctly, as a building
          // falling over. Walls stand up; only the ground follows the grade.
          const levelTan = new THREE.Vector3(tan.x, 0, tan.z).normalize();
          wall.lookAt(wall.position.clone().add(levelTan));
          wall.castShadow = wall.receiveShadow = true;
          group.add(wall);
        }
        // The two side walls of an alley mouth block just as much as a
        // façade does, and they flank the very anchor the alley publishes.
        for (const s2 of [-1, 1]) {
          const c = p.clone()
            .addScaledVector(right, side * (setback + 4.5))
            .addScaledVector(tan, s2 * (w / 2));
          const levelTan = new THREE.Vector3(tan.x, 0, tan.z).normalize();
          occluders.push(occluder(c, levelTan, 0.3, 4.5, p.y, 9));
        }
        d += w * 0.55;
        continue;
      }

      const depth = rng.range(9, 15);

      /**
       * Break the cornice line between neighbours.
       *
       * docs/ROUTE.md says, in as many words, that a level cornice reads as
       * Boulevard Haussmann and stops being Montmartre instantly — and then
       * the first version of this generator produced exactly that, because
       * `characterAt()` returns a storey count per DISTRICT and neighbouring
       * plots kept drawing the same number.
       *
       * The Butte was a village annexed in 1860 and built up plot by plot over
       * decades, so adjacent houses disagree about height by a storey or two
       * and about cornice level by half a metre. Forcing a difference from the
       * previous building, rather than merely randomising, guarantees the
       * raggedness instead of hoping for it.
       */
      let floors = ch.floors;
      if (lastFloors[side] !== null && floors === lastFloors[side]) {
        floors += rng.chance(0.5) ? 1 : -1;
      }
      floors = Math.max(2, Math.min(6, floors));
      lastFloors[side] = floors;
      const corniceJog = rng.range(-0.55, 0.55);

      const { group: b, anchors: ba } = buildBuilding({
        width: w, depth, floors, style: ch.style,
        shopfront: ch.shopfront, rng, corniceJog,
      });

      b.position.copy(p).addScaledVector(right, side * (setback + depth / 2));
      b.position.y = p.y;
      // Face the street.
      const facing = p.clone().addScaledVector(right, side * setback);
      b.lookAt(facing.x, b.position.y, facing.z);
      group.add(b);

      // The box the director tests against. Its depth axis is the street
      // normal, so the frontage lies across it — exactly the shape of the
      // thing that keeps hiding enemies.
      occluders.push(occluder(
        b.position, right.clone().multiplyScalar(side),
        w / 2, depth / 2, p.y, floors * 3.2 + 2));

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
function buildEndCaps(rail, rng, anchors, occluders = []) {
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
    const halfW = Math.max(2.6, rail.widthAt(cap.at) * 0.5);

    // A short continuation of the street wall, so the road reads as going
    // somewhere rather than ending.
    for (const side of [-1, 1]) {
      // START WELL PAST THE END, AND KEEP THEM LOW.
      //
      // At `along = 3` the first end-cap building stood three metres past the
      // last waypoint, fifteen metres to the side, and six storeys tall — so
      // the game's finishing shot at Place des Abbesses had a twenty-metre
      // blank flank filling its right third. The caps exist to stop the street
      // running out into bare terrain, which the terrace across the far end
      // already does; they do not need to crowd the square to do it.
      let along = 14;
      for (let i = 0; i < 5; i++) {
        const w = rng.range(7, 12);
        const depth = rng.range(9, 14);
        const { group: b, anchors: ba } = buildBuilding({
          width: w, depth, floors: rng.int(3, 5),
          style: rng.pick(['plaster', 'ochre', 'grey', 'stone']),
          shopfront: rng.chance(0.45), rng,
        });
        b.position.copy(origin)
          .addScaledVector(tan, along + w / 2)
          .addScaledVector(right, side * (halfW + depth / 2));
        b.position.y = origin.y;
        const facing = b.position.clone().addScaledVector(right, -side * depth);
        b.lookAt(facing.x, b.position.y, facing.z);
        group.add(b);
        occluders.push(occluder(
          b.position, right.clone().multiplyScalar(side),
          w / 2, depth / 2, origin.y, 20));

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
