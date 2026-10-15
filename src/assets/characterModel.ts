import * as THREE from 'three';

/**
 * A simple low-poly humanoid made of boxes, about 1.8 m tall, facing -Z.
 * Limbs are in pivot groups (hips, shoulders) so they can be animated.
 *
 * To use a real character model later, load it in `createCharacterModel`
 * and return the same parts (or empty groups for parts it doesn't have).
 */
export interface CharacterModel {
  root: THREE.Group;
  /** Everything above the legs; lean/turn this for aiming. */
  upper: THREE.Group;
  head: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  /** Attach a held weapon here. */
  hand: THREE.Group;
  /** All materials, so the whole body can flash when hit. */
  materials: THREE.MeshStandardMaterial[];
}

export function createCharacterModel(bodyColor: number, accentColor = 0x222222): CharacterModel {
  const body = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc69c7a, roughness: 0.8 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.5, emissive: 0x220000 });

  const mesh = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    return me;
  };

  const root = new THREE.Group();

  // Legs pivot at the hips (y = 0.92).
  const leg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.92, 0);
    g.add(mesh(0.17, 0.5, 0.2, accent, 0, -0.25, 0), mesh(0.15, 0.42, 0.17, accent, 0, -0.71, 0), mesh(0.16, 0.08, 0.26, body, 0, -0.88, -0.04));
    return g;
  };
  const leftLeg = leg(-0.11);
  const rightLeg = leg(0.11);

  const upper = new THREE.Group();
  upper.position.y = 0.92;
  upper.add(
    mesh(0.42, 0.56, 0.26, body, 0, 0.3, 0), // torso
    mesh(0.44, 0.1, 0.28, accent, 0, 0.03, 0), // belt
  );
  const head = mesh(0.26, 0.28, 0.27, skin, 0, 0.74, 0);
  head.add(mesh(0.24, 0.07, 0.04, visor, 0, 0.03, -0.14)); // eyes/visor
  head.add(mesh(0.28, 0.08, 0.29, accent, 0, 0.12, 0)); // helmet
  upper.add(head);

  // Arms pivot at the shoulders.
  const arm = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0.53, 0);
    g.add(mesh(0.12, 0.32, 0.13, body, 0, -0.16, 0), mesh(0.11, 0.3, 0.12, skin, 0, -0.45, 0));
    return g;
  };
  const leftArm = arm(-0.28);
  const rightArm = arm(0.28);
  // Arms forward, holding a weapon.
  rightArm.rotation.x = -1.25;
  leftArm.rotation.set(-1.35, 0, 0.45);
  const hand = new THREE.Group();
  hand.position.set(0.1, 0.3, -0.42);
  upper.add(leftArm, rightArm, hand);

  root.add(leftLeg, rightLeg, upper);
  return { root, upper, head, leftArm, rightArm, leftLeg, rightLeg, hand, materials: [body, accent, skin, visor] };
}
