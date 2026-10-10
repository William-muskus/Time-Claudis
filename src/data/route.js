/**
 * MONTMARTRE SURVEY — Lamarck-Caulaincourt → Abbesses
 * ---------------------------------------------------
 * The geography is 1:1, and since October 2026 so is the geometry.
 *
 * Every waypoint below sits on a real street centreline. The rail follows the
 * actual walk: out of the Lamarck-Caulaincourt métro onto the landing of the
 * rue Pierre-Dac steps, up to rue Caulaincourt, across Place
 * Constantin-Pecqueur, up the rue Girardon steps to Place Dalida, south up rue
 * Girardon past Place Marcel-Aymé, straight over rue Lepic between the two
 * windmills, down rue d'Orchampt past 11 bis, through Place Émile-Goudeau and
 * down rue Ravignan to Place des Abbesses.
 *
 * PROVENANCE. Read this before "fixing" a coordinate.
 *
 * Until this revision the machine that built the game could reach no vector
 * source at all, and every coordinate here was cited from search snippets —
 * which put the start of the level eighty metres from the métro, inside a
 * planted square; swapped the two windmills; and put the whole route about
 * twenty metres too high. It can reach them now, and the route was re-derived
 * from them:
 *
 *   positions   IGN BD TOPO v3 road centrelines, cross-checked against the
 *               OpenStreetMap way geometry, which is denser on the lanes
 *   elevations  IGN RGE ALTI terrain model on a 2.5 m grid (tools/geo)
 *   widths      measured facade to facade from the BD TOPO footprints, and
 *               capped at 14 m so an open square stays a square rather than
 *               becoming a 24-metre road
 *   landmarks   the OSM node or way for that object, or the BD TOPO footprint
 *               where IGN classifies it (both mills: "Moulin à vent")
 *
 * So each entry carries a `src` field:
 *
 *   'surveyed'  placed on IGN/OSM geometry by tools/geo; the rest of the
 *               pipeline (buildings, terrain, trees) uses the same data in the
 *               same frame, so these agree with the world they stand in.
 *   'cited'     taken from a figure in a published source (kept where the
 *               object is outside the survey corridor, e.g. Sacré-Cœur).
 *   'est'       placed from knowledge of the quartier alone. Correct freely.
 *
 * `shape: true` marks a point that exists only to make the spline follow the
 * real street; it has no name and nothing is keyed to it.
 *
 * What the game trades on is still the TOPOLOGY — which street meets which,
 * which way you turn, whether you are climbing or descending — and those are
 * asserted in tests/route.test.js. Never correct a turn direction.
 *
 * LOCAL FRAME: right-handed, metres, origin at the Dalida bust.
 *   +X = east   +Y = up   +Z = south   (so north is -Z, and the camera's
 *   default -Z forward means "facing north" at zero yaw)
 *
 * tools/geo/build.py converts every building, street and tree into this same
 * frame with these same constants, and tests/geo.test.js asserts they agree.
 */

// Origin: the bronze bust of Dalida — the OpenStreetMap node for the statue —
// at the ground level of Place Dalida from the IGN terrain model.
export const ORIGIN = { lat: 48.8885450, lon: 2.3380676, elev: 104.0 };

const M_PER_DEG_LAT = 111320.0;
// cos(48.888°) — longitude scale at the latitude of the Butte.
const M_PER_DEG_LON = 73224.0;

/** WGS84 → local metres (X east, Y up, Z south). */
export function geoToLocal(lat, lon, elev = ORIGIN.elev) {
  return {
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: elev - ORIGIN.elev,
    z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
  };
}

/** Local metres → WGS84. Inverse of geoToLocal; used by the map overlay. */
export function localToGeo(x, y, z) {
  return {
    lat: ORIGIN.lat - z / M_PER_DEG_LAT,
    lon: ORIGIN.lon + x / M_PER_DEG_LON,
    elev: ORIGIN.elev + y,
  };
}

/** The constants tools/geo/build.py must use. Asserted by tests/geo.test.js. */
export const FRAME = { M_PER_DEG_LAT, M_PER_DEG_LON };

/**
 * The rail spine, in walk order.
 *
 *  id        stable key, referenced by encounters + world chunks
 *  name      what a local would call it
 *  lat/lon   WGS84
 *  elev      metres above sea level, from RGE ALTI — EXCEPT on the three
 *            flights of steps, where a 2.5 m terrain grid smears the retaining
 *            walls either side into the stairs and reports grades no staircase
 *            has (48% on the first five metres of rue Pierre-Dac). There the
 *            flight is made uniform between its measured top and bottom, and
 *            the Pierre-Dac landing is set between what OSM's step counts
 *            imply (20 steps up, 19-20 down to rue Lamarck) and what IGN's
 *            road levels give. 85.0 m; the two sources disagree by 2 m. The station landing is at
 *            85 m, the crest by Place Marcel-Aymé at 111, Abbesses at 82: a
 *            26 m climb and a 29 m descent.
 *  width     street width in metres, facade to facade, capped at 14
 *  note      what you actually see standing there
 */
export const WAYPOINTS = [
  {
    id: 'lamarck_station', src: 'surveyed',
    name: 'Lamarck–Caulaincourt — l\'entrée, rue Pierre-Dac',
    lat: 48.8898108, lon: 2.3386516, elev: 85.0, width: 10.5,
    note: 'Line 12. The entrance is set into the retaining wall between rue Lamarck below and rue Caulaincourt above, on the landing of the rue Pierre-Dac steps: two lower flights of 19 and 20 steps fall away either side of it to rue Lamarck, and one flight of 20 climbs to rue Caulaincourt. The game opens on that landing, facing up the flight.',
  },
  {
    id: 'escalier_foot', src: 'surveyed',
    name: 'Escalier Pierre-Dac, volée haute',
    lat: 48.8897637, lon: 2.3386166, elev: 86.0, width: 10.5,
    note: 'Halfway up the Pierre-Dac flight. Iron handrail, lamp standards, the café terraces of rue Caulaincourt appearing over the top step.',
  },
  // Beside a Sophora the city records at the edge of the flight: the walk
  // keeps to the east half of the steps so the tree stays where it stands.
  { id: 's_pierre_dac', src: 'surveyed', shape: true, lat: 48.8896733, lon: 2.3385551, elev: 87.6, width: 10.5 },
  {
    id: 'escalier_top', src: 'surveyed',
    name: 'Haut des marches — rue Caulaincourt',
    lat: 48.889612, lon: 2.3384907, elev: 89.1, width: 14.0,
    note: 'Rue Caulaincourt, nine metres above rue Lamarck. Cross it and the planted square opens ahead.',
  },
  { id: 's_caulaincourt', src: 'surveyed', shape: true, lat: 48.8895132, lon: 2.338436, elev: 89.6, width: 14.0 },
  {
    id: 'constantin_pecqueur', src: 'surveyed',
    name: 'Place Constantin-Pecqueur',
    lat: 48.8893066, lon: 2.3383268, elev: 91.4, width: 14.0,
    note: 'Place Constantin-Pecqueur: a planted square climbing south between rue Caulaincourt and the foot of rue Girardon. Trees, benches, the Steinlen memorial. The first open space of the walk, and the first real fight.',
  },
  { id: 's_pecqueur', src: 'surveyed', shape: true, lat: 48.8890641, lon: 2.3382039, elev: 93.7, width: 14.0 },
  { id: 's_pecqueur_2', src: 'surveyed', shape: true, lat: 48.8889473, lon: 2.3381083, elev: 94.7, width: 14.0 },
  {
    id: 'girardon_steps', src: 'surveyed',
    name: 'Escalier de la rue Girardon',
    lat: 48.8888044, lon: 2.3380264, elev: 96.1, width: 12.0,
    note: 'Foot of the rue Girardon steps at the top of the square. About nine and a half metres of climb to Place Dalida.',
  },
  { id: 's_girardon_steps', src: 'surveyed', shape: true, lat: 48.88865, lon: 2.3380606, elev: 100.6, width: 12.0 },
  {
    id: 'place_dalida', src: 'surveyed',
    name: 'Place Dalida — le buste',
    lat: 48.8885306, lon: 2.3381359, elev: 104.2, width: 14.0,
    note: 'THE landmark. The bust stands on the west side of the little square at the top of the Girardon steps, four metres off the rail, facing east down rue de l\'Abreuvoir toward La Maison Rose. Named by decree on 5 December 1996 for the crossroads of the allée des Brouillards, the rue de l\'Abreuvoir and the rue Girardon. Aslan\'s bronze, 1997, chest rubbed gold by thirty years of tourists.',
  },
  { id: 's_girardon_1', src: 'surveyed', shape: true, lat: 48.8884442, lon: 2.33804, elev: 104.6, width: 14.0 },
  {
    id: 'girardon_climb', src: 'surveyed',
    name: 'Rue Girardon, montée — square Suzanne-Buisson',
    lat: 48.8882736, lon: 2.3379581, elev: 105.7, width: 14.0,
    note: 'Rue Girardon climbing south. Square Suzanne-Buisson and its Saint-Denis statue behind the railings on the right; the Château des Brouillards back over the right shoulder.',
  },
  { id: 's_girardon_2', src: 'surveyed', shape: true, lat: 48.8881208, lon: 2.3378351, elev: 107.1, width: 14.0 },
  { id: 's_girardon_3', src: 'surveyed', shape: true, lat: 48.8879771, lon: 2.3377259, elev: 108.3, width: 14.0 },
  {
    id: 'marcel_ayme', src: 'surveyed',
    name: 'Rue Girardon × place Marcel-Aymé',
    lat: 48.8877436, lon: 2.3375757, elev: 110.5, width: 14.0,
    note: 'Place Marcel-Aymé opens on the left: Jean Marais\'s Passe-Muraille (1989), a man caught halfway out of a wall at the rue Norvins end, about forty metres up the place.',
  },
  { id: 's_girardon_4', src: 'surveyed', shape: true, lat: 48.8875998, lon: 2.3374664, elev: 110.9, width: 14.0 },
  { id: 's_girardon_5', src: 'surveyed', shape: true, lat: 48.88745, lon: 2.3373479, elev: 109.6, width: 11.5 },
  {
    id: 'moulin_galette', src: 'surveyed',
    name: 'Rue Lepic × rue Girardon — les deux moulins',
    lat: 48.8873303, lon: 2.3372752, elev: 108.8, width: 14.0,
    note: 'The corner of rue Lepic. The Radet stands over the corner restaurant on the right; the Blute-fin is sixty metres further west behind its garden wall, on its own mound seven metres above the street — that height is measured, not invented. Most people photograph the Radet believing it is the Galette.',
  },
  {
    id: 'lepic_orchampt', src: 'surveyed',
    name: 'Rue Lepic × rue d\'Orchampt',
    lat: 48.8872245, lon: 2.337281, elev: 108.5, width: 14.0,
    note: 'Straight across rue Lepic into rue d\'Orchampt. The sound drops away.',
  },
  // Centred in the mouth of rue d'Orchampt, read off the cadastral footprints:
  // the lane is three to four metres wide here and runs south-south-west.
  { id: 's_orchampt_0', src: 'surveyed', shape: true, lat: 48.8871661, lon: 2.3372345, elev: 108.2, width: 4.0 },
  { id: 's_orchampt_1', src: 'surveyed', shape: true, lat: 48.8871043, lon: 2.3371861, elev: 108.0, width: 4.0 },
  { id: 's_orchampt_1b', src: 'surveyed', shape: true, lat: 48.8870358, lon: 2.3371389, elev: 107.6, width: 4.0 },
  { id: 's_orchampt_1c', src: 'surveyed', shape: true, lat: 48.8869981, lon: 2.3371103, elev: 107.2, width: 4.0 },
  {
    id: 'maison_dalida', src: 'surveyed',
    name: '11 bis rue d\'Orchampt — la maison de Dalida',
    lat: 48.8869685, lon: 2.3370761, elev: 106.9, width: 4.0,
    note: '11 bis rue d\'Orchampt: she lived here from 1962 until 1987. The top of the lane is barely four metres wall to wall — measured from the cadastral footprints, not chosen. Here the west side opens: the garden in front of the house, behind its wall and dark green carriage gate, which the cadastre records as open ground and not as a building. You never see the house properly from the street.',
  },
  { id: 's_orchampt_2', src: 'surveyed', shape: true, lat: 48.8868743, lon: 2.3371174, elev: 105.9, width: 11.0 },
  { id: 'orchampt_bend', src: 'surveyed', name: 'Rue d\'Orchampt, le coude', note: 'Where the lane widens to eleven metres wall to wall and turns east: the one place in rue d\'Orchampt with room to fight.', lat: 48.8867015, lon: 2.3373572, elev: 105.1, width: 11.0 },
  { id: 's_orchampt_4', src: 'surveyed', shape: true, lat: 48.8865113, lon: 2.3376278, elev: 104.6, width: 10.5 },
  {
    id: 'orchampt_ravignan', src: 'surveyed',
    name: 'Rue d\'Orchampt × rue Ravignan',
    lat: 48.8863063, lon: 2.3379171, elev: 104.5, width: 14.0,
    note: 'The lane widens and spills into rue Ravignan at the head of Place Émile-Goudeau.',
  },
  { id: 's_goudeau_1', src: 'surveyed', shape: true, lat: 48.8861805, lon: 2.3379854, elev: 103.4, width: 14.0 },
  {
    id: 'emile_goudeau', src: 'surveyed',
    name: 'Place Émile-Goudeau — le Bateau-Lavoir',
    lat: 48.8860368, lon: 2.3380127, elev: 101.4, width: 14.0,
    note: 'Place Émile-Goudeau: a sloping cobbled terrace, the Wallace fountain in the middle of it, horse chestnuts. The Bateau-Lavoir is on the right: twenty-one metres tall from its foundations, but the ground falls away so steeply that only its top floor shows to the square. Picasso painted the Demoiselles in there.',
  },
  { id: 's_goudeau_2', src: 'surveyed', shape: true, lat: 48.885904, lon: 2.3380266, elev: 99.3, width: 14.0 },
  {
    id: 'ravignan_stairs', src: 'surveyed',
    name: 'Escalier de la rue Ravignan',
    lat: 48.8858032, lon: 2.3379034, elev: 96.9, width: 14.0,
    note: 'The steps at the foot of the square down to the lower rue Ravignan.',
  },
  {
    id: 'trois_freres', src: 'surveyed',
    name: 'Rue Ravignan × rue des Trois-Frères',
    lat: 48.8856864, lon: 2.3379717, elev: 95.7, width: 14.0,
    note: 'Rue des Trois-Frères comes in from the left. Rue Ravignan carries on down, steep and straight.',
  },
  { id: 's_ravignan_1', src: 'surveyed', shape: true, lat: 48.8855696, lon: 2.3379034, elev: 93.4, width: 14.0 },
  {
    id: 'ravignan_bas', src: 'surveyed',
    name: 'Rue Ravignan, la descente',
    lat: 48.8853672, lon: 2.3377687, elev: 90.2, width: 14.0,
    note: 'The descent. Rue Ravignan drops twelve metres to rue des Abbesses.',
  },
  { id: 's_ravignan_2', src: 'surveyed', shape: true, lat: 48.8851295, lon: 2.3375893, elev: 86.6, width: 14.0 },
  {
    id: 'abbesses_corner', src: 'surveyed',
    name: 'Rue Ravignan × rue des Abbesses',
    lat: 48.8849408, lon: 2.3374801, elev: 83.8, width: 14.0,
    note: 'Rue des Abbesses. Shops, awnings, noise, people. Turn left toward the square.',
  },
  { id: 's_abbesses_1', src: 'surveyed', shape: true, lat: 48.8848151, lon: 2.337603, elev: 83.1, width: 14.0 },
  {
    id: 'rue_abbesses', src: 'surveyed',
    name: 'Rue des Abbesses',
    lat: 48.8847252, lon: 2.3377942, elev: 82.5, width: 14.0,
    note: 'Rue des Abbesses, level at last. Saint-Jean-de-Montmartre\'s red brick ahead on the right.',
  },
  { id: 's_abbesses_2', src: 'surveyed', shape: true, lat: 48.8846084, lon: 2.3379854, elev: 82.0, width: 14.0 },
  { id: 's_place_1', src: 'surveyed', shape: true, lat: 48.8845366, lon: 2.3381493, elev: 81.7, width: 14.0 },
  // The square is planted on a grid of planes, and the old end point stood
  // 1.2 m from one of them with a row of trunks between it and the édicule.
  // These two points were found by search over the city's tree records: the
  // walk threads the trunks with nearly two metres to spare, keeps clear of
  // the carousel, and stops six metres in front of the édicule with every
  // trunk at least 2.5 m off the line of sight.
  { id: 's_place_2', src: 'surveyed', shape: true, lat: 48.884534, lon: 2.3384227, elev: 81.7, width: 14.0 },
  {
    id: 'place_abbesses', src: 'surveyed',
    name: 'Place des Abbesses — l\'édicule Guimard',
    lat: 48.8844667, lon: 2.3385661, elev: 81.9, width: 14.0,
    note: 'The finish. Guimard\'s édicule — one of only two left with its glass roof (the other is Porte Dauphine); it stood at the Hôtel de Ville until 1974 — over the deepest station on the network. Saint-Jean-de-Montmartre, the carousel, and the Mur des Je t\'aime in square Jehan-Rictus behind.',
  },
];

/** Named landmarks that are NOT on the rail but must be visible from it. */
export const LANDMARKS = [
  { id: 'dalida_bust', src: 'surveyed', name: 'Buste de Dalida (Aslan, 1997)',
    lat: 48.8885450, lon: 2.3380676, elev: 104.5,
    note: 'OpenStreetMap node "Statue de Dalida". The origin of the local frame.' },
  { id: 'maison_rose', src: 'surveyed', name: 'La Maison Rose',
    lat: 48.8879853, lon: 2.3396455, elev: 111.8,
    note: '2 rue de l\'Abreuvoir, on the corner of rue des Saules — the far end ' +
          'of the 133 m street, framed from Place Dalida. Pink walls, green trim.' },
  { id: 'sacre_coeur', src: 'cited', name: 'Basilique du Sacré-Cœur',
    lat: 48.886700, lon: 2.343100, elev: 130.0,
    note: 'White travertine on the skyline east, outside the survey corridor. ' +
          'From inside these streets you never see the building, only the dome.' },
  { id: 'moulin_blutefin', src: 'surveyed', name: 'Moulin de la Galette (Blute-fin)',
    lat: 48.8876623, lon: 2.3363106, elev: 116.5,
    note: 'BD TOPO "Moulin à vent", ground 116.5 m: on its mound seven metres above ' +
          'rue Lepic. Built 1622, the only mill in Paris still on its original site. ' +
          'The previous survey had this coordinate on the Radet — the two were swapped.' },
  { id: 'moulin_radet', src: 'surveyed', name: 'Moulin Radet',
    lat: 48.8873924, lon: 2.3371092, elev: 109.0,
    note: 'BD TOPO "Moulin à vent", ground 109 m, at the rue Lepic / rue Girardon ' +
          'corner over the restaurant. Re-erected there in 1924, hollow.' },
  { id: 'marcel_ayme', src: 'surveyed', name: 'Le Passe-Muraille (Jean Marais, 1989)',
    lat: 48.8875399, lon: 2.3380698, elev: 115.0,
    note: 'Place Marcel-Aymé, at the rue Norvins end — a bronze man caught halfway ' +
          'out of a stone wall. OSM sculpture node, inaugurated 25 February 1989.' },
  { id: 'maison_dalida', src: 'surveyed', name: '11 bis rue d\'Orchampt',
    lat: 48.8870144, lon: 2.3369571, elev: 106.7,
    note: 'OSM "Ancienne maison de Dalida". Her house from 1962 to 1987.' },
  { id: 'chateau_brouillards', src: 'surveyed', name: 'Château des Brouillards',
    lat: 48.8884293, lon: 2.3375514, elev: 106.9,
    note: 'The white 1772 folly west of Place Dalida, behind its garden.' },
  { id: 'bateau_lavoir', src: 'surveyed', name: 'Le Bateau-Lavoir',
    lat: 48.8861477, lon: 2.3376056, elev: 97.4,
    note: '13 place Émile-Goudeau. Burnt out in 1970, rebuilt 1978.' },
  { id: 'st_jean', src: 'surveyed', name: 'Saint-Jean-de-Montmartre',
    lat: 48.8841996, lon: 2.3379083, elev: 82.0,
    note: '19-21 rue des Abbesses. Anatole de Baudot, 1894-1904: red brick over ' +
          'reinforced concrete, the first church of its kind.' },
  { id: 'mur_des_je', src: 'surveyed', name: "Le Mur des Je t'aime",
    lat: 48.8848146, lon: 2.3385192, elev: 82.9,
    note: 'Square Jehan-Rictus. Enamelled lava tiles, "I love you" in 311 ' +
          'languages. Three published sources put it in three places 25 m apart; ' +
          'this is the OSM node, which sits inside the square they all name.' },
  { id: 'saint_denis', src: 'surveyed', name: 'Statue de Saint-Denis',
    lat: 48.8882007, lon: 2.3372010, elev: 108.7,
    note: 'Square Suzanne-Buisson, on the right of the rue Girardon climb.' },
  { id: 'metro_lamarck', src: 'surveyed', name: 'Métro Lamarck-Caulaincourt',
    lat: 48.8898122, lon: 2.3386521, elev: 84.5,
    note: 'OSM subway_entrance "Rue Lamarck".' },
  { id: 'carousel_abbesses', src: 'surveyed', name: 'Le manège de la place des Abbesses',
    lat: 48.8844351, lon: 2.3384595, elev: 81.6,
    note: 'OSM attraction=carousel, checked on the ground April 2025: fourteen metres ' +
          'west of the édicule.' },
  { id: 'edicule_abbesses', src: 'surveyed', name: 'Édicule Guimard, Abbesses',
    lat: 48.8844592, lon: 2.3386517, elev: 81.4,
    note: 'OSM subway_entrance on Place des Abbesses.' },
];

/** The five acts. Time Crisis divides a stage into areas with a hard gate between. */
export const AREAS = [
  { id: 'A1', name: 'La Sortie',        from: 'lamarck_station',     to: 'constantin_pecqueur', par: 40 },
  { id: 'A2', name: 'La Montée',        from: 'constantin_pecqueur', to: 'place_dalida',        par: 45 },
  { id: 'A3', name: 'La Place',         from: 'place_dalida',        to: 'moulin_galette',      par: 50 },
  { id: 'A4', name: "L'Orchampt",       from: 'moulin_galette',      to: 'emile_goudeau',       par: 50 },
  { id: 'A5', name: 'La Descente',      from: 'emile_goudeau',       to: 'place_abbesses',      par: 55 },
];

export function waypointById(id) {
  const w = WAYPOINTS.find((w) => w.id === id);
  if (!w) throw new Error(`Unknown waypoint: ${id}`);
  return w;
}

/** Waypoints projected into the local metre frame, in walk order. */
export function railPoints() {
  return WAYPOINTS.map((w) => ({ id: w.id, width: w.width, ...geoToLocal(w.lat, w.lon, w.elev) }));
}
