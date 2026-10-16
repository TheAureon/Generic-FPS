import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Combines all the little box meshes under `root` into ONE mesh (keeping
 * each part's color), which is much cheaper to draw. Sub-trees listed in
 * `skip` are left alone (e.g. limbs that animate separately).
 */
export function mergeMeshes(root: THREE.Object3D, material: THREE.Material, skip: Set<THREE.Object3D> = new Set()): THREE.Mesh | null {
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geos: THREE.BufferGeometry[] = [];
  const merged: THREE.Mesh[] = [];
  const m = new THREE.Matrix4();

  const visit = (o: THREE.Object3D) => {
    if (o !== root && skip.has(o)) return;
    if (o instanceof THREE.Mesh) {
      let g = (o.geometry as THREE.BufferGeometry).clone();
      if (g.index) g = g.toNonIndexed();
      g.deleteAttribute('uv');
      g.applyMatrix4(m.multiplyMatrices(toLocal, o.matrixWorld));
      const color = ((o.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xffffff)).clone();
      const count = g.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(g);
      merged.push(o);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  if (geos.length === 0) return null;

  // Remove the originals (keep any non-mesh children, like the muzzle marker).
  for (const mesh of merged) {
    for (const child of [...mesh.children]) mesh.parent?.add(child);
    mesh.removeFromParent();
  }
  const out = new THREE.Mesh(mergeGeometries(geos, false), material);
  for (const g of geos) g.dispose();
  out.castShadow = true;
  root.add(out);
  return out;
}
