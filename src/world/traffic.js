import * as THREE from 'three';
import { ENCOUNTERS } from '../gameplay/encounters.js';
import { parkedCar, scooters } from './cover.js';
import { STAIR_SEGMENTS } from './street.js';
import { GEO, insideBuilding, groundAt, pairs } from './geo.js';

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
  // The open squares on the walk: Constantin-Pecqueur, Dalida, Marcel-Aymé,
  // Émile-Goudeau and the Abbesses square itself.
  const SQUARES = ['constantin_pecqueur', 'place_dalida', 'marcel_ayme', 'emile_goudeau', 'place_abbesses', 's_place_1', 's_place_2'];
  const sq = SQUARES.map((id) => { try { return rail.distanceToWaypoint(id); } catch { return -1e9; } });
  const inSquare = (d) => sq.some((q) => Math.abs(q - d) < 12);
  let d = 8;
  while (d < rail.length - 8) {
    const width = rail.widthAt(d);
    const nearFight = fights.some((f) => Math.abs(f - d) < 14);
    const onStairs = stairs.some(([a, b]) => d >= a && d <= b);
    // Survey widths are wall to wall and capped at 14 in the route, so a
    // 14 m reading is a wide street (rue Ravignan, rue des Abbesses), not
    // necessarily a square: only the waypoints that ARE squares are skipped.
    if (width < 8.5 || inSquare(d) || nearFight || onStairs) { d += 2; continue; }
    // Wide streets park on both sides, the way rue Ravignan does.
    const both = width >= 11.5;
    const side = both ? (Math.floor(d / 5.3) % 2 ? 1 : -1) : Math.floor(d / 43) % 2 ? 1 : -1;
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
    d += (isCar ? 4.6 + rnd() * 1.4 : 4.4) / (both ? 2 : 1);
  }
  return group;
}

/**
 * Café terraces: bistro tables and cane chairs on the pavement in front of
 * every café, bar and restaurant OpenStreetMap puts on the walk, and a parasol
 * where the pavement is wide enough. Le Saint-Jean on rue des Abbesses and the
 * terraces at the foot of rue Ravignan are the busiest things in the survey
 * photographs of the lower route, and the street read as closed without them.
 *
 * Everything is below the chest of a standing enemy except the parasols, so
 * none of it decides what the player can see.
 */
const TERRACE_KINDS = new Set(['cafe', 'bar', 'restaurant']);

export function buildTerraces(rail, near) {
  const group = new THREE.Group();
  group.name = 'terraces';
  const cane = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9B7A4E'), roughness: 0.8, flatShading: true });
  const black = new THREE.MeshStandardMaterial({ color: new THREE.Color('#222324'), roughness: 0.5, flatShading: true });
  const marble = new THREE.MeshStandardMaterial({ color: new THREE.Color('#E8E4DC'), roughness: 0.4, flatShading: true });
  const cloth = [new THREE.Color('#E8E2D2'), new THREE.Color('#9E2F2C'), new THREE.Color('#2F4A3B'), new THREE.Color('#E8E2D2')]
    .map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }));
  const topGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.04, 10);
  const legGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.72, 6);
  const seatGeo = new THREE.BoxGeometry(0.42, 0.06, 0.42);
  const backGeo = new THREE.BoxGeometry(0.42, 0.42, 0.05);
  const chairLeg = new THREE.BoxGeometry(0.04, 0.45, 0.04);
  const rnd = seeded(0x7E77);

  const table = (x, y, z, yaw) => {
    const t = new THREE.Group();
    const top = new THREE.Mesh(topGeo, marble); top.position.y = 0.74; t.add(top);
    const leg = new THREE.Mesh(legGeo, black); leg.position.y = 0.36; t.add(leg);
    for (const s of [-1, 1]) {
      const c = new THREE.Group();
      const seat = new THREE.Mesh(seatGeo, cane); seat.position.y = 0.46; c.add(seat);
      const back = new THREE.Mesh(backGeo, cane); back.position.set(0, 0.7, -0.2); c.add(back);
      for (const lx of [-0.17, 0.17]) for (const lz of [-0.17, 0.17]) {
        const l = new THREE.Mesh(chairLeg, black); l.position.set(lx, 0.22, lz); c.add(l);
      }
      c.position.set(s * 0.55, 0, 0);
      c.rotation.y = s * Math.PI / 2 + (rnd() - 0.5) * 0.4;
      t.add(c);
    }
    t.position.set(x, y, z);
    t.rotation.y = yaw;
    return t;
  };

  for (const b of GEO.buildings) {
    for (const [ei, t, kind] of b.sh ?? []) {
      if (!TERRACE_KINDS.has(kind)) continue;
      const ring = pairs(b.o);
      const [ax, az] = ring[ei], [bx, bz] = ring[(ei + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const wx = -uz, wz = ux;                       // outward
      const cx = ax + ux * t * len, cz = az + uz * t * len;
      const nr = near.nearest(cx, cz, 30);
      if (!nr) continue;
      const room = nr.dist - (rail.widthAt(nr.d) * 0.5 - Math.max(0.8, Math.min(2.4, rail.widthAt(nr.d) * 0.18)));
      // The pavement between the wall and the kerb must hold a table.
      const depth = Math.min(room - 0.3, 3.2);
      if (depth < 1.1) continue;
      const rows = depth > 2.4 ? 2 : 1;
      for (let k = -1; k <= 1; k++) {
        for (let r = 0; r < rows; r++) {
          const along = k * 1.7, out = 0.75 + r * 1.3;
          const x = cx + ux * along + wx * out, z = cz + uz * along + wz * out;
          const n2 = near.nearest(x, z, 10);
          if (n2 && n2.dist < 2.4) continue;
          if (insideBuilding(x, z, 0.3)) continue;
          const g = groundAt(x, z);
          if (g === null) continue;
          group.add(table(x, Math.max(g, nr.y + 0.14), z, Math.atan2(ux, uz)));
        }
      }
      if (depth > 2.6 && rnd() < 0.7) {
        const x = cx + wx * (depth * 0.55), z = cz + wz * (depth * 0.55);
        const g = groundAt(x, z);
        if (g !== null && !insideBuilding(x, z, 0.5)) {
          const p = new THREE.Group();
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), black);
          pole.position.y = 1.2; p.add(pole);
          const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.45, 8, 1, true), cloth[Math.floor(rnd() * cloth.length)]);
          canopy.position.y = 2.45; p.add(canopy);
          p.position.set(x, Math.max(g, nr.y + 0.14), z);
          group.add(p);
        }
      }
    }
  }
  return group;
}
