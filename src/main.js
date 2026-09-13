import * as THREE from 'three';
import { Renderer } from './render/renderer.js';
import { Rail } from './core/spline.js';
import { railPoints } from './data/route.js';
import { buildWorld } from './world/index.js';
import { RailCamera } from './rail/camera.js';
import { Game } from './gameplay/game.js';
import { Hud } from './ui/hud.js';
import { GestureRecognizer } from './input/gestures.js';
import { HandTracker } from './input/handtracker.js';
import { DemoPilot } from './input/demopilot.js';
import { bus } from './core/events.js';
import { Announcer } from './audio/announcer.js';

/**
 * Boot and the main loop.
 *
 * Two input paths, one recogniser. A real webcam feeds MediaPipe landmarks
 * into the GestureRecognizer; attract mode feeds synthetic landmarks into the
 * same GestureRecognizer. Nothing downstream knows or cares which, which is
 * why the attract mode is a genuine test of the game rather than a mock of it.
 */

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const SEED = Number(params.get('seed') ?? 0xA11CE);
/** Fixed timestep for deterministic screenshots. */
const FIXED_DT = params.has('fixed') ? Number(params.get('fixed')) || 1 / 60 : null;

const canvas = document.getElementById('gl');
const renderer = new Renderer(canvas);

const rail = new Rail(railPoints());
const { root: world, anchors, sky } = buildWorld(rail, SEED);
renderer.scene.add(world);
renderer.attachSky(sky);

const railCamera = new RailCamera(renderer.camera, rail);
railCamera.snapTo(0);

const game = new Game({
  scene: renderer.scene,
  camera: renderer.camera,
  railCamera,
  rail,
  anchors,
  bus,
  seed: SEED,
});

const hud = new Hud(document.getElementById('hud-root'), bus);
const announcer = new Announcer(bus);
const recognizer = new GestureRecognizer();

const tracker = new HandTracker();
const pilot = new DemoPilot(renderer.camera, SEED);

const camWrap = document.getElementById('cam-wrap');
const camVideo = document.getElementById('cam');
const camOverlay = document.getElementById('cam-overlay');
const camStatus = document.getElementById('cam-status');
const titleCard = document.getElementById('title');

let started = false;
let useWebcam = false;

// Screenshot/diagnostic surface for the verification harness.
window.__game = game;
window.__rail = rail;
window.__renderer = renderer;
window.__anchors = anchors;
window.__frames = 0;
window.__ready = false;

async function start({ webcam }) {
  if (started) return;
  started = true;
  titleCard.classList.add('gone');

  if (webcam) {
    try {
      await tracker.init(camVideo);
      useWebcam = true;
      camWrap.classList.remove('hidden');
      camOverlay.width = 240;
      camOverlay.height = 180;
      announcer.unlock();
    } catch (e) {
      console.warn('[input] webcam unavailable, falling back to attract mode:', e?.message);
      useWebcam = false;
    }
  }
  window.__ready = true;
}

document.getElementById('start').addEventListener('click', () => start({ webcam: true }));

// Attract mode boots straight in with no gesture required, so the harness can
// screenshot without a camera or a click.
if (DEMO) start({ webcam: false });

// ---------------------------------------------------------------------------

let last = performance.now();
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);

  let dt = FIXED_DT ?? Math.min((now - last) / 1000, 1 / 15);
  last = now;
  if (!started) { renderer.render(elapsed); return; }
  elapsed += dt;

  // --- 1. input ------------------------------------------------------------
  let landmarks = null;
  if (useWebcam) {
    landmarks = tracker.poll();
    tracker.drawOverlay(camOverlay);
    const ok = !!landmarks;
    camStatus.textContent = ok ? (recognizer.last.gunUp ? 'GUN UP' : 'TRACKING') : 'no hand';
    camStatus.classList.toggle('lost', !ok);
  } else {
    landmarks = pilot.update(dt, game);
  }

  const intent = recognizer.update(landmarks, dt);

  // --- 2..7. simulation ----------------------------------------------------
  game.update(dt, intent);

  // --- 8. render -----------------------------------------------------------
  const snap = game.snapshot();
  renderer.setDamageVignette(
    snap.gameOver ? 0.85 : (snap.lives === 1 ? 0.26 : 0) + (snap.iframe ? 0.4 : 0));
  renderer.render(elapsed);

  // --- 9. hud --------------------------------------------------------------
  hud.update(snap, intent.aim, dt);
  if (elapsed > 14) hud.hideHints();

  window.__frames++;
}

requestAnimationFrame(frame);

// Keyboard fallbacks. Not a supported control scheme — a developer convenience
// so the game can be driven when no camera is attached.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') recognizer.triggerReady = true;
  if (e.code === 'KeyD') console.table(game.snapshot());
});

void THREE;
