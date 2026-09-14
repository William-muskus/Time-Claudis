import * as THREE from 'three';
import { PALETTE } from '../render/palette.js';

/**
 * Tracers, shells, impacts, muzzle flash.
 *
 * Arcade games are generous with debris and that generosity is not decoration —
 * it is feedback. A shot that produces nothing but a decremented counter feels
 * like a spreadsheet. Every shot here produces a tracer you can see travel, a
 * shell that bounces on the cobbles, and either a spark on stone or a burst on
 * a body, so the player always knows what happened without reading the HUD.
 *
 * All pools are preallocated. Allocating a mesh mid-combat is how a 60 fps
 * arcade game becomes a 48 fps one.
 */

const MAX_TRACERS = 64;
const MAX_SHELLS = 48;
const MAX_SPARKS = 220;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'effects';
    scene.add(this.group);

    this.#initTracers();
    this.#initShells();
    this.#initSparks();

    this.muzzle = new THREE.PointLight(PALETTE.telegraph, 0, 9, 2);
    this.group.add(this.muzzle);
    this.muzzleTtl = 0;
  }

  // --- tracers ------------------------------------------------------------
  #initTracers() {
    const geo = new THREE.BoxGeometry(0.045, 0.045, 1);
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: PALETTE.enemyTracer, toneMapped: false, transparent: true,
      }));
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, ttl: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), life: 0 });
    }
  }

  /** A tracer that draws the path a bullet took. `speed` 0 = instant beam. */
  spawnTracer(from, to, color = PALETTE.playerTracer, life = 0.09) {
    const t = this.tracers.find((x) => x.ttl <= 0);
    if (!t) return;
    t.from.copy(from); t.to.copy(to); t.ttl = life; t.life = life;
    t.mesh.material.color.copy(color);
    const d = to.clone().sub(from);
    const len = d.length();
    t.mesh.position.copy(from).addScaledVector(d, 0.5);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(to);
    t.mesh.visible = true;
    t.mesh.material.opacity = 1;
  }

  // --- shells -------------------------------------------------------------
  #initShells() {
    const geo = new THREE.CylinderGeometry(0.012, 0.014, 0.05, 5);
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.bronzePolish, metalness: 0.85, roughness: 0.28, flatShading: true,
    });
    this.shells = [];
    for (let i = 0; i < MAX_SHELLS; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = true;
      this.group.add(m);
      this.shells.push({
        mesh: m, ttl: 0,
        vel: new THREE.Vector3(), spin: new THREE.Vector3(), groundY: 0,
      });
    }
  }

  /** Eject a shell. Time Crisis is generous with brass. */
  ejectShell(from, right, rng = Math.random) {
    const s = this.shells.find((x) => x.ttl <= 0);
    if (!s) return;
    s.mesh.position.copy(from);
    s.vel.copy(right).multiplyScalar(1.6 + rng() * 1.1);
    s.vel.y = 1.5 + rng() * 0.9;
    s.vel.x += (rng() - 0.5) * 0.7;
    s.vel.z += (rng() - 0.5) * 0.7;
    s.spin.set(rng() * 22, rng() * 16, rng() * 22);
    s.groundY = from.y - 1.5;
    s.ttl = 2.6;
    s.mesh.visible = true;
  }

  // --- sparks / impact bursts ---------------------------------------------
  #initSparks() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_SPARKS * 3);
    const col = new Float32Array(MAX_SPARKS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.sparkGeo = geo;
    this.sparkPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.085, vertexColors: true, transparent: true, opacity: 1,
      toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparkPoints.frustumCulled = false;
    this.group.add(this.sparkPoints);
    this.sparks = Array.from({ length: MAX_SPARKS }, () => ({
      ttl: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), col: new THREE.Color(),
    }));
  }

  /**
   * An impact burst. Stone throws pale dust that falls; a body hit throws a
   * short hot spray. Two very different reads, on purpose — the player must
   * know instantly whether they connected.
   */
  burst(at, normal, kind = 'stone', rng = Math.random) {
    const n = kind === 'body' ? 16 : 10;
    const color = kind === 'body' ? new THREE.Color(0xff5533)
                : kind === 'head' ? new THREE.Color(0xffcc44)
                : new THREE.Color(PALETTE.limestoneLit);
    const speed = kind === 'stone' ? 2.2 : 4.0;
    let made = 0;
    for (const s of this.sparks) {
      if (made >= n) break;
      if (s.ttl > 0) continue;
      s.pos.copy(at);
      s.vel.copy(normal).multiplyScalar(speed * (0.4 + rng()));
      s.vel.x += (rng() - 0.5) * speed;
      s.vel.y += (rng() - 0.5) * speed + (kind === 'stone' ? 0.6 : 1.4);
      s.vel.z += (rng() - 0.5) * speed;
      s.col.copy(color);
      s.ttl = kind === 'stone' ? 0.55 : 0.35;
      made++;
    }
  }

  flashMuzzle(at, intensity = 5) {
    this.muzzle.position.copy(at);
    this.muzzle.intensity = intensity;
    this.muzzleTtl = 0.055;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.ttl <= 0) continue;
      t.ttl -= dt;
      t.mesh.material.opacity = Math.max(0, t.ttl / t.life);
      if (t.ttl <= 0) t.mesh.visible = false;
    }

    for (const s of this.shells) {
      if (s.ttl <= 0) continue;
      s.ttl -= dt;
      s.vel.y -= 9.81 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < s.groundY) {
        s.mesh.position.y = s.groundY;
        s.vel.y *= -0.34;                 // a little bounce, then it settles
        s.vel.x *= 0.62; s.vel.z *= 0.62;
        s.spin.multiplyScalar(0.5);
      }
      if (s.ttl <= 0) s.mesh.visible = false;
    }

    const pos = this.sparkGeo.attributes.position.array;
    const col = this.sparkGeo.attributes.color.array;
    let i = 0;
    for (const s of this.sparks) {
      if (s.ttl > 0) {
        s.ttl -= dt;
        s.vel.y -= 13 * dt;
        s.pos.addScaledVector(s.vel, dt);
        const fade = Math.max(0, s.ttl) * 2.4;
        pos[i * 3] = s.pos.x; pos[i * 3 + 1] = s.pos.y; pos[i * 3 + 2] = s.pos.z;
        col[i * 3] = s.col.r * fade; col[i * 3 + 1] = s.col.g * fade; col[i * 3 + 2] = s.col.b * fade;
      } else {
        // Park dead sparks far below the world rather than paying for a
        // draw-range rebuild every frame.
        pos[i * 3] = 0; pos[i * 3 + 1] = -9999; pos[i * 3 + 2] = 0;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
      }
      i++;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;

    if (this.muzzleTtl > 0) {
      this.muzzleTtl -= dt;
      this.muzzle.intensity *= 0.72;
      if (this.muzzleTtl <= 0) this.muzzle.intensity = 0;
    }
  }
}

/**
 * Enemy bullets.
 *
 * These are real travelling objects, not hitscan, and that is a gameplay
 * decision rather than a visual one: at 34 m/s a shot from 20 m takes nearly
 * 600 ms to arrive, and ducking during that flight saves you. It is the single
 * mechanic that lets Time Crisis be fast and fair at the same time.
 */
export class BulletPool {
  constructor(scene, max = 40) {
    this.scene = scene;

    /**
     * Incoming fire has to be impossible to miss.
     *
     * A round travels for six or seven hundred milliseconds at typical combat
     * range, and that flight time is the entire reason the game is fair — you
     * can duck under a shot already in the air. But the player can only use
     * that window if they can SEE the round, and at 7 cm across from twenty
     * metres away it was a couple of pixels. In a headless playthrough an
     * oracle that ducked correctly on every telegraph still took a hit every
     * time it popped back out, because nothing on screen said a round was
     * still coming.
     *
     * So the projectile is a bright head with a long tail stretched along its
     * own velocity. The tail is what does the work: a streak reads as motion
     * and as DIRECTION, so a glance tells you not just that something is in
     * the air but that it is coming at you rather than across you. Unlit and
     * untonemapped so it punches through the bloom threshold at any exposure.
     */
    const geo = new THREE.SphereGeometry(0.14, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.enemyTracer, toneMapped: false });
    const tailGeo = new THREE.CylinderGeometry(0.055, 0.11, 1, 6, 1, true);
    // Point the cylinder down -Z so it can be aimed with lookAt.
    tailGeo.rotateX(Math.PI / 2);
    tailGeo.translate(0, 0, 0.5);
    const tailMat = new THREE.MeshBasicMaterial({
      color: PALETTE.enemyTracer, toneMapped: false, transparent: true,
      opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.bullets = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, mat);
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.scale.z = 2.6;
      m.add(tail);
      m.visible = false;
      scene.add(m);
      this.bullets.push({
        mesh: m, tail, active: false, vel: new THREE.Vector3(), ttl: 0, from: null,
      });
    }
  }

  fire(from, to, speed, ownerId) {
    const b = this.bullets.find((x) => !x.active);
    if (!b) return;
    b.mesh.position.copy(from);
    b.vel.copy(to).sub(from).normalize().multiplyScalar(speed);
    b.ttl = 3.0;
    b.active = true;
    b.from = ownerId;
    b.mesh.visible = true;
    // Aim the tail backwards along the flight path.
    b.mesh.lookAt(from.clone().sub(b.vel));
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {() => boolean} isVulnerable evaluated AT THE MOMENT OF CONTACT
   * @param {(ownerId: string) => void} onHit
   */
  update(dt, playerPos, isVulnerable, onHit) {
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.ttl -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);

      // Generous radius: the player is a point, so the bullet has to be fat
      // enough that a shot aimed at them actually connects.
      if (b.mesh.position.distanceTo(playerPos) < 0.85) {
        b.active = false;
        b.mesh.visible = false;
        // The vulnerability test happens HERE, on arrival — not at fire time.
        // That is what makes ducking mid-flight work.
        if (isVulnerable()) onHit(b.from);
        continue;
      }
      // Swell the head as it closes, so an approaching round grows in the
      // frame rather than merely getting nearer. Cheap, and it is what makes
      // "this one is for me" legible at a glance.
      const near = b.mesh.position.distanceTo(playerPos);
      const swell = 1 + Math.max(0, (14 - near) / 14) * 1.1;
      b.mesh.scale.setScalar(swell);

      if (b.ttl <= 0) { b.active = false; b.mesh.visible = false; }
    }
  }

  clear() {
    for (const b of this.bullets) { b.active = false; b.mesh.visible = false; }
  }
}
