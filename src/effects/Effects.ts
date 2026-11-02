import * as THREE from 'three';
import { getFlashTexture, getHoleTexture, getSmokeTexture } from '../assets/textures';
import { currentQuality } from '../render/quality';

/**
 * Short-lived visual effects in the world: bullet tracers, sparks/blood
 * puffs, and bullet holes. Everything is pooled (reused) to avoid
 * creating objects while playing, which keeps the frame rate smooth.
 */

const MAX_TRACERS = 48;
const TRACER_SPEED = 350; // m/s
const TRACER_LENGTH = 3.5;
const MAX_PARTICLES = 600;
const MAX_DECALS = 120;
const FORWARD = new THREE.Vector3(0, 0, -1);
const BACKWARD = new THREE.Vector3(0, 0, 1);

interface Tracer {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  traveled: number;
  active: boolean;
}

export class Effects {
  private tracers: Tracer[] = [];

  // Particles: one Points object with a fixed-size buffer.
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pCol = new Float32Array(MAX_PARTICLES * 3);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pGravity = new Float32Array(MAX_PARTICLES);
  private pNext = 0;
  private points: THREE.Points;

  private decals: THREE.InstancedMesh;
  private decalNext = 0;
  private decalCount = 0;

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _v = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _spin = new THREE.Quaternion();
  /** Muzzle flashes of other shooters (bots), as camera-facing sprites. */
  private flashes: { sprite: THREE.Sprite; life: number }[] = [];
  /** Brief light at the muzzle so shots light up nearby walls. */
  private flashLight = new THREE.PointLight(0xffc070, 0, 6, 1.8);
  /** Explosions: fireballs, smoke puffs, and a big orange light. */
  private fireballs: { sprite: THREE.Sprite; life: number; max: number; size: number }[] = [];
  private smoke: { sprite: THREE.Sprite; life: number; max: number; size: number; vel: THREE.Vector3 }[] = [];
  private blastLight = new THREE.PointLight(0xff9a40, 0, 18, 1.6);

  constructor(private scene: THREE.Scene) {
    // ---- Tracers: a thin glowing box, stretched along the bullet path.
    const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    tracerGeo.translate(0, 0, -0.5); // so it extends forward from its origin
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe2a0,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, start: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, traveled: 0, active: false });
    }

    // ---- Particles
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -9999;
    scene.add(this.points);

    // ---- Bullet holes: one instanced mesh = one draw call for all of them.
    const holeTex = getHoleTexture();
    this.decals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.11, 0.11),
      new THREE.MeshStandardMaterial({
        map: holeTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        roughness: 1,
      }),
      MAX_DECALS,
    );
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    scene.add(this.flashLight);

    const flashMat = new THREE.SpriteMaterial({
      map: getFlashTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    for (let i = 0; i < 32; i++) {
      const sprite = new THREE.Sprite(flashMat);
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0 });
    }

    // ---- Explosions
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: getFlashTexture(), color: i % 5 === 0 ? 0xffffff : 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sprite.visible = false;
      scene.add(sprite);
      this.fireballs.push({ sprite, life: 0, max: 1, size: 1 });
    }
    const smokeTex = getSmokeTexture();
    for (let i = 0; i < 28; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a6460, depthWrite: false, transparent: true, opacity: 0 }));
      sprite.visible = false;
      scene.add(sprite);
      this.smoke.push({ sprite, life: 0, max: 1, size: 1, vel: new THREE.Vector3() });
    }
    scene.add(this.blastLight);
  }

  /** A grenade going off: a fireball, flying sparks and debris, then rolling smoke. */
  explosion(at: THREE.Vector3): void {
    this.blastLight.position.copy(at);
    this.blastLight.intensity = 60;
    for (let i = 0; i < 5; i++) {
      // The first is a white-hot flash; the rest are rolling orange fire.
      const f = i === 0 ? (this.fireballs.find((x, k) => k % 5 === 0 && x.life <= 0) ?? this.fireballs[0]) : (this.fireballs.find((x, k) => k % 5 !== 0 && x.life <= 0) ?? this.fireballs[i]);
      f.max = f.life = i === 0 ? 0.16 : 0.4 + i * 0.09;
      f.size = i === 0 ? 7 : 3.2 + Math.random() * 2;
      f.sprite.position.set(at.x + (Math.random() - 0.5) * 0.6, at.y + 0.2 + Math.random() * 0.5, at.z + (Math.random() - 0.5) * 0.6);
      f.sprite.material.rotation = Math.random() * Math.PI * 2;
      f.sprite.visible = true;
    }
    for (let i = 0; i < 10; i++) {
      const p = this.smoke.find((x) => x.life <= 0) ?? this.smoke[(i * 3) % this.smoke.length];
      p.max = p.life = 2.2 + Math.random() * 1.6;
      p.size = 1.6 + Math.random() * 1.4;
      p.sprite.position.set(at.x + (Math.random() - 0.5) * 1.2, at.y + Math.random() * 0.8, at.z + (Math.random() - 0.5) * 1.2);
      p.vel.set((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
      p.sprite.material.rotation = Math.random() * Math.PI * 2;
      p.sprite.material.color.setScalar(0.35 + Math.random() * 0.15);
      p.sprite.visible = true;
    }
    const up = this._v.set(0, 1, 0);
    for (let i = 0; i < 60; i++) this.spawnParticle(at, up, 5 + Math.random() * 9, 1, 0.6 + Math.random() * 0.3, 0.2, 0.4 + Math.random() * 0.5, 12);
    for (let i = 0; i < 30; i++) {
      const c = 0.2 + Math.random() * 0.15;
      this.spawnParticle(at, up, 3 + Math.random() * 6, c, c * 0.95, c * 0.9, 0.8 + Math.random() * 0.6, 14);
    }
  }

  /** A muzzle flash out in the world (someone else's gun). */
  worldFlash(at: THREE.Vector3, size = 1, withLight = true): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.life = withLight ? 0.05 : 0.035;
    f.sprite.position.copy(at);
    f.sprite.scale.setScalar((0.35 + Math.random() * 0.2) * size);
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    if (withLight) this.muzzleLight(at);
  }

  /** Prepares effect shaders up front so the first shot doesn't stutter. */
  precompile(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.tracers[0].mesh.visible = true;
    this.flashes[0].sprite.visible = true;
    this.decals.count = 1;
    renderer.compile(this.scene, camera);
    this.tracers[0].mesh.visible = false;
    this.flashes[0].sprite.visible = false;
    this.decals.count = this.decalCount;
  }

  muzzleLight(at: THREE.Vector3): void {
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 2.5;
  }

  /** A streak of light flying from `from` to `to`. */
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers.find((x) => !x.active);
    if (!t) return;
    t.start.copy(from);
    t.dir.subVectors(to, from);
    t.length = t.dir.length();
    if (t.length < 0.5) return;
    t.dir.divideScalar(t.length);
    t.traveled = 0;
    t.active = true;
    t.mesh.visible = true;
    t.mesh.quaternion.setFromUnitVectors(FORWARD, t.dir);
    t.mesh.position.copy(from);
    t.mesh.scale.set(1, 1, 0.01);
  }

  /** Bullet hits a wall: sparks, dust, and a bullet hole. */
  impact(point: THREE.Vector3, normal: THREE.Vector3): void {
    // A tiny spark flash right at the hit.
    this.worldFlash(this._v.copy(point).addScaledVector(normal, 0.05), 0.35, false);
    for (let i = 0; i < 6; i++) {
      this.spawnParticle(point, normal, 3 + Math.random() * 3, 1.0, 0.85, 0.45, 0.25 + Math.random() * 0.15, 9);
    }
    for (let i = 0; i < 5; i++) {
      const c = 0.45 + Math.random() * 0.15;
      this.spawnParticle(point, normal, 0.8 + Math.random(), c, c, c * 0.95, 0.5 + Math.random() * 0.3, 1.5);
    }
    this.addDecal(point, normal);
  }

  /** Bullet hits a character: a red puff. */
  bloodPuff(point: THREE.Vector3, dir: THREE.Vector3): void {
    this._v.copy(dir).negate();
    for (let i = 0; i < 10; i++) {
      this.spawnParticle(point, this._v, 1.5 + Math.random() * 2, 0.6 + Math.random() * 0.2, 0.02, 0.02, 0.35 + Math.random() * 0.2, 6);
    }
  }

  private spawnParticle(
    p: THREE.Vector3, n: THREE.Vector3, speed: number,
    r: number, g: number, b: number, life: number, gravity: number,
  ): void {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % MAX_PARTICLES;
    // Random direction in the hemisphere around the normal.
    let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
    if (dx * n.x + dy * n.y + dz * n.z < 0) { dx = -dx; dy = -dy; dz = -dz; }
    dx += n.x * 1.2; dy += n.y * 1.2; dz += n.z * 1.2;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.pPos.set([p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02], i * 3);
    this.pVel.set([(dx / l) * speed, (dy / l) * speed, (dz / l) * speed], i * 3);
    this.pCol.set([r, g, b], i * 3);
    this.pLife[i] = life;
    this.pGravity[i] = gravity;
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    this._q.setFromUnitVectors(BACKWARD, normal);
    // Random spin so holes don't all look the same.
    this._q.multiply(this._spin.setFromAxisAngle(BACKWARD, Math.random() * Math.PI * 2));
    const s = 0.7 + Math.random() * 0.5;
    // Walls with 3D bricks/panels (Medium and High) stick out a little past
    // the surface the bullet hits: sit the hole on top of them.
    const lift = Math.abs(normal.y) < 0.5 && currentQuality().mapDetail ? 0.027 : 0.004;
    this._m.compose(this._v.copy(point).addScaledVector(normal, lift), this._q, this._s.set(s, s, s));
    this.decals.setMatrixAt(this.decalNext, this._m);
    this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    this.decalCount = Math.min(MAX_DECALS, this.decalCount + 1);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 50);
    this.blastLight.intensity = Math.max(0, this.blastLight.intensity - dt * 150);
    for (const f of this.fireballs) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.max;
      // Swells fast, then fades out.
      f.sprite.scale.setScalar(f.size * (0.4 + 0.8 * Math.sqrt(t)));
      f.sprite.material.opacity = 1 - t * t;
      if (f.life <= 0) f.sprite.visible = false;
    }
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const t = 1 - Math.max(0, p.life) / p.max;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.sprite.scale.setScalar(p.size * (0.6 + 1.4 * t));
      p.sprite.material.opacity = 0.75 * Math.min(1, t * 6) * (1 - t);
      p.sprite.material.rotation += dt * 0.2;
      if (p.life <= 0) p.sprite.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.sprite.visible = false;
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.traveled += TRACER_SPEED * dt;
      const head = Math.min(t.traveled, t.length);
      const tail = Math.max(0, t.traveled - TRACER_LENGTH);
      if (tail >= t.length) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      t.mesh.position.copy(t.start).addScaledVector(t.dir, tail);
      t.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    }

    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      const j = i * 3;
      if (this.pLife[i] <= 0) {
        this.pPos[j + 1] = -9999;
        continue;
      }
      this.pVel[j + 1] -= this.pGravity[i] * dt;
      this.pPos[j] += this.pVel[j] * dt;
      this.pPos[j + 1] += this.pVel[j + 1] * dt;
      this.pPos[j + 2] += this.pVel[j + 2] * dt;
    }
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}
