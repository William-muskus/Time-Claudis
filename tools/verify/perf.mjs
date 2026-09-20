/**
 * What the game costs, in the two halves that can be measured without a GPU.
 *
 * WHY THIS EXISTS. Nobody has ever run this on real hardware, and the
 * verification harness renders through SwiftShader at 0.8 frames a second, so
 * it can say nothing at all about whether a real machine holds 60. That is a
 * genuine gap and this tool does not close it. What it does is measure the two
 * things that ARE knowable from here, and that between them decide most of the
 * answer:
 *
 *   STRUCTURAL COST — draw calls, triangles, materials, unique geometries.
 *   Hardware-independent, and the numbers a GPU budget is actually written
 *   against. A scene at 66 draw calls is not going to be submission-bound on
 *   anything made this decade; one at 29,000 would be, on everything.
 *
 *   CPU COST — the wall-clock cost of one game.update() on this machine, with
 *   the real world, the real director, and the real bullet and enemy
 *   simulation. This is a real number on real silicon. It is the half of the
 *   frame budget the GPU cannot help with, and if it alone eats 16.7 ms then
 *   no amount of resolution scaling will save the frame rate.
 *
 * WHAT IS STILL UNMEASURED: fill rate, shader cost, bloom and FXAA passes, and
 * the MediaPipe hand tracker's share of the frame. Those need a browser on a
 * GPU, and that is the playtest's job — see docs/PLAYTEST.md.
 *
 *   node tools/verify/perf.mjs
 */
import * as THREE from 'three';
import { Game } from '../../src/gameplay/game.js';
import { RailCamera } from '../../src/rail/camera.js';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { EventBus } from '../../src/core/events.js';

const DT = 1 / 60;
const SEED = 0xC0FFEE;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
const rail = new Rail(railPoints());

const tWorld = performance.now();
const { root, anchors, occluders } = buildWorld(rail, SEED);
const worldMs = performance.now() - tWorld;

/** Count what a renderer would have to submit. */
function census(obj) {
  let meshes = 0, tris = 0, points = 0;
  const materials = new Set(), geometries = new Set();
  obj.traverse((o) => {
    if (!o.isMesh && !o.isLine && !o.isPoints) return;
    meshes++;
    const g = o.geometry;
    if (!g) return;
    geometries.add(g.uuid);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m) materials.add(m.uuid);
    }
    const pos = g.attributes?.position;
    if (!pos) return;
    points += pos.count;
    const n = g.index ? g.index.count : pos.count;
    if (o.isMesh) tris += n / 3;
  });
  return { meshes, tris, points, materials: materials.size, geometries: geometries.size };
}

const c = census(root);

console.log('STRUCTURAL');
console.log(`  world build          ${worldMs.toFixed(0)} ms`);
console.log(`  draw calls (meshes)  ${c.meshes}`);
console.log(`  triangles            ${c.tris.toLocaleString()}`);
console.log(`  vertices             ${c.points.toLocaleString()}`);
console.log(`  unique geometries    ${c.geometries}`);
console.log(`  unique materials     ${c.materials}`);
console.log(`  combat anchors       ${anchors.length}`);
console.log(`  occluder boxes       ${occluders.length}`);

// --- CPU: one frame of the real simulation, under real load ---------------
const railCamera = new RailCamera(camera, rail);
railCamera.snapTo(0);
const bus = new EventBus();
const game = new Game({ scene, camera, railCamera, rail, anchors, occluders, bus, seed: SEED });

/** The oracle from tests/playthrough.js, cut down: duck, or shoot the gate. */
function input() {
  const s = game.snapshot();
  const enemies = game.director.targets();
  const threat = enemies.some((e) => e.telegraphStage === 'commit' || e.telegraphStage === 'flash');
  // Rounds already in the air count too, exactly as in the playthrough oracle.
  // Without this the player dies constantly, the director never gets a full
  // wave onto the street, and the load this is trying to measure never arrives.
  const inbound = game.bullets.bullets.some((b) => b.active);
  if (threat || inbound || s.rounds === 0) return { aim: { x: 0.5, y: 0.5 }, fired: false, gunUp: true, present: true };
  const t = enemies.find((e) => e.isGating) ?? enemies[0];
  if (!t) return { aim: { x: 0.5, y: 0.5 }, fired: false, gunUp: false, present: true };
  const p = t.group.position.clone(); p.y += 1;
  const ndc = p.project(camera);
  return {
    aim: { x: (ndc.x + 1) / 2, y: (-ndc.y + 1) / 2 },
    fired: s.coverState === 'EXPOSED', gunUp: false, present: true,
  };
}

const frames = [];
let liveMax = 0;
for (let i = 0; i < 60 * 240 && !game.director.isFinished; i++) {
  const t0 = performance.now();
  game.update(DT, input());
  frames.push(performance.now() - t0);
  liveMax = Math.max(liveMax, game.director.enemies.filter((e) => e.isAlive).length);
  if (game.gameOver) game.useContinue();
}

frames.sort((a, b) => a - b);
const pct = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))];
console.log('\nCPU, game.update() only, on this machine');
console.log(`  frames measured      ${frames.length}`);
console.log(`  median               ${pct(0.5).toFixed(3)} ms`);
console.log(`  95th percentile      ${pct(0.95).toFixed(3)} ms`);
console.log(`  99th percentile      ${pct(0.99).toFixed(3)} ms`);
console.log(`  worst                ${frames[frames.length - 1].toFixed(3)} ms`);
console.log(`  peak live enemies    ${liveMax}`);
console.log(`\n  budget at 60 fps is 16.667 ms for EVERYTHING.`);
console.log(`  simulation takes ${(pct(0.95) / 16.667 * 100).toFixed(1)}% of it at p95.`);
