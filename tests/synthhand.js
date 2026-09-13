/**
 * Synthetic MediaPipe hands.
 *
 * There is no webcam in CI and there is no webcam in a headless screenshot
 * run, but the gesture stack is the part of this game most likely to break
 * silently. So we generate anatomically-plausible 21-point hands from a small
 * parameter set and drive the real recogniser with them. The same generator
 * backs the attract-mode demo, which is what the visual critic screenshots.
 *
 * Local frame before projection: +X along the barrel, +Y toward the thumb
 * side, +Z out of the palm. Then rotated by `elevationDeg` and dropped into
 * normalised image space (origin top-left, +y DOWN, which is why the
 * projection negates Y).
 */

const D2R = Math.PI / 180;

/** Rotate v about the Z axis by `a` radians. */
function rotZ(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

/**
 * Build one finger as 4 points (MCP, PIP, DIP, TIP) walking outward from a
 * knuckle, bending by `curl` (0..1) at each joint.
 */
function finger(origin, dir, segs, curl, bendAxisSign = 1) {
  const pts = [{ ...origin }];
  let p = { ...origin };
  let d = { ...dir };
  // Total flex distributed across the two interphalangeal joints. 82.5° each
  // at full curl sums to the 165° that handmath.js normalises against.
  const perJoint = curl * 82.5 * D2R * bendAxisSign;
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) d = rotZ(d, -perJoint);
    p = { x: p.x + d.x * segs[i], y: p.y + d.y * segs[i], z: p.z + d.z * segs[i] };
    pts.push({ ...p });
  }
  return pts; // length segs.length + 1
}

/**
 * @param {object} o
 * @param {number} o.elevationDeg  barrel elevation: 0 horizontal, 90 straight up
 * @param {number} o.middleCurl    0 = extended perpendicular, 1 = in the palm
 * @param {number} o.ringCurl
 * @param {number} o.pinkyCurl
 * @param {number} o.thumbCurl
 * @param {number} o.x,o.y         hand centre in normalised image space
 * @param {number} o.scale
 * @returns {{x:number,y:number,z:number}[]} 21 landmarks
 */
export function makeHand({
  elevationDeg = 0,
  middleCurl = 0,
  ringCurl = 1,
  pinkyCurl = 1,
  thumbCurl = 0.3,
  x = 0.5, y = 0.5,
  scale = 0.34,
} = {}) {
  const wrist = { x: 0, y: 0, z: 0 };

  // Knuckle row, splayed across the palm (+Y is the thumb side).
  const mcp = {
    thumb:  { x: 0.22, y:  0.20, z: 0.02 },
    index:  { x: 0.46, y:  0.10, z: 0 },
    middle: { x: 0.48, y: -0.02, z: 0 },
    ring:   { x: 0.45, y: -0.13, z: 0 },
    pinky:  { x: 0.40, y: -0.23, z: 0 },
  };

  const along = { x: 1, y: 0, z: 0 };
  // The middle finger sits PERPENDICULAR to the barrel when extended — this is
  // the brief's reversed L. At curl 0 it points across the palm; as curl rises
  // it folds down into it.
  const acrossDown = { x: 0, y: -1, z: 0 };

  const thumbDir = { x: 0.55, y: 0.84, z: 0.1 };

  const idx = finger(mcp.index, along, [0.16, 0.11, 0.09], 0);
  const mid = finger(mcp.middle, acrossDown, [0.18, 0.12, 0.09], middleCurl, -1);
  const rng = finger(mcp.ring, along, [0.17, 0.11, 0.08], ringCurl);
  const pky = finger(mcp.pinky, along, [0.14, 0.09, 0.07], pinkyCurl);
  const thb = finger(mcp.thumb, thumbDir, [0.12, 0.10, 0.08], thumbCurl);

  const local = [
    wrist,
    thb[0], thb[1], thb[2], thb[3],
    idx[0], idx[1], idx[2], idx[3],
    mid[0], mid[1], mid[2], mid[3],
    rng[0], rng[1], rng[2], rng[3],
    pky[0], pky[1], pky[2], pky[3],
  ];

  const a = elevationDeg * D2R;
  return local.map((p) => {
    const r = rotZ(p, a);
    return {
      x: x + r.x * scale,
      y: y - r.y * scale,  // image space grows downward
      z: r.z * scale,
    };
  });
}

/** Canonical poses, for tests and for the attract-mode demo. */
export const POSES = {
  /** Aiming at the screen, trigger cocked at the top of its travel. */
  point:       (o = {}) => makeHand({ elevationDeg: 0,  middleCurl: 0.05, ...o }),
  /** Mid-pull. */
  squeezing:   (o = {}) => makeHand({ elevationDeg: 0,  middleCurl: 0.5,  ...o }),
  /** Trigger broken — the shot. */
  fired:       (o = {}) => makeHand({ elevationDeg: 0,  middleCurl: 0.85, ...o }),
  /** Gun raised perpendicular to the sky: duck and reload. */
  reload:      (o = {}) => makeHand({ elevationDeg: 88, middleCurl: 0.1,  ...o }),
  /** Halfway up — the vulnerable transition. */
  raising:     (o = {}) => makeHand({ elevationDeg: 45, middleCurl: 0.1,  ...o }),
  /** An open hand: must NOT read as a finger gun. */
  openPalm:    (o = {}) => makeHand({ elevationDeg: 0,  middleCurl: 0, ringCurl: 0, pinkyCurl: 0, thumbCurl: 0, ...o }),
};
