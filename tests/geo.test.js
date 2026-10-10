import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GEO, groundAt, pairs } from '../src/world/geo.js';
import { insetRing } from '../src/world/realbuildings.js';
import { ORIGIN, FRAME, railPoints } from '../src/data/route.js';
import { Rail } from '../src/core/spline.js';

/**
 * The real-data pipeline: tools/geo/build.py → src/data/geo/montmartre.json.
 *
 * Everything in the world now stands on this file, so a mistake in it is a
 * mistake everywhere at once — a frame offset puts every wall in the street,
 * a flipped winding turns every roof inside out. These pin the contract.
 */

test('the dataset and the survey share one frame', () => {
  // build.py converts with its own copy of the constants; route.js converts
  // the waypoints with these. A metre of disagreement is a metre of every
  // building standing in the road.
  assert.deepEqual(GEO.origin, { lat: ORIGIN.lat, lon: ORIGIN.lon, elev: ORIGIN.elev });
  const py = readFileSync(join(process.cwd(), 'tools/geo/build.py'), 'utf8');
  assert.ok(py.includes(`M_LAT = ${FRAME.M_PER_DEG_LAT.toFixed(1)}`), 'build.py M_LAT differs from route.js');
  assert.ok(py.includes(`M_LON = ${FRAME.M_PER_DEG_LON.toFixed(1)}`), 'build.py M_LON differs from route.js');
});

test('the corridor holds the real city', () => {
  assert.ok(GEO.buildings.length > 900, `${GEO.buildings.length} buildings`);
  assert.ok(GEO.trees.length > 500, `${GEO.trees.length} trees`);
  assert.ok(GEO.roads.length > 100, `${GEO.roads.length} street segments`);
  assert.equal(GEO.pois.metro.length, 2, 'both métro entrances');
  assert.ok(GEO.pois.wallace.length >= 2, 'the Wallace fountains');
});

test('every footprint is wound counter-clockwise from above', () => {
  // The facade builder's outward normal, the roof inset and the street-wall
  // test in build.py all assume this. The first version of build.py had both
  // normals flipped: every roof would have grown outward and every "does this
  // wall face a street?" probe fired into its own building.
  const bad = [];
  for (const b of GEO.buildings) {
    const r = pairs(b.o);
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length];
      a += x1 * z2 - x2 * z1;
    }
    if (a >= 0) bad.push(b.id);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} footprints wound the wrong way`);
});

test('buildings have height and every roof inset is buildable', () => {
  const flat = [], spikes = [];
  for (const b of GEO.buildings) {
    if (!(b.e > b.g + 2)) flat.push(b.id);
    if (b.i > 0 && !insetRing(pairs(b.o), b.i)) spikes.push(b.id);
  }
  assert.deepEqual(flat.slice(0, 5), [], `${flat.length} buildings under two metres tall`);
  assert.deepEqual(spikes.slice(0, 5), [],
    `${spikes.length} roofs whose inset the runtime cannot build (build.py and realbuildings.js disagree)`);
});

test('the terrain is under the whole walk and agrees with it', () => {
  // Off the stairs the rail's elevation comes from this same terrain, through
  // a spline; on the stairs it is deliberately made uniform. Either way the
  // ground and the walk must agree to within a step or two, or the street
  // floats over a ditch or sinks into a bank.
  const rail = new Rail(railPoints());
  const worst = { d: 0, err: 0 };
  for (let d = 0; d <= rail.length; d += 2) {
    const p = rail.positionAt(d);
    const g = groundAt(p.x, p.z);
    assert.ok(g !== null, `no terrain under the rail at ${d} m`);
    const err = Math.abs(g - p.y);
    if (err > worst.err) Object.assign(worst, { d, err });
  }
  assert.ok(worst.err < 2.6, `the walk and the terrain disagree by ${worst.err.toFixed(2)} m at ${worst.d} m`);
});
