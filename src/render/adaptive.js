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
 * WHAT IS BEING MEASURED, AND WHY THAT WAS WRONG
 *
 * This controller was fed `performance.now()` taken either side of
 * `composer.render()`. That number is the cost of SUBMITTING the frame, not
 * the cost of drawing it. WebGL commands are queued and return immediately;
 * the GPU finishes whenever it finishes. On a CPU-bound machine that reading
 * is roughly right, and on a GPU-bound machine — which is precisely the
 * machine that needs a resolution scaler — it reads near zero while the game
 * runs at twenty frames a second. The scaler would sit at full resolution and
 * report that everything was fine. Nothing about that failure is visible in a
 * test that feeds the controller numbers directly, which is why five such
 * tests passed over it.
 *
 * It is now fed the wall-clock interval between successive frames. That
 * captures GPU back-pressure (a browser will not schedule the next animation
 * frame until the last one is through), the compositor, hand tracking, and
 * everything else the player actually experiences. There is a per-frame GPU
 * timer in EXT_disjoint_timer_query_webgl2 that would give a cleaner number,
 * but it is unavailable or neutered in most browsers for side-channel reasons
 * and cannot be relied on; frame-to-frame time always works.
 *
 * WHY THE UPWARD PATH HAD TO CHANGE WITH IT
 *
 * Wall-clock frame time is quantised by vsync. On a 60 Hz display a frame
 * that finishes in three milliseconds and one that finishes in fifteen both
 * arrive 16.7 ms apart, so a machine with enormous headroom and one with none
 * to spare produce an identical reading. The old rule — scale up when the
 * frame time falls below 78% of budget — can therefore never fire under
 * vsync, and a scaler that only ever goes down is a scaler that ends every
 * long session at its floor.
 *
 * So upward movement is a PROBE rather than a measurement. When the frame
 * rate is being held, the controller occasionally tries a small step up and
 * watches what happens. If the step was affordable it stays; if it was not,
 * the downward path takes it away and the next probe waits twice as long.
 * That backoff is what stops the resolution pumping at the machine's exact
 * sustainable scale — the failure that makes a naive ladder worse than no
 * scaler at all. The clearly-fast case is kept as well: when the frame time
 * really is far under budget (an uncapped context, an offscreen render) the
 * controller does not need to guess and steps up straight away.
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
    /** Fraction of budget above which we scale down. */
    downThreshold = 1.08,
    /** Fraction of budget below which we are CLEARLY fast and need not guess. */
    upThreshold = 0.78,
    /**
     * Fraction of budget at or under which the target is considered held.
     * Slightly over 1 because a vsynced frame lands a hair either side of the
     * refresh interval and an exact comparison would never be true.
     */
    holdCeiling = 1.02,
    downStep = 0.10,
    upStep = 0.022,
    /** Frames to wait after a change before considering another. */
    settleFrames = 28,
    /** Frames of held frame rate before the first speculative step up. */
    probeFrames = 120,
    /**
     * Ceiling on the backoff. Two minutes at 60 fps: long enough that a
     * machine parked at its limit stops fidgeting, short enough that one whose
     * load genuinely drops — an area cleared, the boss dead — climbs back
     * within a stage rather than within a session.
     */
    maxProbeFrames = 7200,
    /**
     * The longest interval still treated as a frame. A backgrounded tab, a
     * breakpoint, or a machine waking from sleep produces a gap of seconds
     * that says nothing about rendering cost and everything about the browser
     * having stopped calling us.
     */
    maxFrameMs = 500,
  } = {}) {
    this.budgetMs = 1000 / targetFps;
    this.min = min; this.max = max;
    this.window = window;
    this.downThreshold = downThreshold;
    this.upThreshold = upThreshold;
    this.holdCeiling = holdCeiling;
    this.downStep = downStep;
    this.upStep = upStep;
    this.settleFrames = settleFrames;
    this.probeFrames = probeFrames;
    this.baseProbeFrames = probeFrames;
    this.maxProbeFrames = maxProbeFrames;
    this.maxFrameMs = maxFrameMs;

    this.scale = max;
    this.samples = [];
    this.sinceChange = 0;
    /** Frames since the frame rate was last seen to be held at target. */
    this.sinceProbe = 0;
    this.enabled = true;
    this.lastDecision = 'init';
    /** True while the most recent change was a speculative step up. */
    this.probing = false;
    this.dropped = 0;
  }

  /**
   * @param {number} frameMs wall-clock interval since the previous frame
   * @returns {number|null} a new scale to apply, or null if unchanged
   */
  sample(frameMs) {
    if (!this.enabled || !Number.isFinite(frameMs) || frameMs <= 0) return null;
    // Not a frame: the browser stopped calling us. Counted, not measured — a
    // window full of these would otherwise floor the resolution of a game
    // that was merely in a background tab.
    if (frameMs > this.maxFrameMs) { this.dropped++; return null; }

    this.samples.push(frameMs);
    if (this.samples.length > this.window) this.samples.shift();
    this.sinceChange++;
    this.sinceProbe++;

    if (this.samples.length < this.window) return null;
    if (this.sinceChange < this.settleFrames) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const ratio = median / this.budgetMs;

    let next = this.scale;
    if (ratio > this.downThreshold) {
      if (this.probing) {
        // UNDO THE PROBE, NOTHING MORE. The frame rate was being held one step
        // ago and this controller is the only thing that changed, so the step
        // is the whole of the problem and a severity-scaled drop would be five
        // times the correction needed. Overcorrecting here is what made the
        // ladder pump: the big drop had to be climbed back one probe at a
        // time, and every climb ended in another failed probe at the same
        // ceiling. Taking back exactly what was given leaves the resolution
        // parked one step under what the machine can hold, which is where it
        // belongs.
        //
        // EXACTLY upStep, not a hair more. An undo of 1.05x looks harmless and
        // ratchets: every probe cycle gives 0.022 and takes 0.0231, so an hour
        // of sitting at the limit walks the resolution down by a tenth for no
        // reason anyone could observe. Returning to the precise scale that was
        // holding a moment ago has no drift, and it is a scale already known
        // to be affordable rather than a guess below it.
        next = Math.max(this.min, this.scale - this.upStep);
        // And the next probe waits twice as long, so a machine sitting exactly
        // at its limit stops asking the question every few seconds.
        this.probeFrames = Math.min(this.maxProbeFrames, this.probeFrames * 2);
      } else {
        // Scale the step by how badly we are missing, so a catastrophic frame
        // time gets back to playable in one move rather than five.
        const severity = Math.min(2.5, ratio / this.downThreshold);
        next = Math.max(this.min, this.scale - this.downStep * severity);
      }
      this.probing = false;
      this.sinceProbe = 0;
      this.lastDecision = `down (median ${median.toFixed(1)}ms)`;
    } else if (ratio < this.upThreshold && this.scale < this.max) {
      // Measured headroom. No guessing needed, and no backoff earned.
      next = Math.min(this.max, this.scale + this.upStep);
      this.probing = false;
      this.sinceProbe = 0;
      this.lastDecision = `up (median ${median.toFixed(1)}ms)`;
    } else if (ratio <= this.holdCeiling && this.scale < this.max
               && this.sinceProbe >= this.probeFrames) {
      // Holding target with the resolution below maximum. Under vsync this is
      // indistinguishable from having headroom to spare, so find out.
      next = Math.min(this.max, this.scale + this.upStep);
      this.probing = true;
      this.sinceProbe = 0;
      this.lastDecision = `probe up (median ${median.toFixed(1)}ms)`;
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
    this.sinceProbe = 0;
    this.probeFrames = this.baseProbeFrames;
    this.probing = false;
    this.dropped = 0;
  }
}
