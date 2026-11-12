import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import { rubbleTexture } from '../render/textures.js';
import { GEO, groundAt, pairs, triples, insideBuilding, pointInRing } from './geo.js';
import { polyOccluder } from './occluders.js';

/**
 * The walls, railings and gates between the buildings.
 *
 * WHY THIS IS ITS OWN LAYER. A cadastre is a list of buildings, so a city built
 * from one has a hole wherever there is no building — and on the Butte that is
 * half of every street. Rue Girardon, rue de l'Abreuvoir and the upper rue
 * d'Orchampt are lined as much by garden walls as by houses: rubble limestone
 * with a stone coping, rendered walls carrying green iron railings, painted
 * sheet-metal fences, double gates between square piers, and trees spilling
 * over all of it. In the first data-driven version those stretches were simply
 * open, so the street looked onto empty lawns and the backs of distant blocks,
 * and someone who walks it every day did not recognise it.
 *
 * Two sources:
 *   1. OpenStreetMap's barrier=wall / fence / retaining_wall / hedge ways and
 *      gate nodes, drawn where they are mapped.
 *   2. A rule for everything OSM has not mapped: walking the route, any
 *      stretch of the property line with no facade on it, no street or steps
 *      opening off it and no square in front of it is a garden boundary, and
 *      gets one. Which kind is decided per run, weighted by what the Ville de
 *      Paris survey photographs of these streets show.
 *
 * Returns the group plus `gardenSpots`: points just behind each gap wall where
 * the trees of that garden stand (realtrees.js plants them).
 */

const RENDER = new THREE.Color('#E2DBCC');
const COPING = new THREE.Color('#B9B1A3');
const PIER = new THREE.Color('#E8E2D6');
const FENCE_GREEN = new THREE.Color('#2F4A3B');
const HEDGE = new THREE.Color('#41592E');

function hash(a, b = 0) {
  let x = (Math.round(a * 1000) * 374761393 + b * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177 | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

class Mesher {
  constructor(uvs = false) { this.pos = []; this.col = []; this.uv = uvs ? [] : null; }
  quad(a, b, c, d, col, uv = null) {
    for (const v of [a, b, c, a, c, d]) this.pos.push(v[0], v[1], v[2]);
    for (let i = 0; i < 6; i++) this.col.push(col.r, col.g, col.b);
    if (this.uv) {
      const q = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) this.uv.push(q[k][0], q[k][1]);
    }
  }
  /** An axis-free box from a centre, unit axes and half extents. */
  box(c, u, w, hu, hy, hw, col) {
    const P = (su, sy, sw) => [c[0] + u[0] * hu * su + w[0] * hw * sw, c[1] + hy * sy, c[2] + u[2] * hu * su + w[2] * hw * sw];
    const f = [
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)],
      [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
      [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)],
      [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
      [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)],
    ];
    for (const q of f) this.quad(q[0], q[1], q[2], q[3], col);
  }
  mesh(name, material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/**
 * Draw one wall along a polyline of [x, z] points.
 *   kind 'rubble'  rubble limestone, coped, 2.0-2.8 m
 *   kind 'render'  rendered wall, coped, with a green railing on top
 *   kind 'fence'   low rendered wall carrying a painted sheet-metal fence
 *   kind 'rail'    low wall and an open iron railing (squares, gardens)
 *   kind 'hedge'   clipped hedge
 * Heights follow the ground at every point, so a wall on a 15% street steps
 * down the hill with it rather than standing out of it.
 */
function wallAlong(pts, kind, height, M, seed) {
  const T = kind === 'hedge' ? 0.45 : 0.22;
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const u = [(bx - ax) / len, 0, (bz - az) / len];
    const w = [-u[2], 0, u[0]];
    const n = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const g0 = groundAt(x0, z0), g1 = groundAt(x1, z1);
      if (g0 === null || g1 === null) continue;
      const base = kind === 'rubble' || kind === 'hedge' ? height : kind === 'render' ? height : 0.75;
      const top0 = g0 + base, top1 = g1 + base;
      // Line of sight for the spawn director: everything solid in this piece,
      // which for a sheet-metal fence includes the panel. Open railings are
      // left out: you can see an enemy through them.
      if (M.occluders) {
        const solidTop = Math.max(top0, top1) + (kind === 'fence' ? Math.max(1.0, height - 0.85) : 0.1);
        if (kind !== 'rail' || height < 1.2) {
          M.occluders.push(polyOccluder([[x0 + w[0] * T, z0 + w[2] * T], [x1 + w[0] * T, z1 + w[2] * T],
            [x1 - w[0] * T, z1 - w[2] * T], [x0 - w[0] * T, z0 - w[2] * T]], Math.min(g0, g1) - 0.4, solidTop));
        }
      }
      const lo0 = g0 - 0.4, lo1 = g1 - 0.4;
      const A = [x0 + w[0] * T, z0 + w[2] * T], B = [x1 + w[0] * T, z1 + w[2] * T];
      const C = [x1 - w[0] * T, z1 - w[2] * T], D = [x0 - w[0] * T, z0 - w[2] * T];
      const along0 = (s + t0) * 0 + Math.hypot(x0 - pts[0][0], z0 - pts[0][1]);
      const along1 = along0 + len / n;
      const uvA = [[along0, lo0], [along1, lo1], [along1, top1], [along0, top0]];
      const uvC = [[along1, lo1], [along0, lo0], [along0, top0], [along1, top1]];
      const tgt = kind === 'rubble' ? M.rubble : kind === 'hedge' ? M.hedge : M.render;
      const col = kind === 'rubble' ? new THREE.Color(1, 1, 1).multiplyScalar(0.92 + hash(seed, 3) * 0.1)
        : kind === 'hedge' ? HEDGE : RENDER;
      tgt.quad([A[0], lo0, A[1]], [B[0], lo1, B[1]], [B[0], top1, B[1]], [A[0], top0, A[1]], col, uvA);
      tgt.quad([C[0], lo1, C[1]], [D[0], lo0, D[1]], [D[0], top0, D[1]], [C[0], top1, C[1]], col, uvC);
      if (kind === 'hedge') {
        tgt.quad([A[0], top0, A[1]], [B[0], top1, B[1]], [C[0], top1, C[1]], [D[0], top0, D[1]], HEDGE);
        continue;
      }
      // Coping, overhanging a little each side.
      const o = T + 0.06;
      const cA = [x0 + w[0] * o, z0 + w[2] * o], cB = [x1 + w[0] * o, z1 + w[2] * o];
      const cC = [x1 - w[0] * o, z1 - w[2] * o], cD = [x0 - w[0] * o, z0 - w[2] * o];
      M.trim.quad([cA[0], top0 + 0.1, cA[1]], [cB[0], top1 + 0.1, cB[1]], [cC[0], top1 + 0.1, cC[1]], [cD[0], top0 + 0.1, cD[1]], COPING);
      M.trim.quad([cA[0], top0, cA[1]], [cB[0], top1, cB[1]], [cB[0], top1 + 0.1, cB[1]], [cA[0], top0 + 0.1, cA[1]], COPING);
      M.trim.quad([cC[0], top1, cC[1]], [cD[0], top0, cD[1]], [cD[0], top0 + 0.1, cD[1]], [cC[0], top1 + 0.1, cC[1]], COPING);

      if (kind === 'fence') {
        // Painted sheet-metal panel on the dwarf wall: the green screens that
        // close most of the gardens on rue Girardon.
        const fh = Math.max(1.0, height - 0.85);
        const y0 = top0 + 0.1, y1 = top1 + 0.1;
        M.iron.quad([x0, y0, z0], [x1, y1, z1], [x1, y1 + fh, z1], [x0, y0 + fh, z0], FENCE_GREEN);
        M.iron.quad([x1, y1, z1], [x0, y0, z0], [x0, y0 + fh, z0], [x1, y1 + fh, z1], FENCE_GREEN);
      } else if (kind === 'render' || kind === 'rail') {
        // Open railing: a top rail and bars every 14 cm, as single quads.
        const rh = kind === 'rail' ? Math.max(1.0, height - 0.85) : 0.9;
        const y0 = top0 + 0.1, y1 = top1 + 0.1;
        M.iron.quad([x0, y0 + rh - 0.05, z0], [x1, y1 + rh - 0.05, z1], [x1, y1 + rh, z1], [x0, y0 + rh, z0], FENCE_GREEN);
        const bars = Math.max(1, Math.round((len / n) / 0.14));
        for (let b = 0; b < bars; b++) {
          const t = (b + 0.5) / bars;
          const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
          const hx = u[0] * 0.012, hz = u[2] * 0.012;
          M.iron.quad([x - hx, y, z - hz], [x + hx, y, z + hz], [x + hx, y + rh + 0.06, z + hz], [x - hx, y + rh + 0.06, z - hz], FENCE_GREEN);
        }
      }
    }
  }
}

/** A carriage gate: two rendered piers and a pair of iron leaves. */
function gateAt(x, z, ux, uz, width, M, seed) {
  const g = groundAt(x, z);
  if (g === null) return;
  M.gates?.push({ x, y: g, z, ux, uz });
  const u = [ux, 0, uz], w = [-uz, 0, ux];
  const ph = 2.9, pw = 0.32;
  for (const s of [-1, 1]) {
    const c = [x + ux * s * (width / 2 + pw), g + ph / 2 - 0.2, z + uz * s * (width / 2 + pw)];
    M.trim.box(c, u, w, pw, ph / 2 + 0.2, pw, PIER);
    M.trim.box([c[0], g + ph + 0.08, c[2]], u, w, pw + 0.06, 0.08, pw + 0.06, COPING);
  }
  // Solid lower panel and open upper bars, both faces.
  const col = hash(seed, 9) < 0.7 ? FENCE_GREEN : new THREE.Color('#3A3430');
  const L = [x - ux * width / 2, z - uz * width / 2], R = [x + ux * width / 2, z + uz * width / 2];
  M.iron.quad([L[0], g, L[1]], [R[0], g, R[1]], [R[0], g + 1.2, R[1]], [L[0], g + 1.2, L[1]], col);
  M.iron.quad([R[0], g, R[1]], [L[0], g, L[1]], [L[0], g + 1.2, L[1]], [R[0], g + 1.2, R[1]], col);
  const bars = Math.round(width / 0.13);
  for (let b = 0; b <= bars; b++) {
    const t = b / bars;
    const bx = L[0] + (R[0] - L[0]) * t, bz = L[1] + (R[1] - L[1]) * t;
    const hx = ux * 0.015, hz = uz * 0.015;
    M.iron.quad([bx - hx, g + 1.2, bz - hz], [bx + hx, g + 1.2, bz + hz], [bx + hx, g + 2.6, bz + hz], [bx - hx, g + 2.6, bz - hz], col);
  }
  M.iron.quad([L[0], g + 2.55, L[1]], [R[0], g + 2.55, R[1]], [R[0], g + 2.65, R[1]], [L[0], g + 2.65, L[1]], col);
}

/** Nearest point on any segment of a polyline list, within r. */
function nearSegments(segs, x, z, r) {
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < r) return [a, b];
  }
  return null;
}

export function buildBoundaries(rail, near) {
  const M = {
    rubble: new Mesher(true),
    render: new Mesher(),
    trim: new Mesher(),
    iron: new Mesher(),
    hedge: new Mesher(),
    occluders: [],
    gates: [],
  };
  const gardenSpots = [];

  // ---- 1. what OpenStreetMap maps ----------------------------------------
  const mapped = [];
  // A mapped barrier can cross the walk where the walk itself is a liberty
  // taken with the map (the rail starts on the métro landing, where OSM has
  // a wall), so mapped lines are cut wherever they come within CLEAR of it.
  const CLEAR = 1.6;
  const clipped = [];
  for (const [i, b] of (GEO.barriers ?? []).entries()) {
    const raw = triples(b.p).map(([x, , z]) => [x, z]);
    const dense = [raw[0]];
    for (let k = 0; k < raw.length - 1; k++) {
      const [ax, az] = raw[k], [bx, bz] = raw[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let j = 1; j <= n; j++) dense.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n]);
    }
    let run = [];
    for (const q of dense) {
      const nr = near.nearest(q[0], q[1], CLEAR + 1);
      // Crossing the walk: cut. Merely brushing it (the lane walls of rue
      // d'Orchampt, which the camera hugs on the bend): nudge out to CLEAR
      // so the coping clears the camera, and keep the wall.
      if (nr && nr.dist < 0.6) { if (run.length > 1) clipped.push([i, b, run]); run = []; continue; }
      if (nr && nr.dist < CLEAR) {
        const k = CLEAR / nr.dist;
        run.push([nr.x + (q[0] - nr.x) * k, nr.z + (q[1] - nr.z) * k]);
        continue;
      }
      run.push(q);
    }
    if (run.length > 1) clipped.push([i, b, run]);
  }
  for (const [i, b, pts] of clipped) {
    const c = pts[Math.floor(pts.length / 2)];
    const nr = near.nearest(c[0], c[1], 260);
    if (!nr) continue;                       // far outside anything visible
    for (let k = 0; k < pts.length - 1; k++) mapped.push([pts[k], pts[k + 1]]);
    if (b.k === 'hedge') { wallAlong(pts, 'hedge', b.h ?? 1.6, M, i); continue; }
    if (b.k === 'gate') continue;
    if (b.k === 'retaining_wall') { wallAlong(pts, 'rubble', b.h ?? 1.1, M, i); continue; }
    if (b.k === 'fence') {
      const kind = /chain|wire|mesh/.test(b.m) ? 'rail' : hash(i, 1) < 0.55 ? 'rail' : 'fence';
      wallAlong(pts, kind, b.h ?? 2.1, M, i);
      continue;
    }
    wallAlong(pts, hash(i, 2) < 0.75 ? 'rubble' : 'render', b.h ?? 2.3 + hash(i, 4) * 0.5, M, i);
  }

  // ---- 2. the gaps along the walk ------------------------------------------
  // Openings: any street, footway or flight of steps meeting the walk at an
  // angle. Pavements running alongside are not openings.
  const crossing = [];
  for (const s of GEO.surfaces ?? []) {
    const p = pairs(s.p);
    for (let k = 0; k < p.length - 1; k++) crossing.push([p[k], p[k + 1]]);
  }
  for (const r of GEO.roads ?? []) {
    const p = triples(r.p).map(([x, , z]) => [x, z]);
    for (let k = 0; k < p.length - 1; k++) crossing.push([p[k], p[k + 1]]);
  }
  // Gardens and parks behind the edge of the walk. A wide stretch of the walk
  // is an open square UNLESS one of these is behind it, in which case it is
  // a park's edge: square Suzanne-Buisson above rue Girardon, the square in
  // Place des Abbesses. Those get a low wall and a railing.
  const parks = [...(GEO.gardens ?? []).map((g) => pairs(g.o)), ...GEO.greens.map(pairs)];
  const behindPark = (x, z) => parks.some((r) => pointInRing(r, x, z));
  const STEP = 1.0;
  for (const side of [-1, 1]) {
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        const seed = Math.round(run[0].d);
        const h = hash(seed, side + 5);
        const kind = run[0].park ? 'rail' : h < 0.5 ? 'rubble' : h < 0.72 ? 'fence' : h < 0.9 ? 'render' : 'rail';
        const height = 2.1 + hash(seed, 7) * 0.7;
        const pts = run.map((q) => [q.x, q.z]);
        const len = run.length * STEP;
        // A gate in the longer runs, where gardens have their carriage door.
        if (len > 9 && hash(seed, 8) < 0.6) {
          const m = Math.floor(run.length / 2);
          const gw = 2.6;
          const cut = Math.ceil(gw / 2 / STEP) + 1;
          wallAlong(pts.slice(0, Math.max(2, m - cut + 1)), kind, height, M, seed);
          wallAlong(pts.slice(m + cut), kind, height, M, seed + 1);
          const a = run[m - 1], b = run[m + 1];
          const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
          gateAt(run[m].x, run[m].z, (b.x - a.x) / L, (b.z - a.z) / L, gw, M, seed);
        } else {
          wallAlong(pts, kind, height, M, seed);
        }
        // The garden's trees, a few metres behind the wall.
        for (let k = 1; k < run.length; k += 6) {
          const q = run[k];
          const back = 3 + hash(seed + k, 3) * 4;
          const tx = q.x + q.nx * back, tz = q.z + q.nz * back;
          if (!insideBuilding(tx, tz, 1.5)) gardenSpots.push([tx, tz, 8 + hash(seed + k, 6) * 8]);
        }
      }
      run = [];
    };
    for (let d = 0; d <= rail.length; d += STEP) {
      const p = rail.positionAt(d);
      const t = rail.tangentAt(d);
      const width = rail.widthAt(d);
      const nx = -t.z * side, nz = t.x * side;      // outward on this side
      const off = width / 2;
      const x = p.x + nx * off, z = p.z + nz * off;
      const park = behindPark(x + nx * 3, z + nz * 3);
      if (run.length && !!run[0].park !== park) flush();
      const open =
        width >= 12.5 ||                                          // a square, not a street
        insideBuilding(x + nx * 0.8, z + nz * 0.8, 0.7) ||          // a facade is here
        insideBuilding(x - nx * 0.3, z - nz * 0.3) ||
        nearSegments(mapped, x, z, 2.5) !== null;                  // OSM already drew it
      let opening = false;
      if (!open) {
        const seg = nearSegments(crossing, x + nx * 2, z + nz * 2, 3.2);
        if (seg) {
          const sx = seg[1][0] - seg[0][0], sz = seg[1][1] - seg[0][1];
          const sl = Math.hypot(sx, sz) || 1;
          opening = Math.abs((sx * t.x + sz * t.z) / sl) < 0.82;   // meets the walk at > 35 deg
        }
      }
      if (open || opening || groundAt(x, z) === null) { flush(); continue; }
      run.push({ x, z, d, nx, nz, park });
    }
    flush();
  }

  // ---- 3. OSM gate nodes not already on a gap run ---------------------------
  for (const [i, [x, , z]] of (GEO.pois.gate ?? []).entries()) {
    const nr = near.nearest(x, z, 30);
    if (!nr || nr.dist < 2.5) continue;
    const seg = nearSegments(mapped, x, z, 2);
    let ux, uz;
    if (seg) {
      const L = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) || 1;
      ux = (seg[1][0] - seg[0][0]) / L; uz = (seg[1][1] - seg[0][1]) / L;
    } else {
      const t = rail.tangentAt(nr.d);
      ux = t.x; uz = t.z;
    }
    gateAt(x, z, ux, uz, 2.4, M, 100 + i);
  }

  const group = new THREE.Group();
  group.name = 'boundaries';
  const vc = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, ...o });
  if (M.rubble.pos.length) {
    group.add(M.rubble.mesh('garden_walls', new THREE.MeshStandardMaterial({
      map: rubbleTexture(), vertexColors: true, roughness: 0.95, metalness: 0, color: new THREE.Color('#D3C9B6') })));
  }
  if (M.render.pos.length) group.add(M.render.mesh('rendered_walls', vc()));
  if (M.trim.pos.length) group.add(M.trim.mesh('wall_copings', vc()));
  if (M.hedge.pos.length) group.add(M.hedge.mesh('hedges', vc()));
  if (M.iron.pos.length) {
    const iron = M.iron.mesh('railings', vc({ roughness: 0.55, side: THREE.DoubleSide }));
    iron.castShadow = false;
    group.add(iron);
  }
  group.userData.gardenSpots = gardenSpots;
  group.userData.occluders = M.occluders;
  group.userData.gates = M.gates;
  return group;
}
