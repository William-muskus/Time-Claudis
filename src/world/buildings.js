import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';

/**
 * Montmartre façades.
 *
 * THE ANATOMY WE ARE REPRODUCING
 * A Montmartre street wall is not Haussmann proper — the Butte was a village
 * annexed in 1860 and built up piecemeal, so the terrace is shorter (4-6
 * storeys, not 7), the stone is rendered plaster as often as ashlar, and the
 * roofline is ragged because neighbours were built decades apart. Getting that
 * raggedness right matters more than any single façade: a perfectly level
 * cornice line reads as Boulevard Haussmann and instantly stops being
 * Montmartre.
 *
 * Every building is assembled from the same five bands, which is what keeps
 * the silhouette legible at arcade speed:
 *   1. socle        darker plinth, 0.6 m
 *   2. ground floor taller, shopfront or carriage door
 *   3. body         repeated window bays, shutters, one balcony band
 *   4. cornice      a single projecting lip — the strongest horizontal
 *   5. mansard      zinc slope with dormers, then chimney stacks
 *
 * ANCHORS. Buildings publish the places an enemy can come from: doorways,
 * balconies, dormers, rooftop parapets, and the alley mouths between blocks.
 * Gameplay never invents a spawn point; it asks the architecture for one. That
 * is what makes the enemies feel like they belong to the street.
 */

let _anchorId = 0;

/**
 * @param {object} o
 * @param {number} o.width    frontage in metres
 * @param {number} o.depth
 * @param {number} o.floors   storeys above the ground floor
 * @param {string} o.style    'plaster' | 'stone' | 'brick' | 'pink'
 * @param {boolean} o.shopfront
 * @param {() => number} o.rng
 * @returns {{group: THREE.Group, anchors: Array}}
 */
export function buildBuilding({
  width = 9, depth = 11, floors = 4, style = 'plaster',
  shopfront = false, rng = Math.random, awningColor = null,
} = {}) {
  const group = new THREE.Group();
  const anchors = [];

  const SOCLE_H = 0.6;
  const GROUND_H = shopfront ? 3.9 : 3.4;
  const FLOOR_H = 2.95;
  const bodyH = floors * FLOOR_H;
  const corniceY = SOCLE_H + GROUND_H + bodyH;
  const MANSARD_H = 2.6;

  const wallColor = {
    plaster: PALETTE.plasterCream,
    stone:   PALETTE.limestoneLit,
    brick:   PALETTE.chimneyTerra,
    pink:    PALETTE.plasterPink,
    ochre:   PALETTE.plasterOchre,
    grey:    PALETTE.plasterGrey,
  }[style] ?? PALETTE.plasterCream;

  const wallMat = flat(wallColor, { roughness: 0.88 });
  const socleMat = flat(PALETTE.limestoneDeep, { roughness: 0.92 });
  const ironMat = flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.35 });
  const zincMat = flat(PALETTE.zincLit, { roughness: 0.55, metalness: 0.3 });
  const glassMat = flat(PALETTE.slateDark, { roughness: 0.25, metalness: 0.1 });

  // --- 1. socle -----------------------------------------------------------
  const socle = new THREE.Mesh(new THREE.BoxGeometry(width, SOCLE_H, depth), socleMat);
  socle.position.y = SOCLE_H / 2;
  socle.castShadow = socle.receiveShadow = true;
  group.add(socle);

  // --- 2 + 3. the wall ----------------------------------------------------
  const wallH = GROUND_H + bodyH;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, wallH, depth), wallMat);
  wall.position.y = SOCLE_H + wallH / 2;
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);

  const frontZ = depth / 2;
  const bays = Math.max(2, Math.round(width / 2.6));
  const bayW = width / bays;

  // --- ground floor: shopfront or carriage door ---------------------------
  if (shopfront) {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.86, GROUND_H * 0.62, 0.14), glassMat);
    glass.position.set(0, SOCLE_H + GROUND_H * 0.5, frontZ + 0.02);
    group.add(glass);

    // The awning. Montmartre shopfronts are almost all awninged and the cloth
    // is one of the few places the palette gets a saturated accent.
    const ac = awningColor ?? (rng() < 0.5 ? PALETTE.awningRed : PALETTE.awningGreen);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.12, 1.5),
      flat(ac, { roughness: 0.95 }));
    awning.position.set(0, SOCLE_H + GROUND_H * 0.88, frontZ + 0.75);
    awning.rotation.x = -0.19;
    awning.castShadow = true;
    group.add(awning);

    // A shop door is a spawn anchor — an enemy stepping out of a boulangerie
    // is exactly the Time Crisis beat.
    anchors.push(anchor('door', new THREE.Vector3(width * 0.3, SOCLE_H, frontZ + 0.3)));
  } else {
    // A porte cochère: tall, dark, arched-looking double door.
    const doorW = Math.min(2.1, bayW * 0.8), doorH = GROUND_H * 0.78;
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.16),
      flat(PALETTE.shutterGreen, { roughness: 0.7 }));
    door.position.set(0, SOCLE_H + doorH / 2, frontZ + 0.03);
    group.add(door);
    // Lintel.
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.5, 0.22, 0.26), socleMat);
    lintel.position.set(0, SOCLE_H + doorH + 0.11, frontZ + 0.06);
    group.add(lintel);
    anchors.push(anchor('door', new THREE.Vector3(0, SOCLE_H, frontZ + 0.4)));

    // Ground-floor windows either side of the door.
    for (let b = 0; b < bays; b++) {
      const x = -width / 2 + bayW * (b + 0.5);
      if (Math.abs(x) < doorW * 0.75) continue;
      addWindow(group, x, SOCLE_H + GROUND_H * 0.55, frontZ, bayW, glassMat, ironMat, rng, false);
    }
  }

  // --- upper floors -------------------------------------------------------
  // One balcony band. On a Montmartre terrace it is usually the second floor,
  // occasionally the top. Never every floor — that is a Haussmann boulevard.
  const balconyFloor = floors >= 3 ? (rng() < 0.72 ? 1 : floors - 1) : 0;

  for (let f = 0; f < floors; f++) {
    const y = SOCLE_H + GROUND_H + f * FLOOR_H + FLOOR_H * 0.52;
    const isBalcony = f === balconyFloor;

    for (let b = 0; b < bays; b++) {
      const x = -width / 2 + bayW * (b + 0.5);
      addWindow(group, x, y, frontZ, bayW, glassMat, ironMat, rng, true);
    }

    if (isBalcony) {
      const bal = buildBalcony(width * 0.94, ironMat);
      bal.position.set(0, y - FLOOR_H * 0.33, frontZ + 0.45);
      group.add(bal);
      // Balconies are the classic elevated firing position.
      anchors.push(anchor('balcony', new THREE.Vector3(0, y - FLOOR_H * 0.3, frontZ + 0.5)));
      if (bays >= 3) {
        anchors.push(anchor('balcony',
          new THREE.Vector3(width * 0.28, y - FLOOR_H * 0.3, frontZ + 0.5)));
      }
    }
  }

  // --- 4. cornice ---------------------------------------------------------
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.7, 0.34, depth + 0.7), socleMat);
  cornice.position.y = SOCLE_H + wallH + 0.17;
  cornice.castShadow = true;
  group.add(cornice);

  // --- 5. mansard + dormers + chimneys ------------------------------------
  const mansard = buildMansard(width, depth, MANSARD_H, zincMat);
  mansard.position.y = corniceY + 0.34;
  group.add(mansard);

  const dormerCount = Math.max(1, Math.floor(bays / 2));
  for (let i = 0; i < dormerCount; i++) {
    const x = -width / 2 + (width / (dormerCount + 1)) * (i + 1);
    const dz = frontZ - MANSARD_H * 0.34;
    const dormer = buildDormer(zincMat, glassMat);
    dormer.position.set(x, corniceY + 0.34 + MANSARD_H * 0.42, dz);
    group.add(dormer);
    anchors.push(anchor('dormer', new THREE.Vector3(x, corniceY + MANSARD_H * 0.55, dz + 0.4)));
  }

  // Rooftop: a flat behind the mansard slope where a sniper can set up.
  const roofY = corniceY + 0.34 + MANSARD_H;
  anchors.push(anchor('roof', new THREE.Vector3(0, roofY, 0)));

  // Chimney stacks with terracotta pots. Montmartre rooflines are bristling
  // with these and they are most of what the skyline silhouette is made of.
  const stacks = 1 + (rng() < 0.55 ? 1 : 0);
  for (let i = 0; i < stacks; i++) {
    const cx = (rng() - 0.5) * width * 0.6;
    const cz = (rng() - 0.5) * depth * 0.4;
    group.add(buildChimney(roofY, cx, cz, rng));
  }

  group.userData.height = roofY;
  return { group, anchors };
}

function anchor(type, pos) {
  return { id: `a${_anchorId++}`, type, localPos: pos.clone() };
}

/** A window: recessed glass, stone surround, and shutters folded to the sides. */
function addWindow(group, x, y, frontZ, bayW, glassMat, ironMat, rng, shutters) {
  const w = Math.min(1.15, bayW * 0.46), h = 1.75;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), glassMat);
  glass.position.set(x, y, frontZ - 0.04);
  group.add(glass);

  // Stone surround, slightly proud — this is what catches the raking sun and
  // gives a flat wall its relief without any texture at all.
  const surround = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.26, h + 0.26, 0.09),
    flat(PALETTE.limestoneMid, { roughness: 0.9 }));
  surround.position.set(x, y, frontZ + 0.02);
  surround.castShadow = true;
  group.add(surround);

  if (shutters && rng() < 0.78) {
    const col = rng() < 0.5 ? PALETTE.shutterBlue : PALETTE.shutterGrey;
    const sm = flat(col, { roughness: 0.8 });
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, h, 0.07), sm);
      sh.position.set(x + s * (w * 0.72), y, frontZ + 0.07);
      sh.castShadow = true;
      group.add(sh);
    }
  }
}

/** Wrought iron balcony: bottom plate, top rail, vertical balusters. */
function buildBalcony(width, ironMat) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.8),
    flat(PALETTE.limestoneMid, { roughness: 0.9 }));
  plate.castShadow = true;
  g.add(plate);

  const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, 0.07), ironMat);
  top.position.y = 0.85;
  g.add(top);

  const n = Math.max(6, Math.round(width / 0.22));
  for (let i = 0; i <= n; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.85, 0.035), ironMat);
    b.position.set(-width / 2 + (width / n) * i, 0.43, 0);
    g.add(b);
  }
  return g;
}

/** The mansard: a truncated pyramid in zinc. */
function buildMansard(width, depth, h, mat) {
  const g = new THREE.BufferGeometry();
  const bw = width / 2, bd = depth / 2;
  const tw = bw * 0.62, td = bd * 0.62;
  const v = [
    -bw, 0, bd,   bw, 0, bd,   bw, 0, -bd,  -bw, 0, -bd,
    -tw, h, td,   tw, h, td,   tw, h, -td,  -tw, h, -td,
  ];
  const idx = [
    0, 1, 5, 0, 5, 4,   // front
    1, 2, 6, 1, 6, 5,   // right
    2, 3, 7, 2, 7, 6,   // back
    3, 0, 4, 3, 4, 7,   // left
    4, 5, 6, 4, 6, 7,   // flat top
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A roof dormer — small gabled box punched through the mansard slope. */
function buildDormer(zincMat, glassMat) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.9), zincMat);
  box.castShadow = true;
  g.add(box);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.08), glassMat);
  glass.position.z = 0.46;
  g.add(glass);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.42, 4), zincMat);
  cap.position.y = 0.72;
  cap.rotation.y = Math.PI / 4;
  cap.castShadow = true;
  g.add(cap);
  return g;
}

/** Chimney stack and its terracotta pots. */
function buildChimney(baseY, x, z, rng) {
  const g = new THREE.Group();
  const h = 1.1 + rng() * 1.1;
  const w = 0.7 + rng() * 0.5;
  const stack = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7),
    flat(PALETTE.plasterGrey, { roughness: 0.95 }));
  stack.position.set(x, baseY + h / 2, z);
  stack.castShadow = true;
  g.add(stack);

  const pots = Math.max(1, Math.round(w / 0.33));
  for (let i = 0; i < pots; i++) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.42, 6),
      flat(PALETTE.chimneyTerra, { roughness: 0.9 }));
    pot.position.set(x - w / 2 + (w / pots) * (i + 0.5), baseY + h + 0.21, z);
    pot.castShadow = true;
    g.add(pot);
  }
  return g;
}
