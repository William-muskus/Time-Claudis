import * as THREE from 'three';
import { Enemy, Boss, EnemyState } from './enemy.js';
import { ENCOUNTERS } from './encounters.js';
import { MAX_CONCURRENT_COMMIT } from './enemyTypes.js';
import { AREAS } from '../data/route.js';

/**
 * The director.
 *
 * Owns the area state machine, the clock, the spawn schedule and — most
 * importantly — fire discipline. It is the thing that makes the game FAIR,
 * which is the thing that makes it feel like Time Crisis rather than like
 * being ambushed.
 *
 *   TRAVELLING  camera moving to the next node. Player cannot be hurt.
 *   FIGHTING    waves running. The clock is live.
 *   CLEARED     banner, cleanup, then travel.
 *   FAILED      timer hit zero or lives exhausted.
 */

export const DirectorState = {
  TRAVELLING: 'TRAVELLING',
  FIGHTING: 'FIGHTING',
  CLEARED: 'CLEARED',
  FAILED: 'FAILED',
  COMPLETE: 'COMPLETE',
};

export class Director {
  /**
   * @param {object} deps
   * @param {THREE.Scene} deps.scene
   * @param {import('../rail/camera.js').RailCamera} deps.railCamera
   * @param {import('../core/spline.js').Rail} deps.rail
   * @param {Array} deps.anchors
   * @param {import('../core/events.js').EventBus} deps.bus
   * @param {() => number} deps.rng
   */
  constructor({ scene, railCamera, rail, anchors, bus, rng }) {
    this.scene = scene;
    this.railCamera = railCamera;
    this.rail = rail;
    this.anchors = anchors;
    this.bus = bus;
    this.rng = rng;

    this.areaIndex = -1;
    this.state = DirectorState.TRAVELLING;
    this.stateTime = 0;

    /** @type {Enemy[]} */
    this.enemies = [];
    this.timeLeft = 0;
    this.areaStartedAt = 0;
    this.tookHitThisArea = false;
    this.pendingWaves = [];
    this.areaClock = 0;

    this.committed = new Set();

    this.#beginArea(0);
  }

  get area() { return ENCOUNTERS[this.areaIndex]; }
  get areaMeta() { return AREAS[this.areaIndex]; }
  get isFinished() { return this.state === DirectorState.COMPLETE || this.state === DirectorState.FAILED; }

  /** Gating enemies still alive. The area clears when this hits zero. */
  get gatingAlive() {
    return this.enemies.filter((e) => e.isGating && e.isAlive &&
      e.state !== EnemyState.WITHDRAW).length;
  }

  #beginArea(index) {
    if (index >= ENCOUNTERS.length) {
      this.state = DirectorState.COMPLETE;
      this.bus.emit('stage.complete', {});
      return;
    }
    this.areaIndex = index;
    const a = this.area;
    const d = this.rail.distanceToWaypoint(a.waypoint);
    this.railCamera.travelTo(d, a.node);
    this.state = DirectorState.TRAVELLING;
    this.stateTime = 0;
  }

  #startFight() {
    const a = this.area;
    this.state = DirectorState.FIGHTING;
    this.stateTime = 0;
    this.areaClock = 0;
    this.timeLeft = this.areaMeta.par;
    this.tookHitThisArea = false;
    this.pendingWaves = a.waves.map((w) => ({ ...w, fired: false }));
    this.bus.emit('area.started', {
      areaId: a.areaId, name: a.name, par: this.areaMeta.par, index: this.areaIndex,
    });
  }

  /**
   * Choose an anchor for a spawn.
   *
   * Constraints, in priority order:
   *   1. the anchor must be of a type the wave allows (a doorway spawn really
   *      does come out of a doorway);
   *   2. it must be within a sensible engagement band of the camera — close
   *      enough to threaten, far enough that the player can react;
   *   3. it must be on the requested side of the street, if one was requested;
   *   4. it must be in front of the camera, not behind it.
   *
   * If nothing satisfies all four we relax the side constraint before we relax
   * the anchor type, because an enemy on the wrong side of the street is a
   * pacing problem while an enemy materialising out of a blank wall is a
   * credibility problem.
   */
  #pickAnchor(spawn, cameraPos, cameraFwd) {
    const NEAR = 8, FAR = 34;
    const types = new Set(spawn.anchorTypes);

    const scored = [];
    for (const a of this.anchors) {
      if (!types.has(a.type)) continue;
      if (!a.worldPos) continue;
      const to = a.worldPos.clone().sub(cameraPos);
      const dist = to.length();
      if (dist < NEAR || dist > FAR) continue;
      to.normalize();
      const facing = to.dot(cameraFwd);
      if (facing < 0.25) continue;                  // behind or hard side-on
      if (this.occupied?.has(a.id)) continue;

      let score = facing * 2.0 - Math.abs(dist - 19) * 0.04;
      if (spawn.side && a.side === spawn.side) score += 1.2;
      else if (spawn.side && a.side === -spawn.side) score -= 0.8;
      // Snipers want height; everyone else wants to not be on a roof.
      const high = a.worldPos.y - cameraPos.y;
      if (spawn.type === 'SNIPER') score += Math.min(high, 12) * 0.22;
      else score -= Math.max(0, high - 4) * 0.3;
      score += this.rng() * 0.6;
      scored.push({ a, score });
    }
    if (!scored.length) return null;
    scored.sort((x, y) => y.score - x.score);
    return scored[0].a;
  }

  #spawn(spawn, cameraPos, cameraFwd) {
    const anchor = this.#pickAnchor(spawn, cameraPos, cameraFwd);
    if (!anchor) return null;
    this.occupied ??= new Set();
    this.occupied.add(anchor.id);

    // The boss is its own class with phases and a guard cycle; everything else
    // is a plain Enemy. Choosing here rather than inside Enemy keeps the base
    // class free of any knowledge that a boss exists.
    const e = spawn.type === 'BOSS'
      ? new Boss(anchor, cameraPos, this.rng)
      : new Enemy(spawn.type, anchor, cameraPos, this.rng);

    // Weapon carriers. In Time Crisis a pickup is carried by a specific enemy
    // who is visibly marked, and killing them drops it. That is much better
    // than a floating crate: it makes the pickup a TARGET rather than a place,
    // which is the only verb this game has.
    if (spawn.carries) e.carries = spawn.carries;
    this.scene.add(e.group);
    this.enemies.push(e);
    this.bus.emit('enemy.spawned', {
      id: e.id, class: spawn.type, worldPos: anchor.worldPos.clone(),
      anchorType: anchor.type, carries: e.carries ?? null, isBoss: !!e.isBoss,
    });
    return e;
  }

  /**
   * Fire discipline. At most MAX_CONCURRENT_COMMIT enemies may have a shot
   * actually in flight toward the player at once. Without this the game
   * degenerates into a coin flip; with it every death is the player's error.
   */
  #grantCommit(enemy) {
    for (const id of [...this.committed]) {
      const still = this.enemies.find((e) => e.id === id);
      if (!still || !still.isAlive || still.telegraphStage !== 'commit') {
        this.committed.delete(id);
      }
    }
    if (this.committed.size >= MAX_CONCURRENT_COMMIT) return false;
    this.committed.add(enemy.id);
    return true;
  }

  /**
   * @param {number} dt
   * @param {object} ctx { onEnemyFire, playerPos, cameraFwd, paused }
   */
  update(dt, ctx) {
    this.stateTime += dt;

    switch (this.state) {
      case DirectorState.TRAVELLING:
        if (!this.railCamera.isTravelling && this.stateTime > 0.35) this.#startFight();
        break;

      case DirectorState.FIGHTING: {
        this.areaClock += dt;
        this.timeLeft = Math.max(0, this.timeLeft - dt);

        // Release scheduled waves.
        for (const w of this.pendingWaves) {
          if (w.fired || this.areaClock < w.at) continue;
          w.fired = true;
          for (const s of w.spawns) this.#spawn(s, ctx.playerPos, ctx.cameraFwd);
        }

        // If every wave has gone and nothing is gating us, the area is done.
        const allWavesOut = this.pendingWaves.every((w) => w.fired);
        if (allWavesOut && this.gatingAlive === 0 && this.enemies.every((e) => !e.isAlive || !e.isGating)) {
          this.#clear();
          break;
        }

        if (this.timeLeft <= 0) {
          this.bus.emit('area.timeout', { areaId: this.area.areaId });
          this.state = DirectorState.FAILED;
          this.stateTime = 0;
        }
        break;
      }

      case DirectorState.CLEARED:
        // Hold on the banner, then move up.
        if (this.stateTime > 2.1) {
          this.#despawnAll();
          this.#beginArea(this.areaIndex + 1);
        }
        break;
    }

    this.#updateEnemies(dt, ctx);
  }

  #updateEnemies(dt, ctx) {
    const grantCommit = (e) => this.#grantCommit(e);
    for (const e of this.enemies) {
      e.update(dt, ctx.playerPos, {
        grantCommit,
        onFire: (en) => ctx.onEnemyFire(en),
        onStage: (en, stage) => this.bus.emit('enemy.telegraph', { id: en.id, stage }),
      });
    }
    // Reap.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.state === EnemyState.DEAD) {
        this.occupied?.delete(e.anchor.id);
        e.dispose(this.scene);
        this.enemies.splice(i, 1);
        this.committed.delete(e.id);
      }
    }
  }

  #clear() {
    this.state = DirectorState.CLEARED;
    this.stateTime = 0;
    const bonus = 1000 + Math.floor(this.timeLeft) * 100;
    this.bus.emit('area.cleared', {
      areaId: this.area.areaId,
      name: this.area.name,
      timeLeft: this.timeLeft,
      noHit: !this.tookHitThisArea,
      bonus,
      isLast: this.areaIndex === ENCOUNTERS.length - 1,
    });
  }

  #despawnAll() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies.length = 0;
    this.committed.clear();
    this.occupied?.clear();
  }

  /** Restart the current area after a death. */
  retryArea() {
    this.#despawnAll();
    this.state = DirectorState.TRAVELLING;
    this.stateTime = 0;
    const d = this.rail.distanceToWaypoint(this.area.waypoint);
    this.railCamera.travelTo(d, this.area.node);
  }

  /**
   * Spawn one enemy on demand, for the verification harness.
   *
   * Deliberately routed through the same #spawn path the waves use, so a
   * screenshot shows an enemy placed by the real anchor-selection rules — out
   * of a real doorway, at a real engagement distance, on a real side of the
   * street. A harness that placed enemies by hand would be photographing
   * something the game never does.
   */
  spawnForReview(type, cameraPos, cameraFwd) {
    return this.#spawn(
      { type, anchorTypes: ['door', 'alley', 'balcony', 'metro', 'roof', 'dormer'], side: 0 },
      cameraPos, cameraFwd);
  }

  /** The live boss, if this area has one. The HUD reads its health bar. */
  boss() {
    return this.enemies.find((e) => e.isBoss && e.isAlive) ?? null;
  }

  /** All enemies currently shootable, for the player's hit test. */
  targets() {
    return this.enemies.filter((e) => e.isAlive && e.state !== EnemyState.WITHDRAW);
  }
}
