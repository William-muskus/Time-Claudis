/**
 * Which wall is at these pixels of a reference view?
 *
 *   node tools/verify/whichwall.mjs <reference name> x,y [x,y ...]
 *
 * Pixels are in the 1280x675 render compare.mjs makes. Prints the building id,
 * wall index and the fraction along the wall for each, so a facade read off
 * the photograph can be keyed in src/data/geo/facades.json.
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Rail } from '../../src/core/spline.js';
import { railPoints, geoToLocal } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { groundAt } from '../../src/world/geo.js';
import { wallAt } from '../../src/world/realbuildings.js';

const [name, ...pix] = process.argv.slice(2);
const { references } = JSON.parse(readFileSync('tools/geo/references.json', 'utf8'));
const r = references.find((x) => x.name === name);
const rail = new Rail(railPoints());
const { root } = buildWorld(rail, undefined, undefined, { batch: false });
const meshes = [];
root.traverse((o) => { if (o.isMesh && o.parent?.name !== 'sky') meshes.push(o); });
const cam = new THREE.PerspectiveCamera(58, 1280 / 675, 0.1, 900);
const p = geoToLocal(r.lat, r.lon);
const y = (groundAt(p.x, p.z) ?? 0) + 2.3;
cam.position.set(p.x, y, p.z);
const h = THREE.MathUtils.degToRad(r.heading);
cam.lookAt(p.x + Math.sin(h), y, p.z - Math.cos(h));
cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(r.hfov / 2)) / cam.aspect));
cam.updateProjectionMatrix();
cam.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
for (const q of pix) {
  const [px, py] = q.split(',').map(Number);
  ray.setFromCamera(new THREE.Vector2(px / 1280 * 2 - 1, -(py / 675 * 2 - 1)), cam);
  const hit = ray.intersectObjects(meshes, false).find((x) => x.object.parent?.name === 'city' || x.object.name.startsWith('city'));
  if (!hit) { console.log(q, 'no building'); continue; }
  console.log(q, JSON.stringify(wallAt(hit.point.x, hit.point.z, 2)), `${hit.distance.toFixed(1)} m away`);
}
