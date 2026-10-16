import * as THREE from 'three';

/**
 * Small additions to Three.js's built-in materials (instead of whole custom
 * shaders, so lighting, shadows, and fog keep working). Each addition has a
 * fixed "program cache key" so every material using it shares ONE compiled
 * shader program: compiling is the expensive part.
 */

/**
 * Map surfaces: lighting baked when the map loads.
 * - vertex colors darken corners and contact areas (ambient occlusion)
 * - `aLight` adds the light from lamp fixtures
 */
export function addBakedLighting(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial): void {
  mat.vertexColors = true;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLight;\nvarying vec3 vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLight;')
      // Lamp light lights the surface color (diffuseColor already includes the texture and AO).
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vLight;');
  };
  mat.customProgramCacheKey = () => `baked-light-${mat.type}`;
}

/**
 * Characters: per-vertex glow (visors, lights) and a per-character "lamp
 * light" tint, so characters pick up the colored light of nearby lamps
 * without any real (expensive) lights in the scene.
 */
export type CharacterMaterial = (THREE.MeshStandardMaterial | THREE.MeshLambertMaterial) & { lampLight: THREE.Color };

export function makeCharacterMaterial(kind: 'standard' | 'lambert' = 'standard'): CharacterMaterial {
  const mat = (
    kind === 'lambert'
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 })
  ) as CharacterMaterial;
  mat.lampLight = new THREE.Color(0, 0, 0);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = { value: mat.lampLight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLamp;\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow + diffuseColor.rgb * uLamp;',
      );
  };
  mat.customProgramCacheKey = () => `character-${mat.type}`;
  return mat;
}
