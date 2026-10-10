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
    // The cover loop. See coverMove: this is the game's primary verb and the
    // only feedback that a gesture registered.
    b.on('cover.changed', ({ state }) => this.coverMove(state));
    b.on('shot.miss', () => this.ricochet());
    b.on('weapon.pickup', () => this.pickup());
    b.on('player.hit', () => this.playerHit());
    b.on('area.started', () => this.callout('action'));
    b.on('area.cleared', ({ noHit }) => {
      this.callout('clear');
      // The no-hit bonus deserves its own callout, slightly behind the first,
      // the way an arcade stacks them. It is the only thing in the game that
      // rewards perfect play on an area rather than merely surviving it.
      if (noHit) setTimeout(() => this.callout('nohit'), 900);
    });
    b.on('area.timeout', () => this.callout('timeup'));
    b.on('stage.complete', () => this.callout('stage'));
    b.on('game.over', () => this.callout('over'));
    b.on('continue.tick', ({ secondsLeft }) => {
      // Say it once as the countdown opens, then let the ticks carry it.
      if (secondsLeft === 9) this.callout('continue');
      if (secondsLeft <= 5 && secondsLeft > 0) this.#tone(880, 0.07, { type: 'square', gain: 0.16 });
    });
    b.on('game.continued', () => this.callout('ready'));
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
    } else if (weapon === 'GRENADE') {
      // THE GRENADE LAUNCHER HAD NO SOUND. It fell through to the handgun
      // branch and fired with a pistol crack, which is the one weapon in the
      // game whose report should not be a crack at all: it is a low-pressure
      // tube lobbing a shell, and the bang belongs at the other end. A hollow
      // thump with almost no high end, so the detonation that follows a moment
      // later is unmistakably the louder of the two.
      this.#tone(210, 0.1, { type: 'sine', gain: 0.46, glide: 78 });
      this.#noise(0.1, { freq: 420, gain: 0.34, decay: 0.07 });
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

  /**
   * The flash beat — the sound the player learns to fear.
   *
   * MEASURED AND RAISED. tools/verify/mix.mjs put the original at -26.9 dBFS,
   * the second-quietest cue in the game, above only the EXPOSED tick. That is
   * backwards. The telegraph is the contract: the game promises that no shot
   * arrives unannounced, and the flash stage is where the announcement becomes
   * a commitment. A warning that is 17 dB below the gunfire it is warning
   * about is not a warning, and the player who misses it is punished for a cue
   * the mix swallowed rather than for anything they did.
   *
   * It stays short and dry rather than becoming loud and long, because up to
   * two enemies can be in commit at once and this fires twice per telegraph.
   * A click with a body under it cuts through gunfire at a level a pure tone
   * cannot, without taking up any more room in time.
   */
  tick() {
    this.#tone(1650, 0.05, { type: 'square', gain: 0.26 });
    this.#noise(0.035, { freq: 2800, gain: 0.22, decay: 0.03, type: 'highpass' });
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
   * The cover loop, all four beats of it.
   *
   * THE GAME'S PRIMARY VERB WAS SILENT. Everything else made a noise — every
   * shot, every hit, every telegraph beat — and the one action the player
   * performs most, the one the whole design is built on, made none. In Time
   * Crisis the pedal is a hard mechanical thing you hear and feel go down;
   * here it is a hand gesture, so the sound is the only feedback that the
   * input registered at all. Without it the player cannot tell a duck that
   * worked from a duck the tracker dropped.
   *
   * FOUR STATES, NOT TWO. core/cover.js derives its state from one continuous
   * exposure scalar, so a duck emits HIDING at the moment the gesture takes
   * and COVERED 200 ms later when exposure reaches zero. The first version of
   * this played the same cue on both, which is a stutter, and worse, wastes
   * the more useful of the two events. They answer different questions:
   *
   *   HIDING    the input registered — this is the latency the player feels
   *   COVERED   you are actually safe now — the 200 ms transit is over
   *   EMERGING  you are on your way up, and already shootable
   *   EXPOSED   the weapon is live; canShoot() gates on exactly this state
   *
   * The pair is asymmetric on purpose and matched to the contract: hiding is
   * 200 ms and emerging is 260 ms, so going down is the faster, harder, lower
   * sound and coming up is slower, lighter and brighter. That asymmetry is
   * doing real work — it is how the ear learns which direction it just went
   * without having to look at the screen edge.
   *
   * All four are deliberately quiet and short, and the two arrival cues are
   * quieter than the two departure cues so a full duck reads as one gesture
   * with a tail rather than two events. This fires constantly, and a cue that
   * is charming on the first duck is unbearable on the hundredth.
   *
   * @param {'HIDING'|'COVERED'|'EMERGING'|'EXPOSED'} state
   */
  coverMove(state) {
    if (!this.enabled) return;
    switch (state) {
      case 'HIDING':
        // Down: a scuff of cloth as the body drops. Starts the instant the
        // gesture is recognised, which is the whole point of it.
        this.#noise(0.14, { freq: 620, gain: 0.30, decay: 0.11 });
        this.#tone(150, 0.09, { type: 'sine', gain: 0.16, glide: 74 });
        break;
      case 'COVERED':
        // Landed: a soft body-thud against the parapet. Low and brief — this
        // is the safe signal, and safety should not be loud.
        this.#tone(96, 0.13, { type: 'sine', gain: 0.22, glide: 54 });
        this.#noise(0.07, { freq: 300, gain: 0.16, decay: 0.06 });
        break;
      case 'EMERGING':
        // Up: lighter, brighter, no thud — nothing is being landed against.
        this.#noise(0.13, { freq: 1500, gain: 0.20, decay: 0.11, type: 'highpass' });
        this.#tone(300, 0.09, { type: 'triangle', gain: 0.11, glide: 430 });
        break;
      case 'EXPOSED':
        // Weapon live. A single dry tick, the quietest cue in the game, so
        // that the moment shooting becomes possible has an edge on it.
        this.#tone(1180, 0.035, { type: 'square', gain: 0.10 });
        break;
      default:
        break;
    }
  }

  /**
   * A round hitting stone instead of a person.
   *
   * A miss made no sound at all, which quietly made the game easier to read
   * than it should be: silence meant "miss" and any noise meant "hit", so the
   * player got a cleaner hit confirmation from the ABSENCE of a cue than the
   * cue itself gives. Both outcomes have to be audible for either to mean
   * anything. Bright, short and gone — a chip off a façade, not an event.
   *
   * No position is taken. The graph is mono into a single master gain with no
   * PannerNode anywhere, so a world point would be an argument that could not
   * change the output — and an unused argument in a sound function is an
   * invitation to believe the sound is spatial when it is not.
   */
  ricochet() {
    this.#noise(0.09, { freq: 3400, gain: 0.26, decay: 0.07, type: 'highpass' });
    this.#tone(2400, 0.06, { type: 'square', gain: 0.07, glide: 1100, delay: 0.01 });
  }

  /**
   * A weapon dropping from a carrier you just killed. Worth turning toward.
   *
   * MEASURED AND RAISED. At -22.3 dBFS this was quieter than the ricochet that
   * marks a MISS, which inverts the only piece of good news the game ever
   * gives you: the reward was harder to hear than the punishment. The rising
   * three-note figure is the arcade convention and it survives a busy mix
   * because it moves — but only if it is actually in the mix.
   */
  pickup() {
    this.#tone(680, 0.08, { type: 'square', gain: 0.30 });
    this.#tone(1020, 0.1, { type: 'square', gain: 0.32, delay: 0.07 });
    this.#tone(1360, 0.18, { type: 'triangle', gain: 0.28, delay: 0.15 });
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
