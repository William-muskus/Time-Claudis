import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { PALETTE, sunDirection } from './palette.js';
import { AdaptiveResolution } from './adaptive.js';

/**
 * Renderer, lighting rig and post chain.
 *
 * LIGHTING PHILOSOPHY
 * Three lights and no more. Low-poly flat shading falls apart under a complex
 * rig because every extra light adds a tonal step across a face that is meant
 * to read as one flat plane. So: one hard warm key for the sun, one wide
 * violet hemisphere for the sky and its bounce, and one dim cool rim from the
 * opposite side to keep silhouettes from merging into the fog. That is the
 * whole rig and it is deliberately austere.
 */
export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // FXAA in the post chain instead; cheaper with bloom
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES rolls the gold highlights off without clipping them to white, which
    // is exactly the failure mode a golden-hour scene has under Linear.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.46;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = PALETTE.skyHorizon.clone();
    // Fog is doing real work here: the route climbs and then descends, and the
    // haze is what sells the drop to the rooftops of the 9th from the top of
    // the Ravignan stairs.
    this.scene.fog = new THREE.Fog(PALETTE.fogColor, 45, 320);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);

    this.#buildLights();
    this.#buildComposer();

    /**
     * Adaptive resolution. This is the shipped stand-in for the brief's DLSS
     * request — see docs/CONSTRAINTS.md §3 for why DLSS cannot be reached from
     * a browser at all. Both trade internal resolution for frame rate; DLSS
     * reconstructs the lost detail and this does not.
     */
    this.adaptive = new AdaptiveResolution();
    this.renderScale = 1;
    this._lastFrameStart = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  #buildLights() {
    const dir = sunDirection();

    // KEY — the sun. Low, amber, hard.
    //
    // The route opens heading 253° (west-south-west) with the sun bearing
    // 287°, so the first thing the player ever sees is backlit from 34° off
    // axis. That is a deliberately dramatic opening and it is also why the
    // FILL below has to be so strong: in a backlit frame every façade facing
    // the camera is a shadow face, and if the fill cannot carry them they go
    // to black and the scene reads as night.
    this.sun = new THREE.DirectionalLight(PALETTE.sunColor, 4.6);
    this.sun.position.copy(dir).multiplyScalar(220);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 90;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 520 });
    // Low sun means grazing shadow rays, which means acne. A generous normal
    // bias is the cheap fix and flat-shaded geometry hides the peter-panning.
    this.sun.shadow.normalBias = 0.055;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // FILL — sky above, warm bounce off the cobbles below.
    //
    // This is the most important number in the renderer. A real golden-hour
    // street is not dark: the sky is an enormous area light and the shadow
    // side of a building is lit violet by it, not black. Under-fill is the
    // single most common way a stylised scene ends up looking like night with
    // a streetlamp, which is exactly what the first screenshots showed.
    this.sky = new THREE.HemisphereLight(PALETTE.skyZenith, PALETTE.skyGround, 4.6);
    this.scene.add(this.sky);

    // RIM — a dim cool light from the east, opposite the sun. Keeps a shadowed
    // façade from dissolving into the fog behind it.
        // Raised again after the first golden-hour pass: looking into the sun
    // means every camera-facing wall is a shadow face, and the rim is the only
    // thing keeping those walls from merging into one black mass.
    this.rim = new THREE.DirectionalLight(PALETTE.skyZenith, 1.7);
    this.rim.position.set(dir.x * -140, 60, dir.z * -140);
    this.scene.add(this.rim);
  }

  #buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Bloom, restrained. The telegraph flash, the tracers and the sun's halo
    // need to bloom; the limestone must not. The threshold sits just under
    // pure white for that reason — at 0.86 the street lanterns smeared into
    // white blobs that dominated the frame, which in a scene this warm reads
    // as a blown exposure rather than as a light.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.7, 0.95);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.grade);

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
  }

  /** Hit flash, low-health pulse and area-clear wash all drive the grade pass. */
  setDamageVignette(v) { this.grade.uniforms.uDamage.value = v; }
  setFlash(v) { this.grade.uniforms.uFlash.value = v; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.cssWidth = w;
    this.cssHeight = h;
    // The canvas stays at CSS size; only the drawing buffer scales, so the
    // browser does the final upscale for free.
    const rw = Math.max(320, Math.round(w * this.renderScale));
    const rh = Math.max(180, Math.round(h * this.renderScale));
    this.renderer.setSize(rw, rh, false);
    this.composer.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.bloom.resolution.set(rw, rh);
    this.fxaa.material.uniforms.resolution.value.set(1 / (rw * dpr), 1 / (rh * dpr));
  }

  /**
   * Disable adaptive scaling.
   *
   * The verification harness runs on a software rasteriser where every frame
   * is far over budget, so the scaler would immediately floor the resolution
   * and every screenshot would be reviewed at 55%. Screenshots must show what
   * the game looks like, not what the harness can afford.
   */
  setAdaptiveEnabled(on) {
    this.adaptive.enabled = on;
    if (!on && this.renderScale !== 1) {
      this.renderScale = 1;
      this.adaptive.reset();
      this.resize();
    }
  }

  /** The sky dome is drawn around the camera, so it has to travel with it. */
  attachSky(skyGroup) { this.skyGroup = skyGroup; }

  render(timeSec) {
    const t0 = performance.now();
    if (this.skyGroup) this.skyGroup.position.copy(this.camera.position);
    this.grade.uniforms.uTime.value = timeSec;
    this.composer.render();

    // Measure the frame we just drew and let the scaler decide. Sampling after
    // the draw rather than before means we are measuring the cost of the
    // resolution currently in force, which is the thing being regulated.
    const next = this.adaptive.sample(performance.now() - t0);
    if (next !== null && Math.abs(next - this.renderScale) > 0.001) {
      this.renderScale = next;
      this.resize();
    }
  }
}

/**
 * Colour grade, vignette, damage response.
 *
 * The grade does one thing that matters more than the rest: it pushes shadows
 * toward violet and highlights toward gold, *after* tone mapping. Doing it in
 * the lights alone is not enough, because tone mapping compresses the top end
 * and pulls the gold back toward white. Re-applying the split here is what
 * keeps the amber/violet contract intact in the final image.
 */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime:    { value: 0 },
    uDamage:  { value: 0 },
    uFlash:   { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDamage, uFlash;
    varying vec2 vUv;

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // ATMOSPHERIC LIFT. The single most important line in this shader.
      //
      // Golden-hour air is full of haze and haze never lets a shadow reach
      // zero — the darkest thing in a real late-afternoon street is a dusty
      // violet, not black. Without this lift the S-curve below crushes a 0.1
      // shadow to 0.058 and the whole scene reads as night with a streetlamp,
      // which is exactly what the first screenshots showed. Lifting toward
      // violet rather than grey also reinforces the amber/violet split the
      // palette is built on.
      const vec3 HAZE = vec3(0.052, 0.046, 0.078);
      col = HAZE + col * (1.0 - HAZE);

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // Split tone: violet into the shadows, gold into the highlights.
      vec3 shadowTint = vec3(0.94, 0.95, 1.18);   // hue shift, not a level drop
      vec3 highTint   = vec3(1.07, 1.02, 0.90);
      col *= mix(shadowTint, highTint, smoothstep(0.12, 0.72, l));

      // Gentle S-curve for arcade punch. The weight is deliberately low: a
      // stronger curve looks punchier on a bright test image and then eats the
      // shadow detail that carries all the architectural relief in a
      // flat-shaded scene, where geometry is the only thing standing in for
      // texture.
      col = clamp(col, 0.0, 4.0);
      col = col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0)) * 0.18 + col * 0.82;

      // Slight saturation lift — the palette is bold by design.
      float g = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(g), col, 1.16);

      // Vignette. Kept light — it stacks multiplicatively with the shadow
      // tint above, and at 0.85 the two together were taking another quarter
      // out of the corners on top of everything else.
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * 0.46;
      col *= vig;

      // Damage: red creeping in from the edges, pulsing.
      if (uDamage > 0.001) {
        float edge = smoothstep(0.18, 0.62, dot(d, d));
        float pulse = 0.72 + 0.28 * sin(uTime * 15.0);
        col = mix(col, vec3(0.72, 0.06, 0.05), edge * uDamage * pulse);
        col = mix(col, vec3(dot(col, vec3(0.33))), uDamage * 0.35);
      }

      // Muzzle / area-clear flash.
      col += uFlash * vec3(1.0, 0.93, 0.78);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
