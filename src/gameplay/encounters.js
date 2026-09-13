/**
 * THE ENCOUNTER SCRIPT
 * ====================
 * Time Crisis is authored, not generated. Every wave in the original is placed
 * by hand to build a rhythm: a soft opening that teaches the beat, a middle
 * that adds a second threat axis, a spike, then a gating enemy that forces the
 * player to commit and come out of cover.
 *
 * Waves are declared against WAYPOINT IDs, never raw distances, so moving a
 * coordinate in the survey moves the fight with it.
 *
 * `anchorTypes` filters which pieces of real architecture an enemy may come
 * from. This is how "they emerge from real doorways, balconies, alleyways and
 * rooftops" is enforced rather than hoped for: the director can only pick from
 * anchors the world builder actually published, so an enemy can never appear
 * somewhere there is no door.
 *
 * PACING CONTRACT, per area:
 *   beat 1  one or two grunts, single axis, generous telegraph — sets the beat
 *   beat 2  add height (balcony/roof) or width (both sides) — one new idea
 *   beat 3  the spike — overlapping telegraphs, forces a duck
 *   beat 4  the gate — RED or HEAVY, must be killed, cannot be waited out
 */

export const ENCOUNTERS = [
  // =========================================================================
  {
    areaId: 'A1',
    name: 'La Sortie',
    waypoint: 'lamarck_station',
    /** Camera parks slightly off-centre, at the kerb, facing the métro mouth. */
    node: { lateral: -2.2, facingOffset: 0.15 },
    brief: 'You come up out of the métro and they are already waiting on the ' +
           'stairs. Teaches the beat with nothing but grunts at ground level.',
    waves: [
      { at: 0.0, spawns: [
        { type: 'GRUNT', anchorTypes: ['metro', 'door'], side: 0 },
      ]},
      { at: 2.6, spawns: [
        { type: 'GRUNT', anchorTypes: ['door', 'alley'], side: -1 },
        { type: 'GRUNT', anchorTypes: ['door', 'alley'], side: 1 },
      ]},
      { at: 7.0, spawns: [
        { type: 'SOLDIER', anchorTypes: ['alley', 'door'], side: -1 },
        { type: 'GRUNT', anchorTypes: ['balcony'], side: 1 },
      ]},
      { at: 12.5, gate: true, spawns: [
        { type: 'RED', anchorTypes: ['metro', 'door', 'alley'], side: 0 },
      ]},
    ],
  },

  // =========================================================================
  {
    areaId: 'A2',
    name: 'La Montée',
    waypoint: 'lamarck_girardon',
    node: { lateral: 1.8, facingOffset: -0.1 },
    brief: 'The climb up Girardon. Introduces height: the street narrows and ' +
           'the balconies start mattering more than the doorways.',
    waves: [
      { at: 0.0, spawns: [
        { type: 'GRUNT', anchorTypes: ['door'], side: 1 },
        { type: 'GRUNT', anchorTypes: ['balcony'], side: -1 },
      ]},
      { at: 3.4, spawns: [
        { type: 'SOLDIER', anchorTypes: ['alley'], side: -1 },
        { type: 'SOLDIER', anchorTypes: ['door'], side: 1 },
      ]},
      { at: 8.0, spawns: [
        { type: 'SNIPER', anchorTypes: ['roof', 'dormer'], side: -1 },
        { type: 'GRUNT', anchorTypes: ['door'], side: 1 },
      ]},
      { at: 14.0, gate: true, spawns: [
        { type: 'RED', anchorTypes: ['door', 'alley'], side: 1 },
        { type: 'GRUNT', anchorTypes: ['balcony'], side: -1 },
      ]},
    ],
  },

  // =========================================================================
  {
    areaId: 'A3',
    name: 'La Place',
    waypoint: 'place_dalida',
    node: { lateral: 0, facingOffset: 0.05 },
    brief: 'Place Dalida. The widest space on the route, so this is the ' +
           'area that teaches you to sweep. The bust is centre frame and must ' +
           'never be shot at — enemies are kept clear of its sightline.',
    waves: [
      { at: 0.0, spawns: [
        { type: 'GRUNT', anchorTypes: ['door', 'alley'], side: -1 },
        { type: 'GRUNT', anchorTypes: ['door', 'alley'], side: 1 },
      ]},
      { at: 3.0, spawns: [
        { type: 'SOLDIER', anchorTypes: ['balcony'], side: -1 },
        { type: 'SOLDIER', anchorTypes: ['balcony'], side: 1 },
      ]},
      { at: 7.5, spawns: [
        { type: 'BOMBER', anchorTypes: ['alley', 'door'], side: 1 },
        { type: 'GRUNT', anchorTypes: ['door'], side: -1 },
      ]},
      { at: 12.0, spawns: [
        { type: 'SNIPER', anchorTypes: ['roof'], side: 1 },
      ]},
      { at: 16.0, gate: true, spawns: [
        { type: 'HEAVY', anchorTypes: ['door', 'alley'], side: 0 },
        { type: 'GRUNT', anchorTypes: ['balcony'], side: -1 },
      ]},
    ],
  },

  // =========================================================================
  {
    areaId: 'A4',
    name: "L'Orchampt",
    waypoint: 'lepic_orchampt',
    node: { lateral: -1.4, facingOffset: 0.22 },
    brief: 'The quiet lane past Dalida\'s gate. Tight, walled, almost no ' +
           'sightline — this is the claustrophobic area. Close range, fast ' +
           'telegraphs, and the one place BOMBERs really hurt.',
    waves: [
      { at: 0.0, spawns: [
        { type: 'SOLDIER', anchorTypes: ['door', 'alley'], side: -1 },
      ]},
      { at: 2.4, spawns: [
        { type: 'BOMBER', anchorTypes: ['alley'], side: 1 },
        { type: 'GRUNT', anchorTypes: ['door'], side: -1 },
      ]},
      { at: 6.5, spawns: [
        { type: 'SOLDIER', anchorTypes: ['balcony', 'dormer'], side: 1 },
        { type: 'SOLDIER', anchorTypes: ['door'], side: -1 },
      ]},
      { at: 11.0, spawns: [
        { type: 'BOMBER', anchorTypes: ['alley', 'door'], side: -1 },
        { type: 'BOMBER', anchorTypes: ['alley', 'door'], side: 1 },
      ]},
      { at: 15.0, gate: true, spawns: [
        { type: 'RED', anchorTypes: ['door', 'alley'], side: -1 },
        { type: 'RED', anchorTypes: ['door', 'alley'], side: 1 },
      ]},
    ],
  },

  // =========================================================================
  {
    areaId: 'A5',
    name: 'La Descente',
    waypoint: 'emile_goudeau',
    node: { lateral: 0.8, facingOffset: -0.05 },
    brief: 'Place Émile-Goudeau and the drop down the Ravignan stairs. The ' +
           'sightline opens right up and the rooftops of the 9th appear ' +
           'behind. Long range, snipers, and the stage boss on the steps.',
    waves: [
      { at: 0.0, spawns: [
        { type: 'GRUNT', anchorTypes: ['door'], side: -1 },
        { type: 'GRUNT', anchorTypes: ['door'], side: 1 },
        { type: 'SOLDIER', anchorTypes: ['alley'], side: 0 },
      ]},
      { at: 4.0, spawns: [
        { type: 'SNIPER', anchorTypes: ['roof', 'dormer'], side: -1 },
        { type: 'SNIPER', anchorTypes: ['roof', 'dormer'], side: 1 },
      ]},
      { at: 9.0, spawns: [
        { type: 'SOLDIER', anchorTypes: ['balcony'], side: -1 },
        { type: 'SOLDIER', anchorTypes: ['balcony'], side: 1 },
        { type: 'BOMBER', anchorTypes: ['alley'], side: 0 },
      ]},
      { at: 14.0, gate: true, spawns: [
        { type: 'HEAVY', anchorTypes: ['door', 'alley'], side: 0 },
        { type: 'RED', anchorTypes: ['door', 'alley'], side: -1 },
        { type: 'RED', anchorTypes: ['balcony'], side: 1 },
      ]},
    ],
  },
];
