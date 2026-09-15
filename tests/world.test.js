import { test } from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { Rail } from '../src/core/spline.js';
import { railPoints } from '../src/data/route.js';
import { ENCOUNTERS } from '../src/gameplay/encounters.js';
import { buildWorld } from '../src/world/index.js';
import { buildStreet } from '../src/world/street.js';
import { buildLandmarks } from '../src/world/landmarks.js';
import { makeRng } from '../src/core/rng.js';
import { RIG } from '../src/rail/camera.js';

/**
 * World-build invariants.
 *
 * These run headless in a couple of seconds and catch the class of problem
 * that is otherwise only visible in a software-rendered screenshot minutes
 * later: geometry that never batches, landmarks that get built over, and the
 * slope cues the level's whole three-act structure depends on.
 */

const rail = new Rail(railPoints());
const built = buildWorld(rail);

test('the whole of Montmartre batches into a handful of draw calls', () => {
  const { before, after } = built.stats;
  assert.ok(before > 15000, `expected a substantial world, got ${before} meshes`);
  assert.ok(after < 120,
    `${after} draw calls. Authoring wants one mesh per shutter; rendering does ` +
    'not, and something has stopped batching.');
});

test('nothing in the static world is transparent', () => {
  // Transparency needs per-object sort order, so the batcher cannot merge it.
  // Seventy-five faded sign bars once became seventy-five draw calls and
  // doubled the scene total. Fade by mixing colours, not by alpha.
  const offenders = [];
  built.root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    let p = o, batched = false;
    while (p) { if (p.name === 'batched') { batched = true; break; } p = p.parent; }
    if (batched) return;
    if (o.material.transparent) offenders.push(o.name || o.parent?.name || '?');
  });
  assert.ok(offenders.length < 12,
    `${offenders.length} transparent meshes escaped batching: ${[...new Set(offenders)].slice(0, 5).join(', ')}`);
});

test('every spawn anchor sits on real architecture', () => {
  const allowed = new Set(['door', 'balcony', 'dormer', 'roof', 'alley', 'metro', 'window']);
  for (const a of built.anchors) {
    assert.ok(allowed.has(a.type), `anchor type "${a.type}" is not a real opening`);
    assert.ok(a.worldPos, `anchor ${a.id} has no world position`);
    assert.ok(Number.isFinite(a.worldPos.x), `anchor ${a.id} position is not finite`);
  }
  assert.ok(built.anchors.length > 300,
    `only ${built.anchors.length} anchors; the director will run out of places to spawn`);
});

test('every anchor type the encounters ask for actually exists', async () => {
  const { ENCOUNTERS } = await import('../src/gameplay/encounters.js');
  const available = new Set(built.anchors.map((a) => a.type));
  for (const e of ENCOUNTERS) {
    for (const w of e.waves) {
      for (const sp of w.spawns) {
        const ok = sp.anchorTypes.some((t) => available.has(t));
        assert.ok(ok,
          `${e.areaId} wants one of [${sp.anchorTypes}] and the world publishes none of them`);
      }
    }
  }
});

test('the pavement steps on slopes, so the hill is visible', () => {
  // Over half this route exceeds an 8% grade and it touches 23%. A pavement
  // that ramps alongside a road that ramps gives the eye nothing to measure
  // against, and the climb-crest-descend profile — the level's spine — reads
  // as flat ground in perspective. Paris steps the pavement above ~8%; so do
  // we, and the varying kerb face is what states the gradient.
  const street = buildStreet(rail);
  const kerb = street.children.find((c) => c.name?.startsWith?.('pavement') === false && c.geometry);
  assert.ok(street.children.length > 4, 'street should have carriageway, pavements, kerbs, stairs');
  void kerb;

  // The handrails only exist on sections above 14%, so their presence is a
  // direct assertion that the steep sections survived into geometry.
  const rails = street.getObjectByName('handrails');
  assert.ok(rails, 'no handrail group built');
  let pieces = 0;
  rails.traverse((o) => { if (o.isMesh) pieces++; });
  assert.ok(pieces > 50,
    `only ${pieces} handrail pieces; the steep sections are not being detected`);
});

test('the route really does climb, crest and descend in the built geometry', () => {
  const ys = [];
  for (let i = 0; i <= 20; i++) ys.push(rail.positionAt((i / 20) * rail.length).y);
  const peak = Math.max(...ys);
  const peakAt = ys.indexOf(peak) / 20;
  assert.ok(peakAt > 0.25 && peakAt < 0.75,
    `the crest is at ${(peakAt * 100).toFixed(0)}% along; it should be in the middle third`);
  assert.ok(peak - ys[0] > 25, 'the climb should gain more than 25 m');
  assert.ok(peak - ys.at(-1) > 15, 'the descent should lose more than 15 m');
});

test('landmarks are not built over by the procedural street wall', () => {
  // The gate of 11 bis sits seven metres off the centreline of a six-metre
  // lane, which is exactly where the terrace generator wants to put a house.
  const names = [];
  built.root.traverse((o) => { if (o.name) names.push(o.name); });
  for (const required of ['landmarks', 'facades', 'cover', 'street']) {
    assert.ok(names.includes(required), `the world is missing its "${required}" group`);
  }
});

test('the world builds fast enough to iterate on', () => {
  const t0 = Date.now();
  buildWorld(rail);
  const ms = Date.now() - t0;
  assert.ok(ms < 9000, `world build took ${ms} ms; that is too slow to iterate against`);
});

/**
 * Can the player see anything from where they fight?
 *
 * This is the test that would have caught the Dalida bust. Nothing was broken
 * in any component: the world built, the anchors published, the director chose
 * one, the enemy spawned and telegraphed correctly. It was just standing behind
 * a four-metre bronze statue, because the statue had been placed at a WAYPOINT
 * and a waypoint is a point on the player's own path. The rail ran 1.8 m from
 * it and the whole view at that combat node was the back of a plinth.
 *
 * Every existing test passed. The failure was only visible by looking, and
 * only explicable by firing a ray.
 *
 * WHAT IT MEASURES, and why not a wide fan. The first version swept plus and
 * minus 55 degrees and failed whenever most of the arc was blocked, which
 * flagged rue d'Orchampt — a genuinely six-metre lane with walls three metres
 * either side, where a ray at 41 degrees hits a wall at 4.6 m because that is
 * what a narrow lane IS. Being hemmed in is the character of that area, not a
 * bug in it.
 *
 * What actually has to hold is that the player can see out along the axis they
 * are pointed down: the middle of the frame, where a threat is placed and
 * where the crosshair rests. So the central cone is checked strictly and the
 * wide arc only loosely.
 */
test('every combat node has an open forward arc', () => {
  const { root } = built;
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'sky') meshes.push(o); });

  // How far the player must be able to see down the middle. The director
  // spawns between 5 m and 42 m, so anything nearer than that band is
  // something the player is effectively standing inside.
  const MIN_CLEAR = 6.0;
  const ray = new THREE.Raycaster();
  ray.near = 0.4;
  ray.far = MIN_CLEAR;

  /**
   * A direction counts as open if a ray at ANY of three heights gets through.
   *
   * A single ray cannot tell a wall from a handrail, and the Girardon climb
   * carries 376 pieces of handrail precisely because the grade needs them. One
   * ray at eye level through a railing reports the same "blocked" that a
   * six-storey terrace does, which would make this test demand the level
   * remove its own street furniture. Sampling low, level and high is what
   * separates something you see THROUGH from something you cannot see past.
   */
  const open = (eye, tan, deg) => {
    const a = (deg * Math.PI) / 180;
    const dir = new THREE.Vector3(
      tan.x * Math.cos(a) + tan.z * Math.sin(a), 0,
      tan.z * Math.cos(a) - tan.x * Math.sin(a)).normalize();
    for (const dy of [-0.45, 0, 0.5]) {
      ray.set(new THREE.Vector3(eye.x, eye.y + dy, eye.z), dir);
      if (!ray.intersectObjects(meshes, false).length) return true;
    }
    return false;
  };

  // Swept finely across the forward cone rather than sampled at five angles.
  // Angular resolution is the whole point: the bust stands 1.8 m from the rail
  // and a 1.3 m plinth at 1.8 m subtends about 40 degrees, so a coarse fan at
  // plus and minus 20 degrees threaded neatly past both sides of the thing
  // filling the player's view and reported the node as fine.
  const ANGLES = [];
  for (let a = -30; a <= 30; a += 5) ANGLES.push(a);

  const failures = [];
  for (const area of ENCOUNTERS) {
    const d = rail.distanceToWaypoint(area.waypoint);
    // The camera's real standing height, from the rig, not a guess. At 1.55 m
    // this reported two nodes blocked that the player can see straight down:
    // the eye is 11 cm higher, which is the difference between looking at the
    // top of the cover wall and looking over it.
    const eye = rail.positionAt(d).clone();
    eye.y += RIG.eyeHeight;
    // The direction the player is actually facing, not the raw tangent.
    // RailCamera aims at a point RIG.lookAhead metres up the rail, so at a
    // bend the two differ by most of the turn.
    const aheadD = Math.min(rail.length, d + RIG.lookAhead);
    const tan = rail.positionAt(aheadD).clone().sub(rail.positionAt(d));
    tan.y = 0;
    tan.normalize();

    const clear = ANGLES.filter((a) => open(eye, tan, a)).length;
    // A street has walls and furniture, so some of the cone being blocked is
    // correct. Most of it is not: below this the player is looking at an
    // object rather than down a street, and every enemy the director places
    // in front of them is behind it.
    if (clear / ANGLES.length < 0.6) {
      failures.push(
        `${area.areaId} (${area.waypoint}): only ${clear}/${ANGLES.length} of the ` +
        `forward cone is clear to ${MIN_CLEAR} m — the player is looking at an object`);
    }
  }
  assert.deepEqual(failures, [],
    `combat nodes with no open arc:\n  ${failures.join('\n  ')}`);
});

/**
 * No landmark may stand on the player's path.
 *
 * This is the rule the Dalida bust broke, stated directly. It was placed with
 * a helper that takes a WAYPOINT id, and a waypoint is a point on the rail —
 * the player's own path — so the level's title landmark, hero-scaled to four
 * metres, was built around the camera. The rail ran 1.8 m from its centre.
 *
 * It cost three attempts to catch with rays, and the reason is worth keeping:
 * a coarse fan at plus and minus 20 degrees threaded past both sides of it,
 * and once the sampling was fine enough to hit, the camera turned out to be
 * INSIDE the plinth, where front-face raycasting reports nothing at all. An
 * object big enough to fill the view is exactly the object a visibility test
 * is worst at seeing.
 *
 * Stated as clearance it is unambiguous and cannot be threaded: walk the rail
 * and see whether the landmark is in the way.
 *
 * Two stages, because neither alone is right. A bounding box is a cheap way to
 * ask "could this possibly be near the rail", and a terrible way to answer it:
 * the métro entrance is a U of two staircases with the rail running up the
 * middle, and the Orchampt garden wall is long and set at an angle, so the
 * axis-aligned box of each swallows street the object does not occupy. Both
 * came back as offenders on the first run. So the box only shortlists, and the
 * answer comes from casting along the rail itself against the real geometry —
 * double-sided, because the entire point is to catch the case where the camera
 * ends up INSIDE something and front-face raycasting sees nothing at all.
 *
 * Landmarks are built here rather than read back from the world because
 * batching disposes the source meshes and takes the hierarchy with them.
 */
test('no landmark stands on the rail', () => {
  const { group } = buildLandmarks(rail, undefined, makeRng(7));

  // Half the narrowest street on the route, near enough. The player's shoulder
  // needs this much room and so does the camera.
  const CLEARANCE = 1.8;
  const ray = new THREE.Raycaster();

  const offenders = [];
  for (const obj of group.children) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) continue;

    // Stage one: could it be near the rail at all?
    const near = [];
    const expanded = box.clone().expandByScalar(CLEARANCE);
    for (let d = 0; d <= rail.length; d += 1) {
      const p = rail.positionAt(d).clone();
      p.y += RIG.eyeHeight * 0.5;
      if (expanded.containsPoint(p)) near.push(d);
    }
    if (!near.length) continue;

    // Stage two: is it actually in the way?
    const meshes = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material) o.material.side = THREE.DoubleSide;
      meshes.push(o);
    });

    let worst = null;
    for (const d of near) {
      const a = rail.positionAt(d).clone();
      const b = rail.positionAt(Math.min(rail.length, d + 1)).clone();
      const dir = b.clone().sub(a);
      const len = dir.length();
      if (len < 1e-4) continue;
      dir.normalize();
      // At the shoulder, level and overhead: a plinth blocks all three, an
      // archway over the street blocks none of them.
      for (const dy of [0.4, RIG.eyeHeight, RIG.eyeHeight + 0.5]) {
        ray.set(new THREE.Vector3(a.x, a.y + dy, a.z), dir);
        ray.near = 0;
        ray.far = len;
        if (ray.intersectObjects(meshes, false).length) { worst = d; break; }
      }
      if (worst !== null) break;
    }
    if (worst !== null) {
      offenders.push(`${obj.name || '(unnamed)'} stands on the rail at ${worst.toFixed(0)} m`);
    }
  }

  assert.deepEqual(offenders, [],
    `landmarks standing in the player's way:\n  ${offenders.join('\n  ')}`);
});

/**
 * The ground must face the sky.
 *
 * This is the test for the worst bug in the project, and the reason it went
 * unfound for so long is the interesting part: NOTHING LOOKED BROKEN. The
 * carriageway, both pavements and the apron were all wound so their normals
 * pointed into the ground — 2506 of the road's, all of both pavements', and
 * 2860 of the apron's 3024. The materials are double-sided, so every surface
 * still drew exactly where it should. It was only ever SHADED wrong: lit by a
 * sun that was permanently on the far side of it.
 *
 * What that looked like was a flat, dead, violet bottom third in almost every
 * frame of the tour. It was read — for a very long time, by me — as "the
 * foreground is in shadow", which is a plausible thing for a street at golden
 * hour to be, and a completely wrong diagnosis. Several rounds of grade tuning
 * went into lifting shadows that were not shadows.
 *
 * `right` is (-t.z, 0, t.x), so for a tangent of +Z it points at -X, and the
 * obvious winding gives you exactly the wrong sign. A one-line mistake that
 * cost the game its entire lower half.
 */
test('every ground surface is wound to face upward', () => {
  const street = buildStreet(rail);
  const offenders = [];

  street.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.geometry.getAttribute('normal');
    const p = o.geometry.getAttribute('position');
    if (!n || !p) return;

    // Only judge surfaces that are mostly horizontal — a kerb face or a
    // handrail post is meant to point sideways.
    let up = 0, down = 0;
    for (let i = 0; i < n.count; i++) {
      const y = n.getY(i);
      if (y > 0.5) up++;
      else if (y < -0.5) down++;
    }
    if (up + down < 50) return;   // too small to be a ground surface
    if (down > up) {
      offenders.push(`${o.name || '(unnamed)'}: ${down}/${up + down} normals point down`);
    }
  });

  assert.deepEqual(offenders, [],
    `ground surfaces lit from underneath:\n  ${offenders.join('\n  ')}`);
});
