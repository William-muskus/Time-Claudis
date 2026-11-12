import GEO from '../data/geo/montmartre.json' with { type: 'json' };

/**
 * The real Montmartre, as data.
 *
 * src/data/geo/montmartre.json is produced by tools/geo/build.py from IGN BD
 * TOPO (buildings, streets), IGN RGE ALTI (terrain), the Ville de Paris tree
 * inventory and OpenStreetMap (shops, entrances, fountains, lamps). It is
 * already in the game's local frame — metres, origin at the Dalida bust, +X
 * east, +Y up, +Z south — so nothing here does any projection.
 *
 * Everything that stands on the ground asks THIS module how high the ground
 * is, so the buildings, the trees, the terrain mesh and the street all agree.
 * The single most visible failure of a data-driven city is things floating
 * or sinking by a metre because two builders sampled the ground differently.
 */
export { GEO };

/**
 * Terrain height at (x, z), bilinear, from the finest grid that covers it.
 * Returns null outside every grid.
 */
export function groundAt(x, z) {
  for (const g of GEO.terrain) {
    const fx = (x - g.x0) / g.dx;
    const fz = (z - g.z0) / g.dz;
    if (fx < 0 || fz < 0 || fx >= g.cols - 1 || fz >= g.rows - 1) continue;
    const j = Math.floor(fx), i = Math.floor(fz);
    const tx = fx - j, tz = fz - i;
    const c = g.cols, y = g.y;
    const a = y[i * c + j] * (1 - tx) + y[i * c + j + 1] * tx;
    const b = y[(i + 1) * c + j] * (1 - tx) + y[(i + 1) * c + j + 1] * tx;
    return a * (1 - tz) + b * tz;
  }
  return null;
}

/** Flat [x0, z0, x1, z1, ...] → [[x, z], ...] */
export function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** Flat [x0, y0, z0, ...] → [[x, y, z], ...] */
export function triples(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/**
 * A spatial index over rail samples, for "how far is this from the walk?"
 * asked a few thousand times during world build.
 */
export function railIndex(rail, step = 2) {
  const pts = [];
  for (let d = 0; d <= rail.length; d += step) {
    const p = rail.positionAt(d);
    pts.push({ x: p.x, y: p.y, z: p.z, d });
  }
  const CELL = 20;
  const cells = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const p of pts) {
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(p);
  }
  /** Nearest rail sample within `maxR` metres, or null. */
  function nearest(x, z, maxR = 60) {
    const r = Math.ceil(maxR / CELL);
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let best = null, bd = maxR * maxR;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const list = cells.get(key(i, j));
        if (!list) continue;
        for (const p of list) {
          const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d2 < bd) { bd = d2; best = p; }
        }
      }
    }
    return best ? { ...best, dist: Math.sqrt(bd) } : null;
  }
  return { pts, nearest };
}

/**
 * Is (x, z) inside a real building footprint?
 *
 * Asked by everything that places furniture by rule — lamps every twenty
 * metres, the odd Morris column — because a rule that was safe on procedural
 * street walls, which were set back exactly half the street width, is not
 * safe against a cadastre where a building can stand a metre from the
 * centreline of rue d'Orchampt.
 */
let _bIndex = null;
export function insideBuilding(x, z, margin = 0) {
  if (!_bIndex) {
    _bIndex = new Map();
    for (const b of GEO.buildings) {
      const ring = pairs(b.o);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [a, c] of ring) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); z0 = Math.min(z0, c); z1 = Math.max(z1, c); }
      const e = { ring, x0, z0, x1, z1 };
      for (let i = Math.floor(x0 / 20); i <= Math.floor(x1 / 20); i++) {
        for (let j = Math.floor(z0 / 20); j <= Math.floor(z1 / 20); j++) {
          const k = `${i},${j}`;
          if (!_bIndex.has(k)) _bIndex.set(k, []);
          _bIndex.get(k).push(e);
        }
      }
    }
  }
  const list = _bIndex.get(`${Math.floor(x / 20)},${Math.floor(z / 20)}`);
  if (!list) return false;
  for (const e of list) {
    if (x < e.x0 - margin || x > e.x1 + margin || z < e.z0 - margin || z > e.z1 + margin) continue;
    if (pointInRing(e.ring, x, z)) return true;
    if (margin > 0 && distToRing(e.ring, x, z) < margin) return true;
  }
  return false;
}

export function pointInRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function distToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * What the street is paved with at (x, z): 'sett', 'asphalt', 'paving',
 * 'gravel', or `fallback` where OpenStreetMap says nothing within `maxR`.
 *
 * `footway` asks about the pavement rather than the carriageway: OSM maps
 * many of the route's pavements as their own footways, and on rue Girardon the
 * road is granite setts while the pavement beside it is asphalt.
 */
let _sIndex = null;
export function surfaceAt(x, z, { footway = false, maxR = 9, fallback = 'asphalt' } = {}) {
  if (!_sIndex) {
    _sIndex = new Map();
    for (const s of GEO.surfaces ?? []) {
      const p = pairs(s.p);
      for (let i = 0; i < p.length - 1; i++) {
        const seg = { a: p[i], b: p[i + 1], s: s.s, fw: !!s.fw };
        const x0 = Math.min(seg.a[0], seg.b[0]), x1 = Math.max(seg.a[0], seg.b[0]);
        const z0 = Math.min(seg.a[1], seg.b[1]), z1 = Math.max(seg.a[1], seg.b[1]);
        for (let ci = Math.floor((x0 - 10) / 20); ci <= Math.floor((x1 + 10) / 20); ci++) {
          for (let cj = Math.floor((z0 - 10) / 20); cj <= Math.floor((z1 + 10) / 20); cj++) {
            const k = `${ci},${cj}`;
            if (!_sIndex.has(k)) _sIndex.set(k, []);
            _sIndex.get(k).push(seg);
          }
        }
      }
    }
  }
  let best = null, bd = maxR;
  for (const seg of _sIndex.get(`${Math.floor(x / 20)},${Math.floor(z / 20)}`) ?? []) {
    if (seg.fw !== footway) continue;
    const d = distToSeg(seg.a, seg.b, x, z);
    if (d < bd) { bd = d; best = seg; }
  }
  return best ? best.s : fallback;
}

function distToSeg([ax, az], [bx, bz], x, z) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/**
 * Is (x, z) on the carriageway of a street OTHER than the walk (and other
 * than `self`, a GEO.roads entry, when given)? `pad` widens the street.
 *
 * Junctions were built as if streets did not meet: the walk's pavement ran
 * straight across the mouth of every side street, side streets were drawn
 * across the walk and across each other with their raised pavements, and the
 * kerb bollards of all of them marched through the middle of the crossing
 * (rue Lepic at rue d'Orchampt, rue Ravignan at rue d'Orchampt). Everything
 * that belongs to one street now asks this before it is put down.
 */
let _rIndex = null;
export function onOtherStreet(x, z, { near = null, rail = null, self = null, pad = 0 } = {}) {
  if (!_rIndex) {
    _rIndex = new Map();
    for (const r of GEO.roads ?? []) {
      if (r.k === 'stairs' || r.k === 'path') continue;
      const p = triples(r.p);
      for (let i = 0; i < p.length - 1; i++) {
        const seg = { r, a: [p[i][0], p[i][2]], b: [p[i + 1][0], p[i + 1][2]], h: r.w / 2 };
        const x0 = Math.min(seg.a[0], seg.b[0]) - 10, x1 = Math.max(seg.a[0], seg.b[0]) + 10;
        const z0 = Math.min(seg.a[1], seg.b[1]) - 10, z1 = Math.max(seg.a[1], seg.b[1]) + 10;
        for (let ci = Math.floor(x0 / 20); ci <= Math.floor(x1 / 20); ci++) {
          for (let cj = Math.floor(z0 / 20); cj <= Math.floor(z1 / 20); cj++) {
            const k = `${ci},${cj}`;
            if (!_rIndex.has(k)) _rIndex.set(k, []);
            _rIndex.get(k).push(seg);
          }
        }
      }
    }
  }
  for (const seg of _rIndex.get(`${Math.floor(x / 20)},${Math.floor(z / 20)}`) ?? []) {
    if (seg.r === self) continue;
    if (distToSeg(seg.a, seg.b, x, z) > seg.h + pad) continue;
    // A segment that runs along the walk IS the walk: not another street.
    if (near && rail) {
      const mx = (seg.a[0] + seg.b[0]) / 2, mz = (seg.a[1] + seg.b[1]) / 2;
      const nr = near.nearest(mx, mz, 12);
      if (nr) {
        const L = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]) || 1;
        const t = rail.tangentAt(nr.d);
        const along = Math.abs(((seg.b[0] - seg.a[0]) * t.x + (seg.b[1] - seg.a[1]) * t.z) / L);
        if (nr.dist < rail.widthAt(nr.d) * 0.5 + 1.5 && along > 0.6) continue;
      }
    }
    return true;
  }
  return false;
}
