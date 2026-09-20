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
  // 400 ms a frame: two and a half frames per second, and still a frame.
  feed(ar, 400, 3000);
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

/**
 * The controller is now fed wall-clock frame intervals rather than the cost of
 * submitting a frame. See the header of src/render/adaptive.js for why the old
 * measurement was wrong in exactly the case the scaler exists for. These tests
 * cover the consequences of that change, which the original five did not
 * distinguish because they fed the controller synthetic numbers directly.
 */

test('a backgrounded tab does not collapse the resolution', () => {
  const ar = new AdaptiveResolution();
  feed(ar, 12, 200);
  // rAF stops while a tab is hidden, so "the last frame took four seconds"
  // says nothing about rendering cost. Under the old reading — time around
  // the draw call — this case could not arise; under the new one it arises
  // every time the player switches tabs.
  feed(ar, 4000, 60);
  assert.equal(ar.scale, 1.0, 'a hidden tab is not a slow GPU');
  assert.ok(ar.dropped >= 60, 'the gaps should be counted, not measured');
  // And it picks straight back up where it was when the tab comes back.
  feed(ar, 12, 200);
  assert.equal(ar.scale, 1.0);
});

test('a vsynced machine still recovers resolution', () => {
  // THE FAILURE THE PROBE EXISTS FOR. Under vsync a 60 Hz display reports
  // 16.7 ms whether the frame cost three milliseconds or fifteen, so a
  // threshold on measured headroom can never fire and a scaler that has once
  // gone down can never come back up. Before the probe, this test sat at
  // whatever the drop left it at forever.
  const ar = new AdaptiveResolution();
  feed(ar, 30, 400);              // a rough patch
  const low = ar.scale;
  assert.ok(low < 0.9, `expected a drop, got ${low}`);

  feed(ar, 16.7, 4000);           // back to a locked 60, with vsync hiding the headroom
  assert.ok(ar.scale > low, `never recovered: still ${ar.scale}`);
  assert.ok(ar.scale > 0.9, `recovery stalled at ${ar.scale}`);
});

test('probing backs off instead of pumping at the sustainable scale', () => {
  // A machine that can hold 60 at 0.75 and not at 0.78 will fail every probe.
  // A naive ladder pumps between the two forever, which is more distracting
  // than simply being soft. Each failed probe has to cost more than the last.
  const CEILING = 0.75;
  const ar = new AdaptiveResolution();
  let changes = 0;
  for (let i = 0; i < 60000; i++) {
    // Frame time is a step function of resolution: fine at or under the
    // ceiling, over budget above it.
    const ms = ar.scale <= CEILING + 1e-9 ? 16.7 : 21.0;
    if (ar.sample(ms) !== null) changes++;
  }
  assert.ok(ar.scale <= CEILING + ar.upStep + 1e-6,
    `settled above what the machine can hold: ${ar.scale}`);
  assert.ok(ar.probeFrames > ar.baseProbeFrames,
    'repeated failed probes must lengthen the wait');
  // 60000 frames is about seventeen minutes at 60 fps. Without backoff this
  // is in the hundreds.
  assert.ok(changes < 40,
    `${changes} resolution changes in seventeen minutes is visible pumping`);
});

test('a machine with real headroom does not wait for the probe clock', () => {
  // The probe is for the vsynced case. When the frame time genuinely is far
  // under budget there is nothing to guess about, and making a fast machine
  // wait two seconds per step up would be a regression on the old behaviour.
  const ar = new AdaptiveResolution();
  feed(ar, 30, 400);
  const low = ar.scale;
  feed(ar, 6, 300);   // uncapped, clearly fast
  assert.ok(ar.scale - low > 0.04,
    `measured headroom should climb faster than a probe would: ${low} -> ${ar.scale}`);
});

test('reset forgets the backoff as well as the scale', () => {
  const ar = new AdaptiveResolution();
  for (let i = 0; i < 20000; i++) ar.sample(ar.scale <= 0.7 ? 16.7 : 21.0);
  assert.ok(ar.probeFrames > ar.baseProbeFrames);
  ar.reset();
  assert.equal(ar.scale, 1.0);
  assert.equal(ar.probeFrames, ar.baseProbeFrames,
    'a reset machine may be a different machine; do not carry its penalty over');
});
