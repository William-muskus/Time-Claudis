import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAYPOINTS, LANDMARKS, AREAS, geoToLocal, localToGeo, railPoints, ORIGIN } from '../src/data/route.js';
import { Rail } from '../src/core/spline.js';
import { ENCOUNTERS } from '../src/gameplay/encounters.js';
import { ENEMY_TYPES } from '../src/gameplay/enemyTypes.js';
import { WEAPONS } from '../src/gameplay/weapons.js';
import { insideBuilding } from '../src/world/geo.js';

/**
 * These tests pin the TOPOLOGY of the walk, not its coordinates.
 *
 * The positions were re-derived from IGN and OpenStreetMap in October 2026
 * (see src/data/route.js), and the tests below now pin them against those
 * sources. What must survive any future correction is the shape of the
 * route: the order of the streets, which way you turn, whether you are
 * climbing, and which side each landmark sits on.
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
  // Measured by IGN RGE ALTI: the Pierre-Dac landing at 85 m, the crest on
  // rue Girardon by Place Marcel-Aymé at about 111, Place des Abbesses at 82.
  // The old survey had 92, 128 and 100 — the crest was put at the Moulin's
  // mound rather than the street, and everything sat ~20 m too high.
  const start = byId.lamarck_station.elev;
  const end = byId.place_abbesses.elev;
  const crest = Math.max(...WAYPOINTS.map((w) => w.elev));
  assert.ok(crest > start + 20, `crest ${crest} must be well above the station ${start}`);
  assert.ok(crest > end + 25, `crest ${crest} must be well above Abbesses ${end}`);
  assert.ok(end < start, 'Place des Abbesses sits below the Lamarck landing (82 m against 85)');
  const crestId = WAYPOINTS.find((w) => w.elev === crest).id;
  const order = WAYPOINTS.map((w) => w.id);
  assert.ok(order.indexOf(crestId) > order.indexOf('place_dalida') &&
            order.indexOf(crestId) < order.indexOf('lepic_orchampt'),
    `the crest (${crestId}) must be on rue Girardon between Place Dalida and rue Lepic`);
  assert.ok(crest <= 130, 'no waypoint may be higher than the summit of the Butte');
});

// A 2.5 m terrain grid carries a couple of decimetres of noise; a level square
// reading 20 cm "uphill" is the model, not the street.
const NOISE = 0.4;
const crestIndex = () => {
  const top = Math.max(...WAYPOINTS.map((w) => w.elev));
  return WAYPOINTS.findIndex((w) => w.elev === top);
};

test('the climb is monotonic up to the crest', () => {
  for (let i = 1; i <= crestIndex(); i++) {
    assert.ok(WAYPOINTS[i].elev >= WAYPOINTS[i - 1].elev - NOISE,
      `${WAYPOINTS[i].id} must not dip below ${WAYPOINTS[i - 1].id} on the way up`);
  }
});

test('the descent to Abbesses is monotonic after the crest', () => {
  for (let i = crestIndex() + 1; i < WAYPOINTS.length; i++) {
    assert.ok(WAYPOINTS[i].elev <= WAYPOINTS[i - 1].elev + NOISE,
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
  const bust = LANDMARKS.find((l) => l.id === 'dalida_bust');
  const d = geoToLocal(bust.lat, bust.lon);
  assert.ok(Math.abs(d.x) < 0.001 && Math.abs(d.z) < 0.001,
    'the Dalida bust must be exactly the origin of the local frame');
  // The waypoint is beside her, on the path, not on top of her.
  const w = geoToLocal(byId.place_dalida.lat, byId.place_dalida.lon);
  const off = Math.hypot(w.x, w.z);
  assert.ok(off > 2.5 && off < 7, `the Place Dalida waypoint is ${off.toFixed(1)} m from the bust`);
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
  // Three and a half metres is not a typo: the top of rue d'Orchampt is four
  // metres wall to wall, measured from the cadastral footprints.
  for (const w of WAYPOINTS) {
    assert.ok(w.width >= 3.5 && w.width <= 30, `${w.id} width ${w.width} m is implausible`);
  }
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
test('the survey agrees with its independent sources', () => {
  const at = (id) => {
    const w = WAYPOINTS.find((x) => x.id === id) ?? LANDMARKS.find((x) => x.id === id);
    if (!w) throw new Error(`no such place: ${id}`);
    return geoToLocal(w.lat, w.lon, w.elev);
  };
  const apart = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z);

  // [a, b, metres, tolerance, why]. Each pair crosses two sources, so a
  // closure here is a check, not a restatement.
  const checks = [
    // OSM's two métro entrances against IGN's two station points (BD TOPO
    // equipement_de_transport), which put them 594 m apart.
    ['lamarck_station', 'edicule_abbesses', 594, 12, 'station to station, the span of the level'],
    // Paris street nomenclature: rue de l'Abreuvoir is 133 m along its curve.
    ['dalida_bust', 'maison_rose', 133, 12, "rue de l'Abreuvoir, the sightline the bust faces"],
    // The walk passes the things it is named for.
    ['lamarck_station', 'metro_lamarck', 0, 3, 'the game opens at the real entrance'],
    ['place_abbesses', 'edicule_abbesses', 0, 25, 'the game ends at the édicule'],
    ['moulin_galette', 'moulin_radet', 0, 16, 'the Lepic corner is the Radet corner'],
  ];
  // The Bateau-Lavoir's footprint runs thirty metres back down the slope
  // behind the square, so its centroid says little. Its FRONT is the far
  // side of the planted terrace — about twenty metres across, per the
  // cadastre and the city's tree records, not the seven-metre lane the old
  // model made of it. Walk from the walk toward it: its wall within 26 m.
  {
    const bl = at('bateau_lavoir'), sq = at('emile_goudeau');
    const dx = bl.x - sq.x, dz = bl.z - sq.z, l = Math.hypot(dx, dz);
    let hit = null;
    for (let k = 0; k <= 26 && hit === null; k += 0.5) {
      if (insideBuilding(sq.x + dx / l * k, sq.z + dz / l * k)) hit = k;
    }
    assert.ok(hit !== null, 'the Bateau-Lavoir does not front Place Emile-Goudeau');
  }
  // 11 bis: the waypoint is on the lane, the landmark is the house.
  const house = LANDMARKS.find((l) => l.id === 'maison_dalida');
  const hp = geoToLocal(house.lat, house.lon), wp = at('maison_dalida');
  assert.ok(Math.hypot(hp.x - wp.x, hp.z - wp.z) < 14, '11 bis is beside the lane');
  for (const [a, b, want, tol, why] of checks) {
    const got = apart(a, b);
    assert.ok(Math.abs(got - want) <= tol,
      `${a} to ${b} is ${got.toFixed(0)} m; expected ~${want} m (+/- ${tol}). ${why}.`);
  }
});

test('the two windmills are the right way round', () => {
  // The previous survey had the Blute-fin's coordinate on the Radet. IGN
  // classifies both as "Moulin à vent", and the difference is unmistakable in
  // the data: the Blute-fin stands on its mound, seven metres above the
  // street the Radet's restaurant stands on, sixty metres further west.
  const blute = LANDMARKS.find((l) => l.id === 'moulin_blutefin');
  const radet = LANDMARKS.find((l) => l.id === 'moulin_radet');
  assert.ok(blute.elev - radet.elev > 5, 'the Blute-fin is on its mound, above the Radet');
  const b = geoToLocal(blute.lat, blute.lon), r = geoToLocal(radet.lat, radet.lon);
  assert.ok(b.x < r.x - 40, 'the Blute-fin is west of the Radet, along rue Lepic');
});

test('every place records where its coordinate came from', () => {
  // A survey that cannot say which of its numbers are sourced is a survey
  // nobody can improve.
  const ALLOWED = new Set(['surveyed', 'cited', 'derived', 'est']);
  const bad = [...WAYPOINTS, ...LANDMARKS].filter((w) => !ALLOWED.has(w.src));
  assert.deepEqual(bad.map((w) => w.id), [],
    `every waypoint and landmark needs src: one of ${[...ALLOWED].join(', ')}`);
  // Every point of the walk is on real street geometry now, and nothing on
  // the route is a guess any more.
  const off = WAYPOINTS.filter((w) => w.src !== 'surveyed').map((w) => w.id);
  assert.deepEqual(off, [], `waypoints not placed on surveyed geometry: ${off.join(', ')}`);
  const guesses = [...WAYPOINTS, ...LANDMARKS].filter((w) => w.src === 'est').map((w) => w.id);
  assert.deepEqual(guesses, [], `still estimated: ${guesses.join(', ')}`);
});

test("Place Emile-Goudeau is a terrace beside the Bateau-Lavoir", () => {
  // Paris nomenclature gives the place 7 m of "width", which is the figure for
  // the roadway along its east side — the line the walk takes. The space
  // itself, per the cadastre and the OSM pedestrian area, is a sloping
  // terrace of horse chestnuts about twenty metres across, with the
  // Bateau-Lavoir on its far side. What must hold is that it slopes.
  const sq = byId.emile_goudeau;
  assert.ok(byId.orchampt_ravignan.elev - byId.ravignan_stairs.elev > 5,
    'the square falls several metres from the lane to the steps');
  assert.ok(sq.width <= 14, `place Emile-Goudeau reads as ${sq.width} m wide`);
});
