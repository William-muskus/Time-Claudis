import * as THREE from 'three';

/**
 * THE PALETTE
 * ===========
 * Late afternoon, roughly 18:40 in early October. The sun is low in the west
 * and raking straight up the rue Lamarck slope.
 *
 * The whole look rests on one decision: the key light is warm amber and the
 * fill is violet-blue, and there is nothing neutral anywhere. Paris limestone
 * is genuinely a warm cream, so in this light the lit faces go to honey and the
 * shadowed faces fall into lilac. That amber/violet split is what makes a
 * flat-shaded box read as a building rather than as a box — the shading has to
 * carry hue information, not just brightness, because low-poly geometry has no
 * detail to carry it instead.
 *
 * Rule for anyone adding a colour: it is either warm (hue 20-50) or it is cool
 * (hue 230-280). Nothing in between. Greens are pushed to olive so they sit on
 * the warm side; the zinc roofs are pushed to violet so they sit on the cool.
 */

/**
 * Palette entries are authored as sRGB hex, which is how anyone picking a
 * colour actually thinks about it.
 *
 * Do NOT add `.convertSRGBToLinear()` here. three's ColorManagement is on by
 * default and `new THREE.Color(hex)` already decodes sRGB into the linear
 * working space. Converting a second time applies the transfer function twice,
 * which costs about 21% of the red channel and 73% of the blue — collapsing
 * this warm limestone palette into uniform dark brown and making the whole
 * scene look unlit. That bug shipped once already. The violet shadows are what
 * exposed it, because violet is the one thing in the palette that needs blue.
 */
const c = (hex) => new THREE.Color(hex);

export const PALETTE = {
  // --- sky and atmosphere -------------------------------------------------
  skyZenith:    c('#2E5A8C'),   // deep cerulean overhead
  skyHorizon:   c('#F2B86B'),   // molten gold at the rooftops
  skyGround:    c('#8A6A52'),   // warm bounce from below
  sunColor:     c('#FFD9A0'),
  sunDiscColor: c('#FFF0CC'),
  fogColor:     c('#E0A868'),   // haze takes the horizon gold up the street

  // --- stone --------------------------------------------------------------
  limestoneLit:    c('#EBC89B'),
  limestoneMid:    c('#D9AE7E'),
  limestoneDeep:   c('#B98A63'),
  plasterCream:    c('#F0D9B5'),
  plasterOchre:    c('#D9A05B'),
  plasterPink:     c('#E8A99A'),   // La Maison Rose and its imitators
  plasterGrey:     c('#C4B5A8'),

  // --- roofs --------------------------------------------------------------
  zincLit:      c('#9AA0B8'),
  zincShadow:   c('#5A5F7D'),
  slateDark:    c('#43455E'),
  chimneyTerra: c('#B05F45'),

  // --- joinery and metal --------------------------------------------------
  shutterBlue:  c('#5E7A94'),
  shutterGreen: c('#5A6B4A'),
  shutterGrey:  c('#7D8595'),
  ironwork:     c('#32334A'),
  guimardGreen: c('#2F5A48'),   // the Abbesses édicule
  guimardAmber: c('#E8B25C'),   // its glass
  bronzeDalida: c('#8C6A3F'),
  bronzePolish: c('#D9A850'),   // the rubbed-gold chest

  // --- street -------------------------------------------------------------
  cobbleWarm:   c('#B09883'),
  cobbleCool:   c('#8A7D7A'),
  pavement:     c('#C7B49C'),
  kerbStone:    c('#A89684'),
  stairStone:   c('#BFA890'),

  // --- planting -----------------------------------------------------------
  foliageSun:   c('#8F9B4A'),
  foliageMid:   c('#5F7038'),
  foliageDeep:  c('#3D4A2A'),
  trunkBark:    c('#5C4632'),
  ivyGreen:     c('#4A5C33'),

  // --- signage and cloth --------------------------------------------------
  awningRed:    c('#B3413C'),
  awningGreen:  c('#3E5F47'),
  awningCream:  c('#E5D2AE'),
  metroGreen:   c('#1F4A3A'),
  signWhite:    c('#F2E9D8'),

  // --- enemies. Colour is information: see docs/GAMEPLAY.md §3 -------------
  enemyGrunt:   c('#D9932F'),   // ochre
  enemySoldier: c('#4A6A94'),   // slate blue
  enemyRed:     c('#C4322E'),   // scarlet — gates the area
  enemyHeavy:   c('#3A3A44'),
  enemySniper:  c('#3E5236'),
  enemyBomber:  c('#E8702A'),
  telegraph:    c('#FFF3D0'),   // the flash. Always this, always unmissable.
  enemyTracer:  c('#FFD166'),
  playerTracer: c('#FFFFFF'),

  // --- UI -----------------------------------------------------------------
  hudAmber:     '#FFC24A',
  hudRed:       '#FF4438',
  hudWhite:     '#FFF6E4',
  hudBlue:      '#5EC8E5',
};

/** Sun direction: low, west-north-west, raking up the hill. */
export const SUN_ELEVATION_DEG = 11.5;
export const SUN_AZIMUTH_DEG = 287;   // compass bearing the light comes FROM

/** Unit vector pointing from the scene toward the sun, in our frame. */
export function sunDirection() {
  const el = THREE.MathUtils.degToRad(SUN_ELEVATION_DEG);
  const az = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  // Bearing 0 = north = -Z, 90 = east = +X.
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  ).normalize();
}

/**
 * Flat-shaded material factory. Every surface in the game comes through here,
 * which is what keeps the look coherent.
 */
export function flat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: opts.roughness ?? 0.86,
    metalness: opts.metalness ?? 0.0,
    ...opts,
  });
}

/** Emissive material for telegraphs, tracers, lamps and signage. */
export function glow(color, intensity = 1.0) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, ...(intensity !== 1 ? {} : {}) });
}
