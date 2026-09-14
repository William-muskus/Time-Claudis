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
   * name and a health bar. The fight is a loop — he volleys, he recovers, you
   * punish — and HP is simply how many times round that loop the player goes.
   *
   * 30 HP is sized from both ends. A punish window fits roughly two aimed
   * shots after the emerge and before the hide, and one full loop runs about
   * 2.1–2.8 s depending on phase, so:
   *
   *   handgun, 1 damage      ~15 loops   ~38 s   the floor: always beatable
   *   grenade, 3 damage       ~5 loops   ~13 s   the reward for finding it
   *
   * It was 12, which is two handgun magazines, and that number came from a
   * time when the handgun was the only thing the arithmetic considered. One
   * grenade magazine is 4 rounds at 3 damage — exactly 12 — so a player who
   * brought the right weapon deleted the boss in four shots and five seconds
   * without ever seeing phase 3. The stage ended on a QTE.
   *
   * Raising it keeps the grenade launcher decisively the right answer (a third
   * of the fight) without letting it skip the fight.
   */
  BOSS: {
    name: 'LE CORBEAU',
    color: PALETTE.enemyHeavy,
    hp: 30,
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
  { from: 1.00, telegraphMs: 1400, burst: 1, heavyEvery: 3, recoverMs: 1560 },
  { from: 0.66, telegraphMs: 1100, burst: 2, heavyEvery: 3, recoverMs: 1440 },
  { from: 0.33, telegraphMs: 850,  burst: 3, heavyEvery: 2, recoverMs: 1360 },
];

/**
 * THE PUNISH WINDOW, and why `recoverMs` exists at all.
 *
 * Without it this fight was unwinnable, and not obviously so — it read as
 * "hard". The boss never ducks (`exposureMs: Infinity`), so the only gap
 * between one volley landing and the next telegraph starting was the wind-up
 * itself. Measure that against what the player has to do in it:
 *
 *   the last round of the volley is still in the air   ~0.74 s at 34 m/s, 25 m
 *   emerge from cover                                   0.26 s
 *   land a shot                                        ~0.15 s
 *   hide again before the next commit                   0.20 s
 *                                                      -------
 *                                                      ~1.35 s needed
 *
 * The phase-0 wind-up is 1.40 s, of which only the first 55 % is not already
 * the flash a player is trained to hide from — 0.77 s. By phase 1 it is 0.60 s
 * and by phase 2, 0.47 s. The window was negative for two thirds of the fight:
 * rounds from the previous volley were still travelling when the next flash
 * began. An oracle player that simply respected incoming fire spent 93 % of
 * the fight in cover and got 44 shots off in 34 seconds, which is why
 * `tests/playthrough.test.js` could not kill him.
 *
 * `recoverMs` is a beat AFTER the volley and BEFORE the next wind-up in which
 * the boss does nothing and is fully vulnerable. It is sized at the figure
 * above plus a margin, and it shortens only slightly with each phase. That is
 * deliberate: escalation belongs in the telegraph (which halves) and the burst
 * (which triples), because those tighten how HARD the fight hits. Escalating
 * the recovery instead would tighten whether the player can act at all, and a
 * window that only fits an emerge and a hide is the same as no window.
 *
 * This is the loop a Time Crisis boss is built on: he shoots, he recovers, you
 * punish. Take the recovery out and you have a metronome with no downbeat.
 *
 * The sweep gets a longer one still. It is the attack that forces the player
 * all the way into cover, so it is also the attack they come out of with a
 * full magazine and nothing in the air — the biggest punish in the fight, and
 * the reason the sweep is worth baiting rather than merely surviving.
 */
export const BOSS_HEAVY_RECOVER_MS = 1900;

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
