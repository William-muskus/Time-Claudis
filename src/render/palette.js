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
  skyZenith:    c('#4277B0'),   // cerulean overhead. Lifted from #2E5A8C: that
                                //  was a dusk blue and it dragged the whole sky,
                                //  and the hemisphere fill that samples it, toward night.
  skyHorizon:   c('#F2B86B'),   // molten gold at the rooftops
  // The hemisphere's lower half. Desaturated from #A57F5E: a vertical wall
  // receives roughly a 50/50 mix of sky and ground from a hemisphere light, so
  // a strongly warm ground colour cancels the blue and leaves shadowed façades
  // neutral — which is precisely where the violet was going.
  skyGround:    c('#8F7867'),
  sunColor:     c('#FFD9A0'),
  sunDiscColor: c('#FFF0CC'),
  // Desaturated from #E0A868. Fog tints EVERYTHING beyond its near plane, so
  // a strongly gold haze quietly repaints every distant facade the same colour
  // and the frame collapses toward a single hue — the exact failure the
  // amber/violet split exists to prevent. Warm, but much closer to neutral, so
  // distance reads as distance rather than as more orange.
  fogColor:     c('#C9A98C'),

  // --- stone --------------------------------------------------------------
  limestoneLit:    c('#EBC89B'),
  limestoneMid:    c('#D9AE7E'),
  limestoneDeep:   c('#B98A63'),
  plasterCream:    c('#F0D9B5'),
  plasterOchre:    c('#D9A05B'),
  // La Maison Rose and its imitators. Pulled back from #E8A99A, which under
  // the grade's warm highlight tint came out of a full-height sunlit façade as
  // a saturated magenta — two of those framing the Blute-fin shot read as
  // confectionery rather than as painted plaster. The real colour is a dusty
  // rose that has been on a wall for a century.
  plasterPink:     c('#DCAAA1'),
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
  // Lifted from #32334A for the same reason, and one more: ironwork is used
  // for lamp standards, downpipes and railings, which are one or two pixels
  // wide at street distance. Anything that thin at that value stops being an
  // object and becomes a hard black line ruled across the frame.
  ironwork:     c('#3F4160'),
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
  // Lifted from #3D4A2A. At that value a shaded crown came through the grade
  // at around 25/255 against a 200/255 sky and read as a hole punched in the
  // frame rather than as a tree. Foliage is the only large organic mass in a
  // world of flat stone, so when it goes to silhouette the picture loses the
  // one thing that was not architecture.
  foliageDeep:  c('#4E5F35'),
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
