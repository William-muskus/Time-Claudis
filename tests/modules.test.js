import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every source module must actually parse.
 *
 * This sounds too trivial to test until it costs you three renders. A single
 * backtick inside a GLSL comment — written as prose, inside a `/* glsl *\/`
 * template literal — terminated the string and broke the build. Nothing caught
 * it: the test suite never imports the renderer (it has no GPU to talk to),
 * and `tests/materials.test.js` reads that file as TEXT rather than importing
 * it, so the syntax error sat there while three separate verification renders
 * quietly screenshotted a stale bundle.
 *
 * Importing every module is the cheapest possible guard against that whole
 * class of problem, and it also catches circular imports and missing exports.
 */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk('src');

test('every source module parses and imports cleanly', async () => {
  assert.ok(files.length > 15, `only found ${files.length} modules; is the walk broken?`);
  const failures = [];
  for (const f of files) {
    try {
      await import(join(process.cwd(), f));
    } catch (e) {
      // A module that needs a DOM or WebGL is allowed to fail at RUNTIME, but
      // never to fail at PARSE time. Distinguish the two.
      const msg = String(e?.message ?? e);
      // The allowed set is browser globals only, named explicitly. A generic
      // "not defined" match would swallow a real missing import.
      const isEnvironmental =
        /\b(document|window|navigator|location|self|performance|requestAnimationFrame|HTMLCanvasElement|Image|AudioContext)\b is not defined/i.test(msg) ||
        /WebGL|canvas|is not a constructor.*Audio/i.test(msg);
      if (!isEnvironmental) failures.push(`${relative('.', f)}: ${msg}`);
    }
  }
  assert.deepEqual(failures, [], `modules failed to load:\n  ${failures.join('\n  ')}`);
});

test('no backtick appears inside a shader template literal', () => {
  // The specific trap: prose inside a GLSL comment. A backtick there closes
  // the JS template literal and the file stops parsing, usually many lines
  // later and with a baffling message.
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Find each /* glsl */` ... ` block and check its interior.
    const re = /\/\* glsl \*\/`/g;
    let m;
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length;
      const end = src.indexOf('`', start);
      if (end < 0) { offenders.push(`${relative('.', f)}: unterminated shader literal`); break; }
      const body = src.slice(start, end);
      if (body.includes('`')) offenders.push(`${relative('.', f)}: backtick inside a shader`);
      re.lastIndex = end + 1;
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the built bundle is not stale', () => {
  // A build that fails leaves the previous dist in place, so a verification
  // render happily screenshots code that no longer exists. Compare the newest
  // source mtime against the bundle's.
  let newestSrc = 0;
  for (const f of files) newestSrc = Math.max(newestSrc, statSync(f).mtimeMs);

  let dist;
  try { dist = readdirSync('dist/assets').filter((f) => f.endsWith('.js')); }
  catch { return; }   // nothing built yet is not a failure
  if (!dist.length) return;

  const newestBuild = Math.max(...dist.map((f) => statSync(join('dist/assets', f)).mtimeMs));
  const staleBy = (newestSrc - newestBuild) / 1000;
  assert.ok(staleBy < 300,
    `dist is ${Math.round(staleBy)}s older than the newest source file. ` +
    'A failed build leaves the old bundle in place and renders screenshot code that is gone.');
});
