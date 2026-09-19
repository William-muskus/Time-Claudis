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

test('the world still submits in a couple of hundred draw calls', () => {
  const rail = new Rail(railPoints());
  const { root } = buildWorld(rail, 0xC0FFEE);
  const c = census(root);

  // Measured: 66. The ceiling is three times that, so ordinary authoring has
  // room and a batcher that has quietly stopped working does not.
  assert.ok(c.meshes < 200,
    `${c.meshes} draw calls — the static batcher is not doing its job`);
  // One material per batch, give or take. A number near the mesh count means
  // materials have stopped being shared and batching cannot merge anything.
  assert.ok(c.materials <= c.meshes,
    `${c.materials} materials for ${c.meshes} meshes`);
  // Measured: 320,510. A low-poly stage that crosses a million triangles is
  // not low-poly any more, whatever it looks like.
  assert.ok(c.tris < 700000,
    `${c.tris.toLocaleString()} triangles is no longer a low-poly scene`);
});

test('nothing in the world needs a texture upload', () => {
  // Every surface is vertex-coloured. That is what lets 23,000 meshes merge
  // into 66 batches in the first place, and it is also why the game has no
  // texture memory to speak of. A map slipping in would break both.
  const rail = new Rail(railPoints());
  const { root } = buildWorld(rail, 0xBADA55);
  const textured = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        if (m[slot]) textured.push(`${o.name || '(unnamed)'}.${slot}`);
      }
    }
  });
  assert.deepEqual(textured, [],
    `these carry textures in a vertex-coloured scene: ${textured.slice(0, 5).join(', ')}`);
});
