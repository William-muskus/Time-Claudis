# The Time Crisis Contract

This document is the arbiter. If code and this document disagree, one of them is
a bug. Every number here is chosen to reproduce the feel of Namco's *Time Crisis*
(1995) and *Time Crisis II* (1997) on original arcade hardware.

The single most important sentence in this file: **Time Crisis is not a shooting
game, it is a rhythm game about hiding.** The gun is a metronome. The pedal is
the beat. Everything below serves that.

---

## 1. The cover loop

Namco's cabinet has one pedal. Pressed, you are out of cover and can shoot and be
shot. Released, you are behind cover: safe, and reloading. The entire game is the
tension of choosing when to be out.

We map this onto the hand exactly:

| Hand state | Cabinet equivalent | Player state |
|---|---|---|
| Finger gun pointed at screen (POINT) | pedal held down | `EXPOSED` — can shoot, can be hit |
| Finger gun raised to vertical (RELOAD) | pedal released | `COVERED` — safe, reloading |

The transition is not instant and that is the whole game.

```
COVERED ──(gun comes down)──> EMERGING ──> EXPOSED
   ^                                          │
   └────── HIDING <──(gun goes up)────────────┘
```

| Transition | Duration | Vulnerable? |
|---|---|---|
| `COVERED` → `EMERGING` → `EXPOSED` | 260 ms | **yes, fully** |
| `EXPOSED` → `HIDING` → `COVERED` | 200 ms | **yes, fully** |

Hiding is faster than emerging. That asymmetry is deliberate and is in the
original: bailing out is meant to feel like a reprieve you can just barely make,
and popping out is meant to feel committed. A player who panics mid-transition
and reverses gets the worst of both — the transition restarts from where it is,
it does not snap.

**Reloading only happens in cover.** There is no reload button. This is the
defining constraint. An empty gun is not a problem to solve, it is a command to
hide, and the game's rhythm comes from being forced back into cover on the
magazine's schedule rather than your own.

## 2. Weapons

| Weapon | Mag | Reload (ms in cover) | Damage | RoF cap | Spread | Notes |
|---|---|---|---|---|---|---|
| `HANDGUN` | 6 | 700 | 1 | 6/s | 0.00° | Default. Infinite mags. Never taken away. |
| `MACHINE_GUN` | 30 | 1400 | 1 | 11/s | 1.6° | Timed pickup, 25 s. |
| `SHOTGUN` | 8 | 1100 | 1 ×7 pellets | 2.2/s | 5.5° | Timed pickup, 25 s. Drops grunts in one. |
| `GRENADE` | 4 | 1600 | radius 3.5 m | 1.4/s | — | Timed pickup, 20 s. Rare. |

The reload duration is the *minimum time in cover*. Duck for less than that and
you come out still empty — a mistake the game lets you make, and one that teaches
the cover rhythm faster than any tutorial.

## 3. Enemies

Colour is information. Never decorate an enemy in a class colour.

| Class | Colour | HP | Telegraph | Gates area? | Behaviour |
|---|---|---|---|---|---|
| `GRUNT` | ochre / mustard | 1 | 900 ms | no | Steps out, fires once, ducks back. Filler and rhythm. |
| `SOLDIER` | slate blue | 1 | 750 ms | no | Strafes between two cover points while firing. |
| `RED` | scarlet | 1 | 620 ms | **yes** | Must be killed to clear the area. Aggressive, flanks. |
| `HEAVY` | charcoal + ochre trim | 3 | 1100 ms | yes | Slow, absorbs, suppresses. Stagger on each hit. |
| `SNIPER` | dark green | 1 | 1500 ms | no | Rooftop/balcony. Long laser tell. Punishes standing still. |
| `BOMBER` | orange | 1 | — | no | Sprints at you, detonates. Kill before contact or duck. |

### The telegraph is sacred

Every enemy shot is preceded by a **visible, unmissable flash** on the enemy.
The player must always be able to answer "am I about to be shot?" from the screen
alone, with the sound off, at a glance, in peripheral vision.

The telegraph has three stages and all three are required:

1. **Wind-up** (first 55% of telegraph): enemy's emissive colour ramps up.
2. **Flash** (next 30%): hard white bloom pulse on the muzzle, 2 quick beats.
3. **Commit** (final 15%): the flash goes solid. The shot *will* fire. Ducking
   still saves you — the projectile is travel-time, not hitscan.

Enemy bullets travel at **34 m/s** and are drawn as a bright tracer. At typical
combat range (14–22 m) that is 400–650 ms of flight. Ducking during flight
saves you. This is why Time Crisis feels fair at speeds that should be unfair.

### Aggregate fire discipline

At most **2 enemies may be in the Commit stage simultaneously**. A third that
would commit is held back and re-rolls its telegraph. Without this rule the game
becomes a coin-flip; with it, every death is legible as the player's error.

## 4. Areas, the timer, and the gate

A stage is a sequence of **areas**. Each area is a fixed camera position with a
scripted enemy wave. The camera does not move during an area. It moves *between*
areas, on the rail, and the player cannot be hurt while it moves.

- Each area has a **par time** (see `AREAS` in `src/data/route.js`, 40–55 s).
- The area is cleared when **every gating enemy** (`RED`, `HEAVY`) is dead.
- On clear: `AREA CLEAR` banner, remaining enemies flee or are cleaned up, and
  the clock is **topped up to the next area's par**, not added to. Time Crisis
  refills rather than accumulates so a strong player cannot bank a trivial
  endgame.
- Timer reaching zero is a life lost and a restart of the current area.

## 5. Health, lives, continues

- 3 lives. One hit = one life. There is no partial health and no regeneration.
- A hit triggers 1200 ms of invulnerability, a red vignette, and a hard camera
  shake. The player is force-ducked to `COVERED` on hit — you are never killed
  twice by the same volley.
- 0 lives → `GAME OVER`, 10-second continue countdown, arcade style.

## 6. Score

| Event | Points |
|---|---|
| Grunt / Soldier | 300 |
| Red | 800 |
| Heavy | 1500 |
| Sniper | 1000 |
| Bomber killed before contact | 700 |
| Headshot bonus | ×2 |
| Area cleared | 1000 + 100 per second of clock remaining |
| No-hit area bonus | 5000 |

**Combo:** consecutive hits without a miss. Multiplier is `1 + floor(combo / 5)`,
capped at ×8. A miss resets to 0. Shots fired while `COVERED` are not counted as
misses — you physically cannot shoot from cover, the input is swallowed.

## 7. Feel: the things that are not numbers

These are what separate a rail shooter from *Time Crisis*, and they are the
things a critic sub-agent must judge. None are optional.

- **Hitstop.** On a confirmed hit, freeze simulation for 45 ms (80 ms on a
  headshot). The game must *bite*.
- **The crosshair is the gun, not a cursor.** It lags the hand by one frame of
  critically-damped spring, overshoots slightly on fast moves, and settles. A
  crosshair locked rigidly to the hand feels like a mouse and kills the illusion.
- **Cover changes the framing, not just a flag.** Ducking drops the camera 0.9 m,
  pitches it up 6°, pulls FOV in by 4°, and slides a foreground occluder up the
  frame. You must *see* that you are behind something.
- **Every shot ejects a shell** with physics. Time Crisis is generous with brass.
- **Announcer.** "ACTION!" on area start, "AREA CLEAR!", "RELOAD!" when dry,
  "CRISIS!" at 10 seconds. Loud, compressed, slightly clipped.
- **The camera is never still.** Even in a static area there is a slow 0.15°
  breathing sway. A locked camera reads as a screensaver.
- **Enemies react before they die.** 120 ms of stagger, then the death animation.
  An enemy that vanishes on hit feels like a target, not a person.

## 7b. The weapon you can see

The player holds a visible first-person weapon, drawn in its own scene through
a second render pass so it can never intersect Montmartre's narrow walls.

It is not decoration. Because the player is aiming with a bare hand through a
webcam, the hardest problem in the whole game is knowing what the machine
currently thinks your hand is doing. The weapon answers that continuously,
without any UI, and it is the fastest feedback channel available:

| What your hand does | What the gun does | Why it matters |
|---|---|---|
| Moves | Barrel swings toward the crosshair, lagging it | Your aim becomes a physical thing, not a dot |
| Middle finger curls | Hard recoil kick and a muzzle flash | Instant confirmation the trigger gesture registered |
| Raises to vertical | Gun rotates to vertical beside your head | The picture agrees with your hand, so cover explains itself |
| Stays down while covered | Gun drops out of frame | You can see you are behind something |
| Runs dry | Gun hangs slightly lower | A free second hint that you are empty |

The recoil is the important one. A gesture interface's worst failure mode is
ambiguity about whether an input landed, and a 45 ms kick answers it before the
player has finished the motion.

Silhouettes are deliberately distinct so the current weapon is readable in
peripheral vision: compact handgun, machine gun with a magazine hanging below,
shotgun with a tube and pump, grenade launcher with a drum.

The **visor** frames all of it. A rail shooter without one reads as a drone
gliding down a street; an aperture edge reads as a person crouched behind a
wall, which is precisely what the cover mechanic asks the player to imagine.
It also darkens the corners, where nothing important ever happens.

## 8. Inversions we deliberately did NOT make

Recorded so nobody "fixes" them later:

- Reload is not a separate action from cover. Merging them is the brief and it is
  also correct — it is what the pedal already did.
- The player has no movement input at all. None. The rail is absolute.
- There is no aim assist beyond a 1.4° forgiveness cone on the hit test. Time
  Crisis is a game about pointing, and magnetism ruins it.
