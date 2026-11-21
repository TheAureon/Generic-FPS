import * as THREE from 'three';
import { PARTY_MODES } from '../config';
import { audio } from '../audio/AudioEngine';
import { events } from '../core/events';
import type { AABB } from '../core/CollisionWorld';
import type { Bot } from '../bots/Bot';
import { formatTime, modeLimit, scoreRows, type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow } from './GameMode';

const H = PARTY_MODES.horde;

interface Turret {
  pos: THREE.Vector3;
  mesh: THREE.Group;
  head: THREE.Object3D;
  cooldown: number;
}

/**
 * Horde Defense: guard the generator in the middle of the map against waves
 * of bots. They head straight for it and wreck it while they stand next to
 * it. Kills earn money; spend it on walls (F) to block their way and turrets
 * (Y) that shoot them for you. Survive the waves to win; lose the generator
 * and it's over.
 */
export class HordeDefense implements GameMode {
  readonly id = 'horde' as const;
  readonly name = 'Horde Defense';
  readonly teams = false;
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly playerRespawns = true;
  readonly noKillstreaks = false;
  result: MatchResult | null = null;
  private core = new THREE.Vector3();
  private coreHp: number = H.coreHealth;
  private coreMesh = new THREE.Group();
  private wave = 0;
  private between = H.buildTime;
  private money: number = H.startMoney;
  private walls: { box: AABB; mesh: THREE.Mesh; nodes: number[] }[] = [];
  private turrets: Turret[] = [];
  private group = new THREE.Group();
  private off: () => void = () => {};
  private hurtFlash = 0;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return 0;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    this.ctx.scene.add(this.group);
    // The generator: on walkable ground near the middle of the map.
    const center = this.ctx.playBounds.getCenter(new THREE.Vector3());
    const node = this.ctx.nav.nearestNode(center.setY(0)) ?? this.ctx.nav.nodes[0];
    this.core.set(node.x, node.y, node.z);
    this.buildCore();
    this.ctx.respawn(this.ctx.player);
    this.off = events.on('kill', (e) => {
      if (e.killer === this.ctx.player.name && e.victim !== e.killer) this.money += H.killMoney;
    });
    this.ctx.announce('Horde Defense', `Guard the generator for ${this.limit} waves. F: wall ($${H.wallCost})  ·  Y: turret ($${H.turretCost})`, 4);
  }

  dispose(): void {
    this.off();
    this.group.removeFromParent();
  }

  private buildCore(): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), new THREE.MeshStandardMaterial({ color: 0x3c4450, metalness: 0.6, roughness: 0.4 }));
    body.position.y = 0.6;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 16), new THREE.MeshBasicMaterial({ color: 0x40e0ff }));
    glow.position.y = 1.6;
    glow.name = 'glow';
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 1.42), new THREE.MeshBasicMaterial({ color: 0xf2c14e }));
    stripe.position.y = 0.95;
    this.coreMesh.add(body, glow, stripe);
    this.coreMesh.position.copy(this.core);
    this.group.add(this.coreMesh);
    this.ctx.world.addBox({ x: this.core.x, y: this.core.y, z: this.core.z, w: 1.4, h: 1.2, d: 1.4 });
  }

  // ---- Building ----------------------------------------------------------------

  /** Where you're looking, on the floor within reach (or null). */
  private aimSpot(): THREE.Vector3 | null {
    const p = this.ctx.player.position;
    const yaw = this.ctx.playerYaw();
    const spot = new THREE.Vector3(p.x - Math.sin(yaw) * 2.5, p.y, p.z - Math.cos(yaw) * 2.5);
    const ground = this.ctx.world.groundHeight(spot.x, spot.z, 0.3, p.y + 0.6);
    if (!Number.isFinite(ground) || Math.abs(ground - p.y) > 0.6) return null;
    spot.y = ground;
    return spot;
  }

  private build(kind: 'wall' | 'turret'): void {
    const cost = kind === 'wall' ? H.wallCost : H.turretCost;
    const max = kind === 'wall' ? H.maxWalls : H.maxTurrets;
    const count = kind === 'wall' ? this.walls.length : this.turrets.length;
    const say = (t: string) => this.ctx.hud.chat('Build', t, '#f2c14e');
    if (count >= max) return say(`No more ${kind}s (${max} at most)`);
    if (this.money < cost) return say(`Need $${cost} for a ${kind}`);
    const at = this.aimSpot();
    if (!at) return say('Can’t build there');
    if (at.distanceTo(this.core) < 2) return say('Too close to the generator');
    this.money -= cost;
    if (kind === 'wall') this.placeWall(at);
    else this.placeTurret(at);
    audio.play('pickup');
  }

  /** A sandbag-and-plank barricade across where you're facing. */
  private placeWall(at: THREE.Vector3): void {
    const yaw = this.ctx.playerYaw();
    // Square to the way you're facing (along X or along Z).
    const alongX = Math.abs(Math.cos(yaw)) > Math.abs(Math.sin(yaw));
    const w = alongX ? 2.6 : 0.4, d = alongX ? 0.4 : 2.6, h = 1.25;
    const box = this.ctx.world.addBox({ x: at.x, y: at.y, z: at.z, w, h, d });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.9 }));
    mesh.position.set(at.x, at.y + h / 2, at.z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    // Bots route around it.
    const nodes = this.ctx.nav.nodes.filter((n) => n.x > box.minX - 0.4 && n.x < box.maxX + 0.4 && n.z > box.minZ - 0.4 && n.z < box.maxZ + 0.4 && Math.abs(n.y - at.y) < 1).map((n) => n.id);
    for (const id of nodes) this.ctx.nav.blocked.add(id);
    this.walls.push({ box, mesh, nodes });
  }

  /** An automatic turret on a tripod: shoots the nearest bot it can see. */
  private placeTurret(at: THREE.Vector3): void {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.6, roughness: 0.4 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a22a, roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), dark);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.22, 0.45, Math.sin(a) * 0.22);
      leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      g.add(leg);
    }
    const head = new THREE.Group();
    head.position.y = 1.0;
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.36), yellow));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8).rotateX(Math.PI / 2), dark);
    barrel.position.z = -0.35;
    head.add(barrel);
    g.add(head);
    g.position.copy(at);
    this.group.add(g);
    this.turrets.push({ pos: at.clone(), mesh: g, head, cooldown: 0 });
  }

  private updateTurrets(dt: number): void {
    const { world, bots } = this.ctx;
    for (const t of this.turrets) {
      t.cooldown -= dt;
      const eye = t.pos.clone().setY(t.pos.y + 1.05);
      let best: Bot | null = null, bestD: number = H.turretRange;
      for (const b of bots.bots) {
        if (!b.isAlive()) continue;
        const d = b.position.distanceTo(t.pos);
        if (d < bestD && world.hasLineOfSight(eye.x, eye.y, eye.z, b.position.x, b.position.y + 1.2, b.position.z)) [best, bestD] = [b, d];
      }
      if (!best) continue;
      const aim = best.position.clone().setY(best.position.y + 1.2);
      t.head.lookAt(aim.x, t.pos.y + 1.0, aim.z);
      t.head.rotateY(Math.PI);
      if (t.cooldown > 0) continue;
      t.cooldown = 1 / H.turretRate;
      best.takeDamage({ amount: H.turretDamage, part: 'body', attacker: this.ctx.player.name, weapon: 'turret', from: eye });
      audio.play('shot_smg', { position: eye, volume: 0.5 });
      this.ctx.tracer(eye, aim);
    }
  }

  // ---- Waves -----------------------------------------------------------------

  private startWave(): void {
    this.wave++;
    const size = Math.min(H.maxBots, H.firstWave + (this.wave - 1) * H.perWave);
    const have = this.ctx.bots.bots.length;
    if (size > have) this.ctx.bots.spawnBots(size - have, this.ctx.config.difficulty);
    for (const b of this.ctx.bots.bots.slice(0, size)) if (!b.isAlive()) this.ctx.respawn(b);
    this.ctx.announce(`Wave ${this.wave} of ${this.limit}`, `${size} incoming: protect the generator!`, 2.5);
    this.ctx.cue('bad');
  }

  update(dt: number): void {
    if (this.result) return;
    const { input } = this.ctx;
    if (this.ctx.player.isAlive()) {
      if (input.wasPressed('KeyF')) this.build('wall');
      if (input.wasPressed('KeyY')) this.build('turret');
    }
    this.updateTurrets(dt);

    // The generator pulses (red while it's being wrecked).
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    const glow = this.coreMesh.getObjectByName('glow') as THREE.Mesh;
    (glow.material as THREE.MeshBasicMaterial).color.setRGB(0.25 + this.hurtFlash * 0.75, 0.88 * (1 - this.hurtFlash), 1 - this.hurtFlash);
    glow.rotation.y += dt;

    const alive = this.ctx.bots.bots.filter((b) => b.isAlive());
    // Bots next to the generator wreck it.
    for (const b of alive) {
      if (b.position.distanceTo(this.core) < H.wreckRange) {
        this.coreHp -= H.wreckDps * dt;
        this.hurtFlash = 1;
      }
    }
    if (this.coreHp <= 0) {
      this.coreHp = 0;
      this.ctx.explode(this.core.clone().setY(this.core.y + 1), 6, 0, this.ctx.player.name);
      this.result = { title: 'The generator is destroyed', subtitle: `You held out until wave ${this.wave} of ${this.limit}`, win: false, stats: [`Waves cleared: ${Math.max(0, this.wave - 1)}`, `Time: ${formatTime(this.ctx.time)}`] };
      return;
    }

    if (this.between > 0) {
      this.between -= dt;
      if (this.between <= 0) this.startWave();
      return;
    }
    if (alive.length === 0) {
      // Wave cleared.
      this.ctx.award(`Wave ${this.wave} cleared`, 100 + this.wave * 25);
      this.money += H.waveMoney;
      if (this.wave >= this.limit) {
        this.result = { title: 'The generator holds!', subtitle: `All ${this.limit} waves beaten`, win: true, stats: [`Generator: ${Math.ceil((this.coreHp / H.coreHealth) * 100)}%`, `Walls: ${this.walls.length}  ·  Turrets: ${this.turrets.length}`, `Time: ${formatTime(this.ctx.time)}`] };
        return;
      }
      this.between = H.buildTime;
      this.ctx.announce(`Wave ${this.wave} cleared`, `${H.buildTime} seconds to build: F wall ($${H.wallCost})  ·  Y turret ($${H.turretCost})`, 3);
      this.ctx.cue('good');
    }
  }

  status(): string {
    const head = this.between > 0 ? `Wave ${this.wave + 1} in ${Math.ceil(this.between)}` : `Wave ${this.wave}/${this.limit}  ·  ${this.ctx.bots.bots.filter((b) => b.isAlive()).length} left`;
    return `${head}  ·  $${this.money}  ·  F wall $${H.wallCost}  ·  Y turret $${H.turretCost}`;
  }

  progress(): ProgressInfo | null {
    return { label: `Generator  ·  ${Math.ceil((this.coreHp / H.coreHealth) * 100)}%`, value: this.coreHp / H.coreHealth, color: this.hurtFlash > 0 ? '#ff5a4a' : '#40c0ff' };
  }

  markers(): Marker[] {
    return [{ x: this.core.x, y: this.core.y + 2.2, z: this.core.z, label: 'G', color: '#40c0ff' }];
  }

  botObjective(bot: Bot): BotObjective | null {
    // Straight for the generator (fighting on the way only when you're close).
    return { pos: this.core, radius: 1.5, run: true, urgent: bot.position.distanceTo(this.ctx.player.position) > 8 };
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
