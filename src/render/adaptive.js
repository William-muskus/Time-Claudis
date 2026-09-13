/**
 * Adaptive resolution scaling.
 *
 * This is the shipped answer to the brief's DLSS request — see
 * docs/CONSTRAINTS.md §3 for why DLSS itself is unreachable from a browser.
 * Both techniques trade internal resolution for frame rate; DLSS reconstructs
 * the lost detail with a trained model and this does not. For a flat-shaded
 * low-poly scene with no high-frequency texture detail the gap is narrower
 * than it would be for a photorealistic renderer, because there is much less
 * fine detail to recover in the first place.
 *
 * DESIGN NOTES
 *
 * Median, not mean. One 400 ms hitch — a shader compile, a GC pause, the tab
 * being backgrounded — would drag a mean frame time far enough to collapse the
 * resolution and then take seconds to recover. A median over the window is
 * immune to that.
 *
 * Asymmetric response. Dropping resolution is urgent and happens in one step;
 * raising it is speculative and happens slowly, because guessing wrong upward
 * costs a dropped frame. This is the same asymmetry every shipping DRS
 * implementation uses.
 *
 * Hysteresis and a dead band. Without them the scaler oscillates around the
 * target, and a resolution that visibly pumps up and down is far more
 * distracting than one that is simply a bit soft.
 */

export class AdaptiveResolution {
  constructor({
    targetFps = 60,
    min = 0.55,
    max = 1.0,
    window = 45,
    /** Fraction of budget above which we scale down / below which we scale up. */
    downThreshold = 1.08,
    upThreshold = 0.78,
    downStep = 0.10,
    upStep = 0.022,
    /** Frames to wait after a change before considering another. */
    settleFrames = 28,
  } = {}) {
    this.budgetMs = 1000 / targetFps;
    this.min = min; this.max = max;
    this.window = window;
    this.downThreshold = downThreshold;
    this.upThreshold = upThreshold;
    this.downStep = downStep;
    this.upStep = upStep;
    this.settleFrames = settleFrames;

    this.scale = max;
    this.samples = [];
    this.sinceChange = 0;
    this.enabled = true;
    this.lastDecision = 'init';
  }

  /**
   * @param {number} frameMs measured GPU+CPU time for the last frame
   * @returns {number|null} a new scale to apply, or null if unchanged
   */
  sample(frameMs) {
    if (!this.enabled || !Number.isFinite(frameMs) || frameMs <= 0) return null;
    this.samples.push(frameMs);
    if (this.samples.length > this.window) this.samples.shift();
    this.sinceChange++;

    if (this.samples.length < this.window) return null;
    if (this.sinceChange < this.settleFrames) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const ratio = median / this.budgetMs;

    let next = this.scale;
    if (ratio > this.downThreshold) {
      // Scale the step by how badly we are missing, so a catastrophic frame
      // time gets back to playable in one move rather than five.
      const severity = Math.min(2.5, ratio / this.downThreshold);
      next = Math.max(this.min, this.scale - this.downStep * severity);
      this.lastDecision = `down (median ${median.toFixed(1)}ms)`;
    } else if (ratio < this.upThreshold && this.scale < this.max) {
      next = Math.min(this.max, this.scale + this.upStep);
      this.lastDecision = `up (median ${median.toFixed(1)}ms)`;
    } else {
      this.lastDecision = `hold (median ${median.toFixed(1)}ms)`;
      return null;
    }

    if (Math.abs(next - this.scale) < 0.004) return null;
    this.scale = next;
    this.sinceChange = 0;
    this.samples.length = 0;      // the old samples describe a different resolution
    return this.scale;
  }

  reset() {
    this.scale = this.max;
    this.samples.length = 0;
    this.sinceChange = 0;
  }
}
