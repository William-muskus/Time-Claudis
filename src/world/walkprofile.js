import { GEO, triples, insideBuilding, pairs, pointInRing } from './geo.js';
import FACADES from '../data/geo/facades.json' with { type: 'json' };

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

function sidewalkSegs() {
  const out = [];
  for (const w of GEO.sidewalks ?? []) {
    const p = pairs(w.p);
    for (let i = 0; i < p.length - 1; i++) out.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
  }
  return out;
}

/**
 * Where a mapped pavement (OSM footway=sidewalk, drawn down the middle of the
 * pavement) crosses the ray from the walk out to side `side`, running along
 * the walk: its distance out, or null.
 */
function sidewalkAt(sw, p, t, side, reach) {
  const rx = -t.z * side, rz = t.x * side;
  let best = null;
  for (const [ax, az, bx, bz] of sw) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.2 || Math.abs((dx * t.x + dz * t.z) / L) < 0.85) continue;
    const den = rx * dz - rz * dx;
    if (Math.abs(den) < 1e-9) continue;
    const k = ((ax - p.x) * dz - (az - p.z) * dx) / den;
    const u = ((ax - p.x) * rz - (az - p.z) * rx) / den;
    if (u < 0 || u > 1 || k < 0.3 || k > reach) continue;
    if (best === null || k < best) best = k;
  }
  return best;
}

/**
 * Stretches where the survey photographs and the aerial photograph show a
 * cross-section the maps cannot: facades.json "streets", each a span of the
 * walk (waypoint + metres) with the pavement widths as measured.
 */
export function recordedStreets(rail) {
  const out = [];
  for (const r of FACADES.streets ?? []) {
    try {
      const a = rail.distanceToWaypoint(r.from[0]) + (r.from[1] ?? 0);
      const b = rail.distanceToWaypoint(r.to[0]) + (r.to[1] ?? 0);
      out.push({ ...r, a: Math.min(a, b), b: Math.max(a, b) });
    } catch { /* waypoint renamed: ignore the record */ }
  }
  return out;
}

export function walkProfile(rail) {
  if (cache?.rail === rail) return cache.at;
  const segs = barrierSegs();
  const sw = sidewalkSegs();
  const recorded = recordedStreets(rail);
  const roads = [];
  for (const r of GEO.roads ?? []) {
    if (r.k !== 'road') continue;
    const p = triples(r.p);
    for (let i = 0; i < p.length - 1; i++) roads.push({ w: r.w, a: [p[i][0], p[i][2]], b: [p[i + 1][0], p[i + 1][2]] });
  }
  const plazas = (GEO.plazas ?? []).map((q) => pairs(q.o));
  const inPlaza = (x, z) => plazas.some((r) => pointInRing(r, x, z));
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
      // The kerb, from the mapped pavement: as far in front of its line as
      // the facade is behind it.
      out.kerb = out.kerb ?? {};
      let k = sidewalkAt(sw, p, t, side, (wall ?? REACH) + 0.5);
      // Inside a square the mapped footways criss-cross it; none is a kerb.
      if (k !== null && inPlaza(p.x + rx * side * k, p.z + rz * side * k)) k = null;
      if (k !== null && wall !== null && wall - k < 3) out.kerb[side] = Math.max(0.6, wall - Math.max(0.9, Math.min(5, 2 * (wall - k))));
      else if (k !== null && wall === null) out.kerb[side] = Math.max(0.6, k - 1);
      else out.kerb[side] = null;
    }
    // The carriageway between the kerbs the mapped pavements put there (both
    // sides), or the IGN width off the one kerb that is mapped.
    if (road) {
      const kL = out.kerb[-1], kR = out.kerb[1];
      if (kL !== null && kR !== null && kL + kR >= 3.2) { out.half = Math.min(6, (kL + kR) / 2); out.cen = (kR - kL) / 2; }
      else if (kR !== null) out.cen = kR - out.half;
      else if (kL !== null) out.cen = out.half - kL;
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
    let half = r.road && hn ? hs / hn : null;
    let cen = half !== null ? cs / hn : 0;
    if (half !== null) half = Math.max(1.6, Math.min(6, half));
    // Recorded from the photographs: a pavement of a measured width on a side,
    // the carriageway taking the rest up to the IGN width.
    const rec = recorded.find((q) => i * STEP >= q.a && i * STEP <= q.b);
    if (half !== null && rec) {
      if (rec.w) half = rec.w / 2;
      const wallAt = (s) => (r.wall[s] !== null && ws[s][1] ? ws[s][0] / ws[s][1] : null);
      const want = { [-1]: rec.pav?.left, [1]: rec.pav?.right };
      const kerb = { [-1]: null, [1]: null };
      for (const s of [-1, 1]) if (want[s] !== undefined && wallAt(s) !== null) kerb[s] = wallAt(s) - want[s];
      // Both pavements measured: the carriageway is what lies between them.
      if (kerb[-1] !== null && kerb[1] !== null) { half = (kerb[-1] + kerb[1]) / 2; cen = (kerb[1] - kerb[-1]) / 2; }
      // One: move the carriageway so that kerb is where it was measured.
      else if (kerb[1] !== null) cen = kerb[1] - half;
      else if (kerb[-1] !== null) cen = half - kerb[-1];
    }
    // The camera walks the pavement edge at worst, never the far side of it.
    if (half !== null) cen = Math.max(-(half + 0.4), Math.min(half + 0.4, cen));
    const pav = {}, open = {};
    for (const s of [-1, 1]) {
      const wall = r.wall[s] !== null && ws[s][1] ? ws[s][0] / ws[s][1] : null;
      if (half === null) { pav[s] = null; open[s] = true; continue; }
      if (wall === null || wall - (half + s * cen) > 4.5) { pav[s] = 2.0; open[s] = true; continue; }
      pav[s] = Math.max(0.9, wall - (half + s * cen) - 0.05);
      open[s] = false;
    }
    // Posts along a kerb unless the photographs show none there, which is
    // wherever cars or scooters park against it.
    const bollards = rec ? Object.fromEntries(['left', 'right'].map((k) => [k, rec.bollards?.[k] ?? (rec.park?.[k] ? false : true)])) : null;
    return { road: half !== null, half, cen, pav, open, bollards };
  });
  // Ease the kerbs over two metres either side, so a recorded stretch does
  // not start with a step in the kerb line.
  {
    const E = Math.round(2 / STEP);
    const hs = prof.map((q) => q.half), cs = prof.map((q) => q.cen);
    prof.forEach((q, i) => {
      if (!q.road) return;
      let h = 0, c = 0, m = 0;
      for (let j = Math.max(0, i - E); j <= Math.min(n - 1, i + E); j++) if (hs[j] !== null) { h += hs[j]; c += cs[j]; m++; }
      const nh = h / m, nc = c / m;
      // Keep each pavement reaching its facade: the kerb moves, the wall does not.
      for (const s of [-1, 1]) if (!q.open[s]) q.pav[s] = Math.max(0.9, q.pav[s] + (q.half + s * q.cen) - (nh + s * nc));
      q.half = nh; q.cen = nc;
    });
  }
  // Where a kerb would fall inside a square (an OSM pedestrian area), that
  // side has no kerb: the square is one flush surface (Place Dalida, where
  // the left kerb of rue Girardon starts at the square's edge and curves
  // away, instead of running on down to the steps).
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
  if (p.road) return { half: p.half, cen: p.cen, pav: p.pav, open: p.open, flush: p.flush, road: true, bollards: p.bollards };
  const total = rail.widthAt(d);
  const pavement = Math.max(0.8, Math.min(2.4, total * 0.18));
  const half = Math.max(1.5, total * 0.5 - pavement);
  return { half, cen: 0, pav: { [-1]: pavement, [1]: pavement }, open: { [-1]: true, [1]: true }, flush: { [-1]: false, [1]: false }, road: false };
}
