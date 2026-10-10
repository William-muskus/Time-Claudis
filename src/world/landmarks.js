import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import { geoToLocal, LANDMARKS } from '../data/route.js';
import { EMPTY_REGISTRY } from './assets.js';
import { groundAt } from './geo.js';

/**
 * The named things.
 *
 * These are the reason the level is set here rather than anywhere else. Each is
 * placed at its real coordinate and oriented the way it really faces. A local
 * will forgive a simplified façade; they will not forgive the Dalida bust
 * looking the wrong way down rue de l'Abreuvoir.
 *
 * Landmarks are the one part of the world that is NOT procedural. Everything
 * else is generated; these are authored.
 */
export function buildLandmarks(rail, assets = EMPTY_REGISTRY, rng = null) {
  /**
   * A seeded source of scatter, never Math.random — a fixed seed must produce
   * a fixed world or no frame can be measured twice.
   */
  const scatter = rng ? () => rng() : Math.random;
  const group = new THREE.Group();
  group.name = 'landmarks';
  const anchors = [];

  /** Prefer the Blender-authored GLB; fall back to the procedural version. */
  const authored = (key, procedural) => assets.instance(key) ?? procedural();

  /**
   * EVERY LANDMARK STANDS AT ITS SOURCE COORDINATE.
   *
   * Until October 2026 most of these were placed as offsets from the rail —
   * "five metres to the left of the place_dalida waypoint" — because the rail
   * and the landmarks were both estimates and offsets were the only way to
   * keep them in a sensible relationship. Every object here now has a real
   * position (the OSM node or way, or the BD TOPO footprint; see LANDMARKS in
   * src/data/route.js), and the ground under it comes from the same terrain
   * model as everything else. Orientation is the one thing the data does not
   * give, so each model is turned to face the nearest point of the walk —
   * which for a statue, a gate or a shop sign is what "facing the street"
   * means.
   */
  const place = (id, obj, { up = 0, face = true, yaw = null } = {}) => {
    const l = LANDMARKS.find((x) => x.id === id);
    const p = geoToLocal(l.lat, l.lon, l.elev);
    const y = groundAt(p.x, p.z) ?? p.y;
    obj.position.set(p.x, y + up, p.z);
    if (yaw !== null) obj.rotation.y = yaw;
    else if (face) obj.rotation.y = yawToRail(rail, p.x, p.z);
    group.add(obj);
    return obj;
  };

  // The bust faces EAST, down rue de l'Abreuvoir toward La Maison Rose. That
  // is the one orientation in the level that is a fact rather than a rule,
  // so it is set explicitly: +Z rotated to point at the Maison Rose.
  {
    const b = LANDMARKS.find((x) => x.id === 'dalida_bust');
    const r = LANDMARKS.find((x) => x.id === 'maison_rose');
    const pb = geoToLocal(b.lat, b.lon), pr = geoToLocal(r.lat, r.lon);
    place('dalida_bust', authored('dalida_bust', () => buildDalidaBust()),
      { yaw: Math.atan2(pr.x - pb.x, pr.z - pb.z) });
  }
  // The rail starts ON the entrance's mapped point, so the model there stood
  // in the player's first step. It goes behind the start — far enough that its
  // 8.6 m handrails clear the first step too — turned
  // to face up the walk: the player emerges from it, which is the fiction.
  {
    const m = buildMetroEntrance();
    const p0 = rail.positionAt(0), t0 = rail.tangentAt(0);
    const fx = t0.x, fz = t0.z, fl = Math.hypot(fx, fz) || 1;
    const x = p0.x - (fx / fl) * 5.6, z = p0.z - (fz / fl) * 5.6;
    m.position.set(x, groundAt(x, z) ?? p0.y, z);
    m.rotation.y = Math.atan2(fx, fz);
    group.add(m);
  }
  // The Blute-fin on its mound: the model's base is at the mound top, which
  // BD TOPO records at 116.5 m — seven metres above rue Lepic.
  place('moulin_blutefin', authored('moulin_galette', () => buildMoulin()), { face: false });
  // The Radet on its restaurant at the rue Lepic corner. The restaurant's
  // footprint is skipped from the cadastral city (see index.js) so the
  // authored base stands in its place rather than inside it.
  place('moulin_radet', buildMoulinRadet());
  // The gate of 11 bis stands on the LANE, not at the house's centroid. The
  // cadastre shows exactly where: the east side of rue d'Orchampt is a
  // building wall, and the west side opens onto the garden in front of the
  // house — open ground, not a building — so the garden wall and its carriage
  // gate run ALONG the lane on that side, just clear of the walk.
  {
    const gate = buildDalidaHouseGate(scatter);
    const d = rail.distanceToWaypoint('maison_dalida');
    const p = rail.positionAt(d), t = rail.tangentAt(d);
    const rx = -t.z, rz = t.x, rl = Math.hypot(rx, rz) || 1;
    const l = LANDMARKS.find((x) => x.id === 'maison_dalida');
    const ph = geoToLocal(l.lat, l.lon);
    const side = Math.sign((ph.x - p.x) * rx + (ph.z - p.z) * rz) || -1;
    const off = 2.3;
    const gx = p.x + (rx / rl) * side * off, gz = p.z + (rz / rl) * side * off;
    gate.position.set(gx, groundAt(gx, gz) ?? p.y, gz);
    // Front (+Z) faces back across the lane; the wall's length runs along it.
    gate.rotation.y = Math.atan2(-rx * side, -rz * side);
    // Nine metres of wall rather than the model's thirteen: the lane bends
    // here, and a straight thirteen-metre wall cuts the inside of the bend.
    gate.scale.x = 0.7;
    group.add(gate);
  }
  place('maison_rose', buildMaisonRose());
  place('sacre_coeur', buildSacreCoeur(), { face: false });
  place('mur_des_je', buildMurDesJeTaime(scatter));
  place('marcel_ayme', buildPasseMuraille(scatter));
  place('edicule_abbesses', authored('guimard_edicule', () => buildGuimardEdicule()));
  place('carousel_abbesses', buildCarousel(), { face: false });

  // Spawn anchors the architecture cannot provide: the métro mouths, and the
  // mound around the Blute-fin as a sniper's perch.
  anchors.push(
    anchorAtLandmark('moulin_blutefin', 'roof', new THREE.Vector3(0, 7.5, 0)),
    anchorAtLandmark('metro_lamarck', 'metro', new THREE.Vector3(0, 0, 0)),
    anchorAtLandmark('edicule_abbesses', 'metro', new THREE.Vector3(0, 0, 0)),
  );

  return { group, anchors };
}

/**
 * Yaw that turns a model's +Z front toward the nearest point of the walk.
 */
function yawToRail(rail, x, z) {
  let best = null, bd = Infinity;
  for (let d = 0; d <= rail.length; d += 2) {
    const p = rail.positionAt(d);
    const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (dd < bd) { bd = dd; best = p; }
  }
  return Math.atan2(best.x - x, best.z - z);
}

// ---------------------------------------------------------------------------
// placement helpers
// ---------------------------------------------------------------------------

function anchorAtLandmark(landmarkId, type, offset) {
  const l = LANDMARKS.find((x) => x.id === landmarkId);
  const p = geoToLocal(l.lat, l.lon, l.elev);
  return {
    id: `lm_${landmarkId}_${type}`,
    type,
    worldPos: new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z),
    facing: new THREE.Vector3(0, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// the landmarks themselves
// ---------------------------------------------------------------------------

/**
 * Aslan's bronze of Dalida, 1997, on its stone plinth.
 *
 * The detail that matters: the chest is rubbed to bright gold by thirty years
 * of tourists while the rest has gone the flat brown-green of weathered bronze.
 * Two materials, one object. Nobody who has stood in front of it would accept
 * a uniformly bronze bust.
 */
function buildDalidaBust() {
  const g = new THREE.Group();
  g.name = 'dalida_bust';

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 1.5, 0.8),
    flat(PALETTE.limestoneMid, { roughness: 0.92 }));
  plinth.position.y = 0.75;
  plinth.castShadow = plinth.receiveShadow = true;
  g.add(plinth);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.22, 1.1),
    flat(PALETTE.limestoneDeep, { roughness: 0.95 }));
  base.position.y = 0.11;
  base.receiveShadow = true;
  g.add(base);

  const bronze = flat(PALETTE.bronzeDalida, { roughness: 0.42, metalness: 0.65 });
  const polished = flat(PALETTE.bronzePolish, { roughness: 0.18, metalness: 0.9 });

  // Torso, cut off at the chest the way a bust is.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.62, 10), bronze);
  torso.position.y = 1.5 + 0.31;
  torso.castShadow = true;
  g.add(torso);

  // The polished band.
  const rub = new THREE.Mesh(new THREE.CylinderGeometry(0.355, 0.38, 0.24, 10), polished);
  rub.position.y = 1.5 + 0.46;
  rub.position.z = 0.03;
  rub.castShadow = true;
  g.add(rub);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.18, 8), bronze);
  neck.position.y = 1.5 + 0.7;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), bronze);
  head.position.y = 1.5 + 0.92;
  head.scale.set(0.92, 1.12, 0.95);
  head.castShadow = true;
  g.add(head);

  // The hair. Big, swept, unmistakable — it is most of the silhouette.
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 8), bronze);
  hair.position.set(0, 1.5 + 0.97, -0.045);
  hair.scale.set(1.08, 1.02, 1.1);
  hair.castShadow = true;
  g.add(hair);

  // She faces roughly east, down rue de l'Abreuvoir toward La Maison Rose.
  g.rotation.y = -Math.PI * 0.42;
  return g;
}

/**
 * Place Marcel-Aymé and the Passe-Muraille.
 *
 * Jean Marais, 1989: a bronze man caught halfway out of a stone wall, one arm
 * and one leg and half a face still inside it, the rest of him straining out.
 * It is the ending of Marcel Aymé's story, where the man who could walk
 * through walls loses the knack mid-wall.
 *
 * WHY IT IS HERE NOW. It sits off rue Girardon at rue Norvins, which is
 * directly on the climb between Place Dalida and the mills — the player walks
 * within a few metres of it — and the level did not have it at all. A resident
 * passes this every day. Leaving it out is the same class of error as getting
 * the Abreuvoir sightline wrong: the geometry was plausible and the place was
 * not the place.
 *
 * Built as a wall with a figure emerging, because the whole image depends on
 * the two being one object. A bronze standing in front of a wall is a statue;
 * a bronze coming OUT of a wall is the story.
 */
function buildPasseMuraille(rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'passe_muraille';

  const stone = flat(PALETTE.limestoneMid, { roughness: 0.94 });
  const bronze = flat(PALETTE.bronzeDalida, { roughness: 0.45, metalness: 0.5 });
  const bronzeLit = flat(PALETTE.bronzePolish, { roughness: 0.5, metalness: 0.45 });

  // The wall. Low and wide, the way the real one is set into the side of the
  // little square rather than standing free.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.1, 0.55), stone);
  wall.position.set(0, 1.55, 0);
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  const cope = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.16, 0.75), stone);
  cope.position.set(0, 3.18, 0);
  cope.castShadow = true;
  g.add(cope);

  // The figure, emerging from the front face. Only the leading half exists —
  // torso, one shoulder, one arm forward, one knee out — and it is offset so
  // the wall plane cuts through him rather than passing behind him.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.86, 0.34), bronze);
  torso.position.set(-0.3, 1.62, 0.34);
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), bronzeLit);
  head.position.set(-0.3, 2.2, 0.36);
  head.castShadow = true;
  g.add(head);
  // The forward arm, reaching out of the stone. This is the silhouette.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.72), bronze);
  arm.position.set(-0.56, 1.78, 0.66);
  arm.rotation.x = -0.22;
  arm.castShadow = true;
  g.add(arm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.19), bronzeLit);
  hand.position.set(-0.56, 1.86, 1.02);
  hand.castShadow = true;
  g.add(hand);
  // The leading knee, mid-stride.
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), bronze);
  leg.position.set(-0.18, 0.95, 0.42);
  leg.rotation.x = -0.3;
  leg.castShadow = true;
  g.add(leg);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.34), bronze);
  foot.position.set(-0.18, 0.62, 0.62);
  foot.castShadow = true;
  g.add(foot);

  // Three cobbles of the little square, so it does not float on the road.
  for (let i = 0; i < 4; i++) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(1.5 + rnd() * 0.5, 0.1, 1.4), stone);
    slab.position.set(-2.4 + i * 1.6, 0.05, 1.3);
    slab.receiveShadow = true;
    g.add(slab);
  }
  return g;
}

/** The Blute-fin windmill on its mound. */
function buildMoulin() {
  const g = new THREE.Group();
  g.name = 'moulin_galette';

  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 9.5, 5, 8),
    flat(PALETTE.foliageDeep, { roughness: 1 }));
  mound.position.y = -2.5;
  mound.receiveShadow = true;
  g.add(mound);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.5, 5.5, 8),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  tower.position.y = 2.75;
  tower.castShadow = tower.receiveShadow = true;
  g.add(tower);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 1.8, 8),
    flat(PALETTE.zincShadow, { roughness: 0.6, metalness: 0.3 }));
  cap.position.y = 6.2;
  cap.castShadow = true;
  g.add(cap);

  // Four sails on a hub, tilted the way a mill's sails actually sit.
  const sails = new THREE.Group();
  sails.name = 'sails';
  const woodMat = flat(PALETTE.trunkBark, { roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.6, 0.12), woodMat);
    arm.rotation.z = (i * Math.PI) / 2;
    arm.position.y = 0;
    // Offset so the arms read as a cross of lattice, not a plus sign.
    arm.position.x = Math.sin((i * Math.PI) / 2) * 2.8;
    arm.position.y = Math.cos((i * Math.PI) / 2) * 2.8;
    arm.rotation.z = (i * Math.PI) / 2;
    arm.castShadow = true;
    sails.add(arm);

    const lattice = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.4, 0.05),
      flat(PALETTE.plasterGrey, { roughness: 0.9 }));
    lattice.position.copy(arm.position);
    lattice.rotation.copy(arm.rotation);
    lattice.castShadow = true;
    sails.add(lattice);
  }
  sails.position.set(0, 5.0, 2.5);
  sails.rotation.x = -0.12;
  g.add(sails);
  g.userData.sails = sails;

  return g;
}

/** The second mill on the rue Lepic corner, which everyone mistakes for the first. */
function buildMoulinRadet() {
  const g = new THREE.Group();
  g.name = 'moulin_radet';
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 4.2, 8),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  tower.position.y = 8.1;   // it sits on top of the restaurant below it
  tower.castShadow = true;
  g.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.4, 8),
    flat(PALETTE.chimneyTerra, { roughness: 0.8 }));
  cap.position.y = 10.9;
  cap.castShadow = true;
  g.add(cap);
  const woodMat = flat(PALETTE.trunkBark, { roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.0, 0.1), woodMat);
    arm.position.set(Math.sin((i * Math.PI) / 2) * 2.0, 9.0 + Math.cos((i * Math.PI) / 2) * 2.0, 1.7);
    arm.rotation.z = (i * Math.PI) / 2;
    arm.castShadow = true;
    g.add(arm);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 7),
    flat(PALETTE.plasterOchre, { roughness: 0.9 }));
  base.position.y = 4;
  base.castShadow = base.receiveShadow = true;
  g.add(base);
  return g;
}

/**
 * 11 bis rue d'Orchampt.
 *
 * You cannot see the house from the street and the game does not pretend
 * otherwise: a high rendered wall, ivy over the coping, and a dark green
 * carriage gate that stays shut. Only the roofline shows above. Faking a view
 * of the house would be the single most obvious lie in the level.
 */
function buildDalidaHouseGate(rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'maison_dalida';

  const wall = new THREE.Mesh(new THREE.BoxGeometry(13, 3.4, 0.55),
    flat(PALETTE.plasterCream, { roughness: 0.93 }));
  wall.position.y = 1.7;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);

  const coping = new THREE.Mesh(new THREE.BoxGeometry(13.3, 0.2, 0.8),
    flat(PALETTE.limestoneMid, { roughness: 0.9 }));
  coping.position.y = 3.5;
  coping.castShadow = true;
  g.add(coping);

  // Ivy spilling over the top.
  for (let i = 0; i < 16; i++) {
    const ivy = new THREE.Mesh(
      new THREE.BoxGeometry(0.8 + rnd() * 0.7, 0.5 + rnd() * 0.9, 0.5),
      flat(PALETTE.ivyGreen, { roughness: 1 }));
    ivy.position.set(-6 + i * 0.8, 3.4 - rnd() * 0.5, 0.15);
    ivy.castShadow = true;
    g.add(ivy);
  }

  const gate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.9, 0.2),
    flat(PALETTE.shutterGreen, { roughness: 0.55 }));
  gate.position.set(0, 1.45, 0.3);
  gate.castShadow = true;
  g.add(gate);

  // Vertical boarding on the gate leaves.
  for (let i = 0; i < 8; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.8, 0.06),
      flat(PALETTE.slateDark, { roughness: 0.6 }));
    board.position.set(-1.4 + i * 0.4, 1.45, 0.42);
    g.add(board);
  }

  // The number plate. Small, blue, enamelled — and the only label in the level.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.04),
    flat(PALETTE.shutterBlue, { roughness: 0.4 }));
  plate.position.set(2.0, 2.5, 0.32);
  g.add(plate);

  // The roofline you actually do see, set well back.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 3.5, 8),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  roof.position.set(0, 4.2, -6);
  roof.castShadow = true;
  g.add(roof);
  const mansard = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.4, 4),
    flat(PALETTE.zincShadow, { roughness: 0.55, metalness: 0.3 }));
  mansard.rotation.y = Math.PI / 4;
  mansard.position.set(0, 7.1, -6);
  mansard.castShadow = true;
  g.add(mansard);

  return g;
}

/** La Maison Rose: pink walls, green joinery, on its corner. */
function buildMaisonRose() {
  const g = new THREE.Group();
  g.name = 'maison_rose';
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 7.2, 8),
    flat(PALETTE.plasterPink, { roughness: 0.9 }));
  body.position.y = 3.6;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const trim = flat(PALETTE.shutterGreen, { roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.1), trim);
    win.position.set(-2.6 + i * 2.6, 5.0, 4.05);
    g.add(win);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.12), trim);
  door.position.set(0, 1.15, 4.06);
  g.add(door);
  const band = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.45, 8.1), trim);
  band.position.y = 2.6;
  g.add(band);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.6, 2.2, 4),
    flat(PALETTE.zincShadow, { roughness: 0.6, metalness: 0.3 }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 8.3;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

/**
 * Sacré-Cœur on the skyline.
 *
 * It is 450 m east of the route and 130 m up, so from the rail it is a
 * silhouette and nothing more. Modelled as the three domes and the campanile
 * because that is the whole of what you read at this distance.
 */
function buildSacreCoeur() {
  const g = new THREE.Group();
  g.name = 'sacre_coeur';
  const stone = flat(PALETTE.signWhite, { roughness: 0.85 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(34, 22, 26), stone);
  base.position.y = 11;
  base.castShadow = true;
  g.add(base);

  const dome = (r, h, x, z, y) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stone);
    d.position.set(x, y, z);
    d.scale.y = h / r;
    d.castShadow = true;
    g.add(d);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 6, 12), stone);
    drum.position.set(x, y - 3, z);
    g.add(drum);
  };
  dome(9, 13, 0, 0, 25);
  dome(4.5, 6, -13, 6, 23);
  dome(4.5, 6, 13, 6, 23);

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 28, 10), stone);
  tower.position.set(-2, 25, -15);
  tower.castShadow = true;
  g.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3.6, 6, 10), stone);
  spire.position.set(-2, 42, -15);
  g.add(spire);
  return g;
}

/**
 * The Abbesses édicule: Guimard, cast iron, amber glass.
 *
 * One of only two survivors with the glass roof still on. The orange-amber
 * panes against the green iron are the single most recognisable object on the
 * whole route and the level ends on them.
 */
function buildGuimardEdicule() {
  const g = new THREE.Group();
  g.name = 'guimard_edicule';
  const iron = flat(PALETTE.guimardGreen, { roughness: 0.42, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: PALETTE.guimardAmber, flatShading: true,
    roughness: 0.18, metalness: 0.1,
    // Matches the Blender material: see tools/blender/landmarks.py. At 0.45
    // the roof outshone the sky it is supposed to be lit by.
    emissive: PALETTE.guimardAmber, emissiveIntensity: 0.12,
    transparent: true, opacity: 0.88,
  });

  // Stair enclosure and its balustrade.
  const surround = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.95, 3.0), iron);
  surround.position.y = 0.48;
  surround.castShadow = true;
  g.add(surround);

  // Four corner posts, the Guimard "stems".
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 3.3, 6), iron);
    post.position.set(sx * 2.1, 1.65, sz * 1.35);
    post.castShadow = true;
    g.add(post);
    // The curling head each stem ends in.
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 6, 10, Math.PI * 1.4), iron);
    head.position.set(sx * 2.1, 3.35, sz * 1.35);
    head.rotation.y = Math.PI / 2;
    g.add(head);
  }

  // The glass roof: a shallow shell, amber, lit from within.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.16, 3.8), glass);
  roof.position.y = 3.5;
  g.add(roof);
  for (const s of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.14, 1.5), glass);
    slope.position.set(0, 3.28, s * 2.4);
    slope.rotation.x = s * 0.42;
    g.add(slope);
  }
  // Ribs.
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 5.6), iron);
    rib.position.set(i * 1.25, 3.56, 0);
    g.add(rib);
  }

  // The METROPOLITAIN sign panel on its two stems.
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.62, 0.1),
    flat(PALETTE.guimardAmber, { roughness: 0.35, emissive: PALETTE.guimardAmber }));
  sign.position.set(0, 4.1, -1.5);
  g.add(sign);
  const signFrame = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.85, 0.06), iron);
  signFrame.position.set(0, 4.1, -1.56);
  g.add(signFrame);

  // The dark mouth of the stair.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 2.0),
    flat(0x14131c, { roughness: 1 }));
  mouth.position.y = 0.02;
  g.add(mouth);

  return g;
}

/** A Wallace fountain. Dark green, four caryatids, a little dome. */
export function buildWallaceFountain() {
  const g = new THREE.Group();
  g.name = 'wallace';
  const iron = flat(PALETTE.metroGreen, { roughness: 0.45, metalness: 0.45 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 0.55, 8), iron);
  base.position.y = 0.28;
  base.castShadow = true;
  g.add(base);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.85, 8), iron);
  shaft.position.y = 0.95;
  g.add(shaft);

  // The four caryatids, reduced to four standing figures — at arcade distance
  // that is exactly what they read as.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.5, 6), iron);
    fig.position.set(Math.cos(a) * 0.3, 2.1, Math.sin(a) * 0.3);
    fig.castShadow = true;
    g.add(fig);
  }
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.22, 8), iron);
  dome.position.y = 2.95;
  g.add(dome);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 8), iron);
  cap.position.y = 3.3;
  cap.castShadow = true;
  g.add(cap);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), iron);
  finial.position.y = 3.62;
  g.add(finial);
  return g;
}

/** Le Mur des Je t'aime: 612 dark blue enamelled tiles. */
function buildMurDesJeTaime(rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'mur_des_je_taime';
  const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 0.4),
    flat(0x1B2E52, { roughness: 0.35 }));
  wall.position.y = 2.1;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  // The scattered red fragments — the pieces of a broken heart.
  for (let i = 0; i < 9; i++) {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 + rnd() * 0.5, 0.25 + rnd() * 0.4, 0.06),
      flat(PALETTE.awningRed, { roughness: 0.5 }));
    frag.position.set(-5 + rnd() * 10, 0.9 + rnd() * 2.6, 0.23);
    frag.rotation.z = rnd() * 0.5;
    g.add(frag);
  }
  return g;
}

/** The Abbesses carousel. Two decks, a candy-striped canopy, bulbs. */
function buildCarousel() {
  const g = new THREE.Group();
  g.name = 'carousel';
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.35, 14),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  deck.position.y = 0.5;
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.2, 8),
    flat(PALETTE.guimardAmber, { roughness: 0.4, metalness: 0.4 }));
  pole.position.y = 2.6;
  g.add(pole);

  // Striped canopy.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.5, 3),
      flat(i % 2 ? PALETTE.awningRed : PALETTE.awningCream, { roughness: 0.9 }));
    seg.position.set(Math.cos(a) * 2.7, 4.5, Math.sin(a) * 2.7);
    seg.rotation.z = -0.5 * Math.cos(a);
    seg.rotation.x = 0.5 * Math.sin(a);
    seg.castShadow = true;
    g.add(seg);
  }
  // Horses.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.6, 0.3),
      flat(PALETTE.signWhite, { roughness: 0.8 }));
    h.position.set(Math.cos(a) * 2.2, 1.5, Math.sin(a) * 2.2);
    h.rotation.y = -a;
    h.castShadow = true;
    g.add(h);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5),
      flat(PALETTE.guimardAmber, { metalness: 0.5, roughness: 0.35 }));
    bar.position.set(Math.cos(a) * 2.2, 2.2, Math.sin(a) * 2.2);
    g.add(bar);
  }
  return g;
}

/**
 * The Lamarck-Caulaincourt mouth.
 *
 * Not a Guimard — this one is the later, plainer Dervaux style: a low balustrade
 * ring, a simple mast with the yellow M, and the stair dropping away. What makes
 * it famous is the setting rather than the ironwork: it sits in a dip with the
 * twin flights climbing on either side, which is the shot every visitor takes
 * and the shot the game opens on.
 */
function buildMetroEntrance() {
  const g = new THREE.Group();
  g.name = 'metro_lamarck';
  const iron = flat(PALETTE.metroGreen, { roughness: 0.45, metalness: 0.45 });

  // Balustrade ring around the stairwell.
  const ringR = 2.1;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 1.45 + Math.PI * 0.28;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), iron);
    post.position.set(Math.cos(a) * ringR, 0.48, Math.sin(a) * ringR);
    post.castShadow = true;
    g.add(post);
  }
  const handrail = new THREE.Mesh(
    new THREE.TorusGeometry(ringR, 0.05, 6, 20, Math.PI * 1.45), iron);
  handrail.rotation.x = Math.PI / 2;
  handrail.rotation.z = -Math.PI * 0.28;
  handrail.position.y = 0.95;
  g.add(handrail);

  // The dark stairwell.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 2.6),
    flat(0x12111a, { roughness: 1 }));
  mouth.position.y = 0.03;
  g.add(mouth);
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.34),
      flat(PALETTE.stairStone, { roughness: 0.95 }));
    step.position.set(0, -0.08 - i * 0.17, -0.9 + i * 0.34);
    g.add(step);
  }

  // The mast and the yellow M roundel.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), iron);
  mast.position.set(1.9, 1.7, -0.6);
  mast.castShadow = true;
  g.add(mast);
  const roundel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 14),
    flat(PALETTE.guimardAmber, {
      roughness: 0.35, emissive: PALETTE.guimardAmber, emissiveIntensity: 0.4,
    }));
  roundel.rotation.x = Math.PI / 2;
  roundel.position.set(1.9, 3.5, -0.6);
  roundel.castShadow = true;
  g.add(roundel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.055, 6, 16), iron);
  ring.position.set(1.9, 3.5, -0.62);
  g.add(ring);

  // The twin flights either side, which are the real landmark here.
  for (const s of [-1, 1]) {
    const flight = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.165, 0.32),
        flat(PALETTE.stairStone, { roughness: 0.93 }));
      step.position.set(0, 0.08 + i * 0.165, -i * 0.32);
      step.castShadow = step.receiveShadow = true;
      flight.add(step);
    }
    const hr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 8.6),
      flat(PALETTE.ironwork, { roughness: 0.5, metalness: 0.4 }));
    hr.position.set(0, 3.2, -4.2);
    hr.rotation.x = -0.47;
    flight.add(hr);
    flight.position.set(s * 6.2, 0, -1.5);
    flight.rotation.y = s * 0.12;
    g.add(flight);
  }

  return g;
}
