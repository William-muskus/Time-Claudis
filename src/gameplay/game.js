import * as THREE from 'three';
import { CoverController } from '../core/cover.js';
import { WeaponSystem } from './weapons.js';
import { Director, DirectorState } from './director.js';
import { Effects, BulletPool } from './effects.js';
import { ENEMY_BULLET_SPEED } from './enemyTypes.js';
import { makeRng } from '../core/rng.js';

/**
 * The game.
 *
 * The update order in `update()` is the contract from docs/ARCHITECTURE.md and
 * it is load-bearing. Cover resolves before anything asks whether the player
 * can shoot or be shot, because a one-frame window where a ducked player still
 * takes the hit reads, correctly, as the game cheating.
 */

export const AIM_FORGIVENESS_DEG = 1.4;   // spec §8: forgiveness, not magnetism
export const HITSTOP_MS = 45;
export const HITSTOP_HEAD_MS = 80;
export const IFRAME_MS = 1200;
export const START_LIVES = 3;

export class Game {
  constructor({ scene, camera, railCamera, rail, anchors, bus, seed = 0xA11CE }) {
    this.scene = scene;
    this.camera = camera;
    this.railCamera = railCamera;
    this.rail = rail;
    this.bus = bus;
    this.rng = makeRng(seed);

    this.cover = new CoverController();
    this.weapons = new WeaponSystem(bus);
    this.effects = new Effects(scene);
    this.bullets = new BulletPool(scene);
    this.director = new Director({ scene, railCamera, rail, anchors, bus, rng: this.rng });

    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lives = START_LIVES;
    this.nowMs = 0;
    this.hitstopMs = 0;
    this.iframeMs = 0;
    this.gameOver = false;

    /** Normalised crosshair, 0..1, set by the input layer each frame. */
    this.crosshair = { x: 0.5, y: 0.5 };

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._v = new THREE.Vector3();

    this.#wireScoring();
  }

  get multiplier() { return Math.min(8, 1 + Math.floor(this.combo / 5)); }

  #wireScoring() {
    this.bus.on('area.cleared', ({ bonus, noHit }) => {
      this.score += bonus + (noHit ? 5000 : 0);
    });
  }

  /**
   * @param {number} dtRaw seconds
   * @param {{aim:{x,y}, fired:boolean, gunUp:boolean, present:boolean}} intent
   */
  update(dtRaw, intent) {
    this.nowMs += dtRaw * 1000;

    // --- hitstop ----------------------------------------------------------
    // Freeze the simulation, not the clock. The bite comes from the world
    // stopping while the player's own input keeps being sampled.
    if (this.hitstopMs > 0) {
      this.hitstopMs -= dtRaw * 1000;
      this.crosshair = intent.aim;
      this.railCamera.update(dtRaw, this.cover.exposure);
      this.effects.update(dtRaw * 0.15);
      return;
    }
    const dt = Math.min(dtRaw, 1 / 20);   // never let a stall teleport a bullet

    // --- 1. input ---------------------------------------------------------
    this.crosshair = intent.aim;

    // --- 2. cover ---------------------------------------------------------
    // The gun being DOWN is the request to be out of cover. Gun up = duck.
    const wantsOut = intent.present && !intent.gunUp && !this.gameOver &&
                     this.director.state === DirectorState.FIGHTING;
    const prevState = this.cover.state;
    this.cover.update(dt, wantsOut);
    if (prevState !== this.cover.state) {
      this.bus.emit('cover.changed', { state: this.cover.state, previous: prevState });
    }

    if (this.iframeMs > 0) this.iframeMs -= dt * 1000;

    // --- reload happens by being in cover, and only there ------------------
    this.weapons.update(this.nowMs, this.cover.timeInCoverMs);

    if (this.gameOver) {
      this.railCamera.update(dt, this.cover.exposure);
      this.effects.update(dt);
      return;
    }

    // --- 3 + 4. director and enemies --------------------------------------
    const playerPos = this.camera.position;
    const cameraFwd = this.railCamera.forward(this._v).clone();
    this.director.update(dt, {
      playerPos,
      cameraFwd,
      onEnemyFire: (e) => this.#enemyFires(e, playerPos),
    });

    // --- 5. the player's shot ---------------------------------------------
    if (intent.fired && this.cover.canShoot() &&
        this.director.state === DirectorState.FIGHTING) {
      this.#playerShoots();
    }

    // --- 6. enemy bullets -------------------------------------------------
    this.bullets.update(
      dt, playerPos,
      () => this.cover.isVulnerable() && this.iframeMs <= 0,
      (ownerId) => this.#playerHit(ownerId),
    );

    // --- 7. camera --------------------------------------------------------
    this.railCamera.update(dt, this.cover.exposure);

    this.effects.update(dt);
  }

  // -------------------------------------------------------------------------

  #playerShoots() {
    const pellets = this.weapons.tryFire(this.nowMs);
    if (pellets <= 0) return;

    const spec = this.weapons.spec;
    this.bus.emit('shot.fired', { weapon: this.weapons.current, rounds: this.weapons.rounds });

    const origin = this.camera.position.clone();
    const right = new THREE.Vector3().crossVectors(
      this.railCamera.forward(new THREE.Vector3()), new THREE.Vector3(0, 1, 0)).normalize();

    // Muzzle flash and brass, once per trigger break rather than per pellet.
    const muzzleAt = origin.clone()
      .addScaledVector(this.railCamera.forward(new THREE.Vector3()), 0.55)
      .addScaledVector(right, 0.22);
    muzzleAt.y -= 0.18;
    this.effects.flashMuzzle(muzzleAt, 6);
    this.effects.ejectShell(muzzleAt, right, this.rng);
    this.railCamera.addShake(spec.name === 'SHOTGUN' ? 0.32 : 0.15);

    let anyHit = false;
    for (let p = 0; p < pellets; p++) {
      const hit = this.#traceShot(spec, p, muzzleAt);
      if (hit) anyHit = true;
    }

    if (anyHit) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    } else {
      // Spec §6: a miss resets the combo. Shots swallowed while covered are
      // never counted, because canShoot() gated us out long before here.
      this.combo = 0;
      this.bus.emit('shot.miss', {});
    }
  }

  /** One pellet. Returns true if it connected with an enemy. */
  #traceShot(spec, pelletIndex, muzzleAt) {
    // Crosshair → NDC. y is flipped because screen space grows downward.
    this._ndc.set(this.crosshair.x * 2 - 1, -(this.crosshair.y * 2 - 1));

    if (spec.spreadDeg > 0) {
      const s = THREE.MathUtils.degToRad(spec.spreadDeg);
      // First pellet of a shotgun goes dead centre so aiming still rewards.
      const scale = pelletIndex === 0 && spec.pellets > 1 ? 0 : 1;
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * s * scale;
      this._ndc.x += Math.cos(a) * r;
      this._ndc.y += Math.sin(a) * r;
    }

    this._ray.setFromCamera(this._ndc, this.camera);
    const ro = this._ray.ray.origin, rd = this._ray.ray.direction;

    // Sphere hit test against every live enemy, nearest wins. A raycast against
    // the mesh graph would be both slower and worse — we want deliberate,
    // readable head and body volumes, not per-triangle accuracy.
    const forgiveness = Math.tan(THREE.MathUtils.degToRad(AIM_FORGIVENESS_DEG));
    let best = null;
    for (const e of this.director.targets()) {
      for (const box of e.hitBoxes()) {
        const toC = box.center.clone().sub(ro);
        const along = toC.dot(rd);
        if (along <= 0) continue;
        const perp = toC.clone().addScaledVector(rd, -along).length();
        const radius = box.radius + along * forgiveness;
        if (perp > radius) continue;
        if (!best || along < best.along) best = { enemy: e, part: box.part, along, center: box.center };
      }
    }

    if (!best) {
      // Where did it land? Draw the tracer to the first piece of world it hits
      // so a miss still reads as a miss on a wall, not as nothing at all.
      const end = ro.clone().addScaledVector(rd, 60);
      this.effects.spawnTracer(muzzleAt, end);
      this.effects.burst(end, rd.clone().negate(), 'stone', this.rng);
      return false;
    }

    const impact = ro.clone().addScaledVector(rd, best.along);
    this.effects.spawnTracer(muzzleAt, impact);

    const dmg = spec.damage * (best.part === 'head' ? 2 : 1);
    const res = best.enemy.takeHit(dmg, best.part, rd.clone());
    this.effects.burst(impact, rd.clone().negate(), best.part === 'head' ? 'head' : 'body', this.rng);

    this.hitstopMs = best.part === 'head' ? HITSTOP_HEAD_MS : HITSTOP_MS;
    this.bus.emit('shot.hit', {
      enemyId: best.enemy.id, part: best.part, worldPos: impact, killed: res.killed,
    });

    if (res.killed) {
      const base = best.enemy.type.score * (best.part === 'head' ? 2 : 1);
      const gained = base * this.multiplier;
      this.score += gained;
      this.bus.emit('enemy.killed', {
        id: best.enemy.id, class: best.enemy.typeKey, part: best.part,
        score: gained, multiplier: this.multiplier, worldPos: impact,
      });
    }
    return true;
  }

  #enemyFires(enemy, playerPos) {
    if (enemy.type.charges) {
      // A bomber detonating. No projectile — contact is the hit.
      this.effects.burst(enemy.group.position.clone(), new THREE.Vector3(0, 1, 0), 'body', this.rng);
      this.railCamera.addShake(0.5);
      if (this.cover.isVulnerable() && this.iframeMs <= 0) this.#playerHit(enemy.id);
      this.bus.emit('enemy.detonated', { id: enemy.id });
      return;
    }
    const from = enemy.muzzlePosition();
    this.effects.flashMuzzle(from, 3);
    this.effects.spawnTracer(from, playerPos.clone(), undefined, 0.06);
    this.bullets.fire(from, playerPos.clone(), ENEMY_BULLET_SPEED, enemy.id);
    this.bus.emit('enemy.fired', { id: enemy.id, worldPos: from.clone() });
  }

  #playerHit(byEnemyId) {
    if (this.iframeMs > 0) return;
    this.lives--;
    this.combo = 0;
    this.iframeMs = IFRAME_MS;
    this.director.tookHitThisArea = true;
    // Spec §5: you are never killed twice by the same volley. Force the duck
    // and clear everything already in the air.
    this.cover.forceCover();
    this.bullets.clear();
    this.railCamera.addShake(1.1);
    this.hitstopMs = 90;
    this.bus.emit('player.hit', { byEnemyId, livesLeft: this.lives });

    if (this.lives <= 0) {
      this.gameOver = true;
      this.bus.emit('game.over', { score: this.score, bestCombo: this.bestCombo });
    } else {
      this.bus.emit('player.died', { livesLeft: this.lives });
    }
  }

  /** Current state for the HUD. */
  snapshot() {
    return {
      score: this.score,
      combo: this.combo,
      multiplier: this.multiplier,
      lives: this.lives,
      rounds: this.weapons.rounds,
      magSize: this.weapons.spec.mag,
      weapon: this.weapons.spec.name,
      timeLeft: this.director.timeLeft,
      coverState: this.cover.state,
      exposure: this.cover.exposure,
      area: this.director.area?.name ?? '',
      areaId: this.director.area?.areaId ?? '',
      areaIndex: this.director.areaIndex,
      directorState: this.director.state,
      gatingAlive: this.director.gatingAlive,
      gameOver: this.gameOver,
      iframe: this.iframeMs > 0,
      reloading: this.cover.state === 'COVERED' &&
                 this.weapons.rounds < this.weapons.spec.mag,
      reloadProgress: Math.min(1, this.cover.timeInCoverMs / this.weapons.spec.reloadMs),
    };
  }
}
