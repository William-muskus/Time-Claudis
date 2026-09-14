import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORDS } from '../src/audio/voice.js';

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
