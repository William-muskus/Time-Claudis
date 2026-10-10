/**
 * The mix, ranked. See mixdown.mjs for what the numbers mean and do not mean.
 *
 * Run: npm run mix
 */
import { Ctx, measure } from './mixdown.mjs';

globalThis.window = { AudioContext: Ctx };
const { Announcer } = await import('../../src/audio/announcer.js');
const { VoiceSynth } = await import('../../src/audio/voice.js');

/** A no-op bus: this harness fires methods directly, not events. */
const bus = { on() {}, emit() {} };

/**
 * IMPORTANCE ORDER, decided before looking at a single measurement.
 *
 * This is the claim the mix is being held to. Top of the list is what the
 * player must never miss; bottom is texture. If the measured loudness order
 * disagrees badly with this, the mix is telling the player the wrong story
 * and one of the two lists is wrong — which is a decision, not a bug report.
 */
const CUES = [
  ['player.hit',      'playerHit',    (a) => a.playerHit()],
  ['enemy.detonated', 'explosion',    (a) => a.explosion()],
  ['shot.fired MG',   'gunshot',      (a) => a.gunshot('MACHINE_GUN')],
  ['shot.fired GL',   'gunshot',      (a) => a.gunshot('GRENADE')],
  ['shot.fired SG',   'gunshot',      (a) => a.gunshot('SHOTGUN')],
  ['shot.fired pistol', 'gunshot',    (a) => a.gunshot('HANDGUN')],
  ['enemy.fired',     'enemyShot',    (a) => a.enemyShot()],
  ['shot.hit head',   'impact',       (a) => a.impact('head', true)],
  ['shot.hit body',   'impact',       (a) => a.impact('body', false)],
  ['weapon.pickup',   'pickup',       (a) => a.pickup()],
  ['weapon.reloaded', 'reloadClack',  (a) => a.reloadClack()],
  ['cover HIDING',    'coverMove',    (a) => a.coverMove('HIDING')],
  ['cover COVERED',   'coverMove',    (a) => a.coverMove('COVERED')],
  ['cover EMERGING',  'coverMove',    (a) => a.coverMove('EMERGING')],
  ['cover EXPOSED',   'coverMove',    (a) => a.coverMove('EXPOSED')],
  ['shot.miss',       'ricochet',     (a) => a.ricochet()],
  ['telegraph flash', 'tick',         (a) => a.tick()],
  ['callout ACTION',  'callout',      (a) => a.callout('action')],
  ['callout CLEAR',   'callout',      (a) => a.callout('clear')],
  ['callout OVER',    'callout',      (a) => a.callout('over')],
];

const db = (x) => (x <= 0 ? -Infinity : 20 * Math.log10(x));
const rows = [];

for (const [name, method, fire] of CUES) {
  const r = measure((ctx) => {
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
  });
  rows.push({ name, method, ...r });
}

rows.sort((x, y) => y.peak - x.peak);
const w = Math.max(...rows.map((r) => r.name.length));
console.log('cue'.padEnd(w), ' peak    dBFS   len    energy  srcs');
for (const r of rows) {
  console.log(
    r.name.padEnd(w),
    r.peak.toFixed(3).padStart(6),
    db(r.peak).toFixed(1).padStart(6),
    `${(r.tail * 1000).toFixed(0)}ms`.padStart(7),
    r.area.toFixed(4).padStart(8),
    String(r.sources).padStart(5),
  );
}
