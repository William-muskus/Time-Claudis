/**
 * Where on the route can you actually see Sacre-Coeur?
 *
 * Written because two different framings of the basilica shot came back as a
 * wall filling the frame, and guessing at a third was not going to help.
 * Sweeping the whole rail against the real geometry gives the answer: three
 * short stretches, and only ever above 46 m — which is the dome and the cross,
 * not the building. That is not a bug to fix, it is the truth about a village
 * of six-storey streets, and the shot was rewritten to show it.
 *
 * Useful again for any "should this landmark be visible from here" question.
 *
 *   node tools/verify/skyline-probe.mjs
 */
import * as THREE from 'three';
import { Rail } from '../../src/core/spline.js';
import { railPoints, LANDMARKS, geoToLocal } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { RIG } from '../../src/rail/camera.js';

const rail = new Rail(railPoints());
const { root } = buildWorld(rail);
const meshes = [];
root.traverse((o) => { if (o.isMesh && o.visible && o.name !== 'sky') meshes.push(o); });

const l = LANDMARKS.find((x) => x.id === 'sacre_coeur');
const target = geoToLocal(l.lat, l.lon, l.elev);
const ray = new THREE.Raycaster();
const best = [];
for (let d = 0; d <= rail.length; d += 5) {
  const eye = rail.positionAt(d).clone(); eye.y += RIG.eyeHeight;
  for (const h of [22, 34, 46]) {
    const at = new THREE.Vector3(target.x, target.y + h, target.z);
    const dir = at.clone().sub(eye);
    const dist = dir.length();
    ray.set(eye, dir.normalize());
    ray.near = 0.5; ray.far = dist - 2;
    if (!ray.intersectObjects(meshes, false).length) best.push({ d: Math.round(d), h, dist: Math.round(dist) });
  }
}
console.log('clear sightlines to Sacre-Coeur:', best.length);
console.log(best.slice(0, 20).map((b) => `d=${b.d}m h=${b.h} range=${b.dist}m`).join('\n'));
