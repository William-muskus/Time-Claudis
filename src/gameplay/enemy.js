import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import { ENEMY_TYPES, TELEGRAPH_SPLIT } from './enemyTypes.js';

/**
 * One enemy.
 *
 * THE TELEGRAPH IS THE WHOLE JOB. An enemy in this game is a timer with a
 * silhouette attached. The mesh exists so the player can read the timer at a
 * glance, from the corner of their eye, with the sound off. Everything about
 * the model — the ochre torso, the white flash plate on the chest, the fact
 * that the head is a separate lighter mass — exists to serve legibility, not
 * fidelity.
 *
 * Lifecycle:
 *   SPAWNING  rising out of the anchor (door, balcony, alley, roof)
 *   ACTIVE    windup → flash → commit → fire, then maybe again
 *   WITHDRAW  ducking back out of sight; counts as neither alive nor killed
 *   DYING     staggered, falling
 *   DEAD      ready for removal
 */

export const EnemyState = {
  SPAWNING: 'SPAWNING',
  ACTIVE: 'ACTIVE',
  WITHDRAW: 'WITHDRAW',
  DYING: 'DYING',
  DEAD: 'DEAD',
};

let _nextId = 1;

export class Enemy {
  /**
   * @param {string} typeKey key into ENEMY_TYPES
   * @param {{worldPos: THREE.Vector3, type: string, facing?: THREE.Vector3}} anchor
   * @param {THREE.Vector3} playerPos
   * @param {() => number} rng
   */
  constructor(typeKey, anchor, playerPos, rng) {
    this.id = `e${_nextId++}`;
    this.typeKey = typeKey;
    this.type = ENEMY_TYPES[typeKey];
    this.anchor = anchor;
    this.rng = rng;

    this.hp = this.type.hp;
    this.state = EnemyState.SPAWNING;
    this.stateTime = 0;

    /** Telegraph clock. Counts up to type.telegraphMs, then fires. */
    this.telegraphMs = 0;
    this.telegraphStage = null;
    /** Set true by the director when this enemy is allowed into commit. */
    this.commitGranted = false;
    this.shotsFired = 0;
    this.aliveTime = 0;

    this.group = buildEnemyMesh(this.type);
    this.group.userData.enemy = this;

    // Spawn below/behind the anchor and rise into place — nobody in Time
    // Crisis fades in, they come OUT of somewhere.
    this.homePos = anchor.worldPos.clone();
    this.group.position.copy(this.homePos);
    this.group.position.y -= 1.9;

    // Face the player.
    const look = playerPos.clone();
    look.y = this.homePos.y;
    this.group.lookAt(look);

    // Strafing enemies pick a lateral track across their anchor.
    if (this.type.strafes) {
      const side = rng() < 0.5 ? -1 : 1;
      this.strafeAxis = new THREE.Vector3(0, 1, 0)
        .cross(look.clone().sub(this.homePos).normalize()).normalize()
        .multiplyScalar(side);
      this.strafePhase = rng() * Math.PI * 2;
      this.strafeRange = 1.2 + rng() * 1.4;
    }

    /** Cached refs for the telegraph visuals. */
    this.flashPlate = this.group.getObjectByName('flashPlate');
    this.bodyMat = this.group.getObjectByName('torso')?.material;
    this.headMesh = this.group.getObjectByName('head');
    this.torsoMesh = this.group.getObjectByName('torso');
  }

  get isGating() { return this.type.gates; }
  get isAlive() {
    return this.state === EnemyState.SPAWNING ||
           this.state === EnemyState.ACTIVE ||
           this.state === EnemyState.WITHDRAW;
  }

  /** World position of the muzzle, for tracer origins. */
  muzzlePosition(out = new THREE.Vector3()) {
    return out.copy(this.group.position).add(new THREE.Vector3(0, 1.25, 0));
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} playerPos
   * @param {{grantCommit: (e: Enemy) => boolean, onFire: (e: Enemy) => void}} ctx
   */
  update(dt, playerPos, ctx) {
    this.stateTime += dt;
    this.aliveTime += dt;
    const dtMs = dt * 1000;

    switch (this.state) {
      case EnemyState.SPAWNING: {
        // 380 ms to rise. Fast enough to threaten, slow enough to notice.
        const t = Math.min(1, this.stateTime / 0.38);
        const eased = 1 - Math.pow(1 - t, 3);
        this.group.position.y = this.homePos.y - 1.9 * (1 - eased);
        if (t >= 1) this.#enter(EnemyState.ACTIVE);
        break;
      }

      case EnemyState.ACTIVE: {
        if (this.type.charges) { this.#updateCharge(dt, playerPos, ctx); break; }
        if (this.type.strafes) this.#updateStrafe(dt);

        this.telegraphMs += dtMs;
        const total = this.type.telegraphMs;
        const f = this.telegraphMs / total;

        let stage;
        if (f < TELEGRAPH_SPLIT.windup) stage = 'windup';
        else if (f < TELEGRAPH_SPLIT.windup + TELEGRAPH_SPLIT.flash) stage = 'flash';
        else stage = 'commit';

        // The fire-discipline gate. If the director will not let us commit, we
        // hold at the top of the flash stage and re-roll rather than stacking
        // an unduckable third shot on the player. Spec §3.
        if (stage === 'commit' && !this.commitGranted) {
          if (ctx.grantCommit(this)) {
            this.commitGranted = true;
          } else {
            this.telegraphMs = total * (TELEGRAPH_SPLIT.windup + TELEGRAPH_SPLIT.flash * 0.55);
            stage = 'flash';
          }
        }

        if (stage !== this.telegraphStage) {
          this.telegraphStage = stage;
          ctx.onStage?.(this, stage);
        }
        this.#applyTelegraphVisual(stage, f);

        if (this.telegraphMs >= total) {
          ctx.onFire(this);
          this.shotsFired++;
          this.telegraphMs = 0;
          this.commitGranted = false;
          this.telegraphStage = null;
          this.#applyTelegraphVisual(null, 0);

          const wantsAnother = this.rng() < this.type.doubleTapChance;
          if (!wantsAnother || this.stateTime * 1000 > this.type.exposureMs) {
            this.#enter(EnemyState.WITHDRAW);
          }
        } else if (this.stateTime * 1000 > this.type.exposureMs) {
          this.#enter(EnemyState.WITHDRAW);
        }
        break;
      }

      case EnemyState.WITHDRAW: {
        const t = Math.min(1, this.stateTime / 0.42);
        this.group.position.y = this.homePos.y - 1.9 * t;
        if (t >= 1) this.state = EnemyState.DEAD;   // gone, not killed
        break;
      }

      case EnemyState.DYING: {
        const t = Math.min(1, this.stateTime / 0.75);
        // 120 ms of stagger, then the fall. Spec §7: enemies react before
        // they die.
        if (this.stateTime < 0.12) {
          this.group.position.copy(this.deathFrom)
            .addScaledVector(this.deathKick, this.stateTime * 2.2);
        } else {
          const ft = (this.stateTime - 0.12) / 0.63;
          this.group.rotation.x = -ft * Math.PI * 0.48;
          this.group.position.y = this.deathFrom.y - ft * 0.55;
          this.group.position.x = this.deathFrom.x + this.deathKick.x * 0.26;
          this.group.position.z = this.deathFrom.z + this.deathKick.z * 0.26;
        }
        if (t >= 1) this.state = EnemyState.DEAD;
        break;
      }
    }
  }

  #enter(state) {
    this.state = state;
    this.stateTime = 0;
  }

  #updateStrafe(dt) {
    this.strafePhase += dt * this.type.speed * 0.8;
    const off = Math.sin(this.strafePhase) * this.strafeRange;
    this.group.position.x = this.homePos.x + this.strafeAxis.x * off;
    this.group.position.z = this.homePos.z + this.strafeAxis.z * off;
  }

  /** Bombers sprint the whole way in and detonate on contact. */
  #updateCharge(dt, playerPos, ctx) {
    const to = playerPos.clone().sub(this.group.position);
    to.y = 0;
    const dist = to.length();
    if (dist < 1.8) {
      ctx.onFire(this);
      this.state = EnemyState.DEAD;
      return;
    }
    to.normalize();
    this.group.position.addScaledVector(to, this.type.speed * dt);
    this.group.lookAt(playerPos.x, this.group.position.y, playerPos.z);
    // A hard pulse so a charging bomber is never a surprise.
    const pulse = 0.5 + 0.5 * Math.sin(this.aliveTime * 16);
    if (this.flashPlate) this.flashPlate.material.opacity = 0.25 + pulse * 0.75;
  }

  /**
   * Telegraph visuals. Three escalating stages, all on the same chest plate so
   * the player only ever has to watch one spot on an enemy.
   */
  #applyTelegraphVisual(stage, f) {
    if (!this.flashPlate) return;
    const m = this.flashPlate.material;

    if (stage === null) {
      m.opacity = 0;
      if (this.bodyMat) this.bodyMat.emissiveIntensity = 0;
      return;
    }
    if (stage === 'windup') {
      // Slow ramp. The enemy is "deciding".
      const t = f / TELEGRAPH_SPLIT.windup;
      m.opacity = t * 0.42;
      if (this.bodyMat) {
        this.bodyMat.emissive.copy(this.type.color);
        this.bodyMat.emissiveIntensity = t * 0.5;
      }
    } else if (stage === 'flash') {
      // Two hard beats. Discrete, not a fade — the eye catches a blink far
      // better than a ramp, and this is the stage that has to be caught.
      const t = (f - TELEGRAPH_SPLIT.windup) / TELEGRAPH_SPLIT.flash;
      const beat = Math.sin(t * Math.PI * 4) > 0 ? 1 : 0.22;
      m.opacity = 0.45 + beat * 0.55;
      if (this.bodyMat) this.bodyMat.emissiveIntensity = 0.5 + beat * 0.7;
    } else {
      // Commit: solid, maximum. The shot is coming.
      m.opacity = 1;
      if (this.bodyMat) this.bodyMat.emissiveIntensity = 1.5;
    }
  }

  /**
   * @returns {{killed: boolean, part: 'head'|'body'}}
   */
  takeHit(damage, part, fromDirection) {
    if (!this.isAlive) return { killed: false, part };
    this.hp -= damage;
    if (this.hp > 0) {
      // Stagger: knock the silhouette so a non-lethal hit still reads.
      this.group.position.addScaledVector(fromDirection, 0.13);
      return { killed: false, part };
    }
    this.deathFrom = this.group.position.clone();
    this.deathKick = fromDirection.clone().setY(0).normalize().multiplyScalar(0.5);
    this.#enter(EnemyState.DYING);
    if (this.flashPlate) this.flashPlate.material.opacity = 0;
    if (this.bodyMat) this.bodyMat.emissiveIntensity = 0;
    return { killed: true, part };
  }

  /** Axis-aligned hit volumes: head and body. Head is worth double. */
  hitBoxes() {
    const p = this.group.position;
    const s = this.type.scale ?? 1;
    return [
      { part: 'head', center: new THREE.Vector3(p.x, p.y + 1.62 * s, p.z), radius: 0.19 * s },
      { part: 'body', center: new THREE.Vector3(p.x, p.y + 0.95 * s, p.z), radius: 0.42 * s },
    ];
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}

/**
 * The enemy silhouette.
 *
 * Built from six masses, chosen so the shape reads instantly at 20 m against a
 * busy limestone façade: a wide torso, a distinctly lighter head, two arms held
 * forward (which is what makes a figure read as ARMED rather than as a
 * pedestrian), and a bright chest plate that is the telegraph.
 */
function buildEnemyMesh(type) {
  const g = new THREE.Group();
  const s = type.scale ?? 1;

  const bodyMat = flat(type.color, { roughness: 0.72 });
  const darkMat = flat(PALETTE.ironwork, { roughness: 0.68 });
  const skinMat = flat(PALETTE.plasterCream, { roughness: 0.85 });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.78 * s, 0.3 * s), darkMat);
  legs.position.y = 0.39 * s;
  legs.castShadow = true;
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s, 0.78 * s, 0.36 * s), bodyMat);
  torso.name = 'torso';
  torso.position.y = 1.14 * s;
  torso.castShadow = true;
  g.add(torso);

  // The telegraph plate. Always PALETTE.telegraph, never the class colour —
  // the player learns one flash, not six.
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.40 * s, 0.34 * s, 0.06 * s),
    new THREE.MeshBasicMaterial({
      color: PALETTE.telegraph, transparent: true, opacity: 0, toneMapped: false,
    }));
  plate.name = 'flashPlate';
  plate.position.set(0, 1.18 * s, 0.2 * s);
  g.add(plate);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.32 * s, 0.3 * s), skinMat);
  head.name = 'head';
  head.position.y = 1.62 * s;
  head.castShadow = true;
  g.add(head);

  // A cap in the class colour, so the head still carries class information.
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.33 * s, 0.11 * s, 0.33 * s), bodyMat);
  cap.position.y = 1.8 * s;
  cap.castShadow = true;
  g.add(cap);

  // Arms forward. This is the pose that says "armed".
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15 * s, 0.15 * s, 0.52 * s), bodyMat);
    arm.position.set(side * 0.34 * s, 1.24 * s, 0.22 * s);
    arm.castShadow = true;
    g.add(arm);
  }

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 0.11 * s, 0.44 * s), darkMat);
  gun.position.set(0.2 * s, 1.24 * s, 0.5 * s);
  gun.castShadow = true;
  g.add(gun);

  return g;
}
