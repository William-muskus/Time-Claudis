import { test } from 'node:test';
import assert from 'node:assert/strict';
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
