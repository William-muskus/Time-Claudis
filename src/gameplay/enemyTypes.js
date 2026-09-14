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

  /**
   * THE STAGE BOSS. Area A5, on the Ravignan steps.
   *
   * A Time Crisis stage does not end on a wave, it ends on a person with a
   * name and a health bar. Everything here is sized against the handgun,
   * because the boss must be beatable with the weapon that is never taken
   * away: 12 HP is 12 trigger pulls, which at the handgun's 6-round magazine
   * is exactly two full magazines plus the two reloads between them. That is
   * the fight — three trips out of cover, minimum, and the boss's telegraph
   * is tuned so each trip buys you about one magazine.
   */
  BOSS: {
    name: 'LE CORBEAU',
    color: PALETTE.enemyHeavy,
    hp: 12,
    telegraphMs: 1400,
    score: 12000,
    gates: true,                 // the stage cannot end around him
    exposureMs: Infinity,        // he never ducks back; he is the area
    doubleTapChance: 1,
    speed: 0.9,
    scale: 1.42,
    boss: true,
    preferredAnchors: ['door', 'alley', 'metro'],
  },
};

/**
 * Boss phases, ordered from full health downward.
 *
 * The shape of a boss fight is escalation the player can SEE coming, so each
 * phase shortens the telegraph and widens the burst by the same rough factor.
 * `heavyEvery` counts ordinary volleys between heavy attacks: by phase three
 * every other attack is the unduckable-unless-you-duck sweep, which is what
 * turns the last third of the fight into pure cover rhythm.
 */
export const BOSS_PHASES = [
  { from: 1.00, telegraphMs: 1400, burst: 1, heavyEvery: 3 },
  { from: 0.66, telegraphMs: 1100, burst: 2, heavyEvery: 3 },
  { from: 0.33, telegraphMs: 850,  burst: 3, heavyEvery: 2 },
];

/**
 * The heavy attack: a wide sweep that cannot be dodged by aiming, only by
 * hiding. It gets a telegraph longer than anything else in the game precisely
 * because the correct answer is the slowest one the player has — a 200 ms
 * hide from a standing start, plus human reaction time, plus the bullet's
 * flight. 1600 ms leaves room for all three and still feels urgent.
 */
export const BOSS_HEAVY_TELEGRAPH_MS = 1600;
/** Rounds in the sweep. Enough that standing still is never survivable. */
export const BOSS_HEAVY_ROUNDS = 5;
/**
 * The beat between phases. He covers, you cannot hurt him, and the player gets
 * a breath to reload. Short — long enough to read as an event, too short to be
 * a wait.
 */
export const BOSS_PHASE_GUARD_MS = 900;

/** Telegraph stage boundaries as fractions of telegraphMs. Spec §3. */
export const TELEGRAPH_SPLIT = { windup: 0.55, flash: 0.30, commit: 0.15 };

/** Enemy bullets are slow enough to duck under. Spec §3. */
export const ENEMY_BULLET_SPEED = 34;

/** At most this many enemies may be in the commit stage at once. Spec §3. */
export const MAX_CONCURRENT_COMMIT = 2;

/**
 * How long an enemy reacts to a hit before anything else happens to it.
 * Spec §7: an enemy that vanishes on hit feels like a target, not a person.
 * The same number serves both cases — a killing blow staggers for 120 ms
 * before the fall begins, and a non-lethal hit (the HEAVY, the BOSS) staggers
 * for 120 ms with its telegraph SUSPENDED, which is what makes shooting an
 * armoured enemy feel like suppression rather than like chipping a wall.
 */
export const STAGGER_MS = 120;

/**
 * Weapon-carrier tell. A carrier is marked in a colour that belongs to no
 * enemy class (spec §3: colour is information), and pulses smoothly rather
 * than in the telegraph's hard beats, so the two reads can never be confused:
 * a blink means "I am about to shoot you", a throb means "I am worth killing".
 */
export const CARRIER_MARK_COLOR = PALETTE.hudBlue;
export const CARRIER_PULSE_HZ = 1.1;
