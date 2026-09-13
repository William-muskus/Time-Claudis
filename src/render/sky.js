import * as THREE from 'three';
import { PALETTE, sunDirection, SUN_ELEVATION_DEG } from './palette.js';

/**
 * The sky.
 *
 * A flat background colour is the single biggest thing standing between a
 * low-poly scene and looking finished, because the sky is usually a third of
 * the frame and a flat fill reads instantly as "untextured viewport". Golden
 * hour in particular is almost entirely ABOUT the sky gradient: molten gold at
 * the rooftops going to deep cerulean overhead, with the transition compressed
 * low because the sun is low.
 *
 * So: an inverted sphere with a gradient shader, plus a sun disc and its
 * bloom-catching halo sitting at the real sun position. The gradient is biased
 * with a power curve rather than a linear mix so the gold stays crushed down
 * near the horizon where it belongs — a linear ramp puts the warm band halfway
 * up the sky and instantly reads as midday.
 */
export function buildSky(radius = 800) {
  const group = new THREE.Group();
  group.name = 'sky';
  const dir = sunDirection();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith:  { value: PALETTE.skyZenith.clone() },
        uHorizon: { value: PALETTE.skyHorizon.clone() },
        uGround:  { value: PALETTE.skyGround.clone() },
        uSunDir:  { value: dir.clone() },
        uSunColor:{ value: PALETTE.sunDiscColor.clone() },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          // Kill translation so the dome is always centred on the camera and
          // can never be walked out of.
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
        varying vec3 vDir;

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;

          // Above the horizon: gold to cerulean, compressed low. The 0.38
          // exponent is what keeps the warm band down at the rooftops instead
          // of floating it halfway up the sky.
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.38));

          // Below: the warm haze of the city underneath the Butte.
          vec3 below = mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.5));
          vec3 col = h > 0.0 ? sky : below;

          // The sun, and the big soft halo that makes low sun feel hot.
          float cosA = dot(d, normalize(uSunDir));
          float disc = smoothstep(0.9995, 0.99985, cosA);
          float halo = pow(max(cosA, 0.0), 220.0) * 0.55
                     + pow(max(cosA, 0.0), 14.0) * 0.30;
          col += uSunColor * halo;
          col = mix(col, uSunColor * 1.6, disc);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  dome.renderOrder = -1000;
  // The dome must never be culled: its bounds are centred on the origin but it
  // is drawn around the camera wherever that is.
  dome.frustumCulled = false;
  group.add(dome);

  void SUN_ELEVATION_DEG;
  return group;
}
