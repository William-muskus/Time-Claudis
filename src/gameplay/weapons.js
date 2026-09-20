/** Weapon table. Spec: docs/GAMEPLAY.md §2. */
export const WEAPONS = {
  HANDGUN: {
    name: 'HANDGUN', mag: 6, reloadMs: 700, damage: 1,
    rofMs: 1000 / 6, spreadDeg: 0, pellets: 1, infinite: true,
  },
  MACHINE_GUN: {
    name: 'MACHINE GUN', mag: 30, reloadMs: 1400, damage: 1,
    rofMs: 1000 / 11, spreadDeg: 1.6, pellets: 1, durationMs: 25000,
  },
  SHOTGUN: {
    name: 'SHOTGUN', mag: 8, reloadMs: 1100, damage: 1,
    rofMs: 1000 / 2.2, spreadDeg: 5.5, pellets: 7, durationMs: 25000,
  },
  GRENADE: {
    name: 'GRENADE', mag: 4, reloadMs: 1600, damage: 3,
    rofMs: 1000 / 1.4, spreadDeg: 0, pellets: 1, radius: 3.5, durationMs: 20000,
  },
};

/**
 * Ammunition and the reload-by-hiding rule.
 *
 * There is no reload action. You reload by being in cover for long enough, and
 * the "long enough" is the weapon's reloadMs. Duck for less and you come out
 * still empty. That is the whole economy of the game: the magazine decides
 * when you must hide, and hiding is the only thing that is ever safe.
 */
export class WeaponSystem {
  constructor(bus) {
    this.bus = bus;
    this.current = 'HANDGUN';
    this.rounds = WEAPONS.HANDGUN.mag;
    this.lastShotAt = -Infinity;
    this.pickupExpiresAt = 0;
    this.announcedEmpty = false;
  }

  get spec() { return WEAPONS[this.current]; }

  /** Give the player a timed pickup. */
  grant(weaponKey, nowMs) {
    const w = WEAPONS[weaponKey];
    if (!w) return;
    this.current = weaponKey;
    this.rounds = w.mag;
    this.announcedEmpty = false;
    this.pickupExpiresAt = w.durationMs ? nowMs + w.durationMs : Infinity;
    this.bus.emit('weapon.granted', { weapon: weaponKey });
  }

  /**
   * @param {number} nowMs
   * @param {number} timeInCoverMs how long the player has been fully covered
   */
  update(nowMs, timeInCoverMs) {
    // Timed pickups revert to the handgun, which is never taken away.
    if (this.current !== 'HANDGUN' && nowMs > this.pickupExpiresAt) {
      this.current = 'HANDGUN';
      this.rounds = WEAPONS.HANDGUN.mag;
      this.bus.emit('weapon.expired', {});
    }
    // Reload happens in cover and only in cover.
    if (timeInCoverMs >= this.spec.reloadMs && this.rounds < this.spec.mag) {
      this.rounds = this.spec.mag;
      this.announcedEmpty = false;
      this.bus.emit('weapon.reloaded', { weapon: this.current });
    }
  }

  get isEmpty() { return this.rounds <= 0; }

  /**
   * Try to fire. Returns the number of pellets, or 0 if the shot did not break.
   */
  tryFire(nowMs) {
    if (this.rounds <= 0) {
      if (!this.announcedEmpty) {
        this.announcedEmpty = true;
        this.bus.emit('weapon.empty', {});
      }
      return 0;
    }
    if (nowMs - this.lastShotAt < this.spec.rofMs) return 0;
    this.lastShotAt = nowMs;
    this.rounds--;
    if (this.rounds === 0) {
      this.announcedEmpty = true;
      this.bus.emit('weapon.empty', {});
    }
    return this.spec.pellets;
  }
}
