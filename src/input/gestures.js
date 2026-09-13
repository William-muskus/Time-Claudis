import fingerposePkg from 'fingerpose';

/**
 * fingerpose ships a UMD bundle, so `import * as fp` yields a namespace whose
 * only member is `default` under Node's CJS interop, while Vite's interop
 * hands back the exports object directly. Normalise once, here, so neither the
 * test runner nor the bundler has to care.
 */
const fp = fingerposePkg?.GestureDescription ? fingerposePkg : (fingerposePkg?.default ?? fingerposePkg);
import {
  LM, indexCurl, middleCurl, ringCurl, pinkyCurl,
  barrelElevationDeg, triggerAngleDeg, aimPoint, handSpan,
} from './handmath.js';

/**
 * THE THREE GESTURES
 * ==================
 * The brief allows exactly three and no more. Adding a fourth would be a bug.
 *
 *   POINT   index extended at the screen. The index finger is the barrel and
 *           the hand drives the crosshair.
 *   SHOOT   middle finger held perpendicular to the index — a reversed L, a
 *           finger on a gâchette. Curling it into the palm fires. One curl,
 *           one shot.
 *   RELOAD  the whole finger gun raised to vertical, perpendicular to the sky.
 *           Held. This is also the cover mechanic: gun up = duck and reload,
 *           gun down = pop out ready to shoot.
 *
 * ARCHITECTURE NOTE
 * fingerpose classifies POSE — "is this hand shaped like a finger gun?" — and
 * it is good at that and gives us a confidence score we can gate on. But it
 * cannot do two things this game needs:
 *   1. an EDGE — the instant the trigger breaks. fingerpose is a per-frame
 *      classifier with no memory, and a per-frame "is curled" test either
 *      machine-guns at 30 shots a second or misses fast pulls entirely.
 *   2. a CONTINUOUS aim signal that is stable while the trigger moves.
 * So fingerpose gates ("is this a finger gun at all, and is it up or down?")
 * and the analogue layer in handmath.js actuates. Neither alone is enough.
 */

// ---------------------------------------------------------------------------
// fingerpose gesture descriptions
// ---------------------------------------------------------------------------

/** POINT — finger gun aimed at the screen, barrel roughly horizontal. */
export function describePoint() {
  const g = new fp.GestureDescription('point');
  // Index is the barrel: straight, and pointing into the screen or across it.
  g.addCurl(fp.Finger.Index, fp.FingerCurl.NoCurl, 1.0);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.HorizontalLeft, 0.75);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.HorizontalRight, 0.75);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.DiagonalUpLeft, 0.55);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.DiagonalUpRight, 0.55);
  // Thumb cocked like a hammer. Allowed either way — people differ and
  // punishing a raised thumb would fail half the players on frame one.
  g.addCurl(fp.Finger.Thumb, fp.FingerCurl.NoCurl, 0.8);
  g.addCurl(fp.Finger.Thumb, fp.FingerCurl.HalfCurl, 0.6);
  // Ring and pinky folded into the palm — this is what makes it a GUN and not
  // an open hand, and it is the main thing separating POINT from a stray wave.
  g.addCurl(fp.Finger.Ring,  fp.FingerCurl.FullCurl, 1.0);
  g.addCurl(fp.Finger.Pinky, fp.FingerCurl.FullCurl, 1.0);
  g.addCurl(fp.Finger.Ring,  fp.FingerCurl.HalfCurl, 0.5);
  g.addCurl(fp.Finger.Pinky, fp.FingerCurl.HalfCurl, 0.5);
  // Middle deliberately unconstrained: it is the trigger and is in motion.
  return g;
}

/** SHOOT — the trigger pose. Middle finger perpendicular to the index. */
export function describeShoot() {
  const g = new fp.GestureDescription('shoot');
  g.addCurl(fp.Finger.Index, fp.FingerCurl.NoCurl, 1.0);
  // The middle finger is mid-travel: half-curled is the signature of a
  // trigger being squeezed, full-curl the bottom of the pull.
  g.addCurl(fp.Finger.Middle, fp.FingerCurl.HalfCurl, 1.0);
  g.addCurl(fp.Finger.Middle, fp.FingerCurl.FullCurl, 0.9);
  g.addCurl(fp.Finger.Ring,  fp.FingerCurl.FullCurl, 0.9);
  g.addCurl(fp.Finger.Pinky, fp.FingerCurl.FullCurl, 0.9);
  return g;
}

/** RELOAD — finger gun raised vertical, perpendicular to the sky. */
export function describeReload() {
  const g = new fp.GestureDescription('reload');
  g.addCurl(fp.Finger.Index, fp.FingerCurl.NoCurl, 1.0);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.VerticalUp, 1.0);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.DiagonalUpLeft, 0.6);
  g.addDirection(fp.Finger.Index, fp.FingerDirection.DiagonalUpRight, 0.6);
  g.addCurl(fp.Finger.Ring,  fp.FingerCurl.FullCurl, 0.9);
  g.addCurl(fp.Finger.Pinky, fp.FingerCurl.FullCurl, 0.9);
  return g;
}

export const GESTURES = [describePoint(), describeShoot(), describeReload()];

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export const TUNING = {
  /** fingerpose confidence (0-10) below which we ignore a classification. */
  minPoseScore: 7.5,

  /** Schmitt trigger on middle-finger curl. Hysteresis is what stops chatter. */
  triggerPullCurl: 0.62,    // curl above this with the trigger armed → FIRE
  triggerResetCurl: 0.38,   // curl must fall below this to re-arm

  /** The "reversed L". Below this angle the middle finger is not a trigger. */
  triggerArmAngleDeg: 42,

  /** Barrel elevation above which the gun counts as raised to the sky. */
  reloadElevationDeg: 62,
  /** Elevation below which the gun counts as down and aimed. */
  aimElevationDeg: 45,

  /** Aim smoothing. Critically-damped spring; see docs/GAMEPLAY.md §7. */
  aimStiffness: 165,
  aimDamping: 2 * Math.sqrt(165) * 0.86,   // slightly under-damped → overshoot

  /** Frames a hand may be missing before we treat it as gone. */
  lostHandGraceFrames: 6,
};

// ---------------------------------------------------------------------------
// Recogniser
// ---------------------------------------------------------------------------

/**
 * Consumes MediaPipe hand landmarks, emits game intent.
 *
 * Output shape (read by nothing else in the codebase, so it is the contract):
 *   {
 *     present:   boolean  a usable finger gun is on camera
 *     pose:      'point'|'shoot'|'reload'|null
 *     confidence number   0-10 from fingerpose
 *     aim:       {x,y}    normalised 0..1, already smoothed, already mirrored
 *     fired:     boolean  TRUE FOR EXACTLY ONE FRAME per trigger pull
 *     gunUp:     boolean  barrel raised to the sky → duck + reload
 *     elevation: number   barrel elevation in degrees
 *     triggerArmed boolean the reversed-L is formed
 *     curl:      number   0..1 raw middle-finger curl, for the debug overlay
 *   }
 */
export class GestureRecognizer {
  constructor(tuning = {}) {
    this.t = { ...TUNING, ...tuning };
    this.estimator = new fp.GestureEstimator(GESTURES);

    /**
     * Schmitt-trigger latch. True means the trigger has returned to the top
     * of its travel with the reversed L formed, so the next curl is a shot.
     * Distinct from the per-frame `triggerArmed` pose flag we report outward.
     */
    this.triggerReady = true;
    this.missingFrames = 999;

    // Spring state for the crosshair.
    this.aim = { x: 0.5, y: 0.5 };
    this.aimVel = { x: 0, y: 0 };
    this.targetAim = { x: 0.5, y: 0.5 };

    this.last = this.#empty();
  }

  #empty() {
    return {
      present: false, pose: null, confidence: 0,
      aim: { ...this.aim }, fired: false, gunUp: false,
      elevation: 0, triggerArmed: false, curl: 0,
    };
  }

  /**
   * @param {{x:number,y:number,z:number}[]|null} landmarks 21 MediaPipe points
   * @param {number} dt seconds
   */
  update(landmarks, dt) {
    if (!landmarks || landmarks.length < 21) {
      this.missingFrames++;
      // Keep the crosshair where it was and coast the spring to a stop rather
      // than snapping to centre — a hand that flickers out for two frames
      // should not throw your aim across the screen.
      this.#integrateAim(dt);
      const out = this.#empty();
      out.aim = { ...this.aim };
      out.present = this.missingFrames <= this.t.lostHandGraceFrames;
      this.last = out;
      return out;
    }
    this.missingFrames = 0;

    // fingerpose wants [x,y,z] triples.
    const arr = landmarks.map((p) => [p.x, p.y, p.z ?? 0]);
    const est = this.estimator.estimate(arr, this.t.minPoseScore);
    let pose = null, confidence = 0;
    if (est.gestures && est.gestures.length) {
      const best = est.gestures.reduce((a, b) => (b.score > a.score ? b : a));
      pose = best.name;
      confidence = best.score;
    }

    const elevation = barrelElevationDeg(landmarks);
    const curl = middleCurl(landmarks);
    const trigAngle = triggerAngleDeg(landmarks);

    // The gun is up if EITHER the geometry says vertical or fingerpose says
    // reload with conviction. Two independent signals, because elevation alone
    // gets noisy when the hand is edge-on to the camera and the classifier
    // alone is too coarse to feel intentional.
    const gunUp = elevation >= this.t.reloadElevationDeg ||
                  (pose === 'reload' && elevation >= this.t.aimElevationDeg);

    // The reversed L: middle finger held perpendicular to the index barrel.
    // You cannot fire while the gun is up — that is the cover contract.
    const triggerArmed = trigAngle >= this.t.triggerArmAngleDeg && !gunUp;

    // Schmitt trigger: one curl, one shot.
    //
    // Note what the latch requires to RE-ARM: not just an uncurled finger but
    // the reversed L actually re-formed. That is what encodes the brief's
    // gesture rather than merely detecting a waggling finger — you must set
    // the trigger before you can break it. It also explains why we cannot test
    // the L at the moment of firing: by then the finger is curled and the
    // angle has necessarily collapsed. The pose is a precondition, not a
    // coincident state.
    let fired = false;
    if (!gunUp) {
      if (this.triggerReady && curl >= this.t.triggerPullCurl) {
        fired = true;
        this.triggerReady = false;
      } else if (!this.triggerReady && curl <= this.t.triggerResetCurl && triggerArmed) {
        this.triggerReady = true;
      }
    } else {
      // Raising the gun re-arms, so the first shot after cover always lands.
      this.triggerReady = true;
    }

    // Aim. Mirror X because the webcam feed is a mirror: moving your hand right
    // must move the crosshair right, which is the opposite of raw image space.
    if (!gunUp) {
      const a = aimPoint(landmarks);
      this.targetAim.x = 1 - Math.max(0, Math.min(1, a.x));
      this.targetAim.y = Math.max(0, Math.min(1, a.y));
    }
    this.#integrateAim(dt);

    const out = {
      present: true,
      pose,
      confidence,
      aim: { ...this.aim },
      fired,
      gunUp,
      elevation,
      triggerArmed,
      curl,
      span: handSpan(landmarks),
    };
    this.last = out;
    return out;
  }

  /** Critically-ish-damped spring. See docs/GAMEPLAY.md §7 on crosshair lag. */
  #integrateAim(dt) {
    const h = Math.min(dt, 1 / 30); // clamp so a stalled frame cannot explode it
    for (const k of ['x', 'y']) {
      const accel = (this.targetAim[k] - this.aim[k]) * this.t.aimStiffness
                  - this.aimVel[k] * this.t.aimDamping;
      this.aimVel[k] += accel * h;
      this.aim[k] += this.aimVel[k] * h;
    }
  }
}
