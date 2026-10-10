import * as THREE from 'three';
import { makeHand } from '../../tests/synthhand.js';

/**
 * The attract-mode pilot.
 *
 * Plays the game by generating synthetic hand poses and feeding them through
 * the REAL GestureRecognizer. It does not shortcut to intent. That matters for
 * two reasons: the attract loop doubles as a continuous integration test of the
 * whole input stack, and the screenshots the visual critic reviews are of the
 * game as actually driven by gestures, not of a debug mode that bypasses them.
 *
 * The pilot is deliberately a B-grade player. It reacts on a human-ish delay,
 * it does not always duck in time, and it wastes rounds. A perfect pilot would
 * produce screenshots that never show the cover mechanic doing anything.
 */

const REACTION_MS = 260;       // how long before it responds to a new threat
const AIM_SLEW = 5.2;          // how fast the hand tracks, normalised units/s

export class DemoPilot {
  constructor(camera, seed = 1234) {
    this.camera = camera;
    this.hand = { x: 0.5, y: 0.52 };
    this.targetHand = { x: 0.5, y: 0.5 };
    this.elevation = 0;
    this.targetElevation = 0;
    this.curl = 0.05;
    this.trigger = 'ready';      // ready → pulling → held → releasing
    this.triggerT = 0;
    this.threatSince = -1;
    this.wantCover = false;
    this.coverUntil = 0;
    this.t = 0;
    this._v = new THREE.Vector3();
    void seed;
  }

  /**
   * @param {number} dt
   * @param {object} game the live Game instance
   * @returns {{x:number,y:number,z:number}[]} synthetic landmarks
   */
  update(dt, game) {
    this.t += dt;
    const snap = game.snapshot();

    // --- decide whether to be in cover ------------------------------------
    // Duck if out of ammo, or if something is about to shoot and we noticed.
    const committing = game.director.enemies.some(
      (e) => e.isAlive && (e.telegraphStage === 'commit' ||
             (e.telegraphStage === 'flash' && e.telegraphMs > e.type.telegraphMs * 0.72)));

    if (snap.rounds === 0) {
      this.wantCover = true;
      this.coverUntil = this.t + 0.95;
    } else if (committing) {
      if (this.threatSince < 0) this.threatSince = this.t;
      // React on a delay, and only most of the time — a pilot that always
      // ducks in time never shows the player getting hit.
      if ((this.t - this.threatSince) * 1000 > REACTION_MS && Math.sin(this.t * 7.3) > -0.55) {
        this.wantCover = true;
        this.coverUntil = this.t + 0.55;
      }
    } else {
      this.threatSince = -1;
    }
    if (this.wantCover && this.t > this.coverUntil && snap.rounds > 0) {
      this.wantCover = false;
    }

    this.targetElevation = this.wantCover ? 88 : 2;

    // --- aim --------------------------------------------------------------
    if (!this.wantCover) {
      const target = this.#pickTarget(game);
      if (target) {
        const p = target.clone().project(this.camera);
        // Project into hand space. The recogniser mirrors X, so we pre-mirror
        // here to cancel it and drive the crosshair where we actually want it.
        this.targetHand.x = 1 - THREE.MathUtils.clamp((p.x + 1) / 2, 0.04, 0.96);
        this.targetHand.y = THREE.MathUtils.clamp((-p.y + 1) / 2, 0.04, 0.96);
      } else {
        // Idle drift so the frame is never static.
        this.targetHand.x = 0.5 + Math.sin(this.t * 0.55) * 0.1;
        this.targetHand.y = 0.5 + Math.cos(this.t * 0.4) * 0.06;
      }
    }

    for (const k of ['x', 'y']) {
      const d = this.targetHand[k] - this.hand[k];
      this.hand[k] += d * Math.min(1, AIM_SLEW * dt);
    }
    this.elevation += (this.targetElevation - this.elevation) * Math.min(1, dt * 7.5);

    // --- the trigger ------------------------------------------------------
    // A real pull and release cycle, so the Schmitt trigger in the recogniser
    // is genuinely exercised rather than bypassed.
    this.triggerT += dt;
    const onTarget = Math.abs(this.hand.x - this.targetHand.x) < 0.05 &&
                     Math.abs(this.hand.y - this.targetHand.y) < 0.05;
    if (this.trigger === 'ready') {
      this.curl = 0.05;
      if (!this.wantCover && snap.rounds > 0 && onTarget &&
          snap.coverState === 'EXPOSED' && this.triggerT > 0.20) {
        this.trigger = 'pulling'; this.triggerT = 0;
      }
    } else if (this.trigger === 'pulling') {
      this.curl = Math.min(0.9, this.curl + dt * 9);
      if (this.curl >= 0.88) { this.trigger = 'releasing'; this.triggerT = 0; }
    } else {
      this.curl = Math.max(0.05, this.curl - dt * 8);
      if (this.curl <= 0.08) { this.trigger = 'ready'; this.triggerT = 0; }
    }

    return makeHand({
      elevationDeg: this.elevation,
      middleCurl: this.wantCover ? 0.08 : this.curl,
      x: this.hand.x,
      y: this.hand.y,
      scale: 0.3,
    });
  }

  /** Nearest gating enemy, else nearest anything. Centre of mass, not the head. */
  #pickTarget(game) {
    const live = game.director.targets();
    if (!live.length) return null;
    const cam = this.camera.position;
    let best = null, bestScore = Infinity;
    for (const e of live) {
      const p = e.group.position.clone();
      p.y += 1.1;
      const d = p.distanceTo(cam);
      // Prefer whatever is about to shoot, then whatever gates the area.
      let score = d;
      if (e.telegraphStage === 'commit') score -= 26;
      else if (e.telegraphStage === 'flash') score -= 14;
      if (e.isGating) score -= 8;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
}
