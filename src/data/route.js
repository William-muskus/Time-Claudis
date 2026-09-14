/**
 * MONTMARTRE SURVEY — Lamarck-Caulaincourt → Abbesses
 * ---------------------------------------------------
 * The geography is 1:1. The geometry is not.
 *
 * Every waypoint below is a real place with real WGS84 coordinates. The rail
 * follows the actual walking route a person takes from the Lamarck-Caulaincourt
 * metro (Line 12) up the north flank of the Butte, across Place Dalida, past
 * Dalida's house on rue d'Orchampt, down through the Bateau-Lavoir, and out
 * onto Place des Abbesses.
 *
 * ACCURACY NOTE (read docs/ROUTE.md before "fixing" a coordinate):
 * This session had no network access to Overpass, OSM tile servers, or Street
 * View — the environment's egress policy denies them. Coordinates are therefore
 * hand-surveyed from knowledge of the quartier, not machine-extracted. Expect
 * ±15 m absolute error on any single point. What IS exact, and what the game
 * actually trades on, is the TOPOLOGY: which street meets which, which way you
 * turn, which side the landmark sits on, and whether you are climbing or
 * descending. Those are asserted in tests/route.test.js. Correct a latitude if
 * you have better data; never correct a turn direction.
 *
 * LOCAL FRAME: right-handed, metres, origin at the Dalida bust.
 *   +X = east   +Y = up   +Z = south   (so north is -Z, and the camera's
 *   default -Z forward means "facing north" at zero yaw)
 */

// Origin: the bronze bust of Dalida, Place Dalida.
export const ORIGIN = { lat: 48.888265, lon: 2.338011, elev: 120.0 };

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

/**
 * The rail spine. Ordered south-bound along the walk.
 *
 *  id        stable key, referenced by encounters + world chunks
 *  name      what a local would call it
 *  lat/lon   WGS84
 *  elev      metres above sea level. The Butte summit is 130 m; the station
 *            sits at 89 m. The climb-crest-descend profile is real and is the
 *            backbone of the game's pacing.
 *  width     usable street width in metres, kerb to kerb
 *  note      what you actually see standing there
 */
export const WAYPOINTS = [
  {
    id: 'lamarck_station',
    name: 'Lamarck–Caulaincourt, sortie métro',
    lat: 48.889363, lon: 2.338545, elev: 89.0, width: 12.0,
    note: 'Line 12. The entrance sits in a dip with the twin staircases rising ' +
          'on either side. Le Refuge café on the corner above. This is the ' +
          'single most photographed metro mouth in the 18th and the game opens here.',
  },
  {
    id: 'escalier_foot',
    name: "Pied de l'escalier Lamarck",
    lat: 48.889310, lon: 2.338280, elev: 89.5, width: 8.0,
    note: 'Foot of the north staircase. Iron handrail down the middle, ' +
          'lamp standards on the flanks. 9 m of climb in two flights.',
  },
  {
    id: 'escalier_top',
    name: 'Haut de l\'escalier, rue Lamarck',
    lat: 48.889100, lon: 2.338150, elev: 98.0, width: 9.0,
    note: 'You surface onto rue Lamarck. The Butte proper starts here.',
  },
  {
    id: 'lamarck_girardon',
    name: 'Rue Lamarck × rue Girardon',
    lat: 48.888900, lon: 2.338320, elev: 104.0, width: 10.0,
    note: 'Turn south, uphill, into rue Girardon. The gradient bites immediately.',
  },
  {
    id: 'brouillards',
    name: 'Allée des Brouillards / Château des Brouillards',
    lat: 48.888500, lon: 2.337800, elev: 114.0, width: 7.0,
    note: 'The white 18th-century folly behind its trees, and the little ' +
          'gated allée. Deep green shade on the right, sun on the left.',
  },
  {
    id: 'place_dalida',
    name: 'Place Dalida — le buste',
    lat: 48.888265, lon: 2.338011, elev: 120.0, width: 16.0,
    note: 'THE landmark. Aslan\'s bronze bust of Dalida on its plinth, 1997. ' +
          'The chest is rubbed gold by thirty years of tourists. Stand behind ' +
          'it and rue de l\'Abreuvoir falls away east toward La Maison Rose — ' +
          'that sightline must be preserved exactly.',
  },
  {
    id: 'girardon_climb',
    name: 'Rue Girardon, montée sud',
    lat: 48.887800, lon: 2.337800, elev: 125.0, width: 9.0,
    note: 'Continuing to climb. Haussmann-lite façades, shutters, narrow sky.',
  },
  {
    id: 'moulin_galette',
    name: 'Moulin de la Galette (Blute-fin)',
    lat: 48.887280, lon: 2.337420, elev: 128.0, width: 11.0,
    note: 'The surviving windmill on its mound above the corner of rue Lepic. ' +
          'Highest point of the walk. The crest of the level.',
  },
  {
    id: 'lepic_orchampt',
    name: 'Rue Lepic × rue d\'Orchampt',
    lat: 48.887050, lon: 2.337100, elev: 127.0, width: 8.0,
    note: 'Turn off the tourist artery into the quiet lane. Sound drops away.',
  },
  {
    id: 'maison_dalida',
    name: "11 bis rue d'Orchampt — la maison de Dalida",
    lat: 48.886900, lon: 2.336900, elev: 124.0, width: 6.0,
    note: 'She lived here from 1962 until 1987. A hôtel particulier set back ' +
          'behind a high wall and a dark green carriage gate, ivy over the ' +
          'coping. You never see the house properly from the street — only ' +
          'the roofline. The game respects that: the gate stays shut.',
  },
  {
    id: 'orchampt_ravignan',
    name: "Rue d'Orchampt × rue Ravignan",
    lat: 48.886600, lon: 2.337400, elev: 118.0, width: 7.0,
    note: 'The lane curves and spills downhill into rue Ravignan.',
  },
  {
    id: 'emile_goudeau',
    name: 'Place Émile-Goudeau — le Bateau-Lavoir',
    lat: 48.886370, lon: 2.337950, elev: 112.0, width: 18.0,
    note: 'Sloping cobbled square, plane trees, a green Wallace fountain, ' +
          'benches. The Bateau-Lavoir frontage on the uphill side — Picasso ' +
          'painted the Demoiselles behind that glass.',
  },
  {
    id: 'ravignan_stairs',
    name: 'Escalier de la rue Ravignan',
    lat: 48.885900, lon: 2.338100, elev: 105.0, width: 8.0,
    note: 'Steps down. Railing, lamps, a long straight descent — the sightline ' +
          'opens right up. Rooftops of the 9th beyond.',
  },
  {
    id: 'trois_freres',
    name: 'Rue des Trois Frères',
    lat: 48.885300, lon: 2.338250, elev: 102.0, width: 9.0,
    note: 'Shopfronts, awnings, the épicerie from Amélie. Level-ish at last.',
  },
  {
    id: 'place_abbesses',
    name: 'Place des Abbesses — l\'édicule Guimard',
    lat: 48.884400, lon: 2.338300, elev: 101.0, width: 22.0,
    note: 'The finish. One of only two surviving Guimard glass-roofed metro ' +
          'entrances in Paris, green cast iron and amber glass. Saint-Jean-de-' +
          'Montmartre in red brick on the south side, the carousel, the Wallace ' +
          'fountain, and the Mur des Je t\'aime in the square behind.',
  },
];

/** Named landmarks that are NOT on the rail but must be visible from it. */
export const LANDMARKS = [
  { id: 'maison_rose',   name: 'La Maison Rose',            lat: 48.888520, lon: 2.338700, elev: 117.0,
    note: 'Pink walls, green trim. Framed down rue de l\'Abreuvoir from Place Dalida.' },
  { id: 'sacre_coeur',   name: 'Basilique du Sacré-Cœur',   lat: 48.886700, lon: 2.343100, elev: 130.0,
    note: 'White travertine domes on the skyline east. Visible from the crest and the Ravignan stairs.' },
  { id: 'moulin_blutefin', name: 'Moulin de la Galette (Blute-fin)', lat: 48.887255, lon: 2.337230, elev: 128.0,
    note: 'The surviving mill on its mound, set back west of rue Girardon. ' +
          'Given its own coordinate rather than a lateral offset from the rail: ' +
          'a landmark that exists only as "fourteen metres left of waypoint 8" ' +
          'cannot be aimed at, cross-referenced, or corrected against a map.' },
  { id: 'moulin_radet',  name: 'Moulin Radet',              lat: 48.887100, lon: 2.337700, elev: 128.0,
    note: 'The second mill, on the rue Lepic corner. People mistake it for the Galette.' },
  { id: 'st_jean',       name: 'Saint-Jean-de-Montmartre',  lat: 48.884250, lon: 2.338050, elev: 101.0,
    note: 'Anatole de Baudot, 1904. Red brick over reinforced concrete, Art Nouveau.' },
  { id: 'mur_des_je',    name: "Le Mur des Je t'aime",      lat: 48.884330, lon: 2.338600, elev: 101.0,
    note: '612 tiles of dark blue enamel, "I love you" in 250 languages.' },
  { id: 'le_refuge',     name: 'Café Le Refuge',            lat: 48.889250, lon: 2.338420, elev: 98.0,
    note: 'Red awning at the top of the Lamarck stairs. First thing you see on surfacing.' },
];

/** The five acts. Time Crisis divides a stage into areas with a hard gate between. */
export const AREAS = [
  { id: 'A1', name: 'La Sortie',        from: 'lamarck_station',  to: 'lamarck_girardon', par: 40 },
  { id: 'A2', name: 'La Montée',        from: 'lamarck_girardon', to: 'place_dalida',     par: 45 },
  { id: 'A3', name: 'La Place',         from: 'place_dalida',     to: 'moulin_galette',   par: 50 },
  { id: 'A4', name: "L'Orchampt",       from: 'moulin_galette',   to: 'emile_goudeau',    par: 50 },
  { id: 'A5', name: 'La Descente',      from: 'emile_goudeau',    to: 'place_abbesses',   par: 55 },
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
