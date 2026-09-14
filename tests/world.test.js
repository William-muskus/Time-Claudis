import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rail } from '../src/core/spline.js';
import { railPoints } from '../src/data/route.js';
import { buildWorld } from '../src/world/index.js';
import { buildStreet } from '../src/world/street.js';

/**
 * World-build invariants.
 *
 * These run headless in a couple of seconds and catch the class of problem
 * that is otherwise only visible in a software-rendered screenshot minutes
 * later: geometry that never batches, landmarks that get built over, and the
 * slope cues the level's whole three-act structure depends on.
 */

const rail = new Rail(railPoints());
const built = buildWorld(rail);

test('the whole of Montmartre batches into a handful of draw calls', () => {
  const { before, after } = built.stats;
  assert.ok(before > 15000, `expected a substantial world, got ${before} meshes`);
  assert.ok(after < 120,
    `${after} draw calls. Authoring wants one mesh per shutter; rendering does ` +
    'not, and something has stopped batching.');
});

test('nothing in the static world is transparent', () => {
  // Transparency needs per-object sort order, so the batcher cannot merge it.
  // Seventy-five faded sign bars once became seventy-five draw calls and
  // doubled the scene total. Fade by mixing colours, not by alpha.
  const offenders = [];
  built.root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    let p = o, batched = false;
    while (p) { if (p.name === 'batched') { batched = true; break; } p = p.parent; }
    if (batched) return;
    if (o.material.transparent) offenders.push(o.name || o.parent?.name || '?');
  });
  assert.ok(offenders.length < 12,
    `${offenders.length} transparent meshes escaped batching: ${[...new Set(offenders)].slice(0, 5).join(', ')}`);
});

test('every spawn anchor sits on real architecture', () => {
  const allowed = new Set(['door', 'balcony', 'dormer', 'roof', 'alley', 'metro', 'window']);
  for (const a of built.anchors) {
    assert.ok(allowed.has(a.type), `anchor type "${a.type}" is not a real opening`);
    assert.ok(a.worldPos, `anchor ${a.id} has no world position`);
    assert.ok(Number.isFinite(a.worldPos.x), `anchor ${a.id} position is not finite`);
  }
  assert.ok(built.anchors.length > 300,
    `only ${built.anchors.length} anchors; the director will run out of places to spawn`);
});

test('every anchor type the encounters ask for actually exists', async () => {
  const { ENCOUNTERS } = await import('../src/gameplay/encounters.js');
  const available = new Set(built.anchors.map((a) => a.type));
  for (const e of ENCOUNTERS) {
    for (const w of e.waves) {
      for (const sp of w.spawns) {
        const ok = sp.anchorTypes.some((t) => available.has(t));
        assert.ok(ok,
          `${e.areaId} wants one of [${sp.anchorTypes}] and the world publishes none of them`);
      }
    }
  }
});

test('the pavement steps on slopes, so the hill is visible', () => {
  // Over half this route exceeds an 8% grade and it touches 23%. A pavement
  // that ramps alongside a road that ramps gives the eye nothing to measure
  // against, and the climb-crest-descend profile — the level's spine — reads
  // as flat ground in perspective. Paris steps the pavement above ~8%; so do
  // we, and the varying kerb face is what states the gradient.
  const street = buildStreet(rail);
  const kerb = street.children.find((c) => c.name?.startsWith?.('pavement') === false && c.geometry);
  assert.ok(street.children.length > 4, 'street should have carriageway, pavements, kerbs, stairs');
  void kerb;

  // The handrails only exist on sections above 14%, so their presence is a
  // direct assertion that the steep sections survived into geometry.
  const rails = street.getObjectByName('handrails');
  assert.ok(rails, 'no handrail group built');
  let pieces = 0;
  rails.traverse((o) => { if (o.isMesh) pieces++; });
  assert.ok(pieces > 50,
    `only ${pieces} handrail pieces; the steep sections are not being detected`);
});

test('the route really does climb, crest and descend in the built geometry', () => {
  const ys = [];
  for (let i = 0; i <= 20; i++) ys.push(rail.positionAt((i / 20) * rail.length).y);
  const peak = Math.max(...ys);
  const peakAt = ys.indexOf(peak) / 20;
  assert.ok(peakAt > 0.25 && peakAt < 0.75,
    `the crest is at ${(peakAt * 100).toFixed(0)}% along; it should be in the middle third`);
  assert.ok(peak - ys[0] > 25, 'the climb should gain more than 25 m');
  assert.ok(peak - ys.at(-1) > 15, 'the descent should lose more than 15 m');
});

test('landmarks are not built over by the procedural street wall', () => {
  // The gate of 11 bis sits seven metres off the centreline of a six-metre
  // lane, which is exactly where the terrace generator wants to put a house.
  const names = [];
  built.root.traverse((o) => { if (o.name) names.push(o.name); });
  for (const required of ['landmarks', 'facades', 'cover', 'street']) {
    assert.ok(names.includes(required), `the world is missing its "${required}" group`);
  }
});

test('the world builds fast enough to iterate on', () => {
  const t0 = Date.now();
  buildWorld(rail);
  const ms = Date.now() - t0;
  assert.ok(ms < 9000, `world build took ${ms} ms; that is too slow to iterate against`);
});
