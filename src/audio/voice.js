/**
 * A formant voice synthesiser for the announcer.
 *
 * WHY NOT A CHORD, AND WHY NOT TTS
 * --------------------------------
 * The previous announcer barked a musical interval and hoped the player would
 * read "ACTION!" off the banner. That works for one callout and falls apart at
 * five, because two sawtooth notes cannot be told apart in peripheral hearing
 * while the player is watching the screen — which is the only time an arcade
 * callout matters. Web Speech / network TTS is the other obvious answer and is
 * worse: it arrives tens to hundreds of milliseconds late, the voice differs
 * per machine, and it cannot be ducked or compressed as part of the mix.
 *
 * So we synthesise vowels. A vowel is, to a first approximation, a buzzing
 * glottal source shaped by three resonant peaks (formants), and the identity of
 * the vowel is almost entirely in where the first two peaks sit. Three parallel
 * band-passes whose centre frequencies GLIDE between segments produce something
 * the ear resolves as speech, because those glides are the coarticulation cues
 * real speech carries. Consonants are noise bursts in a characteristic band.
 *
 * It will never pass for a human. It is not supposed to: arcade announcers were
 * 8-bit ADPCM through a horn in a loud room, and the target is that — barked,
 * clipped, mid-forward, unmistakable.
 */

/**
 * [F1, F2, F3] in Hz for each voiced segment we can say. F1 tracks how open the
 * mouth is, F2 how far forward the tongue is; F3 mostly adds "human" and is
 * only load-bearing for /r/, where it drops to meet F2.
 */
export const VOICED = {
  ee: [300, 2300, 3000],   // b_ea_t
  ih: [400, 1990, 2550],   // b_i_t
  ay: [530, 1840, 2480],   // b_ai_t
  eh: [660, 1720, 2410],   // b_e_t
  aa: [730, 1090, 2440],   // f_a_ther
  uh: [640, 1190, 2390],   // b_u_t
  aw: [570, 840, 2410],    // b_ou_ght
  oh: [450, 800, 2400],    // b_oa_t
  oo: [330, 870, 2240],    // b_oo_t
  er: [490, 1350, 1690],   // b_ir_d — note F3 collapsing toward F2
  r:  [310, 1060, 1380],
  l:  [360, 1300, 2700],
  m:  [280, 900, 2200],
  n:  [280, 1700, 2600],
};

/**
 * Consonants: a band-limited noise burst. `voiced` keeps the glottal buzz
 * running underneath (the difference between /s/ and /z/, /t/ and /d/).
 */
export const CONS = {
  k:  { f: 1900, q: 1.1, g: 0.60 },
  t:  { f: 3400, q: 1.4, g: 0.52 },
  p:  { f: 900,  q: 1.0, g: 0.44 },
  d:  { f: 2400, q: 1.2, g: 0.38, voiced: true },
  g:  { f: 1500, q: 1.1, g: 0.46, voiced: true },
  s:  { f: 5200, q: 0.9, g: 0.34 },
  sh: { f: 2400, q: 0.7, g: 0.50 },
  f:  { f: 4200, q: 0.6, g: 0.26 },
  v:  { f: 1400, q: 0.8, g: 0.24, voiced: true },
};

/** Soft-clip curve. Distortion is what makes a thin buzz sound like a horn. */
function driveCurve(amount = 2.6) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

export class VoiceSynth {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination typically the announcer's voice bus
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;

    // One shared noise buffer. Allocating a fresh one per consonant would be
    // dozens of kilobytes of garbage per callout for no audible difference.
    const n = Math.floor(ctx.sampleRate * 0.5);
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.curve = driveCurve();
  }

  /**
   * Speak a word.
   *
   * @param {Array<{v?:string,c?:string,gap?:number,d?:number,p?:number,g?:number}>} segs
   * @param {{f0?:number, gain?:number, rate?:number, pan?:number, at?:number}} opt
   * @returns {number} duration in seconds, so the caller can size the music duck
   */
  speak(segs, { f0 = 132, gain = 1, rate = 1, pan = 0, at = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.012 + at;   // a hair of pre-roll for the ramps
    const total = segs.reduce((a, s) => a + (s.d ?? s.gap ?? 0.08), 0) / rate;

    // --- the vocal tract -----------------------------------------------------
    const tract = ctx.createGain();
    tract.gain.value = 1;

    const drive = ctx.createWaveShaper();
    drive.curve = this.curve;

    // A telephone/horn band. Rolling off below 300 Hz and above ~4.5 kHz is most
    // of what makes a synthetic voice read as "PA system" rather than "synth".
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4600;

    const out = ctx.createGain();
    out.gain.value = gain;

    const panner = ctx.createStereoPanner?.();
    if (panner) panner.pan.value = pan;

    // Slapback. A callout in a cabinet is heard in a room; 78 ms of it is the
    // difference between "sample" and "tannoy".
    const dly = ctx.createDelay(0.5);
    dly.delayTime.value = 0.078;
    const fb = ctx.createGain();
    fb.gain.value = 0.16;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;

    tract.connect(drive).connect(hp).connect(lp).connect(out);
    out.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet);
    if (panner) { out.connect(panner); wet.connect(panner); panner.connect(this.dest); }
    else { out.connect(this.dest); wet.connect(this.dest); }

    // --- glottal source ------------------------------------------------------
    // Sawtooth is the standard stand-in for a glottal pulse train; the square an
    // octave down just thickens the chest of it.
    const glot = ctx.createGain();
    glot.gain.setValueAtTime(0.0001, t0);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const subG = ctx.createGain();
    subG.gain.value = 0.28;
    saw.connect(glot);
    sub.connect(subG).connect(glot);

    // --- three parallel formants --------------------------------------------
    const fmt = [0, 1, 2].map((i) => {
      const b = ctx.createBiquadFilter();
      b.type = 'bandpass';
      b.Q.value = [9, 11, 13][i];
      const g = ctx.createGain();
      // Upper formants carry identity but little energy; keep them audible
      // without letting them whistle.
      g.gain.value = [1, 0.62, 0.34][i];
      glot.connect(b).connect(g).connect(tract);
      return b;
    });
    // Seed the filters with the first voiced target so the word does not open
    // with a click of the filters slewing from 350 Hz.
    const firstV = segs.find((s) => s.v && VOICED[s.v]);
    const seed = firstV ? VOICED[firstV.v] : VOICED.uh;
    fmt.forEach((b, i) => b.frequency.setValueAtTime(seed[i], t0));

    // --- schedule ------------------------------------------------------------
    let t = t0;
    // A falling pitch contour across the word. Flat f0 is the single biggest
    // giveaway of a robot, and a fall is what an English shout does.
    const contour = (frac) => f0 * (1.06 - 0.16 * frac);

    for (const s of segs) {
      const d = (s.d ?? s.gap ?? 0.08) / rate;
      const frac = (t - t0) / Math.max(total, 0.001);
      const f = contour(frac) * (s.p ?? 1);
      saw.frequency.setValueAtTime(f, t);
      sub.frequency.setValueAtTime(f / 2, t);

      if (s.gap !== undefined) {
        glot.gain.setTargetAtTime(0.0001, t, 0.012);
      } else if (s.v) {
        const F = VOICED[s.v] ?? VOICED.uh;
        // setTargetAtTime, not setValueAtTime: the GLIDE between formant
        // positions is the coarticulation cue. Stepping them makes each segment
        // a separate bleep instead of a word.
        fmt.forEach((b, i) => b.frequency.setTargetAtTime(F[i], t, 0.022));
        glot.gain.setTargetAtTime(0.26 * (s.g ?? 1), t, 0.010);
      } else if (s.c) {
        const C = CONS[s.c] ?? CONS.t;
        if (!C.voiced) glot.gain.setTargetAtTime(0.0001, t, 0.006);
        this.#burst(t, d, C, tract);
      }
      t += d;
    }
    // Hard release. Arcade callouts are gated, not faded.
    glot.gain.setTargetAtTime(0.0001, t, 0.018);

    saw.start(t0); sub.start(t0);
    const stop = t + 0.42;   // let the slapback tail ring out
    saw.stop(stop); sub.stop(stop);
    out.gain.setValueAtTime(gain, t);
    out.gain.setTargetAtTime(0.0001, t + 0.04, 0.05);

    return total;
  }

  #burst(t, d, C, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass'; b.frequency.value = C.f; b.Q.value = C.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, C.g), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, d));
    src.connect(b).connect(g).connect(dest);
    src.start(t);
    src.stop(t + d + 0.05);
  }
}

/**
 * The lexicon.
 *
 * Written phonetically rather than orthographically, because the synth speaks
 * sounds. Durations are deliberately uneven: the stressed syllable of an arcade
 * callout is roughly twice the length of the others and that stress pattern is
 * most of what makes a short phrase recognisable at low intelligibility.
 */
export const WORDS = {
  // "AK-shun"
  action: [{ c: 'k', d: 0.04 }, { v: 'aa', d: 0.16, p: 1.10 }, { c: 'k', d: 0.05 },
           { c: 'sh', d: 0.07 }, { v: 'uh', d: 0.10, p: 0.90 }, { v: 'n', d: 0.07, p: 0.86 }],
  // "AIR-ee-uh  KLEER"
  areaclear: [{ v: 'eh', d: 0.13, p: 1.06 }, { v: 'r', d: 0.05 }, { v: 'ee', d: 0.07 },
              { v: 'uh', d: 0.07, p: 0.94 }, { gap: 0.07 },
              { c: 'k', d: 0.045 }, { v: 'l', d: 0.045 }, { v: 'ee', d: 0.18, p: 1.14 },
              { v: 'er', d: 0.13, p: 0.92 }],
  // "STAYJ KLEER"
  stageclear: [{ c: 's', d: 0.08 }, { c: 't', d: 0.035 }, { v: 'ay', d: 0.17, p: 1.08 },
               { c: 'sh', d: 0.06 }, { gap: 0.06 },
               { c: 'k', d: 0.045 }, { v: 'l', d: 0.045 }, { v: 'ee', d: 0.18, p: 1.12 },
               { v: 'er', d: 0.13, p: 0.9 }],
  // "ree-LOHD"
  reload: [{ v: 'r', d: 0.05 }, { v: 'ee', d: 0.08 }, { v: 'l', d: 0.05 },
           { v: 'oh', d: 0.19, p: 1.10 }, { c: 'd', d: 0.05 }],
  // "KRY-sis" — the pitch RISES on this one, against the usual fall, because it
  // is the only callout that is a warning rather than a statement.
  crisis: [{ c: 'k', d: 0.045 }, { v: 'r', d: 0.04 }, { v: 'aa', d: 0.13, p: 1.16 },
           { v: 'ee', d: 0.06, p: 1.24 }, { c: 's', d: 0.07 },
           { v: 'ih', d: 0.09, p: 1.06 }, { c: 's', d: 0.12 }],
  // "GAYM OH-ver"
  gameover: [{ c: 'g', d: 0.04 }, { v: 'ay', d: 0.18, p: 1.0 }, { v: 'm', d: 0.09, p: 0.9 },
             { gap: 0.08 },
             { v: 'oh', d: 0.16, p: 0.86 }, { c: 'v', d: 0.05 }, { v: 'er', d: 0.18, p: 0.76 }],
  // "TIME UP"
  timeup: [{ c: 't', d: 0.04 }, { v: 'aa', d: 0.13, p: 1.08 }, { v: 'ee', d: 0.05, p: 1.14 },
           { v: 'm', d: 0.08, p: 0.94 }, { gap: 0.06 },
           { v: 'uh', d: 0.13, p: 0.88 }, { c: 'p', d: 0.05 }],
  // "NO HIT"
  nohit: [{ v: 'n', d: 0.06 }, { v: 'oh', d: 0.16, p: 1.08 }, { gap: 0.05 },
          { v: 'ih', d: 0.11, p: 1.0 }, { c: 't', d: 0.05 }],
  // "kun-TIN-yoo"
  continue: [{ c: 'k', d: 0.04 }, { v: 'uh', d: 0.07, p: 0.94 }, { c: 't', d: 0.035 },
             { v: 'ih', d: 0.13, p: 1.12 }, { v: 'n', d: 0.05 },
             { v: 'ee', d: 0.06, p: 1.04 }, { v: 'oo', d: 0.15, p: 0.92 }],
  // "REH-dee"
  ready: [{ v: 'r', d: 0.05 }, { v: 'eh', d: 0.14, p: 1.08 }, { c: 'd', d: 0.04 },
          { v: 'ee', d: 0.14, p: 0.92 }],
};
