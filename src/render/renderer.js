import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { PALETTE, sunDirection } from './palette.js';
import { buildSkyEnvironment } from './sky.js';
import { AdaptiveResolution } from './adaptive.js';
import { ViewModelPass } from './viewmodel.js';

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
        // Dropped from 1.46. ACES at that exposure was clipping the warm channel,
    // and with everything past the old fog plane also tinted gold the result
    // was frames containing essentially one hue — facade, kerb, pavement and
    // sky separated only by value. The whole point of the amber/violet split
    // is that HUE carries the shading information, because flat-shaded
    // low-poly geometry has no detail to carry it.
        // Measured, not guessed: at 1.26 the sunlit limestone on rue Ravignan was
    // clipping across 10.6% of the frame (tools/verify/palette-check.mjs).
    // A blown highlight in a flat-shaded scene is worse than in a textured one
    // because there is no surface detail left to read once the value pins.
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = PALETTE.skyHorizon.clone();
    // Fog is doing real work here: the route climbs and then descends, and the
    // haze is what sells the drop to the rooftops of the 9th from the top of
    // the Ravignan stairs.
    // Fog range. A Montmartre block is 60-80 m end to end, so at the original
    // near plane of 45 m the far end of EVERY street was already half
    // dissolved — the payoff of the Ravignan descent, which is meant to open
    // out over the rooftops of the 9th, arrived as a featureless cream smear.
    // Fog should be atmosphere, not a draw-distance excuse.
    this.scene.fog = new THREE.Fog(PALETTE.fogColor, 110, 560);

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

    /**
     * Lighten the shadows.
     *
     * At 11.5 degrees of sun elevation a fifteen-metre terrace throws a
     * seventy-five-metre shadow, so on a narrow Montmartre street almost
     * everything below the top two floors is shadowed — including the whole
     * camera-facing side of the Moulin at the crest. That is physically
     * correct and artistically useless: the most recognisable landmark on the
     * route was rendering as a black cut-out.
     *
     * Raising the fill light does not fix it, because the problem is occlusion
     * and not a lack of ambient. `shadow.intensity` is the right control: it
     * scales how much the shadow map darkens, so shadows stay exactly where
     * they are and keep their shape, they just stop being holes. This is the
     * same cheat stylised films use, and it is why their shadows read as
     * colour rather than as absence.
     */
    this.sun.shadow.intensity = 0.66;
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
    // The rim is the ONLY pure-cool light in the rig, and it is what puts the
    // violet into the shadow side. Measured across the tour, most frames were
    // coming back under 12% cool against 80% warm — which is not the
    // amber/violet split the palette promises, it is a monochrome wash with a
    // few blue shutters in it. Raised hard, and it is cheap: a directional
    // light with no shadow map.
    this.rim = new THREE.DirectionalLight(PALETTE.skyZenith, 2.9);
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

    /**
     * The viewmodel pass.
     *
     * Inserted after the world and BEFORE bloom, with the world's colour kept
     * and its depth discarded. That ordering is deliberate on both counts:
     * clearing depth is what stops the gun intersecting Montmartre's narrow
     * walls, and sitting ahead of bloom is what lets the muzzle flash bloom,
     * which is most of what makes a shot feel like it went off.
     */
    this.viewmodelPass = null;

    this.grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.grade);

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
  }

  /**
   * Insert the viewmodel scene between the world render and the bloom.
   *
   * Uses ViewModelPass rather than a RenderPass with clearDepth, because
   * three's RenderPass clears depth before binding its target and therefore
   * clears the wrong buffer — see the comment on ViewModelPass.
   */
  attachViewModel(viewModel) {
    this.viewModel = viewModel;
    const pass = new ViewModelPass(viewModel.scene, viewModel.camera);
    this.viewmodelPass = pass;
    // Index 1 == immediately after the world RenderPass, before bloom, so the
    // muzzle flash still blooms.
    this.composer.insertPass(pass, 1);
    viewModel.resize(this.camera.aspect);
    if (this.envMap) viewModel.scene.environment = this.envMap;
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
    this.viewModel?.resize(w / h);
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
    this._lastFrameAt = undefined;
    if (!on && this.renderScale !== 1) {
      this.renderScale = 1;
      this.adaptive.reset();
      this.resize();
    }
  }

  /**
   * The sky dome is drawn around the camera, so it has to travel with it.
   *
   * Attaching it also bakes an environment probe from the same gradient. Every
   * metal in the game needs something to reflect or it renders black; see
   * buildSkyEnvironment.
   */
  attachSky(skyGroup) {
    this.skyGroup = skyGroup;
    this.envMap = buildSkyEnvironment(this.renderer);
    this.scene.environment = this.envMap;
    if (this.viewModel) this.viewModel.scene.environment = this.envMap;
  }

  render(timeSec) {
    // THE INTERVAL BETWEEN FRAMES, NOT THE COST OF SUBMITTING ONE.
    //
    // This used to wrap `composer.render()` in performance.now() and hand the
    // difference to the scaler. WebGL commands are queued and return before
    // the GPU has touched them, so that number is submit cost, and on a
    // GPU-bound machine — the only kind that needs a resolution scaler — it
    // reads near zero while the game runs at twenty frames a second. The
    // scaler saw a comfortable eight milliseconds and held full resolution.
    //
    // The gap between one frame starting and the next is the thing the player
    // experiences, and it includes the GPU: the browser will not schedule the
    // next animation frame until the last one has been presented. It also
    // includes hand tracking and the compositor, which are just as capable of
    // costing the player their frame rate as the renderer is.
    const now = performance.now();
    const delta = this._lastFrameAt === undefined ? null : now - this._lastFrameAt;
    this._lastFrameAt = now;

    if (this.skyGroup) this.skyGroup.position.copy(this.camera.position);
    this.grade.uniforms.uTime.value = timeSec;
    this.composer.render();

    if (delta !== null) {
      const next = this.adaptive.sample(delta);
      if (next !== null && Math.abs(next - this.renderScale) > 0.001) {
        this.renderScale = next;
        this.resize();
      }
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
      // Pulled back from (0.052, 0.046, 0.078). That much lift rescued the
      // shadows and then kept going: combined with the violet shadow tint it
      // washed the limestone mid-tones toward pink, and warm stone that reads
      // pink is a different building material. Enough haze to keep black off
      // the floor, not enough to tint what is already lit.
      // Weighted to the shadows rather than applied flat.
      //
      // 'HAZE + col * (1 - HAZE)' is a linear remap: it lifts the floor AND
      // everything above it, which is why an earlier, stronger version of this
      // washed the limestone toward pink and had to be pulled back — at which
      // point a completely unlit surface landed at 7/255, which is black by
      // any reasonable measure. Half of one tour frame measured as near-black
      // for exactly that reason.
      //
      // Squaring the complement puts the whole lift into the bottom end and
      // almost none into the midtones, so the floor can be raised properly
      // without tinting anything that is already lit. Haze behaves this way in
      // reality too: it is most of what you see in a shadow and almost
      // invisible against a sunlit wall.
      const vec3 HAZE = vec3(0.085, 0.076, 0.125);
      vec3 shadowWeight = pow(1.0 - clamp(col, 0.0, 1.0), vec3(2.0));
      col += HAZE * shadowWeight;

      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // Split tone: violet into the shadows, gold into the highlights.
      // Pushed harder after measuring the tour: the shadows were tinting
      // toward violet in principle and nowhere near enough of it survived to
      // register as a second hue. This is the last chance to state the split,
      // because tone mapping has already compressed everything above it.
      vec3 shadowTint = vec3(0.88, 0.93, 1.30);
      vec3 highTint   = vec3(1.07, 1.02, 0.90);
      // Widened the crossover so more of the midtones pick a side. A narrow
      // band leaves most of a flat-shaded scene sitting in the neutral middle,
      // which is exactly the "nothing in between" the palette forbids.
      col *= mix(shadowTint, highTint, smoothstep(0.06, 0.80, l));

      // Gentle S-curve for arcade punch. The weight is deliberately low: a
      // stronger curve looks punchier on a bright test image and then eats the
      // shadow detail that carries all the architectural relief in a
      // flat-shaded scene, where geometry is the only thing standing in for
      // texture.
      col = clamp(col, 0.0, 4.0);
      col = col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0)) * 0.18 + col * 0.82;

      // HIGHLIGHT DESATURATION. What stops a sunlit wall going neon.
      //
      // A bright warm surface saturates red and green long before blue, so
      // limestone taking the sun full-on lands around (1.0, 1.0, 0.45) and
      // renders as a flat sheet of highlighter yellow with every trace of the
      // relief gone. Measured on the Ravignan descent: ten per cent of that
      // frame, all of it one wall, all of it the same value.
      //
      // Film does not do this, because film loses saturation as it approaches
      // the shoulder — the brightest part of a sunlit surface goes toward
      // white, not toward its own hue at maximum. Pulling the weaker channels
      // up toward the strongest reproduces that, and it costs the picture
      // nothing anywhere else: below the threshold the weight is zero.
      //
      // Desaturating alone is not enough, and measuring proved it: pulling the
      // weak channels up turned (1.0, 1.0, 0.45) into (1.0, 1.0, 0.75), which
      // is a nicer colour and exactly as blown out. Frames went from 0.6% of
      // pixels at the ceiling to 28%. Redistribution is not reduction.
      //
      // So the peak comes DOWN first, through a shoulder, and only then gets
      // desaturated. The shoulder is a Reinhard curve on the brightest channel
      // with the others carried along in proportion, so hue survives: above
      // SHOULDER the curve compresses hard and approaches 1.0 asymptotically
      // but never reaches it.
      //
      // The point of the asymptote is that it still tells light sources apart
      // from lit surfaces. Tone mapping has already flattened every ordinary
      // surface to about 1.0, so nothing in the value alone distinguishes a
      // sunlit wall from a muzzle flash — except that the flash is drawn with
      // toneMapped false and arrives at three or four in a half-float buffer.
      // Through this curve a wall at 1.0 lands at 0.89 and stops looking like
      // a hole, while a flash at 3.0 lands at 0.98 and still blazes.
      //
      // 0.78 was too low. It held clipping at 0.2% of every frame in the tour
      // and did it by compressing a quarter of the tonal range, which read as
      // milk: the Ravignan descent lost the arcade punch it is there for. The
      // job is to stop the top of the range piling up at the ceiling, not to
      // rescale the picture. At 0.86 a surface arriving at 1.0 still lands at
      // 0.93 — comfortably below where the check counts a pixel as blown —
      // while everything below 0.86, which is most of what is in shot, passes
      // through untouched.
      const float SHOULDER = 0.86;
      float peak = max(max(col.r, col.g), col.b);
      if (peak > SHOULDER) {
        float over = peak - SHOULDER;
        float rolled = SHOULDER + over / (1.0 + over / (1.0 - SHOULDER));
        col *= rolled / peak;
        peak = rolled;
      }
      float bleach = smoothstep(0.88, 1.00, peak);
      col = mix(col, vec3(peak), bleach * 0.35);

      // Slight saturation lift — the palette is bold by design.
      //
      // Damped where the bleach is acting. Boosting saturation on a pixel that
      // is already one channel short of clipping is how the neon happened: the
      // lift was the last thing in the chain and it pushed exactly the values
      // that had no headroom left.
      float g = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(g), col, mix(1.16, 1.0, bleach));

      // Vignette. Kept light — it stacks multiplicatively with the shadow
      // tint above, and at 0.85 the two together were taking another quarter
      // out of the corners on top of everything else.
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * 0.46;
      col *= vig;

      // THE FLOOR HAS TO SURVIVE THE VIGNETTE.
      //
      // The haze lift at the top of this shader puts an unlit surface at about
      // 22/255, comfortably above where the palette check calls a pixel a
      // hole. Then the vignette multiplies it by as little as 0.8 and it lands
      // at 17, which is a hole — and only in the corners, so it appears as one
      // dark frame in a tour of otherwise clean ones and reads as a bad
      // material rather than as an ordering mistake. One unlit façade near the
      // edge of frame measured 46% of the picture as crushed.
      //
      // Re-applying the floor after every multiplicative stage is what makes
      // it a floor. It costs nothing anywhere the picture is already above it.
      col = max(col, HAZE * 0.72);

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
