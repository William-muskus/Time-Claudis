/**
 * The pedal.
 *
 * Time Crisis has exactly one verb and this is it. See docs/GAMEPLAY.md §1.
 * This module is deliberately free of Three.js, DOM and MediaPipe so that the
 * feel can be unit-tested in milliseconds without a browser — tests/cover.test.js
 * drives it with a synthetic clock.
 */

export const CoverState = {
  COVERED: 'COVERED',
  EMERGING: 'EMERGING',
  EXPOSED: 'EXPOSED',
  HIDING: 'HIDING',
};

/** Milliseconds. Hiding is faster than emerging — see spec §1. */
export const EMERGE_MS = 260;
export const HIDE_MS = 200;

export class CoverController {
  constructor() {
    this.state = CoverState.COVERED;
    /** 0 = fully behind cover, 1 = fully exposed. Drives camera + occluder. */
    this.exposure = 0;
    /** Set by the gesture layer: true when the gun is down (player wants out). */
    this.wantsOut = false;
    this.timeInCoverMs = 0;
    this.onStateChange = null;
  }

  /**
   * @param {number} dt seconds
   * @param {boolean} wantsOut gun is down and pointed at the screen
   */
  update(dt, wantsOut) {
    this.wantsOut = wantsOut;
    const prev = this.state;
    const dtMs = dt * 1000;

    // Exposure is a single continuous scalar and the state is derived from it.
    // Doing it this way — rather than a switch with timers — is what makes a
    // mid-transition reversal resume from where it is instead of snapping,
    // which is the behaviour the original has and which players feel even if
    // they never name it.
    const rate = wantsOut ? dtMs / EMERGE_MS : -dtMs / HIDE_MS;
    this.exposure = Math.max(0, Math.min(1, this.exposure + rate));

    if (this.exposure >= 1) this.state = CoverState.EXPOSED;
    else if (this.exposure <= 0) this.state = CoverState.COVERED;
    else this.state = wantsOut ? CoverState.EMERGING : CoverState.HIDING;

    this.timeInCoverMs = this.state === CoverState.COVERED ? this.timeInCoverMs + dtMs : 0;

    if (prev !== this.state && this.onStateChange) this.onStateChange(this.state, prev);
    return this.state;
  }

  /** Can the player pull the trigger right now? Only when fully out. */
  canShoot() {
    return this.state === CoverState.EXPOSED;
  }

  /**
   * Can an enemy bullet hit the player right now?
   * Anything that is not fully behind cover is a target — including both
   * transitions. This is the rule that makes the 260 ms emerge cost real.
   */
  isVulnerable() {
    return this.state !== CoverState.COVERED;
  }

  /** Force the player down. Used on taking a hit, and on area transitions. */
  forceCover() {
    this.state = CoverState.COVERED;
    this.exposure = 0;
    this.timeInCoverMs = 0;
  }
}
