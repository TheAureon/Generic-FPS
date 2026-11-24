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
export function addBakedLighting(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, sameBothSides = false): void {
  mat.vertexColors = true;
  mat.onBeforeCompile = (shader) => {
    // Leaf and grass cards: the back is lit like the front (their normals point out of the whole plant).
    if (sameBothSides) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ''));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLight;\nvarying vec3 vLight;\nvarying vec3 vWorld;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLight = aLight;
vec4 surfWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
surfWorld = instanceMatrix * surfWorld;
#endif
vWorld = (modelMatrix * surfWorld).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLight;\nvarying vec3 vWorld;\n${SURFACE_VARIATION}`)
      // Large, soft patches of lighter/darker and warmer/cooler color, so a
      // repeated texture doesn't show the same tile over and over.
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= surfaceVariation(vWorld);')
      // Lamp light lights the surface color (diffuseColor already includes the texture and AO).
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vLight;');
  };
  mat.customProgramCacheKey = () => `baked-light-${mat.type}${sameBothSides ? '-2s' : ''}`;
}

/** GLSL: smooth random patches by world position (value noise, two sizes). */
const SURFACE_VARIATION = `
float svHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float svNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(svHash(i), svHash(i + vec3(1, 0, 0)), f.x), mix(svHash(i + vec3(0, 1, 0)), svHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(svHash(i + vec3(0, 0, 1)), svHash(i + vec3(1, 0, 1)), f.x), mix(svHash(i + vec3(0, 1, 1)), svHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 surfaceVariation(vec3 w) {
  float big = svNoise(w * 0.11);
  float mid = svNoise(w * 0.37 + 11.3);
  float v = (big - 0.5) * 0.16 + (mid - 0.5) * 0.12;
  float warm = (svNoise(w * 0.07 + 31.7) - 0.5) * 0.06;
  return vec3(1.0 + v + warm, 1.0 + v, 1.0 + v - warm);
}
`;

/**
 * GLSL for the soldiers' surfaces (by the body's rest position, so patterns
 * stay put on the body as it moves). Surface ids match SURF in characterModel.ts:
 * 1 cloth, 2 nylon, 3 skin, 4 hard plastic, 5 rubber, 6 metal.
 */
const CHARACTER_SURFACES = `
// Light-to-dark camo blotches on the uniform, a fine pattern on everything.
vec3 surfaceTone(vec3 p, float s) {
  if (s < 0.5) return vec3(1.0);
  float fine = svNoise(p * 90.0);
  if (s < 1.5) {
    float n = svNoise(p * 7.0) * 0.6 + svNoise(p * 16.0 + 7.0) * 0.4;
    float tone = mix(0.76, 1.0, smoothstep(0.4, 0.45, n));
    tone = mix(tone, 1.16, smoothstep(0.57, 0.62, n));
    return vec3(tone * (0.95 + fine * 0.1));
  }
  if (s < 2.5) return vec3(0.9 + fine * 0.18);
  if (s < 3.5) {
    // Skin: a little redder in places, a touch of stubble shadow low on the face.
    float blush = svNoise(p * 25.0);
    return vec3(1.0 + blush * 0.06, 0.97 + fine * 0.04, 0.95 + fine * 0.04);
  }
  if (s < 4.5) {
    // Hard plastic: worn lighter on edges and scuffs.
    float scuff = smoothstep(0.7, 0.8, svNoise(p * 40.0));
    return vec3(0.96 + scuff * 0.25);
  }
  if (s < 5.5) return vec3(0.92 + fine * 0.14);
  return vec3(1.0 + fine * 0.1);
}
float surfaceRoughness(float s) {
  if (s < 0.5) return 0.72;
  if (s < 1.5) return 0.92;
  if (s < 2.5) return 0.8;
  if (s < 3.5) return 0.55;
  if (s < 4.5) return 0.42;
  if (s < 5.5) return 0.88;
  return 0.35;
}
// Tiny bumps (meters): woven fabric, nylon weave, grain on rubber and skin.
float surfaceHeight(vec3 p, float s) {
  if (s < 0.5 || s > 5.5) return 0.0;
  float fade = 1.0 - smoothstep(0.004, 0.012, length(fwidth(p)));
  if (s < 1.5) return (sin(p.x * 900.0 + p.y * 900.0) * sin(p.y * 900.0 - p.z * 900.0)) * 0.00012 * fade + svNoise(p * 60.0) * 0.0015;
  if (s < 2.5) return (sin(p.x * 1300.0) + sin(p.y * 1300.0) + sin(p.z * 1300.0)) * 0.00008 * fade + svNoise(p * 50.0) * 0.001;
  if (s < 3.5) return svNoise(p * 220.0) * 0.0003 * fade;
  if (s < 4.5) return svNoise(p * 30.0) * 0.0012;
  return svNoise(p * 160.0) * 0.0005 * fade;
}
`;

/**
 * Characters: per-vertex glow (visors, lights) and a per-character "lamp
 * light" tint, so characters pick up the colored light of nearby lamps
 * without any real (expensive) lights in the scene.
 */
export type CharacterMaterial = (THREE.MeshStandardMaterial | THREE.MeshLambertMaterial) & { lampLight: THREE.Color };

export function makeCharacterMaterial(kind: 'standard' | 'lambert' = 'standard', surfaces = false): CharacterMaterial {
  const mat = (
    kind === 'lambert'
      ? new THREE.MeshLambertMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 })
  ) as CharacterMaterial;
  mat.lampLight = new THREE.Color(0, 0, 0);
  if (surfaces) mat.defines = { CHAR_SURFACES: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = { value: mat.lampLight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\n#ifdef CHAR_SURFACES\nattribute float aSurf;\nvarying float vSurf;\nvarying vec3 vRest;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\n#ifdef CHAR_SURFACES\nvSurf = aSurf;\nvRest = position;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uLamp;\nvarying float vGlow;\n#ifdef CHAR_SURFACES\nvarying float vSurf;\nvarying vec3 vRest;\n${SURFACE_VARIATION}\n${CHARACTER_SURFACES}\n#endif`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef CHAR_SURFACES\ndiffuseColor.rgb *= surfaceTone(vRest, vSurf);\n#endif')
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n#ifdef CHAR_SURFACES\nroughnessFactor = surfaceRoughness(vSurf);\n#endif',
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n#ifdef CHAR_SURFACES\nmetalnessFactor = vSurf > 5.5 ? 0.8 : 0.03;\n#endif')
      // Fine relief (fabric weave, scuffs) by bending the surface normal; fades out with distance.
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef CHAR_SURFACES
{
  float hgt = surfaceHeight(vRest, vSurf);
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(hgt), dhy = dFdy(hgt);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad);
}
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow + diffuseColor.rgb * uLamp;',
      );
  };
  mat.customProgramCacheKey = () => `character-${mat.type}${surfaces ? '-surf' : ''}`;
  return mat;
}
