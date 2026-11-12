import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rail } from '../src/core/spline.js';
import { railPoints } from '../src/data/route.js';
import { buildWorld } from '../src/world/index.js';

/**
 * Performance budgets, for the half of performance that can be measured here.
 *
 * WHAT THIS CANNOT DO. The verification harness renders through SwiftShader at
 * 0.8 frames a second, so nothing in this repository can tell you whether a
 * real GPU holds 60. Fill rate, shader cost, the bloom and FXAA passes and
 * MediaPipe's share of the frame all need a browser on real silicon, and that
 * is the playtest's job.
 *
 * WHAT IT CAN DO. Two things decide most of the answer before a GPU is
 * involved, and both are measurable from here:
 *
 *   - SUBMISSION COST. 23,000 authored meshes batch down to 66 draw calls.
 *     That number is hardware-independent and it is the difference between a
 *     scene that is CPU-submission-bound on every machine and one that is
 *     bound on none. It is also extremely easy to destroy by accident: one
 *     landmark added outside the batcher, one material made unique per
 *     instance, and it goes back into the thousands with nothing failing.
 *
 *   - SIMULATION COST. game.update() against the real director. Measured by
 *     tools/verify/perf.mjs at 0.046 ms at p95 on this machine, which is 0.3%
 *     of a 60 fps budget. Not asserted here, because it is a wall-clock number
 *     on shared hardware and a flaky test is worse than no test; the tool
 *     prints it on demand.
 *
 * The ceilings below are deliberately loose. They are not targets — they are
 * the line past which the design stops being what it says it is.
 */

function census(obj) {
  let meshes = 0, tris = 0;
  const materials = new Set();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m) materials.add(m.uuid);
    }
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
  });
  return { meshes, tris, materials: materials.size };
}

test('every view along the walk draws a bounded amount', () => {
  // The budget is PER VIEW, not per map. The player only ever sees a few
  // streets, so the static world is batched per material AND per 100 m tile
  // (optimize.js) and three.js frustum-culls the tiles. What matters is what
  // one frame draws, measured here from the camera's own position and heading
  // every ten metres of the walk. (A total-triangle ceiling used to stand
  // here; it limited detail on streets the player is nowhere near.)
  const rail = new Rail(railPoints());
  const { root } = buildWorld(rail, 0xC0FFEE);
  const c = census(root);
  assert.ok(c.materials <= c.meshes, `${c.materials} materials for ${c.meshes} meshes`);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.parent?.name !== 'sky') meshes.push(o); });
  const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
  const fr = new THREE.Frustum(), m = new THREE.Matrix4(), sph = new THREE.Sphere();
  let worst = { calls: 0, tris: 0, d: 0 };
  for (let d = 0; d < rail.length; d += 10) {
    const p = rail.positionAt(d), a = rail.positionAt(Math.min(rail.length, d + 15));
    cam.position.set(p.x, p.y + 1.66, p.z);
    cam.lookAt(a.x, a.y + 1.6, a.z);
    cam.updateMatrixWorld(true);
    fr.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let calls = 0, tris = 0;
    for (const o of meshes) {
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      if (o.frustumCulled !== false && !fr.intersectsSphere(sph)) continue;
      calls++;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    if (tris > worst.tris) worst = { calls, tris, d };
  }
  // Measured: worst 550k triangles in about 600 draw calls (the opening
  // frame, which looks down the whole hill). Ceilings with room for detail,
  // well inside what a desktop GPU draws at 60 fps under WebGL2.
  assert.ok(worst.tris < 2_000_000, `${Math.round(worst.tris).toLocaleString()} triangles in the view at ${worst.d} m`);
  assert.ok(worst.calls < 1200, `${worst.calls} draw calls in the view at ${worst.d} m: tiling or batching has broken`);
});

test('the only textures in the world are the shared ground patterns', () => {
  // Every surface is vertex-coloured, which is what lets thousands of meshes
  // merge into a few dozen batches and keeps texture memory near zero. The
  // one exception is the ground: granite setts cannot be said in flat colour,
  // and in the survey photos they are the most recognisable thing on the
  // lanes. So the street surfaces carry ONE of the few small procedural
  // patterns from src/render/textures.js, shared by every mesh that uses it,
  // and nothing else may carry a map at all.
  const rail = new Rail(railPoints());
  const { root } = buildWorld(rail, 0xBADA55);
  const textures = new Set();
  const stray = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        if (!m[slot]) continue;
        if (slot === 'map' && m.map.isDataTexture && m.map.image.width <= 256) textures.add(m.map);
        else stray.push(`${o.name || '(unnamed)'}.${slot}`);
      }
    }
  });
  assert.deepEqual(stray, [], `these carry textures they should not: ${stray.slice(0, 5).join(', ')}`);
  assert.ok(textures.size <= 4, `${textures.size} distinct ground textures; they are meant to be shared`);
});
