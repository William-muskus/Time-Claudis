import * as THREE from 'three';
import { PALETTE } from '../render/palette.js';
import { GEO, groundAt, pairs, pointInRing, surfaceAt } from './geo.js';
import { surfaceTexture, SURFACE_TINT } from '../render/textures.js';

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
  ground: new THREE.Color('#A29C92'),
  groundAlt: new THREE.Color('#9B958B'),
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

  const greens = GEO.greens.map((g) => {
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
      const raw = r.k === 'stairs' ? 'paving' : r.k === 'path' ? surfaceAt(mx, mz, { footway: true, fallback: 'gravel' })
        : surfaceAt(mx, mz, { fallback: 'asphalt' });
      const surf = r.k === 'road' && raw === 'paving' ? 'sett' : raw;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const rx = -uz, rz = ux;
      // Subdivide so a long segment follows the terrain rather than bridging it.
      const n = Math.max(1, Math.ceil(len / 3));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const p1 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        const v0 = a0 + len * t0, v1 = a0 + len * t1;
        const ribbon = (w, lift, kind, tint) => {
          const Y = (x, z) => {
            const g = groundAt(x, z);
            const yc = ay + (by - ay) * ((t0 + t1) / 2);
            return Math.max(g ?? yc, yc - 0.6) + lift;
          };
          const q = [
            [p0[0] - rx * w, 0, p0[1] - rz * w], [p1[0] - rx * w, 0, p1[1] - rz * w],
            [p1[0] + rx * w, 0, p1[1] + rz * w], [p0[0] + rx * w, 0, p0[1] + rz * w],
          ];
          for (const v of q) v[1] = Y(v[0], v[2]);
          // Upward-facing: left-back, left-front, right-front, right-back.
          mesher(kind).quad(q[0], q[3], q[2], q[1], tint, [[-w, v0], [w, v0], [w, v1], [-w, v1]]);
        };
        if (r.k === 'stairs') {
          ribbon(half, 0.08, 'paving', k % 2 ? COL.stairs : COL.stairsDark);
        } else {
          if (edge) ribbon(half + edge, 0.05, 'asphalt', SURFACE_TINT.asphalt.clone().multiplyScalar(1.12));
          ribbon(half, 0.09, surf, SURFACE_TINT[surf] ?? SURFACE_TINT.asphalt);
        }
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'side_streets';
  for (const [k, m] of meshers) group.add(m.mesh(`side_streets_${k}`, { roughness: 0.92, map: surfaceTexture(k) }));
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
