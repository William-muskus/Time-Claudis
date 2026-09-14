import * as THREE from 'three';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { ENCOUNTERS } from '../../src/gameplay/encounters.js';
import { RailCamera } from '../../src/rail/camera.js';

const rail = new Rail(railPoints());
const { root } = buildWorld(rail);
const meshes = [];
root.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'sky') meshes.push(o); });

for (const area of ENCOUNTERS) {
  const d = rail.distanceToWaypoint(area.waypoint);
  const cam = new THREE.PerspectiveCamera(58, 16/9, 0.1, 900);
  const rc = new RailCamera(cam, rail);
  rc.snapTo(d);
  rc.update(1/60, 1);
  const eye = cam.position.clone();
  const aheadD = Math.min(rail.length, d + 14);
  const tan = rail.positionAt(aheadD).clone().sub(rail.positionAt(d));
  const rise = tan.y;
  tan.y = 0; tan.normalize();
  const out = [];
  for (const deg of [-20, -10, 0, 10, 20]) {
    const a = (deg * Math.PI) / 180;
    const dir = new THREE.Vector3(
      tan.x * Math.cos(a) + tan.z * Math.sin(a), 0,
      tan.z * Math.cos(a) - tan.x * Math.sin(a)).normalize();
    const ray = new THREE.Raycaster(eye, dir, 0.4, 6.0);
    const h = ray.intersectObjects(meshes, false);
    out.push(h.length
      ? `${deg}:${h[0].distance.toFixed(1)}m pt(${h[0].point.toArray().map((v)=>v.toFixed(1)).join(',')})`
      : `${deg}:clear`);
  }
  console.log(`${area.areaId} ${area.waypoint} eyeY=${eye.y.toFixed(1)} rise over 14m=${rise.toFixed(1)}m`);
  console.log('   ' + out.join('  '));
}
