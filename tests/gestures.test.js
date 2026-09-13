import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureRecognizer } from '../src/input/gestures.js';
import { POSES, makeHand } from './synthhand.js';

const DT = 1 / 60;

/** Feed one pose for n frames, return the array of results. */
function feed(rec, hand, frames = 1) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(rec.update(hand, DT));
  return out;
}

test('one curl produces exactly one shot', () => {
  const rec = new GestureRecognizer();
  feed(rec, POSES.point(), 5);
  // Squeeze all the way through the pull.
  const during = [
    ...feed(rec, POSES.squeezing(), 3),
    ...feed(rec, POSES.fired(), 10),
  ];
  const shots = during.filter((r) => r.fired).length;
  assert.equal(shots, 1, 'a single continuous curl must fire exactly once');
});

test('holding the trigger down does not auto-fire', () => {
  const rec = new GestureRecognizer();
  feed(rec, POSES.point(), 5);
  feed(rec, POSES.fired(), 1);
  const held = feed(rec, POSES.fired(), 120); // two seconds clamped shut
  assert.equal(held.filter((r) => r.fired).length, 0, 'held trigger must not repeat');
});

test('releasing and re-curling fires again', () => {
  const rec = new GestureRecognizer();
  feed(rec, POSES.point(), 5);
  let total = feed(rec, POSES.fired(), 5).filter((r) => r.fired).length;
  feed(rec, POSES.point(), 5);            // let the trigger return
  total += feed(rec, POSES.fired(), 5).filter((r) => r.fired).length;
  feed(rec, POSES.point(), 5);
  total += feed(rec, POSES.fired(), 5).filter((r) => r.fired).length;
  assert.equal(total, 3, 'three pulls, three shots');
});

test('gun raised to the sky reads as RELOAD', () => {
  const rec = new GestureRecognizer();
  const r = feed(rec, POSES.reload(), 3).at(-1);
  assert.equal(r.gunUp, true, 'vertical barrel must set gunUp');
  assert.ok(r.elevation > 80, `elevation was ${r.elevation}`);
});

test('gun down at the screen does not read as RELOAD', () => {
  const rec = new GestureRecognizer();
  const r = feed(rec, POSES.point(), 3).at(-1);
  assert.equal(r.gunUp, false);
});

test('cannot fire while the gun is up', () => {
  const rec = new GestureRecognizer();
  feed(rec, POSES.point(), 5);
  // Curl the middle finger hard while vertical — should be swallowed.
  const up = makeHand({ elevationDeg: 88, middleCurl: 0.95 });
  const res = feed(rec, up, 30);
  assert.equal(res.filter((r) => r.fired).length, 0, 'no shots from cover');
});

test('the vulnerable mid-raise is neither up nor aiming cleanly', () => {
  const rec = new GestureRecognizer();
  const r = feed(rec, POSES.raising(), 3).at(-1);
  assert.equal(r.gunUp, false, '45 deg is below the reload threshold');
  assert.ok(r.elevation > 40 && r.elevation < 50);
});

test('an open palm is not a finger gun', () => {
  const rec = new GestureRecognizer();
  const r = feed(rec, POSES.openPalm(), 3).at(-1);
  assert.notEqual(r.pose, 'point', 'open hand must not classify as POINT');
});

test('aim is mirrored so moving right moves the crosshair right', () => {
  const rec = new GestureRecognizer();
  // Hand on the LEFT of the raw camera image...
  feed(rec, POSES.point({ x: 0.2 }), 60);
  const left = rec.last.aim.x;
  feed(rec, POSES.point({ x: 0.8 }), 60);
  const right = rec.last.aim.x;
  assert.ok(right < left,
    `raw image +x must map to screen -x (mirror): got ${left} then ${right}`);
});

test('aim lags the hand rather than snapping to it', () => {
  const rec = new GestureRecognizer();
  feed(rec, POSES.point({ x: 0.5 }), 90);
  const settled = rec.last.aim.x;
  const oneFrame = feed(rec, POSES.point({ x: 0.9 }), 1).at(-1);
  assert.ok(Math.abs(oneFrame.aim.x - settled) < 0.2,
    'crosshair must not teleport in a single frame');
});

test('aim survives a brief dropout without recentring', () => {
  const rec = new GestureRecognizer();
  feed(rec, POSES.point({ x: 0.25 }), 90);
  const before = rec.last.aim.x;
  const gone = feed(rec, null, 3).at(-1);
  assert.ok(gone.present, 'three missing frames is within the grace window');
  assert.ok(Math.abs(gone.aim.x - before) < 0.1, 'aim must hold through a dropout');
  const longGone = feed(rec, null, 30).at(-1);
  assert.equal(longGone.present, false, 'a long dropout must report hand lost');
});
