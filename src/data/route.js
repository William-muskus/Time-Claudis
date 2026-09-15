/**
 * MONTMARTRE SURVEY — Lamarck-Caulaincourt → Abbesses
 * ---------------------------------------------------
 * The geography is 1:1. The geometry is simplified.
 *
 * Every waypoint below is a real place. The rail follows the actual walking
 * route from the Lamarck-Caulaincourt metro (Line 12) up the north flank of
 * the Butte, across Place Dalida, past the two windmills, down rue d'Orchampt
 * to the Bateau-Lavoir, and out onto Place des Abbesses.
 *
 * PROVENANCE. Read this before "fixing" a coordinate.
 *
 * This machine cannot reach OpenStreetMap, Overpass, the IGN, the Paris open
 * data portal, Wikipedia, or any tile server — the egress policy answers 403
 * to CONNECT for all of them (see docs/CONSTRAINTS.md). There is therefore no
 * vector source to import, and no amount of care here produces a survey-grade
 * model. What there IS, is web SEARCH, which returns figures from those same
 * sources as text.
 *
 * So each entry carries a `src` field:
 *
 *   'cited'   coordinate or dimension taken from a figure found in search
 *             results and recorded in docs/ROUTE.md with what stated it.
 *             Trust these; correct them only against something better.
 *   'derived' positioned by interpolating along the real street between two
 *             cited anchors, using the street's own cited length where one
 *             exists. Topology is right; expect a few metres of error.
 *   'est'     placed from knowledge of the quartier alone. Correct freely.
 *
 * Five cited anchors carry the whole traverse: the two metro stations at each
 * end, the Dalida bust, the Bateau-Lavoir, and the Blute-fin. The previous
 * version of this file was hand-placed throughout and was wrong by 20-58 m at
 * those five points — worst of all on rue de l'Abreuvoir, the most
 * photographed sightline in the quartier, which was modelled at 58 m when the
 * street is 133 m long. That is the class of error this re-survey fixes.
 *
 * Two independent checks close on the corrected table: Place Dalida to La
 * Maison Rose measures 136 m straight against a street cited at 133 m along
 * its curve, and station to station measures 479 m against 479 m cited.
 *
 * What is exact regardless of source, and what the game actually trades on,
 * is the TOPOLOGY: which street meets which, which way you turn, which side a
 * landmark sits on, and whether you are climbing or descending. Those are
 * asserted in tests/route.test.js. Correct a latitude if you have better data;
 * never correct a turn direction.
 *
 * LOCAL FRAME: right-handed, metres, origin at the Dalida bust.
 *   +X = east   +Y = up   +Z = south   (so north is -Z, and the camera's
 *   default -Z forward means "facing north" at zero yaw)
 */

// Origin: the bronze bust of Dalida, Place Dalida. Cited coordinate — the
// previous value sat 34 m south of it, which offset the entire level.
export const ORIGIN = { lat: 48.888570, lon: 2.338040, elev: 108.0 };

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
    id: 'lamarck_station', src: 'cited',
    name: 'Lamarck–Caulaincourt, sortie métro',
    lat: 48.889139, lon: 2.338159, elev: 92.0, width: 12.0,
    note: 'Line 12, 105 rue Caulaincourt. The entrance sits in a dip with the ' +
          'twin staircases rising on either side. Le Refuge café on the corner ' +
          'above. The single most photographed metro mouth in the 18th, and the ' +
          'game opens here.',
  },
  {
    id: 'escalier_foot', src: 'derived',
    name: "Pied de l'escalier Lamarck",
    lat: 48.889064, lon: 2.338122, elev: 92.5, width: 8.0,
    note: 'Foot of the staircase. Iron handrail down the middle, lamp standards ' +
          'on the flanks.',
  },
  {
    id: 'escalier_top', src: 'derived',
    name: "Haut de l'escalier",
    lat: 48.888956, lon: 2.338067, elev: 99.0, width: 9.0,
    note: 'Six and a half metres of climb in one flight, which is why the grade ' +
          'here reads as 51% — it is a stair, not a street.',
  },
  {
    id: 'lamarck_girardon', src: 'derived',
    name: 'Bas de la rue Girardon',
    lat: 48.888848, lon: 2.338013, elev: 102.5, width: 10.0,
    note: 'Turn south, uphill. The gradient bites immediately.',
  },
  {
    id: 'brouillards', src: 'est',
    name: 'Allée des Brouillards',
    lat: 48.888696, lon: 2.337849, elev: 105.5, width: 6.0,
    note: 'A narrow PEDESTRIAN alley, not a street: the Château des Brouillards ' +
          'and its garden on one side, low pavilions and houses on the other. ' +
          'It arrives at Place Dalida from the north-west, and it must never be ' +
          'built with a six-storey street wall.',
  },
  {
    id: 'place_dalida', src: 'cited',
    name: 'Place Dalida — le buste',
    lat: 48.888570, lon: 2.338040, elev: 108.0, width: 15.0,
    note: 'THE landmark, and the origin of the local frame. Named by decree on ' +
          '5 December 1996 for the crossroads of the allée des Brouillards, the ' +
          'rue de l\'Abreuvoir and the rue Girardon — a three-way junction, not ' +
          'a four-way. Aslan\'s bronze bust went up on 24 April 1997, on five ' +
          'blocks of cut granite, with three trees around it. The chest is ' +
          'rubbed gold by thirty years of tourists. Stand behind it and rue de ' +
          'l\'Abreuvoir falls away east toward La Maison Rose, 133 m off — that ' +
          'sightline must be preserved exactly.',
  },
  {
    id: 'girardon_climb', src: 'derived',
    name: 'Rue Girardon, montée sud',
    lat: 48.888076, lon: 2.337658, elev: 116.0, width: 9.0,
    note: 'Climbing toward rue Lepic. Place Marcel-Aymé and its Passe-Muraille ' +
          'are on the right a little further up.',
  },
  {
    id: 'moulin_galette', src: 'derived',
    name: 'Rue Lepic × rue Girardon — les deux moulins',
    lat: 48.887528, lon: 2.337180, elev: 128.0, width: 11.0,
    note: 'The crest. The Radet stands ON TOP of the corner building at 83 rue ' +
          'Lepic / 1 rue Girardon, where it was re-erected in 1924; the Blute-fin ' +
          'is set back behind its wall at 75-77, 150 m from the bust. Most ' +
          'people photograph the Radet believing it is the Galette.',
  },
  {
    id: 'lepic_orchampt', src: 'derived',
    name: "Rue Lepic × rue d'Orchampt",
    lat: 48.887312, lon: 2.337248, elev: 127.0, width: 8.0,
    note: 'Turn off the tourist artery into the quiet lane. Sound drops away.',
  },
  {
    id: 'maison_dalida', src: 'cited',
    name: "11 bis rue d'Orchampt — la maison de Dalida",
    lat: 48.887025, lon: 2.337494, elev: 124.0, width: 6.0,
    note: 'She lived here from 1962 until 1987; Céline had the same address ' +
          'until the Liberation. A hôtel particulier set back behind a high wall ' +
          'and a dark green carriage gate, ivy over the coping. You never see the ' +
          'house properly from the street — only the roofline. The game respects ' +
          'that: the gate stays shut.',
  },
  {
    id: 'orchampt_ravignan', src: 'derived',
    name: "Rue d'Orchampt × rue Ravignan",
    lat: 48.886657, lon: 2.337740, elev: 119.0, width: 7.0,
    note: 'The lane narrows, curves, and spills downhill into rue Ravignan.',
  },
  {
    id: 'emile_goudeau', src: 'cited',
    name: 'Place Émile-Goudeau — le Bateau-Lavoir',
    lat: 48.886040, lon: 2.337850, elev: 112.0, width: 7.0,
    note: 'A sloping cobbled terrace 43 m long and SEVEN metres wide — it was ' +
          'modelled at eighteen, which turned the tightest space on the route ' +
          'into a plaza. Horse chestnuts, not planes. Green Wallace fountain, ' +
          'benches. The Bateau-Lavoir at 13 rue Ravignan shows only its upper ' +
          'floor to the square because the ground falls away behind it; Picasso ' +
          'painted the Demoiselles in there. Burnt out in 1970, rebuilt 1978.',
  },
  {
    id: 'ravignan_stairs', src: 'derived',
    name: 'Escalier de la rue Ravignan',
    lat: 48.885677, lon: 2.338122, elev: 106.0, width: 8.0,
    note: 'Steps down. Railing, lamps, a long straight descent — the sightline ' +
          'opens right up. Rooftops of the 9th beyond.',
  },
  {
    id: 'trois_freres', src: 'est',
    name: 'Rue des Trois Frères',
    lat: 48.885273, lon: 2.338381, elev: 102.0, width: 9.0,
    note: 'Shopfronts, awnings, the épicerie from Amélie. Level-ish at last.',
  },
  {
    id: 'place_abbesses', src: 'cited',
    name: "Place des Abbesses — l'édicule Guimard",
    lat: 48.884848, lon: 2.338687, elev: 100.0, width: 20.0,
    note: 'The finish. One of only two surviving Guimard édicules with the glass ' +
          'roof intact (the other is Porte Dauphine); it stood at the Hôtel de ' +
          'Ville until 1974. Green cast iron and amber glass over the deepest ' +
          'shaft in the network at 36 m. Saint-Jean-de-Montmartre in red brick — ' +
          'the first reinforced-concrete church, 1904 — the carousel, the Wallace ' +
          'fountain, and the Mur des Je t\'aime in square Jehan-Rictus behind.',
  },
];

/** Named landmarks that are NOT on the rail but must be visible from it. */
export const LANDMARKS = [
  { id: 'maison_rose', src: 'cited', name: 'La Maison Rose',
    lat: 48.887987, lon: 2.339667, elev: 105.0,
    note: '2 rue de l\'Abreuvoir, on the corner of rue des Saules — the far end ' +
          'of a 133 m street, framed from Place Dalida. Pink walls, green trim. ' +
          'Was modelled 58 m from the bust, less than half its real distance, ' +
          'which flattened the best sightline on the route into a courtyard.' },
  { id: 'sacre_coeur', src: 'cited', name: 'Basilique du Sacré-Cœur',
    lat: 48.886700, lon: 2.343100, elev: 130.0,
    note: 'White travertine on the skyline east, 370 m away. From inside these ' +
          'streets you never see the building, only the dome over a roofline.' },
  { id: 'moulin_blutefin', src: 'cited', name: 'Moulin de la Galette (Blute-fin)',
    lat: 48.887397, lon: 2.337044, elev: 128.0,
    note: '75-77 rue Lepic. Built 1622, the oldest of the two and the only mill ' +
          'in Paris still on its original site. Set back west of the corner in ' +
          'a private condominium, seen over its wall.' },
  { id: 'moulin_radet', src: 'derived', name: 'Moulin Radet',
    lat: 48.887564, lon: 2.337221, elev: 128.0,
    note: '83 rue Lepic / 1 rue Girardon. Built 1717, moved here in 1924 and ' +
          'mounted ON THE ROOF of the corner building, hollow — the mechanism ' +
          'was left behind. It is a restaurant. People mistake it for the Galette.' },
  { id: 'marcel_ayme', src: 'est', name: 'Place Marcel-Aymé — le Passe-Muraille',
    lat: 48.887869, lon: 2.337494, elev: 117.0,
    note: 'Off rue Girardon at rue Norvins, directly on the climb. Jean Marais ' +
          'made it in 1989: a bronze man caught mid-stride halfway out of a stone ' +
          'wall, one arm and one leg still inside it. A local walks past this ' +
          'every day and the level was missing it entirely.' },
  { id: 'st_jean', src: 'est', name: 'Saint-Jean-de-Montmartre',
    lat: 48.884752, lon: 2.338381, elev: 100.0,
    note: '19 rue des Abbesses. Anatole de Baudot, 1894-1904. Red brick over ' +
          'reinforced concrete, Art Nouveau — the first of its kind.' },
  { id: 'mur_des_je', src: 'est', name: "Le Mur des Je t'aime",
    lat: 48.884797, lon: 2.338887, elev: 100.0,
    note: 'Square Jehan-Rictus. Enamelled lava tiles, "I love you" in 311 ' +
          'languages, at the foot of which toddlers are always playing.' },
  { id: 'le_refuge', src: 'est', name: 'Café Le Refuge',
    lat: 48.889091, lon: 2.338231, elev: 93.0,
    note: 'Red awning at the top of the Lamarck stairs. First thing you see on ' +
          'surfacing.' },
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
