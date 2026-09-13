import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAYPOINTS, LANDMARKS, AREAS, geoToLocal, localToGeo, railPoints, ORIGIN } from '../src/data/route.js';
import { Rail } from '../src/core/spline.js';
import { ENCOUNTERS } from '../src/gameplay/encounters.js';

/**
 * These tests pin the TOPOLOGY of the walk, not its coordinates.
 *
 * docs/CONSTRAINTS.md §2 is explicit that the absolute positions carry about
 * ±15 m of error and that someone with Overpass access should replace them.
 * What must survive that replacement is the shape of the route: the order of
 * the streets, which way you turn, whether you are climbing, and which side
 * each landmark sits on. If a future coordinate fix reverses a turn or flattens
 * the crest, these fail — which is the whole point.
 */

const byId = Object.fromEntries(WAYPOINTS.map((w) => [w.id, w]));

test('the walk visits the brief\'s required places in order', () => {
  const ids = WAYPOINTS.map((w) => w.id);
  const required = ['lamarck_station', 'place_dalida', 'maison_dalida', 'place_abbesses'];
  const positions = required.map((r) => ids.indexOf(r));
  assert.ok(positions.every((p) => p >= 0), 'every required landmark must be on the route');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1],
      `${required[i]} must come after ${required[i - 1]}`);
  }
});

test('the route starts at Lamarck-Caulaincourt and ends at Abbesses', () => {
  assert.equal(WAYPOINTS[0].id, 'lamarck_station');
  assert.equal(WAYPOINTS.at(-1).id, 'place_abbesses');
});

test('the elevation profile climbs to a crest then descends', () => {
  const start = byId.lamarck_station.elev;
  const crest = byId.moulin_galette.elev;
  const end = byId.place_abbesses.elev;
  assert.ok(crest > start + 30, `crest ${crest} must be well above the station ${start}`);
  assert.ok(crest > end + 20, `crest ${crest} must be well above Abbesses ${end}`);
  assert.ok(end > start, 'Abbesses sits higher than the station');
  // The Butte's summit is 130 m; nothing on this route may exceed it.
  assert.ok(Math.max(...WAYPOINTS.map((w) => w.elev)) <= 130,
    'no waypoint may be higher than the summit of the Butte');
});

test('the climb is monotonic up to the crest', () => {
  const crestIndex = WAYPOINTS.findIndex((w) => w.id === 'moulin_galette');
  for (let i = 1; i <= crestIndex; i++) {
    assert.ok(WAYPOINTS[i].elev >= WAYPOINTS[i - 1].elev,
      `${WAYPOINTS[i].id} must not dip below ${WAYPOINTS[i - 1].id} on the way up`);
  }
});

test('the descent to Abbesses is monotonic after the crest', () => {
  const crestIndex = WAYPOINTS.findIndex((w) => w.id === 'moulin_galette');
  for (let i = crestIndex + 1; i < WAYPOINTS.length; i++) {
    assert.ok(WAYPOINTS[i].elev <= WAYPOINTS[i - 1].elev,
      `${WAYPOINTS[i].id} must not rise above ${WAYPOINTS[i - 1].id} on the way down`);
  }
});

test('the walk is southbound overall', () => {
  // Abbesses is south of Lamarck-Caulaincourt, so latitude must decrease.
  assert.ok(byId.place_abbesses.lat < byId.lamarck_station.lat);
  // And in the local frame, +Z is south, so Z must increase.
  const a = geoToLocal(byId.lamarck_station.lat, byId.lamarck_station.lon);
  const b = geoToLocal(byId.place_abbesses.lat, byId.place_abbesses.lon);
  assert.ok(b.z > a.z, 'the route must run in the +Z (south) direction');
});

test('the origin is the Dalida bust, and it is the local zero', () => {
  const d = geoToLocal(byId.place_dalida.lat, byId.place_dalida.lon, byId.place_dalida.elev);
  assert.ok(Math.abs(d.x) < 0.001 && Math.abs(d.y) < 0.001 && Math.abs(d.z) < 0.001,
    'Place Dalida must be exactly the origin of the local frame');
  assert.equal(ORIGIN.lat, byId.place_dalida.lat);
});

test('geoToLocal and localToGeo round-trip', () => {
  for (const w of WAYPOINTS) {
    const l = geoToLocal(w.lat, w.lon, w.elev);
    const g = localToGeo(l.x, l.y, l.z);
    assert.ok(Math.abs(g.lat - w.lat) < 1e-9, `${w.id} latitude round-trip`);
    assert.ok(Math.abs(g.lon - w.lon) < 1e-9, `${w.id} longitude round-trip`);
    assert.ok(Math.abs(g.elev - w.elev) < 1e-6, `${w.id} elevation round-trip`);
  }
});

test('La Maison Rose is east of Place Dalida, down rue de l\'Abreuvoir', () => {
  // The sightline from the bust down l'Abreuvoir toward the Maison Rose is the
  // single most photographed view on the route. It must point east.
  const rose = LANDMARKS.find((l) => l.id === 'maison_rose');
  const p = geoToLocal(rose.lat, rose.lon, rose.elev);
  assert.ok(p.x > 20, `Maison Rose must be well east of the bust, got x=${p.x.toFixed(1)}`);
  assert.ok(Math.abs(p.z) < 60, 'and roughly level with it along the street');
});

test('Sacre-Coeur is east of the route and at the summit', () => {
  const sc = LANDMARKS.find((l) => l.id === 'sacre_coeur');
  const p = geoToLocal(sc.lat, sc.lon, sc.elev);
  assert.ok(p.x > 250, 'the basilica is several hundred metres east');
  assert.equal(sc.elev, 130, 'and sits on the 130 m summit');
});

test('the route is a walkable length with no teleports between waypoints', () => {
  const pts = railPoints();
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    assert.ok(d > 3, `${pts[i].id} is implausibly close to ${pts[i - 1].id} (${d.toFixed(1)} m)`);
    assert.ok(d < 140, `${pts[i].id} is implausibly far from ${pts[i - 1].id} (${d.toFixed(1)} m)`);
  }
});

test('the whole walk is a plausible distance for these two stations', () => {
  const rail = new Rail(railPoints());
  // Real walking distance between these métro stops via Place Dalida is
  // roughly 700 m. Anything wildly outside that means a coordinate is wrong.
  assert.ok(rail.length > 500 && rail.length < 950,
    `rail length ${rail.length.toFixed(0)} m is outside the plausible band`);
});

test('every street has a usable width', () => {
  for (const w of WAYPOINTS) {
    assert.ok(w.width >= 5 && w.width <= 30, `${w.id} width ${w.width} m is implausible`);
  }
  // The squares are the widest points and the lane is the narrowest.
  assert.ok(byId.place_abbesses.width > byId.maison_dalida.width,
    'Place des Abbesses must be wider than rue d\'Orchampt');
  assert.ok(byId.place_dalida.width > byId.maison_dalida.width);
});

test('every area references a waypoint that exists', () => {
  for (const a of AREAS) {
    assert.ok(byId[a.from], `area ${a.id} 'from' waypoint ${a.from} missing`);
    assert.ok(byId[a.to], `area ${a.id} 'to' waypoint ${a.to} missing`);
  }
});

test('every encounter is anchored to a real waypoint and is reachable', () => {
  const rail = new Rail(railPoints());
  let previous = -1;
  for (const e of ENCOUNTERS) {
    assert.ok(byId[e.waypoint], `encounter ${e.areaId} names unknown waypoint ${e.waypoint}`);
    const d = rail.distanceToWaypoint(e.waypoint);
    assert.ok(d >= 0 && d <= rail.length, `${e.areaId} sits off the rail`);
    assert.ok(d > previous, `${e.areaId} must come after the previous area on the rail`);
    previous = d;
  }
});

test('areas and encounters agree, one for one and in order', () => {
  assert.equal(AREAS.length, ENCOUNTERS.length, 'every area needs exactly one encounter');
  for (let i = 0; i < AREAS.length; i++) {
    assert.equal(AREAS[i].id, ENCOUNTERS[i].areaId,
      `area ${i} id mismatch: ${AREAS[i].id} vs ${ENCOUNTERS[i].areaId}`);
  }
});

test('every area ends with a gating wave, or it cannot be cleared', () => {
  for (const e of ENCOUNTERS) {
    const gating = e.waves.filter((w) => w.gate);
    assert.ok(gating.length >= 1, `${e.areaId} has no gating wave`);
    const last = e.waves.at(-1);
    assert.ok(last.gate, `${e.areaId}'s final wave must be the gate`);
    const hasGatingEnemy = last.spawns.some((s) => s.type === 'RED' || s.type === 'HEAVY');
    assert.ok(hasGatingEnemy, `${e.areaId}'s gate wave must contain a RED or HEAVY`);
  }
});

test('waves are scheduled in order and fit inside the area par time', () => {
  for (let i = 0; i < ENCOUNTERS.length; i++) {
    const e = ENCOUNTERS[i];
    const par = AREAS[i].par;
    let prev = -1;
    for (const w of e.waves) {
      assert.ok(w.at > prev, `${e.areaId} wave at ${w.at}s is out of order`);
      prev = w.at;
      assert.ok(w.at < par, `${e.areaId} wave at ${w.at}s fires after par (${par}s)`);
    }
  }
});
