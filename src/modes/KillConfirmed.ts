import * as THREE from 'three';
import { PARTY_MODES, TEAMS } from '../config';
import { events } from '../core/events';
import type { Bot } from '../bots/Bot';
import {
  formatTime, modeLimit, scoreRows, teamLine, teamResult, TIME_LIMIT,
  type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ScoreRow,
} from './GameMode';

const K = PARTY_MODES.killconfirmed;

interface Tag {
  /** The team of whoever dropped it. */
  team: number;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  age: number;
}

/**
 * Kill Confirmed (teams): every death drops a dog tag. Grab an enemy's tag
 * to confirm the kill (a point for your team); grab a teammate's to deny the
 * enemy theirs. Tags vanish after a while. First team to the limit wins.
 */
export class KillConfirmed implements GameMode {
  readonly id = 'killconfirmed' as const;
  readonly name = 'Kill Confirmed';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Tags';
  result: MatchResult | null = null;
  private tags: Tag[] = [];
  private score: [number, number] = [0, 0];
  /** Tags picked up (confirmed + denied), by name. */
  private picked = new Map<string, number>();
  private confirmed = 0;
  private denied = 0;
  private off: () => void = () => {};
  private tagGeo = new THREE.BoxGeometry(0.22, 0.32, 0.03);
  private tagMats = TEAMS.colors.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 }));
  private chainMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 });

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    this.off = events.on('kill', (e) => {
      if (e.killer === e.victim) return;
      const v = this.ctx.combatants().find((c) => c.name === e.victim);
      if (v && v.team !== null) this.drop(v.team, v.position);
    });
    this.ctx.announce('Kill Confirmed', `Grab enemy tags to score. First team to ${this.limit} wins`, 3);
  }

  dispose(): void {
    this.off();
    for (const t of this.tags) t.mesh.removeFromParent();
    this.tagGeo.dispose();
  }

  teamScores(): [number, number] {
    return this.score;
  }

  private drop(team: number, at: THREE.Vector3): void {
    const mesh = new THREE.Group();
    const tag = new THREE.Mesh(this.tagGeo, this.tagMats[team]);
    const tag2 = tag.clone();
    tag2.position.set(0.05, -0.04, -0.02);
    tag2.rotation.z = 0.3;
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 4, 16), this.chainMat);
    chain.position.y = 0.2;
    mesh.add(tag, tag2, chain);
    const pos = at.clone();
    pos.y += 0.9;
    mesh.position.copy(pos);
    this.ctx.scene.add(mesh);
    this.tags.push({ team, pos, mesh, age: 0 });
  }

  update(dt: number): void {
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const t = this.tags[i];
      t.age += dt;
      t.mesh.rotation.y += dt * 2.5;
      t.mesh.position.y = t.pos.y + Math.sin(t.age * 3) * 0.08;
      // Blink in the last few seconds.
      t.mesh.visible = t.age < K.tagLife - 4 || Math.floor(t.age * 6) % 2 === 0;
      let gone = t.age >= K.tagLife;
      if (!gone) {
        for (const c of this.ctx.combatants()) {
          if (!c.isAlive() || c.team === null) continue;
          if (Math.hypot(c.position.x - t.pos.x, c.position.z - t.pos.z) > K.touchRadius || Math.abs(c.position.y + 0.9 - t.pos.y) > 2) continue;
          this.pickUp(c.name, c.team, t.team);
          gone = true;
          break;
        }
      }
      if (gone) {
        t.mesh.removeFromParent();
        (t.mesh.children[2] as THREE.Mesh).geometry.dispose();
        this.tags.splice(i, 1);
      }
    }

    if (this.result) return;
    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (Math.max(...this.score) < this.limit && !timeUp) return;
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    this.result = teamResult(this.score, timeUp, `First to ${this.limit} confirmed kills`, [
      `Your kills: ${me.kills}`,
      `Kills you confirmed: ${this.confirmed}`,
      `Kills you denied: ${this.denied}`,
      `Match time: ${formatTime(this.ctx.time)}`,
    ]);
  }

  private pickUp(name: string, pickerTeam: number, tagTeam: number): void {
    this.picked.set(name, (this.picked.get(name) ?? 0) + 1);
    const mine = name === this.ctx.player.name;
    if (pickerTeam !== tagTeam) {
      this.score[pickerTeam]++;
      if (mine) {
        this.confirmed++;
        this.ctx.award('Kill confirmed', 50);
        this.ctx.cue('good');
      }
    } else if (mine) {
      this.denied++;
      this.ctx.award('Kill denied', 25);
      this.ctx.cue('info');
    }
  }

  markers(): Marker[] {
    return this.tags.map((t) => ({ x: t.pos.x, y: t.pos.y + 0.3, z: t.pos.z, label: '', color: TEAMS.css[t.team] }));
  }

  /** Bots grab tags near them: enemy tags to confirm, their own to deny. */
  botObjective(bot: Bot): BotObjective | null {
    let best: Tag | null = null;
    let bestD = 22;
    for (const t of this.tags) {
      const d = bot.position.distanceTo(t.pos);
      // Their own team's tags matter a bit less.
      const score = t.team === bot.team ? d * 1.4 : d;
      if (score < bestD) {
        bestD = score;
        best = t;
      }
    }
    if (!best) return null;
    return { pos: best.pos.clone().setY(best.pos.y - 0.9), radius: 0.6, run: true, urgent: bestD < 8 };
  }

  status(): string {
    return `${teamLine(this.score)}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.picked.get(n) ?? 0);
  }
}
