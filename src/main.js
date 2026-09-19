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

/**
 * No WebGL2, no game — but say so rather than showing a blank page.
 *
 * new THREE.WebGLRenderer() throws when it cannot get a context, and a throw
 * at module scope in an ES module leaves the page exactly as it was: the title
 * card sitting there with a button that does nothing, no error anywhere the
 * player can see. That is the worst failure in the file, because it is the one
 * the player has no way to even describe. Software rasterisers and remote
 * desktop sessions both land here.
 */
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  document.getElementById('title').innerHTML =
    '<h1>TIME CLAUDIS</h1>' +
    '<div id="fault" class="shown"><h3 id="fault-title">3D not available</h3>' +
    '<p id="fault-body">' +
    'This browser could not create a WebGL2 context, which the game needs to ' +
    'draw anything at all. That usually means hardware acceleration is turned ' +
    'off, or the page is running in a remote session without a GPU. ' +
    `(${(e?.message ?? e ?? 'unknown error').toString().slice(0, 160)})</p></div>`;
  throw e;
}
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
  /**
   * Aim the way the GAME aims: at a point along the rail ahead.
   *
   * A hard yaw frames what it framed on the day it was written. After the
   * re-survey corrected the street bearings, the combat shots were still
   * aiming at the old ones and every enemy in the six-metre lane spawned off
   * the left edge of the frame — the director places a wave relative to where
   * the camera is looking, so a stale yaw does not merely miscompose the shot,
   * it puts the fight somewhere else.
   *
   * RailCamera aims RIG.lookAhead metres up the rail. Doing the same here
   * frames what the player would actually see standing at that node, and it
   * follows any future correction to the survey for free.
   */
  lookAhead(metres = 14, pitchDeg = 0) {
    const d = railCamera.distance ?? rail.distanceToWaypoint('lamarck_station');
    const ahead = rail.positionAt(Math.min(rail.length, d + metres));
    const p = new THREE.Vector3(ahead.x, ahead.y + 1.4, ahead.z);
    if (pitchDeg) p.y += Math.tan((pitchDeg * Math.PI) / 180) * metres;
    renderer.camera.lookAt(p);
    return { x: p.x, y: p.y, z: p.z };
  },
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
      if (o.isMesh && o.visible && !o.userData.isEnemy && !o.userData.isEffect
          && !o.parent?.userData?.isEffect) walls.push(o);
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

const startButton = document.getElementById('start');
const fault = document.getElementById('fault');
const faultTitle = document.getElementById('fault-title');
const faultBody = document.getElementById('fault-body');

/**
 * Say what went wrong, in the terms the player can act on.
 *
 * The three failures are genuinely different problems with genuinely
 * different answers, and lumping them into one "camera unavailable" would
 * send a player with no webcam hunting through browser permissions they
 * cannot change the outcome of.
 */
function describeFault(e) {
  const name = e?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return ['Camera permission denied',
      'The game is played by pointing your hand at the camera, so it cannot ' +
      'run without one. Allow camera access for this page — in most browsers ' +
      'that is the camera icon at the right-hand end of the address bar — ' +
      'and try again.'];
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return ['No camera found',
      'No webcam was offered by this device. Plug one in and try again, or ' +
      'watch the attract mode, which plays itself and needs no camera.'];
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return ['Camera is busy',
      'Something else on this machine is already using the webcam — a video ' +
      'call, or another tab. Close it and try again.'];
  }
  // Anything else is almost always the hand-tracking model failing to
  // download: it is fetched from a CDN on first run and is about 8 MB.
  return ['Hand tracking could not start',
    'The hand-tracking model is downloaded the first time you play, and that ' +
    'download did not complete. Check your connection and try again. ' +
    `(${e?.message ?? e ?? 'unknown error'})`];
}

function showFault(e) {
  const [title, body] = describeFault(e);
  faultTitle.textContent = title;
  faultBody.textContent = body;
  fault.classList.add('shown');
  startButton.disabled = false;
  startButton.textContent = 'Insert Coin';
}

async function start({ webcam }) {
  if (started) return;

  // AUDIO FIRST, AND INSIDE THE GESTURE.
  //
  // unlock() used to be the last thing in the webcam branch, which put it
  // after an await that takes several seconds — downloading an 8 MB model and
  // then waiting on a permission prompt. By then the user-gesture context is
  // long gone, and a browser will not let an AudioContext created outside a
  // gesture leave the suspended state. The game was very probably silent for
  // everybody, in the one branch where audio was even attempted: the camera
  // failure path never called unlock() at all, so a player who denied the
  // camera got a game that neither listened nor spoke.
  announcer.unlock();

  if (webcam) {
    fault.classList.remove('shown');
    startButton.disabled = true;
    startButton.textContent = 'Starting camera\u2026';
    try {
      await tracker.init(camVideo);
    } catch (e) {
      // NOT started. The title card stays up and says what happened, rather
      // than dropping the player into an attract demo they did not ask for
      // with a console warning they will never see.
      console.warn('[input] webcam unavailable:', e?.name, e?.message);
      showFault(e);
      return;
    }
    useWebcam = true;
    camWrap.classList.remove('hidden');
    camOverlay.width = 240;
    camOverlay.height = 180;
  }

  started = true;
  titleCard.classList.add('gone');
  window.__ready = true;
}

startButton.addEventListener('click', () => start({ webcam: true }));
document.getElementById('fault-retry').addEventListener('click', () => start({ webcam: true }));
document.getElementById('fault-demo').addEventListener('click', () => start({ webcam: false }));

// Attract mode boots straight in with no gesture required, so the harness can
// screenshot without a camera or a click.
if (DEMO) start({ webcam: false });

// ---------------------------------------------------------------------------

let last = performance.now();
let elapsed = 0;

/** Latched so a callout fires once per area, not once per frame. */
let crisisCalled = false;
/** Seconds the tracker has had no hand. Drives the HAND LOST banner. */
let handLostFor = 0;
const handLost = document.getElementById('handlost');
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

    // TELL THEM WHY THEY ARE STUCK IN COVER.
    //
    // Losing the hand for more than the recogniser's grace window reports
    // present:false, and game.js treats that as "do not want out", so the
    // player is pushed into cover and held there. That failsafe is right —
    // being dropped exposed by a tracking glitch would be the least fair
    // death in the game — but it is completely opaque. From the player's
    // side the gun simply stops working while the area clock runs down, and
    // the only sign is a 240-pixel chip in the corner that nobody is looking
    // at during a firefight.
    //
    // The delay matters as much as the message. The tracker drops a frame
    // here and there constantly; a banner that flickered on every one would
    // be worse than no banner. Nine tenths of a second is long past any
    // ordinary dropout and well short of the time it takes to lose an area.
    handLostFor = ok ? 0 : handLostFor + dt;
    handLost.classList.toggle('shown', handLostFor > 0.9);
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
