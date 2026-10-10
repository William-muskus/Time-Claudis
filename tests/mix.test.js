import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ctx, measure } from '../tools/verify/mixdown.mjs';

/**
 * The mix has to have a shape, and the shape has to say the right thing.
 *
 * WHY THIS EXISTS. Every sound in src/audio is a handful of numbers, and a
 * number that is 12 dB wrong is invisible in a diff and obvious in one second
 * of listening — a second nobody had spent on this game. The first run of
 * tools/verify/mix.mjs found three cues in the wrong order and one weapon
 * with no sound at all:
 *
 *   - the telegraph flash, the beat that tells you a shot is COMMITTED, was
 *     the second-quietest thing in the game at -26.9 dBFS;
 *   - the weapon pickup, the only good news the game gives you, was quieter
 *     than the ricochet that marks a miss;
 *   - the grenade launcher fell through to the handgun branch and fired with
 *     a pistol crack.
 *
 * None of that is a crash, a warning, or a failing assertion anywhere else.
 * It is a mix that tells the player the wrong story, forever, silently.
 *
 * These assertions are ORDERING assertions, not absolute levels, because the
 * harness sums sources as if perfectly in phase and treats filters as unity
 * gain (see tools/verify/mixdown.mjs). Relative numbers are trustworthy;
 * absolute ones are an upper bound. So nothing here pins a cue to a value —
 * every one of them pins a cue relative to another cue, which is the thing
 * the design actually cares about.
 */

globalThis.window = { AudioContext: Ctx };
const { Announcer } = await import('../src/audio/announcer.js');
const { VoiceSynth } = await import('../src/audio/voice.js');

const bus = { on() {}, emit() {} };

/** Peak amplitude of one cue, in the announcer's own graph. */
function peak(fire) {
  return measure((ctx) => {
    const a = new Announcer(bus);
    a.ctx = ctx;
    a.master = ctx.createGain();
    a.master.gain.value = 0.45;
    a.enabled = true;
    a.voiceBus = ctx.createGain(); a.voiceBus.connect(a.master);
    a.musicBus = ctx.createGain(); a.musicBus.gain.value = 0.55; a.musicBus.connect(a.master);
    a.voice = new VoiceSynth(ctx, a.voiceBus);
    fire(a);
    return a;
  }).peak;
}

const cue = {
  detonation: peak((a) => a.explosion()),
  playerHit:  peak((a) => a.playerHit()),
  shotgun:    peak((a) => a.gunshot('SHOTGUN')),
  handgun:    peak((a) => a.gunshot('HANDGUN')),
  mg:         peak((a) => a.gunshot('MACHINE_GUN')),
  grenade:    peak((a) => a.gunshot('GRENADE')),
  enemyShot:  peak((a) => a.enemyShot()),
  telegraph:  peak((a) => a.tick()),
  pickup:     peak((a) => a.pickup()),
  miss:       peak((a) => a.ricochet()),
  reload:     peak((a) => a.reloadClack()),
  hiding:     peak((a) => a.coverMove('HIDING')),
  covered:    peak((a) => a.coverMove('COVERED')),
  emerging:   peak((a) => a.coverMove('EMERGING')),
  exposed:    peak((a) => a.coverMove('EXPOSED')),
  callout:    peak((a) => a.callout('action')),
};

const dB = (a, b) => 20 * Math.log10(a / b);

test('every cue makes a sound at all', () => {
  const silent = Object.entries(cue).filter(([, v]) => v <= 0.001).map(([k]) => k);
  assert.deepEqual(silent, [], `these cues produce nothing audible: ${silent.join(', ')}`);
});

test('the telegraph flash is not buried', () => {
  // The whole fairness contract of the game is that no shot arrives
  // unannounced. A warning below the noise floor of the fight it is warning
  // about does not discharge that promise. It need not beat the gunfire — it
  // is a tick, not an alarm — but it has to sit above the incidental layer.
  assert.ok(cue.telegraph > cue.miss,
    `the commit warning (${cue.telegraph.toFixed(3)}) is quieter than a ricochet (${cue.miss.toFixed(3)})`);
  assert.ok(dB(cue.enemyShot, cue.telegraph) < 6,
    `the enemy's shot is ${dB(cue.enemyShot, cue.telegraph).toFixed(1)} dB over its own warning`);
});

test('the reward is louder than the miss', () => {
  // A pickup is the only unambiguously good thing that happens. If a miss is
  // easier to hear than a reward, the mix is scolding and never praising.
  assert.ok(cue.pickup > cue.miss,
    `pickup ${cue.pickup.toFixed(3)} is not above a miss ${cue.miss.toFixed(3)}`);
});

test('being hit is among the loudest things in the game', () => {
  // Losing life is the only event with a permanent cost. Exactly one cue is
  // allowed to be louder — the grenade detonation, which is usually the
  // player's own and is a physically bigger event than a bullet.
  const louder = Object.entries(cue)
    .filter(([k, v]) => v > cue.playerHit && k !== 'playerHit' && k !== 'detonation')
    .map(([k]) => k);
  assert.deepEqual(louder, [],
    `these are louder than taking a hit: ${louder.join(', ')}`);
});

test('every weapon sounds like itself', () => {
  // A weapon that falls through to another weapon's branch is a silent bug:
  // it makes a sound, just the wrong one. The grenade launcher did exactly
  // this for the whole project. Distinct peaks are a weak proxy for distinct
  // sounds, but they catch the fall-through, which is the failure that
  // actually happens.
  const shots = { shotgun: cue.shotgun, handgun: cue.handgun, mg: cue.mg, grenade: cue.grenade };
  const seen = new Map();
  for (const [name, v] of Object.entries(shots)) {
    const key = v.toFixed(4);
    assert.ok(!seen.has(key),
      `${name} and ${seen.get(key)} produce an identical peak — one is falling ` +
      `through to the other's branch in gunshot()`);
    seen.set(key, name);
  }
});

test('the cover cues stay under the fight', () => {
  // Cover fires more often than anything else in the game. It has to be
  // audible and it must never be an event — a cue that is charming on the
  // first duck is unbearable on the hundredth.
  for (const k of ['hiding', 'covered', 'emerging', 'exposed']) {
    assert.ok(cue[k] < cue.handgun,
      `the ${k} cue is as loud as a gunshot`);
    assert.ok(cue[k] > 0.02, `the ${k} cue is inaudible`);
  }
  // Down is harder than up: the duck is 200 ms and the rise is 260 ms, and
  // that asymmetry is how the ear learns which way it just went.
  assert.ok(cue.hiding > cue.emerging,
    'going into cover should be the harder of the two transitions');
});

test('a callout cuts through', () => {
  // The announcer ducks the music to make room; it also has to be over the
  // top of the SFX layer, or the duck is just a hole in the mix.
  assert.ok(cue.callout > cue.enemyShot,
    `a callout (${cue.callout.toFixed(3)}) does not clear the SFX layer`);
});
