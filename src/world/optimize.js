import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Static world batching.
 *
 * The world builder produces one mesh per architectural element — a shutter, a
 * chimney pot, a balcony baluster — because that is the only sane way to author
 * it. It is emphatically not a sane way to RENDER it: the unbatched street is
 * over fifteen thousand meshes, which is fifteen thousand draw calls and a
 * matrix update per frame each. That is slow on real hardware and catastrophic
 * on the software rasteriser the verification harness uses, where it turned a
 * screenshot into a two-minute wait.
 *
 * So: bake each mesh's colour into vertex colours, transform its geometry into
 * world space, and merge everything that shares a shading family into one
 * buffer. The visual result is identical — same colours, same flat shading,
 * same shadows — because the only thing lost is the ability to move the pieces
 * independently, and none of this geometry ever moves.
 *
 * WHAT IS DELIBERATELY NOT MERGED
 *   - anything transparent (needs per-object sort order)
 *   - anything emissive or MeshBasicMaterial (glass, signage, the telegraph)
 *   - anything a caller marked `userData.dynamic`
 *   - the Moulin's sails, which turn
 */

/**
 * SPATIAL TILES. Batching everything into one buffer per material made the
 * whole 700 m corridor one draw call per family: cheap to submit, but the
 * GPU then shades every triangle of the city in every frame, and every shadow
 * pass, though the player only ever sees a few streets of it. So batches are
 * per material AND per tile, and three.js frustum-culls the tiles. Shadow
 * passes cull against the shadow camera the same way.
 */
export const TILE_M = 100;
const tileOf = (x, z) => `${Math.floor(x / TILE_M)},${Math.floor(z / TILE_M)}`;

/** Coarse buckets so near-identical materials batch together. */
function familyKey(mat, mesh, tile) {
  return [
    tile,
    mat.type,
    Math.round((mat.roughness ?? 1) * 4),
    Math.round((mat.metalness ?? 0) * 4),
    mesh.castShadow ? 'C' : 'c',
    mesh.receiveShadow ? 'R' : 'r',
    mat.side ?? THREE.FrontSide,
  ].join('|');
}

function isMergeable(mesh) {
  const m = mesh.material;
  if (!m || Array.isArray(m)) return false;
  if (!mesh.geometry || !mesh.geometry.attributes?.position) return false;
  if (m.transparent || m.opacity < 1) return false;
  if (m.isMeshBasicMaterial) return false;
  if (m.emissive && m.emissiveIntensity > 0 &&
      (m.emissive.r + m.emissive.g + m.emissive.b) > 0.001) return false;
  if (mesh.userData.dynamic) return false;
  // Already has its own vertex colours (the carriageway) — it is one mesh
  // anyway, so leave it alone rather than re-baking.
  if (m.vertexColors) return false;
  let p = mesh;
  while (p) {
    if (p.userData?.dynamic || p.name === 'sails') return false;
    p = p.parent;
  }
  return true;
}

/**
 * @param {THREE.Object3D} root
 * @returns {{root: THREE.Object3D, before: number, after: number}}
 */
export function batchStatic(root) {
  root.updateMatrixWorld(true);

  /** @type {Map<string, {geos: THREE.BufferGeometry[], mat: THREE.Material, mesh: THREE.Mesh}>} */
  const families = new Map();
  const toRemove = [];
  let before = 0;

  root.traverse((o) => {
    if (!o.isMesh) return;
    before++;
    if (!isMergeable(o)) return;

    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const key = familyKey(o.material, o, tileOf(c.x, c.z));
    if (!families.has(key)) families.set(key, { geos: [], mat: o.material, mesh: o });

    // Clone, bake colour to vertices, bake transform to positions.
    const g = o.geometry.clone();
    // Strip attributes that differ between sources; a merge fails if the
    // attribute sets do not match exactly.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (g.index) {
      // Non-indexed everywhere, so flat shading survives the merge intact.
      const ni = g.toNonIndexed();
      g.dispose();
      applyColor(ni, o.material.color);
      ni.applyMatrix4(o.matrixWorld);
      families.get(key).geos.push(ni);
    } else {
      applyColor(g, o.material.color);
      g.applyMatrix4(o.matrixWorld);
      families.get(key).geos.push(g);
    }
    toRemove.push(o);
  });

  const batched = new THREE.Group();
  batched.name = 'batched';

  for (const [key, fam] of families) {
    if (!fam.geos.length) continue;
    let merged;
    try {
      merged = mergeGeometries(fam.geos, false);
    } catch {
      for (const g of fam.geos) g.dispose();
      continue;
    }
    if (!merged) continue;
    for (const g of fam.geos) g.dispose();

    const mat = fam.mat.clone();
    mat.vertexColors = true;
    // The baked-in colour now lives in the attribute; leave the material white
    // so it does not multiply the vertex colour a second time.
    mat.color = new THREE.Color(0xffffff);

    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `batch_${key}`;
    mesh.castShadow = fam.mesh.castShadow;
    mesh.receiveShadow = fam.mesh.receiveShadow;
    // These are baked in world space, so the mesh sits at the origin and must
    // never be culled against its own (now enormous) local bounds naively.
    merged.computeBoundingSphere();
    batched.add(mesh);
  }

  for (const o of toRemove) {
    o.geometry.dispose();
    o.parent?.remove(o);
  }
  root.add(batched);
  tileSplitAll(root);

  let after = 0;
  root.traverse((o) => { if (o.isMesh) after++; });
  return { root, before, after };
}

function applyColor(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/**
 * Split the big pre-merged, vertex-coloured meshes (the real city's families,
 * the terrain, the side streets, the garden walls) into the same tiles, by
 * triangle centroid. They are built as single corridor-wide meshes because
 * that is how they are authored; drawn that way they could never be culled.
 */
function tileSplitAll(root) {
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.dynamic || !o.material?.vertexColors) return;
    const g = o.geometry;
    if (g.index || !g.attributes.position || g.attributes.position.count < 3000) return;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb.max.x - bb.min.x < TILE_M * 1.2 && bb.max.z - bb.min.z < TILE_M * 1.2) return;
    victims.push(o);
  });
  for (const o of victims) {
    o.updateMatrixWorld(true);
    const g = o.geometry;
    const names = Object.keys(g.attributes);
    const P = g.attributes.position;
    const buckets = new Map();
    const v = new THREE.Vector3();
    for (let t = 0; t < P.count; t += 3) {
      v.set((P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3, 0, (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3)
        .applyMatrix4(o.matrixWorld);
      const k = tileOf(v.x, v.z);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }
    if (buckets.size < 2) continue;
    const group = new THREE.Group();
    group.name = o.name;
    group.position.copy(o.position); group.rotation.copy(o.rotation); group.scale.copy(o.scale);
    for (const [k, tris] of buckets) {
      const ng = new THREE.BufferGeometry();
      for (const name of names) {
        const a = g.attributes[name], n = a.itemSize;
        const out = new Float32Array(tris.length * 3 * n);
        let w = 0;
        for (const t of tris) for (let j = 0; j < 3; j++) for (let c = 0; c < n; c++) out[w++] = a.array[(t + j) * n + c];
        ng.setAttribute(name, new THREE.BufferAttribute(out, n));
      }
      ng.computeBoundingSphere();
      const m = new THREE.Mesh(ng, o.material);
      m.name = `${o.name}@${k}`;
      m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow;
      group.add(m);
    }
    o.parent.add(group);
    o.parent.remove(o);
    g.dispose();
  }
}
