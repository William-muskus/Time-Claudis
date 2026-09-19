/**
 * What the mix actually does, without a speaker.
 *
 * WHY. src/audio/* was written, unit-tested for wiring, and never heard. Every
 * sound in it is a handful of numbers — a gain, a filter, an envelope — and a
 * number that is wrong by 6 dB is completely invisible in a diff and obvious
 * within one second of listening. Nobody has had that second.
 *
 * So the graph is run against a stub WebAudio implementation that records what
 * each node is asked to do, and the result is integrated into an amplitude
 * envelope per event. That answers the questions that matter without ears:
 *
 *   - Is anything so quiet it will not be heard under the music bed?
 *   - Is anything so loud it slams the limiter on its own?
 *   - Does the LOUDNESS ORDER match the IMPORTANCE ORDER? A game whose
 *     reload click is louder than its player-hit cue is telling the player
 *     the wrong thing, and it will do so on every single hit.
 *
 * WHAT THIS IS NOT. Phase is ignored: every simultaneous source is summed as
 * if perfectly in phase, so the peaks reported here are an upper bound rather
 * than what a soundcard would show. Filters and the waveshaper are treated as
 * unity gain, which is wrong for a resonant biquad (Q > 1 lifts the band) and
 * wrong for the voice's saturator. The compressor is bypassed deliberately —
 * the point is to see what arrives AT the limiter, since a mix that only works
 * because the limiter is holding it down has no shape of its own, it just has
 * a ceiling.
 *
 * Relative numbers between events are therefore trustworthy. Absolute ones are
 * an upper bound, and 1.0 is "the limiter is doing the work here".
 */

const SR = 48000;

class Param {
  constructor(v) { this.events = [['set', 0, v]]; this._v = v; }
  get value() { return this._v; }
  set value(v) { this._v = v; this.events.push(['set', 0, v]); }
  setValueAtTime(v, t) { this.events.push(['set', t, v]); return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', t, v]); return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', t, v]); return this; }
  setTargetAtTime(v, t) { this.events.push(['set', t, v]); return this; }
  cancelScheduledValues() { return this; }

  /** Value at time t, honouring the ramp shapes the real API uses. */
  at(t) {
    const ev = [...this.events].sort((a, b) => a[1] - b[1]);
    let prev = ev[0];
    for (const e of ev) {
      if (e[1] <= t) { prev = e; continue; }
      if (e[0] === 'set') break;
      const span = e[1] - prev[1];
      if (span <= 0) break;
      const k = (t - prev[1]) / span;
      if (e[0] === 'lin') return prev[2] + (e[2] - prev[2]) * k;
      const a = Math.max(1e-6, prev[2]), b = Math.max(1e-6, e[2]);
      return a * Math.pow(b / a, k);
    }
    return prev[2];
  }
}

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; ctx.nodes.push(this); }
  connect(dest) { this.outs.push(dest); return dest; }
  disconnect() { this.outs = []; }
}

class Source extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.t0 = Infinity; this.t1 = Infinity; }
  start(t = this.ctx.currentTime) { this.t0 = t; }
  stop(t) { this.t1 = t; }
}

class Ctx {
  constructor() { this.currentTime = 0; this.sampleRate = SR; this.nodes = []; this.destination = new Node(this, 'dest'); }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createBiquadFilter() { const n = new Node(this, 'biquad'); n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); n.type = 'lowpass'; return n; }
  createDelay() { const n = new Node(this, 'delay'); n.delayTime = new Param(0); return n; }
  createStereoPanner() { const n = new Node(this, 'pan'); n.pan = new Param(0); return n; }
  createWaveShaper() { const n = new Node(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createDynamicsCompressor() {
    const n = new Node(this, 'comp');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    return n;
  }
  createOscillator() {
    const n = new Source(this, 'osc');
    n.frequency = new Param(440); n.detune = new Param(0); n.type = 'sine';
    return n;
  }
  createBufferSource() { const n = new Source(this, 'buf'); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); return n; }
  createBuffer(ch, len) {
    return { numberOfChannels: ch, length: len, sampleRate: SR, getChannelData: () => new Float32Array(len) };
  }
  resume() {} close() {}
}

/**
 * Peak amplitude arriving at the compressor, sampled over the event's life.
 *
 * Every source contributes its own amplitude times the product of the gains on
 * its path to the master bus. The compressor is treated as a wire so the
 * number reported is what the limiter is being handed.
 */
function peakAt(ctx, master, t) {
  // Path gains, memoised per node per sample time.
  // The path walk needs a cycle guard: the voice's saturator and the music
  // bed's echo are both feedback loops, and a feedback loop is a graph cycle
  // that will happily recurse until the stack gives out.
  const gainTo = (node, acc, path) => {
    if (node === master) return acc;
    if (path.has(node)) return 0;
    path.add(node);
    let best = 0;
    for (const o of node.outs) {
      const g = o.kind === 'gain' ? o.gain.at(t) : 1;
      best = Math.max(best, gainTo(o, acc * g, path));
    }
    path.delete(node);
    return best;
  };
  let sum = 0;
  for (const n of ctx.nodes) {
    if (!(n instanceof Source)) continue;
    if (t < n.t0 || t > n.t1) continue;
    // A source's own output is unit amplitude; everything downstream scales it.
    let best = 0;
    for (const o of n.outs) {
      const g = o.kind === 'gain' ? o.gain.at(t) : 1;
      best = Math.max(best, gainTo(o, g, new Set([n])));
    }
    sum += best;
  }
  return sum;
}

function measure(fire, { window = 2.0 } = {}) {
  const ctx = new Ctx();
  const stub = fire(ctx);
  const master = stub.master;
  let peak = 0, peakT = 0, area = 0, tail = 0;
  const STEP = 0.001;
  for (let t = 0; t <= window; t += STEP) {
    const v = peakAt(ctx, master, t);
    if (v > peak) { peak = v; peakT = t; }
    area += v * STEP;
    if (v > 0.001) tail = t;
  }
  return { peak, peakT, area, tail, sources: ctx.nodes.filter((n) => n instanceof Source).length };
}

export { Ctx, measure, peakAt };
