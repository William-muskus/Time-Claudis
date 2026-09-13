import * as THREE from 'three';

/**
 * The camera rig.
 *
 * Time Crisis's camera is doing three jobs at once and they must not fight:
 *   1. TRAVEL — sliding along the rail between combat nodes.
 *   2. COVER  — dropping and pitching up when the player ducks.
 *   3. LIFE   — a constant low-amplitude sway so the frame is never dead.
 *
 * They are composed in that order, each as an offset from the last, so that
 * ducking during a camera move does the right thing instead of snapping.
 *
 * On cover framing: the drop is the smallest part of it. What actually sells
 * being behind something is the PITCH UP and the FOV pull. Ducking behind a
 * wall means you can no longer see the street, only the wall and the sky above
 * it, and the narrower FOV makes the world press in. A rig that only translates
 * down reads as a lift, not as cover.
 */

export const RIG = {
  /** Eye height standing, metres above the street surface. */
  eyeHeight: 1.66,
  /** How far the eye drops when fully behind cover. */
  coverDrop: 0.92,
  /** Degrees of upward pitch when fully covered. */
  coverPitchDeg: 6.2,
  /** FOV narrows by this much when covered. */
  fovBase: 58,
  fovCoverDelta: -4.2,
  /** How far ahead along the rail the camera looks. */
  lookAhead: 14,
  /** Breathing sway. Small enough to be subliminal, big enough to be alive. */
  swayAmpDeg: 0.16,
  swaySpeed: 0.42,
  /** Travel easing between combat nodes. */
  travelSpeed: 7.5,
};

export class RailCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../core/spline.js').Rail} rail
   */
  constructor(camera, rail) {
    this.camera = camera;
    this.rail = rail;

    /** Current distance along the rail, metres. */
    this.distance = 0;
    /** Where we are heading. Equal to `distance` when parked at a node. */
    this.targetDistance = 0;

    /** Lateral offset from the rail centreline — combat nodes sit at the kerb. */
    this.lateral = 0;
    this.targetLateral = 0;

    /** Yaw offset in radians, so a node can face across the street. */
    this.facingOffset = 0;
    this.targetFacingOffset = 0;

    this.shake = 0;
    this.shakeDecay = 3.4;
    this.time = 0;

    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  /** Send the camera to a combat node. Returns the travel distance in metres. */
  travelTo(distance, { lateral = 0, facingOffset = 0 } = {}) {
    this.targetDistance = THREE.MathUtils.clamp(distance, 0, this.rail.length);
    this.targetLateral = lateral;
    this.targetFacingOffset = facingOffset;
    return Math.abs(this.targetDistance - this.distance);
  }

  /** Jump instantly, for scene setup and for the attract-mode cuts. */
  snapTo(distance, opts = {}) {
    this.travelTo(distance, opts);
    this.distance = this.targetDistance;
    this.lateral = this.targetLateral;
    this.facingOffset = this.targetFacingOffset;
  }

  get isTravelling() {
    return Math.abs(this.targetDistance - this.distance) > 0.05;
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * @param {number} dt seconds
   * @param {number} exposure 0 = fully covered, 1 = fully exposed
   */
  update(dt, exposure) {
    this.time += dt;

    // --- 1. TRAVEL --------------------------------------------------------
    // Smoothstep-ish approach rather than a linear crawl: the camera leaves a
    // node briskly and arrives gently, which is what makes an arcade transition
    // feel authored instead of mechanical.
    const gap = this.targetDistance - this.distance;
    if (Math.abs(gap) > 0.001) {
      const step = Math.sign(gap) * Math.min(Math.abs(gap), RIG.travelSpeed * dt * (0.35 + 0.65 * Math.min(1, Math.abs(gap) / 12)));
      this.distance += step;
    }
    this.lateral += (this.targetLateral - this.lateral) * Math.min(1, dt * 3.2);
    this.facingOffset += (this.targetFacingOffset - this.facingOffset) * Math.min(1, dt * 3.2);

    const d = this.distance;
    const base = this.rail.positionAt(d, this._pos);
    const tan = this.rail.tangentAt(d, this._tmp).clone();
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();

    // --- 2. COVER ---------------------------------------------------------
    const cover = 1 - exposure;                     // 1 = fully hidden
    const eyeY = base.y + RIG.eyeHeight - RIG.coverDrop * cover;

    this.camera.position.set(
      base.x + right.x * this.lateral,
      eyeY,
      base.z + right.z * this.lateral,
    );

    // Look point: ahead along the rail, rotated by the node's facing offset.
    const aheadD = Math.min(this.rail.length, d + RIG.lookAhead);
    const ahead = this.rail.positionAt(aheadD, this._look).clone();
    ahead.y = base.y + RIG.eyeHeight;               // level the gaze

    const toAhead = ahead.sub(this.camera.position);
    if (this.facingOffset !== 0) {
      toAhead.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.facingOffset);
    }

    // Pitch up as we duck: raise the look target.
    toAhead.y += Math.tan(THREE.MathUtils.degToRad(RIG.coverPitchDeg * cover)) * toAhead.length();

    // --- 3. LIFE ----------------------------------------------------------
    const swayA = THREE.MathUtils.degToRad(RIG.swayAmpDeg);
    const sYaw = Math.sin(this.time * RIG.swaySpeed) * swayA;
    const sPitch = Math.sin(this.time * RIG.swaySpeed * 0.73 + 1.1) * swayA * 0.7;
    toAhead.applyAxisAngle(new THREE.Vector3(0, 1, 0), sYaw);
    toAhead.y += Math.tan(sPitch) * toAhead.length();

    // --- shake ------------------------------------------------------------
    if (this.shake > 0.0001) {
      const s = this.shake;
      const t = this.time * 46;
      // Two incommensurate frequencies so it does not read as a sine wave.
      const ox = (Math.sin(t) * 0.6 + Math.sin(t * 1.7 + 2.3) * 0.4) * s * 0.36;
      const oy = (Math.sin(t * 1.3 + 0.7) * 0.6 + Math.sin(t * 2.1) * 0.4) * s * 0.30;
      this.camera.position.x += right.x * ox;
      this.camera.position.z += right.z * ox;
      this.camera.position.y += oy;
      this.shake = Math.max(0, this.shake - this.shakeDecay * dt * (0.5 + this.shake));
    }

    this.camera.lookAt(this.camera.position.clone().add(toAhead));

    // --- FOV --------------------------------------------------------------
    const targetFov = RIG.fovBase + RIG.fovCoverDelta * cover;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 9);
      this.camera.updateProjectionMatrix();
    }
  }

  /** World-space forward, for spawning muzzle effects and aiming rays. */
  forward(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }
}
