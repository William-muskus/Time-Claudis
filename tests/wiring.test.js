import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORDS } from '../src/audio/voice.js';
import { CoverState } from '../src/core/cover.js';

/**
 * Wiring invariants.
 *
 * The event bus deliberately decouples gameplay from audio and the HUD, which
 * is what makes an arcade game retunable — but the cost of that decoupling is
 * that a publisher with no subscriber fails silently, and so does a subscriber
 * listening for an event nobody emits. Four synthesised announcer words sat
 * fully implemented and unreachable for exactly that reason.
 *
 * These are source-level checks rather than runtime ones because the failure
 * is structural: the code is correct, it is simply never called.
 */

const src = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const announcer = src('src/audio/announcer.js');
const hud = src('src/ui/hud.js');
const game = src('src/gameplay/game.js');
const director = src('src/gameplay/director.js');
const main = src('src/main.js');
const weapons = src('src/gameplay/weapons.js');

test('every synthesised word can actually be spoken', () => {
  const table = announcer.slice(announcer.indexOf('const word = {'), announcer.indexOf('}[kind]'));
  const reachable = new Set([...table.matchAll(/'(\w+)'/g)].map((m) => m[1]));
  const orphans = Object.keys(WORDS).filter((w) => !reachable.has(w));
  assert.deepEqual(orphans, [],
    `these words are implemented and unreachable: ${orphans.join(', ')}`);
});

test('every callout kind is triggered by something', () => {
  const kinds = new Set([...announcer.matchAll(/callout\('(\w+)'\)/g)].map((m) => m[1]));
  for (const m of main.matchAll(/callout\('(\w+)'\)/g)) kinds.add(m[1]);

  const table = announcer.slice(announcer.indexOf('const word = {'), announcer.indexOf('}[kind]'));
  const declared = [...table.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  const never = declared.filter((k) => !kinds.has(k));
  assert.deepEqual(never, [],
    `these callout kinds are declared and never fired: ${never.join(', ')}`);
});

test('every event the HUD listens for is emitted by somebody', () => {
  const listened = [...hud.matchAll(/bus\.on\('([\w.]+)'/g)].map((m) => m[1]);
  const emitted = new Set();
  for (const file of [game, director, main, announcer, weapons]) {
    for (const m of file.matchAll(/emit\('([\w.]+)'/g)) emitted.add(m[1]);
  }
  // The HUD emits one of its own for the count-up animation.
  emitted.add('ui.countFinished');
  const orphans = listened.filter((e) => !emitted.has(e));
  assert.deepEqual(orphans, [],
    `the HUD waits for events nothing emits: ${orphans.join(', ')}`);
});

test('every event the announcer listens for is emitted by somebody', () => {
  const listened = [...announcer.matchAll(/b\.on\('([\w.]+)'/g)].map((m) => m[1]);
  const emitted = new Set();
  for (const file of [game, director, main, weapons]) {
    for (const m of file.matchAll(/emit\('([\w.]+)'/g)) emitted.add(m[1]);
  }
  const orphans = listened.filter((e) => !emitted.has(e));
  assert.deepEqual(orphans, [],
    `the announcer waits for events nothing emits: ${orphans.join(', ')}`);
});

test('the canonical event list in the architecture doc matches reality', () => {
  const doc = src('docs/ARCHITECTURE.md');
  const documented = [...doc.matchAll(/^([a-z]+\.[a-zA-Z]+)\s{2,}/gm)].map((m) => m[1]);
  assert.ok(documented.length > 8, `only found ${documented.length} documented events`);
  const emitted = new Set();
  for (const file of [game, director, weapons, main]) {
    for (const m of file.matchAll(/emit\('([\w.]+)'/g)) emitted.add(m[1]);
  }
  const stale = documented.filter((e) => !emitted.has(e));
  assert.deepEqual(stale, [],
    `docs/ARCHITECTURE.md documents events that are never emitted: ${stale.join(', ')}`);
});

test('everything the HUD reads is present in the snapshot', () => {
  // snapshot() is the contract between gameplay and the HUD. A field the HUD
  // reads and gameplay never sets renders as "undefined" on screen.
  const snapBlock = game.slice(game.indexOf('snapshot() {'), game.length);
  const provided = new Set([...snapBlock.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]));
  const read = new Set([...hud.matchAll(/\bs\.(\w+)\b/g)].map((m) => m[1]));
  const missing = [...read].filter((k) => !provided.has(k));
  assert.deepEqual(missing, [],
    `the HUD reads snapshot fields that do not exist: ${missing.join(', ')}`);
});

/**
 * The other direction: an event that fires into nothing.
 *
 * The tests above catch a listener waiting for an event nobody sends. This
 * catches the opposite, which is the more expensive failure because it looks
 * like working code from both ends: gameplay dutifully announces something,
 * the bus dutifully delivers it to nobody, and the game is quietly missing a
 * cue that everybody assumed was there.
 *
 * That is exactly how `cover.changed` went unheard. Cover is the game's
 * primary verb — the Time Crisis pedal, mapped onto a hand gesture — and it
 * had been emitting correctly, with a full four-state payload, to an empty
 * room for the entire project. Nothing failed. Nothing warned. The duck simply
 * made no sound, and since the input is a gesture rather than a switch, that
 * silence was the difference between "I ducked" and "the tracker dropped me".
 *
 * Every event therefore has to be either consumed or explicitly excused here.
 * The allowlist is the point of the test: it costs one line and a reason, and
 * it turns "nobody noticed" into "somebody decided".
 */
const SILENT_BY_DESIGN = {
  // Diagnostic. Fires when the director exhausts its anchor passes, which is
  // a level-authoring problem, not something the player should be told about.
  'spawn.failed': 'director diagnostic, asserted in tests/gameplay.test.js',
  // The countdown reaching zero is already fully covered by game.over, which
  // fires on the same frame. A second cue would double the callout.
  'continue.expired': 'game.over covers the same moment',
  // Spawns are deliberately not announced: the telegraph is what tells the
  // player an enemy exists, and pre-announcing it would undercut the staging.
  'enemy.spawned': 'telegraph is the announcement; asserted in tests',
  // A hook on the score count-up, left for a future results-screen sequence.
  // Harmless, and cheaper to keep than to re-derive when that screen lands.
  'ui.countFinished': 'reserved hook for results-screen sequencing',
};

test('every event that is emitted is heard by somebody', () => {
  const emitters = ['src/gameplay/game.js', 'src/gameplay/director.js',
                    'src/gameplay/weapons.js', 'src/main.js', 'src/ui/hud.js'];
  const emitted = new Set();
  for (const f of emitters) {
    for (const m of src(f).matchAll(/emit\('([\w.]+)'/g)) emitted.add(m[1]);
  }

  // Listeners live in the announcer (as `b.on`) and the HUD (as `bus.on`).
  const heard = new Set();
  for (const f of ['src/audio/announcer.js', 'src/ui/hud.js', 'src/main.js']) {
    for (const m of src(f).matchAll(/\b\w+\.on\('([\w.]+)'/g)) heard.add(m[1]);
  }

  const unheard = [...emitted].filter((e) => !heard.has(e) && !(e in SILENT_BY_DESIGN)).sort();
  assert.deepEqual(unheard, [],
    `these events fire into nothing — give them a cue or list them in ` +
    `SILENT_BY_DESIGN with a reason: ${unheard.join(', ')}`);

  // And keep the allowlist honest in the other direction: an excuse for an
  // event that no longer exists is a comment pretending to be a decision.
  const stale = Object.keys(SILENT_BY_DESIGN).filter((e) => !emitted.has(e)).sort();
  assert.deepEqual(stale, [],
    `SILENT_BY_DESIGN excuses events nothing emits any more: ${stale.join(', ')}`);
});

/**
 * The cover cue has to answer all four states.
 *
 * core/cover.js derives its state from one continuous exposure scalar, so a
 * single duck emits HIDING and then COVERED 200 ms later, and a single rise
 * emits EMERGING and then EXPOSED. The first version of the cue collapsed
 * those four into two booleans and played the same sound on both halves of
 * each pair — a stutter, and it threw away the more useful event of the two.
 */
test('the cover cue handles every state the cover machine can produce', () => {
  const start = announcer.indexOf('coverMove(state) {');
  // lastIndexOf: `this.ricochet()` also appears up in #wire(), well before
  // coverMove, and slicing to that gives an empty string that passes nothing.
  const block = announcer.slice(start, announcer.lastIndexOf('ricochet() {'));
  assert.ok(block.length > 100, 'could not find coverMove in the announcer');
  for (const state of Object.keys(CoverState)) {
    assert.ok(block.includes(`case '${state}':`),
      `coverMove has no cue for the ${state} state`);
  }
});
