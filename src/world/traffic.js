import * as THREE from 'three';
import { ENCOUNTERS } from '../gameplay/encounters.js';
import { parkedCar, scooters } from './cover.js';
import { STAIR_SEGMENTS } from './street.js';
import { insideBuilding } from './geo.js';

/**
 * Parked cars and scooters along the kerbs.
 *
 * Every survey photograph of the wider streets on this route — rue Ravignan,
 * rue des Abbesses, Place Constantin-Pecqueur — has a line of parked cars down
 * one side and scooters nosed in wherever a car does not fit. An empty street
 * is the single most obviously artificial thing a game city can show, and
 * these are what fill it in Paris.
 *
 * Placement is a rule, not data (OSM's parking lanes are unmapped here): one
 * side of every street between 8.5 and 12.5 m wide, alternating side every
 * forty-odd metres, never on the stairs, and never within fourteen metres of a
 * fight, where the authored cover owns the foreground and a stray car would
 * decide which enemies you can see.
 */
function seeded(n) {
  let s = n >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function buildParkedVehicles(rail) {
  const group = new THREE.Group();
  group.name = 'parked';
  const rnd = seeded(0x5CA7);
  const fights = ENCOUNTERS.map((e) => { try { return rail.distanceToWaypoint(e.waypoint); } catch { return -1e9; } });
  const stairs = STAIR_SEGMENTS.map((s) => {
    try { return [rail.distanceToWaypoint(s.from) - 4, rail.distanceToWaypoint(s.to) + 4]; } catch { return [0, -1]; }
  });
  let d = 8;
  while (d < rail.length - 8) {
    const width = rail.widthAt(d);
    const nearFight = fights.some((f) => Math.abs(f - d) < 14);
    const onStairs = stairs.some(([a, b]) => d >= a && d <= b);
    if (width < 8.5 || width >= 12.5 || nearFight || onStairs) { d += 2; continue; }
    const side = Math.floor(d / 43) % 2 ? 1 : -1;
    const p = rail.positionAt(d);
    const t = rail.tangentAt(d);
    const right = new THREE.Vector3(-t.z, 0, t.x).normalize();
    // Same kerb line as street.js: the carriageway's half-width.
    const pavement = Math.max(0.8, Math.min(2.4, width * 0.18));
    const half = Math.max(1.5, width * 0.5 - pavement);
    const r = rnd();
    if (r < 0.22) { d += 3 + rnd() * 4; continue; }          // a gap: a gateway, a delivery bay
    const isCar = r < 0.82;
    const off = (half - (isCar ? 1.0 : 0.9)) * side;
    const x = p.x + right.x * off, z = p.z + right.z * off;
    if (insideBuilding(x, z, 0.5)) { d += 2; continue; }
    const v = isCar ? parkedCar(rnd) : scooters(rnd);
    v.position.set(x, p.y + 0.02, z);
    v.rotation.y = Math.atan2(t.x, t.z) + (isCar && rnd() < 0.5 ? Math.PI : 0);
    group.add(v);
    d += isCar ? 4.6 + rnd() * 1.4 : 4.4;
  }
  return group;
}
