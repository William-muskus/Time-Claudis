import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAYPOINTS, LANDMARKS, AREAS, geoToLocal, localToGeo, railPoints, ORIGIN } from '../src/data/route.js';
import { Rail } from '../src/core/spline.js';
import { ENCOUNTERS } from '../src/gameplay/encounters.js';
import { ENEMY_TYPES } from '../src/gameplay/enemyTypes.js';
import { WEAPONS } from '../src/gameplay/weapons.js';

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
  // East-SOUTH-east. The old assertion allowed 60 m of north-south drift and
  // called that "roughly level along the street", which quietly permitted the
  // error it was supposed to catch: the house was modelled 58 m from the bust
  // when the street is 133 m long. Distance is the real constraint, and it is
  // a cited figure, so assert that instead.
  const along = Math.hypot(p.x, p.z);
  assert.ok(along > 110 && along < 150,
    `rue de l'Abreuvoir is cited at 133 m; the Maison Rose sits at its far ` +
    `corner with rue des Saules, so it must be about that far from the bust. ` +
    `Got ${along.toFixed(0)} m.`);
  assert.ok(p.x > Math.abs(p.z), 'the street runs more east than south');
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
    // Derived from the enemy table rather than a hardcoded list, so adding a
    // new gating class (the boss, for instance) cannot silently fail this.
    const hasGatingEnemy = last.spawns.some((s) => ENEMY_TYPES[s.type]?.gates);
    assert.ok(hasGatingEnemy,
      `${e.areaId}'s gate wave must contain an enemy whose type gates the area`);
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


test('every spawn names an enemy type that exists', () => {
  for (const e of ENCOUNTERS) {
    for (const w of e.waves) {
      for (const s of w.spawns) {
        assert.ok(ENEMY_TYPES[s.type], `${e.areaId} spawns unknown enemy "${s.type}"`);
      }
    }
  }
});

test('weapon carriers name weapons that exist, and there are not too many', () => {
  const carriers = [];
  for (const e of ENCOUNTERS) {
    for (const w of e.waves) {
      for (const s of w.spawns) {
        if (s.carries) carriers.push({ area: e.areaId, weapon: s.carries });
      }
    }
  }
  for (const c of carriers) {
    assert.ok(WEAPONS[c.weapon], `${c.area} carries unknown weapon "${c.weapon}"`);
    assert.notEqual(c.weapon, 'HANDGUN', 'the handgun is never a pickup; you always have it');
  }
  // One pickup per area at most. More than that and the handgun stops being
  // the weapon the game is actually balanced around.
  const perArea = {};
  for (const c of carriers) perArea[c.area] = (perArea[c.area] ?? 0) + 1;
  for (const [area, n] of Object.entries(perArea)) {
    assert.ok(n <= 1, `${area} has ${n} pickups; at most one per area`);
  }
});

test('the stage ends on a boss', () => {
  const last = ENCOUNTERS.at(-1);
  const hasBoss = last.waves.some((w) => w.spawns.some((s) => ENEMY_TYPES[s.type]?.boss));
  assert.ok(hasBoss, 'the final area must end on a boss');
  // And no earlier area may, or it is not a boss.
  for (const e of ENCOUNTERS.slice(0, -1)) {
    const early = e.waves.some((w) => w.spawns.some((s) => ENEMY_TYPES[s.type]?.boss));
    assert.ok(!early, `${e.areaId} spawns a boss before the final area`);
  }
});

/**
 * The cited figures, asserted.
 *
 * Every number here came from a source recorded in docs/ROUTE.md rather than
 * from anyone's sense of the place, and each one replaced an estimate that was
 * wrong by 20-75 m. Pinning them stops a future "tidy-up" quietly undoing the
 * re-survey, which is exactly how the first version drifted: the old test for
 * the Maison Rose allowed 60 m of slack and so permitted the 75 m error it
 * existed to catch.
 *
 * Tolerances are wide on purpose. They are not precision claims — they are the
 * width of the band outside which the model would be telling a different story
 * about the place.
 */
test('the survey agrees with its cited sources', () => {
  const at = (id) => {
    const w = WAYPOINTS.find((x) => x.id === id) ?? LANDMARKS.find((x) => x.id === id);
    if (!w) throw new Error(`no such place: ${id}`);
    return geoToLocal(w.lat, w.lon, w.elev);
  };
  const apart = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z);

  const checks = [
    // Two metro stations, both cited to six decimal places.
    ['lamarck_station', 'place_abbesses', 479, 15,
      'metro to metro, the span of the whole level'],
    // Rue de l'Abreuvoir is cited at 133 m along its curve; the straight line
    // between its ends is necessarily a little less, and the bust and the
    // house are both cited, so this is a genuine closure check on the survey.
    ['place_dalida', 'maison_rose', 133, 18,
      "rue de l'Abreuvoir, the most photographed sightline on the route"],
    // Bust and mill are both cited. Was modelled at 126 m.
    ['place_dalida', 'moulin_blutefin', 150, 15,
      'the climb from the square to the crest'],
    // Bust and Bateau-Lavoir both cited.
    ['place_dalida', 'emile_goudeau', 282, 20,
      'the length of the descent through Orchampt and Ravignan'],
    // Both newly cited, and both replaced estimates that were badly out.
    // Saint-Jean was 80 m north-east of itself — most of a block up the wrong
    // street — which is the largest single positional error the survey had
    // left. The closure is against the Guimard edicule, which is cited, so
    // this checks the correction rather than merely recording it.
    ['place_abbesses', 'st_jean', 101, 18,
      'the length of place des Abbesses, edicule to church door'],
    // The Passe-Muraille was 55 m out, up the street and across it. Closed
    // against the Blute-fin because both sit on the crest and the pair fixes
    // where rue Girardon meets rue Norvins.
    ['marcel_ayme', 'moulin_blutefin', 70, 15,
      'the crest: Girardon at Norvins to the mill'],
  ];

  for (const [a, b, want, tol, why] of checks) {
    const got = apart(a, b);
    assert.ok(Math.abs(got - want) <= tol,
      `${a} to ${b} is ${got.toFixed(0)} m; cited sources put it at ~${want} m ` +
      `(+/- ${tol}). ${why}.`);
  }
});

test('every place records where its coordinate came from', () => {
  // A survey that cannot say which of its numbers are sourced is a survey
  // nobody can improve: the next person has no way to tell a cited coordinate
  // from a guess, so they either trust all of it or none of it.
  const ALLOWED = new Set(['cited', 'derived', 'est']);
  const bad = [...WAYPOINTS, ...LANDMARKS].filter((w) => !ALLOWED.has(w.src));
  assert.deepEqual(bad.map((w) => w.id), [],
    `every waypoint and landmark needs src: one of ${[...ALLOWED].join(', ')}`);

  // And the traverse has to be carried by real anchors, not by one lucky point.
  const cited = [...WAYPOINTS, ...LANDMARKS].filter((w) => w.src === 'cited');
  assert.ok(cited.length >= 5,
    `only ${cited.length} cited anchors; the interpolated points between them ` +
    `have nothing to close against`);
  for (const id of ['lamarck_station', 'place_dalida', 'place_abbesses']) {
    assert.equal(WAYPOINTS.find((w) => w.id === id).src, 'cited',
      `${id} anchors an end or the origin of the traverse and must be cited`);
  }
});

test("Place Emile-Goudeau is a terrace, not a plaza", () => {
  // Cited at 43 m long and 7 m wide. It was modelled at 18 m wide, which made
  // the tightest space on the route more than twice as open as the street that
  // feeds it — and it is the area the game builds its close-quarters fight in.
  const sq = WAYPOINTS.find((w) => w.id === 'emile_goudeau');
  assert.ok(sq.width <= 9,
    `place Emile-Goudeau is cited at 7 m wide, got ${sq.width} m`);
  const lane = WAYPOINTS.find((w) => w.id === 'orchampt_ravignan');
  assert.ok(sq.width <= lane.width + 3,
    'the square is barely wider than the lane that arrives at it');
});
