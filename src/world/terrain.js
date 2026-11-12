import * as THREE from 'three';
import { PALETTE } from '../render/palette.js';
import { GEO, groundAt, pairs, pointInRing, surfaceAt, onOtherStreet } from './geo.js';
import { GROUND_R } from './ground.js';
import { surfaceTexture, SURFACE_TINT } from '../render/textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The ground of the Butte, from IGN's terrain model.
 *
 * WHAT IT REPLACES. The world used to stand on a flat plane 38 m below the
 * route with a ten-sided cone for the hill — and the cone was closed, so for
 * a while there was a 622-metre disc lying at street level under half the
 * level. Every view off the Butte showed that geometry, because there was
 * nothing else to show.
 *
 * This is RGE ALTI: a 2.5 m grid along the walk and a 10 m grid over the rest
 * of the corridor. The Ravignan drop, the Girardon steps, the bowl of Place
 * Constantin-Pecqueur, the terraces the retaining walls hold up — all of it is
 * the measured shape of the ground.
 *
 * THE STREET STAYS ON TOP. street.js lays the rail's own carriageway and
 * stairs at the rail's elevation, which comes from the same terrain model but
 * through a spline. Inside the street corridor the terrain is pulled a little
 * BELOW the rail so the two never z-fight and the terrain never pokes through
 * a stair tread. Everywhere else it is left exactly as measured.
 */

const COL = {
  // Bare ground between things in this city is paving, gravel and packed
  // earth: a neutral warm grey, not the brown it used to be.
  ground: new THREE.Color('#8F8C86'),
  groundAlt: new THREE.Color('#8A8781'),
  green: new THREE.Color('#5F7440'),
  greenAlt: new THREE.Color('#566B3A'),
  road: PALETTE.cobbleCool,
  roadEdge: PALETTE.pavement,
  stairs: PALETTE.stairStone,
  stairsDark: new THREE.Color('#A08C78'),
  path: new THREE.Color('#B9A58C'),
  wall: PALETTE.limestoneMid,
  wallCap: PALETTE.limestoneLit,
};

class Mesher {
  constructor(uvs = false) { this.pos = []; this.col = []; this.uv = uvs ? [] : null; }
  tri(a, b, c, col, ta, tb, tc) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
    if (this.uv) this.uv.push(...(ta ?? [0, 0]), ...(tb ?? [0, 0]), ...(tc ?? [0, 0]));
  }
  quad(a, b, c, d, col, t = null) {
    this.tri(a, b, c, col, t?.[0], t?.[1], t?.[2]);
    this.tri(a, c, d, col, t?.[0], t?.[2], t?.[3]);
  }
  mesh(name, { roughness = 0.95, receiveShadow = true, castShadow = false, map = null } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: !map, roughness, metalness: 0, map,
    }));
    m.name = name;
    m.receiveShadow = receiveShadow;
    m.castShadow = castShadow;
    return m;
  }
}

/**
 * @param {import('../core/spline.js').Rail} rail
 * @param {{nearest: Function}} near railIndex(rail)
 */
export function buildTerrain(rail, near) {
  const group = new THREE.Group();
  group.name = 'terrain';

  // Canopy zones are not lawns (see ground.js); only OSM gardens and parks.
  const greens = (GEO.gardens ?? []).filter((g) => g.k !== 'cemetery').map((gd) => gd.o).map((g) => {
    const ring = pairs(g);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { ring, x0, z0, x1, z1 };
  });
  const isGreen = (x, z) => greens.some((g) =>
    x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1 && pointInRing(g.ring, x, z));

  /** The rail's own street corridor: terrain is kept just under it. */
  const clampToRail = (x, z, y) => {
    const nr = near.nearest(x, z, 12);
    if (!nr) return y;
    const half = rail.widthAt(nr.d) * 0.5 + 0.8;
    if (nr.dist > half) return y;
    return Math.min(y, nr.y - 0.28);
  };

  const fine = GEO.terrain[0];
  const fineBox = fine && GEO.terrain.length > 1 ? {
    x0: Math.min(fine.x0, fine.x0 + fine.dx * (fine.cols - 1)),
    x1: Math.max(fine.x0, fine.x0 + fine.dx * (fine.cols - 1)),
    z0: Math.min(fine.z0, fine.z0 + fine.dz * (fine.rows - 1)),
    z1: Math.max(fine.z0, fine.z0 + fine.dz * (fine.rows - 1)),
  } : null;

  const m = new Mesher();
  GEO.terrain.forEach((g, gi) => {
    const coarse = gi > 0;
    // The coarse grid sits a hair lower so the overlap band with the fine
    // grid never flickers between them.
    const drop = coarse ? 0.18 : 0;
    const V = (i, j) => {
      const x = g.x0 + j * g.dx, z = g.z0 + i * g.dz;
      const y = g.y[i * g.cols + j] - drop;
      return [x, clampToRail(x, z, y), z];
    };
    for (let i = 0; i < g.rows - 1; i++) {
      for (let j = 0; j < g.cols - 1; j++) {
        const a = V(i, j), b = V(i, j + 1), c = V(i + 1, j + 1), d = V(i + 1, j);
        const cx = (a[0] + c[0]) / 2, cz = (a[2] + c[2]) / 2;
        // Near the walk the ground is ground.js's; this mesh is only the
        // hillside beyond it, tucked a little lower where the two overlap.
        const nz = near.nearest(cx, cz, GROUND_R + 12);
        if (nz && nz.dist < GROUND_R - (coarse ? 8 : 2)) continue;
        if (nz && nz.dist < GROUND_R + 2) { a[1] -= 0.15; b[1] -= 0.15; c[1] -= 0.15; d[1] -= 0.15; }
        if (coarse && fineBox &&
            cx > fineBox.x0 + g.dx && cx < fineBox.x1 - g.dx &&
            cz > fineBox.z0 + Math.abs(g.dz) && cz < fineBox.z1 - Math.abs(g.dz)) continue;
        const green = isGreen(cx, cz);
        const alt = ((i + j) & 1) === 0;
        const col = green ? (alt ? COL.green : COL.greenAlt) : (alt ? COL.ground : COL.groundAlt);
        // Wind each cell so its faces point UP whichever way the grid's axes
        // run. (b - a) x (c - a) has a y component of -dx*dz, so with rows
        // running north (dz < 0) a, b, c is the upward order. This test was
        // once the other way round and every terrain face pointed down: the
        // whole Butte was culled from above, the sky dome showed through as
        // "ground", and the slopes above eye level showed their undersides
        // as black blades. tests/world.test.js now checks it.
        if (g.dx * g.dz < 0) { m.tri(a, b, c, col); m.tri(a, c, d, col); }
        else { m.tri(a, c, b, col); m.tri(a, d, c, col); }
      }
    }
  });
  group.add(m.mesh('terrain'));
  group.add(buildSideStreets(rail, near));
  group.add(buildRetainingWalls());
  return group;
}

/**
 * Every street that is NOT the walk, as a ribbon on the terrain.
 *
 * These are what you see down every side turning — rue Saint-Vincent dropping
 * away from Place Constantin-Pecqueur, rue de l'Abreuvoir from Place Dalida,
 * rue Norvins up to the Passe-Muraille. They used to be either missing or
 * hand-built one at a time; now every street in BD TOPO is drawn, at its own
 * width, following its own levels.
 */
function buildSideStreets(rail, near) {
  // One mesher per surface, so each street wears its real paving (OSM
  // surface=*) with the shared ground textures; UVs in metres, U across.
  const meshers = new Map();
  const bollards = [];
  const BOLLARD = mergeGeometries([
    new THREE.CylinderGeometry(0.075, 0.085, 0.95, 6).translate(0, 0.475, 0),
    new THREE.SphereGeometry(0.1, 6, 4).translate(0, 1.0, 0)].map((g) => g.toNonIndexed()));
  const mesher = (k) => {
    if (!meshers.has(k)) meshers.set(k, new Mesher(true));
    return meshers.get(k);
  };
  for (const r of GEO.roads) {
    const pts = [];
    for (let i = 0; i < r.p.length; i += 3) pts.push([r.p[i], r.p[i + 1], r.p[i + 2]]);
    const half = r.w / 2;
    const edge = r.k === 'road' ? 1.6 : 0;   // pavements on real streets
    let along = 0;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, ay, az] = pts[s], [bx, by, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      // Skip the stretches that ARE the walk: street.js draws those.
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const nr = near.nearest(mx, mz, 10);
      const a0 = along;
      along += len;
      if (nr) {
        const tan = rail.tangentAt(nr.d);
        const al = Math.abs(((bx - ax) * tan.x + (bz - az) * tan.z) / len);
        if (nr.dist < rail.widthAt(nr.d) * 0.5 + 1.5 && al > 0.6) continue;
      }
      const nrSeg = near.nearest(mx, mz, 80);
      // Inside the ground zone the street is part of ground.js's surface;
      // only its bollards are still placed from here.
      const inGround = nrSeg && nrSeg.dist < GROUND_R - 1;
      const raw = r.k === 'stairs' ? 'paving' : r.k === 'path' ? surfaceAt(mx, mz, { footway: true, fallback: 'gravel' })
        : surfaceAt(mx, mz, { fallback: 'asphalt' });
      const surf = r.k === 'road' && raw === 'paving' ? 'sett' : raw;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const rx = -uz, rz = ux;
      // Subdivide so a long segment follows the terrain rather than bridging it.
      const n = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const p1 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        const v0 = a0 + len * t0, v1 = a0 + len * t1;
        // One height per cross-section, from the centreline and the ground at
        // the two outer edges, so the roadway is a single tilted plane and the
        // pavements are their own strips beside it. Separate ribbons sampling
        // the ground per vertex used to cross each other on every cross-slope
        // and show as grey triangles through the setts (rue Berthe, rue
        // Garreau in the survey comparison).
        const yc = (t) => ay + (by - ay) * t;
        const sideY = (px, pz, sx, t, w) => {
          const g = groundAt(px + rx * w * sx, pz + rz * w * sx);
          return Math.max(g ?? yc(t), yc(t) - 0.6);
        };
        const P = [[p0, t0, v0], [p1, t1, v1]].map(([pp, t, v]) => {
          const w = half + edge;
          const yl = sideY(pp[0], pp[1], -1, t, w), yr = sideY(pp[0], pp[1], 1, t, w);
          const lerp = (o) => yl + (yr - yl) * ((o + w) / (2 * w));
          const pt = (o, lift) => [pp[0] + rx * o, lerp(o) + lift, pp[1] + rz * o];
          return { pt, v };
        });
        // Where this street meets the walk it stops at the walk's kerb line:
        // street.js draws the junction. Where it meets another side street,
        // its raised pavement stops at that street's carriageway.
        const inWalk = (x, z, pad) => {
          const q = near.nearest(x, z, 14);
          if (!q) return false;
          const w = rail.widthAt(q.d);
          return q.dist < Math.max(1.5, w * 0.5 - Math.max(0.8, Math.min(2.4, w * 0.18))) + pad;
        };
        const strip = (o0, o1, lift, kind, tint, pavementStrip = false) => {
          if (inGround) return;
          const om = (o0 + o1) / 2;
          const cx = (p0[0] + p1[0]) / 2 + rx * om, cz = (p0[1] + p1[1]) / 2 + rz * om;
          if (inWalk(cx, cz, pavementStrip ? 1.6 : 0)) return;
          if (pavementStrip && onOtherStreet(cx, cz, { near, rail, self: r, pad: 0.3 })) return;
          const a = P[0].pt(o0, lift), b = P[1].pt(o0, lift), c = P[1].pt(o1, lift), d = P[0].pt(o1, lift);
          // Upward-facing: left-back, left-front, right-front, right-back.
          mesher(kind).quad(a, d, c, b, tint, [[o0, P[0].v], [o1, P[0].v], [o1, P[1].v], [o0, P[1].v]]);
        };
        // Cast-iron potelets along both kerbs of the cobbled side streets near
        // the walk, every 1.8 m, as the photos show them down rue Berthe and
        // rue Garreau.
        if (surf === 'sett' && edge && nrSeg && nrSeg.dist < 70) {
          for (const sx of [-1, 1]) {
            for (let a = Math.ceil(v0 / 2.8) * 2.8; a < v1; a += 2.8) {
              const t = (a - a0) / len;
              const x = ax + (bx - ax) * t + rx * (half + 0.3) * sx, z = az + (bz - az) * t + rz * (half + 0.3) * sx;
              // Not across a junction, and not out in the walk.
              if (inWalk(x, z, 2.0) || onOtherStreet(x, z, { near, rail, self: r, pad: 1.2 })) continue;
              const yy = P[0].pt(sx * (half + 0.3), 0.2)[1] + (P[1].pt(sx * (half + 0.3), 0.2)[1] - P[0].pt(sx * (half + 0.3), 0.2)[1]) * ((a - v0) / (v1 - v0 || 1));
              bollards.push(BOLLARD.clone().translate(x, yy, z));
            }
          }
        }
        if (r.k === 'stairs') {
          strip(-half, half, 0.08, 'paving', k % 2 ? COL.stairs : COL.stairsDark);
        } else {
          strip(-half, half, 0.08, surf, SURFACE_TINT[surf] ?? SURFACE_TINT.asphalt);
          if (edge) {
            const pv = SURFACE_TINT.asphalt.clone().multiplyScalar(1.12);
            strip(-half - edge, -half, 0.2, 'asphalt', pv, true);
            strip(half, half + edge, 0.2, 'asphalt', pv, true);
          }
        }
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'side_streets';
  for (const [k, m] of meshers) group.add(m.mesh(`side_streets_${k}`, { roughness: 0.92, map: surfaceTexture(k) }));
  if (bollards.length) {
    const bm = new THREE.Mesh(mergeGeometries(bollards), new THREE.MeshStandardMaterial({ color: '#2A2A2C', roughness: 0.5, metalness: 0.3, flatShading: true }));
    bm.name = 'side_street_bollards';
    bm.castShadow = true;
    group.add(bm);
  }
  return group;
}

/**
 * The Butte's retaining walls, from BD TOPO "Mur de soutènement".
 *
 * Their height is not in the data, but the terrain step they hold up is: the
 * wall is drawn from the lower side's ground to the upper side's ground plus
 * a parapet, so it is exactly as tall as the measured drop.
 */
function buildRetainingWalls() {
  const m = new Mesher();
  for (const w of GEO.walls) {
    const pts = [];
    for (let i = 0; i < w.p.length; i += 3) pts.push([w.p[i], w.p[i + 2]]);
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const rx = -(bz - az) / len, rz = (bx - ax) / len;
      // Each END is sized from the ground at that end, and long runs are cut
      // into short pieces. One flat top per segment, set by the highest ground
      // anywhere along it, left the downhill end of every wall on a sloping
      // street standing metres proud — a dark shadowed slab, seen edge-on as
      // a black wedge down rue de l'Abreuvoir.
      const ends = (x, z) => {
        const s1 = groundAt(x + rx * 1.5, z + rz * 1.5), s2 = groundAt(x - rx * 1.5, z - rz * 1.5);
        const g = [s1, s2].filter((v) => v !== null);
        if (!g.length) return null;
        return { lo: Math.min(...g) - 0.3, hi: Math.max(...g) + 0.9 };
      };
      const T = 0.3;
      const n = Math.max(1, Math.ceil(len / 2.5));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const p1 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        const e0 = ends(p0[0], p0[1]), e1 = ends(p1[0], p1[1]);
        if (!e0 || !e1) continue;
        const A = [p0[0] + rx * T, p0[1] + rz * T], B = [p1[0] + rx * T, p1[1] + rz * T];
        const C = [p1[0] - rx * T, p1[1] - rz * T], D = [p0[0] - rx * T, p0[1] - rz * T];
        m.quad([A[0], e0.lo, A[1]], [B[0], e1.lo, B[1]], [B[0], e1.hi, B[1]], [A[0], e0.hi, A[1]], COL.wall);
        m.quad([C[0], e1.lo, C[1]], [D[0], e0.lo, D[1]], [D[0], e0.hi, D[1]], [C[0], e1.hi, C[1]], COL.wall);
        m.quad([A[0], e0.hi, A[1]], [B[0], e1.hi, B[1]], [C[0], e1.hi, C[1]], [D[0], e0.hi, D[1]], COL.wallCap);
      }
    }
  }
  return m.mesh('retaining_walls', { castShadow: true });
}
