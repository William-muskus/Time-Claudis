/**
 * What SHAPE is the boss fight?
 *
 * The tests can prove the boss is killable and that the arithmetic of his
 * windows works. Neither can tell you the thing that actually matters: how the
 * fight FEELS over its length. This plays the real stage to the boss with the
 * oracle from tests/playthrough.test.js and reports where the time goes —
 * ducked, under fire, watching a telegraph, in the punish window, or locked
 * out by the between-phase guard.
 *
 * It is how the unwinnable version was caught. The fight looked fine in the
 * source and read as merely hard in play; the numbers said the oracle spent
 * 93 % of it in cover and landed 44 shots in 34 seconds, which is not a
 * difficulty, it is a wall.
 *
 *   node tools/verify/boss-diag.mjs
 */
import * as THREE from 'three';
import { Game } from '../../src/gameplay/game.js';
import { RailCamera } from '../../src/rail/camera.js';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { EventBus } from '../../src/core/events.js';

const DT = 1 / 60;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
const rail = new Rail(railPoints());
const { anchors } = buildWorld(rail, 0x5EED);
const railCamera = new RailCamera(camera, rail);
railCamera.snapTo(0);
const bus = new EventBus();
const game = new Game({ scene, camera, railCamera, rail, anchors, bus, seed: 0x5EED });

function oracle() {
  const s = game.snapshot();
  const enemies = game.director.targets();
  const threat = enemies.some((e) => e.telegraphStage === 'commit' || e.telegraphStage === 'flash');
  const inbound = game.bullets.bullets.some((b) => b.active);
  const dry = s.rounds === 0;
  if (dry || threat || inbound) return { aim: { x: .5, y: .5 }, fired: false, gunUp: true, present: true };
  const target = enemies.find((e) => e.isGating) ?? enemies[0];
  if (!target) return { aim: { x: .5, y: .5 }, fired: false, gunUp: false, present: true };
  const p = target.group.position.clone(); p.y += 1.0;
  const ndc = p.project(camera);
  const aim = { x: THREE.MathUtils.clamp((ndc.x + 1) / 2, 0, 1), y: THREE.MathUtils.clamp((-ndc.y + 1) / 2, 0, 1) };
  const onScreen = Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1;
  return { aim, fired: onScreen && s.coverState === 'EXPOSED', gunUp: false, present: true };
}

let boss = null;
bus.on('enemy.spawned', (p) => { if (p.isBoss) console.log('boss spawned at frame', frames); });

let recoverFrames = 0;
let frames = 0, bossFrames = 0, ducked = 0, inboundFrames = 0, threatFrames = 0, guardFrames = 0, shotsAtBoss = 0;
let lastHp = null;
while (frames++ < 60 * 600) {
  const cmd = oracle();
  game.update(DT, cmd);
  if (game.gameOver) game.useContinue();
  boss = game.director.targets().find((e) => e.type?.boss) ?? boss;
  const live = game.director.targets().find((e) => e.type?.boss);
  if (live) {
    bossFrames++;
    if (cmd.gunUp) ducked++;
    if (game.bullets.bullets.some((b) => b.active)) inboundFrames++;
    if (game.director.targets().some((e) => e.telegraphStage === 'commit' || e.telegraphStage === 'flash')) threatFrames++;
    if (live.isGuarding) guardFrames++;
    if (live.isRecovering) recoverFrames++;
    if (cmd.fired) shotsAtBoss++;
    if (live.hp !== lastHp) { console.log(`t=${(frames/60).toFixed(1)}s hp ${live.hp} phase ${live.phase}`); lastHp = live.hp; }
    if (live.hp <= 0) break;
  }
}
console.log({ frames, bossFrames, duckedPct: (100*ducked/bossFrames).toFixed(1), inboundPct: (100*inboundFrames/bossFrames).toFixed(1), threatPct: (100*threatFrames/bossFrames).toFixed(1), guardPct: (100*guardFrames/bossFrames).toFixed(1), recoverPct: (100*recoverFrames/bossFrames).toFixed(1), shotsAtBoss });
