import * as THREE from 'three';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { RailCamera } from '../../src/rail/camera.js';
import { ENCOUNTERS } from '../../src/gameplay/encounters.js';
import { blocked } from '../../src/world/occluders.js';

const rail = new Rail(railPoints());
const { root, anchors, occluders } = buildWorld(rail, 0x5EED);
const meshes = [];
root.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'sky') meshes.push(o); });
const ray = new THREE.Raycaster();
let agree = 0, coarseOnly = 0, realOnly = 0, total = 0;
const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
const rc = new RailCamera(cam, rail);

for (const area of ENCOUNTERS) {
  const d = rail.distanceToWaypoint(area.waypoint);
  rc.snapTo(d); rc.update(1 / 60, 1);
  const fwd = cam.getWorldDirection(new THREE.Vector3());
  const counts = {};
  for (const a of anchors) {
    if (!a.worldPos) continue;
    const to = a.worldPos.clone().sub(cam.position);
    const dist = to.length();
    if (dist < 4 || dist > 58) continue;
    to.normalize();
    if (to.dot(fwd) < -0.1) continue;
    const k = a.type;
    counts[k] ??= { inRange: 0, visible: 0 };
    counts[k].inRange++;
    const eye = { x: a.worldPos.x, y: a.worldPos.y + 1.1, z: a.worldPos.z };
    const coarseBlocked = blocked(occluders, cam.position, eye);
    if (!coarseBlocked) counts[k].visible++;
    const eyeV = new THREE.Vector3(eye.x, eye.y, eye.z);
    const dir = eyeV.clone().sub(cam.position);
    const dd = dir.length();
    ray.set(cam.position, dir.normalize());
    ray.near = 0.8; ray.far = dd - 1.2;
    const realBlocked = ray.intersectObjects(meshes, false).length > 0;
    total++;
    if (coarseBlocked === realBlocked) agree++;
    else if (coarseBlocked) coarseOnly++;
    else realOnly++;
  }
  console.log(area.areaId, area.waypoint,
    Object.entries(counts).map(([k, v]) => `${k} ${v.visible}/${v.inRange}`).join('  '));
}

console.log(`\ncoarse vs real: agree ${agree}/${total}  coarse-says-blocked-only ${coarseOnly}  real-says-blocked-only ${realOnly}`);
