# The walk: Lamarck–Caulaincourt to Abbesses

> The geography is 1:1. The geometry is not.

This is the survey the whole game is built on. `src/data/route.js` is the
machine-readable version; this is the reasoning behind it.

Read `docs/CONSTRAINTS.md` §2 first for how accurate these coordinates actually
are and why. Short version: the topology is reliable, the absolute positions
carry about ±15 m, and `tests/route.test.js` pins the former so a future
correction to the latter cannot silently reverse a turn.

## Why this route

The brief names four places: the two métro stations at either end, the Dalida
bust on Place Dalida, and the house at 11 bis rue d'Orchampt. There is exactly
one sensible walk that takes in all four, and it happens to be a very good
level:

- It **climbs, crests and descends** — 89 m at the station, 128 m at the Moulin
  de la Galette, 101 m at Abbesses. That is a three-act structure handed to you
  by the terrain, and the game's five areas sit on it without forcing anything.
- It **changes character four times**: a busy station approach, a steep
  residential climb, the open square, a narrow walled lane, then a long
  descent with the city opening up beyond. A rail shooter needs exactly that
  kind of variety to avoid feeling like one corridor.
- Every one of the turns is a **real turn a person makes**, so the camera
  never moves in a way a local would find strange.

## The waypoints

Distances are cumulative along the rail. Elevations are metres above sea level.

| # | Place | Elev | What you see |
|---|---|---|---|
| 1 | **Lamarck–Caulaincourt, sortie métro** | 89 | Line 12. The entrance sits in a dip with twin staircases climbing on either side — the most photographed métro mouth in the 18th. Café Le Refuge with its red awning at the top of the steps. |
| 2 | Pied de l'escalier Lamarck | 89.5 | Foot of the north flight. Iron handrail down the middle, lamp standards on the flanks. |
| 3 | Haut de l'escalier | 98 | You surface onto rue Lamarck, nine metres up. The Butte proper starts here. |
| 4 | Rue Lamarck × rue Girardon | 104 | Turn south, uphill. The gradient bites immediately. |
| 5 | Allée des Brouillards | 114 | The white 18th-century folly behind its trees, and the gated allée. Deep green shade right, sun left. |
| 6 | **Place Dalida** | 120 | Aslan's bronze bust, 1997, chest rubbed gold by thirty years of tourists. Stand behind it and rue de l'Abreuvoir falls away east toward La Maison Rose. |
| 7 | Rue Girardon, montée sud | 125 | Still climbing. Shutters, narrow sky. |
| 8 | **Moulin de la Galette** | 128 | The surviving Blute-fin windmill on its mound. Highest point of the walk and the crest of the level. |
| 9 | Rue Lepic × rue d'Orchampt | 127 | Turn off the tourist artery into the quiet lane. The sound drops away. |
| 10 | **11 bis rue d'Orchampt** | 124 | Dalida's house, 1962–1987. A high wall, ivy over the coping, a dark green carriage gate. You never see the house. |
| 11 | Rue d'Orchampt × rue Ravignan | 118 | The lane curves and spills downhill. |
| 12 | **Place Émile-Goudeau** | 112 | The Bateau-Lavoir. Sloping cobbles, plane trees, a Wallace fountain. Picasso painted the Demoiselles behind that glass. |
| 13 | Escalier de la rue Ravignan | 105 | Steps down. The sightline opens right up over the rooftops of the 9th. |
| 14 | Rue des Trois Frères | 102 | Shopfronts, awnings. Level at last. |
| 15 | **Place des Abbesses** | 101 | Guimard's glass-roofed édicule, one of only two left. Saint-Jean-de-Montmartre in red brick, the carousel, the Mur des Je t'aime. |

Total: 15 waypoints, roughly 665 m of rail, 39 m of climb and 27 m of descent.

## The things that must be right

These are the details a resident would catch, in rough order of how loudly they
would complain.

**The Dalida bust faces east.** Not south, not at the camera. She looks down
rue de l'Abreuvoir toward La Maison Rose, and that sightline is the single most
photographed view on the Butte. `tests/route.test.js` asserts the Maison Rose
sits east of the bust for exactly this reason.

**The chest of the bust is polished gold and the rest is dull bronze.** Thirty
years of tourists. A uniformly bronze bust is wrong.

**You cannot see Dalida's house.** 11 bis is behind a high wall and a shut gate.
Only the roofline shows. Building a visible house there would be the most
obvious lie in the level, so the gate stays closed.

**The roofline is ragged.** Montmartre was a village annexed in 1860 and built
up piecemeal. Neighbouring buildings disagree about height, cornice level and
roof pitch. A level cornice reads as Boulevard Haussmann and stops being
Montmartre instantly.

**There are two windmills and people confuse them.** The Blute-fin (Moulin de
la Galette proper) sits on its mound; the Radet sits on the rue Lepic corner on
top of the restaurant that borrowed the name. Both are modelled.

**The stairs are stepped, not ramped.** The camera climbs them and the tread
rhythm is visible in the parallax. Montmartre is a staircase with a village on
top; faking it with a slope would be felt even if not consciously noticed.

**Sacré-Cœur is a silhouette, not a building.** It is 450 m east and 130 m up.
From the rail you read three domes and a campanile and nothing else, so that is
all that is modelled.

## The coordinate frame

Right-handed, metres, origin at the Dalida bust.

```
+X = east     +Y = up     +Z = south
```

North is −Z. A camera at zero yaw looks down −Z, which is north, which is back
down the hill toward the station. The walk is southbound, so the camera's
default forward is the reverse of the direction of travel. This is not a bug and
the camera rig negates the rail tangent deliberately — see `src/rail/camera.js`.

`geoToLocal()` and `localToGeo()` convert, using 111,320 m per degree of
latitude and 73,224 m per degree of longitude (the cosine of 48.888° N).

## How the level sits on the route

| Area | Name | Anchored at | Par | The idea |
|---|---|---|---|---|
| A1 | La Sortie | Lamarck station | 40 s | Teaches the beat. Grunts at ground level, single axis. |
| A2 | La Montée | Lamarck × Girardon | 45 s | Introduces height. The street narrows and balconies start to matter. |
| A3 | La Place | Place Dalida | 50 s | The widest space, so this is where you learn to sweep. Enemies stay clear of the bust's sightline. |
| A4 | L'Orchampt | Lepic × Orchampt | 50 s | Claustrophobic. Close range, fast telegraphs, bombers hurt. |
| A5 | La Descente | Émile-Goudeau | 55 s | Long sightlines, snipers, and the boss on the steps. |

Encounters are declared against waypoint **ids**, never raw distances, so
correcting a coordinate moves the fight with it.
