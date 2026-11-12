import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Parked vehicles, low poly but modelled from the cars and scooters in the
 * Ville de Paris survey photographs: small European hatchbacks (Clio, 208,
 * Yaris), a few vans, and maxi-scooters (T-Max, Vespa GTS) with top cases.
 *
 * The first versions were two boxes with four cylinders, and then an
 * extruded side profile; both read as toys. These are built the way a
 * low-poly artist builds a car: a bevelled body from a real side elevation,
 * a separate glasshouse with pillars, black wheel arches and sills, light
 * clusters, mirrors, handles, a number plate, and wheels with tyres and rims.
 *
 * Everything is merged per material into a handful of meshes per vehicle, and
 * the materials are shared module-wide, so the static batcher folds every car
 * on the route into a few draw calls.
 */

const M = new Map();
const mat = (hex, rough = 0.6, metal = 0) => {
  const k = `${hex}|${rough}|${metal}`;
  if (!M.has(k)) M.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal, flatShading: true }));
  return M.get(k);
};
const TYRE = '#18191B', RIM = '#A9ADB2', TRIM = '#1F2022', GLASS = '#26303A', CHROME = '#C8CBCE';

/** Group geometries by material into one mesh each. */
class Kit {
  constructor() { this.parts = new Map(); }
  add(geo, m) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m).push(g);
    return this;
  }
  box(w, h, d, x, y, z, m, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    return this.add(g.translate(x, y, z), m);
  }
  build() {
    const g = new THREE.Group();
    for (const [m, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}

/** Extrude a side elevation (z along the car, y up) across width w, centred. */
function profile(points, w, bevel = 0.06) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -(w - 2 * bevel) / 2);
  g.rotateY(-Math.PI / 2);    // shape x -> world z, extrusion -> world x
  return g;
}

function wheel(kit, x, z, r, w, side) {
  const tyre = new THREE.CylinderGeometry(r, r, w, 12);
  tyre.rotateZ(Math.PI / 2);
  kit.add(tyre.translate(x, r, z), mat(TYRE, 0.9));
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.02, 10);
  rim.rotateZ(Math.PI / 2);
  kit.add(rim.translate(x + side * (w / 2 + 0.005), r, z), mat(RIM, 0.35, 0.6));
  const hub = new THREE.CylinderGeometry(r * 0.18, r * 0.18, 0.03, 6);
  hub.rotateZ(Math.PI / 2);
  kit.add(hub.translate(x + side * (w / 2 + 0.02), r, z), mat(TRIM, 0.5));
}

const CAR_PAINTS = ['#ECEBE7', '#1C1D20', '#8D9196', '#C7CACD', '#5E1C22', '#2B3C55', '#ECEBE7', '#3A3D42', '#B9B2A2', '#7E2B22'];

/**
 * A small European hatchback (Clio / 208 proportions: 4.05 m long, 1.44 m
 * tall, a short bonnet, a long roof, a steep hatch). Front at -z.
 */
export function parkedCar(rnd = Math.random) {
  const kit = new Kit();
  const paint = mat(CAR_PAINTS[Math.floor(rnd() * CAR_PAINTS.length)], 0.45, 0.15);
  const glass = mat(GLASS, 0.12, 0.3);
  const black = mat(TRIM, 0.75);
  const L = 3.95 + rnd() * 0.2, W = 1.74, h = L / 2;
  // Lower body: front bumper, short bonnet, waistline, tail.
  // The bottom edge runs rear to front with a wheel arch cut over each axle,
  // so the tyres show the way they do on a real car instead of hiding
  // under a slab.
  const zf = -h + 0.78, zr = h - 0.66, R = 0.4;
  const arch = (zc) => {
    const out = [];
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI;              // rear side of the arch first
      out.push([zc + Math.cos(a) * R, 0.31 + Math.sin(a) * R]);
    }
    return out;
  };
  kit.add(profile([
    [-h, 0.3], [-h - 0.03, 0.6], [-h + 0.12, 0.74], [-h + 0.95, 0.88],
    [h - 0.22, 0.93], [h + 0.02, 0.82], [h, 0.3],
    ...arch(zr), ...arch(zf),
  ], W), paint);
  // Glasshouse: raked screen, long roof, steep hatch; narrower than the body.
  const gw = W - 0.14;
  kit.add(profile([
    [-h + 0.95, 0.88], [-h + 1.78, 1.38], [h - 0.58, 1.43], [h - 0.06, 0.96], [h - 0.22, 0.93],
  ], gw, 0.05), paint);
  // Side glass in two panes either side of the B pillar.
  for (const s of [-1, 1]) {
    const x = s * (gw / 2 + 0.004);
    kit.add(profile([[-h + 1.1, 0.94], [-h + 1.78, 1.33], [-0.06, 1.35], [-0.06, 0.94]], 0.01, 0).translate(x, 0, 0), glass);
    kit.add(profile([[0.06, 0.94], [0.06, 1.35], [h - 0.62, 1.37], [h - 0.18, 0.98]], 0.01, 0).translate(x, 0, 0), glass);
    // Door seam, handles, mirror, sill.
    kit.box(0.008, 0.48, 0.01, s * (W / 2 + 0.002), 0.64, -0.06, black);
    kit.box(0.012, 0.03, 0.15, s * (W / 2 + 0.004), 0.83, -0.34, black);
    kit.box(0.012, 0.03, 0.15, s * (W / 2 + 0.004), 0.83, 0.58, black);
    kit.box(0.16, 0.1, 0.12, s * (W / 2 + 0.07), 0.98, -h + 1.15, paint);
    kit.box(0.03, 0.08, L - 2.3, s * (W / 2 + 0.004), 0.36, 0.06, black);
  }
  // Windscreen and hatch glass along their slopes.
  const slope = (z0, y0, z1, y1, wd) => {
    const len = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y1 - y0, z1 - z0);
    kit.box(wd, 0.012, len - 0.08, 0, (y0 + y1) / 2 + 0.03, (z0 + z1) / 2, glass, -a);
  };
  slope(-h + 0.97, 0.9, -h + 1.76, 1.37, gw - 0.12);
  slope(h - 0.6, 1.41, h - 0.1, 0.98, gw - 0.16);
  // Front: grille, lamps, plate. Rear: lamps, plate. Bumpers.
  kit.box(0.72, 0.13, 0.03, 0, 0.55, -h - 0.02, black);
  kit.box(0.52, 0.11, 0.02, 0, 0.38, -h - 0.04, mat('#F2F2EE', 0.5));
  for (const s of [-1, 1]) {
    kit.box(0.36, 0.11, 0.06, s * (W / 2 - 0.26), 0.7, -h + 0.06, mat('#DCD9D0', 0.25), 0.3);
    kit.box(0.24, 0.17, 0.04, s * (W / 2 - 0.17), 0.8, h + 0.0, mat('#8E1717', 0.35));
  }
  kit.box(0.52, 0.11, 0.02, 0, 0.55, h + 0.02, mat('#F2F2EE', 0.5));
  kit.box(W, 0.17, 0.1, 0, 0.36, -h + 0.02, black);
  kit.box(W, 0.17, 0.1, 0, 0.36, h - 0.02, black);
  // Wheels, with black arches over them.
  for (const sx of [-1, 1]) for (const z of [zf, zr]) wheel(kit, sx * (W / 2 - 0.12), z, 0.31, 0.2, sx);
  return kit.build();
}

const SCOOTER_PAINTS = ['#1C1D20', '#2E3136', '#E6E4DE', '#1C1D20', '#5A1E22', '#8C949B', '#2B3C55'];

/** One maxi-scooter, ~1.9 m. Front at -z. */
function scooter(rnd) {
  const kit = new Kit();
  const paint = mat(SCOOTER_PAINTS[Math.floor(rnd() * SCOOTER_PAINTS.length)], 0.4, 0.15);
  const black = mat(TRIM, 0.6);
  const W = 0.62;
  // Body: front shield rising to the headset, the floorboard step, the seat
  // hump, the tail. One side elevation, extruded.
  kit.add(profile([
    [-0.86, 0.42], [-0.92, 0.75], [-0.82, 1.12], [-0.64, 1.18], [-0.52, 0.62],
    [0.05, 0.5], [0.18, 0.72], [0.72, 0.8], [0.9, 0.7], [0.88, 0.48], [0.3, 0.32], [-0.5, 0.3],
  ], W, 0.05), paint);
  // Seat, a darker hump on top of the rear body.
  kit.add(profile([[0.12, 0.74], [0.2, 0.88], [0.62, 0.9], [0.74, 0.82], [0.7, 0.78]], W - 0.12, 0.04), black);
  // Floorboard, black.
  kit.box(W - 0.06, 0.04, 0.6, 0, 0.5, -0.22, black);
  // Headset, handlebar, mirrors, screen, headlight.
  kit.box(0.34, 0.14, 0.18, 0, 1.22, -0.72, paint);
  kit.box(0.74, 0.035, 0.035, 0, 1.24, -0.66, black);
  for (const s of [-1, 1]) {
    kit.box(0.02, 0.18, 0.02, s * 0.27, 1.34, -0.7, black);
    kit.box(0.1, 0.06, 0.03, s * 0.29, 1.44, -0.71, black);
  }
  kit.box(0.42, 0.34, 0.015, 0, 1.38, -0.84, mat('#3A4550', 0.15, 0.3), -0.35);
  kit.box(0.2, 0.08, 0.04, 0, 0.98, -0.9, mat('#E9E6DC', 0.2), 0.3);
  kit.box(0.16, 0.05, 0.03, 0, 0.74, 0.92, mat('#9C1A1A', 0.3));
  // Front fork and the two wheels, with the rear swing arm.
  kit.box(0.06, 0.5, 0.06, 0, 0.5, -0.74, black, -0.35);
  for (const z of [-0.72, 0.64]) {
    const r = 0.27;
    const tyre = new THREE.CylinderGeometry(r, r, 0.13, 12);
    tyre.rotateZ(Math.PI / 2);
    kit.add(tyre.translate(0, r, z), mat(TYRE, 0.9));
    for (const s of [-1, 1]) {
      const rim = new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.01, 10);
      rim.rotateZ(Math.PI / 2);
      kit.add(rim.translate(s * 0.07, r, z), mat(RIM, 0.35, 0.6));
    }
  }
  kit.box(0.08, 0.1, 0.5, 0.1, 0.3, 0.42, black);
  // Top case on most of them.
  if (rnd() < 0.65) {
    kit.box(0.42, 0.3, 0.38, 0, 1.05, 0.72, black);
    kit.box(0.34, 0.03, 0.02, 0, 1.08, 0.53, mat(CHROME, 0.2, 0.7));
  }
  // Side stand: parked leaning a little.
  const g = kit.build();
  g.rotation.z = 0.06;
  return g;
}

/**
 * A row of maxi-scooters parked nose to the kerb, as on rue d'Orchampt and
 * rue des Abbesses: each turned across the street, staggered, a little
 * irregular.
 */
export function scooters(rnd = Math.random, count = 4) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const s = scooter(rnd);
    s.rotation.y = Math.PI / 2 + (rnd() - 0.5) * 0.3;
    s.position.set((rnd() - 0.5) * 0.25, 0, -((count - 1) * 0.55) + i * 1.1);
    g.add(s);
  }
  return g;
}
