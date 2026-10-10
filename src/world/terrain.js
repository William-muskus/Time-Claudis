import * as THREE from 'three';
import { PALETTE } from '../render/palette.js';
import { GEO, groundAt, pairs, pointInRing } from './geo.js';

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
  ground: new THREE.Color('#A6927F'),
  groundAlt: new THREE.Color('#9C8A79'),
  green: new THREE.Color('#6E7B45'),
  greenAlt: new THREE.Color('#62703F'),
  road: PALETTE.cobbleCool,
  roadEdge: PALETTE.pavement,
  stairs: PALETTE.stairStone,
  stairsDark: new THREE.Color('#A08C78'),
  path: new THREE.Color('#B9A58C'),
  wall: PALETTE.limestoneMid,
  wallCap: PALETTE.limestoneLit,
};

class Mesher {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, col) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  mesh(name, { roughness = 0.95, receiveShadow = true, castShadow = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness, metalness: 0,
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
        // Wind each cell so its faces point up whichever way the grid's
        // axes run (dz is negative: rows go north).
        if (g.dz < 0) { m.tri(a, c, b, col); m.tri(a, d, c, col); }
        else { m.tri(a, b, c, col); m.tri(a, c, d, col); }
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
  const m = new Mesher();
  for (const r of GEO.roads) {
    const pts = [];
    for (let i = 0; i < r.p.length; i += 3) pts.push([r.p[i], r.p[i + 1], r.p[i + 2]]);
    const half = r.w / 2;
    const edge = r.k === 'road' ? 1.6 : 0;   // pavements on real streets
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, ay, az] = pts[s], [bx, by, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      // Skip the stretches that ARE the walk: street.js draws those.
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const nr = near.nearest(mx, mz, 10);
      if (nr) {
        const tan = rail.tangentAt(nr.d);
        const along = Math.abs(((bx - ax) * tan.x + (bz - az) * tan.z) / len);
        if (nr.dist < rail.widthAt(nr.d) * 0.5 + 1.5 && along > 0.6) continue;
      }
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const rx = -uz, rz = ux;
      // Subdivide so a long segment follows the terrain rather than bridging it.
      const n = Math.max(1, Math.ceil(len / 3));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const p1 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        const ribbon = (w, lift, col) => {
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
          m.quad(q[0], q[3], q[2], q[1], col);
        };
        if (r.k === 'stairs') {
          ribbon(half, 0.08, k % 2 ? COL.stairs : COL.stairsDark);
        } else if (r.k === 'path') {
          ribbon(half, 0.06, COL.path);
        } else {
          ribbon(half + edge, 0.05, COL.roadEdge);
          ribbon(half, 0.09, COL.road);
        }
      }
    }
  }
  return m.mesh('side_streets', { roughness: 0.92 });
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
      const side = (x, z, k) => groundAt(x + rx * k, z + rz * k);
      const lo = Math.min(side(ax, az, 1.5) ?? 0, side(ax, az, -1.5) ?? 0, side(bx, bz, 1.5) ?? 0, side(bx, bz, -1.5) ?? 0) - 0.3;
      const hi = Math.max(side(ax, az, 1.5) ?? 0, side(ax, az, -1.5) ?? 0, side(bx, bz, 1.5) ?? 0, side(bx, bz, -1.5) ?? 0) + 0.9;
      const T = 0.3;
      const A = [ax + rx * T, az + rz * T], B = [bx + rx * T, bz + rz * T];
      const C = [bx - rx * T, bz - rz * T], D = [ax - rx * T, az - rz * T];
      m.quad([A[0], lo, A[1]], [B[0], lo, B[1]], [B[0], hi, B[1]], [A[0], hi, A[1]], COL.wall);
      m.quad([C[0], lo, C[1]], [D[0], lo, D[1]], [D[0], hi, D[1]], [C[0], hi, C[1]], COL.wall);
      m.quad([A[0], hi, A[1]], [B[0], hi, B[1]], [C[0], hi, C[1]], [D[0], hi, D[1]], COL.wallCap);
    }
  }
  return m.mesh('retaining_walls', { castShadow: true });
}
