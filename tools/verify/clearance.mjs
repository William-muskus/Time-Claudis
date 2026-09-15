/** How close does each landmark actually come to the rail centreline? */
import * as THREE from 'three';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildLandmarks } from '../../src/world/landmarks.js';
import { makeRng } from '../../src/core/rng.js';

const rail = new Rail(railPoints());
const { group } = buildLandmarks(rail, undefined, makeRng(7));
group.updateMatrixWorld(true);
const pts = [];
for (let d = 0; d <= rail.length; d += 1) pts.push(rail.positionAt(d));

const rows = [];
for (const obj of group.children) {
  let min = Infinity, at = 0, who = '';
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.updateMatrixWorld(true);
    // Exact vertices: an AABB bulges badly for anything rotated to a street
    // yaw, which is nearly everything placed beside a road.
    const pos = o.geometry?.getAttribute('position');
    if (!pos) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j];
        if (Math.abs(p.y - v.y) > 2.5) continue;
        const dd = Math.hypot(p.x - v.x, p.z - v.z);
        if (dd < min) { min = dd; at = j; who = o.name || o.geometry?.type || '?'; }
      }
    }
  });
  if (Number.isFinite(min)) rows.push([obj.name || '(unnamed)', min, at, who]);
}
rows.sort((a, b) => a[1] - b[1]);
for (const [n, m, at, who] of rows.slice(0, 8)) console.log(`  ${n.padEnd(22)} ${m.toFixed(2).padStart(6)} m  d=${String(at).padStart(3)}  closest mesh: ${who}`);
