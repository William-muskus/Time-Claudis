import * as THREE from 'three';

/**
 * THE PALETTE
 * ===========
 * A bright late-summer afternoon, sampled from the Ville de Paris street survey
 * of August 2025 (tools/geo/references.json, compared frame by frame by
 * tools/verify/compare.mjs).
 *
 * The first look was a saturated golden hour: amber key, violet fill, "nothing
 * neutral anywhere". Someone who lives on the route did not recognise a single
 * street in it. Montmartre in daylight is the opposite of that rule — it is
 * almost entirely neutral: cream limestone, off-white render, white and grey
 * louvred shutters, grey granite setts, zinc roofs, black ironwork, and dark
 * green trees spilling over garden walls. Colour comes in small doses: the
 * green and navy shopfronts, a red awning, the Maison Rose.
 *
 * Rule for anyone adding a colour: check it against a reference photograph
 * with tools/verify/compare.mjs, not against the other colours here.
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
  skyZenith:    c('#9DB6CF'),   // cerulean overhead. Lifted from #2E5A8C: that
                                //  was a dusk blue and it dragged the whole sky,
                                //  and the hemisphere fill that samples it, toward night.
  skyHorizon:   c('#EEF0F0'),   // molten gold at the rooftops
  // The hemisphere's lower half. Desaturated from #A57F5E: a vertical wall
  // receives roughly a 50/50 mix of sky and ground from a hemisphere light, so
  // a strongly warm ground colour cancels the blue and leaves shadowed façades
  // neutral — which is precisely where the violet was going.
  skyGround:    c('#A3998B'),
  sunColor:     c('#FFF1DE'),
  sunDiscColor: c('#FFFBF0'),
  // Desaturated from #E0A868. Fog tints EVERYTHING beyond its near plane, so
  // a strongly gold haze quietly repaints every distant facade the same colour
  // and the frame collapses toward a single hue — the exact failure the
  // amber/violet split exists to prevent. Warm, but much closer to neutral, so
  // distance reads as distance rather than as more orange.
  fogColor:     c('#D6DADB'),

  // --- stone --------------------------------------------------------------
  limestoneLit:    c('#E8DFCF'),
  limestoneMid:    c('#D8CDB9'),
  limestoneDeep:   c('#BDB09A'),
  plasterCream:    c('#EDE6D8'),
  plasterOchre:    c('#DCC7A2'),
  // La Maison Rose and its imitators. Pulled back from #E8A99A, which under
  // the grade's warm highlight tint came out of a full-height sunlit façade as
  // a saturated magenta — two of those framing the Blute-fin shot read as
  // confectionery rather than as painted plaster. The real colour is a dusty
  // rose that has been on a wall for a century.
  plasterPink:     c('#E3B6AE'),
  plasterGrey:     c('#CEC8BD'),

  // --- roofs --------------------------------------------------------------
  zincLit:      c('#9AA0A6'),
  zincShadow:   c('#6E747B'),
  slateDark:    c('#4F555E'),
  chimneyTerra: c('#A9644C'),

  // --- joinery and metal --------------------------------------------------
  shutterBlue:  c('#7E8E9C'),
  shutterGreen: c('#56705C'),
  shutterGrey:  c('#A9AAA6'),
  // Lifted from #32334A for the same reason, and one more: ironwork is used
  // for lamp standards, downpipes and railings, which are one or two pixels
  // wide at street distance. Anything that thin at that value stops being an
  // object and becomes a hard black line ruled across the frame.
  ironwork:     c('#2E3134'),
  guimardGreen: c('#2F5A48'),   // the Abbesses édicule
  guimardAmber: c('#E8B25C'),   // its glass
  bronzeDalida: c('#8C6A3F'),
  bronzePolish: c('#D9A850'),   // the rubbed-gold chest

  // --- street -------------------------------------------------------------
  cobbleWarm:   c('#8E877E'),
  cobbleCool:   c('#7D7872'),
  pavement:     c('#A7A198'),
  kerbStone:    c('#9E9B95'),
  stairStone:   c('#B3ACA0'),

  // --- planting -----------------------------------------------------------
  foliageSun:   c('#7B9550'),
  foliageMid:   c('#5B773F'),
  // Lifted from #3D4A2A. At that value a shaded crown came through the grade
  // at around 25/255 against a 200/255 sky and read as a hole punched in the
  // frame rather than as a tree. Foliage is the only large organic mass in a
  // world of flat stone, so when it goes to silhouette the picture loses the
  // one thing that was not architecture.
  foliageDeep:  c('#4A6533'),
  trunkBark:    c('#4E4438'),
  ivyGreen:     c('#3F5A2F'),

  // --- signage and cloth --------------------------------------------------
  awningRed:    c('#9E2F2C'),
  awningGreen:  c('#2F4A3B'),
  awningCream:  c('#E3DCCB'),
  metroGreen:   c('#1F4A3A'),
  signWhite:    c('#F1EEE6'),

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

/** Sun direction: mid-afternoon, west-south-west, high enough to light the streets. */
export const SUN_ELEVATION_DEG = 34;
export const SUN_AZIMUTH_DEG = 245;   // compass bearing the light comes FROM: mid-afternoon, west-south-west

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
