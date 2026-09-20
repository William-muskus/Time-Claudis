import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import {
  ENEMY_TYPES, TELEGRAPH_SPLIT, STAGGER_MS,
  CARRIER_MARK_COLOR, CARRIER_PULSE_HZ,
  BOSS_PHASES, BOSS_HEAVY_TELEGRAPH_MS, BOSS_HEAVY_ROUNDS, BOSS_PHASE_GUARD_MS,
  BOSS_HEAVY_RECOVER_MS,
} from './enemyTypes.js';

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

/**
 * The flash stage is TWO HARD BEATS, not a fade. Spec §3 is explicit about
 * this and the reason is physiological rather than aesthetic: peripheral
 * vision is far more sensitive to a luminance STEP than to a luminance ramp,
 * so a blink is caught out of the corner of the eye where a fade is not.
 *
 * These two numbers are therefore the only opacities the plate may take during
 * the flash. A ~16:1 contrast between them is what makes the beat survive
 * bloom, a bright limestone façade behind it, and a player who is looking
 * somewhere else. Anything that interpolates between them has broken the spec.
 */
export const FLASH_ON_OPACITY = 1.0;
export const FLASH_OFF_OPACITY = 0.06;
/** Two beats, because one reads as a glitch and three reads as a shimmer. */
export const FLASH_BEATS = 2;
/** The plate also pops in size on the beat — scale change is caught even
 *  further out in the periphery than luminance change is. */
export const FLASH_ON_SCALE = 1.18;
/**
 * How far the plate swells at commit. Larger than FLASH_ON_SCALE on purpose:
 * the three stages must escalate in size as well as in steadiness, or the
 * moment the player most needs to read is the one that looks smallest.
 */
export const COMMIT_SCALE = 1.34;

/** Milliseconds between the rounds of a boss burst. */
export const BOSS_BURST_GAP_MS = 130;

/**
 * The cool cast on a recovering boss. Deliberately far from PALETTE.telegraph
 * on the colour wheel: in this game warm light on an enemy always means a shot
 * is coming, and the punish window must never be mistaken for one.
 */
const RECOVER_TINT = new THREE.Color('#6FD3E8');

let _nextId = 1;

export class Enemy {
  /**
   * @param {string} typeKey key into ENEMY_TYPES
   * @param {{worldPos: THREE.Vector3, type: string, facing?: THREE.Vector3}} anchor
   * @param {THREE.Vector3} playerPos
   * @param {() => number} rng
   * @param {{carries?: string}} [opts] `carries` marks this enemy as the
   *        weapon-pickup carrier for its area. See docs/GAMEPLAY.md §2.
   */
  constructor(typeKey, anchor, playerPos, rng, opts = {}) {
    this.id = `e${_nextId++}`;
    this.typeKey = typeKey;
    this.type = ENEMY_TYPES[typeKey];
    this.anchor = anchor;
    this.rng = rng;

    this.hp = this.type.hp;
    this.maxHp = this.type.hp;
    this.state = EnemyState.SPAWNING;
    this.stateTime = 0;

    /** Telegraph clock. Counts up to type.telegraphMs, then fires. */
    this.telegraphMs = 0;
    this.telegraphStage = null;
    /** Set true by the director when this enemy is allowed into commit. */
    this.commitGranted = false;
    this.shotsFired = 0;
    this.aliveTime = 0;

    /**
     * Reaction time owed on a hit. While this is running the telegraph does
     * not advance — being shot genuinely interrupts you. Spec §7.
     */
    this.staggerMs = 0;

    /** Which beat of the flash stage is showing, and whether it is lit. */
    this.flashBeat = null;
    this.flashBeatOn = false;

    /** Weapon this enemy is carrying, or null. Spec §2. */
    this.carries = opts.carries ?? null;

    this.group = buildEnemyMesh(this.type, !!this.carries);
    // Marked so the verification harness can tell an enemy hidden behind a
    // wall from one hidden behind another enemy.
    this.group.traverse((o) => { o.userData.isEnemy = true; });
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
    this.muzzleGlow = this.group.getObjectByName('muzzleGlow');
    this.carrierMark = this.group.getObjectByName('carrierMark');
    this.bodyMat = this.group.getObjectByName('torso')?.material;
    this.headMesh = this.group.getObjectByName('head');
    this.torsoMesh = this.group.getObjectByName('torso');
  }

  get isGating() { return this.type.gates; }
  get isBoss() { return !!this.type.boss; }
  get isAlive() {
    return this.state === EnemyState.SPAWNING ||
           this.state === EnemyState.ACTIVE ||
           this.state === EnemyState.WITHDRAW;
  }

  /**
   * True during the 120 ms reaction beat — either the interrupt after a
   * non-lethal hit, or the first 120 ms of the death, before the fall starts.
   * Spec §7: an enemy that vanishes on hit feels like a target, not a person.
   */
  get isStaggering() {
    if (this.state === EnemyState.DYING) return this.stateTime * 1000 < STAGGER_MS;
    return this.staggerMs > 0;
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

    this._pulseCarrierMark();

    switch (this.state) {
      case EnemyState.SPAWNING: {
        // 380 ms to rise. Fast enough to threaten, slow enough to notice.
        const t = Math.min(1, this.stateTime / 0.38);
        const eased = 1 - Math.pow(1 - t, 3);
        this.group.position.y = this.homePos.y - 1.9 * (1 - eased);
        if (t >= 1) this._enter(EnemyState.ACTIVE);
        break;
      }

      case EnemyState.ACTIVE: {
        if (this.type.charges) { this.#updateCharge(dt, playerPos, ctx); break; }
        if (this.type.strafes) this.#updateStrafe(dt);

        // A hit interrupts. The enemy flinches and its shot is delayed by
        // exactly the reaction beat — which is why suppressing a HEAVY with
        // body shots is a real tactic rather than a waste of rounds.
        if (this.staggerMs > 0) {
          this.staggerMs -= dtMs;
          this._applyStaggerVisual();
          break;
        }

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
        this._applyTelegraphVisual(stage, f);

        if (this.telegraphMs >= total) {
          ctx.onFire(this);
          this.shotsFired++;
          this.telegraphMs = 0;
          this.commitGranted = false;
          this.telegraphStage = null;
          this._applyTelegraphVisual(null, 0);

          const wantsAnother = this.rng() < this.type.doubleTapChance;
          if (!wantsAnother || this.stateTime * 1000 > this.type.exposureMs) {
            this._enter(EnemyState.WITHDRAW);
          }
        } else if (this.stateTime * 1000 > this.type.exposureMs) {
          this._enter(EnemyState.WITHDRAW);
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
        // STAGGER_MS of stagger, then the fall. Spec §7: enemies react before
        // they die. The 120 ms is held rigid — during it the body is knocked
        // back along the bullet's path but does NOT begin to topple, so the
        // hit and the death read as two separate events.
        const staggerSec = STAGGER_MS / 1000;
        if (this.stateTime < staggerSec) {
          this.group.position.copy(this.deathFrom)
            .addScaledVector(this.deathKick, this.stateTime * 2.2);
        } else {
          const ft = (this.stateTime - staggerSec) / (0.75 - staggerSec);
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

  _enter(state) {
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
   * The carrier tell.
   *
   * A slow, smooth throb — deliberately the opposite shape to the telegraph's
   * hard square beats, so the player never has to ask which signal they are
   * looking at. Blink = incoming. Throb = loot.
   */
  _pulseCarrierMark() {
    if (!this.carrierMark) return;
    const phase = this.aliveTime * CARRIER_PULSE_HZ * Math.PI * 2;
    const throb = 0.5 + 0.5 * Math.sin(phase);
    this.carrierMark.material.opacity = 0.45 + throb * 0.55;
    const s = 1 + throb * 0.18;
    this.carrierMark.scale.set(s, s, s);
    this.carrierMark.rotation.y = phase * 0.35;
  }

  /** The flinch. Read as "that landed" without reading as "that killed". */
  _applyStaggerVisual() {
    const t = 1 - this.staggerMs / STAGGER_MS;
    if (this.flashPlate) this.flashPlate.material.opacity = 0;
    if (this.muzzleGlow) this.muzzleGlow.material.opacity = 0;
    if (this.bodyMat) this.bodyMat.emissiveIntensity = 0;
    // A short rock back and return, on the same 120 ms.
    this.group.rotation.z = Math.sin(t * Math.PI) * 0.16;
  }

  /**
   * Telegraph visuals. Three escalating stages.
   *
   * Windup lives on the body (a slow emissive ramp — "deciding"), flash and
   * commit live on BOTH the chest plate and the muzzle. The chest plate is the
   * one spot the player learns to watch; the muzzle is what spec §3 actually
   * names, and it matters because at a balcony or a dormer the torso is often
   * the part that is occluded and the barrel is the part that is not.
   */
  _applyTelegraphVisual(stage, f) {
    const plate = this.flashPlate?.material;
    const glow = this.muzzleGlow?.material;

    if (stage === null) {
      this.flashBeat = null;
      this.flashBeatOn = false;
      if (plate) plate.opacity = 0;
      if (glow) glow.opacity = 0;
      if (this.flashPlate) this.flashPlate.scale.set(1, 1, 1);
      if (this.bodyMat) this.bodyMat.emissiveIntensity = 0;
      return;
    }

    if (stage === 'windup') {
      // Slow ramp. The enemy is "deciding". This is the only stage that is
      // allowed to be continuous.
      const t = f / TELEGRAPH_SPLIT.windup;
      this.flashBeat = null;
      this.flashBeatOn = false;
      if (plate) plate.opacity = t * 0.42;
      if (glow) glow.opacity = 0;
      if (this.flashPlate) this.flashPlate.scale.set(1, 1, 1);
      if (this.bodyMat) {
        this.bodyMat.emissive.copy(this.type.color);
        this.bodyMat.emissiveIntensity = t * 0.5;
      }
      return;
    }

    if (stage === 'flash') {
      // TWO HARD BEATS. The beat index is derived from wall-clock position
      // inside the stage and the output is a two-valued step function — there
      // is no interpolation anywhere in this branch, on purpose.
      const t = Math.min(0.999, Math.max(0, (f - TELEGRAPH_SPLIT.windup) / TELEGRAPH_SPLIT.flash));
      const beat = Math.floor(t * FLASH_BEATS);
      const within = t * FLASH_BEATS - beat;
      const on = within < 0.5;
      this.flashBeat = beat;
      this.flashBeatOn = on;
      const o = on ? FLASH_ON_OPACITY : FLASH_OFF_OPACITY;
      if (plate) plate.opacity = o;
      if (glow) glow.opacity = o;
      const s = on ? FLASH_ON_SCALE : 1;
      if (this.flashPlate) this.flashPlate.scale.set(s, s, 1);
      if (this.bodyMat) this.bodyMat.emissiveIntensity = on ? 1.2 : 0.15;
      return;
    }

    // Commit: solid, maximum, and it stays solid. The shot WILL fire; the
    // player's only remaining move is the duck, and a flicker here would read
    // as "maybe" at exactly the moment the answer is "yes".
    //
    // And BIGGER than the flash beats, which it was not. Commit used to reset
    // the plate to scale 1 while the flash stage had been running it at 1.38,
    // so the most urgent stage in the game was the smallest mark an enemy ever
    // made. The sequence has to grow: ramp, two hard beats, then the largest
    // and steadiest state of all.
    this.flashBeat = null;
    this.flashBeatOn = true;
    if (plate) plate.opacity = 1;
    if (glow) glow.opacity = 1;
    if (this.flashPlate) this.flashPlate.scale.set(COMMIT_SCALE, COMMIT_SCALE, 1);
    if (this.bodyMat) this.bodyMat.emissiveIntensity = 1.5;
  }

  /**
   * @returns {{killed: boolean, part: 'head'|'body', blocked?: boolean}}
   */
  takeHit(damage, part, fromDirection) {
    if (!this.isAlive) return { killed: false, part };
    this.hp -= damage;
    if (this.hp > 0) {
      // Stagger: knock the silhouette so a non-lethal hit still reads, and
      // interrupt whatever shot was being wound up.
      this.group.position.addScaledVector(fromDirection, 0.13);
      this.staggerMs = STAGGER_MS;
      return { killed: false, part };
    }
    this.deathFrom = this.group.position.clone();
    this.deathKick = fromDirection.clone().setY(0).normalize().multiplyScalar(0.5);
    this._enter(EnemyState.DYING);
    this._applyTelegraphVisual(null, 0);
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
 * LE CORBEAU — the stage boss on the Ravignan steps.
 *
 * A boss is not a big grunt. What makes the end of a Time Crisis stage feel
 * different is that the enemy stops being a timer you shoot between and starts
 * being a metronome you have to hide from: the fight has a fixed loop the
 * player can learn (volley, volley, SWEEP, cover, punish) and each phase
 * tightens that loop without changing its shape.
 *
 * The phase guard is the other half. He covers for BOSS_PHASE_GUARD_MS between
 * phases and cannot be hurt, which is what gives the player a guaranteed
 * reload window — a boss with 12 HP and a 6-round magazine is unwinnable
 * without one.
 */
export class Boss extends Enemy {
  constructor(anchor, playerPos, rng, opts = {}) {
    super('BOSS', anchor, playerPos, rng, opts);

    this.phase = 0;
    /** Ordinary volleys fired since the last heavy attack. */
    this.volleysSinceHeavy = 0;
    /** Counts down the invulnerable between-phase beat. */
    this.guardMs = 0;
    /** True while the current wind-up is the heavy sweep. */
    this.heavy = false;
    /** True on the frames the sweep is actually leaving the barrel. */
    this.firingHeavy = false;
    this.burstLeft = 0;
    this.burstTimer = 0;
    /**
     * Counts down the punish window after a volley. See BOSS_HEAVY_RECOVER_MS
     * in enemyTypes.js for why the fight is unwinnable without it.
     */
    this.recoverMs = 0;
    /** Set for one frame when the phase advances, so the director can announce. */
    this.phaseJustAdvanced = false;
  }

  get phaseSpec() { return BOSS_PHASES[this.phase]; }
  get healthFraction() { return Math.max(0, this.hp / this.maxHp); }
  get isGuarding() { return this.guardMs > 0; }
  /** The punish window: open, vulnerable, and not winding anything up. */
  get isRecovering() { return this.recoverMs > 0; }

  /** The current wind-up length: the phase's, or the sweep's if one is coming. */
  get telegraphTotalMs() {
    return this.heavy ? BOSS_HEAVY_TELEGRAPH_MS : this.phaseSpec.telegraphMs;
  }

  /** Everything the HUD needs for a boss bar. Additive; see Game.snapshot(). */
  snapshot() {
    return {
      name: this.type.name,
      hp: Math.max(0, this.hp),
      maxHp: this.maxHp,
      fraction: this.healthFraction,
      phase: this.phase + 1,
      phaseCount: BOSS_PHASES.length,
      telegraph: this.telegraphStage,
      heavyIncoming: this.heavy && this.telegraphStage !== null,
      guarding: this.isGuarding,
      recovering: this.isRecovering,
      alive: this.isAlive,
    };
  }

  update(dt, playerPos, ctx) {
    if (this.state !== EnemyState.ACTIVE) { super.update(dt, playerPos, ctx); return; }

    this.stateTime += dt;
    this.aliveTime += dt;
    const dtMs = dt * 1000;
    this.phaseJustAdvanced = false;

    // --- the between-phase guard -------------------------------------------
    if (this.guardMs > 0) {
      this.guardMs -= dtMs;
      const t = 1 - Math.max(0, this.guardMs) / BOSS_PHASE_GUARD_MS;
      // Down behind the parapet and back up, on one sine. Legible as "he is
      // covering", not as "he is dying".
      this.group.position.y = this.homePos.y - 1.15 * Math.sin(Math.min(1, t) * Math.PI);
      this.telegraphStage = null;
      this._applyTelegraphVisual(null, 0);
      if (this.guardMs <= 0) this.group.position.y = this.homePos.y;
      return;
    }

    // --- stagger ------------------------------------------------------------
    if (this.staggerMs > 0) {
      this.staggerMs -= dtMs;
      this._applyStaggerVisual();
      return;
    }
    this.group.rotation.z = 0;

    // --- the punish window --------------------------------------------------
    // Deliberately BEFORE the burst check and AFTER the stagger one: being
    // shot during recovery must not cancel it, or the player's own hits would
    // shorten the window their hits depend on.
    if (this.recoverMs > 0) {
      this.recoverMs -= dtMs;
      this.telegraphStage = null;
      this._applyTelegraphVisual(null, 0);
      this.#applyRecoverVisual();
      if (this.recoverMs <= 0) this.#clearRecoverVisual();
      return;
    }

    // --- a burst in progress ------------------------------------------------
    if (this.burstLeft > 0) {
      this.burstTimer -= dtMs;
      if (this.burstTimer <= 0) {
        ctx.onFire(this);
        this.shotsFired++;
        this.burstLeft--;
        this.burstTimer = BOSS_BURST_GAP_MS;
        if (this.burstLeft <= 0) this.#endVolley();
      }
      return;
    }

    // --- the wind-up --------------------------------------------------------
    this.telegraphMs += dtMs;
    const total = this.telegraphTotalMs;
    const f = this.telegraphMs / total;

    let stage;
    if (f < TELEGRAPH_SPLIT.windup) stage = 'windup';
    else if (f < TELEGRAPH_SPLIT.windup + TELEGRAPH_SPLIT.flash) stage = 'flash';
    else stage = 'commit';

    // The boss obeys the same fire discipline as everyone else. Spec §3 caps
    // concurrent commits at two and a boss that ignored it would make the cap
    // a lie exactly where the player most needs it to hold.
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
    this._applyTelegraphVisual(stage, f);
    if (this.heavy) this.#applyHeavyOverlay(stage);

    if (this.telegraphMs >= total) {
      this.firingHeavy = this.heavy;
      this.burstLeft = this.heavy ? BOSS_HEAVY_ROUNDS : this.phaseSpec.burst;
      this.burstTimer = 0;
      this.telegraphMs = 0;
      this.commitGranted = false;
      this.telegraphStage = null;
      this._applyTelegraphVisual(null, 0);
    }
  }

  #endVolley() {
    this.firingHeavy = false;
    // The window opens the instant the last round leaves the barrel, so it is
    // measured from there and includes that round's own flight time.
    this.recoverMs = this.heavy ? BOSS_HEAVY_RECOVER_MS : this.phaseSpec.recoverMs;
    if (this.heavy) {
      this.heavy = false;
      this.volleysSinceHeavy = 0;
    } else {
      this.volleysSinceHeavy++;
      if (this.volleysSinceHeavy >= this.phaseSpec.heavyEvery) this.heavy = true;
    }
  }

  /**
   * What the punish window looks like.
   *
   * It has to read as an INVITATION, from peripheral vision, and it must not
   * borrow any part of the telegraph's vocabulary — the flash is warm white
   * and means hide, so this is posture plus a cool cast and means shoot. He
   * drops his guard: arms down, weight forward, head low. The same read as a
   * fighter between combinations.
   *
   * Posture does the work rather than colour, because colour is the one thing
   * that can be lost — to bloom, to a bright façade behind him, to a player
   * who cannot separate warm from cool. A silhouette that changes shape is
   * legible on any background at any range this fight happens at.
   */
  #applyRecoverVisual() {
    const spec = this.heavy ? BOSS_HEAVY_RECOVER_MS : this.phaseSpec.recoverMs;
    // Slump in over the first fifth of the window and hold, so the drop is a
    // beat the player sees rather than a state they find themselves in.
    const t = Math.min(1, (spec - this.recoverMs) / (spec * 0.2));
    const ease = t * t * (3 - 2 * t);
    this.group.rotation.x = 0.17 * ease;
    this.group.position.y = this.homePos.y - 0.14 * ease;
    if (this.bodyMat) {
      this.bodyMat.emissive.copy(RECOVER_TINT);
      this.bodyMat.emissiveIntensity = 0.45 * ease;
    }
  }

  #clearRecoverVisual() {
    this.group.rotation.x = 0;
    this.group.position.y = this.homePos.y;
    if (this.bodyMat) this.bodyMat.emissiveIntensity = 0;
  }

  /**
   * The sweep's own tell, layered on top of the ordinary one: the whole body
   * lights, not just the plate. The player must be able to tell "duck or die"
   * from "duck or get hit if you are standing in the wrong place" while doing
   * something else with their hands.
   */
  #applyHeavyOverlay(stage) {
    if (!this.bodyMat) return;
    if (stage === 'windup') {
      this.bodyMat.emissive.copy(new THREE.Color(PALETTE.telegraph));
      this.bodyMat.emissiveIntensity = Math.max(this.bodyMat.emissiveIntensity, 0.8);
    } else {
      this.bodyMat.emissive.copy(new THREE.Color(PALETTE.telegraph));
      this.bodyMat.emissiveIntensity = Math.max(this.bodyMat.emissiveIntensity, 1.8);
    }
  }

  takeHit(damage, part, fromDirection) {
    // Covered between phases. Shots still land visibly — they just do not
    // count, and the player is told so by the fact that he is down.
    if (this.isGuarding) return { killed: false, part, blocked: true };
    if (!this.isAlive) return { killed: false, part };

    const before = this.phase;
    this.hp -= damage;

    if (this.hp > 0) {
      this.staggerMs = STAGGER_MS;
      const next = phaseForFraction(this.healthFraction);
      if (next > before) {
        this.phase = next;
        this.phaseJustAdvanced = true;
        this.guardMs = BOSS_PHASE_GUARD_MS;
        this.staggerMs = 0;
        this.heavy = false;
        this.firingHeavy = false;
        this.burstLeft = 0;
        this.volleysSinceHeavy = 0;
        this.telegraphMs = 0;
        this.commitGranted = false;
        this.telegraphStage = null;
        // The guard replaces the window rather than queueing behind it: two
        // vulnerable-looking beats back to back read as the fight stalling.
        this.recoverMs = 0;
        this.#clearRecoverVisual();
      }
      return { killed: false, part, phaseAdvanced: this.phaseJustAdvanced };
    }

    this.deathFrom = this.group.position.clone();
    this.deathKick = fromDirection.clone().setY(0).normalize().multiplyScalar(0.5);
    this.burstLeft = 0;
    this.firingHeavy = false;
    this.recoverMs = 0;
    this.#clearRecoverVisual();
    this._enter(EnemyState.DYING);
    this._applyTelegraphVisual(null, 0);
    return { killed: true, part };
  }
}

/** Which phase a given health fraction belongs to. */
export function phaseForFraction(fraction) {
  let idx = 0;
  for (let i = 0; i < BOSS_PHASES.length; i++) {
    if (fraction <= BOSS_PHASES[i].from) idx = i;
  }
  return idx;
}

/**
 * The enemy silhouette.
 *
 * Built from six masses, chosen so the shape reads instantly at 20 m against a
 * busy limestone façade: a wide torso, a distinctly lighter head, two arms held
 * forward (which is what makes a figure read as ARMED rather than as a
 * pedestrian), and a bright chest plate that is the telegraph.
 */
function buildEnemyMesh(type, carrier = false) {
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
  // Sized against the torso (0.62 wide), not against realism. The plate is the
  // single most important pixel in the game and it has to survive being twenty
  // pixels tall; at 0.40 it covered under two thirds of the chest and read as
  // a badge rather than as the enemy lighting up.
  //
  // And sized so that COMMIT_SCALE lands it at exactly the torso width, no
  // wider. The first attempt at making it unmissable overshot: at commit the
  // plate was broader than the enemy and every one of them turned into an
  // identical pale rectangle. Colour is information in this game, and losing
  // which class is shooting at you is too high a price for a brighter flash.
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.46 * s, 0.38 * s, 0.06 * s),
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

  // The muzzle bloom. Spec §3 puts the flash on the muzzle, and it earns its
  // place separately from the chest plate: on a balcony or behind a parapet
  // the torso is the part that gets occluded and the barrel is not.
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16 * s, 7, 6),
    new THREE.MeshBasicMaterial({
      color: PALETTE.telegraph, transparent: true, opacity: 0, toneMapped: false,
      depthWrite: false,
    }));
  muzzle.name = 'muzzleGlow';
  muzzle.position.set(0.2 * s, 1.24 * s, 0.74 * s);
  g.add(muzzle);

  if (carrier) {
    // A chevron floating over the head, in a colour no enemy class uses, so
    // "this one is holding the shotgun" is answerable from the silhouette
    // alone at any range the fight happens at.
    const mark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22 * s, 0),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CARRIER_MARK_COLOR),
        transparent: true, opacity: 1, toneMapped: false, depthWrite: false,
      }));
    mark.name = 'carrierMark';
    mark.position.set(0, 2.16 * s, 0);
    g.add(mark);

    // And a band across the chest, because a floating marker alone can be
    // read as HUD rather than as part of the person carrying the thing.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.66 * s, 0.1 * s, 0.4 * s),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CARRIER_MARK_COLOR), toneMapped: false,
      }));
    band.position.set(0, 0.92 * s, 0);
    g.add(band);
  }

  if (type.boss) {
    // Le Corbeau: the wide brim and the shoulders. A boss must be identifiable
    // as a different KIND of thing in one frame, from its outline, before any
    // health bar has been read.
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46 * s, 0.5 * s, 0.07 * s, 8), darkMat);
    brim.position.y = 1.79 * s;
    brim.castShadow = true;
    g.add(brim);

    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(
        new THREE.BoxGeometry(0.26 * s, 0.22 * s, 0.42 * s), darkMat);
      pauldron.position.set(side * 0.46 * s, 1.44 * s, 0.06 * s);
      pauldron.castShadow = true;
      g.add(pauldron);
    }

    const coat = new THREE.Mesh(
      new THREE.BoxGeometry(0.78 * s, 0.9 * s, 0.14 * s), darkMat);
    coat.position.set(0, 0.92 * s, -0.24 * s);
    coat.castShadow = true;
    g.add(coat);
  }

  return g;
}
