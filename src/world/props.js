import * as THREE from 'three';
import { insideBuilding, groundAt } from './geo.js';
import { streetAt } from './walkprofile.js';
import FACADES from '../data/geo/facades.json' with { type: 'json' };
import { PALETTE, flat } from '../render/palette.js';
import { EMPTY_REGISTRY } from './assets.js';

/**
 * Street furniture: lamps, plane trees, benches, bollards, Morris columns.
 *
 * These are what make the street feel inhabited, and in a rail shooter they do
 * double duty as the player's own cover and as the thing that breaks up a long
 * sightline so the level has rhythm rather than one continuous corridor.
 *
 * The lamp standards deserve a note: Paris street lamps on the Butte are the
 * fluted cast-iron kind with a single lantern on a swan neck, and at golden
 * hour they are unlit but catch the low sun on one side. They are placed at a
 * real 18-22 m spacing, which is close enough that the receding line of them
 * is a strong perspective cue up the hill.
 */
export function buildProps(rail, rng, assets = EMPTY_REGISTRY) {
  const group = new THREE.Group();
  group.name = 'props';

  // Lamps recorded from the survey photographs (facades.json "lamps"), at
  // the back of the pavement where the photograph has them; the 20 m rule
  // fills in elsewhere but keeps clear of them.
  const recordedAt = [];
  for (const L of FACADES.lamps ?? []) {
    let d;
    try { d = rail.distanceToWaypoint(L.at[0]) + (L.at[1] ?? 0); } catch { continue; }
    const side = L.side === 'left' ? -1 : 1;
    const p = rail.positionAt(d), tan = rail.tangentAt(d), sp = streetAt(rail, d);
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const off = sp.cen + (sp.half + (L.wall ? sp.pav[side] - 0.45 : 0.55)) * side;
    const lamp = buildStreetLamp();
    lamp.position.copy(p).addScaledVector(right, off);
    lamp.position.y = (groundAt(lamp.position.x, lamp.position.z) ?? p.y) + 0.14;
    lamp.rotation.y = Math.atan2(right.x * -side, right.z * -side);
    group.add(lamp);
    recordedAt.push(d);
  }
  const LAMP_SPACING = 20;
  for (let d = 8; d < rail.length - 8; d += LAMP_SPACING) {
    if (recordedAt.some((r) => Math.abs(r - d) < 15)) continue;
    const side = rng.chance(0.5) ? 1 : -1;
    const p = rail.positionAt(d);
    const tan = rail.tangentAt(d);
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const off = rail.widthAt(d) * 0.5 - 0.9;
    const lx = p.x + right.x * side * off, lz = p.z + right.z * side * off;
    // Against the cadastre a lamp at "half the street width" can land inside
    // a building on a lane that narrows; skip those rather than embed them.
    if (insideBuilding(lx, lz, 0.4)) continue;
    // Procedural, not the Blender model: that one is the swan-neck design with
    // an amber lantern, and the lamps on this route are lantern-on-post.
    const lamp = buildStreetLamp();
    lamp.position.copy(p).addScaledVector(right, side * off);
    lamp.position.y = p.y + 0.16;
    lamp.rotation.y = Math.atan2(right.x * -side, right.z * -side);
    group.add(lamp);
  }

  // Trees, benches, bollards and the Wallace fountains used to be scattered
  // here by rule. They are real now — the city's tree inventory and
  // OpenStreetMap's furniture, at their mapped positions — see realtrees.js.

  // One Morris column — the round green advertising drum. Unmistakably Paris,
  // and a perfect waist-high piece of cover.
  {
    const d = rail.length * 0.72;
    const p = rail.positionAt(d);
    const tan = rail.tangentAt(d);
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const off = rail.widthAt(d) * 0.5 - 0.9;
    if (!insideBuilding(p.x + right.x * off, p.z + right.z * off, 0.8)) {
      const col = assets.instance('morris_column') ?? buildMorrisColumn();
      col.position.copy(p).addScaledVector(right, off);
      col.position.y = p.y + 0.16;
      group.add(col);
    }
  }

  return group;
}

export function buildStreetLamp() {
  // The Montmartre lantern: a black cast-iron post with the lantern ON TOP,
  // as in every survey photograph on the route (rue Girardon, Place Dalida,
  // rue Lepic). The first version was a swan-neck with an amber box, which is
  // a different street furniture family altogether and read as orange.
  const g = new THREE.Group();
  const iron = flat(new THREE.Color('#232527'), { roughness: 0.5, metalness: 0.2 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.6, 8), iron);
  base.position.y = 0.3;
  base.castShadow = true;
  g.add(base);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 3.2, 8), iron);
  column.position.y = 2.2;
  column.castShadow = true;
  g.add(column);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.18, 8), iron);
  collar.position.y = 3.85;
  g.add(collar);

  // Clear glass, so: pale and faintly warm, not a coloured light.
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.17, 0.62, 6),
    flat(new THREE.Color('#E6E2D6'), { roughness: 0.15, emissive: new THREE.Color('#FFF4DC'), emissiveIntensity: 0.05 }));
  lantern.position.y = 4.25;
  lantern.castShadow = true;
  g.add(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 6), iron);
  cap.position.y = 4.7;
  g.add(cap);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), iron);
  finial.position.y = 4.9;
  g.add(finial);
  return g;
}

export function buildBench() {
  const g = new THREE.Group();
  const wood = flat(PALETTE.shutterGreen, { roughness: 0.85 });
  const iron = flat(PALETTE.ironwork, { roughness: 0.5, metalness: 0.35 });

  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.13), wood);
    slat.position.set(0, 0.46, -0.18 + i * 0.18);
    slat.castShadow = true;
    g.add(slat);
  }
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.13, 0.07), wood);
    slat.position.set(0, 0.62 + i * 0.17, -0.28);
    slat.castShadow = true;
    g.add(slat);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.46, 0.5), iron);
    leg.position.set(s * 0.85, 0.23, -0.05);
    leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

export function buildMorrisColumn() {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.72, 2.9, 12),
    flat(PALETTE.metroGreen, { roughness: 0.55, metalness: 0.2 }));
  drum.position.y = 1.6;
  drum.castShadow = drum.receiveShadow = true;
  g.add(drum);

  // Posters, as bright bands — the one place a saturated red/cream is welcome.
  for (let i = 0; i < 3; i++) {
    const poster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.73, 0.73, 0.8, 12, 1, true,
        (i / 3) * Math.PI * 2, Math.PI * 0.5),
      flat(i === 1 ? PALETTE.awningRed : PALETTE.awningCream,
        { roughness: 0.9, side: THREE.DoubleSide }));
    poster.position.y = 1.75;
    g.add(poster);
  }

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.92, 0.3, 12),
    flat(PALETTE.metroGreen, { roughness: 0.6 }));
  base.position.y = 0.15;
  base.castShadow = true;
  g.add(base);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.74, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    flat(PALETTE.metroGreen, { roughness: 0.5, metalness: 0.3 }));
  dome.position.y = 3.05;
  dome.scale.y = 0.55;
  dome.castShadow = true;
  g.add(dome);

  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 6),
    flat(PALETTE.guimardAmber, { metalness: 0.6, roughness: 0.3 }));
  finial.position.y = 3.5;
  g.add(finial);
  return g;
}
