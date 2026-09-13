/**
 * Deterministic RNG (mulberry32).
 *
 * Every random decision in the game — spawn jitter, telegraph variance, debris
 * — draws from a seeded stream so that a run can be reproduced exactly. The
 * visual critic screenshots a fixed seed; without this, no two screenshots of
 * "the same moment" would ever match and regression review would be impossible.
 */
export function makeRng(seed = 0x5eed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}
