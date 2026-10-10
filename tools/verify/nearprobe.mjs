import * as THREE from 'three';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { RailCamera } from '../../src/rail/camera.js';

const rail = new Rail(railPoints());
const { root } = buildWorld(rail, undefined, undefined, { batch: false });
const meshes = []; root.traverse((o) => { if (o.isMesh && o.name !== 'sky') meshes.push(o); });
const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
const rc = new RailCamera(cam, rail);
const wp = process.argv[2] ?? 'lamarck_station';
const d0 = rail.distanceToWaypoint(wp);
rc.snapTo(d0); rc.update(1 / 60, 1);
const ahead = rail.positionAt(Math.min(rail.length, d0 + 16));
cam.lookAt(ahead.x, ahead.y + 1.4, ahead.z);
cam.updateMatrixWorld(true);
console.log('camera', cam.position.toArray().map((v) => v.toFixed(1)).join(','), 'at', wp, `d=${d0.toFixed(0)}`);
const ray = new THREE.Raycaster();
const seen = [];
for (let nx = -1; nx <= 1.001; nx += 0.25) {
  for (let ny = -1; ny <= 1.001; ny += 0.5) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    ray.far = 300;
    const h = ray.intersectObjects(meshes, false)[0];
    if (h && h.distance < 6) seen.push({ nx: nx.toFixed(2), ny: ny.toFixed(1), d: h.distance, p: h.point, o: h.object });
  }
}
seen.sort((a, b) => a.d - b.d);
for (const s of seen.slice(0, 10)) {
  // offset from the rail centreline at the camera
  const rel = s.p.clone().sub(cam.position);
  let n = s.o, path = [];
  while (n && path.length < 5) { if (n.name) path.push(n.name); n = n.parent; }
  console.log(`  ndc(${s.nx},${s.ny}) ${s.d.toFixed(1)}m  rel ${rel.toArray().map((v)=>v.toFixed(1)).join(',')}  [${path.join(' < ')}]`);
}
if (!seen.length) console.log('  nothing within 6 m');
