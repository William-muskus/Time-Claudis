import * as THREE from 'three';
import { PALETTE, flat } from '../render/palette.js';
import { geoToLocal, LANDMARKS, waypointById } from '../data/route.js';
import { EMPTY_REGISTRY } from './assets.js';

/**
 * The named things.
 *
 * These are the reason the level is set here rather than anywhere else. Each is
 * placed at its real coordinate and oriented the way it really faces. A local
 * will forgive a simplified façade; they will not forgive the Dalida bust
 * looking the wrong way down rue de l'Abreuvoir.
 *
 * Landmarks are the one part of the world that is NOT procedural. Everything
 * else is generated; these are authored.
 */
export function buildLandmarks(rail, assets = EMPTY_REGISTRY, rng = null) {
  /**
   * A seeded source of scatter, never Math.random.
   *
   * The ivy on the Orchampt gate and the fragments on the Mur des Je t'aime
   * were scattered with Math.random, which made the world non-deterministic
   * for a fixed seed. That is not a cosmetic complaint: the entire
   * verification approach here rests on a given seed producing a given frame,
   * and a test that fires rays at the Orchampt lane failed four times in ten
   * on identical code because the ivy landed somewhere different each build.
   * An intermittently failing test is worse than no test — it trains you to
   * re-run rather than to look.
   */
  const scatter = rng ? () => rng() : Math.random;
  const group = new THREE.Group();
  group.name = 'landmarks';
  const anchors = [];

  /**
   * Prefer the Blender-authored GLB; fall back to the procedural version.
   *
   * The fallback is not a formality. A missing or truncated export must not
   * leave a hole where the Dalida bust should be, and the failure is reported
   * on the console rather than swallowed.
   */
  const authored = (key, procedural) => assets.instance(key) ?? procedural();

  // Off the path, on the left hand of the southbound rail — which here is the
  // east side of the square, where she actually stands and where the
  // Abreuvoir sightline the survey insists on is preserved.
  group.add(placeOffRail(
    rail, 'place_dalida', authored('dalida_bust', () => buildDalidaBust()), -1, 5.2, 1.2));
  // THREE TREES AROUND THE BUST. Cited, and load-bearing: without them she
  // stands alone on an open corner and reads as a bollard. Three crowns at
  // roughly her own height are what make the square a square and give the
  // bronze something to be seen against other than sky.
  group.add(buildDalidaTrees(rail, scatter));
  // EVERYTHING BESIDE THE RAIL IS PLACED OFF THE RAIL, NOT OFF WORLD X.
  //
  // placeAt's `lateral` shifts an object along world X, which only means "to
  // the side of the street" when the street happens to run north-south. Nobody
  // noticed while the survey was hand-placed, because the offsets had been
  // eyeballed against those particular coordinates. The moment the re-survey
  // corrected the bearings, three landmarks — the metro mouth, the Orchampt
  // gate and a Wallace fountain — swung into the middle of the road, and the
  // clearance test caught all three.
  //
  // placeOffRail takes the street's own perpendicular, so an offset means what
  // it says at any bearing and survives the next coordinate correction too.
  group.add(placeOffRail(rail, 'lamarck_station', buildMetroEntrance(), 1, 5.5));
  // Placed at its own surveyed coordinate rather than offset from the rail.
  group.add(atGeo('moulin_blutefin', authored('moulin_galette', () => buildMoulin())));
  group.add(placeOffRail(rail, 'maison_dalida', buildDalidaHouseGate(scatter), -1, 6.0));
  group.add(placeOffRail(rail, 'emile_goudeau', authored('wallace_fountain', buildWallaceFountain), 1, 4.2));
  // Eleven metres, not nine: the square is only 7 m wide and the building is
  // 10 m deep, so its facade has to clear a 3.5 m half-width plus its own
  // half-depth before it stops standing in the square it faces.
  group.add(placeOffRail(rail, 'emile_goudeau', buildBateauLavoir(), -1, 11.0));
  // Beside the rail, not on it — the same mistake the bust made. The edicule
  // is the last thing the level shows you and it was built around the camera:
  // the player finished the stage standing inside the metro entrance. The real
  // one sits in the middle of the square with the pavement passing to its
  // north, which is the rail's left hand coming down off the Butte.
  group.add(placeOffRail(
    rail, 'place_abbesses', authored('guimard_edicule', () => buildGuimardEdicule()), -1, 5.6));
  group.add(placeOffRail(rail, 'place_abbesses', buildCarousel(), 1, 11.0));
  group.add(placeOffRail(rail, 'trois_freres', authored('wallace_fountain', buildWallaceFountain), -1, 6.5));

  // Off-rail but on the sightlines.
  group.add(atGeo('maison_rose', buildMaisonRose()));
  group.add(atGeo('sacre_coeur', buildSacreCoeur()));
  group.add(atGeo('st_jean', buildSaintJean()));
  group.add(atGeo('mur_des_je', buildMurDesJeTaime(scatter)));
  group.add(atGeo('le_refuge', buildCafeTerrace()));
  group.add(atGeo('marcel_ayme', buildPasseMuraille()));
  // Both flanks of the allée, authored, because the procedural street wall is
  // reserved out of this stretch.
  group.add(buildBrouillardsAlley(rail, scatter));
  // The Radet is the corner building at 83 rue Lepic / 1 rue Girardon with a
  // mill on its roof — it was re-erected up there in 1924, hollow, and it is a
  // restaurant underneath. So it is placed as a BUILDING beside the street,
  // not as a monument at a point: its own derived coordinate put it five
  // metres from the rail, and an eight-metre-wide base five metres from the
  // centreline is a building in the middle of the road.
  group.add(placeOffRail(rail, 'moulin_galette', buildMoulinRadet(), -1, 11.0));

  // The Moulin's mound and the Bateau-Lavoir frontage are both good elevated
  // positions, and the métro mouth is the single best "they came from
  // underground" beat on the route.
  anchors.push(
    anchorAtLandmark('moulin_blutefin', 'roof', new THREE.Vector3(0, 7.5, 0)),
    anchorAtWaypoint('lamarck_station', 'metro', new THREE.Vector3(0, 0, 0)),
    anchorAtWaypoint('emile_goudeau', 'balcony', new THREE.Vector3(-13, 6.0, 0)),
    anchorAtWaypoint('place_abbesses', 'metro', new THREE.Vector3(0, 0, 0)),
  );

  void rail;
  return { group, anchors };
}

// ---------------------------------------------------------------------------
// placement helpers
// ---------------------------------------------------------------------------

function placeAt(waypointId, obj, lateral = 0, up = 0) {
  const w = waypointById(waypointId);
  const p = geoToLocal(w.lat, w.lon, w.elev);
  obj.position.set(p.x + lateral, p.y + up, p.z);
  return obj;
}

/**
 * Put an object beside the rail rather than on it.
 *
 * A waypoint is a point on the PLAYER'S PATH, so anything placed at one is
 * placed in the player's way. The Dalida bust was, and at hero scale it is
 * four metres tall: the rail passed 1.8 m from it, which meant the whole view
 * at the Place Dalida combat node was bronze. Every enemy the director spawned
 * there was behind it. Measured with a ray from the camera, the first thing
 * hit was the statue, 1.3 m out.
 *
 * The survey note for this waypoint is explicit that the player stands BEHIND
 * the bust with rue de l'Abreuvoir falling away east, which is also where the
 * real one is — set back on the terrace with the pavement passing to its west.
 * So the offset is measured off the rail's own perpendicular, which keeps it
 * correct however the path curves through the square.
 *
 * `side` is +1 for the rail's right hand, -1 for its left.
 */
function placeOffRail(rail, waypointId, obj, side, lateral, up = 0, align = false) {
  const w = waypointById(waypointId);
  const p = geoToLocal(w.lat, w.lon, w.elev);
  const d = rail.distanceToWaypoint(waypointId);
  const tan = rail.tangentAt(d);
  const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
  obj.position.set(
    p.x + right.x * side * lateral,
    p.y + up,
    p.z + right.z * side * lateral);
  // ALIGN anything longer than it is wide.
  //
  // Positioning alone is enough for a statue or a fountain and useless for a
  // wall: a 34 m garden wall modelled along its own Z and merely translated
  // sideways lies across the street at whatever angle the street happens to
  // run. Yaw is taken from the LEVELLED tangent, because the rail climbs 36 m
  // over its length and a wall aimed down a real 3D tangent leans over.
  if (align) obj.rotation.y = Math.atan2(tan.x, tan.z);
  return obj;
}

function atGeo(landmarkId, obj) {
  const l = LANDMARKS.find((x) => x.id === landmarkId);
  const p = geoToLocal(l.lat, l.lon, l.elev);
  obj.position.set(p.x, p.y, p.z);
  return obj;
}

function anchorAtLandmark(landmarkId, type, offset) {
  const l = LANDMARKS.find((x) => x.id === landmarkId);
  const p = geoToLocal(l.lat, l.lon, l.elev);
  return {
    id: `lm_${landmarkId}_${type}`,
    type,
    worldPos: new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z),
    facing: new THREE.Vector3(0, 0, 1),
  };
}

function anchorAtWaypoint(waypointId, type, offset) {
  const w = waypointById(waypointId);
  const p = geoToLocal(w.lat, w.lon, w.elev);
  return {
    id: `lm_${waypointId}_${type}`,
    type,
    worldPos: new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z),
    facing: new THREE.Vector3(0, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// the landmarks themselves
// ---------------------------------------------------------------------------

/**
 * Aslan's bronze of Dalida, 1997, on its stone plinth.
 *
 * The detail that matters: the chest is rubbed to bright gold by thirty years
 * of tourists while the rest has gone the flat brown-green of weathered bronze.
 * Two materials, one object. Nobody who has stood in front of it would accept
 * a uniformly bronze bust.
 */
function buildDalidaBust() {
  const g = new THREE.Group();
  g.name = 'dalida_bust';

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 1.5, 0.8),
    flat(PALETTE.limestoneMid, { roughness: 0.92 }));
  plinth.position.y = 0.75;
  plinth.castShadow = plinth.receiveShadow = true;
  g.add(plinth);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.22, 1.1),
    flat(PALETTE.limestoneDeep, { roughness: 0.95 }));
  base.position.y = 0.11;
  base.receiveShadow = true;
  g.add(base);

  const bronze = flat(PALETTE.bronzeDalida, { roughness: 0.42, metalness: 0.65 });
  const polished = flat(PALETTE.bronzePolish, { roughness: 0.18, metalness: 0.9 });

  // Torso, cut off at the chest the way a bust is.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.62, 10), bronze);
  torso.position.y = 1.5 + 0.31;
  torso.castShadow = true;
  g.add(torso);

  // The polished band.
  const rub = new THREE.Mesh(new THREE.CylinderGeometry(0.355, 0.38, 0.24, 10), polished);
  rub.position.y = 1.5 + 0.46;
  rub.position.z = 0.03;
  rub.castShadow = true;
  g.add(rub);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.18, 8), bronze);
  neck.position.y = 1.5 + 0.7;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), bronze);
  head.position.y = 1.5 + 0.92;
  head.scale.set(0.92, 1.12, 0.95);
  head.castShadow = true;
  g.add(head);

  // The hair. Big, swept, unmistakable — it is most of the silhouette.
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 8), bronze);
  hair.position.set(0, 1.5 + 0.97, -0.045);
  hair.scale.set(1.08, 1.02, 1.1);
  hair.castShadow = true;
  g.add(hair);

  // She faces roughly east, down rue de l'Abreuvoir toward La Maison Rose.
  g.rotation.y = -Math.PI * 0.42;
  return g;
}

/** The three trees that ring the Dalida bust. */
function buildDalidaTrees(rail, rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'dalida_trees';
  const d0 = rail.distanceToWaypoint('place_dalida');
  const bark = flat(PALETTE.trunkBark, { roughness: 0.9 });
  // Spaced around her, all on the same flank as the bust so the sightline east
  // down rue de l'Abreuvoir stays open — that view is the reason the square is
  // photographed and nothing may be planted across it.
  const spots = [[-7.5, 7.0], [1.5, 8.2], [8.5, 6.4]];
  for (let i = 0; i < spots.length; i++) {
    const [along, lateral] = spots[i];
    const d = d0 + along;
    const p = rail.positionAt(d);
    const t = rail.tangentAt(d);
    const right = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const h = 5.4 + rnd() * 1.6;
    const x = p.x - right.x * lateral, z = p.z - right.z * lateral;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, h, 6), bark);
    trunk.position.set(x, p.y + h / 2, z);
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.2 + rnd() * 0.6, 0),
      flat(i === 1 ? PALETTE.foliageMid : PALETTE.foliageDeep, { roughness: 1 }));
    crown.position.set(x, p.y + h + 1.0, z);
    crown.castShadow = true;
    g.add(crown);
  }
  return g;
}

/**
 * The allée des Brouillards, built by walking the rail.
 *
 * WHY THIS STRETCH IS AUTHORED AT ALL. The allée is a narrow PEDESTRIAN alley:
 * the Château des Brouillards and its garden down one side, low pavilions and
 * houses down the other, trees over both. The procedural generator built what
 * it builds everywhere — a six-storey Haussmann terrace on each flank — and
 * that is the one thing this place is definitively not. It is why people come
 * up this way instead of taking the stairs, and the level was walking them
 * through an ordinary street with a good name.
 *
 * The "folie" went up in 1772 for a lawyer of the Paris Parlement, on the site
 * of an older mill; the mists it is named for came off the springs here. Nerval
 * lived in it around 1830. From the alley you see a white house with a
 * triangular pediment, set back behind a garden wall and trees.
 *
 * WHY IT WALKS THE RAIL instead of being one group placed at the waypoint.
 * Three attempts went in as a rigid block — position it, then align it to the
 * tangent, then flip which flank it sat on — and the clearance test rejected
 * every one. The alley is barely forty metres long and the rail curves through
 * BOTH ends of it, into the climb at the top and into the square at the
 * bottom, so no single straight object of any useful length stays beside it.
 * Emitting a piece per step, each oriented to the tangent where it stands, is
 * how src/world/index.js builds the rest of the street wall, and it follows
 * any curve for free — including whatever the next re-survey produces.
 */
function buildBrouillardsAlley(rail, rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'brouillards_alley';

  const stone = flat(PALETTE.limestoneMid, { roughness: 0.93 });
  const render = flat(PALETTE.limestoneLit, { roughness: 0.9 });
  const iron = flat(PALETTE.ironwork, { roughness: 0.5, metalness: 0.35 });
  const slate = flat(PALETTE.slateDark, { roughness: 0.7 });
  const shutter = flat(PALETTE.shutterGreen, { roughness: 0.8 });
  const bark = flat(PALETTE.trunkBark, { roughness: 0.9 });

  const d0 = rail.distanceToWaypoint('brouillards');
  const FROM = d0 - 11, TO = d0 + 10;

  /** Frame at a distance along the rail, with the tangent levelled. */
  const frame = (d) => {
    const p = rail.positionAt(d);
    const t = rail.tangentAt(d);
    const level = new THREE.Vector3(t.x, 0, t.z).normalize();
    const right = new THREE.Vector3(-level.z, 0, level.x);
    return { p, level, right, yaw: Math.atan2(level.x, level.z) };
  };
  /** Put a mesh at `lateral` metres to `side` of the rail at `d`, facing it. */
  const place = (mesh, d, side, lateral, up) => {
    const f = frame(d);
    mesh.position.set(
      f.p.x + f.right.x * side * lateral, f.p.y + up,
      f.p.z + f.right.z * side * lateral);
    mesh.rotation.y = f.yaw;
    g.add(mesh);
    return mesh;
  };
  const setback = (d) => Math.max(3.0, rail.widthAt(d) * 0.5);

  // --- west flank: the château's garden wall, railings and trees -----------
  // Panels overlap by 20% (2.4 m of wall every 2.0 m). A curving run of
  // straight segments opens a wedge at every joint on the outside of the bend,
  // and a garden wall with daylight through its joints reads as a fence.
  for (let d = FROM; d < TO; d += 2.0) {
    const off = setback(d) + 0.4;
    const w = place(new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.3, 2.4), stone), d, 1, off, 1.15);
    w.castShadow = w.receiveShadow = true;
    place(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 2.4), stone), d, 1, off, 2.37);
    for (let k = 0; k < 2; k++) {
      place(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), iron), d + k, 1, off, 2.9);
    }
    place(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.4), iron), d, 1, off, 3.33);
  }
  // Trees behind the wall. Deep green shade on this flank against sun on the
  // other is the whole character of the alley.
  for (let i = 0; i < 5; i++) {
    const d = FROM + 2 + i * 4.2;
    const h = 6.5 + rnd() * 2.5;
    const off = setback(d) + 3.2 + rnd() * 1.5;
    const tr = place(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, h, 6), bark), d, 1, off, h / 2);
    tr.castShadow = true;
    const cr = place(new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.6 + rnd() * 0.8, 0),
      flat(i % 2 ? PALETTE.foliageDeep : PALETTE.foliageMid, { roughness: 1 })),
      d, 1, off, h + 1.2);
    cr.castShadow = true;
  }
  // The château itself, set well back behind the garden, with its pediment.
  const dc = d0 + 1;
  const back = setback(dc) + 11.5;
  const body = place(new THREE.Mesh(new THREE.BoxGeometry(13, 9.5, 11), render), dc, 1, back, 4.75);
  body.castShadow = body.receiveShadow = true;
  place(new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.5, 11.6), slate), dc, 1, back, 9.75).castShadow = true;
  const ped = place(new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.9, 3), render), dc, 1, back - 5.6, 10.3);
  ped.rotation.set(Math.PI / 2, 0, ped.rotation.y + Math.PI / 2);
  ped.scale.set(1, 0.22, 1);
  ped.castShadow = true;
  for (let f = 0; f < 3; f++) {
    for (let i = 0; i < 3; i++) {
      place(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.9), shutter),
        dc - 3.4 + i * 3.4, 1, back - 5.5, 2.1 + f * 3.0);
    }
  }

  // --- east flank: low pavilions, two and three storeys -------------------
  //
  // SHALLOWER AND WITH FACES ON THEM. The first pass made these nine metres
  // deep with a single shutter each, and at the width of this alley that is
  // not a house, it is a blank slab filling half the frame. What makes a small
  // Montmartre pavilion read is that it is SMALL — a narrow frontage, a low
  // roof with an overhang that casts a line, a door, and shutters in pairs.
  const door = flat(PALETTE.shutterBlue, { roughness: 0.75 });
  let d = FROM + 1;
  for (let i = 0; i < 5 && d < TO; i++) {
    const len = 4.4 + rnd() * 2.2;
    const floors = rnd() < 0.5 ? 2 : 3;
    const h = floors * 2.85;
    const depth = 5.5 + rnd() * 1.5;
    const off = setback(d + len / 2) + 0.7 + depth / 2;
    const face = off - depth / 2 - 0.08;
    const mid = d + len / 2;
    const wallMat = flat(
      [PALETTE.plasterCream, PALETTE.plasterOchre, PALETTE.limestoneMid,
       PALETTE.limestoneLit][i % 4],
      { roughness: 0.92 });
    const b = place(new THREE.Mesh(new THREE.BoxGeometry(depth, h, len), wallMat),
      mid, -1, off, h / 2);
    b.castShadow = b.receiveShadow = true;
    // Roof with a real overhang, so the top of each house draws a hard line.
    place(new THREE.Mesh(new THREE.BoxGeometry(depth + 0.7, 0.42, len + 0.6), slate),
      mid, -1, off, h + 0.21).castShadow = true;
    // A door at ground level and shutters in pairs above it.
    place(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.05, 0.95), door),
      mid - len * 0.22, -1, face, 1.03);
    for (let f = 1; f < floors; f++) {
      for (const k of [-0.26, 0.26]) {
        place(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.8), shutter),
          mid + len * k, -1, face, 1.6 + f * 2.85);
      }
    }
    // A chimney, because every one of these has one and it breaks the roofline.
    place(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.6),
      flat(PALETTE.chimneyTerra, { roughness: 0.9 })),
      mid + len * 0.3, -1, off + 1.2, h + 0.85).castShadow = true;
    d += len + 0.5 + rnd() * 0.8;
  }
  return g;
}

/**
 * Place Marcel-Aymé and the Passe-Muraille.
 *
 * Jean Marais, 1989: a bronze man caught halfway out of a stone wall, one arm
 * and one leg and half a face still inside it, the rest of him straining out.
 * It is the ending of Marcel Aymé's story, where the man who could walk
 * through walls loses the knack mid-wall.
 *
 * WHY IT IS HERE NOW. It sits off rue Girardon at rue Norvins, which is
 * directly on the climb between Place Dalida and the mills — the player walks
 * within a few metres of it — and the level did not have it at all. A resident
 * passes this every day. Leaving it out is the same class of error as getting
 * the Abreuvoir sightline wrong: the geometry was plausible and the place was
 * not the place.
 *
 * Built as a wall with a figure emerging, because the whole image depends on
 * the two being one object. A bronze standing in front of a wall is a statue;
 * a bronze coming OUT of a wall is the story.
 */
function buildPasseMuraille(rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'passe_muraille';

  const stone = flat(PALETTE.limestoneMid, { roughness: 0.94 });
  const bronze = flat(PALETTE.bronzeDalida, { roughness: 0.45, metalness: 0.5 });
  const bronzeLit = flat(PALETTE.bronzePolish, { roughness: 0.5, metalness: 0.45 });

  // The wall. Low and wide, the way the real one is set into the side of the
  // little square rather than standing free.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.1, 0.55), stone);
  wall.position.set(0, 1.55, 0);
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  const cope = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.16, 0.75), stone);
  cope.position.set(0, 3.18, 0);
  cope.castShadow = true;
  g.add(cope);

  // The figure, emerging from the front face. Only the leading half exists —
  // torso, one shoulder, one arm forward, one knee out — and it is offset so
  // the wall plane cuts through him rather than passing behind him.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.86, 0.34), bronze);
  torso.position.set(-0.3, 1.62, 0.34);
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), bronzeLit);
  head.position.set(-0.3, 2.2, 0.36);
  head.castShadow = true;
  g.add(head);
  // The forward arm, reaching out of the stone. This is the silhouette.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.72), bronze);
  arm.position.set(-0.56, 1.78, 0.66);
  arm.rotation.x = -0.22;
  arm.castShadow = true;
  g.add(arm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.19), bronzeLit);
  hand.position.set(-0.56, 1.86, 1.02);
  hand.castShadow = true;
  g.add(hand);
  // The leading knee, mid-stride.
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), bronze);
  leg.position.set(-0.18, 0.95, 0.42);
  leg.rotation.x = -0.3;
  leg.castShadow = true;
  g.add(leg);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.34), bronze);
  foot.position.set(-0.18, 0.62, 0.62);
  foot.castShadow = true;
  g.add(foot);

  // Three cobbles of the little square, so it does not float on the road.
  for (let i = 0; i < 4; i++) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(1.5 + rnd() * 0.5, 0.1, 1.4), stone);
    slab.position.set(-2.4 + i * 1.6, 0.05, 1.3);
    slab.receiveShadow = true;
    g.add(slab);
  }
  return g;
}

/** The Blute-fin windmill on its mound. */
function buildMoulin() {
  const g = new THREE.Group();
  g.name = 'moulin_galette';

  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 9.5, 5, 8),
    flat(PALETTE.foliageDeep, { roughness: 1 }));
  mound.position.y = -2.5;
  mound.receiveShadow = true;
  g.add(mound);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.5, 5.5, 8),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  tower.position.y = 2.75;
  tower.castShadow = tower.receiveShadow = true;
  g.add(tower);

  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 1.8, 8),
    flat(PALETTE.zincShadow, { roughness: 0.6, metalness: 0.3 }));
  cap.position.y = 6.2;
  cap.castShadow = true;
  g.add(cap);

  // Four sails on a hub, tilted the way a mill's sails actually sit.
  const sails = new THREE.Group();
  sails.name = 'sails';
  const woodMat = flat(PALETTE.trunkBark, { roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.6, 0.12), woodMat);
    arm.rotation.z = (i * Math.PI) / 2;
    arm.position.y = 0;
    // Offset so the arms read as a cross of lattice, not a plus sign.
    arm.position.x = Math.sin((i * Math.PI) / 2) * 2.8;
    arm.position.y = Math.cos((i * Math.PI) / 2) * 2.8;
    arm.rotation.z = (i * Math.PI) / 2;
    arm.castShadow = true;
    sails.add(arm);

    const lattice = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.4, 0.05),
      flat(PALETTE.plasterGrey, { roughness: 0.9 }));
    lattice.position.copy(arm.position);
    lattice.rotation.copy(arm.rotation);
    lattice.castShadow = true;
    sails.add(lattice);
  }
  sails.position.set(0, 5.0, 2.5);
  sails.rotation.x = -0.12;
  g.add(sails);
  g.userData.sails = sails;

  return g;
}

/** The second mill on the rue Lepic corner, which everyone mistakes for the first. */
function buildMoulinRadet() {
  const g = new THREE.Group();
  g.name = 'moulin_radet';
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 4.2, 8),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  tower.position.y = 8.1;   // it sits on top of the restaurant below it
  tower.castShadow = true;
  g.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.4, 8),
    flat(PALETTE.chimneyTerra, { roughness: 0.8 }));
  cap.position.y = 10.9;
  cap.castShadow = true;
  g.add(cap);
  const woodMat = flat(PALETTE.trunkBark, { roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.0, 0.1), woodMat);
    arm.position.set(Math.sin((i * Math.PI) / 2) * 2.0, 9.0 + Math.cos((i * Math.PI) / 2) * 2.0, 1.7);
    arm.rotation.z = (i * Math.PI) / 2;
    arm.castShadow = true;
    g.add(arm);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 7),
    flat(PALETTE.plasterOchre, { roughness: 0.9 }));
  base.position.y = 4;
  base.castShadow = base.receiveShadow = true;
  g.add(base);
  return g;
}

/**
 * 11 bis rue d'Orchampt.
 *
 * You cannot see the house from the street and the game does not pretend
 * otherwise: a high rendered wall, ivy over the coping, and a dark green
 * carriage gate that stays shut. Only the roofline shows above. Faking a view
 * of the house would be the single most obvious lie in the level.
 */
function buildDalidaHouseGate(rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'maison_dalida';

  const wall = new THREE.Mesh(new THREE.BoxGeometry(13, 3.4, 0.55),
    flat(PALETTE.plasterCream, { roughness: 0.93 }));
  wall.position.y = 1.7;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);

  const coping = new THREE.Mesh(new THREE.BoxGeometry(13.3, 0.2, 0.8),
    flat(PALETTE.limestoneMid, { roughness: 0.9 }));
  coping.position.y = 3.5;
  coping.castShadow = true;
  g.add(coping);

  // Ivy spilling over the top.
  for (let i = 0; i < 16; i++) {
    const ivy = new THREE.Mesh(
      new THREE.BoxGeometry(0.8 + rnd() * 0.7, 0.5 + rnd() * 0.9, 0.5),
      flat(PALETTE.ivyGreen, { roughness: 1 }));
    ivy.position.set(-6 + i * 0.8, 3.4 - rnd() * 0.5, 0.15);
    ivy.castShadow = true;
    g.add(ivy);
  }

  const gate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.9, 0.2),
    flat(PALETTE.shutterGreen, { roughness: 0.55 }));
  gate.position.set(0, 1.45, 0.3);
  gate.castShadow = true;
  g.add(gate);

  // Vertical boarding on the gate leaves.
  for (let i = 0; i < 8; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.8, 0.06),
      flat(PALETTE.slateDark, { roughness: 0.6 }));
    board.position.set(-1.4 + i * 0.4, 1.45, 0.42);
    g.add(board);
  }

  // The number plate. Small, blue, enamelled — and the only label in the level.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.04),
    flat(PALETTE.shutterBlue, { roughness: 0.4 }));
  plate.position.set(2.0, 2.5, 0.32);
  g.add(plate);

  // The roofline you actually do see, set well back.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 3.5, 8),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  roof.position.set(0, 4.2, -6);
  roof.castShadow = true;
  g.add(roof);
  const mansard = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.4, 4),
    flat(PALETTE.zincShadow, { roughness: 0.55, metalness: 0.3 }));
  mansard.rotation.y = Math.PI / 4;
  mansard.position.set(0, 7.1, -6);
  mansard.castShadow = true;
  g.add(mansard);

  return g;
}

/** La Maison Rose: pink walls, green joinery, on its corner. */
function buildMaisonRose() {
  const g = new THREE.Group();
  g.name = 'maison_rose';
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 7.2, 8),
    flat(PALETTE.plasterPink, { roughness: 0.9 }));
  body.position.y = 3.6;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const trim = flat(PALETTE.shutterGreen, { roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.1), trim);
    win.position.set(-2.6 + i * 2.6, 5.0, 4.05);
    g.add(win);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.12), trim);
  door.position.set(0, 1.15, 4.06);
  g.add(door);
  const band = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.45, 8.1), trim);
  band.position.y = 2.6;
  g.add(band);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.6, 2.2, 4),
    flat(PALETTE.zincShadow, { roughness: 0.6, metalness: 0.3 }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 8.3;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

/**
 * Sacré-Cœur on the skyline.
 *
 * It is 450 m east of the route and 130 m up, so from the rail it is a
 * silhouette and nothing more. Modelled as the three domes and the campanile
 * because that is the whole of what you read at this distance.
 */
function buildSacreCoeur() {
  const g = new THREE.Group();
  g.name = 'sacre_coeur';
  const stone = flat(PALETTE.signWhite, { roughness: 0.85 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(34, 22, 26), stone);
  base.position.y = 11;
  base.castShadow = true;
  g.add(base);

  const dome = (r, h, x, z, y) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stone);
    d.position.set(x, y, z);
    d.scale.y = h / r;
    d.castShadow = true;
    g.add(d);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 6, 12), stone);
    drum.position.set(x, y - 3, z);
    g.add(drum);
  };
  dome(9, 13, 0, 0, 25);
  dome(4.5, 6, -13, 6, 23);
  dome(4.5, 6, 13, 6, 23);

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 28, 10), stone);
  tower.position.set(-2, 25, -15);
  tower.castShadow = true;
  g.add(tower);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3.6, 6, 10), stone);
  spire.position.set(-2, 42, -15);
  g.add(spire);
  return g;
}

/** Saint-Jean-de-Montmartre: red brick over concrete, on Place des Abbesses. */
function buildSaintJean() {
  const g = new THREE.Group();
  g.name = 'st_jean';
  const brick = flat(PALETTE.chimneyTerra, { roughness: 0.92 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 19, 24), brick);
  body.position.y = 9.5;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  // The two slim towers and the big arched west window between them.
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(3.6, 26, 3.6), brick);
    t.position.set(s * 6.2, 13, 12);
    t.castShadow = true;
    g.add(t);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.7, 3.2, 4), brick);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(s * 6.2, 27.6, 12);
    g.add(cap);
  }
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.6, 12, 1, false, 0, Math.PI),
    flat(PALETTE.guimardAmber, { roughness: 0.3 }));
  arch.rotation.x = Math.PI / 2;
  arch.rotation.z = Math.PI;
  arch.position.set(0, 13, 12.2);
  g.add(arch);
  return g;
}

/**
 * The Abbesses édicule: Guimard, cast iron, amber glass.
 *
 * One of only two survivors with the glass roof still on. The orange-amber
 * panes against the green iron are the single most recognisable object on the
 * whole route and the level ends on them.
 */
function buildGuimardEdicule() {
  const g = new THREE.Group();
  g.name = 'guimard_edicule';
  const iron = flat(PALETTE.guimardGreen, { roughness: 0.42, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: PALETTE.guimardAmber, flatShading: true,
    roughness: 0.18, metalness: 0.1,
    // Matches the Blender material: see tools/blender/landmarks.py. At 0.45
    // the roof outshone the sky it is supposed to be lit by.
    emissive: PALETTE.guimardAmber, emissiveIntensity: 0.12,
    transparent: true, opacity: 0.88,
  });

  // Stair enclosure and its balustrade.
  const surround = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.95, 3.0), iron);
  surround.position.y = 0.48;
  surround.castShadow = true;
  g.add(surround);

  // Four corner posts, the Guimard "stems".
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 3.3, 6), iron);
    post.position.set(sx * 2.1, 1.65, sz * 1.35);
    post.castShadow = true;
    g.add(post);
    // The curling head each stem ends in.
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 6, 10, Math.PI * 1.4), iron);
    head.position.set(sx * 2.1, 3.35, sz * 1.35);
    head.rotation.y = Math.PI / 2;
    g.add(head);
  }

  // The glass roof: a shallow shell, amber, lit from within.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.16, 3.8), glass);
  roof.position.y = 3.5;
  g.add(roof);
  for (const s of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.14, 1.5), glass);
    slope.position.set(0, 3.28, s * 2.4);
    slope.rotation.x = s * 0.42;
    g.add(slope);
  }
  // Ribs.
  for (let i = -2; i <= 2; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 5.6), iron);
    rib.position.set(i * 1.25, 3.56, 0);
    g.add(rib);
  }

  // The METROPOLITAIN sign panel on its two stems.
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.62, 0.1),
    flat(PALETTE.guimardAmber, { roughness: 0.35, emissive: PALETTE.guimardAmber }));
  sign.position.set(0, 4.1, -1.5);
  g.add(sign);
  const signFrame = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.85, 0.06), iron);
  signFrame.position.set(0, 4.1, -1.56);
  g.add(signFrame);

  // The dark mouth of the stair.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 2.0),
    flat(0x14131c, { roughness: 1 }));
  mouth.position.y = 0.02;
  g.add(mouth);

  return g;
}

/** Place Émile-Goudeau's Bateau-Lavoir frontage: big north-lit studio glass. */
function buildBateauLavoir() {
  const g = new THREE.Group();
  g.name = 'bateau_lavoir';
  const body = new THREE.Mesh(new THREE.BoxGeometry(17, 9, 10),
    flat(PALETTE.plasterGrey, { roughness: 0.92 }));
  body.position.y = 4.5;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const glassMat = flat(PALETTE.slateDark, { roughness: 0.22, metalness: 0.15 });
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 0.14), glassMat);
    w.position.set(-6 + i * 4, 6.0, 5.05);
    g.add(w);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.7, 0.08),
      flat(PALETTE.ironwork, { roughness: 0.5 }));
    frame.position.set(-6 + i * 4, 6.0, 5.0);
    g.add(frame);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.4, 10.4),
    flat(PALETTE.zincShadow, { roughness: 0.6, metalness: 0.3 }));
  roof.position.y = 9.2;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

/** A Wallace fountain. Dark green, four caryatids, a little dome. */
export function buildWallaceFountain() {
  const g = new THREE.Group();
  g.name = 'wallace';
  const iron = flat(PALETTE.metroGreen, { roughness: 0.45, metalness: 0.45 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 0.55, 8), iron);
  base.position.y = 0.28;
  base.castShadow = true;
  g.add(base);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.85, 8), iron);
  shaft.position.y = 0.95;
  g.add(shaft);

  // The four caryatids, reduced to four standing figures — at arcade distance
  // that is exactly what they read as.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.5, 6), iron);
    fig.position.set(Math.cos(a) * 0.3, 2.1, Math.sin(a) * 0.3);
    fig.castShadow = true;
    g.add(fig);
  }
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 0.22, 8), iron);
  dome.position.y = 2.95;
  g.add(dome);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 8), iron);
  cap.position.y = 3.3;
  cap.castShadow = true;
  g.add(cap);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), iron);
  finial.position.y = 3.62;
  g.add(finial);
  return g;
}

/** Le Mur des Je t'aime: 612 dark blue enamelled tiles. */
function buildMurDesJeTaime(rnd = Math.random) {
  const g = new THREE.Group();
  g.name = 'mur_des_je_taime';
  const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 0.4),
    flat(0x1B2E52, { roughness: 0.35 }));
  wall.position.y = 2.1;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  // The scattered red fragments — the pieces of a broken heart.
  for (let i = 0; i < 9; i++) {
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 + rnd() * 0.5, 0.25 + rnd() * 0.4, 0.06),
      flat(PALETTE.awningRed, { roughness: 0.5 }));
    frag.position.set(-5 + rnd() * 10, 0.9 + rnd() * 2.6, 0.23);
    frag.rotation.z = rnd() * 0.5;
    g.add(frag);
  }
  return g;
}

/** Café terrace: awning, tables, rattan chairs. Le Refuge at the Lamarck stairs. */
function buildCafeTerrace() {
  const g = new THREE.Group();
  g.name = 'cafe';
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 9),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  body.position.y = 6;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const awning = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.14, 2.6),
    flat(PALETTE.awningRed, { roughness: 0.95 }));
  awning.position.set(0, 3.5, 5.6);
  awning.rotation.x = -0.16;
  awning.castShadow = true;
  g.add(awning);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.6, 0.12),
    flat(PALETTE.slateDark, { roughness: 0.25 }));
  glass.position.set(0, 1.9, 4.55);
  g.add(glass);

  const tableMat = flat(PALETTE.trunkBark, { roughness: 0.8 });
  const chairMat = flat(PALETTE.plasterOchre, { roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const x = -3.6 + i * 2.4;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 8), tableMat);
    top.position.set(x, 0.74, 6.4);
    top.castShadow = true;
    g.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.72, 6), tableMat);
    leg.position.set(x, 0.36, 6.4);
    g.add(leg);
    for (const s of [-1, 1]) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.42), chairMat);
      ch.position.set(x + s * 0.75, 0.45, 6.4);
      ch.castShadow = true;
      g.add(ch);
    }
  }
  return g;
}

/** The Abbesses carousel. Two decks, a candy-striped canopy, bulbs. */
function buildCarousel() {
  const g = new THREE.Group();
  g.name = 'carousel';
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.35, 14),
    flat(PALETTE.plasterCream, { roughness: 0.9 }));
  deck.position.y = 0.5;
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.2, 8),
    flat(PALETTE.guimardAmber, { roughness: 0.4, metalness: 0.4 }));
  pole.position.y = 2.6;
  g.add(pole);

  // Striped canopy.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.5, 3),
      flat(i % 2 ? PALETTE.awningRed : PALETTE.awningCream, { roughness: 0.9 }));
    seg.position.set(Math.cos(a) * 2.7, 4.5, Math.sin(a) * 2.7);
    seg.rotation.z = -0.5 * Math.cos(a);
    seg.rotation.x = 0.5 * Math.sin(a);
    seg.castShadow = true;
    g.add(seg);
  }
  // Horses.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.6, 0.3),
      flat(PALETTE.signWhite, { roughness: 0.8 }));
    h.position.set(Math.cos(a) * 2.2, 1.5, Math.sin(a) * 2.2);
    h.rotation.y = -a;
    h.castShadow = true;
    g.add(h);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5),
      flat(PALETTE.guimardAmber, { metalness: 0.5, roughness: 0.35 }));
    bar.position.set(Math.cos(a) * 2.2, 2.2, Math.sin(a) * 2.2);
    g.add(bar);
  }
  return g;
}

/**
 * The Lamarck-Caulaincourt mouth.
 *
 * Not a Guimard — this one is the later, plainer Dervaux style: a low balustrade
 * ring, a simple mast with the yellow M, and the stair dropping away. What makes
 * it famous is the setting rather than the ironwork: it sits in a dip with the
 * twin flights climbing on either side, which is the shot every visitor takes
 * and the shot the game opens on.
 */
function buildMetroEntrance() {
  const g = new THREE.Group();
  g.name = 'metro_lamarck';
  const iron = flat(PALETTE.metroGreen, { roughness: 0.45, metalness: 0.45 });

  // Balustrade ring around the stairwell.
  const ringR = 2.1;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 1.45 + Math.PI * 0.28;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), iron);
    post.position.set(Math.cos(a) * ringR, 0.48, Math.sin(a) * ringR);
    post.castShadow = true;
    g.add(post);
  }
  const handrail = new THREE.Mesh(
    new THREE.TorusGeometry(ringR, 0.05, 6, 20, Math.PI * 1.45), iron);
  handrail.rotation.x = Math.PI / 2;
  handrail.rotation.z = -Math.PI * 0.28;
  handrail.position.y = 0.95;
  g.add(handrail);

  // The dark stairwell.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 2.6),
    flat(0x12111a, { roughness: 1 }));
  mouth.position.y = 0.03;
  g.add(mouth);
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.34),
      flat(PALETTE.stairStone, { roughness: 0.95 }));
    step.position.set(0, -0.08 - i * 0.17, -0.9 + i * 0.34);
    g.add(step);
  }

  // The mast and the yellow M roundel.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), iron);
  mast.position.set(1.9, 1.7, -0.6);
  mast.castShadow = true;
  g.add(mast);
  const roundel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 14),
    flat(PALETTE.guimardAmber, {
      roughness: 0.35, emissive: PALETTE.guimardAmber, emissiveIntensity: 0.4,
    }));
  roundel.rotation.x = Math.PI / 2;
  roundel.position.set(1.9, 3.5, -0.6);
  roundel.castShadow = true;
  g.add(roundel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.055, 6, 16), iron);
  ring.position.set(1.9, 3.5, -0.62);
  g.add(ring);

  // The twin flights either side, which are the real landmark here.
  for (const s of [-1, 1]) {
    const flight = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.165, 0.32),
        flat(PALETTE.stairStone, { roughness: 0.93 }));
      step.position.set(0, 0.08 + i * 0.165, -i * 0.32);
      step.castShadow = step.receiveShadow = true;
      flight.add(step);
    }
    const hr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 8.6),
      flat(PALETTE.ironwork, { roughness: 0.5, metalness: 0.4 }));
    hr.position.set(0, 3.2, -4.2);
    hr.rotation.x = -0.47;
    flight.add(hr);
    flight.position.set(s * 6.2, 0, -1.5);
    flight.rotation.y = s * 0.12;
    g.add(flight);
  }

  return g;
}
