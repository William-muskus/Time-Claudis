import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution } from '../src/render/adaptive.js';

/** Feed n frames at a given frame time, return the last scale change seen. */
function feed(ar, ms, frames) {
  let last = null;
  for (let i = 0; i < frames; i++) {
    const r = ar.sample(ms);
    if (r !== null) last = r;
  }
  return last;
}

test('holds full resolution when comfortably inside budget', () => {
  const ar = new AdaptiveResolution();
  feed(ar, 12, 400);
  assert.equal(ar.scale, 1.0);
});

test('scales down when over budget', () => {
  const ar = new AdaptiveResolution();
  feed(ar, 28, 300);
  assert.ok(ar.scale < 0.9, `expected a drop, got ${ar.scale}`);
  assert.ok(ar.scale >= 0.55, 'must not fall below the floor');
});

test('never falls below the floor no matter how bad it gets', () => {
  const ar = new AdaptiveResolution();
  feed(ar, 900, 3000);
  assert.equal(ar.scale, 0.55);
});

test('a single hitch does not move the scale', () => {
  const ar = new AdaptiveResolution();
  // A comfortable run with one catastrophic frame in the middle.
  for (let i = 0; i < 200; i++) ar.sample(i === 100 ? 850 : 11);
  assert.equal(ar.scale, 1.0, 'median must absorb an isolated spike');
});

test('recovers upward when load drops, but slowly', () => {
  const ar = new AdaptiveResolution();
  feed(ar, 30, 400);
  const dropped = ar.scale;
  assert.ok(dropped < 1.0);
  const afterOneStep = feed(ar, 9, 80);
  assert.ok(afterOneStep > dropped, 'should begin recovering');
  assert.ok(afterOneStep - dropped < 0.06, 'recovery must be gentler than the drop');
});

test('does not oscillate at the boundary', () => {
  const ar = new AdaptiveResolution();
  // Sit exactly at budget: the dead band between thresholds should hold.
  feed(ar, 16.7, 600);
  assert.equal(ar.scale, 1.0, 'a frame time at budget must not trigger changes');
});
