import { GEO, triples, insideBuilding, pairs, pointInRing } from './geo.js';

/**
 * The real cross-section of the street the walk runs down, every half metre.
 *
 * The walk's `width` in route.js is a CORRIDOR (wall to wall, capped at 14 m
 * for squares), and the street used to be drawn from it: on rue Girardon at
 * Place Dalida that made a 10 m cobbled expanse with no pavements and no
 * bollards, where the survey photograph shows a 4 m roadway between two
 * raised pavements lined with potelets. This replaces it with the street's
 * own measurements:
 *
 *   half       half the carriageway, from IGN BD TOPO's largeur_de_chaussee
 *              on the road the walk is running along
 *   pav[±1]    each pavement, from the kerb to whatever stands on that side
 *              (a facade, a mapped wall or fence), so a pavement runs up to
 *              the wall the way it does in the street
 *   open[±1]   true where nothing stands within reach on that side (a square,
 *              a garden behind railings set back): the pavement is a normal
 *              width and ground.js paves what lies beyond it
 *   road       false where the walk is not on a road (steps, the squares
 *              themselves): the old corridor rule applies there
 *
 * Smoothed along the walk so a kerb does not jitter at every footprint
 * corner.
 */
const STEP = 0.5;
let cache = null;

function barrierSegs() {
  const out = [];
  for (const b of GEO.barriers ?? []) {
    const p = triples(b.p);
    for (let i = 0; i < p.length - 1; i++) out.push([p[i][0], p[i][2], p[i + 1][0], p[i + 1][2]]);
  }
  return out;
}

function hitsBarrier(segs, ax, az, bx, bz) {
  for (const [cx, cz, dx, dz] of segs) {
    const r = [bx - ax, bz - az], s = [dx - cx, dz - cz];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((cx - ax) * s[1] - (cz - az) * s[0]) / den;
    const u = ((cx - ax) * r[1] - (cz - az) * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  }
  return null;
}

export function walkProfile(rail) {
  if (cache?.rail === rail) return cache.at;
  const segs = barrierSegs();
  const roads = [];
  for (const r of GEO.roads ?? []) {
    if (r.k !== 'road') continue;
    const p = triples(r.p);
    for (let i = 0; i < p.length - 1; i++) roads.push({ w: r.w, a: [p[i][0], p[i][2]], b: [p[i + 1][0], p[i + 1][2]] });
  }
  const REACH = 7;
  const n = Math.floor(rail.length / STEP) + 1;
  const raw = [];
  for (let i = 0; i < n; i++) {
    const d = i * STEP;
    const p = rail.positionAt(d), t = rail.tangentAt(d);
    // The road the walk is running ALONG, under it.
    let road = null, rd = 2.5;
    for (const s of roads) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = Math.hypot(dx, dz);
      if (L < 0.1) continue;
      if (Math.abs((dx * t.x + dz * t.z) / L) < 0.75) continue;
      const u = Math.max(0, Math.min(1, ((p.x - s.a[0]) * dx + (p.z - s.a[1]) * dz) / (L * L)));
      const fx = s.a[0] + dx * u, fz = s.a[1] + dz * u;
      const dd = Math.hypot(p.x - fx, p.z - fz);
      if (dd < rd) { rd = dd; road = { ...s, fx, fz }; }
    }
    const rx = -t.z, rz = t.x;
    // Where the road's centreline is, sideways from the walk (+ = right). The
    // walk was centred between facades, and on rue Girardon at Place Dalida
    // that put it two metres right of the road, with a row of kerb bollards
    // down the middle of the cobbles.
    const cen = road ? (road.fx - p.x) * rx + (road.fz - p.z) * rz : 0;
    const out = { road: !!road, half: road ? Math.max(1.6, Math.min(5, road.w / 2)) : null, cen, wall: {} };
    for (const side of [-1, 1]) {
      // March out to the first building or mapped wall on this side.
      let wall = null;
      for (let k = 0.5; k <= REACH + (out.half ?? 0); k += 0.25) {
        if (insideBuilding(p.x + rx * side * k, p.z + rz * side * k)) { wall = k; break; }
      }
      const bt = hitsBarrier(segs, p.x, p.z, p.x + rx * side * (REACH + 5), p.z + rz * side * (REACH + 5));
      if (bt !== null) {
        const bk = bt * (REACH + 5);
        if (wall === null || bk < wall) wall = bk;
      }
      out.wall[side] = wall;
    }
    raw.push(out);
  }
  // Smooth the carriageway and the wall distances over ±3 m.
  const W = Math.round(3 / STEP);
  const prof = raw.map((r, i) => {
    let hs = 0, hn = 0, cs = 0;
    const ws = { [-1]: [0, 0], [1]: [0, 0] };
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
      if (raw[j].half !== null) { hs += raw[j].half; cs += raw[j].cen; hn++; }
      for (const s of [-1, 1]) if (raw[j].wall[s] !== null) { ws[s][0] += raw[j].wall[s]; ws[s][1]++; }
    }
    const half = r.road && hn ? hs / hn : null;
    // Never so far off that the camera is outside the carriageway.
    const cen = half !== null ? Math.max(-(half - 0.6), Math.min(half - 0.6, cs / hn)) : 0;
    const pav = {}, open = {};
    for (const s of [-1, 1]) {
      const wall = r.wall[s] !== null && ws[s][1] ? ws[s][0] / ws[s][1] : null;
      if (half === null) { pav[s] = null; open[s] = true; continue; }
      if (wall === null || wall - (half + s * cen) > 4.5) { pav[s] = 2.0; open[s] = true; continue; }
      pav[s] = Math.max(0.9, wall - (half + s * cen) - 0.05);
      open[s] = false;
    }
    return { road: half !== null, half, cen, pav, open };
  });
  // Where a kerb would fall inside a square (an OSM pedestrian area), that
  // side has no kerb: the square is one flush surface (Place Dalida, where
  // the left kerb of rue Girardon starts at the square's edge and curves
  // away, instead of running on down to the steps).
  const plazas = (GEO.plazas ?? []).map((q) => pairs(q.o));
  const inPlaza = (x, z) => plazas.some((r) => pointInRing(r, x, z));
  prof.forEach((pr, i) => {
    pr.flush = { [-1]: false, [1]: false };
    if (!pr.road) return;
    const d = i * STEP, p = rail.positionAt(d), t = rail.tangentAt(d);
    for (const s of [-1, 1]) {
      const o = pr.cen + pr.half * s;
      pr.flush[s] = inPlaza(p.x - t.z * o, p.z + t.x * o);
    }
  });
  const at = (d) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(d / STEP)));
    return prof[i];
  };
  cache = { rail, at };
  return at;
}

/**
 * Carriageway half-width and per-side pavement at d, falling back to the
 * corridor rule where the walk is not on a road. The one function every
 * builder asks, so the street, the ground grid, the bollards and the parked
 * cars agree on where the kerb is.
 */
export function streetAt(rail, d) {
  const p = walkProfile(rail)(d);
  if (p.road) return { half: p.half, cen: p.cen, pav: p.pav, open: p.open, flush: p.flush, road: true };
  const total = rail.widthAt(d);
  const pavement = Math.max(0.8, Math.min(2.4, total * 0.18));
  const half = Math.max(1.5, total * 0.5 - pavement);
  return { half, cen: 0, pav: { [-1]: pavement, [1]: pavement }, open: { [-1]: true, [1]: true }, flush: { [-1]: false, [1]: false }, road: false };
}
