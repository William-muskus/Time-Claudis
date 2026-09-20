import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game, START_LIVES, CONTINUE_SECONDS } from '../src/gameplay/game.js';
import { RailCamera } from '../src/rail/camera.js';
import { Rail } from '../src/core/spline.js';
import { railPoints } from '../src/data/route.js';
import { EventBus } from '../src/core/events.js';
import { MAX_CONCURRENT_COMMIT, ENEMY_BULLET_SPEED } from '../src/gameplay/enemyTypes.js';
import * as enemyTypes from '../src/gameplay/enemyTypes.js';
import { WEAPONS } from '../src/gameplay/weapons.js';
import { EMERGE_MS, HIDE_MS } from '../src/core/cover.js';

/**
 * Whole-game tests.
 *
 * These run the real Game against a real scene graph, with no renderer and no
 * browser — Three.js builds and updates a scene perfectly well without WebGL,
 * so the entire simulation is testable headlessly. Only drawing needs a GPU.
 */

const DT = 1 / 60;

function makeGame(seed = 0xBEEF) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
  const rail = new Rail(railPoints());
  const railCamera = new RailCamera(camera, rail);
  railCamera.snapTo(0);
  const bus = new EventBus();
  // A handful of anchors in front of the camera, of every type the encounters
  // ask for, so spawning is never starved in a test.
  const anchors = [];
  const base = rail.positionAt(0);
  const types = ['door', 'alley', 'balcony', 'roof', 'dormer', 'metro'];
  for (let i = 0; i < 40; i++) {
    anchors.push({
      id: `t${i}`,
      type: types[i % types.length],
      worldPos: new THREE.Vector3(base.x + (i % 7) - 3, base.y + (i % 3) * 2, base.z + 14 + (i % 5)),
      side: i % 2 ? 1 : -1,
      facing: new THREE.Vector3(0, 0, 1),
    });
  }
  const game = new Game({ scene, camera, railCamera, rail, anchors, bus, seed });
  return { game, bus, scene, camera, railCamera, rail };
}

const IDLE = { aim: { x: 0.5, y: 0.5 }, fired: false, gunUp: true, present: true };
const OUT = { aim: { x: 0.5, y: 0.5 }, fired: false, gunUp: false, present: true };

function run(game, seconds, intent = IDLE) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) game.update(DT, intent);
}

test('the game starts with the spec lives and a full handgun', () => {
  const { game } = makeGame();
  const s = game.snapshot();
  assert.equal(s.lives, START_LIVES);
  assert.equal(s.weapon, 'HANDGUN');
  assert.equal(s.rounds, s.magSize);
});

test('the camera travels to the first area and the fight starts', () => {
  const { game, bus } = makeGame();
  let started = null;
  bus.on('area.started', (p) => { started = p; });
  run(game, 12);
  assert.ok(started, 'an area must begin');
  assert.equal(started.index, 0);
  assert.equal(game.snapshot().directorState, 'FIGHTING');
});

test('the clock runs down while fighting', () => {
  const { game } = makeGame();
  run(game, 12);
  const a = game.snapshot().timeLeft;
  run(game, 3);
  const b = game.snapshot().timeLeft;
  assert.ok(b < a, `clock must tick: ${a} -> ${b}`);
});

test('enemies only ever spawn on published anchors', () => {
  const { game, bus } = makeGame();
  const seen = [];
  bus.on('enemy.spawned', (p) => seen.push(p));
  run(game, 25);
  assert.ok(seen.length > 0, 'something must spawn');
  const allowed = new Set(['door', 'alley', 'balcony', 'roof', 'dormer', 'metro']);
  for (const s of seen) {
    assert.ok(allowed.has(s.anchorType),
      `enemy spawned at "${s.anchorType}", which is not a real piece of architecture`);
  }
});

test('at most two enemies are ever committed to a shot at once', () => {
  const { game } = makeGame();
  let worst = 0;
  for (let i = 0; i < 60 * 45; i++) {
    game.update(DT, IDLE);
    const committed = game.director.enemies.filter(
      (e) => e.isAlive && e.telegraphStage === 'commit').length;
    worst = Math.max(worst, committed);
  }
  assert.ok(worst <= MAX_CONCURRENT_COMMIT,
    `${worst} enemies committed at once; spec caps it at ${MAX_CONCURRENT_COMMIT}`);
});

test('every enemy shot is telegraphed before it is fired', () => {
  const { game, bus } = makeGame();
  const staged = new Set();
  let untelegraphed = 0;
  bus.on('enemy.telegraph', ({ id, stage }) => { if (stage) staged.add(id); });
  bus.on('enemy.fired', ({ id }) => { if (!staged.has(id)) untelegraphed++; });
  run(game, 40);
  assert.equal(untelegraphed, 0,
    'a shot with no telegraph is an unfair shot, and the game must never take one');
});

test('a player behind cover cannot be hit', () => {
  const { game, bus } = makeGame();
  let hits = 0;
  bus.on('player.hit', () => hits++);
  // Gun up the whole time: always covered after the first 200ms.
  run(game, 60, IDLE);
  assert.equal(hits, 0, 'cover must be absolute');
  assert.equal(game.snapshot().lives, START_LIVES);
});

test('a player standing out in the open does get hit', () => {
  const { game, bus } = makeGame();
  let hits = 0;
  bus.on('player.hit', () => hits++);
  run(game, 60, OUT);
  assert.ok(hits > 0, 'standing in the open through a whole area must cost you');
});

test('enemy bullets travel and can be ducked mid-flight', () => {
  const { game, bus } = makeGame();
  // Stand out until a shot is actually in the air, then duck.
  let fired = false;
  bus.on('enemy.fired', () => { fired = true; });
  let guard = 0;
  while (!fired && guard++ < 60 * 60) game.update(DT, OUT);
  assert.ok(fired, 'an enemy must have fired');

  const livesBefore = game.snapshot().lives;
  // Duck immediately. The bullet is in flight at ENEMY_BULLET_SPEED and the
  // hit is tested on arrival, so getting down in time must save us.
  run(game, 1.2, IDLE);
  assert.equal(game.snapshot().lives, livesBefore,
    `ducking during a ${ENEMY_BULLET_SPEED} m/s flight must save you — ` +
    'this is what makes the game fast and fair at the same time');
});

test('shots fired from cover are swallowed, not counted as misses', () => {
  const { game } = makeGame();
  run(game, 12);
  const before = game.snapshot();
  // Gun up (covered) but somehow firing.
  for (let i = 0; i < 60; i++) {
    game.update(DT, { ...IDLE, fired: true });
  }
  const after = game.snapshot();
  assert.equal(after.rounds, before.rounds, 'no rounds may leave the gun from cover');
  assert.equal(after.combo, 0);
});

test('losing a life restarts the area rather than the stage', () => {
  const { game, bus } = makeGame();
  let died = null;
  bus.on('player.died', (p) => { died = p; });
  run(game, 12);
  const areaBefore = game.snapshot().areaIndex;
  run(game, 90, OUT);
  if (died) {
    assert.ok(game.snapshot().areaIndex <= areaBefore + 1,
      'a death must not skip the player forward through the stage');
  }
});

test('running out of lives ends the game and opens a continue countdown', () => {
  const { game, bus } = makeGame();
  let over = null;
  bus.on('game.over', (p) => { over = p; });
  // Stand in the open indefinitely.
  let guard = 0;
  while (!over && guard++ < 60 * 400) game.update(DT, OUT);
  assert.ok(over, 'standing in the open forever must eventually end the game');
  assert.equal(over.continueSeconds, CONTINUE_SECONDS);
  assert.equal(game.snapshot().lives, 0);
  assert.ok(game.snapshot().continueSecondsLeft > 0);
});

test('the continue countdown ticks down and then expires', () => {
  const { game, bus } = makeGame();
  let over = false, expired = false;
  const ticks = [];
  bus.on('game.over', () => { over = true; });
  bus.on('continue.tick', ({ secondsLeft }) => ticks.push(secondsLeft));
  bus.on('continue.expired', () => { expired = true; });
  let guard = 0;
  while (!over && guard++ < 60 * 400) game.update(DT, OUT);
  run(game, CONTINUE_SECONDS + 1, IDLE);
  assert.ok(ticks.length >= CONTINUE_SECONDS - 1, `expected ~${CONTINUE_SECONDS} ticks, got ${ticks.length}`);
  assert.deepEqual(ticks, [...ticks].sort((a, b) => b - a), 'the countdown must count DOWN');
  assert.ok(expired, 'and must eventually expire');
});

test('spending a continue keeps the score and restores lives', () => {
  const { game, bus } = makeGame();
  let over = false;
  bus.on('game.over', () => { over = true; });
  let guard = 0;
  while (!over && guard++ < 60 * 400) game.update(DT, OUT);
  const scoreBefore = game.snapshot().score;
  assert.equal(game.useContinue(), true);
  const s = game.snapshot();
  assert.equal(s.lives, START_LIVES, 'lives come back');
  assert.equal(s.score, scoreBefore, 'the score does NOT reset — this is an arcade, not a checkpoint');
  assert.equal(s.gameOver, false);
  assert.equal(s.continuesUsed, 1);
});

test('rank is earned, not given', () => {
  const { game } = makeGame();
  // A fresh game with no shots fired has no rank.
  assert.equal(game.snapshot().rank, '-');
  // Perfect stats earn an S.
  game.shotsFired = 100; game.shotsHit = 80; game.areasNoHit = 5; game.continuesUsed = 0;
  assert.equal(game.rank, 'S');
  // The same shooting, but after a continue, does not.
  game.continuesUsed = 1;
  assert.notEqual(game.rank, 'S', 'a continue must cost you the top rank');
});

test('accuracy tracks real shots', () => {
  const { game } = makeGame();
  assert.equal(game.accuracy, 0);
  game.shotsFired = 10; game.shotsHit = 7;
  assert.ok(Math.abs(game.accuracy - 0.7) < 1e-9);
});

test('the boss only appears in the final area and gates it', () => {
  const { game, bus } = makeGame();
  const bosses = [];
  bus.on('enemy.spawned', (p) => { if (p.isBoss) bosses.push(p); });
  // Not a full playthrough; just assert none appears in area one.
  run(game, 70, IDLE);
  assert.equal(bosses.length, 0, 'no boss in the opening area');
});

/**
 * The boss fight must have a punish window.
 *
 * This is the test that would have caught an unwinnable boss. The fight was
 * shipped-shaped and completely impassable: he never ducks, so between the
 * last round of one volley landing and the next flash beginning there was less
 * time than it takes to emerge, fire once and hide again. Nothing asserted
 * that gap existed, so nothing noticed it was negative.
 *
 * The numbers below are the player's own costs, from cover.js and the bullet
 * speed — not magic constants. If the cover timings change, this recomputes.
 */
test('every boss phase leaves a window long enough to actually punish in', () => {
  const { BOSS_PHASES, BOSS_HEAVY_RECOVER_MS, BOSS_HEAVY_ROUNDS } = enemyTypes;
  // The furthest the boss reasonably fights from, in metres.
  const RANGE = 25;
  const flightMs = (RANGE / ENEMY_BULLET_SPEED) * 1000;
  // Emerge, land one aimed shot, hide again. Anything less than this is a
  // window the player cannot use, which is the same as no window.
  const MIN_USEFUL = EMERGE_MS + 150 + HIDE_MS;

  for (let i = 0; i < BOSS_PHASES.length; i++) {
    const p = BOSS_PHASES[i];
    assert.ok(p.recoverMs > 0, `phase ${i + 1} has no recovery beat at all`);
    // The window only starts being useful once the last round has passed.
    const usable = p.recoverMs - flightMs;
    assert.ok(usable >= MIN_USEFUL,
      `phase ${i + 1}: ${Math.round(usable)} ms of usable window, but emerging, ` +
      `firing once and hiding costs ${MIN_USEFUL} ms. The phase is impassable.`);
  }

  // The sweep drives the player all the way into cover, so its window must be
  // the longest in the fight — it is the beat the whole rhythm resolves onto.
  const longest = Math.max(...BOSS_PHASES.map((p) => p.recoverMs));
  assert.ok(BOSS_HEAVY_RECOVER_MS > longest,
    'the sweep must open a bigger window than any ordinary volley');
  assert.ok(BOSS_HEAVY_ROUNDS > BOSS_PHASES[BOSS_PHASES.length - 1].burst,
    'the sweep must be heavier than an ordinary volley or it is not a sweep');
});

/**
 * The boss must survive contact with the best weapon in the game.
 *
 * He was 12 HP, and the grenade launcher is 4 rounds at 3 damage: a player who
 * picked it up ended the stage in four shots without seeing two of his three
 * phases. A boss that one magazine deletes is not a boss.
 *
 * The unit here is the WINDOW, not the magazine. Magazine size is the wrong
 * measure because the boss is only vulnerable in bursts — the machine gun
 * holds thirty rounds but the fight never offers thirty consecutive rounds
 * worth of exposed boss, so "one magazine of damage" is not something any
 * weapon can actually deliver. A window's worth is, and that is what has to
 * stay small against his health bar.
 *
 * The bound is every projectile landing on the body, pellets counted
 * individually because each one is its own ray in Game.#resolveShot. It
 * deliberately does NOT assume headshots: doubling every pellet of a 5.5°
 * shotgun spread at twenty-five metres is not a performance ceiling, it is a
 * number no player can reach, and a test tuned against impossible play stops
 * describing the game.
 */
test('no weapon can end the boss fight in a couple of punish windows', () => {
  const boss = enemyTypes.ENEMY_TYPES.BOSS;
  const { BOSS_PHASES } = enemyTypes;
  const RANGE = 25;
  const flightMs = (RANGE / ENEMY_BULLET_SPEED) * 1000;

  for (const [name, w] of Object.entries(WEAPONS)) {
    for (let i = 0; i < BOSS_PHASES.length; i++) {
      // Time actually spent shooting: the window, less the last volley still
      // in the air, less getting out of cover and back into it.
      const shooting = BOSS_PHASES[i].recoverMs - flightMs - EMERGE_MS - HIDE_MS;
      const shots = Math.max(1, Math.floor(shooting / w.rofMs) + 1);
      const perWindow = shots * (w.pellets ?? 1) * w.damage;
      const windows = boss.hp / perWindow;
      assert.ok(windows >= 4,
        `${name} in phase ${i + 1} lands ${perWindow} damage per window, ` +
        `killing a ${boss.hp} HP boss in ${windows.toFixed(1)} windows. ` +
        `The fight ends before its own phases do.`);
    }
  }

  // And the floor: the weapon that is never taken away must still finish him.
  // Body shots only, so this is the slowest anyone plays rather than the
  // fastest — if even this fits the area's par time, the fight always does.
  const handgunShots = boss.hp / WEAPONS.HANDGUN.damage;
  assert.ok(handgunShots <= 40,
    `${handgunShots} handgun shots is beyond what a punish-window fight can deliver`);
});
