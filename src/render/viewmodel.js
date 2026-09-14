import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { PALETTE, flat } from './palette.js';

/**
 * A render pass that draws the weapon over the world with a cleared depth
 * buffer.
 *
 * WHY THIS EXISTS INSTEAD OF `RenderPass` WITH `clearDepth = true`.
 * three's RenderPass does this, in this order:
 *
 *     if (this.clearDepth) renderer.clearDepth();
 *     renderer.setRenderTarget(renderToScreen ? null : readBuffer);
 *
 * The clear happens BEFORE the target is bound, so it clears whatever was
 * bound previously and not the buffer about to be drawn into. The world's
 * depth therefore survives into the weapon's draw.
 *
 * That is not a harmless inefficiency. The two cameras have very different
 * near planes — 0.1 for the world, 0.01 for the viewmodel — so their depth
 * values are not comparable at all. A weapon 44 cm from a 1 cm near plane
 * lands at a depth of roughly 0.9998, while a building twenty metres from a
 * 10 cm near plane lands around 0.995. The gun loses the depth test to a
 * building it is nowhere near, and vanishes completely with no error.
 *
 * Binding first and clearing second is the entire fix.
 */
export class ViewModelPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    // Draws into readBuffer in place, like RenderPass; must not swap.
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    // renderer.render() clears colour, depth and stencil when autoClear is on,
    // which would wipe the world we are compositing onto. RenderPass disables
    // it around its own draw for exactly this reason; leaving it on here
    // produced a frame containing the weapon and nothing else.
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    const target = this.renderToScreen ? null : readBuffer;
    // Bind first, THEN clear depth. This ordering is the whole reason this
    // class exists — see the comment above.
    renderer.setRenderTarget(target);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);

    renderer.autoClear = oldAutoClear;
  }
}

/**
 * The first-person weapon.
 *
 * WHY IT LIVES IN ITS OWN SCENE. A viewmodel sits about 40 cm from the eye. In
 * the world scene that means it intersects any wall the camera passes within
 * half a metre of, and on a rail that hugs Montmartre's narrow lanes that is
 * constant. So the gun gets its own scene and its own camera, drawn by a
 * second RenderPass with `clear = false` and `clearDepth = true`: the world's
 * colour is kept, the world's depth is discarded, and the weapon composites
 * cleanly on top. It sits before the bloom pass so the muzzle flash still
 * blooms, which is most of what makes a shot feel like it went off.
 *
 * WHAT THE GUN IS FOR, BEYOND LOOKING RIGHT. The player is aiming with their
 * bare hand through a webcam, and the hardest thing about that is knowing what
 * the game currently thinks your hand is doing. The weapon answers it
 * continuously and without any UI:
 *
 *   - it points where the crosshair points, so you can see your aim as a
 *     physical thing rather than a dot;
 *   - it KICKS when a shot registers, which is the fastest possible
 *     confirmation that the trigger gesture was read;
 *   - it drops out of frame when you duck;
 *   - and when you raise your hand to reload, the gun on screen raises with
 *     it, to vertical, mirroring your actual hand. That last one is the whole
 *     point: the gesture and the picture agree, so the control scheme explains
 *     itself without a tutorial.
 */

/**
 * Resting pose, in the viewmodel camera's space. Lower-right, angled in.
 *
 * ROTATION SIGNS, because they are easy to get backwards and the result looks
 * merely "a bit off" rather than obviously broken. The barrel is model -Z.
 * Rotating -Z about +Y by theta sends it to (-sin theta, 0, -cos theta), so a
 * POSITIVE yaw swings the muzzle LEFT — toward the middle of the screen, which
 * is where a gun held in the right hand should converge. The first version of
 * this was negative and the weapon pointed off the right edge of the frame.
 *
 * Likewise, rotating -Z about +X sends it to (0, sin theta, -cos theta), so a
 * positive pitch raises the muzzle.
 */
const REST = {
  // Raised from -0.17: projecting the model's bounding box put its centre at
  // 92% down the frame, underneath the visor's own bottom gradient, where it
  // was invisible even when it was drawing correctly.
  position: new THREE.Vector3(0.215, -0.098, -0.44),
  rotation: new THREE.Euler(0.035, 0.185, 0.055),
};

/** Where the gun goes when the player is fully behind cover. */
const COVER_OFFSET = new THREE.Vector3(0.03, -0.34, 0.06);
const COVER_ROTATION = new THREE.Euler(-0.62, 0.16, 0.30);

/**
 * Where the gun goes when the player raises their hand to reload.
 * Barrel vertical, held up beside the head — the same shape the player's own
 * hand is making.
 */
const RELOAD_OFFSET = new THREE.Vector3(-0.055, 0.175, 0.085);
const RELOAD_ROTATION = new THREE.Euler(1.24, 0.10, -0.16);

/**
 * Global size of every weapon on screen.
 *
 * Measured with tools/verify/bench.mjs, which reports the model's bounding box
 * as a percentage of the frame. At 1.0 the handgun filled 68% of the screen
 * height and the shotgun 152% — enormous, and covering exactly the middle
 * third where the enemies are. A viewmodel wants roughly a third of the frame
 * height: present enough to feel held, small enough to shoot past.
 */
const VIEWMODEL_SCALE = 0.55;

/** Per-weapon scale and muzzle position, in model space (barrel along -Z). */
const WEAPON_RIG = {
  HANDGUN:     { file: 'weapon_handgun.glb',     scale: 1.00, muzzle: new THREE.Vector3(0, 0.012, -0.40), kick: 1.00 },
  MACHINE_GUN: { file: 'weapon_machine_gun.glb', scale: 0.92, muzzle: new THREE.Vector3(0, 0.012, -0.78), kick: 0.55 },
  SHOTGUN:     { file: 'weapon_shotgun.glb',     scale: 0.94, muzzle: new THREE.Vector3(0, 0.020, -0.86), kick: 1.85 },
  GRENADE:     { file: 'weapon_grenade.glb',     scale: 0.96, muzzle: new THREE.Vector3(0, 0.020, -0.64), kick: 1.55 },
};

export class ViewModel {
  constructor(assetBase = 'assets/models/') {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 12);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    /** @type {Map<string, THREE.Object3D>} */
    this.models = new Map();
    this.current = null;
    this.currentKey = null;

    // --- lighting -------------------------------------------------------
    // The viewmodel scene needs its own rig. Matching the world's amber key
    // and violet fill keeps the gun in the same light as the street; without
    // that it reads as a sticker rather than as an object you are holding.
    // Deliberately brighter than the world rig, and deliberately not physical.
    //
    // A viewmodel is lit for READABILITY, not accuracy — it is the one object
    // the player must be able to parse at every moment, and it spends most of
    // its life in the shadow side of a narrow street where a physically honest
    // exposure would leave it a black silhouette. Every shooter lights the
    // weapon separately for this reason, which is exactly what a second scene
    // makes cheap.
    const key = new THREE.DirectionalLight(PALETTE.sunColor, 5.2);
    key.position.set(-0.6, 0.8, 0.4);
    this.scene.add(key);
    const fill = new THREE.HemisphereLight(PALETTE.skyZenith, PALETTE.skyGround, 4.2);
    this.scene.add(fill);
    // The rim is doing separation work, not mood work. The gun is frequently
    // held against a bright sky or a sunlit facade — 07b puts it directly over
    // the sun — and a cool edge along its top and back is the only thing that
    // keeps the outline from dissolving into whatever is behind it.
    const rim = new THREE.DirectionalLight(PALETTE.skyZenith, 3.6);
    rim.position.set(0.9, 0.35, -0.7);
    this.scene.add(rim);
    // A dim warm bounce from below, so the underside of the slide is not a
    // void. Cheap, and it is what stops the gun reading as a cut-out.
    const bounce = new THREE.DirectionalLight(PALETTE.skyGround, 1.3);
    bounce.position.set(0.1, -1, 0.3);
    this.scene.add(bounce);

    // --- muzzle flash ---------------------------------------------------
    this.flash = new THREE.Group();
    this.flash.visible = false;
    // A star and a cone. The cone gives it depth down the barrel; the crossed
    // quads give it the ragged spiky read a real flash has. Both unlit and
    // untonemapped so they punch straight through the bloom threshold.
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff0c0, toneMapped: false, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    // The flash is sized against VIEWMODEL_SCALE too. It is a child of the
    // root but the root is not scaled, so without this the flash stayed at its
    // original size while the weapons shrank and it swamped the whole frame.
    const F = VIEWMODEL_SCALE;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.055 * F, 0.22 * F, 6), flashMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.10 * F;
    this.flash.add(cone);
    for (let i = 0; i < 3; i++) {
      const star = new THREE.Mesh(new THREE.PlaneGeometry(0.26 * F, 0.055 * F), flashMat);
      star.rotation.z = (i / 3) * Math.PI;
      star.position.z = -0.06 * F;
      this.flash.add(star);
    }
    this.flashLight = new THREE.PointLight(0xffe9b0, 0, 2.2 * F, 2);
    this.flash.add(this.flashLight);
    this.root.add(this.flash);

    // --- animation state -------------------------------------------------
    this.recoil = 0;          // 0..1, decays
    this.recoilYaw = 0;
    this.flashTtl = 0;
    this.time = 0;
    this.aim = { x: 0.5, y: 0.5 };
    this.smoothAim = { x: 0.5, y: 0.5 };
    this.exposure = 0;
    this.gunUp = 0;           // smoothed 0..1
    this.bob = 0;

    this.loader = new GLTFLoader();
    this.assetBase = assetBase;
    this.ready = false;
  }

  /**
   * Load every weapon up front.
   *
   * Loading on pickup would stall the frame at the exact moment the player is
   * being rewarded, which is the worst possible time to drop frames. Four
   * models totalling ~60 KB is nothing; load them all at boot.
   */
  async load() {
    const entries = Object.entries(WEAPON_RIG);
    await Promise.all(entries.map(async ([name, rig]) => {
      try {
        const gltf = await this.loader.loadAsync(this.assetBase + rig.file);
        const model = gltf.scene;
        model.scale.setScalar(rig.scale * VIEWMODEL_SCALE);
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          o.receiveShadow = false;
          // Blender exports smooth-shaded by default for joined meshes; force
          // the faceting back on so the guns match the rest of the game.
          if (o.material) o.material.flatShading = true;
          o.material.needsUpdate = true;
        });
        model.visible = false;
        this.root.add(model);
        this.models.set(name, model);
      } catch (e) {
        console.warn(`[viewmodel] could not load ${rig.file}`, e);
        // A blocked or missing GLB must not leave the player holding nothing.
        const stand = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.09, 0.42), flat(0x3A3D4A, { metalness: 0.7, roughness: 0.4 }));
        stand.visible = false;
        this.root.add(stand);
        this.models.set(name, stand);
      }
    }));
    this.ready = true;
    this.setWeapon('HANDGUN');
  }

  setWeapon(key) {
    if (key === this.currentKey) return;
    const model = this.models.get(key);
    if (!model) return;
    if (this.current) this.current.visible = false;
    this.current = model;
    this.currentKey = key;
    model.visible = true;
    const rig = WEAPON_RIG[key];
    this.flash.position.copy(rig.muzzle).multiplyScalar(rig.scale * VIEWMODEL_SCALE);
    // A weapon swap gets a small kick of its own, so a pickup is felt.
    this.recoil = Math.min(1, this.recoil + 0.45);
  }

  /** Called when a shot actually breaks. */
  fire(weaponKey) {
    const rig = WEAPON_RIG[weaponKey] ?? WEAPON_RIG.HANDGUN;
    this.recoil = Math.min(1.6, this.recoil + 0.72 * rig.kick);
    // Alternate the yaw kick so sustained fire wanders instead of pumping
    // straight up and down like a piston.
    this.recoilYaw = (Math.random() - 0.5) * 0.9 * rig.kick;
    this.flashTtl = 0.055;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.85 + Math.random() * 0.5;
    this.flash.scale.setScalar(s * (0.8 + rig.kick * 0.35));
    this.flashLight.intensity = 7 * rig.kick;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {number} dt
   * @param {object} s game snapshot
   * @param {{x:number,y:number}} aim normalised crosshair
   * @param {boolean} travelling camera is moving between areas
   */
  update(dt, s, aim, travelling) {
    if (!this.ready || !this.current) return;
    this.time += dt;

    if (s?.weapon) {
      const key = s.weapon.replace(/\s+/g, '_').toUpperCase();
      if (WEAPON_RIG[key]) this.setWeapon(key);
    }

    // Smooth the aim separately from the crosshair's own spring. The gun is
    // heavier than the reticle and must lag it, or the two move as one object
    // and the weapon stops reading as something with mass.
    for (const k of ['x', 'y']) {
      this.smoothAim[k] += ((aim?.[k] ?? 0.5) - this.smoothAim[k]) * Math.min(1, dt * 7.5);
    }

    const targetGunUp = s?.coverState === 'COVERED' || s?.coverState === 'HIDING' ? 1 : 0;
    this.gunUp += (targetGunUp - this.gunUp) * Math.min(1, dt * 9);
    const cover = 1 - (s?.exposure ?? 1);

    // --- base pose --------------------------------------------------------
    const pos = REST.position.clone();
    const rot = new THREE.Euler().copy(REST.rotation);

    // Aim offset: the muzzle swings toward the crosshair. Small numbers — the
    // gun indicates, it does not chase.
    const ax = (this.smoothAim.x - 0.5);
    const ay = (this.smoothAim.y - 0.5);
    // Screen y grows DOWNWARD, so a crosshair below centre is ay > 0 and the
    // muzzle must pitch DOWN, which is a negative rot.x. Adding here instead
    // of subtracting made the gun point away from the crosshair vertically —
    // subtly wrong in a way that reads as the aim being broken.
    pos.x += ax * 0.16;
    pos.y -= ay * 0.10;
    rot.y += -ax * 0.34;
    rot.x -= ay * 0.28;

    // Idle sway. Two incommensurate frequencies so it never reads as a loop.
    const sway = 1 - cover * 0.7;
    pos.x += Math.sin(this.time * 0.9) * 0.006 * sway;
    pos.y += Math.sin(this.time * 1.37 + 1.1) * 0.005 * sway;
    rot.z += Math.sin(this.time * 0.71) * 0.010 * sway;

    // Walk bob while the camera travels between areas.
    this.bob += dt * (travelling ? 7.5 : 0);
    if (travelling) {
      pos.y += Math.abs(Math.sin(this.bob)) * 0.022 - 0.011;
      pos.x += Math.sin(this.bob * 0.5) * 0.014;
      rot.z += Math.sin(this.bob * 0.5) * 0.024;
    }

    // --- cover and reload -------------------------------------------------
    // Ducking pulls the gun down out of frame. Raising the hand to reload
    // rotates it to vertical. Both are blended rather than switched, so the
    // weapon travels through the same transition the player's hand does.
    // These two poses are mutually exclusive, and getting that wrong was a
    // real bug: in this game raising the gun IS how you take cover, so both
    // were being applied at once. The cover pose drops the weapon 34 cm and
    // the reload pose lifts it 6 cm, so the sum put the gun 140% of the way
    // down the frame — completely off the bottom of the screen at exactly the
    // moment it is supposed to be held up beside your head.
    //
    // So the reload pose takes precedence and the tuck-down only applies to
    // whatever cover is NOT accounted for by a raised gun. That residue is
    // real: being knocked into cover by a hit ducks you without your hand
    // going up.
    const tuck = cover * (1 - this.gunUp);
    pos.addScaledVector(COVER_OFFSET, tuck);
    rot.x += COVER_ROTATION.x * tuck;
    rot.y += COVER_ROTATION.y * tuck;
    rot.z += COVER_ROTATION.z * tuck;

    pos.addScaledVector(RELOAD_OFFSET, this.gunUp);
    rot.x += RELOAD_ROTATION.x * this.gunUp;
    rot.y += RELOAD_ROTATION.y * this.gunUp;
    rot.z += RELOAD_ROTATION.z * this.gunUp;

    // --- recoil -----------------------------------------------------------
    // Back along the barrel and up at the muzzle, decaying fast. The rise is
    // bigger than the translation because that is what the eye reads as kick.
    if (this.recoil > 0.0001) {
      pos.z += this.recoil * 0.055;
      pos.y += this.recoil * 0.012;
      // Positive pitch raises the muzzle (see the note on REST). Recoil kicks
      // UP; subtracting here drove the muzzle into the floor, which read as
      // the gun being yanked downward every time it fired.
      rot.x += this.recoil * 0.30;
      rot.y += this.recoilYaw * this.recoil * 0.10;
      rot.z += this.recoilYaw * this.recoil * 0.16;
      // Critically damped-ish decay: fast off the peak, then settles.
      this.recoil -= this.recoil * Math.min(1, dt * 13) + dt * 0.55;
      if (this.recoil < 0) this.recoil = 0;
    }

    // An empty gun hangs slightly, which is a free extra hint that you are dry.
    if (s?.rounds === 0) {
      pos.y -= 0.018;
      rot.x -= 0.05;
    }

    this.root.position.copy(pos);
    this.root.rotation.copy(rot);

    // --- muzzle flash decay ------------------------------------------------
    if (this.flashTtl > 0) {
      this.flashTtl -= dt;
      this.flashLight.intensity *= 0.62;
      if (this.flashTtl <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    // Hide the weapon entirely on the results screens.
    this.root.visible = !(s?.gameOver);
  }
}
