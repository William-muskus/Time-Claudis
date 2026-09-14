# How this game is checked

Three harnesses, because three different questions need answering and no single
capture mode answers more than one of them.

Everything renders through **SwiftShader**, a pure-software rasteriser — this
container has no GPU at all. Measured on the real scene: **0.8 frames per
second at 1200×675**, and SwiftShader is fill-rate bound so 1600×900 is roughly
half that. Every design decision below follows from that number.

---

## `npm test` — does the simulation obey the contract?

88 tests, no browser, milliseconds. Three.js builds and updates a scene
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
