import * as THREE from 'three';
import { Enemy, Boss, EnemyState } from './enemy.js';
import { ENCOUNTERS } from './encounters.js';
import { MAX_CONCURRENT_COMMIT } from './enemyTypes.js';
import { AREAS } from '../data/route.js';
import { blocked } from '../world/occluders.js';

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

/** Openings a person can walk out of, used as the last-resort spawn pool. */
const GROUND_LEVEL_ANCHORS = ['door', 'alley', 'metro'];

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
  constructor({ scene, railCamera, rail, anchors, occluders = [], bus, rng }) {
    this.scene = scene;
    this.railCamera = railCamera;
    this.rail = rail;
    this.anchors = anchors;
    /**
     * Coarse building boxes, used to refuse anchors the player cannot see.
     * Empty is a valid value and means "test nothing" — a world built without
     * them still spawns, it just spawns the way it used to.
     */
    this.occluders = occluders;
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
    /**
     * Selection cascades, and it must.
     *
     * Measured at the five combat nodes, only 0-9 anchors of any given type
     * satisfy the strict constraints, out of 83-224 that exist. With anchors
     * also marked occupied while in use, the pool ran dry within a couple of
     * waves and roughly three quarters of all scheduled spawns silently
     * produced nothing. The stage was unwinnable past area one: the gating RED
     * never appeared, so the area never cleared.
     *
     * A wave that does not spawn is not a minor shortfall, it is a broken
     * area, so the search relaxes rather than failing. It gives up the SIDE
     * first (a pacing preference), then the distance band, then the facing
     * cone, and only then the anchor type — because an enemy on the wrong side
     * of the street is a pacing problem while an enemy materialising out of a
     * blank wall is a credibility one, and both are better than an area that
     * cannot be finished.
     */
    const passes = [
      { near: 5, far: 42, facing: 0.15, types: spawn.anchorTypes, respectSide: true, sight: true },
      { near: 5, far: 42, facing: 0.15, types: spawn.anchorTypes, respectSide: false, sight: true },
      { near: 4, far: 58, facing: -0.1, types: spawn.anchorTypes, respectSide: false, sight: true },
      // Last resort: any opening a person could plausibly come out of, seen or
      // not.
      //
      // Line of sight is the LAST constraint given up, and it still has to be
      // given up. It was a hard filter across every pass for one run, and the
      // stage lost its boss: at the métro only one door of seven is visible
      // from where the player stands, so a wave needing two of them failed,
      // the area never cleared, and the run timed out on area one for ten
      // straight minutes without ever reaching the fight it was supposed to
      // end on. That is the same unwinnable-stage failure the cascade was
      // written to prevent, arrived at from the other direction.
      //
      // An enemy the player cannot see is bad. An area that cannot be finished
      // is worse, and it is the only thing worse — so this pass exists, and
      // the scoring below still pulls hard toward anything visible.
      { near: 4, far: 58, facing: -0.1, types: GROUND_LEVEL_ANCHORS, respectSide: false, sight: false },
    ];

    for (const pass of passes) {
      const pick = this.#searchAnchors(spawn, cameraPos, cameraFwd, pass);
      if (pick) return pick;
    }
    return null;
  }

  #searchAnchors(spawn, cameraPos, cameraFwd,
    { near, far, facing: minFacing, types, respectSide, sight = true }) {
    const wanted = new Set(types);
    const scored = [];
    for (const a of this.anchors) {
      if (!wanted.has(a.type) || !a.worldPos) continue;
      if (this.occupied?.has(a.id)) continue;
      const to = a.worldPos.clone().sub(cameraPos);
      const dist = to.length();
      if (dist < near || dist > far) continue;
      to.normalize();
      const facing = to.dot(cameraFwd);
      if (facing < minFacing) continue;

      // LINE OF SIGHT. A hard filter, never a score penalty.
      //
      // The other terms here trade off against each other — a slightly worse
      // angle can be bought back with a better distance — and visibility must
      // not be tradeable, because an anchor the player cannot see is worth
      // nothing at any angle. Measured before this existed: most staged fights
      // put every enemy behind a building, alive and telegraphing at someone
      // who had no way to see, let alone answer, the shot.
      //
      // The eye point is the standing enemy's chest rather than its feet,
      // since that is the part the player shoots at and the part a garden wall
      // does not necessarily hide.
      let seen = true;
      if (this.occluders.length) {
        const eye = { x: a.worldPos.x, y: a.worldPos.y + 1.1, z: a.worldPos.z };
        seen = !blocked(this.occluders, cameraPos, eye);
        if (!seen && sight) continue;
      }

      // IDEAL RANGE, and why it came in from 18 m.
      //
      // At eighteen metres an enemy is about 25 px tall in a 675 px frame and
      // its chest plate — the telegraph the entire fairness contract rests on
      // — is about a dozen pixels. Staged combat frames read as small dolls
      // standing on a far pavement rather than as a threat. Time Crisis fights
      // at conversation distance; the enemy is a PRESENCE, and the flash is
      // the brightest thing on screen because it is close as well as bright.
      //
      // Thirteen metres still leaves the player the full duck: an enemy round
      // at 34 m/s takes 380 ms to arrive, against 200 ms to hide. The distance
      // term is also weighted harder, so the preference actually competes with
      // the facing term instead of being a tiebreak.
      const IDEAL = spawn.type === 'SNIPER' ? 30 : 13;
      let score = facing * 2.0 - Math.abs(dist - IDEAL) * 0.075;
      if (respectSide && spawn.side) {
        if (a.side === spawn.side) score += 1.2;
        else if (a.side === -spawn.side) score -= 0.8;
      }
      // HEIGHT IS AN ANGLE, NOT A DISTANCE.
      //
      // This used to score on metres above the camera, which says nothing
      // about whether the enemy is in shot. The camera's vertical field is
      // 58 degrees, so anything past about 29 degrees of elevation is off the
      // top of the frame — and once the ideal engagement range came in to
      // 13 m, a balcony six metres up crossed that line and enemies started
      // spawning above the picture. Same anchor, same six metres, in frame at
      // twenty-five metres and invisible at eleven.
      //
      // Snipers get a wider allowance because being up high is the whole point
      // of a sniper, and they are placed far enough back that the angle stays
      // manageable.
      const high = a.worldPos.y - cameraPos.y;
      const elevationDeg = Math.atan2(high, Math.max(0.001, Math.hypot(
        a.worldPos.x - cameraPos.x, a.worldPos.z - cameraPos.z))) * 180 / Math.PI;
      const maxDeg = spawn.type === 'SNIPER' ? 24 : 19;
      if (elevationDeg > maxDeg) continue;
      if (spawn.type === 'SNIPER') score += Math.min(high, 12) * 0.22;
      else score -= Math.max(0, high - 4) * 0.3;
      // Big enough that no combination of angle and distance can outweigh it.
      // In the one pass that tolerates a blocked anchor, a visible one still
      // wins every time there is a visible one to be had.
      if (!seen) score -= 100;
      score += this.rng() * 0.6;
      scored.push({ a, score });
    }
    if (!scored.length) return null;
    scored.sort((x, y) => y.score - x.score);
    return scored[0].a;
  }

  #spawn(spawn, cameraPos, cameraFwd) {
    const anchor = this.#pickAnchor(spawn, cameraPos, cameraFwd);
    if (!anchor) {
      // Loud on purpose. A silent spawn failure is how an area becomes
      // unclearable without anything appearing to go wrong.
      this.failedSpawns = (this.failedSpawns ?? 0) + 1;
      this.bus.emit('spawn.failed', { type: spawn.type, anchorTypes: spawn.anchorTypes });
      return null;
    }
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
      // Release the doorway as soon as the enemy has stepped out of it. Holding
      // it until death starves later waves of the few anchors that qualify.
      if (e.state !== EnemyState.SPAWNING) this.occupied?.delete(e.anchor.id);
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
    // Snipers belong up high; everyone else comes out of a ground-level
    // opening, which is where the player is trained to watch.
    const anchorTypes = type === 'SNIPER'
      ? ['roof', 'dormer', 'balcony']
      : ['door', 'alley', 'metro', 'balcony'];
    return this.#spawn({ type, anchorTypes, side: 0 }, cameraPos, cameraFwd);
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
