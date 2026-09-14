# TIME CLAUDIS

**A Time Crisis-style arcade rail shooter set in Montmartre, played with your bare hands through a webcam.**

You come up out of the Lamarck–Caulaincourt métro at golden hour and walk the
real route to Abbesses — up rue Girardon, across Place Dalida, past the shut
green gate of 11 bis rue d'Orchampt where Dalida lived, down through the
Bateau-Lavoir and out onto Place des Abbesses under Guimard's amber glass.

People are shooting at you the whole way.

---

## The controls are your hand

There is no mouse, no gun peripheral and no pedal. There are three gestures and
nothing else.

| Gesture | What it does |
|---|---|
| **POINT** — index finger extended at the screen | The index finger is the barrel. Your hand drives the crosshair. |
| **SHOOT** — middle finger held perpendicular to the index, then curled into the palm | One curl, one shot. The reversed L is a finger on a *gâchette*. |
| **RELOAD** — the whole finger gun raised vertical, perpendicular to the sky | Duck behind cover and reload. Bring it back down to pop out and shoot. |

That third one is the entire game. Time Crisis cabinets have one pedal: pressed,
you are out of cover and can shoot and be shot; released, you are safe and
reloading. This maps that pedal onto your hand. **Gun up means hide. Gun down
means fight.** There is no separate reload button — you reload by hiding, which
means the magazine decides when you have to duck, and that rhythm is the game.

You are vulnerable during both transitions. Coming out takes 260 ms and going
down takes 200 ms, and that asymmetry is deliberate.

## Running it

```bash
npm install
npm run assets     # build the GLB models in Blender (headless, no install needed)
npm run dev        # then open the URL it prints, and allow camera access
```

No webcam? Add `?demo=1` to the URL. The attract-mode pilot plays the game by
generating synthetic hand poses and feeding them through the *real* gesture
recogniser, so it exercises the whole input stack rather than bypassing it.

```bash
npm test           # the logic suite — cover timing, gestures, route topology
npm run verify     # drive the built game in headless Chromium and screenshot it
```

## What's in here

```
src/data/route.js      the survey — 15 real waypoints, WGS84, frozen contract
src/core/cover.js      the pedal, as one continuous exposure scalar — frozen
src/input/             MediaPipe Hands -> fingerpose -> game intent
src/world/             Montmartre, generated from the survey
src/gameplay/          enemies, the director, weapons, scoring
src/render/            golden-hour lighting, post chain, adaptive resolution
src/ui/  src/audio/    the arcade shell. All audio is synthesised; no files.
tools/blender/         asset pipeline — Blender as a Python module, GLB out
tools/verify/          headless screenshot harness
```

**Documentation worth reading before changing anything:**

- [`docs/GAMEPLAY.md`](docs/GAMEPLAY.md) — the Time Crisis contract. Every timing
  number and why. This is the arbiter: if the code and that document disagree,
  one of them is a bug.
- [`docs/ROUTE.md`](docs/ROUTE.md) — the walk, and the details a resident of the
  18th would actually catch.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module ownership and the frame
  order, which is load-bearing.
- [`docs/CONSTRAINTS.md`](docs/CONSTRAINTS.md) — **the three things in the brief
  that could not be built, why, and what shipped instead.** Read this one.

## Two claims this project makes, and how honest they are

**"The geography is 1:1."** The topology is: which street meets which, which way
you turn, which side each landmark sits on, and whether you are climbing. Those
are pinned by tests. The absolute coordinates carry roughly ±15 m, because the
build environment could reach neither Street View nor the OpenStreetMap Overpass
API and the survey is therefore hand-authored. `docs/CONSTRAINTS.md` §2 has the
full accounting and the exact steps to replace it with real OSM data.

**"Blender-exported GLTF."** The hero assets — the Dalida bust, the Guimard
édicule, the Moulin, the Wallace fountains, the lamp standards, the enemy figure
— are authored in Blender (running as a Python module, so there is no install
and no `.blend` files) and exported to GLB. The street surface itself stays
procedural, because it has to follow the rail spline exactly and a static mesh
cannot.

The brief also asked for the MW3 *Resistance* map as a layout reference and for
NVIDIA DLSS 5. Neither shipped. `docs/CONSTRAINTS.md` says exactly why, including
the part where using a competitive multiplayer map as geographic ground truth
would have made the geography *less* accurate, not more.
