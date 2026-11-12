import * as THREE from 'three';
import { GEO, groundAt, pairs, triples, pointInRing, insideBuilding, surfaceAt, nearestWall } from './geo.js';
import { surfaceTexture, SURFACE_TINT } from '../render/textures.js';

/**
 * The ground around the walk, as one surface.
 *
 * WHY. The ground used to be four builders laid on top of each other: the
 * terrain mesh, a ribbon per side street with its own pavement strips, the
 * walk's own carriageway and pavements, and kerbs. Each was right on its own
 * and they disagreed everywhere they met — overlapping at every junction,
 * leaving sand-coloured gaps between, and running raised pavement strips
 * diagonally across crossings. Fixing them pair by pair did not converge.
 *
 * So every point within GROUND_R of the walk is classified ONCE, on a 0.75 m
 * grid, and each triangle of the grid draws exactly one surface:
 *
 *   building   nothing (the footprint has its own walls down to the ground)
 *   walk       nothing (street.js draws the walk's carriageway and pavements,
 *              higher; the grid is held just under them so it shows only at
 *              the side-street mouths, where they stop)
 *   road       a side street's carriageway, in its OSM surface
 *   pavement   the 1.6 m either side of a side street
 *   steps      a flight of public steps
 *   green      a garden, park or planted bed
 *   open       everything else: squares, courts, the forecourts of the
 *              Butte, paved as OSM says or in the nearest street's surface
 *
 * Classification is per triangle (by its centroid), so boundaries come out as
 * a fine diagonal staircase instead of square teeth. Heights are the measured
 * terrain, with pavements and open paving a kerb above the roadway.
 */

export const GROUND_R = 46;
const CELL = 0.75;
const KERB = 0.12;
const PAVE = 1.6;   // pavement width along a facade

function segIndex(near, rail) {
  const idx = new Map();
  const segs = [];
  for (const r of GEO.roads ?? []) {
    const p = triples(r.p);
    for (let i = 0; i < p.length - 1; i++) {
      const a = [p[i][0], p[i][2]], b = [p[i + 1][0], p[i + 1][2]];
      const ya = p[i][1], yb = p[i + 1][1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      // The walk itself: a segment running along the rail inside its corridor.
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const nr = near.nearest(mx, mz, 12);
      if (nr) {
        const t = rail.tangentAt(nr.d);
        const along = Math.abs(((b[0] - a[0]) * t.x + (b[1] - a[1]) * t.z) / L);
        if (nr.dist < rail.widthAt(nr.d) * 0.5 + 1.5 && along > 0.6) continue;
      }
      const seg = { r, a, b, ya, yb, h: r.w / 2, edge: r.k === 'road' ? 1.6 : 0 };
      segs.push(seg);
      const pad = seg.h + seg.edge + 1;
      for (let ci = Math.floor((Math.min(a[0], b[0]) - pad) / 10); ci <= Math.floor((Math.max(a[0], b[0]) + pad) / 10); ci++) {
        for (let cj = Math.floor((Math.min(a[1], b[1]) - pad) / 10); cj <= Math.floor((Math.max(a[1], b[1]) + pad) / 10); cj++) {
          const k = `${ci},${cj}`;
          if (!idx.has(k)) idx.set(k, []);
          idx.get(k).push(seg);
        }
      }
    }
  }
  /** The street whose carriageway or pavement holds (x, z), carriageway first. */
  const at = (x, z) => {
    let road = null, rd = Infinity, pave = null, pd = Infinity;
    for (const s of idx.get(`${Math.floor(x / 10)},${Math.floor(z / 10)}`) ?? []) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(x - s.a[0] - dx * t, z - s.a[1] - dz * t);
      const y = s.ya + (s.yb - s.ya) * t;
      if (d <= s.h && d - s.h < rd) { road = s; rd = d - s.h; road.yAt = y; }
      else if (d <= s.h + s.edge && d < pd) { pave = s; pd = d; pave.yAt = y; }
    }
    return road ? { kind: road.r.k === 'stairs' ? 'steps' : road.r.k === 'path' ? 'open' : 'road', seg: road, y: road.yAt }
      : pave ? { kind: 'pavement', seg: pave, y: pave.yAt } : null;
  };
  /**
   * The nearest kerb line (a carriageway edge) to (x, z) within `maxD`, as the
   * point on it: grid vertices are snapped there so kerbs come out straight.
   */
  at.kerb = (x, z, maxD) => {
    let best = null, bd = maxD;
    for (const s of idx.get(`${Math.floor(x / 10)},${Math.floor(z / 10)}`) ?? []) {
      if (s.r.k !== 'road') continue;
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2));
      const px = s.a[0] + dx * t, pz = s.a[1] + dz * t;
      const d = Math.hypot(x - px, z - pz) || 1e-9;
      for (const line of [s.h]) {
        const off = Math.abs(d - line);
        if (off < bd) { bd = off; best = [px + (x - px) / d * line, pz + (z - pz) / d * line]; }
      }
    }
    return best;
  };
  /**
   * The ground height at (x, z) implied by the streets around it: every
   * street within REACH contributes its centreline height at the nearest
   * point, weighted by closeness. Used for everything near a street (roads,
   * pavements, corners, the open setts of a junction) so they all lie on one
   * continuous surface; the terrain model only takes over away from streets.
   */
  const REACH = 14;
  at.streetHeight = (x, z) => {
    let wsum = 0, ysum = 0, dmin = Infinity;
    const seen = new Map();
    for (const s of idx.get(`${Math.floor(x / 10)},${Math.floor(z / 10)}`) ?? []) {
      if (s.r.k === 'stairs') continue;
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / (dx * dx + dz * dz)));
      const d = Math.max(0, Math.hypot(x - s.a[0] - dx * t, z - s.a[1] - dz * t) - s.h);
      if (d > REACH) continue;
      // One contribution per street: its nearest segment.
      const prev = seen.get(s.r);
      if (prev && prev.d <= d) continue;
      seen.set(s.r, { d, y: s.ya + (s.yb - s.ya) * t });
    }
    for (const { d, y } of seen.values()) {
      const w = 1 / ((d + 0.5) * (d + 0.5));
      wsum += w; ysum += w * y; dmin = Math.min(dmin, d);
    }
    return wsum ? { y: ysum / wsum, d: dmin } : null;
  };
  at.REACH = REACH;
  return at;
}

export function buildGround(rail, near, { debug = null } = {}) {
  /**
   * The walk at its exact nearest point to (x, z), not the nearest 2 m
   * sample: on a 15% street a 2 m sample is 30 cm of height, and using it
   * terraced every surface near the walk into steps.
   */
  const fine = [];
  for (let d = 0; d <= rail.length; d += 0.25) fine.push(rail.positionAt(d));
  const foot = (x, z, maxR = 30) => {
    const nr = near.nearest(x, z, maxR);
    if (!nr) return null;
    let best = null, bd = Infinity;
    const i0 = Math.max(0, Math.floor((nr.d - 2.5) / 0.25)), i1 = Math.min(fine.length - 1, Math.ceil((nr.d + 2.5) / 0.25));
    for (let i = i0; i <= i1; i++) {
      const p = fine[i], e = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (e < bd) { bd = e; best = i; }
    }
    const p = fine[best];
    return { d: best * 0.25, x: p.x, y: p.y, z: p.z, dist: Math.sqrt(bd) };
  };

  const streetAt = segIndex(near, rail);
  // Ground colour from OSM's gardens, parks and lawns only. BD TOPO's
  // vegetation zones ("Bois", "Haie") are tree CANOPY read off aerial photos,
  // not what is on the ground: the street trees over the café terraces of rue
  // des Abbesses came out as a lawn under the tables. They still plant trees
  // (realtrees.js), which is what they are.
  const greens = [...(GEO.gardens ?? [])
    .filter((g) => g.k !== 'cemetery').map((g) => pairs(g.o))]
    .map((ring) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, area = 0, per = 0;
      ring.forEach(([x, z], i) => {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        const [nx, nz] = ring[(i + 1) % ring.length];
        area += x * nz - nx * z; per += Math.hypot(nx - x, nz - z);
      });
      // Mean width of the polygon. The planted strips down rue Caulaincourt
      // and along the squares are packed sand under trees in every survey
      // photo, not lawn; only the gardens proper are grass.
      const width = Math.abs(area) / (per / 2 || 1);
      return { ring, x0, z0, x1, z1, sand: width < 7 };
    });
  const greenAt = (x, z) => greens.find((g) => x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1 && pointInRing(g.ring, x, z));

  // The walk's own corridor, as street.js lays it out.
  const walk = (x, z) => {
    const nr = foot(x, z, 16);
    if (!nr) return null;
    const w = rail.widthAt(nr.d);
    const pav = Math.max(0.8, Math.min(2.4, w * 0.18));
    const half = Math.max(1.5, w * 0.5 - pav);
    return { nr, inCarriage: nr.dist < half - 0.1, inCorridor: nr.dist < half + pav + 0.15 };
  };

  /** Classify one point: { surf, lift, tint } or null for nothing drawn. */
  const classify = (x, z) => {
    const wk = walk(x, z);
    if (wk?.inCarriage) return null;
    if (insideBuilding(x, z)) return null;
    const st = streetAt(x, z);
    // Inside the walk's corridor the walk's pavements are on top; below them
    // the grid only shows at side-street mouths, where it continues the side
    // street's own carriageway up to the walk's kerb.
    // Inside the walk's corridor the grid sits just under the walk's own
    // pavements (which are 0.14 above the rail), so it is invisible where
    // they are drawn and fills in wherever they stop.
    const cap = wk?.inCorridor ? wk.nr.y + 0.06 : undefined;
    const c = classifyOpen(x, z, st);
    if (cap !== undefined) { c.cap = cap; c.lift = 0; }
    return c;
  };
  const classifyOpen = (x, z, st) => {
    if (st?.kind === 'road') return { surf: roadSurf(x, z, st.seg), lift: 0 };
    if (st?.kind === 'steps') return { surf: 'steps', lift: 0 };
    // A pavement is the strip along a building front, off the roadway:
    // that is where Paris lays them, and its kerb then follows the facade
    // line instead of an offset of some street's centreline drawn across a
    // junction.
    const wall = nearestWall(x, z, PAVE);
    if (wall && (st?.kind === 'pavement' || wall.dist < PAVE)) {
      const own = surfaceAt(x, z, { footway: true, maxR: 2.5, fallback: null });
      const near = st?.seg ? surfaceAt(x, z, { maxR: 8, fallback: 'asphalt' }) : 'asphalt';
      const surf = own ?? (near === 'sett' ? 'asphalt' : 'asphalt');
      return { surf: surf === 'sett' ? 'sett' : surf === 'paving' ? 'paving' : 'asphalt', lift: KERB, pavement: true };
    }
    const gr = greenAt(x, z);
    if (gr) return { surf: gr.sand ? 'gravel' : 'green', lift: 0.02 };
    const own = surfaceAt(x, z, { footway: true, maxR: 5, fallback: null });
    const surf = own ?? surfaceAt(x, z, { maxR: 14, fallback: 'asphalt' });
    // Open ground (forecourts, the corners of junctions, squares) lies flush
    // with the streets it joins: in the survey photos only a street's own
    // pavement stands a kerb above the road. Raising it too terraced every
    // ragged edge between the two into a flight of little steps.
    return { surf: surf === 'gravel' ? 'gravel' : surf === 'sett' ? 'sett' : surf === 'paving' ? 'paving' : 'asphalt', lift: 0.02 };
  };
  // A street's carriageway wears its OWN surface: the majority of OSM's
  // surface tags on ways of the same name. Asking for the nearest tagged way
  // put cobbles on rue Caulaincourt wherever a cobbled lane joined it.
  const norm = (n) => (n || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  const byName = new Map();
  for (const sf of GEO.surfaces ?? []) {
    if (sf.fw || !sf.n) continue;
    const k = norm(sf.n);
    if (!byName.has(k)) byName.set(k, {});
    const c = byName.get(k);
    c[sf.s] = (c[sf.s] ?? 0) + pairs(sf.p).length;
  }
  const own = new Map([...byName].map(([k, c]) => [k, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]]));
  // A street tagged with more than one surface (rue des Abbesses: setts at
  // the Ravignan end, paving toward the square) keeps the nearest way's tag.
  const mixed = new Set([...byName].filter(([, c]) => Object.keys(c).length > 1).map(([k]) => k));
  const roadSurf = (x, z, seg) => {
    const k = seg && norm(seg.r.n);
    const named = k && !mixed.has(k) ? own.get(k) : null;
    const s = named ?? surfaceAt(x, z, { fallback: 'asphalt' });
    return s === 'paving' ? 'sett' : s === 'gravel' ? 'gravel' : s;
  };

  // Bounds of the zone.
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of near.pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  x0 = Math.floor((x0 - GROUND_R) / CELL) * CELL; z0 = Math.floor((z0 - GROUND_R) / CELL) * CELL;
  x1 += GROUND_R; z1 += GROUND_R;

  const out = new Map();     // surf -> { pos, uv, col }
  const put = (surf, a, b, c) => {
    if (!out.has(surf)) out.set(surf, { pos: [], uv: [], col: [] });
    const o = out.get(surf);
    const tint = surf === 'green' ? GREEN : surf === 'steps' ? STEP : SURFACE_TINT[surf] ?? SURFACE_TINT.asphalt;
    for (const v of [a, b, c]) {
      o.pos.push(v[0], v[1], v[2]);
      o.uv.push(v[0], v[2]);
      const j = 0.97 + ((Math.floor(v[0] * 1.3) * 7 + Math.floor(v[2] * 1.3) * 13) % 5) * 0.012;
      o.col.push(tint.r * j, tint.g * j, tint.b * j);
    }
  };
  const H = new Map();
  const height = (x, z) => {
    const k = `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
    if (!H.has(k)) H.set(k, groundAt(x, z));
    return H.get(k);
  };

  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const NV = (nx + 1) * (nz + 1);
  const vi = (i, j) => i * (nz + 1) + j;

  // Distance from every grid vertex to the walk, by stamping each rail sample
  // onto the grid (a nearest-sample query per vertex was most of the build).
  const VDS = new Float32Array(NV).fill(Infinity), VDI = new Int32Array(NV).fill(-1);
  near.pts.forEach((p, si) => {
    const ia = Math.max(0, Math.floor((p.x - GROUND_R - 2 - x0) / CELL)), ib = Math.min(nx, Math.ceil((p.x + GROUND_R + 2 - x0) / CELL));
    const ja = Math.max(0, Math.floor((p.z - GROUND_R - 2 - z0) / CELL)), jb = Math.min(nz, Math.ceil((p.z + GROUND_R + 2 - z0) / CELL));
    for (let i = ia; i <= ib; i++) {
      const dx = x0 + i * CELL - p.x;
      for (let j = ja; j <= jb; j++) {
        const dz = z0 + j * CELL - p.z, d2 = dx * dx + dz * dz;
        const k = vi(i, j);
        if (d2 < VDS[k]) { VDS[k] = d2; VDI[k] = si; }
      }
    }
  });

  // Pass 0: grid vertices, snapped onto the nearest kerb line when within
  // half a cell of it, so a street's edge is a straight line, not a staircase.
  const VX = new Float32Array(NV), VZ = new Float32Array(NV);
  const live = new Uint8Array(NV);
  const VD = new Float32Array(NV).fill(Infinity);   // distance to the walk
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const k = vi(i, j);
      let x = x0 + i * CELL, z = z0 + j * CELL;
      if (VDI[k] < 0) continue;
      const nr = { ...near.pts[VDI[k]], dist: Math.sqrt(VDS[k]) };
      if (nr.dist > GROUND_R + 1) continue;
      live[k] = 1;
      VD[k] = nr.dist;
      // Candidate lines: the nearest side street's kerb, and the walk's own
      // carriageway edge and pavement edge (where street.js stops). Whichever
      // is within half a cell and nearest wins.
      let best = null, bd = CELL * 0.6;
      const kp = streetAt.kerb(x, z, CELL * 0.6);
      if (kp) { best = kp; bd = Math.hypot(kp[0] - x, kp[1] - z); }
      const w = rail.widthAt(nr.d);
      const pav = Math.max(0.8, Math.min(2.4, w * 0.18));
      const half = Math.max(1.5, w * 0.5 - pav);
      if (Math.abs(nr.dist - half) < 1.5 || Math.abs(nr.dist - half - pav) < 1.5) {
        // Exact foot of the perpendicular on the rail, near the 2 m sample.
        let fd = nr.d, fdist = Infinity, fp = null;
        for (let dd = nr.d - 2; dd <= nr.d + 2; dd += 0.2) {
          if (dd < 0 || dd > rail.length) continue;
          const q = rail.positionAt(dd);
          const e = Math.hypot(q.x - x, q.z - z);
          if (e < fdist) { fdist = e; fd = dd; fp = q; }
        }
        if (fp) {
          for (const line of [half, half + pav]) {
            const off = Math.abs(fdist - line);
            if (off < bd) {
              bd = off;
              const ux = (x - fp.x) / (fdist || 1), uz = (z - fp.z) / (fdist || 1);
              best = [fp.x + ux * line, fp.z + uz * line];
            }
          }
        }
      }
      // The pavement's kerb line: PAVE out from the nearest facade, but only
      // where no street kerb is in reach: two nearly-coincident lines to
      // snap to made every kerb wobble between them.
      const wl = kp ? null : nearestWall(x, z, PAVE + CELL);
      if (wl && wl.dist > 0.05) {
        const off = Math.abs(wl.dist - PAVE);
        if (off < bd) {
          bd = off;
          best = [wl.x + (x - wl.x) / wl.dist * PAVE, wl.z + (z - wl.z) / wl.dist * PAVE];
        }
      }
      if (best) { x = best[0]; z = best[1]; }
      VX[k] = x; VZ[k] = z;
    }
  }

  // Base height per vertex: the street's own profile on a street, the terrain
  // elsewhere, eased into the walk's level near the walk.
  const BLEND = 8;
  const HB = new Float32Array(NV).fill(NaN);
  for (let k = 0; k < NV; k++) {
    if (!live[k]) continue;
    const x = VX[k], z = VZ[k];
    let g = groundAt(x, z);
    if (g === null) continue;
    // One continuous surface: the streets' own profiles near streets, the
    // terrain model away from them, eased between over the last 6 m of reach.
    const sh = streetAt.streetHeight(x, z);
    if (sh) {
      const f = Math.max(0, Math.min(1, (sh.d - (streetAt.REACH - 6)) / 6));
      g = sh.y + (g - sh.y) * f * f * (3 - 2 * f);
    }
    const nr = foot(x, z, 30);
    if (nr) {
      const f = Math.max(0, Math.min(1, (nr.dist - rail.widthAt(nr.d) * 0.5) / BLEND));
      g = nr.y + (g - nr.y) * f * f * (3 - 2 * f);
    }
    HB[k] = g;
  }

  // Pass 1: classify each triangle at its (snapped) centroid and emit it at
  // its OWN height. Pass 2 closes every step between neighbours with a
  // vertical kerb face, so nothing is a ramp and nothing is a hole.
  const TRI = [[[0, 0], [1, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]]];
  const edges = new Map();
  const kerbs = { pos: [], col: [] };
  const KCOL = new THREE.Color('#A9A69E');
  const face = (a, b, ya0, yb0, ya1, yb1) => {
    // Vertical quad along a-b from the lower to the upper surface, both sides.
    const lo0 = Math.min(ya0, ya1), hi0 = Math.max(ya0, ya1), lo1 = Math.min(yb0, yb1), hi1 = Math.max(yb0, yb1);
    if (hi0 - lo0 < 0.02 && hi1 - lo1 < 0.02) return;
    const q = [[a[0], lo0, a[1]], [b[0], lo1, b[1]], [b[0], hi1, b[1]], [a[0], hi0, a[1]]];
    for (const order of [[0, 1, 2, 0, 2, 3], [0, 2, 1, 0, 3, 2]]) {
      for (const n of order) { kerbs.pos.push(...q[n]); kerbs.col.push(KCOL.r, KCOL.g, KCOL.b); }
    }
  };
  let tris = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      for (let t = 0; t < 2; t++) {
        const ks = TRI[t].map(([di, dj]) => vi(i + di, j + dj));
        if (ks.some((k) => !live[k] || Number.isNaN(HB[k]))) continue;
        const mx = (VX[ks[0]] + VX[ks[1]] + VX[ks[2]]) / 3, mz = (VZ[ks[0]] + VZ[ks[1]] + VZ[ks[2]]) / 3;
        if (Math.min(VD[ks[0]], VD[ks[1]], VD[ks[2]]) > GROUND_R) continue;
        const c = classify(mx, mz);
        const ys = ks.map((k) => {
          if (!c) return NaN;
          let y = HB[k] + c.lift;
          if (c.cap !== undefined) y = Math.min(y, c.cap);
          return y;
        });
        if (c && debug) debug.push([VX[ks[0]], VZ[ks[0]], VX[ks[1]], VZ[ks[1]], VX[ks[2]], VZ[ks[2]], c.surf + (c.pavement ? '+' : '') + (c.cap !== undefined ? '^' : ''), ys[0]]);
        if (c) {
          put(c.surf, [VX[ks[0]], ys[0], VZ[ks[0]]], [VX[ks[1]], ys[1], VZ[ks[1]]], [VX[ks[2]], ys[2], VZ[ks[2]]]);
          tris++;
        }
        // Record each edge with this triangle's heights at its two ends.
        for (let e = 0; e < 3; e++) {
          const ka = ks[e], kb = ks[(e + 1) % 3];
          const key = ka < kb ? `${ka}_${kb}` : `${kb}_${ka}`;
          const ya = ys[e], yb = ys[(e + 1) % 3];
          const prev = edges.get(key);
          if (!prev) { edges.set(key, { ka, kb, ya, yb }); continue; }
          edges.delete(key);
          // Both sides drawn and at different heights: a kerb.
          if (!c || Number.isNaN(prev.ya)) continue;
          const pa = prev.ka === ka ? prev.ya : prev.yb, pb = prev.ka === ka ? prev.yb : prev.ya;
          face([VX[ka], VZ[ka]], [VX[kb], VZ[kb]], ya, yb, pa, pb);
        }
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'ground';
  for (const [surf, o] of out) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const map = surf === 'green' ? null : surf === 'steps' ? surfaceTexture('paving') : surfaceTexture(surf);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, map, roughness: surf === 'sett' ? 0.85 : 0.93, metalness: 0, flatShading: !map }));
    m.name = `ground_${surf}`;
    m.receiveShadow = true;
    group.add(m);
  }
  if (kerbs.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(kerbs.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(kerbs.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true }));
    m.name = 'ground_kerbs';
    m.receiveShadow = true;
    group.add(m);
  }
  group.userData.stats = { tris, kerbs: kerbs.pos.length / 9 };
  return group;
}

const GREEN = new THREE.Color('#5E7340');
const STEP = new THREE.Color('#B3ACA0');
