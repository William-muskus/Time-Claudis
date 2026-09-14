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
 * Three devices carry that, and they are the three most important things in
 * this file:
 *
 *   1. NOTHING IS QUANTISED. Storey height, ground-floor height, plinth height
 *      and cornice projection are all jittered per building, so cornices never
 *      line up even between two neighbours with the same number of floors.
 *   2. FOUR ROOF KINDS, not one. Mansard, gable with the ridge along the
 *      street, gable with the ridge into the street, and flat-with-parapet.
 *      A village grew one plot at a time and each owner pitched their roof
 *      however their builder pitched roofs that decade.
 *   3. EVERY PLOT BOUNDARY CARRIES A PARTY WALL that rises clear of its own
 *      roof. Where the neighbour is lower — which, given (1) and (2), is half
 *      the time — you get the blank rendered firewall standing above the
 *      rooftops. That flank is one of the most characteristic sights on the
 *      Butte and it is most of what makes the skyline read as Montmartre
 *      rather than as a row of houses.
 *
 * Every building is still assembled from the same bands, which is what keeps
 * the silhouette legible at arcade speed:
 *   1. socle        darker plinth
 *   2. ground floor taller; shopfront, porte-cochère, garage or shutter
 *   3. body         repeated window bays, string course, shutters, a balcony band
 *   4. cornice      a projecting lip — the strongest horizontal
 *   5. roof         mansard / gable / flat deck, then dormers and chimney stacks
 *   6. party wall   the blank flank at the left-hand plot boundary
 *
 * RELIEF WITHOUT TEXTURE. Flat shading gives us no surface detail at all, so
 * every bit of modelling has to be real geometry that catches the low raking
 * sun from the west-north-west. That is why there are sills, keystones, string
 * courses, quoins and downpipes here: each is a hard edge that produces one
 * bright line and one lilac shadow on an otherwise dead wall. Nothing in this
 * file is smaller than about 0.12 m, because below that it stops being a
 * shadow and starts being noise.
 *
 * ANCHORS. Buildings publish the places an enemy can come from: doorways,
 * balconies, dormers, rooftop parapets, and the alley mouths between blocks.
 * Gameplay never invents a spawn point; it asks the architecture for one. That
 * is what makes the enemies feel like they belong to the street. The only
 * types `src/gameplay/encounters.js` knows are door/balcony/dormer/roof/alley/
 * metro, so a new kind of opening publishes itself as one of those — a garage
 * door and a shop door are both a 'door'.
 */

let _anchorId = 0;

/**
 * The pavement surface sits 0.16 m above the carriageway (see
 * `buildPavement` in street.js) and the building's origin is at road level,
 * so anything standing on the pavement in front of the façade — a stall, a
 * café table, a bin — stands at this local Y.
 */
const PAVE_Y = 0.16;

/**
 * Random helpers built from the bare `rng()` call, so the default
 * `rng = Math.random` still works for anyone constructing a single building
 * outside the world builder.
 */
function helpers(rng) {
  const rr = (lo, hi) => lo + rng() * (hi - lo);
  return {
    rr,
    ri: (lo, hi) => Math.floor(rr(lo, hi + 1)),
    pick: (a) => a[Math.floor(rng() * a.length)],
    ch: (p) => rng() < p,
  };
}

/**
 * @param {object} o
 * @param {number} o.width    frontage in metres
 * @param {number} o.depth
 * @param {number} o.floors   storeys above the ground floor
 * @param {string} o.style    'plaster' | 'stone' | 'brick' | 'pink' | 'ochre' | 'grey'
 * @param {boolean} o.shopfront
 * @param {() => number} o.rng
 * @returns {{group: THREE.Group, anchors: Array}}
 */
export function buildBuilding({
  width = 9, depth = 11, floors = 4, style = 'plaster',
  shopfront = false, rng = Math.random, awningColor = null,
  /** Vertical offset applied to the whole building, in metres. Breaks the
   *  cornice line between neighbours; see buildBuildingRows. */
  corniceJog = 0,
} = {}) {
  const group = new THREE.Group();
  const anchors = [];
  const { rr, ri, pick, ch } = helpers(rng);

  // --- storey heights -----------------------------------------------------
  // All of these are jittered rather than constant, and that is the single
  // cheapest thing in the file: two neighbours with identical floor counts
  // still end up with cornices 0.6-1.4 m apart, so the eye never finds the
  // level datum that would make the street read as a boulevard.
  //
  // The floor count itself gets an occasional outlier on top of whatever the
  // district character asked for. A terrace where every house is within one
  // storey of its neighbour still looks planned; the Butte has the odd runt
  // and the odd tower, and those are what break the rhythm.
  if (ch(0.18)) floors = THREE.MathUtils.clamp(floors + (ch(0.5) ? 1 : -1), 2, 7);

  const SOCLE_H = rr(0.42, 0.95);
  const GROUND_H = shopfront ? rr(3.55, 4.45) : rr(3.05, 3.85);
  const FLOOR_H = rr(2.74, 3.20);
  const bodyH = floors * FLOOR_H;
  const wallH = GROUND_H + bodyH;
  const corniceY = SOCLE_H + wallH;
  const CORNICE_T = rr(0.28, 0.46);
  const CORNICE_P = rr(0.42, 0.85);   // how far the lip projects, per side

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
  const dressMat = flat(PALETTE.limestoneMid, { roughness: 0.9 });   // sills, surrounds, quoins
  const ironMat = flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.35 });
  const zincMat = flat(PALETTE.zincLit, { roughness: 0.55, metalness: 0.3 });
  const slateMat = flat(PALETTE.slateDark, { roughness: 0.55, metalness: 0.3 });
  const glassMat = flat(PALETTE.slateDark, { roughness: 0.25, metalness: 0.1 });

  const frontZ = depth / 2;
  const bays = Math.max(2, Math.round(width / 2.6));
  const bayW = width / bays;

  // --- 1. socle -----------------------------------------------------------
  const socle = new THREE.Mesh(new THREE.BoxGeometry(width, SOCLE_H, depth), socleMat);
  socle.position.y = SOCLE_H / 2;
  socle.castShadow = socle.receiveShadow = true;
  group.add(socle);

  // --- 2 + 3. the wall ----------------------------------------------------
  const wall = new THREE.Mesh(new THREE.BoxGeometry(width, wallH, depth), wallMat);
  wall.position.y = SOCLE_H + wallH / 2;
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);

  // The bandeau: the string course at first-floor level that every Parisian
  // façade has and that nothing else in a flat-shaded scene can substitute
  // for. It is one box and it draws one unbroken bright line the full width of
  // the building with lilac shadow under it — the best relief-per-mesh in the
  // whole file, which is why there is sometimes a second one up at the top
  // storey as well.
  group.add(band(width, depth, SOCLE_H + GROUND_H + 0.05, rr(0.16, 0.24), rr(0.1, 0.2), dressMat));
  if (floors >= 3 && ch(0.45)) {
    group.add(band(width, depth, SOCLE_H + GROUND_H + (floors - 1) * FLOOR_H,
      rr(0.12, 0.18), rr(0.08, 0.14), dressMat));
  }

  // Quoins — the chaîne d'angle of alternating long and short dressed blocks
  // up the corner of an ashlar building. Only the stone-fronted houses get
  // them; a rendered plaster front would not have exposed stonework.
  if (style === 'stone' || (style === 'plaster' && ch(0.15))) {
    addQuoins(group, width, frontZ, SOCLE_H, corniceY, dressMat, rr);
  }

  // --- ground floor -------------------------------------------------------
  // Montmartre's ground floors are not a binary of shop or carriage door. On
  // any 100 m of rue des Trois Frères you get a boulangerie, a bar-tabac, a
  // unit that has been shuttered since before the pandemic, somebody's garage,
  // and a restaurant with four tables out on the pavement, in that order.
  const ctx = {
    group, anchors, width, depth, frontZ, bays, bayW,
    SOCLE_H, GROUND_H, rr, ri, pick, ch,
    dressMat, socleMat, ironMat, glassMat, zincMat, wallColor,
  };

  const kind = shopfront
    ? pick(['boulangerie', 'bar_tabac', 'restaurant', 'shop', 'shop', 'shuttered'])
    : pick(['porte', 'porte', 'porte', 'porte', 'garage', 'shuttered']);

  switch (kind) {
    case 'boulangerie': addBoulangerie(ctx, awningColor); break;
    case 'bar_tabac':   addBarTabac(ctx); break;
    case 'restaurant':  addRestaurant(ctx, awningColor); break;
    case 'shop':        addShopfront(ctx, awningColor); break;
    case 'garage':      addGarage(ctx); break;
    case 'shuttered':   addShuttered(ctx, shopfront); break;
    default:            addPorteCochere(ctx); break;
  }

  // --- upper floors -------------------------------------------------------
  // One balcony band. On a Montmartre terrace it is usually the second floor,
  // occasionally the top. Never every floor — that is a Haussmann boulevard.
  const balconyFloor = floors >= 3 ? (ch(0.72) ? 1 : floors - 1) : 0;
  const shutterCol = ch(0.5) ? PALETTE.shutterBlue
    : (ch(0.5) ? PALETTE.shutterGrey : PALETTE.shutterGreen);
  const shutterMat = flat(shutterCol, { roughness: 0.8 });
  let boxesLeft = ri(0, 2);   // window boxes, kept scarce so they stay an accent

  for (let f = 0; f < floors; f++) {
    const y = SOCLE_H + GROUND_H + f * FLOOR_H + FLOOR_H * 0.52;
    const isBalcony = f === balconyFloor;
    // The piano nobile — first floor over the shop — is the storey that gets
    // the carved keystone over each window. Doing every floor would flatten
    // the hierarchy the façade is meant to have.
    const keyed = f === 0;

    for (let b = 0; b < bays; b++) {
      const x = -width / 2 + bayW * (b + 0.5);
      const planted = boxesLeft > 0 && !isBalcony && ch(0.22);
      if (planted) boxesLeft--;
      addWindow(group, x, y, frontZ, bayW, {
        glassMat, ironMat, dressMat, shutterMat,
        shutters: ch(0.78), keystone: keyed, box: planted, ch, rr,
      });
    }

    if (isBalcony) {
      const bal = buildBalcony(width * 0.94, ironMat, dressMat);
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

  // --- façade fittings ----------------------------------------------------
  // The downpipe is a single vertical line from cornice to pavement at one end
  // of the frontage. It costs two meshes and it is the only strong vertical on
  // an otherwise horizontally-banded wall, so it earns its place on every
  // building rather than as a random extra.
  addDownpipe(group, width, frontZ, SOCLE_H, corniceY, ironMat, ch, rr);

  // Wall-mounted lantern on a bracket, above head height beside the door.
  // Deliberately NOT emissive: it is 18:40 and these are unlit, and an
  // emissive material would drop straight out of the static batch into its own
  // draw call for a sheen nobody would see.
  if (ch(0.4)) {
    addWallLamp(group, width, frontZ, SOCLE_H + GROUND_H + rr(0.4, 0.9), ironMat, rr, ch);
  }

  // Ivy up one flank of the front. Very common on the quieter lanes, and it is
  // the only thing that breaks the cream/lilac wall with a cool green.
  if (ch(0.22)) addIvy(group, width, frontZ, SOCLE_H, corniceY, rr, ch);

  // --- 3b. the flanks -----------------------------------------------------
  // A building seen from the side was a blank box, and at 58 degrees of field
  // of view a near building occupies a quarter of the frame while leaning
  // inward on perspective — so a quarter of the screen was one flat tone. The
  // front gets all the modelling because that is what a street wall shows, but
  // the moment the camera turns a corner the flank is the main event.
  //
  // Deliberately sparser than the front: a real Paris flank has fewer and
  // smaller openings than the street elevation, because it faces a courtyard
  // or a neighbour rather than the public way.
  addFlankFaces(group, {
    width, depth, floors, socleH: SOCLE_H, groundH: GROUND_H, floorH: FLOOR_H,
    wallH, glassMat, ironMat, socleMat, rng,
  });

  // --- 4. cornice ---------------------------------------------------------
  // Two members, not one: a thin frieze band tucked under the main lip. The
  // pair reads as a shadowed recess at any distance, where a single slab reads
  // as a shelf.
  const frieze = new THREE.Mesh(
    new THREE.BoxGeometry(width + CORNICE_P * 0.6, rr(0.14, 0.22), depth + CORNICE_P * 0.6),
    dressMat);
  frieze.position.y = corniceY - 0.1;
  frieze.castShadow = true;
  group.add(frieze);

  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(width + CORNICE_P * 2, CORNICE_T, depth + CORNICE_P * 2), socleMat);
  cornice.position.y = corniceY + CORNICE_T / 2;
  cornice.castShadow = true;
  group.add(cornice);

  // --- 4b. surélévation ---------------------------------------------------
  // An extra storey added later, set back behind the cornice with its own
  // little parapet. Montmartre is full of these — the Butte ran out of land
  // long before it ran out of demand, so people built up into and above their
  // own roofs. It steps the silhouette, which is exactly what we want.
  let roofBaseY = corniceY + CORNICE_T;
  let roofW = width, roofD = depth;
  if (floors >= 3 && ch(0.16)) {
    const atticH = FLOOR_H * rr(0.72, 0.92);
    roofW = width * rr(0.66, 0.8);
    roofD = depth * rr(0.66, 0.82);
    const attic = new THREE.Mesh(new THREE.BoxGeometry(roofW, atticH, roofD),
      flat(wallColor, { roughness: 0.88 }));
    attic.position.set(0, roofBaseY + atticH / 2, frontZ - roofD / 2 - 0.25);
    attic.castShadow = attic.receiveShadow = true;
    group.add(attic);
    const atticGlass = new THREE.Mesh(new THREE.BoxGeometry(roofW * 0.5, atticH * 0.48, 0.1),
      glassMat);
    atticGlass.position.set(0, roofBaseY + atticH * 0.55, frontZ - 0.25 + 0.02);
    group.add(atticGlass);
    roofBaseY += atticH;
    // The set-back terrace this creates is a real sniper perch.
    anchors.push(anchor('roof', new THREE.Vector3(0, corniceY + CORNICE_T, frontZ - 0.9)));
  }

  // --- 5. roof ------------------------------------------------------------
  const roofKind = pickRoofKind(floors, ch);
  const roof = buildRoof(roofKind, roofW, roofD, { rr, ch }, zincMat, slateMat, dressMat);
  roof.group.position.set(0, roofBaseY, frontZ - roofD / 2 - (roofW === width ? 0 : 0.25));
  group.add(roof.group);

  const roofTopY = roofBaseY + roof.topH;
  const roofFrontZ = roof.group.position.z + roofD / 2;

  // --- dormers ------------------------------------------------------------
  // Only the sloped roofs get them; you cannot punch a dormer through a flat
  // deck, and a flat deck gets a stair house instead (built by buildRoof).
  if (roof.dormerable) {
    const dormerCount = Math.max(1, Math.floor(bays / 2));
    for (let i = 0; i < dormerCount; i++) {
      const x = -roofW / 2 + (roofW / (dormerCount + 1)) * (i + 1);
      const dz = roofFrontZ - roof.dormerInset;
      const dormer = buildDormer(zincMat, glassMat, slateMat);
      dormer.position.set(x, roofBaseY + roof.dormerY, dz);
      group.add(dormer);
      anchors.push(anchor('dormer',
        new THREE.Vector3(x, roofBaseY + roof.dormerY + 0.15, dz + 0.5)));
    }
  }

  // The roof anchor: for a flat deck put the sniper at the front parapet where
  // he can actually see down into the street, not in the middle of the roof.
  anchors.push(anchor('roof', roofKind === 'flat'
    ? new THREE.Vector3(0, roofTopY - 0.5, roofFrontZ - 1.2)
    : new THREE.Vector3(0, roofTopY, roof.group.position.z)));

  // Chimney stacks with terracotta pots. Montmartre rooflines are bristling
  // with these and they are most of what the skyline silhouette is made of.
  const stacks = 1 + (ch(0.55) ? 1 : 0);
  for (let i = 0; i < stacks; i++) {
    const cx = (rr(0, 1) - 0.5) * roofW * 0.6;
    const cz = roof.group.position.z + (rr(0, 1) - 0.5) * roofD * 0.35;
    group.add(buildChimney(roofBaseY + roof.stackBaseH, cx, cz, rr));
  }

  // --- 6. the party wall --------------------------------------------------
  addPartyWall(group, {
    width, depth, frontZ, topY: roofTopY, rr, ch,
  });

  group.userData.height = roofTopY;
  return { group, anchors };
}

function anchor(type, pos) {
  return { id: `a${_anchorId++}`, type, localPos: pos.clone() };
}

/** A string course / bandeau: one box wrapped round the whole wall. */
function band(width, depth, y, thickness, projection, mat) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(width + projection * 2, thickness, depth + projection * 2), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

/**
 * A window: recessed glass, a stone surround proud of the wall, a projecting
 * sill, optionally a keystone, shutters folded back, and sometimes a
 * jardinière.
 *
 * The sill is the important one. It is the only horizontal in the composition
 * that sticks out far enough to throw a shadow down the wall under it, and
 * with the sun at 11.5° that shadow is long. Twenty of them per building is
 * what stops a flat-shaded wall being a flat shaded wall.
 */
function addWindow(group, x, y, frontZ, bayW, o) {
  const { glassMat, ironMat, dressMat, shutterMat, shutters, keystone, box, ch, rr } = o;
  const w = Math.min(1.15, bayW * 0.46), h = 1.75;

  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), glassMat);
  glass.position.set(x, y, frontZ - 0.05);
  group.add(glass);

  // Stone surround, slightly proud — this is what catches the raking sun and
  // gives a flat wall its relief without any texture at all.
  const surround = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.26, h + 0.26, 0.09), dressMat);
  surround.position.set(x, y, frontZ + 0.02);
  surround.castShadow = true;
  group.add(surround);

  const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.46, 0.14, 0.24), dressMat);
  sill.position.set(x, y - h / 2 - 0.16, frontZ + 0.09);
  sill.castShadow = true;
  group.add(sill);

  if (keystone) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.16), dressMat);
    key.position.set(x, y + h / 2 + 0.14, frontZ + 0.09);
    key.castShadow = true;
    group.add(key);
  }

  if (shutters) {
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, h, 0.07), shutterMat);
      sh.position.set(x + s * (w * 0.72), y, frontZ + 0.08);
      sh.castShadow = true;
      group.add(sh);
    }
  }

  if (box) {
    // Jardinière on the sill. Two clumps, not one, so the flat shading has an
    // edge between them and it does not read as a green brick.
    const trough = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.2, 0.26),
      flat(PALETTE.chimneyTerra, { roughness: 0.9 }));
    trough.position.set(x, y - h / 2 - 0.05, frontZ + 0.18);
    trough.castShadow = true;
    group.add(trough);
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(0.17, 0.24), 0),
        flat(ch(0.5) ? PALETTE.foliageMid : PALETTE.foliageSun, { roughness: 1 }));
      leaf.position.set(x + s * w * 0.3, y - h / 2 + 0.1, frontZ + 0.2);
      leaf.castShadow = true;
      group.add(leaf);
    }
  }
  void ironMat;
}

/** Wrought iron balcony: stone plate, top rail, vertical balusters. */
function buildBalcony(width, ironMat, dressMat) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 0.82), dressMat);
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

// ===========================================================================
//  ROOFS
// ===========================================================================

/**
 * Which roof this plot got.
 *
 * Low houses on the lanes are the old village fabric and are gabled; the
 * taller terraces are 19th-century and are mansarded; the flat decks are the
 * post-war infill on the bomb-and-demolition plots, and they are the ones that
 * leave their neighbours' firewalls standing naked.
 */
function pickRoofKind(floors, ch) {
  if (floors <= 3) {
    if (ch(0.34)) return 'gable';
    if (ch(0.22)) return 'gableEnd';
    if (ch(0.25)) return 'flat';
    return 'mansard';
  }
  if (ch(0.52)) return 'mansard';
  if (ch(0.38)) return 'gable';
  return 'flat';
}

/**
 * @returns {{group: THREE.Group, topH: number, dormerable: boolean,
 *            dormerY: number, dormerInset: number, stackBaseH: number}}
 * All heights are relative to the roof's own base.
 */
function buildRoof(kind, width, depth, { rr, ch }, zincMat, slateMat, dressMat) {
  const g = new THREE.Group();
  // Zinc on most of Paris, slate on the older and steeper roofs. Both sit on
  // the cool side of the palette, which is what keeps the roofscape reading as
  // a single violet mass against the amber walls.
  const cover = ch(0.72) ? zincMat : slateMat;

  if (kind === 'flat') {
    const PAR = rr(0.62, 1.15);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, depth), cover);
    deck.position.y = 0.09;
    deck.receiveShadow = true;
    g.add(deck);
    // Parapet as four rails rather than a solid box, so the deck behind it is
    // visible from the upper windows across the street and a sniper on it is
    // legible as a man behind a wall.
    for (const [sx, sz, w, d] of [
      [0, depth / 2 - 0.14, width, 0.28],
      [0, -depth / 2 + 0.14, width, 0.28],
      [width / 2 - 0.14, 0, 0.28, depth],
      [-width / 2 + 0.14, 0, 0.28, depth],
    ]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, PAR, d), dressMat);
      p.position.set(sx, PAR / 2, sz);
      p.castShadow = true;
      g.add(p);
    }
    // The stair house — every flat Paris roof has one and it is the only thing
    // that gives a flat roof any silhouette at all.
    const hut = new THREE.Mesh(new THREE.BoxGeometry(rr(1.8, 2.6), rr(1.7, 2.3), rr(1.6, 2.2)),
      flat(PALETTE.plasterGrey, { roughness: 0.92 }));
    hut.position.set(rr(-width * 0.2, width * 0.2), 1.1, -depth * rr(0.05, 0.2));
    hut.castShadow = true;
    g.add(hut);
    return { group: g, topH: PAR, dormerable: false, dormerY: 0, dormerInset: 0, stackBaseH: 0.18 };
  }

  if (kind === 'mansard') {
    const h = rr(2.05, 3.5);
    const inset = rr(0.5, 0.72);
    g.add(mansardMesh(width, depth, h, inset, cover));
    return {
      group: g, topH: h, dormerable: true,
      dormerY: h * 0.42, dormerInset: h * 0.34 * (1 - inset) * 2.2, stackBaseH: h,
    };
  }

  // Gabled. 'gable' runs the ridge along the street, so you see a long slope
  // and a triangular flank at the party wall; 'gableEnd' turns the ridge into
  // the street, so the house presents a gable to the pavement. The second is
  // the old village house type and is why the lanes off Lepic do not look like
  // a terrace at all.
  const h = rr(2.5, 4.3);
  g.add(gableMesh(width, depth, h, kind === 'gableEnd', cover));
  return {
    group: g, topH: h, dormerable: kind === 'gable',
    dormerY: h * 0.38, dormerInset: depth * 0.5 * 0.42, stackBaseH: h * 0.78,
  };
}

/** The mansard: a truncated pyramid in zinc. */
function mansardMesh(width, depth, h, inset, mat) {
  const g = new THREE.BufferGeometry();
  const bw = width / 2, bd = depth / 2;
  const tw = bw * inset, td = bd * inset;
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

/** A pitched roof. `perp` turns the ridge to face the street. */
function gableMesh(width, depth, h, perp, mat) {
  const bw = width / 2, bd = depth / 2;
  let v, idx;
  if (!perp) {
    // Ridge along X, at z = 0.
    v = [
      -bw, 0, bd,  bw, 0, bd,  bw, 0, -bd,  -bw, 0, -bd,
      -bw, h, 0,   bw, h, 0,
    ];
    idx = [
      0, 1, 5, 0, 5, 4,   // street slope
      2, 3, 4, 2, 4, 5,   // back slope
      3, 0, 4,            // left gable
      1, 2, 5,            // right gable
    ];
  } else {
    // Ridge along Z, at x = 0: a gable facing the pavement.
    v = [
      -bw, 0, bd,  bw, 0, bd,  bw, 0, -bd,  -bw, 0, -bd,
      0, h, bd,    0, h, -bd,
    ];
    idx = [
      0, 1, 4,            // street gable
      2, 3, 5,            // back gable
      1, 2, 5, 1, 5, 4,   // right slope
      3, 0, 4, 3, 4, 5,   // left slope
    ];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A roof dormer — small gabled box punched through the slope. */
function buildDormer(zincMat, glassMat, slateMat) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.9), zincMat);
  box.castShadow = true;
  g.add(box);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.08), glassMat);
  glass.position.z = 0.46;
  g.add(glass);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.82, 0.42, 4), slateMat);
  cap.position.y = 0.72;
  cap.rotation.y = Math.PI / 4;
  cap.castShadow = true;
  g.add(cap);
  return g;
}

/** Chimney stack and its terracotta pots. */
function buildChimney(baseY, x, z, rr) {
  const g = new THREE.Group();
  const h = 1.1 + rr(0, 1.1);
  const w = 0.7 + rr(0, 0.5);
  const stack = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7),
    flat(PALETTE.plasterGrey, { roughness: 0.92 }));
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

// ===========================================================================
//  THE PARTY WALL
// ===========================================================================

/**
 * The mur mitoyen / mur pignon at the left-hand plot boundary.
 *
 * WHY IT IS BUILT ON ONE SIDE ONLY. Every building in the row builds the wall
 * on its own left edge, so each boundary between two neighbours gets exactly
 * one wall and there is no coplanar pair to z-fight. It is deliberately
 * thicker than a real party wall (~0.85 m against ~0.5 m) because the world
 * builder leaves a 0.2-1.1 m gap between neighbouring plots, and the wall has
 * to bridge that gap or the terrace reads as a row of detached boxes with
 * daylight between them.
 *
 * WHY IT STANDS PROUD OF ITS OWN ROOF. That is what a firewall is for — it
 * carries up past the roof covering to stop fire crossing the boundary. The
 * visual consequence is the thing we actually want: a blade of blank rendered
 * wall standing above the roofscape at every plot line, and wherever the
 * neighbour turns out to be lower, the whole flank of the taller house is
 * exposed as a plain cement-rendered wall. Half of Montmartre is that view.
 *
 * The render is a duller, greyer tone than the front, because a flank was
 * never a display face — it got cement, not dressed limestone.
 */
function addPartyWall(group, { width, depth, frontZ, topY, rr, ch }) {
  const THICK = 0.85;
  const x = -width / 2 - 0.12;
  const renderMat = flat(ch(0.5) ? PALETTE.plasterGrey : PALETTE.limestoneDeep,
    { roughness: 0.92 });
  const copeMat = flat(PALETTE.zincLit, { roughness: 0.55, metalness: 0.3 });

  // Profile front-to-back. A stepped top is the ghost of a lower neighbour's
  // pitched roof, left behind when it was demolished or never built as high —
  // the single most Montmartre thing a blank wall can do.
  const stepped = ch(0.38);
  const runs = stepped
    ? [
        { frac: 0.42, top: topY + rr(0.3, 0.8) },
        { frac: 0.32, top: topY - rr(0.6, 1.6) },
        { frac: 0.26, top: topY - rr(2.0, 3.4) },
      ]
    : [{ frac: 1.0, top: topY + rr(0.25, 0.75) }];

  let z = frontZ + 0.1;
  for (const run of runs) {
    const len = depth * 0.92 * run.frac;
    const h = Math.max(3, run.top);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(THICK, h, len), renderMat);
    slab.position.set(x, h / 2, z - len / 2);
    slab.castShadow = slab.receiveShadow = true;
    group.add(slab);

    // Zinc coping over the head of the wall. It is a cool stripe along the top
    // of a warm wall, which is what makes the blade read as a blade.
    const cope = new THREE.Mesh(new THREE.BoxGeometry(THICK + 0.18, 0.14, len), copeMat);
    cope.position.set(x, h + 0.07, z - len / 2);
    cope.castShadow = true;
    group.add(cope);

    // The flank is the biggest single surface the player ever looks at, and a
    // bare slab of it reads as an untextured box — it was filling a quarter of
    // the opening frame and doing nothing. A real exposed Montmartre firewall
    // is never blank, so give it the four things it actually carries.
    addFlankRelief(group, { x, thick: THICK, height: h, zFar: z - len, zNear: z, rr, ch, renderMat });

    z -= len;
  }
}

/**
 * What an exposed party wall actually has on it.
 *
 * FLUE LINES. Chimneys were built into the boundary wall, so when the
 * neighbour came down the flues stayed as shallow vertical pilasters running
 * the full height. They are the most recognisable marking on any Paris
 * firewall and they are pure vertical rhythm, which is exactly what a blank
 * slab is missing.
 *
 * RENDER PATCHES. Cement render gets repaired in blocks and the patches never
 * match. Two or three rectangles a shade off the base tone turn a flat plane
 * into a surface with history.
 *
 * THE GHOST SIGN. A mur peint — a painted advertisement, sun-bleached to
 * nearly nothing. Montmartre has dozens. This is the single highest-value
 * detail on the whole wall: it is large, it is high-contrast, it reads from
 * the far end of the street, and it is unmistakably Paris. Deliberately NOT on
 * every wall, because their rarity is what makes them land.
 *
 * THE DOWNPIPE. A cast-iron rainwater pipe down one edge, with its hopper
 * head. Thin, dark, vertical, and it catches the low sun on one side.
 */
function addFlankRelief(group, { x, thick, height, zFar, zNear, rr, ch, renderMat }) {
  const depth = Math.abs(zNear - zFar);
  if (depth < 2 || height < 4) return;
  const midZ = (zNear + zFar) / 2;
  // Face outward, away from the building this wall belongs to.
  const faceX = x - thick / 2 - 0.03;

  // --- flue lines ---------------------------------------------------------
  const flues = Math.max(1, Math.round(depth / 4.5));
  for (let i = 0; i < flues; i++) {
    const z = zNear - (depth / (flues + 1)) * (i + 1);
    const w = rr(0.55, 0.95);
    const h = height * rr(0.72, 0.97);
    const flue = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, w), renderMat);
    flue.position.set(faceX, h / 2, z);
    flue.castShadow = true;
    group.add(flue);
    // The flue terminates in a small stack above the coping.
    if (ch(0.55)) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(0.42, rr(0.5, 1.0), w * 0.8),
        flat(PALETTE.plasterGrey, { roughness: 0.95 }));
      stack.position.set(x, height + stack.geometry.parameters.height / 2, z);
      stack.castShadow = true;
      group.add(stack);
    }
  }

  // --- render patches -----------------------------------------------------
  const patchTones = [PALETTE.plasterGrey, PALETTE.limestoneDeep, PALETTE.limestoneMid];
  for (let i = 0; i < 2 + (ch(0.5) ? 1 : 0); i++) {
    const pw = rr(1.4, 3.2), ph = rr(1.2, 3.0);
    if (pw > depth * 0.8) continue;
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, ph, pw),
      flat(patchTones[Math.floor(rr(0, patchTones.length)) % patchTones.length],
        { roughness: 0.95 }));
    patch.position.set(faceX - 0.02,
      rr(1.0, Math.max(1.2, height - ph)),
      zNear - rr(pw / 2, Math.max(pw / 2 + 0.1, depth - pw / 2)));
    group.add(patch);
  }

  // --- the ghost sign -----------------------------------------------------
  if (height > 8 && depth > 6 && ch(0.34)) {
    const sw = depth * rr(0.45, 0.7);
    const sh = Math.min(height * 0.42, rr(2.6, 4.6));
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, sh, sw),
      flat(ch(0.5) ? PALETTE.limestoneLit : PALETTE.plasterCream, { roughness: 0.98 }));
    panel.position.set(faceX - 0.04, height * rr(0.5, 0.68), midZ);
    group.add(panel);

    // Lettering, reduced to bars of varying length and weight.
    //
    // Three evenly-spaced bars of similar length do not read as a faded
    // advertisement — they read as three stripes, which is what the first
    // version produced and it looked like a rendering error. Real ghost signs
    // have a big word, a smaller line under it, and a scatter of tiny text,
    // and it is that VARIATION in weight and length that says "text" rather
    // than the marks themselves. They are also barely lighter than the render
    // behind them; a sun-bleached mur peint is almost gone.
    const lineColor = ch(0.5) ? PALETTE.limestoneDeep : PALETTE.chimneyTerra;
    const rows = [
      { h: 0.34, w: 0.78 },   // the big word
      { h: 0.17, w: 0.56 },   // a second line
      { h: 0.10, w: 0.84 },   // small print
      { h: 0.10, w: 0.34 },
    ];
    let cursor = panel.position.y + sh * 0.34;
    for (const row of rows) {
      const lh = sh * row.h * 0.5;
      const lw = sw * row.w * rr(0.86, 1.0);
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, lh, lw),
        flat(lineColor, { roughness: 0.98, transparent: true, opacity: 0.55 }));
      bar.position.set(faceX - 0.06, cursor, midZ + rr(-sw * 0.04, sw * 0.04));
      group.add(bar);
      cursor -= lh * 1.8;
      if (cursor < panel.position.y - sh * 0.45) break;
    }
  }

  // --- downpipe -----------------------------------------------------------
  const pipeZ = zNear - rr(0.4, 1.2);
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, height * 0.95, 6),
    flat(PALETTE.ironwork, { roughness: 0.6, metalness: 0.3 }));
  pipe.position.set(faceX - 0.09, height * 0.475, pipeZ);
  pipe.castShadow = true;
  group.add(pipe);
  const hopper = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.34, 0.26),
    flat(PALETTE.ironwork, { roughness: 0.6, metalness: 0.3 }));
  hopper.position.set(faceX - 0.09, height * 0.93, pipeZ);
  hopper.castShadow = true;
  group.add(hopper);
}

// ===========================================================================
//  QUOINS, PIPES, LAMPS, IVY
// ===========================================================================

function addQuoins(group, width, frontZ, baseY, topY, mat, rr) {
  // Alternating long and short blocks, 0.5 m courses, one block every other
  // course. That alternation is the whole point — an unbroken pilaster would
  // read as a column, not as stonework.
  const COURSE = 0.52;
  const n = Math.floor((topY - baseY - 0.3) / (COURSE * 2));
  for (let s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const long = i % 2 === 0;
      const w = long ? 0.92 : 0.58;
      const blk = new THREE.Mesh(new THREE.BoxGeometry(w, COURSE, 0.13), mat);
      blk.position.set(s * (width / 2 - w / 2 - 0.03), baseY + 0.2 + i * COURSE * 2 + COURSE / 2,
        frontZ + 0.065);
      blk.castShadow = true;
      group.add(blk);
    }
  }
  void rr;
}

function addDownpipe(group, width, frontZ, baseY, topY, ironMat, ch, rr) {
  const s = ch(0.5) ? -1 : 1;
  const x = s * (width / 2 - rr(0.25, 0.5));
  const h = topY - baseY;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, h, 6), ironMat);
  pipe.position.set(x, baseY + h / 2, frontZ + 0.11);
  pipe.castShadow = true;
  group.add(pipe);
  // The hopper head where the gutter discharges into it — a chunky box that
  // reads from the street and tells you what the thin line is.
  const hopper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.24), ironMat);
  hopper.position.set(x, topY - 0.3, frontZ + 0.13);
  hopper.castShadow = true;
  group.add(hopper);
}

function addWallLamp(group, width, frontZ, y, ironMat, rr, ch) {
  const x = (ch(0.5) ? -1 : 1) * width * rr(0.18, 0.36);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.62), ironMat);
  arm.position.set(x, y, frontZ + 0.33);
  arm.castShadow = true;
  group.add(arm);
  const stay = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), ironMat);
  stay.position.set(x, y - 0.2, frontZ + 0.08);
  group.add(stay);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.42, 6),
    flat(PALETTE.guimardAmber, { roughness: 0.25, metalness: 0.1 }));
  lantern.position.set(x, y - 0.22, frontZ + 0.62);
  lantern.castShadow = true;
  group.add(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 6), ironMat);
  cap.position.set(x, y + 0.05, frontZ + 0.62);
  group.add(cap);
}

function addIvy(group, width, frontZ, baseY, topY, rr, ch) {
  const s = ch(0.5) ? -1 : 1;
  const x = s * (width / 2 - rr(0.4, 1.0));
  const climb = Math.min(topY - baseY, rr(3.5, 7.0));
  const n = Math.max(3, Math.round(climb / 1.2));
  for (let i = 0; i < n; i++) {
    const r = rr(0.55, 0.95);
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0),
      flat(ch(0.5) ? PALETTE.ivyGreen : PALETTE.foliageDeep, { roughness: 1 }));
    blob.position.set(x + rr(-0.5, 0.5), baseY + 0.4 + (climb / n) * i, frontZ + 0.14);
    // Squashed against the wall: ivy is a skin, not a bush.
    blob.scale.z = 0.3;
    blob.rotation.set(rr(0, 3), rr(0, 3), rr(0, 3));
    blob.castShadow = true;
    group.add(blob);
  }
}

// ===========================================================================
//  GROUND FLOORS
// ===========================================================================

/** The shared parts of any shopfront: glass, a fascia board, an awning. */
function shopShell(ctx, awningColor, fasciaColor) {
  const { group, width, frontZ, SOCLE_H, GROUND_H, rr, ch, glassMat } = ctx;

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.84, GROUND_H * 0.58, 0.14), glassMat);
  glass.position.set(0, SOCLE_H + GROUND_H * 0.46, frontZ + 0.04);
  group.add(glass);

  // Shop joinery: the painted timber pilasters and the fascia above the glass.
  // A Paris shopfront is a frame inside the arcade of the building, and it is
  // the frame — not the glass — that you read from across the street.
  const fasciaMat = flat(fasciaColor, { roughness: 0.8 });
  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.9, GROUND_H * 0.2, 0.18), fasciaMat);
  fascia.position.set(0, SOCLE_H + GROUND_H * 0.85, frontZ + 0.09);
  fascia.castShadow = true;
  group.add(fascia);
  for (const s of [-1, 1]) {
    const pil = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, GROUND_H * 0.95, 0.2), fasciaMat);
    pil.position.set(s * width * 0.44, SOCLE_H + GROUND_H * 0.47, frontZ + 0.1);
    pil.castShadow = true;
    group.add(pil);
  }

  const ac = awningColor ?? (ch(0.5) ? PALETTE.awningRed : PALETTE.awningGreen);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.12, 1.55),
    flat(ac, { roughness: 0.95 }));
  awning.position.set(0, SOCLE_H + GROUND_H * 0.74, frontZ + 0.8);
  awning.rotation.x = -0.19;
  awning.castShadow = true;
  group.add(awning);
  // The valance hanging off the front edge of the awning: a second bold band
  // of the accent colour, and the piece that actually catches the eye.
  const valance = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.3, 0.06),
    flat(ac, { roughness: 0.95 }));
  valance.position.set(0, SOCLE_H + GROUND_H * 0.74 - 0.3, frontZ + 1.55);
  valance.castShadow = true;
  group.add(valance);

  // Projecting bracket sign. Perpendicular to the wall, so it is the one piece
  // of the shopfront you can read looking down the street rather than at it —
  // which, on a rail, is the direction the player is looking most of the time.
  const armY = SOCLE_H + GROUND_H * 1.02;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.85),
    flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.35 }));
  arm.position.set(width * 0.3, armY, frontZ + 0.45);
  group.add(arm);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.78),
    flat(ch(0.5) ? PALETTE.signWhite : PALETTE.awningCream, { roughness: 0.85 }));
  board.position.set(width * 0.3, armY - 0.36, frontZ + 0.8);
  board.castShadow = true;
  group.add(board);

  void rr;
}

/** A shop door anchor, offset to one side of the frontage. */
function shopDoor(ctx, xFrac = 0.3) {
  const { group, anchors, width, frontZ, SOCLE_H, GROUND_H } = ctx;
  const x = width * xFrac;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, GROUND_H * 0.72, 0.12),
    flat(PALETTE.shutterGreen, { roughness: 0.75 }));
  door.position.set(x, SOCLE_H + GROUND_H * 0.36, frontZ + 0.09);
  door.castShadow = true;
  group.add(door);
  anchors.push(anchor('door', new THREE.Vector3(x, SOCLE_H, frontZ + 0.5)));
}

function addShopfront(ctx, awningColor) {
  const { ch } = ctx;
  shopShell(ctx, awningColor, ch(0.5) ? PALETTE.shutterGreen : PALETTE.shutterBlue);
  shopDoor(ctx, 0.3);
}

/**
 * Boulangerie. The tell is the stall: a tiled counter run out under the window
 * with the bread on it, which is what a Paris bakery does with its frontage and
 * what nothing else on the street does.
 */
function addBoulangerie(ctx, awningColor) {
  const { group, width, frontZ, rr, ch } = ctx;
  // Bakery fascias are the ochre-and-gold ones; the awning goes red.
  shopShell(ctx, awningColor ?? PALETTE.awningRed, PALETTE.plasterOchre);
  shopDoor(ctx, 0.3);

  const stallW = Math.min(width * 0.5, 3.0);
  const x = -width * 0.18;
  const z = frontZ + 0.62;

  // Tiled front — alternating cream and pink faience, which is exactly the
  // tiling on half the bakeries in the 18th.
  const tiles = Math.max(4, Math.round(stallW / 0.55));
  for (let i = 0; i < tiles; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(stallW / tiles * 0.96, 0.78, 0.5),
      flat(i % 2 === 0 ? PALETTE.plasterCream : PALETTE.plasterPink, { roughness: 0.75 }));
    t.position.set(x - stallW / 2 + (stallW / tiles) * (i + 0.5), PAVE_Y + 0.39, z);
    t.castShadow = true;
    group.add(t);
  }
  // The counter top, tilted toward the customer.
  const top = new THREE.Mesh(new THREE.BoxGeometry(stallW + 0.16, 0.1, 0.76),
    flat(PALETTE.limestoneLit, { roughness: 0.7 }));
  top.position.set(x, PAVE_Y + 0.84, z + 0.05);
  top.rotation.x = 0.16;
  top.castShadow = true;
  group.add(top);
  // Crates of loaves. Chunky blocks, because a baguette at 20 m is one pixel.
  for (let i = 0; i < 3; i++) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(stallW / 3.4, rr(0.2, 0.32), 0.5),
      flat(ch(0.5) ? PALETTE.plasterOchre : PALETTE.limestoneMid, { roughness: 0.95 }));
    crate.position.set(x - stallW / 3 + (stallW / 3) * i, PAVE_Y + 1.02, z + 0.06);
    crate.castShadow = true;
    group.add(crate);
  }
}

/**
 * Bar-tabac. The carrot — the red double-cone hanging off the wall over the
 * pavement — is the single most identifiable object on a French street and it
 * is worth five meshes on its own.
 */
function addBarTabac(ctx) {
  const { group, width, frontZ, SOCLE_H, GROUND_H, rr, ch } = ctx;
  shopShell(ctx, PALETTE.awningRed, PALETTE.awningRed);
  shopDoor(ctx, -0.3);

  const cx = width * 0.34;
  const cy = SOCLE_H + GROUND_H + 0.55;
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.55),
    flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.35 }));
  bracket.position.set(cx, cy, frontZ + 0.3);
  group.add(bracket);
  const carrotMat = flat(PALETTE.awningRed, { roughness: 0.55 });
  for (const s of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.58, 8), carrotMat);
    cone.position.set(cx, cy + s * 0.29, frontZ + 0.62);
    cone.rotation.z = s > 0 ? 0 : Math.PI;
    cone.castShadow = true;
    group.add(cone);
  }
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 8), carrotMat);
  waist.position.set(cx, cy, frontZ + 0.62);
  group.add(waist);

  addTerrace(ctx, 2, -width * 0.2, rr, ch);
}

function addRestaurant(ctx, awningColor) {
  const { width, rr, ch } = ctx;
  shopShell(ctx, awningColor ?? PALETTE.awningGreen, PALETTE.shutterGreen);
  shopDoor(ctx, 0.32);
  addTerrace(ctx, 3, -width * 0.1, rr, ch);
  addABoard(ctx, -width * 0.38, rr, ch);
}

/**
 * Pavement tables. They sit within 2.0 m of the façade because the pavement is
 * only 2.4 m wide here (see street.js) and a table in the carriageway would be
 * a table the camera drives through.
 */
function addTerrace(ctx, tables, x0, rr, ch) {
  const { group, frontZ } = ctx;
  const topMat = flat(PALETTE.limestoneLit, { roughness: 0.6 });
  const legMat = flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.35 });
  const chairCols = [PALETTE.awningRed, PALETTE.awningCream, PALETTE.shutterGreen];

  for (let i = 0; i < tables; i++) {
    const x = x0 + i * 1.5;
    const z = frontZ + 1.35;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.07, 8), topMat);
    top.position.set(x, PAVE_Y + 0.72, z);
    top.castShadow = true;
    group.add(top);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.17, 0.72, 6), legMat);
    stem.position.set(x, PAVE_Y + 0.36, z);
    group.add(stem);

    // One or two rattan bistro chairs, turned out to face the street — which is
    // how they are always left, because in Paris you sit facing the pavement.
    const nChairs = ch(0.5) ? 2 : 1;
    for (let c = 0; c < nChairs; c++) {
      const col = flat(chairCols[(i + c) % 3], { roughness: 0.85 });
      const cxp = x + (c === 0 ? -0.55 : 0.55);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.42), col);
      seat.position.set(cxp, PAVE_Y + 0.23, z - 0.1);
      seat.castShadow = true;
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.08), col);
      back.position.set(cxp, PAVE_Y + 0.7, z - 0.28);
      back.castShadow = true;
      group.add(back);
    }
  }
  void rr;
}

function addABoard(ctx, x, rr, ch) {
  const { group, frontZ } = ctx;
  const mat = flat(PALETTE.slateDark, { roughness: 0.9 });
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.05), mat);
    leaf.position.set(x, PAVE_Y + 0.5, frontZ + 0.75 + s * 0.14);
    leaf.rotation.x = s * 0.16;
    leaf.castShadow = true;
    group.add(leaf);
  }
  void rr; void ch;
}

/**
 * A unit that has been shut for years: the corrugated roller shutter down to
 * the pavement, and nothing else. Every street on the Butte has one and its
 * blankness is what makes the busy frontages either side read as busy.
 * It publishes no door anchor — deliberately. A shut shop is shut.
 */
function addShuttered(ctx, wasShop) {
  const { group, width, frontZ, SOCLE_H, GROUND_H, ch, rr } = ctx;
  const w = wasShop ? width * 0.82 : Math.min(width * 0.6, 3.2);
  const h = GROUND_H * 0.8;
  const mat = flat(ch(0.5) ? PALETTE.shutterGrey : PALETTE.shutterBlue, { roughness: 0.7 });

  const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), mat);
  panel.position.set(0, SOCLE_H + h / 2, frontZ + 0.07);
  panel.castShadow = true;
  group.add(panel);
  // The corrugations. Five ribs, not fifty: at 20 m five ribs read as a roller
  // shutter and fifty read as grey.
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.2), mat);
    rib.position.set(0, SOCLE_H + h * (0.13 + i * 0.18), frontZ + 0.1);
    rib.castShadow = true;
    group.add(rib);
  }
  const boxTop = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.34, 0.3),
    flat(PALETTE.limestoneDeep, { roughness: 0.9 }));
  boxTop.position.set(0, SOCLE_H + h + 0.17, frontZ + 0.13);
  boxTop.castShadow = true;
  group.add(boxTop);
  void rr;
}

/**
 * A garage door — a wide flush shutter in the terrace. There are far more of
 * these on the Butte than tourists notice, usually where a courtyard workshop
 * used to be. An enemy can absolutely come out of one, so it anchors.
 */
function addGarage(ctx) {
  const { group, anchors, width, frontZ, SOCLE_H, GROUND_H, socleMat, ch, rr } = ctx;
  const w = Math.min(width * 0.62, 4.0);
  const h = GROUND_H * 0.76;
  const mat = flat(ch(0.5) ? PALETTE.shutterBlue : PALETTE.shutterGreen, { roughness: 0.72 });

  const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), mat);
  door.position.set(0, SOCLE_H + h / 2, frontZ + 0.06);
  door.castShadow = true;
  group.add(door);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.09, 0.22), mat);
    rib.position.set(0, SOCLE_H + h * (0.18 + i * 0.22), frontZ + 0.1);
    rib.castShadow = true;
    group.add(rib);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.3, 0.3), socleMat);
  lintel.position.set(0, SOCLE_H + h + 0.15, frontZ + 0.12);
  lintel.castShadow = true;
  group.add(lintel);
  anchors.push(anchor('door', new THREE.Vector3(0, SOCLE_H, frontZ + 0.55)));

  // Bollards either side, to stop people parking across it. Very Paris.
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 6),
      flat(PALETTE.ironwork, { roughness: 0.45, metalness: 0.35 }));
    b.position.set(s * (w / 2 + 0.5), PAVE_Y + 0.45, frontZ + 1.3);
    b.castShadow = true;
    group.add(b);
  }
  void rr;
}

/** The porte cochère: tall dark double doors under a keyed stone surround. */
function addPorteCochere(ctx) {
  const {
    group, anchors, width, frontZ, bays, bayW, SOCLE_H, GROUND_H,
    socleMat, dressMat, glassMat, ironMat, ch, rr,
  } = ctx;

  const doorW = Math.min(2.3, bayW * 0.85), doorH = GROUND_H * 0.8;
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.16),
    flat(ch(0.5) ? PALETTE.shutterGreen : PALETTE.ironwork, { roughness: 0.7 }));
  door.position.set(0, SOCLE_H + doorH / 2, frontZ + 0.03);
  group.add(door);

  // Jambs and a keyed lintel. A carriage door in a rendered wall is nothing
  // without its dressed stone surround — that frame is the whole gesture.
  for (const s of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.3, doorH + 0.3, 0.2), dressMat);
    jamb.position.set(s * (doorW / 2 + 0.15), SOCLE_H + (doorH + 0.3) / 2, frontZ + 0.08);
    jamb.castShadow = true;
    group.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.6, 0.26, 0.22), socleMat);
  lintel.position.set(0, SOCLE_H + doorH + 0.13, frontZ + 0.09);
  lintel.castShadow = true;
  group.add(lintel);
  const key = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.2), dressMat);
  key.position.set(0, SOCLE_H + doorH + 0.18, frontZ + 0.12);
  key.castShadow = true;
  group.add(key);

  anchors.push(anchor('door', new THREE.Vector3(0, SOCLE_H, frontZ + 0.4)));

  // Ground-floor windows either side of the door, barred at street level.
  for (let b = 0; b < bays; b++) {
    const x = -width / 2 + bayW * (b + 0.5);
    if (Math.abs(x) < doorW * 0.8) continue;
    const w = Math.min(1.1, bayW * 0.44);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, 0.1), glassMat);
    glass.position.set(x, SOCLE_H + GROUND_H * 0.55, frontZ - 0.05);
    group.add(glass);
    const sur = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 1.78, 0.09), dressMat);
    sur.position.set(x, SOCLE_H + GROUND_H * 0.55, frontZ + 0.02);
    sur.castShadow = true;
    group.add(sur);
    // Ground-floor grilles: three fat bars, which is all that survives a 20 m
    // read anyway.
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), ironMat);
      bar.position.set(x - w * 0.3 + i * w * 0.3, SOCLE_H + GROUND_H * 0.55, frontZ + 0.09);
      group.add(bar);
    }
  }

  // A wall-mounted flower trough beside the door, and the bin store that in
  // real life is always jammed in next to a carriage entrance.
  if (ch(0.35)) {
    const tx = doorW / 2 + rr(0.7, 1.3);
    const trough = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.3, 0.32),
      flat(PALETTE.chimneyTerra, { roughness: 0.9 }));
    trough.position.set(tx, SOCLE_H + 1.25, frontZ + 0.2);
    trough.castShadow = true;
    group.add(trough);
    for (let i = 0; i < 2; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(0.2, 0.3), 0),
        flat(i === 0 ? PALETTE.foliageSun : PALETTE.foliageMid, { roughness: 1 }));
      leaf.position.set(tx - 0.25 + i * 0.5, SOCLE_H + 1.5, frontZ + 0.22);
      leaf.castShadow = true;
      group.add(leaf);
    }
  }
}


/**
 * Openings and relief on the two side elevations.
 *
 * The string course matters more than the windows. A horizontal band at every
 * floor level catches the low sun along its whole length and gives the flank a
 * scale and a rhythm; without one, no number of small windows stops a large
 * wall reading as a slab.
 */
function addFlankFaces(group, {
  width, depth, floors, socleH, groundH, floorH, wallH, glassMat, ironMat, socleMat, rng,
}) {
  const halfW = width / 2;
  const bays = Math.max(1, Math.floor(depth / 3.6));

  for (const side of [-1, 1]) {
    const x = side * (halfW + 0.02);

    // String course at each floor line, standing slightly proud.
    for (let f = 0; f <= floors; f++) {
      const y = socleH + groundH + f * floorH;
      if (y > socleH + wallH - 0.3) break;
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.16, depth * 0.97),
        flat(PALETTE.limestoneMid, { roughness: 0.9 }));
      band.position.set(x, y, 0);
      band.castShadow = true;
      group.add(band);
    }

    // A plinth course along the base, which is what stops the wall looking
    // like it was dropped onto the pavement.
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.42, depth * 0.99), socleMat);
    plinth.position.set(x, socleH + 0.21, 0);
    plinth.castShadow = true;
    group.add(plinth);

    // Sparse windows: not every bay, and never on the ground floor, which on a
    // flank is almost always blind.
    for (let f = 0; f < floors; f++) {
      const y = socleH + groundH + f * floorH + floorH * 0.52;
      for (let b = 0; b < bays; b++) {
        if (rng() < 0.42) continue;
        const z = -depth / 2 + (depth / bays) * (b + 0.5);
        const w = 0.72, h = 1.35;
        const glass = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, w), glassMat);
        glass.position.set(x, y, z);
        group.add(glass);
        const surround = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, h + 0.2, w + 0.2),
          flat(PALETTE.limestoneMid, { roughness: 0.9 }));
        surround.position.set(x + side * 0.02, y, z);
        surround.castShadow = true;
        group.add(surround);
      }
    }

    // A downpipe running the full height, one per flank. Thin, dark, vertical,
    // and it catches the sun on one side — the cheapest possible way to break
    // a long wall.
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, wallH * 0.96, 6), ironMat);
    pipe.position.set(x + side * 0.08, socleH + wallH * 0.48,
      -depth / 2 + rng() * depth * 0.25 + 0.4);
    pipe.castShadow = true;
    group.add(pipe);
  }
}
