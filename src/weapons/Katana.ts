import * as THREE from 'three';
import { MELEE } from '../config';
import { smoothstep } from './animations';

/**
 * The katana in first person: a right arm draws it and slashes diagonally
 * across the screen (upper right to lower left), leaving a bright streak,
 * then drops out of view while the gun comes back up.
 *
 * The swing is a few key poses (see SWING): where the hand is, which way the
 * blade points, and which way the forearm runs back toward the elbow. The
 * blade's edge always leads the cut.
 */

interface Pose {
  /** Seconds into the slash. */
  t: number;
  /** Hand position (camera space: x right, y up, -z forward; meters). */
  hand: [number, number, number];
  /** Blade direction (hand → tip). */
  blade: [number, number, number];
  /** Forearm direction (hand → elbow). */
  arm: [number, number, number];
}

/** The slash, key by key. Times scale with MELEE.swingTime (these are for 0.5 s). */
const SWING: Pose[] = [
  // Coming up from low on the right...
  { t: 0, hand: [0.36, -0.5, -0.34], blade: [0.1, 0.6, 0.8], arm: [0.4, -0.7, 0.6] },
  // ...raised high on the right, blade up over the shoulder...
  { t: 0.085, hand: [0.3, 0.0, -0.4], blade: [-0.3, 0.45, 0.85], arm: [0.35, -0.75, 0.55] },
  // ...cutting down across the middle of the screen...
  { t: 0.135, hand: [0.05, -0.12, -0.5], blade: [-0.65, 0.6, 0.35], arm: [0.3, -0.3, 0.9] },
  // ...finishing low on the left...
  { t: 0.2, hand: [-0.25, -0.35, -0.42], blade: [-0.7, -0.65, 0.4], arm: [0.6, -0.1, 0.8] },
  // ...and dropping out of view.
  { t: 0.5, hand: [-0.2, -0.85, -0.32], blade: [-0.7, -0.6, 0.4], arm: [0.6, -0.2, 0.75] },
];
/** The fast part of the cut (draws the streak). */
const TRAIL_FROM = 0.085;
const TRAIL_TO = 0.21;
const TRAIL_STEPS = 14;
/** How far back in time the streak reaches (seconds). */
const TRAIL_LENGTH = 0.07;

/** Blade length (meters) and the whole sword's size on screen. */
const BLADE = 0.68;
const SCALE = 0.8;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class KatanaView {
  /** The arm with the sword in hand (moved every frame while slashing). */
  private rig = new THREE.Group();
  private trail: THREE.Mesh;
  private trailPos: Float32Array;
  private poses: { t: number; pos: THREE.Vector3; quat: THREE.Quaternion }[];
  /** Seconds into the current slash (99 = not slashing). */
  private t = 99;
  /** Where the bottom of the blade and the tip sit on the sword (rig space). */
  private base = new THREE.Vector3();
  private tip = new THREE.Vector3();

  constructor(parent: THREE.Object3D, arm: THREE.Group) {
    const sword = makeKatana();
    // The sword's blade runs along its +Y with the edge to +X. In the hand,
    // the blade comes out of the thumb side (-X of the arm) with the edge
    // facing forward along the fingers (-Z), so the forearm trails behind the cut.
    _m.makeBasis(_x.set(0, 0, -1), _y.set(-1, 0, 0), _z.set(0, 1, 0));
    sword.quaternion.setFromRotationMatrix(_m);
    // Turned a little about the blade, so you see some of its flat as it cuts.
    sword.quaternion.multiply(_q.setFromAxisAngle(_y.set(0, 1, 0), 0.6));
    // The handle runs through the fist, guard just past the thumb.
    sword.position.set(-0.035 / SCALE, -0.004 / SCALE, -0.02 / SCALE);
    const inner = new THREE.Group();
    inner.scale.setScalar(SCALE);
    inner.add(sword);
    arm.add(inner);
    this.rig.add(arm);
    this.rig.visible = false;
    parent.add(this.rig);
    sword.updateMatrix();
    this.base.set(0, 0.05, 0).applyMatrix4(sword.matrix).multiplyScalar(SCALE);
    this.tip.set(0, BLADE, 0).applyMatrix4(sword.matrix).multiplyScalar(SCALE);

    const k = MELEE.swingTime / 0.5;
    this.poses = SWING.map((p) => {
      const b = _b.set(...p.blade).normalize();
      // Arm space: blade = -X, forearm = +Z.
      const x = _x.copy(b).negate();
      const z = _z.set(...p.arm).addScaledVector(x, -new THREE.Vector3(...p.arm).dot(x)).normalize();
      const y = _y.crossVectors(z, x);
      return { t: p.t * k, pos: new THREE.Vector3(...p.hand), quat: new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z)) };
    });

    // The streak: a ribbon between where the blade's base and tip have just been.
    this.trailPos = new Float32Array((TRAIL_STEPS + 1) * 2 * 3);
    const alpha = new Float32Array((TRAIL_STEPS + 1) * 2);
    const index: number[] = [];
    for (let i = 0; i <= TRAIL_STEPS; i++) {
      const fade = i / TRAIL_STEPS; // 0 = oldest
      alpha[i * 2] = fade * 0.15;
      alpha[i * 2 + 1] = fade * 0.9;
      if (i < TRAIL_STEPS) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    geo.setIndex(index);
    this.trail = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: 'attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * vA * 1.4, vA); }',
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 3;
    this.trail.visible = false;
    parent.add(this.trail);
  }

  /** Show (or hide again) everything, so its shaders can be prepared up front. */
  showForCompile(on: boolean): void {
    this.rig.visible = on;
    this.trail.visible = on;
  }

  /** Start a slash. */
  slash(): void {
    this.t = 0;
  }

  /** 0..1: how far the gun should be lowered out of the way right now. */
  get gunDip(): number {
    const end = MELEE.swingTime;
    const t = this.t;
    if (t >= end) return 0;
    return smoothstep(t / 0.06) * (1 - smoothstep((t - end * 0.6) / (end * 0.4)));
  }

  update(dt: number): void {
    this.t += dt;
    const on = this.t < MELEE.swingTime;
    this.rig.visible = on;
    if (!on) {
      this.trail.visible = false;
      return;
    }
    this.pose(this.t, this.rig.position, this.rig.quaternion);

    // The streak, sampled along the swing just behind the blade.
    const to = Math.min(this.t, TRAIL_TO);
    const from = Math.max(TRAIL_FROM, to - TRAIL_LENGTH);
    this.trail.visible = to > from + 0.005 && this.t < TRAIL_TO + 0.06;
    if (!this.trail.visible) return;
    const fadeOut = 1 - Math.max(0, this.t - TRAIL_TO) / 0.06;
    for (let i = 0; i <= TRAIL_STEPS; i++) {
      this.pose(from + ((to - from) * i) / TRAIL_STEPS, _p, _q);
      _a.copy(this.base).lerp(this.tip, 0.25 + 0.75 * (1 - fadeOut)).applyQuaternion(_q).add(_p);
      _b.copy(this.tip).applyQuaternion(_q).add(_p);
      _a.toArray(this.trailPos, i * 6);
      _b.toArray(this.trailPos, i * 6 + 3);
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  /** Hand position and turn at time t of the slash. */
  private pose(t: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const P = this.poses;
    let i = 0;
    while (i < P.length - 2 && t > P[i + 1].t) i++;
    const k = smoothstep((t - P[i].t) / (P[i + 1].t - P[i].t));
    pos.lerpVectors(P[i].pos, P[i + 1].pos, k);
    quat.slerpQuaternions(P[i].quat, P[i + 1].quat, k);
  }
}

/**
 * A katana, built from simple shapes: a slightly curved, faceted steel blade
 * with a pale tempered edge, a gold collar, a dark round guard, and a black
 * cord-wrapped handle with light diamonds showing through.
 * Origin at the guard, blade along +Y, edge toward +X.
 */
export function makeKatana(): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 1;
    g.add(m);
    return m;
  };
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.22, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.9, roughness: 0.3 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.7, roughness: 0.45 });
  const cord = new THREE.MeshStandardMaterial({ color: 0x16161a, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.7 });

  add(blade(), steel);
  // Collar where the blade meets the guard.
  add(new THREE.BoxGeometry(0.03, 0.03, 0.0095), gold, 0.013, 0.017, 0);
  // Round guard (tsuba) and its thin spacers.
  const guard = add(new THREE.CylinderGeometry(0.043, 0.043, 0.007, 28), iron);
  guard.scale.set(1, 1, 0.82);
  add(new THREE.CylinderGeometry(0.031, 0.031, 0.003, 20), gold, 0.006, 0.005, 0).scale.set(1, 1, 0.6);
  add(new THREE.CylinderGeometry(0.031, 0.031, 0.003, 20), gold, 0.006, -0.005, 0).scale.set(1, 1, 0.6);
  // Handle: cord over pale ray-skin, showing as diamonds on both faces.
  const len = 0.25;
  const handle = add(new THREE.CylinderGeometry(0.0165, 0.0155, len, 14), cord, 0.008, -0.007 - len / 2, 0);
  handle.scale.set(1, 1, 0.76);
  const diamond = new THREE.BoxGeometry(0.011, 0.011, 0.002);
  for (let i = 0; i < 7; i++) {
    for (const side of [1, -1]) {
      const d = add(diamond, skin, 0.008, -0.03 - i * 0.032, side * 0.0122);
      d.rotation.z = Math.PI / 4;
      d.scale.set(1, 1.6, 1);
    }
  }
  // Collar at the top of the handle and the end cap.
  add(new THREE.CylinderGeometry(0.0175, 0.0175, 0.012, 14), gold, 0.008, -0.014, 0).scale.set(1, 1, 0.78);
  add(new THREE.CylinderGeometry(0.016, 0.0175, 0.016, 14), iron, 0.008, -0.015 - len, 0).scale.set(1, 1, 0.78);
  return g;
}

/** The blade: a faceted, gently curved strip that sweeps up to a point. */
function blade(): THREE.BufferGeometry {
  const N = 40;
  const pos: number[] = [];
  const col: number[] = [];
  const ring: THREE.Vector3[][] = [];
  const shade: number[][] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const y = 0.03 + u * (BLADE - 0.03);
    // Curve: the back bends away from the edge toward the tip.
    const c = -0.028 * u * u;
    // The point: the edge sweeps up into the back over the last 12%.
    const k = Math.max(0, (u - 0.88) / 0.12);
    const w = (0.03 - 0.005 * u) * Math.sqrt(Math.max(0, 1 - k * k));
    const t = 0.0036 * (1 - 0.3 * u) * (1 - k * 0.9);
    const spine = c + k * 0.004;
    ring.push([
      new THREE.Vector3(spine, y, t),
      new THREE.Vector3(spine + w * 0.7, y, t * 1.05),
      new THREE.Vector3(spine + w, y, 0),
      new THREE.Vector3(spine + w * 0.7, y, -t * 1.05),
      new THREE.Vector3(spine, y, -t),
    ]);
    // Pale tempered edge, darker polished body.
    shade.push([0.62, 0.7, 1, 0.7, 0.62]);
  }
  const tipY = BLADE + 0.005;
  const tip = new THREE.Vector3(-0.028 + 0.006, tipY, 0);
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, sa: number, sb: number, sc: number) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (const s of [sa, sb, sc]) col.push(0.82 * s, 0.85 * s, 0.9 * s);
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 5; j++) {
      const j2 = (j + 1) % 5;
      const a = ring[i][j], b = ring[i][j2], c = ring[i + 1][j2], d = ring[i + 1][j];
      quad(a, c, b, shade[i][j], shade[i + 1][j2], shade[i][j2]);
      quad(a, d, c, shade[i][j], shade[i + 1][j], shade[i + 1][j2]);
    }
  }
  for (let j = 0; j < 5; j++) quad(ring[N][j], tip, ring[N][(j + 1) % 5], shade[N][j], 1, shade[N][(j + 1) % 5]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
