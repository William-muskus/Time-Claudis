/**
 * What the player cannot see through.
 *
 * WHY THIS EXISTS. The director chose spawn anchors by distance, by which way
 * the camera was facing, and by which side of the street the wave wanted — and
 * never once by whether the player could actually SEE the anchor. Measured on
 * the verification tour with a projection and an occlusion test per enemy,
 * most staged fights came back with every enemy marked BLOCKED: alive, on
 * screen, correctly telegraphing, and standing behind a building. The combat
 * frames looked like the enemies had failed to spawn.
 *
 * In a rail shooter that is not a cosmetic problem. An enemy you cannot see is
 * an enemy you cannot shoot, and one that telegraphs and fires from behind a
 * façade is the precise kind of unfairness the whole telegraph system exists
 * to prevent: the player is told a shot is coming and given no way to answer
 * it. Time Crisis never does this. Every threat is presented.
 *
 * WHY NOT JUST RAYCAST THE SCENE. The world batches ~29,000 meshes into 72
 * draw calls, so a scene raycast means brute-force triangle tests against a
 * couple of hundred thousand triangles per ray, with no BVH. At roughly ten
 * candidate anchors per spawn that is far too slow to run inside a wave.
 *
 * So occlusion is tested against a coarse model instead: one oriented box per
 * building, tested in 2D with a height check. A street wall is an extremely
 * good match for that shape and the test is a few microseconds.
 *
 * HOW WRONG IT IS, measured. Across 241 candidate anchors at the five combat
 * nodes, checked against a real scene raycast: the two agree on 164. Of the 77
 * they disagree on, the real geometry says blocked every time — the coarse
 * model never once refused an anchor the player could actually see.
 *
 * That asymmetry is the whole design. This model only knows about buildings,
 * so it misses trees, kiosks, lamp posts and landmarks, and it therefore
 * under-reports. Under-reporting costs a spawn that is partly hidden.
 * Over-reporting costs an area that cannot be finished — which is exactly what
 * happened the one time this filter was applied to every selection pass. Being
 * wrong in the permissive direction is not a limitation here, it is the
 * requirement, and adding landmark boxes (whose axis-aligned bounds would
 * cover street they do not occupy) would give that up for very little.
 *
 * The real raycast is not the ground truth it looks like either: it counts a
 * handrail as opaque, and the Girardon climb has 376 pieces of handrail.
 */

/**
 * One building, as the smallest thing worth testing against.
 *
 * @param {{x:number,z:number}} centre  box centre in world XZ
 * @param {{x:number,z:number}} forward unit vector along the box's depth axis
 * @param {number} halfWidth   half the frontage, across `forward`
 * @param {number} halfDepth   half the depth, along `forward`
 * @param {number} baseY       ground level at the building
 * @param {number} height      how far up it blocks
 */
export function occluder(centre, forward, halfWidth, halfDepth, baseY, height) {
  const len = Math.hypot(forward.x, forward.z) || 1;
  const fx = forward.x / len, fz = forward.z / len;
  // INSET FROM THE FACADE. Without this the filter refuses almost everything.
  //
  // Anchors sit about half a metre proud of the façade they belong to, and a
  // shot down the length of a street arrives at a very shallow angle — so a
  // ray to a doorway thirty metres along runs nearly parallel to the building
  // line, half a metre out from it, and clips the corner of every neighbour on
  // the way. Every one of those is a box whose front face is exactly on that
  // line. The first version of this rejected every anchor the boss could use
  // and the stage lost its boss entirely.
  //
  // Pulling the front face back by INSET gives that grazing ray somewhere to
  // travel. It is the correct direction to be wrong in: the model now slightly
  // under-reports occlusion, so the worst case is an anchor the player can
  // only mostly see, rather than a street the director refuses to use.
  const INSET = 0.5;
  const hd = Math.max(0.2, halfDepth - INSET / 2);
  return {
    cx: centre.x + fx * (INSET / 2), cz: centre.z + fz * (INSET / 2),
    fx, fz,
    hw: halfWidth, hd,
    y0: baseY, y1: baseY + height,
  };
}

/**
 * One real building, by its footprint.
 *
 * The box model above was the right shape for a procedural plot, which WAS a
 * box. A cadastral footprint is not: L-shapes, courtyards, the wedge at every
 * acute street corner. Fitting a box to those either over-reports (the box
 * covers street the building does not) or under-reports (it misses a wing),
 * and the over-reporting direction is the one this whole module exists to
 * avoid. So real buildings are tested against their own polygon.
 *
 * The same permissive INSET applies, for the same reason: the footprint is
 * pulled in by half a metre so a grazing ray down a street wall does not clip
 * every facade it runs along.
 */
export function polyOccluder(ring, baseY, topY) {
  const INSET = 0.5;
  const pts = shrink(ring, INSET) ?? ring;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { poly: pts, x0, z0, x1, z1, y0: baseY, y1: topY };
}

/** Vertex-miter inset; null if the ring is too thin to survive it. */
function shrink(ring, d) {
  const n = ring.length;
  if (n < 3) return null;
  // Work out the winding so "inward" means inward whichever way it was given.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
    area += ax * bz - bx * az;
  }
  const sgn = area < 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, pz] = ring[(i - 1 + n) % n], [cx, cz] = ring[i], [nx, nz] = ring[(i + 1) % n];
    const l1 = Math.hypot(cx - px, cz - pz) || 1e-9, l2 = Math.hypot(nx - cx, nz - cz) || 1e-9;
    const n1x = sgn * (cz - pz) / l1, n1z = -sgn * (cx - px) / l1;
    const n2x = sgn * (nz - cz) / l2, n2z = -sgn * (nx - cx) / l2;
    let bx = n1x + n2x, bz = n1z + n2z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) return null;
    bx /= bl; bz /= bl;
    const ch = bx * n1x + bz * n1z;
    if (ch < 0.35) return null;
    out.push([cx + bx * d / ch, cz + bz * d / ch]);
  }
  return out;
}

/** Entry parameter t in [0, 1] of segment a→b into polygon, or null. */
function polyEntry(o, a, b) {
  // Cheap reject on the bounding box first: almost every pair misses.
  if (Math.max(a.x, b.x) < o.x0 || Math.min(a.x, b.x) > o.x1 ||
      Math.max(a.z, b.z) < o.z0 || Math.min(a.z, b.z) > o.z1) return null;
  if (inside(o.poly, a.x, a.z)) return 0;
  const dx = b.x - a.x, dz = b.z - a.z;
  let best = null;
  const p = o.poly, n = p.length;
  for (let i = 0; i < n; i++) {
    const [cx, cz] = p[i], [ex, ez] = p[(i + 1) % n];
    const sx = ex - cx, sz = ez - cz;
    const den = dx * sz - dz * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((cx - a.x) * sz - (cz - a.z) * sx) / den;
    const u = ((cx - a.x) * dz - (cz - a.z) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * Does the segment from `a` to `b` pass through this box?
 *
 * The segment is transformed into the box's own frame, where the box is an
 * axis-aligned rectangle and the test is the standard slab intersection. The
 * height is checked at the entry point rather than over the whole segment,
 * which is what makes shooting over a garden wall at something behind it work
 * correctly while shooting through a six-storey terrace does not.
 */
function hits(o, a, b, skipNear, skipFar) {
  if (o.poly) {
    const t = polyEntry(o, a, b);
    if (t === null) return false;
    const total = Math.hypot(b.x - a.x, b.z - a.z);
    if (total < 1e-6) return false;
    const enter = t * total;
    if (enter >= total - skipFar) return false;
    // A segment that STARTS inside a footprint is the player standing against
    // their own cover wall; the near skip exists for exactly that.
    if (t === 0 && skipNear > 0) return false;
    if (enter < skipNear) return false;
    const y = a.y + (b.y - a.y) * t;
    return y >= o.y0 && y <= o.y1;
  }
  // Into box-local 2D. u runs across the frontage, v along the depth.
  const dx = a.x - o.cx, dz = a.z - o.cz;
  const au = dx * -o.fz + dz * o.fx;
  const av = dx * o.fx + dz * o.fz;
  const ex = b.x - o.cx, ez = b.z - o.cz;
  const bu = ex * -o.fz + ez * o.fx;
  const bv = ex * o.fx + ez * o.fz;

  const du = bu - au, dv = bv - av;

  // Slab test, carrying the parametric range along the segment.
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[au, du, o.hw], [av, dv, o.hd]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return false;   // parallel and outside: never hits
      continue;
    }
    let lo = (-h - p) / d, hi = (h - p) / d;
    if (lo > hi) { const s = lo; lo = hi; hi = s; }
    t0 = Math.max(t0, lo);
    t1 = Math.min(t1, hi);
    if (t0 > t1) return false;
  }

  // Ignore the ends of the segment. The near skip keeps the player's own cover
  // and the wall they are standing against out of it; the far skip is what
  // stops a building blocking the doorway set into its own front, which is
  // where most anchors live.
  const total = Math.hypot(b.x - a.x, b.z - a.z);
  if (total < 1e-6) return false;
  const enter = t0 * total, exit = t1 * total;
  if (exit <= skipNear || enter >= total - skipFar) return false;

  // Height at the point the segment enters the box.
  const y = a.y + (b.y - a.y) * t0;
  return y >= o.y0 && y <= o.y1;
}

/**
 * Is the straight line from `from` to `to` blocked by anything?
 *
 * `skipFar` defaults to 1.6 m: anchors sit about half a metre proud of the
 * façade they belong to, and without the allowance every doorway in the level
 * reports itself as blocked by its own building.
 */
export function blocked(occluders, from, to, skipNear = 0.8, skipFar = 1.6) {
  for (let i = 0; i < occluders.length; i++) {
    if (hits(occluders[i], from, to, skipNear, skipFar)) return true;
  }
  return false;
}
