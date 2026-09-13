/**
 * Landmark geometry helpers. Pure functions over MediaPipe's 21-point hand.
 *
 * MediaPipe index map:
 *   0 wrist
 *   1..4   thumb  (CMC, MCP, IP, TIP)
 *   5..8   index  (MCP, PIP, DIP, TIP)
 *   9..12  middle
 *   13..16 ring
 *   17..20 pinky
 */

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);

export function angleBetween(a, b) {
  const d = len(a) * len(b);
  if (d < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / d)));
}

/**
 * Analogue curl of one finger, 0 (dead straight) → 1 (fully fisted).
 *
 * fingerpose only reports three discrete curl buckets, which is fine for
 * "which gesture is this" but useless for a trigger: a trigger needs a
 * continuous value so the pull can be edge-detected with hysteresis. So we
 * compute it ourselves from the two interphalangeal joint angles.
 */
export function fingerCurl(lm, mcp, pip, dip, tip) {
  const a1 = angleBetween(sub(lm[pip], lm[mcp]), sub(lm[dip], lm[pip]));
  const a2 = angleBetween(sub(lm[dip], lm[pip]), sub(lm[tip], lm[dip]));
  // Each joint contributes up to ~110° of flex. Sum and normalise.
  const total = (a1 + a2) * (180 / Math.PI);
  return Math.max(0, Math.min(1, total / 165));
}

export const indexCurl  = (lm) => fingerCurl(lm, LM.INDEX_MCP,  LM.INDEX_PIP,  LM.INDEX_DIP,  LM.INDEX_TIP);
export const middleCurl = (lm) => fingerCurl(lm, LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP);
export const ringCurl   = (lm) => fingerCurl(lm, LM.RING_MCP,   LM.RING_PIP,   LM.RING_DIP,   LM.RING_TIP);
export const pinkyCurl  = (lm) => fingerCurl(lm, LM.PINKY_MCP,  LM.PINKY_PIP,  LM.PINKY_DIP,  LM.PINKY_TIP);

/**
 * The barrel: unit vector from index MCP knuckle to index fingertip.
 * The brief is explicit that the index finger IS the barrel, so every aiming
 * and orientation decision derives from this vector and nothing else.
 */
export function barrelVector(lm) {
  const v = sub(lm[LM.INDEX_TIP], lm[LM.INDEX_MCP]);
  const l = len(v) || 1e-9;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * Barrel elevation in degrees. +90 = pointing straight up at the sky,
 * 0 = horizontal, -90 = straight down.
 *
 * Image coordinates have +y downward, hence the negation. This single number
 * is the RELOAD gesture: the brief asks for the gun held "perpendicular to the
 * sky", so we test elevation, not a fingerpose direction bucket, because the
 * bucket boundary at 45° is far too loose to feel deliberate.
 */
export function barrelElevationDeg(lm) {
  const b = barrelVector(lm);
  const horiz = Math.hypot(b.x, b.z);
  return Math.atan2(-b.y, horiz) * (180 / Math.PI);
}

/**
 * Angle between index and middle finger in degrees.
 *
 * The brief's SHOOT pose is a "reversed L" — the middle finger held
 * perpendicular to the index, like a finger resting on a gâchette. That is
 * what this measures. Near 90° means the trigger finger is cocked and ready;
 * as it curls into the palm the angle collapses and the shot breaks.
 */
export function triggerAngleDeg(lm) {
  const index = sub(lm[LM.INDEX_TIP], lm[LM.INDEX_MCP]);
  const middle = sub(lm[LM.MIDDLE_TIP], lm[LM.MIDDLE_MCP]);
  return angleBetween(index, middle) * (180 / Math.PI);
}

/** Hand scale in normalised units — used to make thresholds distance-invariant. */
export function handSpan(lm) {
  return len(sub(lm[LM.MIDDLE_MCP], lm[LM.WRIST])) || 1e-9;
}

/**
 * Aim origin. The fingertip alone is jittery and, worse, it MOVES when the
 * trigger finger curls, which would pull your aim every time you fired. So we
 * aim from a point projected forward along the barrel from the knuckle, which
 * is stable under trigger actuation. This is the single highest-impact
 * decision in the whole input stack.
 */
export function aimPoint(lm) {
  const mcp = lm[LM.INDEX_MCP];
  const b = barrelVector(lm);
  const reach = handSpan(lm) * 1.35;
  return { x: mcp.x + b.x * reach, y: mcp.y + b.y * reach };
}
