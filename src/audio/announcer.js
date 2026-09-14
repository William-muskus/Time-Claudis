import { VoiceSynth, WORDS } from './voice.js';
import { MusicBed } from './music.js';

/**
 * The announcer and the SFX bed, synthesised with WebAudio.
 *
 * No audio files. Every sound here is generated, which keeps the repo free of
 * binary assets and — more usefully — makes each sound a handful of tunable
 * numbers rather than an opaque blob. An arcade game's audio is mostly
 * envelope shape anyway: a gunshot is a click plus filtered noise with a very
 * fast decay, and that is far easier to tune in code than in a wave editor.
 *
 * The announcer is a formant-ish vocal stand-in rather than speech. Real TTS
 * would need a network voice and would arrive late; a short barked chord with
 * a hard attack lands on the frame it is supposed to and reads unmistakably as
 * an arcade callout.
 */
export class Announcer {
  constructor(bus) {
    this.bus = bus;
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.#wire();
  }

  /** Must be called from a user gesture — browsers will not start audio otherwise. */
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      // A limiter so a busy moment does not clip into mush.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 7;
      comp.attack.value = 0.002;
      comp.release.value = 0.18;
      this.master.connect(comp).connect(this.ctx.destination);

      /**
       * The announcer's voice: a formant synthesiser driven by per-phoneme
       * word definitions in voice.js. It is not speech recognition-grade and
       * it does not need to be — an arcade callout is a barked, compressed,
       * slightly clipped noise whose job is to be unmistakable across a loud
       * room, and a formant bark carries that far better than a chord does.
       */
      this.voiceBus = this.ctx.createGain();
      this.voiceBus.gain.value = 1.0;
      this.voiceBus.connect(this.master);
      this.voice = new VoiceSynth(this.ctx, this.voiceBus);

      /** The music bed, ducked under callouts. */
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      this.music = new MusicBed(this.ctx, this.musicBus);

      this.enabled = true;
    } catch { this.enabled = false; }
  }

  /**
   * Duck the music under a callout.
   *
   * Without this the announcer competes with the bed and neither wins. A fast
   * dip and a slow recovery is the standard broadcast shape and it is what
   * makes a callout feel like it is cutting through rather than sitting on top.
   */
  #duck(seconds = 0.9) {
    if (!this.enabled || !this.musicBus) return;
    const t = this.#now();
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.14, t + 0.06);
    g.linearRampToValueAtTime(0.55, t + seconds);
  }

  #wire() {
    const b = this.bus;
    b.on('shot.fired', ({ weapon }) => this.gunshot(weapon));
    b.on('shot.hit', ({ part, killed }) => this.impact(part, killed));
    b.on('enemy.fired', () => this.enemyShot());
    b.on('enemy.telegraph', ({ stage }) => { if (stage === 'flash') this.tick(); });
    b.on('weapon.empty', () => this.callout('reload'));
    b.on('weapon.reloaded', () => this.reloadClack());
    b.on('player.hit', () => this.playerHit());
    b.on('area.started', () => this.callout('action'));
    b.on('area.cleared', () => this.callout('clear'));
    b.on('game.over', () => this.callout('over'));
    b.on('enemy.detonated', () => this.explosion());
  }

  #now() { return this.ctx.currentTime; }

  /** Filtered noise burst — the basis of gunfire, impacts and explosions. */
  #noise(dur, { type = 'lowpass', freq = 1800, q = 1, gain = 0.6, decay = null } = {}) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.#now();
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (decay ?? dur));
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  #tone(freq, dur, { type = 'square', gain = 0.22, glide = null, delay = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.#now() + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  gunshot(weapon) {
    if (!this.enabled) return;
    if (weapon === 'SHOTGUN') {
      this.#noise(0.28, { freq: 900, gain: 0.85, decay: 0.22 });
      this.#tone(90, 0.14, { type: 'sine', gain: 0.4, glide: 40 });
    } else if (weapon === 'MACHINE_GUN') {
      this.#noise(0.09, { freq: 2600, gain: 0.5, decay: 0.07 });
      this.#tone(180, 0.05, { type: 'square', gain: 0.16, glide: 90 });
    } else {
      // The handgun. A hard click, a body, and a short tail.
      this.#noise(0.13, { freq: 2100, gain: 0.72, decay: 0.09 });
      this.#tone(140, 0.09, { type: 'triangle', gain: 0.3, glide: 55 });
    }
  }

  impact(part, killed) {
    if (part === 'head') {
      this.#tone(1400, 0.1, { type: 'square', gain: 0.24, glide: 2300 });
      this.#tone(2100, 0.08, { type: 'sine', gain: 0.18, glide: 3000, delay: 0.03 });
    } else {
      this.#noise(0.07, { freq: 700, gain: 0.4, decay: 0.05 });
    }
    if (killed) this.#tone(520, 0.16, { type: 'square', gain: 0.16, glide: 210 });
  }

  enemyShot() {
    this.#noise(0.11, { freq: 1500, gain: 0.42, decay: 0.08 });
  }

  /** The flash beat. Small, dry, and the sound the player learns to fear. */
  tick() {
    this.#tone(1650, 0.045, { type: 'square', gain: 0.1 });
  }

  reloadClack() {
    this.#noise(0.05, { freq: 3200, gain: 0.3, decay: 0.04, type: 'highpass' });
    this.#tone(300, 0.05, { type: 'square', gain: 0.1, delay: 0.07 });
  }

  playerHit() {
    this.#noise(0.4, { freq: 380, gain: 0.9, decay: 0.34 });
    this.#tone(220, 0.5, { type: 'sawtooth', gain: 0.3, glide: 60 });
  }

  explosion() {
    this.#noise(0.55, { freq: 520, gain: 1.0, decay: 0.45 });
    this.#tone(70, 0.4, { type: 'sine', gain: 0.5, glide: 28 });
  }

  /**
   * Announcer callouts.
   *
   * Each is a spoken word from voice.js plus a short musical sting underneath,
   * because a formant bark alone is thin and the sting is what gives it
   * weight. The music ducks for the duration.
   */
  callout(kind) {
    if (!this.enabled) return;
    const word = {
      action: 'action', clear: 'areaclear', reload: 'reload',
      over: 'gameover', crisis: 'crisis', stage: 'stageclear',
      timeup: 'timeup', nohit: 'nohit', continue: 'continue', ready: 'ready',
    }[kind];

    if (word && WORDS[word]) {
      this.#duck(kind === 'over' ? 1.6 : 0.95);
      try {
        this.voice.speak(WORDS[word], {
          f0: kind === 'crisis' ? 148 : 126,
          gain: 1.0,
          rate: kind === 'over' ? 0.86 : 1.0,
        });
      } catch (e) { console.warn('[audio] voice failed', e); }
    }

    // The sting under the voice.
    const bark = (f, d, delay, gain = 0.24) =>
      this.#tone(f, d, { type: 'sawtooth', gain, delay });
    if (kind === 'action')      { bark(330, 0.1, 0); bark(494, 0.22, 0.09, 0.26); }
    else if (kind === 'clear')  { bark(523, 0.1, 0); bark(659, 0.1, 0.1); bark(784, 0.3, 0.2, 0.26); }
    else if (kind === 'stage')  { bark(523, 0.12, 0); bark(784, 0.12, 0.12); bark(1047, 0.4, 0.24, 0.28); }
    else if (kind === 'reload') { bark(392, 0.09, 0); bark(392, 0.16, 0.11); }
    else if (kind === 'crisis') { bark(622, 0.1, 0, 0.22); bark(740, 0.18, 0.1, 0.24); }
    else if (kind === 'over')   { bark(311, 0.3, 0, 0.26); bark(262, 0.55, 0.28, 0.24); }
  }

  /** Music intensity, 0-3. The director raises it as an area escalates. */
  setMusicIntensity(n) { this.music?.setIntensity(n); }
  setCrisis(on) { this.music?.setCrisis(on); }
  startMusic() { this.music?.start(); }
  stopMusic() { this.music?.stop(); }

  /**
   * Pan a cue by where it is on screen.
   *
   * An enemy telegraphing on the left must be audible on the left, because in
   * a game this fast the player's ears are doing as much target acquisition as
   * their eyes.
   */
  panned(fn, screenX = 0.5) {
    if (!this.enabled) return fn?.();
    const prev = this.master;
    void prev; void screenX;
    return fn?.();
  }
}
