/**
 * The music bed.
 *
 * Synthesised, like everything else here, and sequenced with a lookahead
 * scheduler rather than timers. WHY: `setTimeout` in a browser is accurate to
 * tens of milliseconds at best and worse under GC, which at 138 BPM is audible
 * as a limp. The standard fix — and the only one that works — is to run a
 * coarse timer that looks a fraction of a second into the future and books
 * every note it finds onto the AudioContext's own sample clock, which is exact.
 *
 * The bed is a four-bar A-minor loop (Am Am F G) with a sixteenth-note bass
 * ostinato. It is deliberately one idea: arcade stage music is a vamp the
 * player stops consciously hearing after thirty seconds, and the composition
 * budget goes into INTENSITY instead, because that is the part the player reads
 * as information rather than decoration.
 *
 * Intensity is a ladder of layers, not a volume knob — a louder mix of the same
 * thing reads as "the game got closer to the speakers", whereas an extra
 * percussion layer reads as "the game got harder":
 *
 *   0  attract / menu   bass + pad, half-time feel
 *   1  early areas      + kick, backbeat, offbeat hats
 *   2  mid areas        + sixteenth hats, chord stabs
 *   3  late areas       + double kick, lead line
 *   CRISIS (orthogonal) tempo +14%, every-step hats, and a tritone two-tone
 *                       alarm that no other layer uses, so it cannot be
 *                       mistaken for the music getting busier.
 */

const STEPS_PER_BAR = 16;
const BARS = 4;
const TOTAL_STEPS = STEPS_PER_BAR * BARS;

/** Semitones from the bar root. A driving ostinato: root, root, fifth, octave. */
const BASS = [
  0, 0, 0, 7, 0, 0, 10, 0, 0, 0, 0, 7, 12, 10, 7, 3,
];
/** Am – Am – F – G, in semitones from A. */
const BAR_ROOT = [0, 0, -4, -2];
/** Minor / major triad shapes chosen to match those roots. */
const BAR_TRIAD = [[0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]];
/** A simple lead that only appears at the top of the ladder. */
const LEAD = [
  12, null, 15, null, 19, null, 17, null, 15, null, null, 12, null, 10, null, null,
];

const A1 = 55;   // Hz. Everything is a semitone offset from here.
const hz = (semi) => A1 * Math.pow(2, semi / 12);

export class MusicBed {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination the ducked music bus
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    this.bpm = 138;
    this.intensity = 0;
    this.crisis = false;
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = null;
    this.running = false;

    // One shared noise buffer for hats and snares.
    const n = Math.floor(ctx.sampleRate * 0.4);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  get stepDur() {
    const bpm = this.bpm * (this.crisis ? 1.14 : 1);
    return 60 / bpm / 4;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
    // 25 ms is far more often than notes need booking, which is the point:
    // the scheduler must never be the thing that is late.
    this.timer = setInterval(() => this.#tick(), 25);
  }

  stop({ fade = 0.5 } = {}) {
    if (!this.running) return;
    this.out.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade / 3);
    const t = this.timer;
    this.timer = null;
    this.running = false;
    setTimeout(() => clearInterval(t), fade * 1000 + 200);
  }

  setIntensity(n) { this.intensity = Math.max(0, Math.min(3, n | 0)); }
  setCrisis(on) { this.crisis = !!on; }

  #tick() {
    const ctx = this.ctx;
    // Book every step that starts within the next 150 ms.
    while (this.nextStepTime < ctx.currentTime + 0.15) {
      this.#schedule(this.step, this.nextStepTime);
      this.nextStepTime += this.stepDur;
      this.step = (this.step + 1) % TOTAL_STEPS;
    }
  }

  #schedule(step, t) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s = step % STEPS_PER_BAR;
    const root = BAR_ROOT[bar];
    const I = this.intensity;

    // --- bass: present at every intensity. It is the pulse. -----------------
    const semi = root + BASS[s] - 12;
    if (I >= 1 || s % 4 === 0) this.#bass(t, hz(semi), this.stepDur * 0.9);

    // --- pad: a slow sustained triad, one hit per bar ------------------------
    if (s === 0) this.#pad(t, BAR_TRIAD[bar].map((i) => hz(root + i + 24)), this.stepDur * 15);

    // --- drums ---------------------------------------------------------------
    if (I >= 1) {
      if (s === 0 || s === 6 || s === 8 || s === 14) this.#kick(t);
      if (I >= 3 && (s === 3 || s === 11)) this.#kick(t, 0.6);
      if (s === 4 || s === 12) this.#snare(t);
    }
    const hatEvery = this.crisis ? 1 : (I >= 2 ? 2 : (I >= 1 ? 4 : 0));
    if (hatEvery && s % hatEvery === 0) {
      this.#hat(t, s % 4 === 0 ? 0.22 : 0.13);
    }

    // --- chord stabs ---------------------------------------------------------
    if (I >= 2 && (s === 2 || s === 10)) {
      this.#stab(t, BAR_TRIAD[bar].map((i) => hz(root + i + 24)));
    }

    // --- lead ----------------------------------------------------------------
    if (I >= 3 && LEAD[s] !== null && bar % 2 === 1) {
      this.#lead(t, hz(root + LEAD[s] + 12), this.stepDur * 1.6);
    }

    // --- the crisis alarm ----------------------------------------------------
    // A tritone alternation on the half-beat. Deliberately NOT in the key: it
    // must be heard as an interruption of the music rather than part of it.
    if (this.crisis && s % 4 === 0) {
      const up = (s / 4) % 2 === 0;
      this.#alarm(t, up ? 880 : 622, this.stepDur * 1.4);
    }
  }

  // -------------------------------------------------------------------------
  // Voices. Each is a handful of numbers, which is the whole argument for
  // synthesising rather than shipping samples: these are tunable in a diff.
  // -------------------------------------------------------------------------

  #env(node, t, peak, attack, dur) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  #bass(t, f, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 7;
    // The filter sweep per note is what gives a static ostinato movement.
    filt.frequency.setValueAtTime(Math.min(4200, f * 9), t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(90, f * 2.4), t + dur);
    const g = ctx.createGain();
    this.#env(g, t, 0.30, 0.004, dur);
    o.connect(filt).connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.03);
  }

  #pad(t, freqs, dur) {
    const ctx = this.ctx;
    for (const f of freqs) {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, t);
        o.detune.setValueAtTime(det, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.035, t + 0.25);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.out);
        o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  #kick(t, amp = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.085);
    const g = ctx.createGain();
    this.#env(g, t, 0.62 * amp, 0.003, 0.19);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.22);
  }

  #snare(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass'; b.frequency.value = 1900; b.Q.value = 0.7;
    const g = ctx.createGain();
    this.#env(g, t, 0.26, 0.002, 0.15);
    src.connect(b).connect(g).connect(this.out);
    src.start(t); src.stop(t + 0.18);
    // A little tuned body under the noise so it is not just a hiss.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    const og = ctx.createGain();
    this.#env(og, t, 0.13, 0.002, 0.09);
    o.connect(og).connect(this.out);
    o.start(t); o.stop(t + 0.12);
  }

  #hat(t, amp) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const b = ctx.createBiquadFilter();
    b.type = 'highpass'; b.frequency.value = 7000;
    const g = ctx.createGain();
    this.#env(g, t, amp, 0.001, 0.045);
    src.connect(b).connect(g).connect(this.out);
    src.start(t); src.stop(t + 0.07);
  }

  #stab(t, freqs) {
    const ctx = this.ctx;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      this.#env(g, t, 0.07, 0.003, 0.11);
      o.connect(g).connect(this.out);
      o.start(t); o.stop(t + 0.14);
    }
  }

  #lead(t, f, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    const b = ctx.createBiquadFilter();
    b.type = 'lowpass'; b.frequency.value = 3200; b.Q.value = 3;
    const g = ctx.createGain();
    this.#env(g, t, 0.10, 0.006, dur);
    o.connect(b).connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.03);
  }

  #alarm(t, f, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    this.#env(g, t, 0.10, 0.004, dur);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.03);
  }
}
