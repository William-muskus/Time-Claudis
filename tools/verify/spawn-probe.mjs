import * as THREE from 'three';
import { Game } from '../../src/gameplay/game.js';
import { RailCamera } from '../../src/rail/camera.js';
import { Rail } from '../../src/core/spline.js';
import { railPoints } from '../../src/data/route.js';
import { buildWorld } from '../../src/world/index.js';
import { EventBus } from '../../src/core/events.js';
import { blocked } from '../../src/world/occluders.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 900);
const rail = new Rail(railPoints());
const { root: world, anchors, occluders } = buildWorld(rail, 0xC0FFEE);
scene.add(world);
const walls = [];
world.traverse((o) => { if (o.isMesh && o.visible && !o.userData.isEnemy) walls.push(o); });
const railCamera = new RailCamera(camera, rail);
const bus = new EventBus();

const game = new Game({ scene, camera, railCamera, rail, anchors, occluders, bus, seed: 1 });
console.log('occluders:', occluders.length, 'director has:', game.director.occluders.length);
bus.on('spawn.failed', (p) => console.log('   spawn.failed', JSON.stringify(p)));

for (const [at, yaw, types] of [
  ['lamarck_station', 250, ['GRUNT', 'GRUNT', 'SOLDIER']],
  ['place_dalida', 196, ['RED', 'GRUNT']],
  ['emile_goudeau', 175, ['HEAVY', 'SNIPER']],
]) {
  const d = rail.distanceToWaypoint(at);
  railCamera.snapTo(d);
  railCamera.update(1 / 60, 1);
  const r = THREE.MathUtils.degToRad(yaw);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(r);
  camera.updateMatrixWorld(true);
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  console.log(`\n${at} yaw ${yaw}  cam ${camera.position.toArray().map(v=>v.toFixed(1))}`);
  for (const t of types) {
    const e = game.director.spawnForReview(t, camera.position, fwd);
    if (!e) { console.log(`   ${t}: NO SPAWN`); continue; }
    // Drive it out of the spawn animation, as the tour does.
    for (let i = 0; i < 40; i++) {
      e.update(1/60, camera.position, { grantCommit: () => true, onFire(){}, onStage(){} });
    }
    const p = e.group.position.clone();
    const to = p.clone().sub(camera.position);
    const dist = to.length();
    const ndc = p.clone().project(camera);
    const onScreen = Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1;
    const eye = { x: p.x, y: p.y + 1.1, z: p.z };
    const eyeV = new THREE.Vector3(eye.x, eye.y, eye.z);
    const dirV = eyeV.clone().sub(camera.position);
    const dd = dirV.length();
    const ray = new THREE.Raycaster(camera.position.clone(), dirV.normalize(), 0.5, dd - 0.6);
    const hitsAll = ray.intersectObjects(walls, false);
    const firstHit = hitsAll[0]
      ? `@${hitsAll[0].distance.toFixed(1)}m pt(${hitsAll[0].point.toArray().map((v) => v.toFixed(1)).join(',')})`
      : 'clear';
    const home = { x: e.homePos.x, y: e.homePos.y + 1.1, z: e.homePos.z };
    const blHome = blocked(occluders, camera.position, home);
    const bl = blocked(occluders, camera.position, eye);
    console.log(`   ${t}: coarse(now)=${bl} coarse(anchor)=${blHome} realRay=${firstHit} state=${e.state} dist=${dist.toFixed(1)}m ndc=(${ndc.x.toFixed(2)},${ndc.y.toFixed(2)},${ndc.z.toFixed(2)}) onScreen=${onScreen} anchor=${e.anchor?.kind ?? '?'}`);
  }
}
