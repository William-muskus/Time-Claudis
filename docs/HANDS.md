# The hand is the lightgun

Three gestures, one webcam, no peripheral. This document explains how it works
and — more usefully — why several of the obvious approaches do not.

## The three gestures

| | Pose | Meaning |
|---|---|---|
| **POINT** | Index finger extended at the screen, ring and pinky folded into the palm | The index finger is the barrel. Hand position drives the crosshair. |
| **SHOOT** | Middle finger held perpendicular to the index — a reversed L, a finger on a *gâchette* — then curled into the palm | One curl, one shot. |
| **RELOAD** | The whole finger gun raised to vertical, perpendicular to the sky, and held | Duck behind cover and reload. Lower it to pop out. |

There is no fourth gesture and adding one would be a bug. The brief allows
three, and more importantly a player under arcade pressure can hold three
gestures in their hands and not four.

## Why fingerpose is not enough on its own

[fingerpose](https://github.com/andypotato/fingerpose) classifies a hand *pose*
from MediaPipe landmarks, and it is good at that. It answers "is this hand
shaped like a finger gun?" with a confidence score we can gate on. We use it for
exactly that, and the three `GestureDescription`s live in `src/input/gestures.js`.

But it cannot do two things this game needs, and both are load-bearing:

**1. It cannot give you a trigger edge.** fingerpose is a per-frame classifier
with no memory. A naive "is the middle finger curled this frame?" test either
machine-guns at thirty shots a second while the finger stays down, or — if you
add a cooldown — silently eats fast double-taps. What a trigger actually needs
is an *edge*: the instant the pull crosses a threshold, once per pull.

**2. It cannot give you a stable aim signal.** fingerpose reports discrete
buckets, not continuous position, and the obvious continuous signal — the index
fingertip — has a fatal flaw described below.

So fingerpose **gates** and an analogue layer over the raw landmarks
(`src/input/handmath.js`) **actuates**. Neither alone is sufficient.

## The aim point is not the fingertip

This is the single highest-impact decision in the input stack.

The obvious thing is to aim from landmark 8, the index fingertip. Do that and
every shot drags your aim, because **the fingertip moves when the trigger finger
curls.** The hand is one connected structure; flexing the middle finger rotates
the whole palm slightly and shifts the index tip by a few pixels. In normalised
image space that is a fraction of a percent, which sounds negligible and is not:
projected across a 1600-pixel screen it is enough that every shot lands low and
left of where you were pointing, and the player has no idea why.

Instead we aim from a point projected forward along the barrel from the index
**knuckle** (landmark 5):

```js
const mcp = lm[LM.INDEX_MCP];
const b = barrelVector(lm);
const reach = handSpan(lm) * 1.35;
return { x: mcp.x + b.x * reach, y: mcp.y + b.y * reach };
```

The knuckle is stable under trigger actuation. The barrel direction is taken
from knuckle to tip, so the aim follows where you point without inheriting the
tip's trigger-coupled jitter. Scaling the reach by hand span makes the whole
thing distance-invariant: lean toward the camera and your aim does not change.

## The trigger is a Schmitt trigger, and it has a precondition

```
     curl
      1.0 ┤                    ╭──────╮
          │      FIRE ────────→│      │
     0.62 ┼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤ ─ ─ ─│─ ─ ─   pull threshold
          │                    │      │
     0.38 ┼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ┤─ ─ ─   re-arm threshold
          │ ───────────────────╯      ╰──────
      0.0 ┴─────────────────────────────────→ time
```

Two thresholds with a gap between them. Crossing 0.62 upward while armed fires
and disarms; falling below 0.38 re-arms. The gap is what stops a finger sitting
near a single threshold from chattering out a dozen shots.

The part that encodes the brief's actual gesture is the **re-arm condition**:

```js
} else if (!this.triggerReady && curl <= this.t.triggerResetCurl && triggerArmed) {
  this.triggerReady = true;
}
```

`triggerArmed` means the reversed L is formed — the middle finger is back out at
roughly 90° to the index. So you must genuinely *set* the trigger before you can
break it again, which is what makes this a finger-gun gesture rather than a
detector for a waggling finger.

Note what this implies: **we cannot test for the reversed L at the moment of
firing.** By then the finger is curled and the angle has necessarily collapsed
to around 40°. The pose is a precondition for the shot, not a state coincident
with it. Getting this backwards produces a trigger that never fires and looks
like a tracking bug.

## RELOAD uses geometry, not a classifier bucket

fingerpose has a `VerticalUp` direction bucket, but its boundary sits at 45°,
which is far too loose — a gun held at a lazy 50° would count as raised, and
ducking must feel deliberate. So the gun-up test is a real angle:

```js
const gunUp = elevation >= 62 || (pose === 'reload' && elevation >= 45);
```

Two independent signals, deliberately. Raw elevation gets noisy when the hand is
edge-on to the camera and MediaPipe's depth estimate degrades; the classifier
alone is too coarse. Either one firing with conviction is enough, which makes
the gesture robust without making it twitchy.

Raising the gun also re-arms the trigger unconditionally, so the first shot
after coming out of cover always lands. A player who ducked mid-pull should not
be punished with a dead trigger when they pop back out.

## The crosshair lags, on purpose

```js
accel = (target - current) * stiffness - velocity * damping
```

with `damping = 2 * sqrt(stiffness) * 0.86` — slightly *under*-damped, so the
crosshair overshoots a little on a fast move and settles.

A crosshair locked rigidly to the hand feels like a mouse cursor and destroys
the illusion that you are holding something. The spring gives it mass. The
deliberate under-damping is what makes it feel like a gun barrel swinging rather
than a UI element snapping.

Hand dropouts are handled by coasting the spring rather than recentring: lose
tracking for a few frames and the crosshair drifts to a stop where it was. The
alternative — snapping to centre — throws your aim across the screen every time
MediaPipe blinks, which it does.

## Mirroring

The webcam is a mirror, so raw image X is backwards. `1 - x` fixes it. This is
trivial and it is also the bug most likely to be reintroduced by someone
"simplifying" the aim path, so `tests/gestures.test.js` pins it:

> `test('aim is mirrored so moving right moves the crosshair right')`

## Testing all of this without a webcam

`tests/synthhand.js` generates anatomically plausible 21-point hands from a
small parameter set — barrel elevation, per-finger curl, position, scale — by
building finger chains and rotating each joint. The canonical poses are
`point`, `squeezing`, `fired`, `reload`, `raising` and `openPalm`.

Those synthetic hands drive the **real** `GestureRecognizer` in eleven tests
covering one-curl-one-shot, no auto-fire on a held trigger, no firing while the
gun is up, mirroring, crosshair lag and dropout tolerance.

The same generator backs `src/input/demopilot.js`, the attract-mode pilot. The
pilot does not shortcut to intent — it produces hand poses and feeds them
through the same recogniser a real player uses. That means the attract loop is a
continuous integration test of the entire input stack, and every screenshot the
visual critic reviews is of the game as actually driven by gestures.

The pilot is deliberately a B-grade player: it reacts on a ~260 ms delay, does
not always duck in time, and wastes rounds. A perfect pilot would produce
screenshots in which the cover mechanic never visibly does anything.
