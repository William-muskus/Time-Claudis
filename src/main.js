import * as THREE from 'three';
import { Renderer } from './render/renderer.js';
import { ViewModel } from './render/viewmodel.js';
import { Rail } from './core/spline.js';
import { railPoints, WAYPOINTS, LANDMARKS, geoToLocal } from './data/route.js';
import { buildWorld } from './world/index.js';
import { AssetRegistry } from './world/assets.js';
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
// Attract mode is what the verification harness screenshots, and it runs on a
// software rasteriser where every frame is over budget. Letting the scaler
// react there would mean every screenshot was reviewed at the resolution floor.
renderer.setAdaptiveEnabled(!DEMO);

const rail = new Rail(railPoints());

/**
 * Load the Blender-exported models before building the world.
 *
 * The world builder is synchronous by design — it is a pure function of the
 * survey — so the assets have to be in hand first. Anything that fails to load
 * simply falls back to the procedural version, so a blocked network or a
 * pipeline that was not re-run degrades instead of leaving holes.
 */
const assets = await new AssetRegistry('assets/models/').load();
const { root: world, anchors, occluders, sky } = buildWorld(rail, SEED, assets);
renderer.scene.add(world);
renderer.attachSky(sky);

const railCamera = new RailCamera(renderer.camera, rail);
railCamera.snapTo(0);

const game = new Game({
  scene: renderer.scene,
  camera: renderer.camera,
  railCamera,
  occluders,
  rail,
  anchors,
  bus,
  seed: SEED,
});

// The first-person weapon. Loaded before the game is playable so a pickup
// never stalls the frame at the moment it is being awarded.
const viewModel = new ViewModel('assets/models/');
renderer.attachViewModel(viewModel);
viewModel.load().then(() => { window.__viewModelReady = true; });
bus.on('shot.fired', ({ weapon }) => viewModel.fire(weapon));

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

/**
 * Diagnostic surface for the verification harness.
 *
 * The attract pilot points the camera wherever the fight is, which is right for
 * reviewing GAMEPLAY but useless for reviewing a specific piece of the world —
 * you cannot ask "does the Dalida bust look correct" if you only ever see it
 * when an enemy happens to stand near it. So the harness can also park the
 * camera anywhere on the rail and aim it at any surveyed landmark.
 */
window.__tour = {
  /** Park the camera at a named waypoint, optionally backed off along the rail. */
  at(waypointId, opts = {}) {
    const d = rail.distanceToWaypoint(waypointId);
    const at = Math.max(0, Math.min(rail.length, d - (opts.back ?? 0)));
    railCamera.snapTo(at, { lateral: opts.lateral ?? 0, facingOffset: opts.facingOffset ?? 0 });
    railCamera.update(1 / 60, 1);
    return at;
  },
  /** Aim at a landmark or waypoint by id, overriding the rail's look-ahead. */
  look(id, height = 1.4) {
    const all = [...WAYPOINTS, ...LANDMARKS];
    const t = all.find((w) => w.id === id);
    if (!t) throw new Error(`no such place: ${id}`);
    const p = geoToLocal(t.lat, t.lon, t.elev);
    renderer.camera.lookAt(p.x, p.y + height, p.z);
    return p;
  },
  /**
   * Force a weapon into the player's hands, for reviewing the viewmodel.
   *
   * Forces full exposure too. The attract pilot ducks constantly, and the gun
   * correctly drops out of frame while it is in cover — so a tour shot taken
   * at an arbitrary moment was capturing a hidden weapon and looking like a
   * rendering failure.
   */
  weapon(key) {
    game.weapons.grant(key, game.nowMs);
    viewModel.setWeapon(key);
    const snap = { ...game.snapshot(), coverState: 'EXPOSED', exposure: 1 };
    for (let i = 0; i < 30; i++) viewModel.update(1 / 60, snap, { x: 0.5, y: 0.5 }, false);
  },
  /**
   * Stage a fight in front of the parked camera, immediately.
   *
   * Waiting for the attract pilot to reach a readable combat moment means
   * replaying the level under a software rasteriser that manages one or two
   * frames a second — minutes per screenshot, and the container often restarts
   * first. Staging it directly is instant and, more usefully, deterministic:
   * the same frame every time, which is what makes a visual regression
   * reviewable at all.
   *
   * This drives the REAL director and the REAL Enemy class against the REAL
   * anchors published by the architecture. It is not a mock — it is the same
   * spawn path the game uses, called on demand.
   */
  spawnWave(types = ['GRUNT', 'SOLDIER', 'RED'], stage = null) {
    const d = game.director;
    // Take forward from the CAMERA's current orientation, not the rail's
    // tangent: the tour aims the camera off-axis and the enemies must be
    // placed in front of where it is actually looking.
    const fwd = renderer.camera.getWorldDirection(new THREE.Vector3()).clone();
    const spawned = [];
    for (const type of types) {
      const e = d.spawnForReview
        ? d.spawnForReview(type, renderer.camera.position, fwd)
        : null;
      if (e) spawned.push(e);
    }
    // Drive them out of the spawn animation and into the requested stage.
    for (let i = 0; i < 40; i++) {
      for (const e of spawned) {
        e.update(1 / 60, renderer.camera.position, {
          grantCommit: () => true, onFire: () => {}, onStage: () => {},
        });
      }
    }
    if (stage) {
      const frac = { windup: 0.3, flash: 0.7, commit: 0.93 }[stage] ?? 0.7;
      for (const e of spawned) {
        e.telegraphMs = e.type.telegraphMs * frac;
        e.commitGranted = true;
        e.update(1 / 600, renderer.camera.position, {
          grantCommit: () => true, onFire: () => {}, onStage: () => {},
        });
      }
    }
    return spawned.map((e) => ({ id: e.id, type: e.typeKey, state: e.state, stage: e.telegraphStage }));
  },

  /** Put a tracer and a live round in the air, for the bullet-in-flight shot. */
  incoming() {
    const live = game.director.enemies.filter((e) => e.isAlive);
    for (const e of live.slice(0, 2)) {
      const from = e.muzzlePosition();
      game.effects.spawnTracer(from, renderer.camera.position.clone(), undefined, 0.09);
      game.bullets.fire(from, renderer.camera.position.clone(), 34, e.id);
    }
    // Step the bullets a little so they are visibly in mid-flight rather than
    // sitting on the muzzle.
    for (let i = 0; i < 14; i++) {
      game.bullets.update(1 / 60, renderer.camera.position, () => false, () => {});
    }
    return game.bullets.bullets.filter((b) => b.active).length;
  },

  /** Force the player behind cover, to show the framing change. */
  duck() {
    game.cover.forceCover();
    for (let i = 0; i < 30; i++) railCamera.update(1 / 60, 0);
    viewModel.update(1 / 60, { ...game.snapshot(), coverState: 'COVERED', exposure: 0 },
      { x: 0.5, y: 0.5 }, false);
  },

  /** Read back where the weapon actually is on screen, for diagnostics. */
  weaponScreenPos() {
    if (!viewModel.current) return null;
    viewModel.camera.updateMatrixWorld(true);
    viewModel.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(viewModel.current);
    if (box.isEmpty()) return 'empty';
    const ndc = box.getCenter(new THREE.Vector3()).project(viewModel.camera);
    return { xPct: +((ndc.x + 1) / 2 * 100).toFixed(1), yPct: +((1 - ndc.y) / 2 * 100).toFixed(1) };
  },
  /** Trigger a muzzle flash and recoil without running the trigger logic. */
  fire() {
    viewModel.fire(game.weapons.current);
    const snap = { ...game.snapshot(), coverState: 'EXPOSED', exposure: 1 };
    viewModel.update(1 / 240, snap, { x: 0.5, y: 0.5 }, false);
  },
  /** Put the gun up, as if the player had raised their hand to reload. */
  gunUp() {
    game.cover.forceCover();
    const snap = { ...game.snapshot(), coverState: 'COVERED', exposure: 0 };
    for (let i = 0; i < 40; i++) viewModel.update(1 / 60, snap, recognizer.last.aim, false);
  },
  /** Free look, in degrees. */
  aim(yawDeg, pitchDeg = 0) {
    const y = (yawDeg * Math.PI) / 180, pch = (pitchDeg * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(y) * Math.cos(pch), Math.sin(pch), -Math.cos(y) * Math.cos(pch));
    renderer.camera.lookAt(renderer.camera.position.clone().add(dir));
  },
  /**
   * Stop the simulation so a parked camera is not immediately overridden.
   *
   * Freezing also forces the player OUT of cover. The attract pilot ducks
   * constantly, and a frozen game therefore sits in whatever state it happened
   * to be in — usually COVERED, which correctly swings the weapon up into its
   * reload pose. That is right behaviour and wrong for a tour frame: the gun
   * ends up held vertically across the middle of the picture, where it reads
   * as a large dark slab leaning through the scene rather than as a weapon.
   * Every shot that does not explicitly ask for gun-up gets the ready pose.
   */
  freeze(on = true) {
    window.__frozen = on;
    if (!on) return;
    game.cover.exposure = 1;
    game.cover.state = 'EXPOSED';
    const snap = { ...game.snapshot(), coverState: 'EXPOSED', exposure: 1 };
    for (let i = 0; i < 40; i++) viewModel.update(1 / 60, snap, { x: 0.5, y: 0.5 }, false);
  },
  /**
   * Clear transient HUD so a tour frame shows the world, not a banner.
   *
   * The tour used to run 200 settling frames purely to let the ACTION banner
   * time out. On a software rasteriser that is minutes of pure waste across a
   * full tour; dismissing it directly costs nothing.
   */
  clearHud() {
    hud.showBanner('', 'action', 0);
    hud.hideHints();
    const b = document.getElementById('banner');
    if (b) b.className = 'banner';
    const o = document.getElementById('overlay');
    if (o) o.className = 'overlay';
  },
  /**
   * Remove every enemy from the world.
   *
   * The tour used to stage each fight on top of the last one. Nothing cleared
   * between shots and every enemy had exposureMs measured in seconds of
   * simulated time that a frozen game never advances, so they simply
   * accumulated: by the final combat frame there were sixteen alive, thirteen
   * of them staged for earlier shots at camera positions up to three hundred
   * metres back down the hill. That makes a fight unreviewable and it makes
   * the manifest lie about what is in the picture.
   */
  clearEnemies() {
    const d = game.director;
    for (const e of d.enemies) e.dispose(renderer.scene);
    d.enemies.length = 0;
    d.committed?.clear();
    d.occupied?.clear();
    return 0;
  },

  /**
   * Where every live enemy actually landed, in normalised screen coordinates,
   * and whether anything in the world is in front of it.
   *
   * "The manifest said five enemies were alive and telegraphing, and the frame
   * had none in it" is not a state a verification harness should be able to
   * reach. Reporting the stage an enemy is in proves the SIMULATION ran;
   * proving the RENDER contains it needs the projection and the occlusion
   * test, because on-screen-but-behind-a-wall and off-screen-entirely look
   * identical in a screenshot and have completely different causes.
   */
  enemyScreenPos() {
    const cam = renderer.camera;
    cam.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const walls = [];
    renderer.scene.traverse((o) => {
      if (o.isMesh && o.visible && !o.userData.isEnemy) walls.push(o);
    });
    return game.director.enemies.filter((e) => e.isAlive).map((e) => {
      const p = e.group.position.clone();
      p.y += 1.1;
      const to = p.clone().sub(cam.position);
      const dist = to.length();
      const ndc = p.clone().project(cam);
      const onScreen = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1;
      // Three points up the body, and one clear ray is enough.
      //
      // A single ray at chest height cannot tell a wall from a lamp post, and
      // this reported two enemies standing in plain sight on the far pavement
      // as BLOCKED because one trunk clipped one line. An enemy behind a
      // railing is visible and an enemy behind a terrace is not; the
      // difference is whether ANY part of them can be seen.
      let blocked = true;
      for (const dy of [-0.5, 0, 0.6]) {
        const at = new THREE.Vector3(p.x, p.y + dy, p.z);
        const d = at.clone().sub(cam.position);
        ray.set(cam.position, d.clone().normalize());
        ray.far = d.length() - 0.6;
        if (!ray.intersectObjects(walls, false).length) { blocked = false; break; }
      }
      return {
        type: e.typeKey,
        stage: e.telegraphStage ?? e.state,
        xPct: Math.round(((ndc.x + 1) / 2) * 100),
        yPct: Math.round(((-ndc.y + 1) / 2) * 100),
        dist: +dist.toFixed(1),
        onScreen,
        blocked,
        visible: onScreen && !blocked,
      };
    });
  },

  places: () => [...WAYPOINTS.map((w) => w.id), ...LANDMARKS.map((l) => l.id)],
};
window.__frozen = false;

window.__game = game;
window.__vm = viewModel;
window.__THREE = THREE;
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

/** Latched so a callout fires once per area, not once per frame. */
let crisisCalled = false;
let lastAreaIndex = -1;

function updateAudioState(snap) {
  if (snap.areaIndex !== lastAreaIndex) {
    lastAreaIndex = snap.areaIndex;
    crisisCalled = false;
    announcer.startMusic();
    // Escalate the bed as the stage progresses, so area five feels different
    // from area one without anyone writing five pieces of music.
    announcer.setMusicIntensity(Math.min(3, snap.areaIndex));
  }
  const crisis = snap.directorState === 'FIGHTING' && snap.timeLeft <= 10;
  announcer.setCrisis(crisis);
  if (crisis && !crisisCalled) {
    crisisCalled = true;
    announcer.callout('crisis');
  }
}

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

  // Raising the gun spends a continue. Reusing the RELOAD gesture rather than
  // adding a fourth is deliberate: the brief allows three gestures, and a
  // player who has just died is already holding the gun up because that is
  // what they were told to do when things go wrong.
  if (game.gameOver && game.continueSecondsLeft > 0 && intent.gunUp) {
    game.useContinue();
    announcer.callout('ready');
  }

  // --- 2..7. simulation ----------------------------------------------------
  // A frozen frame still renders and still updates the HUD, so a parked camera
  // can be screenshotted without the rig snapping back to the rail next frame.
  if (!window.__frozen) game.update(dt, intent);

  // --- 8. render -----------------------------------------------------------
  const snap = game.snapshot();
  // While frozen the tour owns the weapon pose; letting the loop keep driving
  // it from the pilot's stale intent would undo whatever the shot set up.
  if (!window.__frozen) viewModel.update(dt, snap, intent.aim, railCamera.isTravelling);
  renderer.setDamageVignette(
    snap.gameOver ? 0.85 : (snap.lives === 1 ? 0.26 : 0) + (snap.iframe ? 0.4 : 0));
  renderer.render(elapsed);

  // --- 9. hud --------------------------------------------------------------
  hud.update(snap, intent.aim, dt);
  if (elapsed > 14) hud.hideHints();

  // --- audio state ---------------------------------------------------------
  // The clock is a continuous value rather than an event, so the CRISIS
  // callout and the music's urgency are driven from the snapshot here rather
  // than from the bus. Spec: docs/GAMEPLAY.md §7.
  updateAudioState(snap);

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
