import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The GLB registry.
 *
 * The brief asks for Blender-exported glTF for the 3D assets, and the pipeline
 * in tools/blender/ produces it — but for a while the world was still building
 * its own Three.js copy of every landmark and the exported files were never
 * loaded by anything except the weapons. Two sources of truth for the same
 * object is how a model and the thing on screen quietly diverge.
 *
 * So: authored objects come from GLB. The street itself stays procedural,
 * because a road has to follow the rail spline exactly and a static mesh
 * cannot.
 *
 * EVERY LOOKUP FALLS BACK. If a GLB is missing or fails to parse, the caller
 * builds the procedural version instead. A blocked network, a pipeline that
 * was not re-run, a truncated export — none of those should produce a hole in
 * Montmartre, and `tests/assets.test.js` catches them at the right time.
 */

/** Which authored objects come from Blender. */
export const GLB_ASSETS = {
  dalida_bust: 'dalida_bust.glb',
  guimard_edicule: 'guimard_edicule.glb',
  moulin_galette: 'moulin_galette.glb',
  wallace_fountain: 'wallace_fountain.glb',
  street_lamp: 'street_lamp.glb',
  morris_column: 'morris_column.glb',
  enemy_figure: 'enemy_figure.glb',
};

export class AssetRegistry {
  constructor(base = 'assets/models/') {
    this.base = base;
    /** @type {Map<string, THREE.Object3D>} */
    this.models = new Map();
    this.failures = [];
    this.loaded = false;
  }

  async load() {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(GLB_ASSETS).map(async ([key, file]) => {
      try {
        const gltf = await loader.loadAsync(this.base + file);
        const root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          // glTF has no flat-shading flag, and a joined mesh comes back
          // smooth-shaded, which dissolves the faceting the whole art
          // direction depends on.
          if (o.material) {
            o.material.flatShading = true;
            o.material.needsUpdate = true;
          }
        });
        this.models.set(key, root);
      } catch (e) {
        this.failures.push({ key, file, error: String(e?.message ?? e) });
      }
    }));
    this.loaded = true;
    if (this.failures.length) {
      console.warn('[assets] falling back to procedural geometry for:',
        this.failures.map((f) => f.key).join(', '));
    }
    return this;
  }

  /**
   * A fresh instance of an authored asset, or null if it is unavailable.
   * Clones, so several Wallace fountains do not share one transform.
   */
  instance(key) {
    const src = this.models.get(key);
    return src ? src.clone(true) : null;
  }

  has(key) { return this.models.has(key); }
}

/** A registry that always misses, for headless tests and the fallback path. */
export const EMPTY_REGISTRY = {
  loaded: true,
  failures: [],
  instance: () => null,
  has: () => false,
};
