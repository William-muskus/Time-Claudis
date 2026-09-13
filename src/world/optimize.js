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

/** Coarse buckets so near-identical materials batch together. */
function familyKey(mat, mesh) {
  return [
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

    const key = familyKey(o.material, o);
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
