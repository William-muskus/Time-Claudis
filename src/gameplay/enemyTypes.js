import { PALETTE } from '../render/palette.js';

/**
 * Enemy classes. These numbers are the spec in docs/GAMEPLAY.md §3 made
 * executable; change them there first.
 *
 * `telegraphMs` is the total time from the enemy committing to a shot to the
 * shot leaving the barrel. It is split 55/30/15 across windup, flash and
 * commit. It is the single most important number in the game: too short and
 * the game is unfair, too long and it is slack. The values below are tuned so
 * a player who is watching can always duck, and a player who is not, cannot.
 */
export const ENEMY_TYPES = {
  GRUNT: {
    name: 'GRUNT',
    color: PALETTE.enemyGrunt,
    hp: 1,
    telegraphMs: 900,
    score: 300,
    gates: false,
    /** How long they stay out after firing before ducking back. */
    exposureMs: 1400,
    /** Chance per engagement of firing a second shot before withdrawing. */
    doubleTapChance: 0.18,
    speed: 1.6,
    preferredAnchors: ['door', 'alley', 'window'],
  },
  SOLDIER: {
    name: 'SOLDIER',
    color: PALETTE.enemySoldier,
    hp: 1,
    telegraphMs: 750,
    score: 300,
    gates: false,
    exposureMs: 2200,
    doubleTapChance: 0.4,
    speed: 2.6,
    strafes: true,
    preferredAnchors: ['door', 'alley', 'balcony'],
  },
  RED: {
    name: 'RED',
    color: PALETTE.enemyRed,
    hp: 1,
    telegraphMs: 620,
    score: 800,
    gates: true,          // must die for the area to clear
    exposureMs: 2600,
    doubleTapChance: 0.55,
    speed: 3.1,
    strafes: true,
    preferredAnchors: ['door', 'alley', 'balcony', 'metro'],
  },
  HEAVY: {
    name: 'HEAVY',
    color: PALETTE.enemyHeavy,
    hp: 3,
    telegraphMs: 1100,
    score: 1500,
    gates: true,
    exposureMs: 3600,
    doubleTapChance: 0.7,
    speed: 1.1,
    scale: 1.18,
    preferredAnchors: ['door', 'alley'],
  },
  SNIPER: {
    name: 'SNIPER',
    color: PALETTE.enemySniper,
    hp: 1,
    telegraphMs: 1500,
    score: 1000,
    gates: false,
    exposureMs: 4200,
    doubleTapChance: 0.0,
    speed: 0.4,
    /** Snipers draw a laser line during windup. Long tell, lethal payoff. */
    laser: true,
    preferredAnchors: ['roof', 'dormer', 'balcony'],
  },
  BOMBER: {
    name: 'BOMBER',
    color: PALETTE.enemyBomber,
    hp: 1,
    telegraphMs: 0,       // does not shoot; the run IS the telegraph
    score: 700,
    gates: false,
    exposureMs: 99999,
    doubleTapChance: 0,
    speed: 5.2,
    charges: true,
    preferredAnchors: ['alley', 'door', 'metro'],
  },
};

/** Telegraph stage boundaries as fractions of telegraphMs. Spec §3. */
export const TELEGRAPH_SPLIT = { windup: 0.55, flash: 0.30, commit: 0.15 };

/** Enemy bullets are slow enough to duck under. Spec §3. */
export const ENEMY_BULLET_SPEED = 34;

/** At most this many enemies may be in the commit stage at once. Spec §3. */
export const MAX_CONCURRENT_COMMIT = 2;
