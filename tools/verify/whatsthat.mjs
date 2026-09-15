/**
 * "What is that blank wall?"
 *
 * Fires a grid of rays from a tour camera and reports, per cell, what was hit,
 * how far away, and what colour it is. Reading a compressed screenshot and
 * guessing which builder produced a flat expanse is how three of these went
 * unfixed; asking the scene is a second.
 *
 *   node tools/verify/whatsthat.mjs <waypoint> [aheadMetres] [back]
 */
import * as THREE from 'three';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { RailCamera } from '../../src/rail/camera.js';

const [wp = 'place_abbesses', aheadM = '18', back = '0'] = process.argv.slice(2);
const rail = new Rail(railPoints());
const { root } = buildWorld(rail);
const meshes = [];
root.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'sky') meshes.push(o); });

const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
const rc = new RailCamera(cam, rail);
const d0 = Math.max(0, rail.distanceToWaypoint(wp) - Number(back));
rc.snapTo(d0); rc.update(1 / 60, 1);
const ahead = rail.positionAt(Math.min(rail.length, d0 + Number(aheadM)));
cam.lookAt(ahead.x, ahead.y + 1.4, ahead.z);
cam.updateMatrixWorld(true);

const ray = new THREE.Raycaster();
const COLS = 9, ROWS = 5;
console.log(`from ${wp} (d=${d0.toFixed(0)}m), looking ${aheadM}m ahead\n`);
for (let r = 0; r < ROWS; r++) {
  const line = [];
  for (let c = 0; c < COLS; c++) {
    const ndc = new THREE.Vector2((c / (COLS - 1)) * 2 - 1, 1 - (r / (ROWS - 1)) * 2);
    ray.setFromCamera(ndc, cam);
    ray.far = 400;
    const h = ray.intersectObjects(meshes, false)[0];
    if (!h) { line.push('   sky    '); continue; }
    // Colour lives in the vertex attribute after batching, not on the
    // material — every batched mesh reports white.
    let hex = '------';
    const g = h.object.geometry;
    const ca = g?.getAttribute('color');
    if (ca && h.face) {
      const c = new THREE.Color(ca.getX(h.face.a), ca.getY(h.face.a), ca.getZ(h.face.a));
      hex = '#' + c.convertLinearToSRGB().getHexString();
    } else if (h.object.material?.color) {
      hex = '#' + h.object.material.color.getHexString();
    }
    line.push(`${hex} ${h.distance.toFixed(0).padStart(3)}m y${h.point.y.toFixed(0).padStart(3)}`);
  }
  console.log(line.join(' | '));
}
