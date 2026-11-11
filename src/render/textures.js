import * as THREE from 'three';

/**
 * Ground textures, generated rather than loaded.
 *
 * The street surface is most of the bottom half of every frame, and the first
 * version drew it as flat two-tone vertex colour, which under the old grade
 * came out as blue slabs. In the Ville de Paris survey photos the ground is
 * the single most recognisable thing on these lanes: small grey granite setts
 * in rows across the street, worn smooth, with dark joints. A flat colour
 * cannot say "pavé"; eight kilobytes of pattern can.
 *
 * Each texture is built once into a DataTexture, which works in the browser
 * and under node's test runner alike (no canvas), and is shared by every mesh
 * that uses it. They are designed to be multiplied by vertex colour, so their
 * average is close to white and the tint lives in the geometry.
 */

const cache = new Map();

/** Deterministic hash → [0, 1). */
function rnd(a, b = 0) {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177 | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function finish(data, size, key, metresPerTile) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  // UVs on the ground are in metres; the repeat turns them into tiles.
  tex.repeat.set(1 / metresPerTile, 1 / metresPerTile);
  tex.userData.metresPerTile = metresPerTile;
  cache.set(key, tex);
  return tex;
}

/**
 * Granite setts ("pavés"): rows 12.5 cm deep of stones 11-19 cm long,
 * staggered, each a slightly different grey, with dark sanded joints.
 * One tile is 2 m square. The rows run along the texture's U axis, so map U
 * ACROSS the street and the courses lie the way Paris lays them.
 */
export function settTexture() {
  if (cache.has('sett')) return cache.get('sett');
  const N = 256, ROW = 16, JOINT = 2;
  const data = new Uint8Array(N * N * 4);
  for (let r = 0; r < N / ROW; r++) {
    // Stones along this row, sized to tile exactly.
    const widths = [];
    let sum = 0;
    while (sum < N - 18) { const w = 14 + Math.floor(rnd(r, widths.length) * 11); widths.push(w); sum += w; }
    widths[widths.length - 1] += N - sum;
    const offset = Math.floor(rnd(r, 999) * N);
    let x0 = 0;
    widths.forEach((w, k) => {
      const tone = 0.80 + rnd(r * 31 + k, 7) * 0.30;
      const warm = (rnd(r * 17 + k, 3) - 0.5) * 0.06;
      for (let yy = 0; yy < ROW; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const px = (x0 + xx + offset) % N, py = r * ROW + yy;
          const joint = yy < JOINT || xx < JOINT;
          // A little doming: lighter toward the top-left of each stone.
          const dome = 1 + 0.08 * (1 - (yy / ROW + xx / w));
          const grain = 0.94 + rnd(px, py) * 0.12;
          let v = joint ? 0.42 : tone * dome * grain;
          const i = (py * N + px) * 4;
          data[i] = Math.min(255, 255 * v * (1 + warm));
          data[i + 1] = Math.min(255, 255 * v);
          data[i + 2] = Math.min(255, 255 * v * (1 - warm));
          data[i + 3] = 255;
        }
      }
      x0 += w;
    });
  }
  return finish(data, N, 'sett', 2);
}

/** Asphalt: fine aggregate noise with the odd patch. One tile is 4 m. */
export function asphaltTexture() {
  if (cache.has('asphalt')) return cache.get('asphalt');
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const patch = rnd(Math.floor(x / 32), Math.floor(y / 32)) * 0.08;
      const v = 0.88 + patch + (rnd(x, y) - 0.5) * 0.16;
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, 255 * v);
      data[i + 3] = 255;
    }
  }
  return finish(data, N, 'asphalt', 4);
}

/** Stone slabs 40 x 60 cm, for steps' landings and the squares. One tile is 2.4 m. */
export function slabTexture() {
  if (cache.has('slab')) return cache.get('slab');
  const N = 128, W = 32, H = 21;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const row = Math.floor(y / H);
      const xs = x + (row % 2) * (W / 2);
      const joint = y % H === 0 || xs % W === 0;
      const tone = 0.9 + rnd(Math.floor(xs / W), row) * 0.12;
      const v = joint ? 0.62 : tone * (0.96 + rnd(x, y) * 0.06);
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, 255 * v);
      data[i + 3] = 255;
    }
  }
  return finish(data, N, 'slab', 2.4);
}

/** By surface name, as tools/geo/build.py records it from OSM. */
export function surfaceTexture(surface) {
  if (surface === 'sett') return settTexture();
  if (surface === 'paving') return slabTexture();
  return asphaltTexture();
}

/**
 * The colour each surface is multiplied by, measured off the survey frames:
 * setts a mid warm grey, asphalt a dark neutral grey, slabs pale.
 */
export const SURFACE_TINT = {
  sett: new THREE.Color('#9A948B'),
  asphalt: new THREE.Color('#8E8B86'),   // worn Paris asphalt is a pale warm grey in daylight
  paving: new THREE.Color('#B9B4AA'),
  gravel: new THREE.Color('#B4A68E'),
};

/**
 * Coursed rubble: the roughly squared limestone blocks of every old garden
 * wall on the Butte (rue d'Orchampt, rue Girardon), laid in rough courses
 * of varying height with pale mortar joints. The first version was a
 * Voronoi "crazy paving" that read as a patio, not a wall. One tile is 1.6 m.
 */
export function rubbleTexture() {
  if (cache.has('rubble')) return cache.get('rubble');
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const fill = (x, y, v, warm) => {
    const i = (((y % N) + N) % N * N + (((x % N) + N) % N)) * 4;
    data[i] = Math.min(255, 255 * v * (1 + warm));
    data[i + 1] = Math.min(255, 255 * v);
    data[i + 2] = Math.min(255, 255 * v * (1 - warm * 1.6));
    data[i + 3] = 255;
  };
  // Mortar everywhere first.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fill(x, y, 1.02 + rnd(x, y) * 0.04, 0.02);
  // Courses: heights 9-16 px (11-20 cm), summing to exactly N.
  const courses = [];
  let sum = 0;
  while (sum < N - 16) { const h = 9 + Math.floor(rnd(courses.length, 77) * 8); courses.push(h); sum += h; }
  courses[courses.length - 1] += N - sum;
  let y0 = 0;
  courses.forEach((h, r) => {
    let x0 = Math.floor(rnd(r, 5) * N);
    let made = 0;
    while (made < N) {
      const w = Math.min(N - made, 12 + Math.floor(rnd(r * 13 + made, 9) * 22));
      const tone = 0.74 + rnd(r * 7 + made, 11) * 0.26;
      const warm = 0.03 + rnd(made, r * 3 + 1) * 0.07;
      // Irregular edges: each stone loses 0-2 px on each side, rounder corners.
      const l = 1 + Math.floor(rnd(r, made + 1) * 2), rr = 1 + Math.floor(rnd(made, r + 2) * 2);
      const t = 1 + Math.floor(rnd(r + 3, made) * 2), bb = 1 + Math.floor(rnd(made + 5, r) * 2);
      for (let yy = t; yy < h - bb; yy++) {
        for (let xx = l; xx < w - rr; xx++) {
          const corner = (xx < l + 2 || xx > w - rr - 3) && (yy < t + 2 || yy > h - bb - 3);
          if (corner && rnd(xx + made, yy + r) < 0.6) continue;
          const shadeV = 1 - (yy / h) * 0.12;   // lit from above
          fill(x0 + xx, y0 + yy, tone * shadeV * (0.92 + rnd(x0 + xx, y0 + yy) * 0.12), warm);
        }
      }
      x0 += w; made += w;
    }
    y0 += h;
  });
  return finish(data, N, 'rubble', 1.6);
}
