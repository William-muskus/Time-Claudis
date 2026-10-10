import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverController, CoverState, EMERGE_MS, HIDE_MS } from '../src/core/cover.js';
import { WeaponSystem, WEAPONS } from '../src/gameplay/weapons.js';
import { EventBus } from '../src/core/events.js';

/**
 * The cover contract, pinned.
 *
 * docs/GAMEPLAY.md §1 is the spec. These run on a synthetic clock with no
 * browser, so the feel can be regression-tested in milliseconds. If one of
 * these fails, the game has stopped being Time Crisis.
 */

const STEP = 1 / 240;   // fine enough that threshold crossings are not aliased

/** Advance the controller by `ms`, holding one intent. */
function hold(c, ms, wantsOut) {
  let t = 0;
  while (t < ms) { c.update(STEP, wantsOut); t += STEP * 1000; }
  return c;
}

test('emerging from cover takes the spec duration', () => {
  const c = new CoverController();
  hold(c, EMERGE_MS - 12, true);
  assert.notEqual(c.state, CoverState.EXPOSED, 'must not be out early');
  hold(c, 24, true);
  assert.equal(c.state, CoverState.EXPOSED);
});

test('hiding takes the spec duration and is FASTER than emerging', () => {
  assert.ok(HIDE_MS < EMERGE_MS,
    'bailing out must be cheaper than committing — that asymmetry is the design');
  const c = new CoverController();
  hold(c, EMERGE_MS + 30, true);
  assert.equal(c.state, CoverState.EXPOSED);
  hold(c, HIDE_MS - 12, false);
  assert.notEqual(c.state, CoverState.COVERED, 'must not be safe early');
  hold(c, 24, false);
  assert.equal(c.state, CoverState.COVERED);
});

test('reversing mid-transition resumes from where it is and does not snap', () => {
  const c = new CoverController();
  hold(c, EMERGE_MS * 0.5, true);
  const mid = c.exposure;
  assert.ok(mid > 0.35 && mid < 0.65, `expected roughly half exposed, got ${mid}`);
  // Reverse for a moment, then reverse again.
  hold(c, HIDE_MS * 0.2, false);
  const after = c.exposure;
  assert.ok(after < mid, 'reversing must move back toward cover');
  assert.ok(after > 0.05, 'and must NOT snap all the way to cover');
});

test('the player is vulnerable during BOTH transitions', () => {
  const c = new CoverController();
  assert.equal(c.isVulnerable(), false, 'fully covered is safe');

  hold(c, EMERGE_MS * 0.4, true);
  assert.equal(c.state, CoverState.EMERGING);
  assert.equal(c.isVulnerable(), true, 'coming out is exposed');

  hold(c, EMERGE_MS, true);
  assert.equal(c.isVulnerable(), true, 'standing out is obviously exposed');

  hold(c, HIDE_MS * 0.4, false);
  assert.equal(c.state, CoverState.HIDING);
  assert.equal(c.isVulnerable(), true,
    'getting down is STILL exposed — this is what makes ducking cost something');

  hold(c, HIDE_MS, false);
  assert.equal(c.isVulnerable(), false);
});

test('you can only shoot when fully out', () => {
  const c = new CoverController();
  assert.equal(c.canShoot(), false);
  hold(c, EMERGE_MS * 0.9, true);
  assert.equal(c.canShoot(), false, 'mid-emerge cannot shoot');
  hold(c, EMERGE_MS * 0.2, true);
  assert.equal(c.canShoot(), true);
  hold(c, HIDE_MS * 0.1, false);
  assert.equal(c.canShoot(), false, 'the instant you start ducking, the gun is down');
});

test('taking a hit forces you down immediately', () => {
  const c = new CoverController();
  hold(c, EMERGE_MS + 50, true);
  assert.equal(c.state, CoverState.EXPOSED);
  c.forceCover();
  assert.equal(c.state, CoverState.COVERED);
  assert.equal(c.exposure, 0);
  assert.equal(c.isVulnerable(), false);
});

test('cover time only accumulates while fully covered', () => {
  const c = new CoverController();
  hold(c, 300, false);
  assert.ok(c.timeInCoverMs > 250, 'sitting in cover accumulates');
  hold(c, 60, true);
  assert.equal(c.timeInCoverMs, 0, 'starting to emerge resets the reload clock');
});

// ---------------------------------------------------------------------------
// The reload-by-hiding economy — docs/GAMEPLAY.md §2
// ---------------------------------------------------------------------------

test('reloading happens in cover and ONLY in cover', () => {
  const bus = new EventBus();
  const w = new WeaponSystem(bus);
  const c = new CoverController();

  // Empty the gun.
  let now = 0;
  for (let i = 0; i < WEAPONS.HANDGUN.mag; i++) {
    now += WEAPONS.HANDGUN.rofMs + 1;
    w.tryFire(now);
  }
  assert.equal(w.rounds, 0);

  // Standing out, time passing, still empty.
  hold(c, 2000, true);
  now += 2000;
  w.update(now, c.timeInCoverMs);
  assert.equal(w.rounds, 0, 'you cannot reload while exposed');

  // Duck, but not for long enough.
  hold(c, WEAPONS.HANDGUN.reloadMs * 0.5, false);
  now += WEAPONS.HANDGUN.reloadMs * 0.5;
  w.update(now, c.timeInCoverMs);
  assert.equal(w.rounds, 0,
    'ducking for less than reloadMs leaves you empty — the mistake the game lets you make');

  // Stay down.
  hold(c, WEAPONS.HANDGUN.reloadMs, false);
  now += WEAPONS.HANDGUN.reloadMs;
  w.update(now, c.timeInCoverMs);
  assert.equal(w.rounds, WEAPONS.HANDGUN.mag, 'a full duck reloads');
});

test('the handgun has infinite magazines and is never taken away', () => {
  const bus = new EventBus();
  const w = new WeaponSystem(bus);
  for (let cycle = 0; cycle < 5; cycle++) {
    let now = cycle * 100000;
    for (let i = 0; i < WEAPONS.HANDGUN.mag; i++) {
      now += WEAPONS.HANDGUN.rofMs + 1;
      assert.ok(w.tryFire(now) > 0, 'the handgun never runs out of magazines');
    }
    w.update(now, WEAPONS.HANDGUN.reloadMs + 1);
  }
});

test('a timed pickup reverts to the handgun when it expires', () => {
  const bus = new EventBus();
  const w = new WeaponSystem(bus);
  w.grant('SHOTGUN', 1000);
  assert.equal(w.current, 'SHOTGUN');
  w.update(1000 + WEAPONS.SHOTGUN.durationMs - 50, 0);
  assert.equal(w.current, 'SHOTGUN', 'still in date');
  w.update(1000 + WEAPONS.SHOTGUN.durationMs + 50, 0);
  assert.equal(w.current, 'HANDGUN', 'expired back to the handgun');
  assert.equal(w.rounds, WEAPONS.HANDGUN.mag, 'and with a full magazine');
});

test('rate of fire is enforced', () => {
  const bus = new EventBus();
  const w = new WeaponSystem(bus);
  assert.ok(w.tryFire(0) > 0);
  assert.equal(w.tryFire(WEAPONS.HANDGUN.rofMs * 0.5), 0, 'too soon');
  assert.ok(w.tryFire(WEAPONS.HANDGUN.rofMs + 1) > 0);
});

test('an empty gun announces itself exactly once', () => {
  const bus = new EventBus();
  let empties = 0;
  bus.on('weapon.empty', () => empties++);
  const w = new WeaponSystem(bus);
  let now = 0;
  for (let i = 0; i < WEAPONS.HANDGUN.mag; i++) {
    now += WEAPONS.HANDGUN.rofMs + 1;
    w.tryFire(now);
  }
  for (let i = 0; i < 10; i++) {
    now += WEAPONS.HANDGUN.rofMs + 1;
    w.tryFire(now);
  }
  assert.equal(empties, 1, 'the RELOAD callout must not machine-gun');
});
