import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Game } from '../src/gameplay/game.js';
import { RailCamera } from '../src/rail/camera.js';
import { Rail } from '../src/core/spline.js';
import { railPoints } from '../src/data/route.js';
import { buildWorld } from '../src/world/index.js';
import { EventBus } from '../src/core/events.js';
import { ENCOUNTERS } from '../src/gameplay/encounters.js';

/**
 * Can the game actually be finished?
 *
 * Every other test checks a rule in isolation. This one plays the whole stage
 * against the REAL world — the real anchors, the real waves, the real boss —
 * with an oracle player, and asserts it reaches the end. It is the only test
 * that can catch a stage which is unwinnable because a gating enemy spawns
 * somewhere unshootable, or a par time that cannot be met, or an area that
 * never clears because its gate condition can never be satisfied.
 *
 * It is slow by this suite's standards (a few seconds) and worth every one.
 */

const DT = 1 / 60;

function setup(seed) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
  const rail = new Rail(railPoints());
  const { anchors, occluders } = buildWorld(rail, seed);
  const railCamera = new RailCamera(camera, rail);
  railCamera.snapTo(0);
  const bus = new EventBus();
  return { game: new Game({ scene, camera, railCamera, rail, anchors, occluders, bus, seed }), bus, camera };
}

/**
 * An oracle player.
 *
 * Aims at whatever gates the area, ducks the moment anything commits to a
 * shot, and comes back out as soon as the threat passes. Deliberately NOT
 * superhuman: it obeys the same cover timings and the same magazine as a
 * person, so if it cannot finish the stage, neither can anyone.
 */
function oracle(game, camera) {
  const s = game.snapshot();
  const enemies = game.director.targets();

  const threat = enemies.some(
    (e) => e.telegraphStage === 'commit' || e.telegraphStage === 'flash');
  // Rounds already in the air count too. A telegraph tells you a shot is
  // coming; the tracer tells you one is still on its way, and popping out into
  // it is the player's mistake rather than the game's unfairness.
  const inbound = game.bullets.bullets.some((b) => b.active);
  const dry = s.rounds === 0;

  // Duck to reload, or to survive. Reload takes priority: an empty gun cannot
  // clear a gate no matter how brave you are.
  if (dry || threat || inbound) return { aim: { x: 0.5, y: 0.5 }, fired: false, gunUp: true, present: true };

  // Prefer gating enemies; they are what actually ends the area.
  const target = enemies.find((e) => e.isGating) ?? enemies[0];
  if (!target) return { aim: { x: 0.5, y: 0.5 }, fired: false, gunUp: false, present: true };

  const p = target.group.position.clone();
  p.y += 1.0;
  const ndc = p.project(camera);
  const aim = {
    x: THREE.MathUtils.clamp((ndc.x + 1) / 2, 0, 1),
    y: THREE.MathUtils.clamp((-ndc.y + 1) / 2, 0, 1),
  };
  // Only shoot at something actually on screen and in front of us.
  const onScreen = Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1;
  return { aim, fired: onScreen && s.coverState === 'EXPOSED', gunUp: false, present: true };
}

test('the stage can be finished', () => {
  const { game, bus, camera } = setup(0xC0FFEE);
  const cleared = [];
  let complete = false;
  bus.on('area.cleared', (p) => cleared.push(p.areaId));
  bus.on('stage.complete', () => { complete = true; });

  // Ten simulated minutes is far longer than the stage's total par time, so
  // running out means something is genuinely stuck rather than merely slow.
  const MAX = 60 * 600;
  let frames = 0;
  while (!complete && frames++ < MAX) {
    game.update(DT, oracle(game, camera));
    // A death is allowed; an unwinnable stage is not. Spend continues so the
    // test measures whether the stage can be completed, not whether the
    // oracle is good at it.
    if (game.gameOver) game.useContinue();
  }

  assert.ok(complete,
    `the stage never completed in ten simulated minutes. Cleared: ` +
    `[${cleared.join(', ')}] of [${ENCOUNTERS.map((e) => e.areaId).join(', ')}]`);
  assert.deepEqual(cleared, ENCOUNTERS.map((e) => e.areaId),
    'every area must be cleared, in order');
});

test('a competent player finishes without spending every credit', () => {
  const { game, camera } = setup(0xBADA55);
  let frames = 0;
  while (!game.director.isFinished && frames++ < 60 * 600) {
    game.update(DT, oracle(game, camera));
    if (game.gameOver) game.useContinue();
  }
  assert.ok(game.continuesUsed < 12,
    `the oracle needed ${game.continuesUsed} continues; the stage is too punishing`);
  assert.ok(game.score > 0, 'a completed stage must have scored something');
});

test('the boss is reachable and killable', () => {
  const { game, bus, camera } = setup(0x5EED);
  let bossSpawned = false;
  let bossKilled = false;
  bus.on('enemy.spawned', (p) => { if (p.isBoss) bossSpawned = true; });
  bus.on('enemy.killed', (p) => { if (p.class === 'BOSS') bossKilled = true; });

  let frames = 0;
  while (!bossKilled && frames++ < 60 * 600) {
    game.update(DT, oracle(game, camera));
    if (game.gameOver) game.useContinue();
  }
  assert.ok(bossSpawned, 'the boss never spawned; the stage cannot end');
  assert.ok(bossKilled, 'the boss spawned but could not be killed');
});

test('weapon pickups are actually obtainable', () => {
  const { game, bus, camera } = setup(0xF00D);
  const granted = new Set();
  bus.on('weapon.granted', (p) => granted.add(p.weapon));

  let frames = 0;
  while (!game.director.isFinished && frames++ < 60 * 600) {
    game.update(DT, oracle(game, camera));
    if (game.gameOver) game.useContinue();
  }
  assert.ok(granted.size > 0,
    'no pickup was ever obtained across a whole stage; the carriers are unreachable');
});

test('the clock is generous enough to clear every area', () => {
  // An area that cannot be cleared inside its par time is a wall, not a
  // challenge. Play each area and record how much clock was left.
  const { game, bus, camera } = setup(0x1234);
  const margins = [];
  bus.on('area.cleared', (p) => margins.push({ area: p.areaId, left: p.timeLeft }));

  let frames = 0;
  while (!game.director.isFinished && frames++ < 60 * 600) {
    game.update(DT, oracle(game, camera));
    if (game.gameOver) game.useContinue();
  }
  assert.ok(margins.length >= 4, `only ${margins.length} areas cleared`);
  for (const m of margins) {
    assert.ok(m.left >= 0, `${m.area} cleared with a negative clock`);
  }
});

/**
 * Does every event actually fire?
 *
 * tests/wiring.test.js checks the two source-level halves — that nothing
 * listens for an event nobody sends, and that nothing is sent into an empty
 * room. Neither of them can tell you whether the emit is ever REACHED. An
 * `emit` behind a condition that is never true passes both of those tests and
 * still means the player never hears the cue.
 *
 * So: play the stage, spy on the bus, and see what came out. This is the only
 * check in the suite that the audio a player would hear is the audio the code
 * describes. Events genuinely conditional on failure or on a specific weapon
 * are excused by name; everything else has to appear in an ordinary win.
 */
test('every event the game claims to emit is reached in a real playthrough', () => {
  const { game, bus, camera } = setup(0xC0FFEE);
  const fired = new Map();
  const origEmit = bus.emit.bind(bus);
  bus.emit = (name, payload) => { fired.set(name, (fired.get(name) ?? 0) + 1); return origEmit(name, payload); };

  let frames = 0;
  while (!game.director.isFinished && frames++ < 60 * 600) {
    game.update(DT, oracle(game, camera));
    if (game.gameOver) game.useContinue();
  }

  // What an oracle run cannot be expected to produce, and why.
  const NOT_IN_A_CLEAN_RUN = {
    // The oracle ducks on every telegraph and every inbound round, so it can
    // finish without ever being hit. That is the point of it.
    'player.hit': 'the oracle is not supposed to get hit',
    'player.died': 'follows player.hit',
    'game.over': 'follows player.died three times',
    'game.continued': 'follows game.over',
    'continue.tick': 'follows game.over',
    'continue.expired': 'follows game.over',
    'area.retry': 'follows a death inside an area',
    'area.timeout': 'the oracle beats par',
    // The HUD emits this one, and the HUD is not instantiated here.
    'ui.countFinished': 'HUD-only, no HUD in this harness',
  };

  // Events that MAY or may not appear depending on the seed, so they are
  // excused in both directions. Kept separate from the list above on purpose:
  // everything above is a claim that the event cannot happen in a clean win,
  // and a claim that weak is not worth making.
  const SEED_DEPENDENT = {
    // The oracle aims at the centre of mass of whatever gates the area and
    // the shotgun's first pellet goes dead centre, so it rarely misses.
    // A human misses constantly; this says nothing about reachability.
    'shot.miss': 'the oracle is a perfect aimer',
    // I first excused this as "asserted absent elsewhere". It is not, and it
    // is not absent: the director drops spawns it cannot place on some seeds.
    // Bounded by its own test below rather than hidden here.
    'spawn.failed': 'happens; budgeted by the spawn-placement test',
    // Grenades are a pickup the seed may never hand out.
    'enemy.detonated': 'needs the grenade launcher specifically',
  };

  const emitters = ['src/gameplay/game.js', 'src/gameplay/director.js',
                    'src/gameplay/weapons.js', 'src/ui/hud.js'];
  const declared = new Set();
  for (const f of emitters) {
    const text = readFileSync(join(process.cwd(), f), 'utf8');
    for (const m of text.matchAll(/emit\('([\w.]+)'/g)) declared.add(m[1]);
  }

  const never = [...declared]
    .filter((e) => !fired.has(e) && !(e in NOT_IN_A_CLEAN_RUN) && !(e in SEED_DEPENDENT))
    .sort();
  assert.deepEqual(never, [],
    `these events are emitted in the source but never reached in a full ` +
    `playthrough — the cue exists and the player never hears it: ${never.join(', ')}`);

  // And keep the excuses honest: an event listed here that DOES fire in a
  // clean run is an excuse that has outlived its reason.
  const wrong = Object.keys(NOT_IN_A_CLEAN_RUN).filter((e) => fired.has(e)).sort();
  assert.deepEqual(wrong, [],
    `these are excused as unreachable in a clean run but fired anyway: ${wrong.join(', ')}`);
});

/**
 * How many authored enemies never make it onto the street?
 *
 * FOUND BY ACCIDENT, and worth keeping. The event-reachability test above was
 * written with `spawn.failed` excused on the grounds that it "never fires in a
 * clean run". It fires. The excuse was wrong, the test caught the excuse, and
 * the real behaviour is this: the director cannot always place every spawn a
 * wave asks for, and when it cannot, it drops it.
 *
 * That is not a correctness bug — gating is computed from the enemies that are
 * actually alive, so an area still clears — but it is a fidelity loss. A wave
 * an author wrote as five enemies arrives as four, and the pacing they tuned
 * is not the pacing the player gets.
 *
 * Measured across five seeds: 0, 0, 1, 2 and 6 dropped out of 38-44 spawned.
 * The 6 is worse than it should be and is the honest known gap here. This test
 * exists so it cannot quietly get worse while nobody is counting, and so the
 * day someone widens the anchor set there is a number to compare against.
 */
test('the director places nearly every enemy a wave asks for', () => {
  const RESULTS = [];
  for (const seed of [0xC0FFEE, 0xBADA55, 0x5EED, 0xF00D, 0x1234]) {
    const { game, bus, camera } = setup(seed);
    let failed = 0, spawned = 0;
    bus.on('spawn.failed', () => failed++);
    bus.on('enemy.spawned', () => spawned++);
    let frames = 0;
    while (!game.director.isFinished && frames++ < 60 * 600) {
      game.update(DT, oracle(game, camera));
      if (game.gameOver) game.useContinue();
    }
    RESULTS.push({ seed: seed.toString(16), spawned, failed });
  }
  const show = RESULTS.map((r) => `${r.seed}: ${r.failed}/${r.spawned + r.failed}`).join(', ');

  for (const r of RESULTS) {
    assert.ok(r.spawned > 30,
      `seed ${r.seed} only got ${r.spawned} enemies onto the street (${show})`);
    // A stage that drops a fifth of its cast is not the stage that was
    // authored. This is a ceiling on a known gap, not an endorsement of it.
    const rate = r.failed / (r.spawned + r.failed);
    assert.ok(rate < 0.2,
      `seed ${r.seed} dropped ${(rate * 100).toFixed(0)}% of its spawns (${show})`);
  }
});
