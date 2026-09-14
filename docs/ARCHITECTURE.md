# Architecture

Read `docs/GAMEPLAY.md` first. It is the spec; this is the wiring.

## Frame order

Nothing in this game is order-independent. The loop runs exactly this sequence
and changing it will break the cover contract:

```
1. input     MediaPipe → GestureRecognizer → {aim, fired, gunUp}
2. cover     CoverController.update(dt, !gunUp)   ← gun DOWN means "wants out"
3. director  area state machine, timer, spawn schedule
4. enemies   telegraph timers, AI, enemy fire
5. player    resolve `fired` → raycast → damage        (only if cover.canShoot())
6. bullets   integrate enemy projectiles → test against cover.isVulnerable()
7. camera    rail position + cover offset + shake + sway
8. render    scene, then post
9. hud       DOM overlay
```

Step 2 before step 5 and step 6 is the important part. The player's cover state
for this frame must be settled *before* anything asks whether they can shoot or
be shot, otherwise you get one-frame windows where a player who ducked still
takes the hit, which reads as the game cheating.

## Module ownership

| Path | Owns | Must not touch |
|---|---|---|
| `src/data/` | The survey. Coordinates, waypoints, landmarks, areas. | anything |
| `src/core/` | Rail spline, cover state machine, clock, RNG, event bus. | Three.js scene graph |
| `src/input/` | MediaPipe, fingerpose, gesture → intent. | game state |
| `src/world/` | Scene construction from survey data. Buildings, streets, props. | gameplay |
| `src/gameplay/` | Enemies, director, weapons, scoring, damage. | rendering, DOM |
| `src/render/` | Renderer, lighting, post-processing, quality scaling. | game state |
| `src/ui/` | HUD, menus, attract mode. DOM only. | the scene graph |
| `src/audio/` | Announcer, SFX, music. | everything else |

`src/core/cover.js` and `src/data/route.js` are **frozen contracts**. Other
modules import them; nothing edits them without updating the tests that pin
their behaviour.

## Coordinate frame

Right-handed, metres, origin at the Dalida bust.
**+X east, +Y up, +Z south.** North is −Z. See `src/data/route.js`.

A camera at zero yaw looks down −Z, i.e. north, i.e. back down the hill toward
the station. The walk is southbound, so the camera's default forward is the
direction of travel reversed — do not "fix" this, it is why the rail's tangent
is negated in the camera rig.

## The event bus

`src/core/events.js` is a tiny synchronous emitter. Gameplay publishes facts;
audio, UI and render subscribe. Gameplay must never call into audio or the HUD
directly — that coupling is what makes arcade games impossible to retune.

Canonical events:

```
shot.fired        {weapon, fromCover}
shot.hit          {enemyId, part:'head'|'body', damage, worldPos}
shot.miss         {worldPos}
enemy.spawned     {id, class, worldPos}
enemy.telegraph   {id, stage:'windup'|'flash'|'commit'}
enemy.fired       {id, worldPos, targetPos}
enemy.killed      {id, class, part, score}
player.hit        {byEnemyId}
player.died       {livesLeft}
cover.changed     {state, previous}
weapon.empty      {}
weapon.reloaded   {weapon}
area.started      {areaId, name, par, index}
area.cleared      {areaId, name, timeLeft, noHit, bonus, isLast}
area.timeout      {areaId}
area.retry        {areaId}
weapon.granted    {weapon}
weapon.expired    {}
weapon.pickup     {weapon, worldPos}
spawn.failed      {type, anchorTypes}
player.died       {livesLeft, areaId}
continue.tick     {secondsLeft}
continue.expired  {score}
game.continued    {continuesUsed}
game.over         {score, bestCombo, accuracy, rank, continueSeconds}
stage.complete    {}
```

`tests/wiring.test.js` keeps this list honest. The bus decouples gameplay from
audio and the HUD, which is what makes an arcade game retunable — but a
publisher with no subscriber fails silently, and so does a subscriber waiting
on an event nobody emits. Four synthesised announcer words sat fully
implemented and unreachable for exactly that reason.

## The render chain

```
RenderPass(world, mainCamera)      near 0.1,  far 900
ViewModelPass(weapon, vmCamera)    near 0.01, far 12     <- depth cleared here
UnrealBloomPass                                          <- muzzle flash blooms
ShaderPass(grade)                  haze lift, split tone, vignette, damage
ShaderPass(FXAA)
```

Two details in that chain cost real debugging time and are worth stating
plainly:

**The weapon needs its own depth clear, and three cannot do it.** The stock
`RenderPass` calls `clearDepth()` *before* `setRenderTarget()`, so it clears
whichever buffer happened to be bound previously. With two cameras whose near
planes differ by a factor of ten, their depth values are not comparable at all
— a weapon 44 cm from a 1 cm near plane sits at depth ~0.9998 while a building
twenty metres from a 10 cm near plane sits at ~0.995, so the gun loses the
depth test to a building it is nowhere near and vanishes with no error.
`ViewModelPass` in `src/render/viewmodel.js` binds first and clears second, and
also disables `autoClear` around the draw so the world underneath survives.

**Every metal needs an environment probe.** A PBR metal has no diffuse term, so
a high-metalness surface with nothing to reflect renders black regardless of
lighting. `buildSkyEnvironment()` bakes a PMREM from the game's own sky dome —
not an external HDRI — so metal reflects the same gold horizon and violet
zenith that lights everything else. It is assigned to both the world scene and
the viewmodel scene.

## Asset pipeline

Blender runs headless as the `bpy` Python module (Blender 5.0.1). Scripts in
`tools/blender/` build meshes from code and export GLB into
`public/assets/models/`. No hand-modelling step, no `.blend` files: the models
are reviewable in a diff and regenerable from scratch.

`src/world/assets.js` loads them at boot, before `buildWorld()` runs — the
world builder is synchronous by design, since it is a pure function of the
survey, so the assets have to be in hand first.

**Every lookup falls back.** If a GLB is missing or fails to parse, the caller
builds the procedural version instead and the failure is logged rather than
swallowed. A blocked network or a pipeline that was not re-run must degrade,
not punch a hole in Montmartre.

What is GLB: the Dalida bust, the Guimard édicule, the Moulin, the Wallace
fountains, the lamp standards, the Morris column, the enemy figure, and the
four weapons.

What is not, and why: the street surface has to follow the rail spline exactly,
and the façades are generated from the same survey the rail reads so that four
hundred metres of terrace does not have to be hand-placed.

Run with `npm run assets`.

## Verification

`tools/verify/` drives the built game in headless Chromium via Playwright,
feeding synthetic hands from `tests/synthhand.js` instead of a webcam, and
writes screenshots to `artifacts/shots/`. This is how the visual critic looks at
the game. A change that cannot be screenshotted cannot be reviewed.
