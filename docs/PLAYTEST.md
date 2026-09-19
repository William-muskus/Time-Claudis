# Playtest

**Nobody has ever played this game.** Every verification in this repository is a
machine looking at it: 136 unit tests, a software rasteriser taking screenshots
at 0.8 frames a second, a stub WebAudio graph measuring a mix nobody has heard,
an oracle player that ducks on frame-perfect telegraph timing and never misses.

None of that can tell you whether it is any good, or whether the hand tracking
works for a hand that is not being simulated. This document is for the first
person to find out. It assumes one session of your attention and asks for the
things only a human can answer.

---

## Running it

```
npm install
npm run build          # ~3 s
npm run preview        # then open the printed URL
```

Use **Chrome or Edge**. Safari's `getUserMedia` behaviour around user gestures
differs and has not been tested; Firefox works but its WASM SIMD path for
MediaPipe is slower.

You need a webcam, daylight or a lamp in front of you (not behind), and about
a metre of space to hold your hand up. Headphones or speakers on — a third of
what the game tells you is audio, and until very recently none of it could be
heard at all.

First run downloads an 8 MB hand-tracking model from Google's CDN. Everything
else — the MediaPipe WASM runtime, the fonts, the models — is served from the
game's own origin, and `npm run degrade` asserts that the attract mode loads
without touching another host at all.

**`?demo` runs the attract mode**, which plays itself with a synthetic hand and
needs no camera. Watch it once before you play. It is driven through the same
gesture recogniser as a real hand, so it is a fair preview of the pacing.

---

## The controls, in one paragraph

Point your index finger at the screen to aim. Curl your middle finger to fire.
**Raise the gun to the sky to duck into cover and reload.** That last one is the
whole game: there is no reload button, you reload by being in cover long enough,
and cover is the only place that is ever safe. It is Time Crisis's foot pedal
mapped onto a gesture. Hold the pose — a flick will not do it.

---

## What to try, in this order

Do these in order. The first two are the ones that decide whether any of the
rest matters.

### 1. Can you duck? (five minutes)

Go into the first area and do nothing but duck and come back up, twenty times.

- Does the game respond when you think it should? Cover moves at 200 ms down
  and 260 ms up, which is a deliberate, felt delay — but the tracker's own lag
  sits on top of that and nobody has measured the total on a real hand.
- **You should hear it.** Four distinct sounds: a scuff as you start down, a
  soft thud as you arrive, a lighter rise as you come up, a dry tick the moment
  the weapon goes live. If a duck makes no sound, the tracker dropped you and
  the game does not know you tried. Tell us which of the four you could
  actually distinguish.
- Move your hand out of frame for two seconds. A red **HAND LOST** banner should
  appear and the game should hold you in cover. Does it come back cleanly?

### 2. Does the shooting feel like Time Crisis? (fifteen minutes)

Play the first three areas properly.

- When an enemy telegraphs, are you told early enough to react? The sequence is
  windup, two hard flash beats, then commit; enemy rounds travel at 34 m/s
  specifically so you can duck *under a bullet already in the air*. Did you ever
  manage that, and did it feel like a save or like a coin flip?
- Did you ever die and not know why? Write down what was on screen. This is the
  single most useful thing you can report.
- Is aiming precise enough to take a headshot on purpose, or are you spraying?

### 3. Everything else (as long as you have)

Play to the end. It is about five minutes if you are good, longer if not; you
have unlimited continues.

Then go back and look at the place. The route is real — Lamarck–Caulaincourt up
through rue Girardon, place Dalida, the Moulin de la Galette, 11 bis rue
d'Orchampt, down the Ravignan steps to Abbesses. If you know Montmartre, tell us
what is wrong. If you do not, tell us whether it feels like a real street.

---

## What to write down

Five things, in order of how much they are worth to us:

1. **Every death you did not understand.** What was on screen, what you tried.
2. **Every gesture that did not register**, and what you were doing with your
   hand. "It stopped seeing my hand when I leaned back" is worth more than "the
   tracking is bad".
3. **The frame rate**, honestly. Open the browser's FPS counter if you can.
   Include your machine and GPU. See "What we could not measure" below — this
   is a real hole.
4. **Anything you heard that was too loud or too quiet**, especially the little
   double-tick that warns you a shot is committed.
5. **Anything that looked wrong.** Not "low-poly" — that is the style. Things
   standing in the road, walls with nothing behind them, a frame that reads as
   one flat colour.

---

## What we already know is wrong

Told up front so you do not spend your session finding them again.

- **The crowded lane (area 4) can stage enemies you cannot shoot.** In the
  captured frame, one of four was behind geometry and one was off the top of
  the screen. The occlusion model is deliberately permissive — it knows about
  buildings and not about trees, kiosks or planters — and this is where that
  costs the most.
- **The director drops spawns it cannot place**, between none and six out of
  about forty-four depending on the random seed. The area still clears, because
  the gate counts live enemies, but a wave written as five can arrive as four.
- **Two tour frames are badly composed** — the camera at place Émile-Goudeau
  stands against a wall with the Wallace fountain filling the middle, and the
  Lamarck stairs shot is nose-down into the treads. Those are screenshot
  framings, not places the player stands, but if the game looks like that in
  motion, say so.
- **Two frames' shadows are not violet**: the Lamarck stairs and the Dalida bust
  read as darker salmon rather than as the amber/violet split the rest of the
  game holds to.
- **Le Mur des Je t'aime is placed by estimate.** Three published sources put it
  in three places 25 m apart; the rest of the route's landmarks are either
  cited or derived from cited anchors.

---

## What we could not measure at all

Be suspicious of anything in this repository that sounds like a performance
claim. Two halves of the budget are measured and one is not.

Measured (`npm run perf`):

```
draw calls            66      from 23,378 authored meshes
triangles            320,510
world build         1,873 ms
game.update() p95     0.046 ms   — 0.3% of a 60 fps budget
```

So the simulation is free and submission is not a problem on anything made this
decade. **Fill rate, shader cost, the bloom and FXAA passes, and MediaPipe's
share of the frame are entirely unknown**, because the only renderer available
here is a software rasteriser running at 0.8 frames a second. The resolution
scaler that is supposed to protect a slow machine has never once run against a
real GPU. Your frame rate number is the most valuable thing you can give us.

Also unverified by anyone: **the audio, as sound.** Its levels were set with a
meter — every cue's amplitude integrated through a stub WebAudio graph — which
catches a cue that is 12 dB wrong and cannot hear whether the game is pleasant
to listen to for five minutes.

---

## If it does not start

The game says what went wrong rather than failing silently, and the four cases
have four different answers. If you get something not in this list, that is a
bug worth reporting on its own.

| What you see | What it means |
|---|---|
| Camera permission denied | Allow the camera for the page — the icon at the right of the address bar — and press Try again. |
| No camera found | No webcam was offered by the device. The attract mode needs none. |
| Camera is busy | A video call or another tab has it. Close that. |
| Hand tracking could not start | The 8 MB model did not download. Check the connection. |
| 3D not available | No WebGL2 — usually hardware acceleration turned off, or a remote session without a GPU. |

Seven failure modes are exercised automatically by `npm run degrade`, including
the real hand tracker against a camera with no hand in it. If one of them
behaves differently on your machine, that is worth knowing.

---

## The other tools, if you want to look deeper

| Command | What it does |
|---|---|
| `npm test` | 136 unit tests, ~13 s. Includes a full simulated playthrough. |
| `npm run tour` | 27 screenshots of the route and the fights. Slow: SwiftShader. |
| `npm run palette artifacts/tour` | Measures the amber/violet split per frame. |
| `npm run mix` | Every sound's peak level, ranked. |
| `npm run perf` | Draw calls, triangles, simulation cost. |
| `npm run degrade` | The failure paths, in a real browser. |
