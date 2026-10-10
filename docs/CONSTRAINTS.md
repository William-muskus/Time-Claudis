# What could not be done, and what shipped instead

Three things in the brief could not be delivered as written. This document says
exactly why, what was built in their place, and what someone with the right
machine would have to do to finish them. Nothing here is a soft "maybe later" —
each section ends with the concrete next step.

---

## 1. The MW3 "Resistance" map extraction

**Asked for:** extract the Modern Warfare 3 multiplayer map *Resistance* with
C2M v3, or take a pre-extracted copy from the Asset Central Discord, and use it
as a layout and proportion reference.

**Not done, for three separate reasons, any one of which is sufficient:**

1. **No game files.** C2M v3 is an extractor, not a download. It reads the
   `.ff`/`.xpak` fast-files from an installed copy of MW3 on the local disk.
   This container has no copy of the game and no way to obtain one.
2. **No network route.** The environment's egress policy denies the GitHub API
   (403 on CONNECT) and Discord entirely. Neither the tool nor a pre-extracted
   archive is reachable from here.
3. **Redistribution.** Extracted commercial game geometry cannot ship in this
   repository regardless of how it was obtained. As *reference* it would have
   been fine, since reference material does not get committed — but points 1
   and 2 settle it before this one matters.

**A correction worth recording.** Even with the map in hand, it should not have
been treated as ground truth for geography. *Resistance* is a 2011 six-versus-six
arena, and like every competitive map it was laid out for sightlines and spawn
flow rather than for survey accuracy: streets are foreshortened, a square is
whatever size the three-lane structure needs it to be, and buildings exist to
block a lane. The brief asks for geometry that is simplified but geography that
is 1:1 and recognisable to a resident. Those two requirements conflict wherever
the map and the city disagree, and where they conflict the city has to win.

**What shipped instead.** The layout comes from the real coordinates: fifteen
surveyed waypoints in `src/data/route.js`, projected into a local metre frame
whose origin is the Dalida bust, with the street widths, the gradient and the
turn topology all carried explicitly. See §2 for how those coordinates were
obtained and how good they are.

**To finish it properly:** on a machine with MW3 installed and normal network
access, run C2M v3 against the game, import the resulting map into Blender, and
use it *only* to sanity-check building massing and storey heights around Place
Dalida against `docs/ROUTE.md`. Treat any disagreement about distance, street
width or orientation as the map being wrong.

---

## 2. Map data, Street View, and the geometry of the route

**Asked for:** an exact replica of Montmartre, geometry-wise — cross-referenced
against Street View, Google Earth and photographs.

**Not possible from this container, and re-verified.** The egress policy is an
allowlist, not a filter, and everything that carries map geometry is outside
it. Probed directly, each answering `403` at `CONNECT` or being refused by
`WebFetch`:

| Host | What it would have given |
|---|---|
| `overpass-api.de`, `overpass.kumi.systems` | OSM ways: street centrelines and building footprints |
| `nominatim.openstreetmap.org`, `tile.openstreetmap.org` | geocoding, raster tiles |
| `data.geopf.fr`, `wxs.ign.fr` | IGN BD TOPO — the authoritative French building footprints |
| `opendata.paris.fr`, `data.gouv.fr`, `api-adresse.data.gouv.fr` | the City of Paris's own building and street datasets |
| `fr.wikipedia.org` and every mirror tried, `wikidata.org`, `dbpedia.org` | the street nomenclature infoboxes |
| `api.maptiler.com`, `basemaps.cartocdn.com`, `demo.f4map.com` | tiles, 3-D building views |

What IS reachable: the package registries, `raw.githubusercontent.com` (any
public repo, by exact path), a repo-scoped `api.github.com`, and **web search**.
A search of GitHub for mirrored Paris building data found only administrative
boundary outlines — arrondissement polygons, nothing at building level.

So there is no vector source to import and no importer to write. The absence of
a `.geojson` in this repo is a blocked feature, not a missing one.

**What shipped instead: a cited traverse.** Search returns figures *from* those
blocked sources as text, and five coordinates were recoverable that way. They
now anchor the survey; everything between them is interpolated along the real
street. `src/data/route.js` tags every entry `cited` / `derived` / `est`, and
`docs/ROUTE.md` records what stated each cited figure.

This replaced a survey that was hand-placed throughout and claimed ±15 m.
Measured against the anchors it was out by 20–75 m, and two of those errors
changed what the place is: La Maison Rose sat 58 m from the bust when rue de
l'Abreuvoir is 133 m long, and Place Émile-Goudeau was 18 m wide when it is 7.

| Property | Confidence now | Why |
|---|---|---|
| Street topology, turn directions, which side a landmark is on | **High** | Memorable, cross-checked, and pinned in `tests/route.test.js` |
| The five cited anchors | **A few metres** | Published coordinates, quoted to 6 dp |
| Waypoints between anchors | **±10–15 m** | Interpolated along the real street, closing on cited street lengths |
| Street widths | **Cited where a figure exists**, else ±2 m | l'Abreuvoir and Émile-Goudeau are cited |
| Elevations | **Weakest in the file** | No elevation source was reachable at all; the profile is scaled so grades between cited horizontals are ones a street or stair achieves, and capped at the Butte's 130 m summit |
| Building footprints | **Characterised, not surveyed** | Generated per district character; the distinctive stretches (allée des Brouillards, rue de l'Abreuvoir) are authored by hand |

Two checks close on the result, neither used to place the other: Place Dalida
to La Maison Rose measures 136 m against a street cited at 133 m along its
curve, and station to station measures 479 m against 479 m cited.

**To finish it properly:** with egress to Overpass, one query for
`way[highway]` and `way[building]` in the route's bounding box replaces the
interpolated waypoints and the procedural street wall with real geometry.
`geoToLocal()` already takes WGS84 and the world builder already accepts an
arbitrary polyline (`buildAbreuvoirSpur` is the pattern), so it is a data
change, not a rewrite. Until then the honest claim is **the topology is exact,
the anchors are cited, and the fabric between them is characterised** — not
that the map is a replica.

---

## 3. NVIDIA DLSS 5

**Asked for:** support DLSS 5 via the Streamline SDK and RTX 50-series neural
rendering, going native rather than browser-only if that is what it takes.

**Not done. This one is not an environment limitation — it is a platform
impossibility for a web build, and the native path is a different project.**

Taking the pieces in order:

**"DLSS 5" does not appear to exist.** NVIDIA's current generation is DLSS 4,
introduced with the RTX 50-series in early 2025, which added multi-frame
generation and moved super-resolution to a transformer model. There is no public
DLSS 5 to integrate. Everything below therefore applies to DLSS 4, which is what
the brief most likely means.

**The browser cannot reach DLSS, and this is structural.** Streamline is a
plugin layer that inserts itself between an application and a native graphics
API — it hooks DirectX 12 or Vulkan at the swapchain and needs the engine's
depth buffer, motion vectors and jitter state at native resolution. A web page
has none of that. WebGL2 and WebGPU deliberately do not expose vendor
extensions, native swapchain handles, or the driver-level entry points
Streamline requires; that isolation is the point of the web sandbox, not an
oversight. No amount of work on this codebase reaches DLSS from a browser tab.

**Wrapping it in Electron does not help.** An Electron build still renders
through Chromium's compositor, and the page's frames are composited by the
browser before they ever reach a swapchain an external library could hook.
Shipping the same WebGL renderer inside a desktop shell changes the packaging
and nothing about the pipeline.

**The real native path, stated precisely** — this is what "pursue it" actually
costs:

1. Port the renderer to Vulkan or DX12. The game logic in `src/core/`,
   `src/gameplay/` and `src/input/` is deliberately free of Three.js and would
   survive; `src/render/` and `src/world/` would be rewritten against the new
   API. The GLB assets carry over unchanged.
2. Render at a reduced internal resolution and produce, every frame, the inputs
   DLSS requires: a linear depth buffer, screen-space motion vectors, the
   sub-pixel jitter offset actually used, and an exposure value.
3. Integrate Streamline, register the DLSS feature, and feed it those buffers.
4. Test on RTX 50-series hardware.

Step 4 is also blocked here in its own right: this container has no GPU at all.
The verification harness renders through SwiftShader, a pure-software
rasteriser. Even a completed native port could not be validated in this
environment.

**What shipped instead.** The performance budget is met with techniques that
work on every machine the game can actually run on:

| Technique | Where | What it does |
|---|---|---|
| Adaptive resolution scaling | `src/render/adaptive.js` | Measures a rolling frame time and scales the render target between 55% and 100% to hold 60 fps, with hysteresis so it does not oscillate |
| FXAA | post chain | Edge antialiasing at a fraction of MSAA's cost, which matters because the bloom pass wants a non-multisampled target anyway |
| Geometry instancing and merging | `src/world/` | Collapses the repeated façade elements into few draw calls |
| Restrained post chain | `src/render/renderer.js` | Three lights, one bloom, one grade, one FXAA. A flat-shaded low-poly scene does not need more, and every extra pass is resolution the adaptive scaler has to give back |

Adaptive resolution is the honest analogue of what DLSS is for: both trade
internal resolution for frame rate. DLSS does it far better, by reconstructing
detail with a trained model instead of merely blurring. Ours is the version that
runs in a browser on any GPU, and for a flat-shaded low-poly scene with no
high-frequency texture detail, the gap is narrower than it would be for a
photorealistic renderer — there is much less fine detail for the neural
upscaler to recover.
