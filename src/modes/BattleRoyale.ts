import * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { MODES } from '../config';
import { formatTime, scoreRows, type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow } from './GameMode';
import { snapToOpen } from './objectives';

const S = MODES.br;
const ZONE_COLOR = '#5ab0ff';
const DANGER = '#ff6152';

/**
 * Battle Royale (last one standing): everyone for themselves with one life.
 * A safe zone shrinks in stages; outside it you lose health every second.
 * Last one alive wins. If you die, you see where you placed.
 */
export class BattleRoyale implements GameMode {
  readonly id = 'br' as const;
  readonly name = 'Battle Royale';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = false;
  readonly playerRespawns = false;
  readonly noRespawnNote = 'One life in Battle Royale';
  result: MatchResult | null = null;

  private center = new THREE.Vector3();
  private radius = 0;
  private fromCenter = new THREE.Vector3();
  private fromRadius = 0;
  private nextCenter = new THREE.Vector3();
  private nextRadius = 0;
  private fullRadius = 0;
  private stage = 0;
  private phase: 'wait' | 'shrink' | 'final' = 'wait';
  private timer = 0;
  private damageTimer = 0;
  private wall: THREE.Mesh | null = null;
  private placeAtDeath = 0;
  private deadTimer = 0;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  start(): void {
    const b = this.ctx.playBounds;
    const size = b.getSize(new THREE.Vector3());
    this.fullRadius = Math.hypot(size.x, size.z) / 2 + 2;
    this.center.copy(b.getCenter(new THREE.Vector3()));
    this.radius = this.fullRadius;
    this.planNext();
    // The zone's edge: a tall see-through blue wall.
    const geo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.renderOrder = 12;
    this.ctx.scene.add(this.wall);
    this.ctx.announce('Battle Royale', 'One life · stay inside the zone · last one standing wins', 3.5);
  }

  /** Where the zone shrinks to next: smaller, inside the current one. */
  private planNext(): void {
    const st = S.stages[this.stage];
    this.phase = 'wait';
    this.timer = st.wait;
    this.nextRadius = Math.max(4, this.fullRadius * st.size);
    const room = Math.max(0, this.radius - this.nextRadius) * 0.6;
    const a = Math.random() * Math.PI * 2, d = Math.random() * room;
    // Somewhere bots can stand (and inside the map).
    const b = this.ctx.playBounds;
    const x = Math.min(b.max.x - 4, Math.max(b.min.x + 4, this.center.x + Math.cos(a) * d));
    const z = Math.min(b.max.z - 4, Math.max(b.min.z + 4, this.center.z + Math.sin(a) * d));
    this.nextCenter.copy(snapToOpen(this.ctx.nav, x, z));
  }

  private get damage(): number {
    return S.stages[Math.min(this.stage, S.stages.length - 1)].damage;
  }

  private outside(p: THREE.Vector3, center = this.center, radius = this.radius): boolean {
    return Math.hypot(p.x - center.x, p.z - center.z) > radius;
  }

  update(dt: number): void {
    if (this.result) return;
    this.timer -= dt;
    if (this.phase === 'wait' && this.timer <= 0) {
      this.phase = 'shrink';
      this.timer = S.stages[this.stage].shrink;
      this.fromCenter.copy(this.center);
      this.fromRadius = this.radius;
      this.ctx.announce('The zone is shrinking', 'Get inside the new circle', 2);
      this.ctx.cue('info');
    } else if (this.phase === 'shrink') {
      const k = 1 - Math.max(0, this.timer) / S.stages[this.stage].shrink;
      this.center.lerpVectors(this.fromCenter, this.nextCenter, k);
      this.radius = this.fromRadius + (this.nextRadius - this.fromRadius) * k;
      if (this.timer <= 0) {
        this.stage++;
        if (this.stage < S.stages.length) this.planNext();
        else this.phase = 'final';
      }
    }
    if (this.wall) {
      this.wall.position.set(this.center.x, this.ctx.playBounds.min.y - 20, this.center.z);
      this.wall.scale.set(this.radius, this.ctx.playBounds.max.y - this.ctx.playBounds.min.y + 80, this.radius);
    }

    // Outside the zone hurts.
    this.damageTimer -= dt;
    if (this.damageTimer <= 0) {
      this.damageTimer = 0.5;
      for (const c of this.ctx.combatants()) {
        if (!c.isAlive() || !this.outside(c.position)) continue;
        c.takeDamage({ amount: this.damage * 0.5, part: 'body', attacker: 'The zone', weapon: 'zone', from: c.position.clone() });
      }
    }

    // The end: you died (see your place), or you're the last one standing.
    const me = this.ctx.player;
    const others = this.ctx.bots.aliveCount;
    if (!me.isAlive()) {
      if (this.deadTimer === 0) this.placeAtDeath = others + 1;
      this.deadTimer += dt;
      if (this.deadTimer > 2.5) {
        this.result = {
          title: `You placed #${this.placeAtDeath}`,
          subtitle: `out of ${this.ctx.bots.bots.length + 1}  ·  ${me.killedBy === 'The zone' ? 'Caught outside the zone' : `Eliminated by ${me.killedBy}`}`,
          win: false,
          stats: this.stats(),
        };
      }
    } else if (others === 0) {
      this.result = { title: 'Winner!', subtitle: 'Last one standing', win: true, stats: this.stats() };
    }
  }

  private stats(): string[] {
    const me = this.ctx.player.name;
    return [`Your kills: ${this.ctx.kills.get(me) ?? 0}`, `Survived: ${formatTime(this.ctx.time)}`];
  }

  status(): string {
    const alive = this.ctx.bots.aliveCount + (this.ctx.player.isAlive() ? 1 : 0);
    const kills = this.ctx.kills.get(this.ctx.player.name) ?? 0;
    const zone = this.phase === 'wait' ? `Zone shrinks in ${formatTime(this.timer)}` : this.phase === 'shrink' ? `Zone shrinking ${formatTime(this.timer)}` : 'Final zone';
    return `Alive ${alive}  ·  Kills ${kills}  ·  ${zone}`;
  }

  scoreboard(): ScoreRow[] {
    // Still alive first, then by kills.
    const alive = new Set(this.ctx.combatants().filter((c) => c.isAlive()).map((c) => c.name));
    return scoreRows(this.ctx).sort((a, b) => Number(alive.has(b.name)) - Number(alive.has(a.name)) || b.kills - a.kills);
  }

  markers(): Marker[] {
    const out: Marker[] = [{ x: this.center.x, y: 0, z: this.center.z, label: '', color: ZONE_COLOR, radius: this.radius }];
    if (this.phase === 'wait') out.push({ x: this.nextCenter.x, y: 0, z: this.nextCenter.z, label: '', color: '#ffffff', radius: this.nextRadius });
    return out;
  }

  progress(): ProgressInfo | null {
    const me = this.ctx.player;
    if (!me.isAlive()) return null;
    if (this.outside(me.position)) return { label: 'Outside the zone — get inside!', value: null, color: DANGER };
    if (this.phase === 'wait' && this.outside(me.position, this.nextCenter, this.nextRadius)) return { label: `Move to the next zone · ${formatTime(this.timer)}`, value: null, color: ZONE_COLOR };
    return null;
  }

  botObjective(bot: Bot): BotObjective {
    // Outside (or about to be): head in. Otherwise roam inside the zone.
    const target = this.phase === 'final' ? this.center : this.nextCenter;
    const r = this.phase === 'final' ? this.radius : this.nextRadius;
    const out = this.outside(bot.position, target, r * 0.9);
    if (out) return { pos: target, radius: r * 0.5, urgent: this.outside(bot.position) || this.phase === 'shrink', run: true };
    return { pos: target, radius: Math.max(3, r * 0.8) };
  }
}
