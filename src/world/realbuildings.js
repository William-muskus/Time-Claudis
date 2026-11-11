import * as THREE from 'three';
import { PALETTE } from '../render/palette.js';
import { GEO, groundAt, pairs } from './geo.js';
import { polyOccluder } from './occluders.js';

/**
 * Every building on the route, from the cadastre.
 *
 * WHAT CHANGED. Until October 2026 the street walls were procedural: plots of
 * random width laid along both kerbs, storey counts drawn per district. They
 * were tuned with real care and they were still invented — no building in the
 * game corresponded to a building in Montmartre. This module builds the 1,023
 * footprints of IGN's BD TOPO inside the survey corridor at their measured
 * heights instead. Every wall stands where a wall stands; every roofline is
 * the real roofline, ragged because the real one is.
 *
 * WHAT IS STILL STYLISED, deliberately. The footprints and heights are data.
 * The facade detail — windows, shutters, balconies, cornices, awnings — is
 * generated, because no open source records where the windows are. It is
 * generated FROM the data, though: floor count from the cadastre, wall finish
 * from its material code, shopfronts only where OpenStreetMap has a shop, on
 * the wall that shop stands against. That is the low-poly bargain the brief
 * asked for: Time Crisis geometry, Montmartre ground truth.
 *
 * PERFORMANCE. A thousand buildings as a thousand meshes would be a thousand
 * draw calls. Everything here is accumulated into one vertex-coloured geometry
 * per material family and emitted as five meshes in total. They carry their
 * own vertex colours, so the static batcher (optimize.js) leaves them alone.
 *
 * LEVEL OF DETAIL. Only walls that face a street get any facade at all —
 * decided at build time in tools/geo/build.py by casting from each wall to see
 * whether a street or another building is in front of it. Of those, walls
 * within NEAR_M of the walk get the full kit (sills, shutters, balconies,
 * doors, shopfronts); the rest get glass and nothing else. Measured: that keeps
 * the city inside the triangle budget tests/perf.test.js holds it to.
 */

const NEAR_M = 48;      // full facade detail inside this distance of the rail
const ANCHOR_M = 62;    // spawn anchors are published inside this distance
const OCCLUDE_M = 95;   // occluders kept inside this distance

const WALL = {
  plaster: PALETTE.plasterCream,
  ochre: PALETTE.plasterOchre,
  pink: PALETTE.plasterPink,
  grey: PALETTE.plasterGrey,
  stone: PALETTE.limestoneLit,
  meuliere: PALETTE.limestoneMid,
  // Montmartre's bare brick is the pale buff brick of the 1900-30 blocks
  // (the Pharmacie du Bateau-Lavoir's corner, rue Ravignan), not red; the
  // one red-brick building on the route is Saint-Jean.
  brick: new THREE.Color('#CDB896'),
  redbrick: new THREE.Color('#A0523E'),   // the 1920s brick-and-render blocks, faded
  wood: new THREE.Color('#9C7A5A'),
};
const ROOF = {
  mansard: PALETTE.zincLit,
  hip: new THREE.Color('#A0614A'),     // faded flat tile, on the small houses only
  flat: new THREE.Color('#8F8F8B'),
  church: PALETTE.slateDark,
};
// Louvred shutters on these streets are overwhelmingly white, off-white and
// pale grey (see the August 2025 survey frames on rue d'Orchampt and rue
// Girardon); green and blue-grey are the exceptions, not the rule.
const SHUTTERS = [new THREE.Color('#ECE9E2'), new THREE.Color('#E2DDD2'), PALETTE.shutterGrey,
  new THREE.Color('#ECE9E2'), PALETTE.shutterGrey, new THREE.Color('#D6D2C8'), PALETTE.shutterGreen];
const DOORS = [new THREE.Color('#2F4A3A'), new THREE.Color('#5F7A78'), new THREE.Color('#2E3A5C'),
  new THREE.Color('#4A3A2E'), new THREE.Color('#5B2A28'), PALETTE.metroGreen];
const FRAME = new THREE.Color('#F2EFE8');
const AWNING = {
  cafe: [PALETTE.awningRed, PALETTE.awningGreen, PALETTE.awningRed],
  bar: [PALETTE.awningRed, new THREE.Color('#2E2E3E'), PALETTE.awningGreen],
  restaurant: [PALETTE.awningGreen, new THREE.Color('#7A2E2E'), PALETTE.awningRed],
  bakery: [PALETTE.awningCream, new THREE.Color('#2E4A7A')],
  pharmacy: [new THREE.Color('#2F7A4A')],
  bank: [new THREE.Color('#2E3A5C')],
  shop: [PALETTE.awningRed, PALETTE.awningGreen, PALETTE.awningCream, new THREE.Color('#2E3A5C'),
    PALETTE.plasterOchre, new THREE.Color('#5C2E4A')],
};
// Window glass in daylight reflects the sky and the facade opposite: a mid
// grey, not black. As near-black every window read as a slot cut through
// the wall (compare.mjs, rue d'Orchampt and rue Lepic).
const GLASS = new THREE.Color('#59626B');
// Painted shopfronts ("devantures"), from the survey photos: navy, bottle
// green, black, oxblood, varnished wood, and the odd cream.
const DEVANTURE = [new THREE.Color('#24324A'), new THREE.Color('#233D30'), new THREE.Color('#1E1F21'),
  new THREE.Color('#5A2124'), new THREE.Color('#6B4A32'), new THREE.Color('#24324A'), new THREE.Color('#D9D2C2')];
const WOOD_DOOR = [new THREE.Color('#6B4A32'), new THREE.Color('#5A3B26'), new THREE.Color('#7A5638')];
// Old houses on the Butte sit on a base of exposed rubble or dressed stone,
// a metre or so high, darker than the render above it.
const RUBBLE_BASE = new THREE.Color('#B4A487');
const POT = new THREE.Color('#B0644A');   // terracotta chimney pots
const GLASS_SHOP = new THREE.Color('#2F3740');
const TRIM = PALETTE.limestoneLit;
const SOCLE = PALETTE.limestoneDeep;
const IRON = PALETTE.ironwork;

/** A small deterministic hash so a building's look depends only on its id. */
function hash(n, k = 0) {
  let x = (n * 374761393 + k * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177 | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * Accumulates triangles with per-vertex colour, for one material family.
 *
 * Non-indexed on purpose: flat shading needs a normal per face, and three.js
 * computes exactly that from non-indexed positions.
 */
class Family {
  constructor(name, { roughness = 0.9, metalness = 0, castShadow = true, receiveShadow = true } = {}) {
    this.name = name;
    this.pos = [];
    this.col = [];
    this.opts = { roughness, metalness, castShadow, receiveShadow };
    this.tris = 0;
  }

  tri(a, b, c, col) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
    this.tris++;
  }

  /** a-b-c-d counter-clockwise as seen from the side the face should show. */
  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  /**
   * An oriented box. `o` is the centre; u, v, w are unit axes (u along the
   * wall, v up, w out of the wall) and hu/hv/hw are half-extents.
   */
  box(o, u, v, w, hu, hv, hw, col) {
    const P = (su, sv, sw) => [
      o[0] + u[0] * hu * su + v[0] * hv * sv + w[0] * hw * sw,
      o[1] + u[1] * hu * su + v[1] * hv * sv + w[1] * hw * sw,
      o[2] + u[2] * hu * su + v[2] * hv * sv + w[2] * hw * sw,
    ];
    const c = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1),
      P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    this.quad(c[4], c[5], c[6], c[7], col);   // +w (front)
    this.quad(c[1], c[0], c[3], c[2], col);   // -w (back)
    this.quad(c[5], c[1], c[2], c[6], col);   // +u
    this.quad(c[0], c[4], c[7], c[3], col);   // -u
    this.quad(c[7], c[6], c[2], c[3], col);   // +v (top)
    this.quad(c[0], c[1], c[5], c[4], col);   // -v (bottom)
  }

  mesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true,
      roughness: this.opts.roughness, metalness: this.opts.metalness,
    }));
    m.name = `city_${this.name}`;
    m.castShadow = this.opts.castShadow;
    m.receiveShadow = this.opts.receiveShadow;
    return m;
  }
}

/**
 * Inset every vertex of a counter-clockwise-from-above ring by d along its
 * corner bisector. Identical to miter_offset in tools/geo/build.py, which is
 * where the safe d for each footprint was found.
 */
export function insetRing(ring, d) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, pz] = ring[(i - 1 + n) % n];
    const [cx, cz] = ring[i];
    const [nx, nz] = ring[(i + 1) % n];
    const e1x = cx - px, e1z = cz - pz, e2x = nx - cx, e2z = nz - cz;
    const l1 = Math.hypot(e1x, e1z) || 1e-9, l2 = Math.hypot(e2x, e2z) || 1e-9;
    const n1x = e1z / l1, n1z = -e1x / l1, n2x = e2z / l2, n2z = -e2x / l2;
    let bx = n1x + n2x, bz = n1z + n2z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) return null;
    bx /= bl; bz /= bl;
    const cosHalf = bx * n1x + bz * n1z;
    if (cosHalf <= 0.05) return null;
    // Miter limit — identical to tools/geo/build.py, which validated d.
    const k = d / Math.max(cosHalf, 0.35);
    out.push([cx + bx * k, cz + bz * k]);
  }
  return out;
}

function shade(col, f) {
  return new THREE.Color(Math.min(1, col.r * f), Math.min(1, col.g * f), Math.min(1, col.b * f));
}

/**
 * Build the city.
 *
 * @param {import('../core/spline.js').Rail} rail
 * @param {{nearest: Function}} near   railIndex(rail)
 * @param {{skip?: (b) => boolean}} opts
 * @returns {{group: THREE.Group, anchors: object[], occluders: object[], stats: object}}
 */
export function buildRealCity(rail, near, { skip = () => false } = {}) {
  const fam = {
    wall: new Family('wall', { roughness: 0.9 }),
    roof: new Family('roof', { roughness: 0.62, metalness: 0.15 }),
    glass: new Family('glass', { roughness: 0.45, metalness: 0, castShadow: false }),
    trim: new Family('trim', { roughness: 0.85 }),
    iron: new Family('iron', { roughness: 0.5, metalness: 0.35, castShadow: false }),
  };
  const anchors = [];
  const occluders = [];
  const stats = { buildings: 0, facades: 0, detailed: 0, shops: 0 };
  const up = [0, 1, 0];

  for (const b of GEO.buildings) {
    if (skip(b)) continue;
    stats.buildings++;
    const ring = pairs(b.o);
    const holes = (b.h ?? []).map(pairs);
    const seed = b.seed;
    const lightJit = 0.93 + hash(seed, 1) * 0.12;
    const wallCol = shade(WALL[b.s] ?? WALL.plaster, lightJit);
    const sideCol = shade(wallCol, 0.97);
    const g = b.g, e = b.e;

    // ---- body -----------------------------------------------------------
    // Walls rise from the building's lowest ground to its eaves, so a house
    // on the Butte's slope is buried on the uphill side by the terrain rather
    // than floating on the downhill side.
    const roofKind = b.r;
    const roofH = roofKind === 'mansard' ? 2.6
      : roofKind === 'hip' ? b.i * 0.72
        : roofKind === 'church' ? b.i * 1.35 : 0;
    const holeTop = roofKind === 'flat' ? e : e + roofH;
    const walls = (r, top) => {
      for (let i = 0; i < r.length; i++) {
        const [ax, az] = r[i];
        const [bx, bz] = r[(i + 1) % r.length];
        fam.wall.quad([ax, g, az], [bx, g, bz], [bx, top, bz], [ax, top, az], sideCol);
      }
    };
    walls(ring, e);
    for (const h of holes) walls(h, holeTop);

    // ---- roof -----------------------------------------------------------
    const roofCol = shade(ROOF[roofKind] ?? ROOF.flat, 0.94 + hash(seed, 2) * 0.1);
    let capRing = ring, capY = e;
    if ((roofKind === 'mansard' || roofKind === 'hip' || roofKind === 'church') && b.i > 0.5) {
      const inner = insetRing(ring, b.i);
      if (inner) {
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          fam.roof.quad(
            [ring[i][0], e, ring[i][1]], [ring[j][0], e, ring[j][1]],
            [inner[j][0], e + roofH, inner[j][1]], [inner[i][0], e + roofH, inner[i][1]], roofCol);
        }
        capRing = inner; capY = e + roofH;
      }
    }
    capPolygon(fam.roof, capRing, holes, capY, roofKind === 'mansard' ? shade(roofCol, 0.88) : roofCol);

    // ---- chimney stacks ----------------------------------------------------
    // The Paris roofline is chimneys: rendered stacks along the party walls,
    // topped with rows of terracotta pots. In every survey photograph that
    // shows a roof (rue d'Orchampt's bend, rue Lepic, Place des Abbesses)
    // they are the strongest thing on the skyline, and a flat-capped block
    // without them reads as a modern building.
    {
      const c0 = centroid(ring);
      const nr0 = near.nearest(c0[0], c0[1], 140);
      if (nr0 && nr0.dist < 80 && roofKind !== 'church') {
        const streetEdges = new Set(b.se.map((e) => e[0]));
        const topY = roofKind === 'flat' ? e : e + roofH;
        let made = 0;
        for (let i = 0; i < ring.length && made < 2; i++) {
          if (streetEdges.has(i)) continue;
          const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 4 || hash(seed, 60 + i) < 0.35) continue;
          const u = [(bx - ax) / len, 0, (bz - az) / len];
          const w = [-u[2], 0, u[0]];
          const inset = (roofKind === 'flat' ? 0.5 : b.i) + 0.25;
          const cx = (ax + bx) / 2 - w[0] * inset, cz = (az + bz) / 2 - w[2] * inset;
          const sw = Math.min(1.6, len * 0.22), sh = 1.0 + hash(seed, 61 + i) * 0.8;
          const stackCol = shade(wallCol, 0.95);
          fam.wall.box([cx, topY + sh / 2 - 0.3, cz], u, up, w, sw / 2, sh / 2 + 0.3, 0.3, stackCol);
          fam.trim.box([cx, topY + sh + 0.05, cz], u, up, w, sw / 2 + 0.06, 0.06, 0.36, TRIM);
          const pots = Math.min(3, Math.max(2, Math.round(sw / 0.4)));
          for (let k = 0; k < pots; k++) {
            const t = (k + 0.5) / pots - 0.5;
            fam.roof.box([cx + u[0] * t * sw, topY + sh + 0.28, cz + u[2] * t * sw], u, up, w, 0.08, 0.18, 0.08, POT);
          }
          made++;
        }
      }
    }

    // ---- facades onto streets -------------------------------------------
    const cent = centroid(ring);
    const nr = near.nearest(cent[0], cent[1], 140);
    const distToRail = nr ? nr.dist : Infinity;
    const shopsByEdge = new Map();
    for (const s of b.sh ?? []) {
      if (!shopsByEdge.has(s[0])) shopsByEdge.set(s[0], []);
      shopsByEdge.get(s[0]).push(s);
    }
    const doorsByEdge = new Map();
    for (const d of b.dr ?? []) doorsByEdge.set(d[0], d[1]);
    const shutterCol = SHUTTERS[Math.floor(hash(seed, 3) * SHUTTERS.length)];
    const hasShutters = hash(seed, 4) < 0.72;
    const doorCol = DOORS[Math.floor(hash(seed, 5) * DOORS.length)];
    const grand = b.s === 'stone' && b.f >= 5;

    for (const [ei] of b.se) {
      const [ax, az] = ring[ei];
      const [bx, bz] = ring[(ei + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2.4) continue;
      const u = [(bx - ax) / len, 0, (bz - az) / len];
      const w = [-u[2], 0, u[0]];          // outward normal
      const mid = [(ax + bx) / 2, (az + bz) / 2];
      const nm = near.nearest(mid[0], mid[1], 140);
      const edgeDist = nm ? nm.dist : Infinity;
      const detailed = edgeDist < NEAR_M;
      const anchored = edgeDist < ANCHOR_M;
      stats.facades++;
      if (detailed) stats.detailed++;

      // Street level in front of this wall, sampled at each end so a facade
      // on a slope steps its ground floor down the hill.
      const gA = groundAt(ax + w[0] * 2, az + w[2] * 2) ?? g;
      const gB = groundAt(bx + w[0] * 2, bz + w[2] * 2) ?? g;
      const streetY = Math.min(gA, gB);
      const H = e - streetY;
      if (H < 3) continue;

      const shops = shopsByEdge.get(ei) ?? [];
      const groundH = Math.min(H * 0.45, shops.length ? 4.0 : 3.4);
      const upper = Math.max(0, Math.round((H - groundH - 0.6) / 3.0));
      const floorH = upper > 0 ? (H - groundH - 0.6) / upper : 0;
      const nb = Math.max(1, Math.floor(len / 3.05));
      const bayW = len / nb;
      const at = (t, y, out = 0) => [ax + u[0] * t + w[0] * out, y, az + u[2] * t + w[2] * out];
      // A flat rectangle on the facade plane, facing the street: two
      // triangles where a box costs twelve. Thin joinery and ironwork are
      // only ever seen from the front.
      const rect = (f, cx, cy, hw, hh, out, col) => f.quad(at(cx - hw, cy - hh, out), at(cx + hw, cy - hh, out),
        at(cx + hw, cy + hh, out), at(cx - hw, cy + hh, out), col);
      const side = nm ? sideOf(rail, nm, mid) : 0;
      const pushAnchor = (type, pos, k) => {
        // A door more than 0.8 m below the walk is in a garden or a sunken
        // court under the street: an enemy there is invisible from the rail.
        // These only showed up once the terrain was drawn the right way up.
        if (type === 'door' && pos[1] < nm.y - 0.8) return;
        anchors.push({
        id: `b${b.id}_${ei}_${type}_${k}`, type,
        worldPos: new THREE.Vector3(pos[0], pos[1], pos[2]),
        railDistance: nm.d, side,
        facing: new THREE.Vector3(w[0], 0, w[2]),
        });
      };

      // Cornice: the strongest horizontal on any Paris street.
      fam.trim.box(at(len / 2, e - 0.18, 0.18), u, up, w, len / 2 + 0.25, 0.2, 0.32, TRIM);

      // Upper floors.
      let balconies = 0;
      for (let f = 1; f <= upper; f++) {
        const y0 = streetY + groundH + (f - 1) * floorH;
        // French windows: tall and close, as on every street in the survey
        // photos. The first version's 1.2 x 1.85 m at a 3 m pitch read as a
        // prison block from twenty metres.
        const wh = Math.min(2.15, floorH * 0.72);
        const ww = Math.min(1.2, bayW * 0.44);
        const wy = y0 + floorH * 0.14 + wh / 2;
        const runBalcony = detailed && grand && (f === 2 || f === upper);
        if (runBalcony) {
          // Open wrought iron: handrail, bottom rail and a baluster every
          // 60 cm. As a solid plate it read as a black band across the block.
          const by = y0 + floorH * 0.14;
          fam.iron.box(at(len / 2, by + 0.95, 0.6), u, up, w, len / 2 - 0.1, 0.03, 0.04, IRON);
          fam.iron.box(at(len / 2, by + 0.12, 0.6), u, up, w, len / 2 - 0.1, 0.02, 0.02, IRON);
          for (let t = 0.3; t < len - 0.2; t += 0.6) rect(fam.iron, t, by + 0.54, 0.015, 0.41, 0.6, IRON);
          fam.trim.box(at(len / 2, y0 + floorH * 0.14 - 0.06, 0.35), u, up, w, len / 2, 0.08, 0.35, TRIM);
        }
        for (let j = 0; j < nb; j++) {
          const cx = (j + 0.5) * bayW;
          fam.glass.quad(at(cx - ww / 2, wy - wh / 2, 0.04), at(cx + ww / 2, wy - wh / 2, 0.04),
            at(cx + ww / 2, wy + wh / 2, 0.04), at(cx - ww / 2, wy + wh / 2, 0.04), GLASS);
          if (!detailed) continue;
          fam.trim.box(at(cx, wy - wh / 2 - 0.07, 0.1), u, up, w, ww / 2 + 0.1, 0.07, 0.12, TRIM);
          // White joinery: the frame and the glazing bar are what make a dark
          // rectangle read as a Paris window rather than a hole.
          rect(fam.trim, cx, wy + wh / 2 - 0.04, ww / 2, 0.05, 0.06, FRAME);
          for (const s of [-1, 1]) rect(fam.trim, cx + s * (ww / 2 - 0.04), wy, 0.05, wh / 2, 0.06, FRAME);
          rect(fam.trim, cx, wy, 0.03, wh / 2, 0.06, FRAME);
          // Wrought-iron guard rail across the lower third of every French
          // window on the stone buildings that do not have a running balcony.
          // Open ironwork, not a plate: a solid box here read as a black bar
          // across every window and turned the facades into rows of "H"s.
          if (grand && !runBalcony) {
            const ry = wy - wh / 2;
            rect(fam.iron, cx, ry + 0.86, ww / 2 + 0.06, 0.025, 0.12, IRON);
            rect(fam.iron, cx, ry + 0.22, ww / 2 + 0.06, 0.02, 0.12, IRON);
            for (let k = -2; k <= 2; k++) rect(fam.iron, cx + k * ww / 5, ry + 0.54, 0.012, 0.32, 0.12, IRON);
          }
          if (hasShutters && !grand) {
            for (const s of [-1, 1]) {
              fam.trim.box(at(cx + s * (ww / 2 + ww * 0.27), wy, 0.07), u, up, w,
                ww * 0.26, wh / 2, 0.04, shutterCol);
            }
          }
          const ownBalcony = !runBalcony && hash(seed, 100 + f * 31 + j) < (grand ? 0.0 : 0.14);
          if (ownBalcony) {
            const by = wy - wh / 2;
            fam.iron.box(at(cx, by + 0.9, 0.42), u, up, w, ww / 2 + 0.15, 0.03, 0.03, IRON);
            for (let k = -2; k <= 2; k++) rect(fam.iron, cx + k * (ww / 2 + 0.1) / 2, by + 0.45, 0.015, 0.45, 0.42, IRON);
            fam.trim.box(at(cx, wy - wh / 2 - 0.05, 0.22), u, up, w, ww / 2 + 0.2, 0.06, 0.24, TRIM);
          }
          if (anchored && (runBalcony || ownBalcony) && f <= 3 && balconies < 3) {
            pushAnchor('balcony', at(cx, wy - wh / 2, 0.75), `${f}_${j}`);
            balconies++;
          }
        }
      }

      if (!detailed) continue;

      // Socle and the band over the ground floor. Rendered houses (most of
      // the old village) get the taller exposed-stone base they have in life.
      const tallBase = b.s !== 'stone' && hash(seed, 13) < 0.55;
      const sh = tallBase ? 0.55 + hash(seed, 14) * 0.45 : 0.32;
      fam.trim.box(at(len / 2, streetY + sh - 0.02, 0.05), u, up, w, len / 2, sh, 0.08, tallBase ? RUBBLE_BASE : SOCLE);
      if (upper > 0) {
        fam.trim.box(at(len / 2, streetY + groundH + 0.05, 0.1), u, up, w, len / 2 + 0.05, 0.1, 0.14, TRIM);
      }

      // Ground floor: real shops where OSM has them, a door otherwise.
      if (shops.length) {
        for (const [, t, kind] of shops) {
          stats.shops++;
          const sw = Math.min(len * 0.82, 5.6);
          const c = Math.min(len - sw / 2 - 0.2, Math.max(sw / 2 + 0.2, t * len));
          const pal = AWNING[kind] ?? AWNING.shop;
          const ac = pal[Math.floor(hash(seed, 7 + Math.round(t * 50)) * pal.length)];
          const gy = streetY + 0.35;
          const gh = groundH * 0.72;
          // The devanture: a painted timber shopfront proud of the wall, with
          // pilasters, a deep fascia and a stall riser under the glass. This
          // is what reads "shop" in Paris; the awning is optional and about
          // half of the shops on the route have none.
          const dv = DEVANTURE[Math.floor(hash(seed, 17 + Math.round(t * 50)) * DEVANTURE.length)];
          const D = 0.16;
          fam.trim.box(at(c, gy + gh + 0.34, D), u, up, w, sw / 2 + 0.22, 0.34, 0.08, dv);
          for (const sx of [-1, 1]) fam.trim.box(at(c + sx * (sw / 2 + 0.1), streetY + (gh + 0.7) / 2, D), u, up, w, 0.12, (gh + 0.7) / 2, 0.08, dv);
          fam.trim.box(at(c, streetY + 0.3, D), u, up, w, sw / 2, 0.3, 0.06, dv);
          fam.glass.quad(at(c - sw / 2, gy + 0.25, 0.12), at(c + sw / 2, gy + 0.25, 0.12),
            at(c + sw / 2, gy + gh, 0.12), at(c - sw / 2, gy + gh, 0.12), GLASS_SHOP);
          // Glazing bars dividing the window into the usual three lights.
          for (const k of [-1, 1]) rect(fam.trim, c + k * sw / 6, gy + 0.25 + (gh - 0.25) / 2, 0.04, (gh - 0.25) / 2, 0.14, dv);
          if (hash(seed, 19 + Math.round(t * 50)) < 0.5 || kind === 'cafe' || kind === 'restaurant' || kind === 'bar') {
            const out = Math.min(1.5, 0.9 + hash(seed, 9) * 0.6);
            const yTop = gy + gh + 0.05, yBot = yTop - 0.55;
            const p0 = at(c - sw / 2, yTop, 0.24), p1 = at(c + sw / 2, yTop, 0.24);
            const p2 = at(c + sw / 2, yBot, out), p3 = at(c - sw / 2, yBot, out);
            fam.trim.quad(p3, p2, p1, p0, ac);
            fam.trim.quad(p0, p1, p2, p3, shade(ac, 0.7));
            // The valance: bottom-left, bottom-right, top-right, top-left as
            // seen from the street, or it is wound away from the viewer.
            fam.trim.quad(at(c - sw / 2, yBot - 0.22, out), at(c + sw / 2, yBot - 0.22, out),
              at(c + sw / 2, yBot, out), at(c - sw / 2, yBot, out), shade(ac, 0.9));
          }
          if (anchored) pushAnchor('door', at(c, streetY, 0.7), `s${Math.round(t * 100)}`);
        }
      } else if (len > 3.2) {
        const tDoor = doorsByEdge.has(ei) ? doorsByEdge.get(ei) : 0.25 + hash(seed, 11 + ei) * 0.5;
        const cochere = len > 11 && H > 11 && hash(seed, 12 + ei) < 0.5;
        const dw = cochere ? 2.8 : 1.25, dh = Math.min(groundH - 0.2, cochere ? 3.6 : 2.55);
        const c = Math.min(len - dw / 2 - 0.3, Math.max(dw / 2 + 0.3, tDoor * len));
        // Carriage doors are varnished or painted wood, nearly always.
        const dc = cochere ? WOOD_DOOR[Math.floor(hash(seed, 15 + ei) * WOOD_DOOR.length)] : doorCol;
        fam.trim.box(at(c, streetY + dh / 2, 0.06), u, up, w, dw / 2, dh / 2, 0.06, dc);
        if (cochere) rect(fam.trim, c, streetY + dh / 2, 0.03, dh / 2 - 0.05, 0.13, shade(dc, 0.7));
        fam.trim.box(at(c, streetY + dh + 0.12, 0.09), u, up, w, dw / 2 + 0.18, 0.12, 0.1, TRIM);
        if (anchored) pushAnchor('door', at(c, streetY, 0.6), 'd');
        // Ground-floor windows either side of the door, shuttered or barred.
        for (let j = 0; j < nb; j++) {
          const cx = (j + 0.5) * bayW;
          if (Math.abs(cx - c) < dw / 2 + 0.9) continue;
          const wy = streetY + groundH * 0.55;
          const shut = hash(seed, 200 + j) < 0.45;
          if (shut) {
            fam.trim.box(at(cx, wy, 0.06), u, up, w, Math.min(0.6, bayW * 0.22), 0.85, 0.04, shutterCol);
          } else {
            fam.glass.quad(at(cx - 0.55, wy - 0.8, 0.04), at(cx + 0.55, wy - 0.8, 0.04),
              at(cx + 0.55, wy + 0.8, 0.04), at(cx - 0.55, wy + 0.8, 0.04), GLASS);
          }
        }
      }

      // Rooftop: a parapet anchor on every street wall near the walk, and
      // dormers in the zinc where there is a mansard to put them in.
      if (anchored) {
        // Stand ON the roof, not in it: a mansard's deck is its inset top
        // ring, so an enemy at the eaves line would be buried to the knees in
        // zinc. Flat roofs and hips are stood on at the eaves.
        if (roofKind === 'mansard') pushAnchor('roof', at(len / 2, e + roofH, -(b.i + 0.35)), 'r');
        else pushAnchor('roof', at(len / 2, e + 0.05, -0.55), 'r');
        if (roofKind === 'mansard' && len > 5) {
          let dormers = 0;
          for (let j = 1; j < nb; j += 2) {
            const cx = (j + 0.5) * bayW;
            const dy = e + 1.1;
            fam.roof.box(at(cx, dy, -0.75), u, up, w, 0.6, 0.75, 0.55, shade(roofCol, 1.05));
            fam.glass.quad(at(cx - 0.38, dy - 0.5, -0.19), at(cx + 0.38, dy - 0.5, -0.19),
              at(cx + 0.38, dy + 0.45, -0.19), at(cx - 0.38, dy + 0.45, -0.19), GLASS);
            if (dormers < 2) { pushAnchor('dormer', at(cx, dy - 0.75, 0.0), `m${j}`); dormers++; }
          }
        }
      }
    }

    // ---- line of sight ----------------------------------------------------
    if (distToRail < OCCLUDE_M) {
      occluders.push(polyOccluder(ring, g, e + (roofKind === 'flat' ? 0 : roofH)));
    }
  }

  const group = new THREE.Group();
  group.name = 'city';
  for (const f of Object.values(fam)) {
    if (f.tris) group.add(f.mesh());
  }
  stats.triangles = Object.values(fam).reduce((s, f) => s + f.tris, 0);
  return { group, anchors, occluders, stats };
}

/**
 * Triangulate a flat cap (roof deck, ridge, terrace) with holes, facing up.
 */
function capPolygon(fam, ring, holes, y, col) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  } catch {
    return;
  }
  const all = [...contour, ...hs.flat()];
  for (const [i, j, k] of tris) {
    const a = all[i], b = all[j], c = all[k];
    // Face up: the cross product's Y must be positive for a +Y normal.
    const cy = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
    if (cy > 0) fam.tri([a.x, y, a.y], [b.x, y, b.y], [c.x, y, c.y], col);
    else fam.tri([a.x, y, a.y], [c.x, y, c.y], [b.x, y, b.y], col);
  }
}

function centroid(ring) {
  let x = 0, z = 0;
  for (const [a, b] of ring) { x += a; z += b; }
  return [x / ring.length, z / ring.length];
}

/** +1 if (x, z) is on the rail's right hand at that sample, -1 if on its left. */
function sideOf(rail, sample, [x, z]) {
  const t = rail.tangentAt(sample.d);
  const rx = -t.z, rz = t.x;
  return Math.sign((x - sample.x) * rx + (z - sample.z) * rz) || 1;
}

/**
 * The mouths of the real side streets, as places enemies come from.
 *
 * The procedural street wall used to leave an occasional random gap and call
 * it an alley. Montmartre has real ones, and they are in the data: every
 * BD TOPO street that meets the walk is sampled, and where it is between
 * MIN and MAX metres from the rail and running across it rather than along
 * it, its mouth is published as an 'alley' anchor. Enemies now step out of
 * rue Saint-Vincent and rue Norvins and rue Garreau, because those are the
 * openings that are actually there.
 */
export function sideStreetAnchors(rail, near, isBlocked = () => false) {
  const MIN = 6.5, MAX = 13;
  const out = [];
  for (const r of GEO.roads) {
    const pts = [];
    for (let i = 0; i < r.p.length; i += 3) pts.push([r.p[i], r.p[i + 1], r.p[i + 2]]);
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, ay, az] = pts[s], [bx, by, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / (len || 1), dz = (bz - az) / (len || 1);
      for (let t = 0; t <= len; t += 1.5) {
        const x = ax + dx * t, z = az + dz * t, y = ay + (by - ay) * (t / (len || 1));
        const nr = near.nearest(x, z, MAX + 2);
        if (!nr || nr.dist < MIN || nr.dist > MAX) continue;
        const tan = rail.tangentAt(nr.d);
        if (Math.abs(dx * tan.x + dz * tan.z) > 0.55) continue;
        // Above the walk is fine (a lane climbing away); more than a metre below
        // it and the enemy is down a slope the player cannot see into.
        const gy = groundAt(x, z) ?? y;
        if (gy - nr.y > 4 || gy < nr.y - 1.0) continue;
        if (isBlocked(x, z)) continue;
        if (out.some((a) => (a.worldPos.x - x) ** 2 + (a.worldPos.z - z) ** 2 < 100)) continue;
        const toRail = new THREE.Vector3(nr.x - x, 0, nr.z - z).normalize();
        out.push({
          id: `alley_${r.n.replace(/\W+/g, '_') || 'x'}_${Math.round(nr.d)}`,
          type: 'alley',
          worldPos: new THREE.Vector3(x, groundAt(x, z) ?? y, z),
          railDistance: nr.d,
          side: sideOf(rail, nr, [x, z]),
          facing: toRail,
          street: r.n,
        });
      }
    }
  }
  return out;
}
