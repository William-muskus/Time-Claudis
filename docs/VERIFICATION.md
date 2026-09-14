# How this game is checked

Three harnesses, because three different questions need answering and no single
capture mode answers more than one of them.

Everything renders through **SwiftShader**, a pure-software rasteriser — this
container has no GPU at all. Measured on the real scene: **0.8 frames per
second at 1200×675**, and SwiftShader is fill-rate bound so 1600×900 is roughly
half that. Every design decision below follows from that number.

---

## `npm test` — does the simulation obey the contract?

114 tests, no browser, seconds. Three.js builds and updates a scene
perfectly well without WebGL; only *drawing* needs a GPU, so the entire
simulation is testable headlessly.

The tests that matter pin the **Time Crisis contract** rather than the
implementation:

- an enemy round in flight can be ducked under — the mechanic the whole game
  rests on
- never more than two enemies committed to a shot at once
- every enemy shot is telegraphed before it fires
- cover is absolute, and both transitions are vulnerable
- a shot fired from cover is swallowed, not counted as a miss
- ducking for less than the weapon's reload time leaves you still empty
- a continue keeps the score and restores lives

Plus the input stack driven by synthetic hands (one curl, one shot; no
auto-fire; mirrored aim), the route topology (which way you turn, whether you
are climbing), asset integrity, and the two render-pass invariants that made
the weapon invisible twice.

## `npm run bench` — does the weapon look right?

Loads the first-person weapon and **nothing else**. The full page takes fifteen
seconds to reach a first frame and then renders at 0.8 fps; iterating on where a
gun sits in the frame does not need Montmartre built first.

Reports the model's bounding box as a percentage of the frame, so pose changes
are judged numerically rather than by eye:

```
[bench] handgun_ready   centre 73.1% , 80.9%   size 13% x 37.6%
```

That readout is what caught the weapon sitting at 92% down the frame,
underneath the visor's own bottom gradient, where it was invisible even while
drawing correctly.

## `npm run tour` — does the world look right, and does the game read?

Parks the camera at surveyed waypoints, aims it at named landmarks, and — for
combat shots — **stages a fight on demand**.

Staging rather than waiting is the important part. Condition-based capture had
to replay the level to reach each readable moment, which at 0.8 fps meant
minutes per screenshot and usually a container restart first; across several
attempts it produced no combat frames at all. Staged frames arrive in seconds
and, more usefully, are **deterministic** — the same frame every time, which is
what makes a visual regression reviewable.

It is not a mock. The staging calls the director's real spawn path, so enemies
are placed by the real anchor-selection rules: out of a real doorway, at a real
engagement distance, on a real side of the street. A harness that placed
enemies by hand would be photographing something the game never does.

## `npm run palette <png...>` — is the colour contract actually being met?

`src/render/palette.js` promises one thing above all: everything is either
warm or cool, nothing in between, because flat-shaded geometry has no surface
detail and so the SHADING has to carry hue information rather than only
brightness.

That promise is easy to state and impossible to eyeball, especially at golden
hour where every honest frame is warm-dominated. So it gets measured. The tool
decodes a PNG, skips the HUD bands, and reports four numbers per frame:

```
file                                clip%  dark%  warm%  cool%   mid%
tune1/10_ravignan_drop.png           12.2      0   77.9   21.1      1   <-- clipping
tune1/05_dalida_bust.png              0.5      0   83.6   14.1    2.3   <-- no cool side
```

| Measure | Target | Why |
|---|---|---|
| `clip%` | under 4 | A blown highlight in a flat-shaded scene is worse than in a textured one, because there is no surface detail left to read once the value pins |
| `dark%` | under 3 | Shadows should be violet, not holes |
| `cool%` | over 16 | Below this there is no split, only a wash with some blue shutters in it |

This found what eyeballing had missed for hours: the tour was averaging **80%
warm against 11% cool**, which is not the amber/violet contract at all. Raising
the rim light and widening the grade's crossover took it to 21-40% cool. It
also caught rue Ravignan clipping across a tenth of the frame, and one shot
where half the picture measured as near-black.

The current tour: **27 frames, every one at 0.2% clipped and 0% crushed**, and
24 of 27 over the cool-side target.

The three that are not — `05_dalida_bust`, `05b_dalida_close`, `07b_moulin_close`
— sit between 13.6% and 15.7%, and they are all the same shot: a close-up of a
single warm object filling the frame against a sunset sky. There is almost no
shadow in them to be violet. **The target is scoped to frames that contain a
street**, and the honest reading of those three is that the measure does not
apply, not that the frames are wrong. They are left in the listing rather than
excluded, because a check you quietly narrow until it passes has stopped being
a check.

Two traps this metric set, both worth keeping:

- **`clip%` went UP when highlight desaturation was added** — 0.6% of a frame
  to 28%. Pulling the weak channels toward the strongest turns a neon yellow
  into a nicer colour that is exactly as blown out. The fix that worked brings
  peaks down through a shoulder; the number that proved it is the one that
  exposed the first attempt.
- **`dark%` is sensitive to the ORDER of the grade, not only its values.** The
  haze lift puts an unlit surface at about 22/255, safely above the floor —
  and then the vignette multiplied it to 17 in the corners, so one frame in a
  tour measured 46% crushed and looked like a bad material rather than an
  ordering mistake. The floor is re-applied after every multiplicative stage,
  which is what makes it a floor.

---

## Things learned the hard way

**One render at a time.** A software render outlives the shell that started it,
and several competing for four cores does not merely slow things down — every
run appears to hang, and the obvious diagnosis (the game is broken) is wrong.
`shoot.mjs` holds a lockfile.

**A fixed timestep, always.** The harness drives the game at exactly 1/60 s per
animation frame regardless of how long the frame actually took, so a 0.8 fps
software render produces precisely the frames a 60 fps hardware one would.
Without it the screenshots are unreproducible and the review chases noise.

**Reduce pixels, never quality.** Captures run at 1200×675 rather than 1600×900.
That is the same image with fewer pixels of it. Turning down shadows or geometry
to go faster would be misrepresenting the game to its own reviewer.

**A screenshot that cannot contain the bug will not find it.** Eighteen frames
were captured before anyone noticed not one of them contained an enemy. The
harness was shooting at timestamps, and an arcade fight's readable moments are
events.

**Reporting state is not reporting the picture.** After staging was added the
manifest happily recorded five enemies alive and telegraphing on a frame that
contained none of them. Listing enemy states proves the *simulation* ran and
says nothing about what was drawn. The tour now projects each enemy and tests
occlusion, and prints the answer as `TYPE:stage@x,y dist` with `BLOCKED` or
`OFFSCREEN` — because on-screen-behind-a-wall and off-screen-entirely look
identical in a screenshot and have completely different causes. It warns loudly
when a combat shot ends with nothing visible. That one line found the missing
line-of-sight check in the director, the Dalida bust standing on the rail, and
enemies spawning above the top of the frame.

**Occlusion needs more than one ray, in both directions.** A single ray at chest
height called a handrail a wall — and the Girardon climb has 376 pieces of
handrail. It also called an enemy hidden behind its own bullet, because a round
in flight sits exactly on the line of sight to the thing that fired it. Sample
three points up the body, take one clear ray as visible, and exclude transient
effects.

**The build can fail silently and the tour will not notice.** A single backtick
inside a GLSL comment closed the template literal and broke `vite build`. The
old bundle stayed on disk, three verification renders screenshotted it, and the
review was of code that no longer existed. `tests/modules.test.js` now imports
every source module and compares the newest source mtime against the newest
bundle.

**A flaky test is worse than no test**, because it trains you to re-run rather
than to look. The forward-arc test failed four times in ten on identical code.
The cause was `Math.random` scattering ivy, wall fragments and cover foliage —
so the world was not deterministic for a fixed seed, and every reproducibility
guarantee above rested on nothing.

**Some things are invisible to the test you would naturally write.** It took
three attempts to catch a four-metre statue standing on the rail. A fan at plus
and minus 20 degrees threaded past both sides of it; once the sampling was fine
enough to hit, the camera turned out to be *inside* the plinth, where
front-face raycasting reports nothing at all. An object big enough to fill the
frame is the object a visibility test is worst at seeing. Restated as clearance
— walk the rail, is the landmark in the way — it cannot be threaded.

**Measure the fix, not the intention.** Highlight desaturation was added to stop
sunlit limestone reading as neon yellow. It did, and clipping went from 0.6% of
a frame to 28%: pulling the weak channels up turns `(1.0, 1.0, 0.45)` into a
nicer colour that is exactly as blown out. Redistribution is not reduction. The
shoulder that actually fixed it brings peaks *down*, and the number that proved
it is the same one that exposed the first attempt.
