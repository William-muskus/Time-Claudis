import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Material invariants.
 *
 * A physically-based metal has no diffuse term: it is entirely reflection. So
 * a high-metalness surface with nothing to reflect renders BLACK regardless of
 * how many lights are aimed at it. That is exactly what made the first-person
 * weapon invisible, and it was quietly darkening the Guimard ironwork, the
 * Dalida bronze and both Wallace fountains at the same time.
 *
 * The failure has no error and no warning — the object is simply dark — so it
 * is worth pinning both halves of the fix: an environment probe must exist,
 * and no material may be so metallic that it depends on the probe completely.
 */

const SRC = (p) => readFileSync(join(process.cwd(), p), 'utf8');

test('the renderer builds a sky environment probe', () => {
  const renderer = SRC('src/render/renderer.js');
  assert.match(renderer, /buildSkyEnvironment/,
    'the renderer must bake an environment map, or every metal goes black');
  assert.match(renderer, /this\.scene\.environment\s*=/,
    'the probe must actually be assigned to the scene');
});

test('the viewmodel scene gets the environment probe too', () => {
  const renderer = SRC('src/render/renderer.js');
  assert.match(renderer, /viewModel\.scene\.environment\s*=/,
    'the weapon lives in its own scene and needs its own environment assignment');
});

test('the environment probe is built from our own sky, not an external HDRI', () => {
  const sky = SRC('src/render/sky.js');
  assert.match(sky, /PMREMGenerator/);
  assert.match(sky, /fromScene/,
    'the probe must be rendered from the sky dome so reflections match the scene lighting');
  // An external HDRI would also be blocked by this environment's network policy.
  assert.ok(!/RGBELoader|\.hdr['"]/.test(sky),
    'no external HDRI: the reflections must come from the game\'s own sky');
});

test('no weapon material is metallic enough to vanish without a probe', () => {
  const weapons = SRC('tools/blender/weapons.py');
  const metallics = [...weapons.matchAll(/metallic=([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(metallics.length > 0, 'expected weapon materials to declare metalness');
  for (const m of metallics) {
    assert.ok(m <= 0.6,
      `metalness ${m} is high enough that the material depends entirely on an ` +
      'environment probe and will render black if one fails to build');
  }
});

test('scene metals stay in the same safe band', () => {
  const palette = SRC('src/render/palette.js');
  const metallics = [...palette.matchAll(/metalness:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  for (const m of metallics) {
    assert.ok(m <= 0.95, `metalness ${m} in the palette defaults is implausible`);
  }
});

test('the flat material helper defaults to non-metallic', () => {
  // Most of Montmartre is plaster and limestone. A metallic default would be
  // wrong for almost every surface in the game and dark for all of them.
  const palette = SRC('src/render/palette.js');
  assert.match(palette, /metalness:\s*opts\.metalness\s*\?\?\s*0(\.0)?\b/,
    'flat() must default metalness to zero');
});

test('the muzzle flash is unlit and untonemapped, or it cannot bloom', () => {
  const vm = SRC('src/render/viewmodel.js');
  const flashBlock = vm.slice(vm.indexOf('muzzle flash'), vm.indexOf('animation state'));
  assert.match(flashBlock, /MeshBasicMaterial/,
    'the flash must be unlit — a lit flash is dimmer than the thing it is lighting');
  assert.match(flashBlock, /toneMapped:\s*false/,
    'tone mapping would roll the flash off below the bloom threshold');
  assert.match(flashBlock, /AdditiveBlending/);
});
