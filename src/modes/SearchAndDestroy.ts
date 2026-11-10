import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import type { Bot } from '../bots/Bot';
import { PARTY_MODES, TEAMS } from '../config';
import type { SpawnPoint } from '../map/MapTypes';
import {
  formatTime, modeLimit, scoreRows, teamLine,
  type BotObjective, type Combatant, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';
import { inRing, RingVisual, snapToOpen } from './objectives';

const S = PARTY_MODES.snd;

type Phase = 'live' | 'planted' | 'over';

/**
 * Search & Destroy (teams, rounds): one life per round. The attackers plant
 * the bomb at site A or B (stand in it a few seconds); the defenders stop
 * them, or defuse the bomb before it goes off. Kill the whole other team to
 * win the round too. Sides swap every round; first to the round limit wins.
 */
export class SearchAndDestroy implements GameMode {
  readonly id = 'snd' as const;
  readonly name = 'Search & Destroy';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly playerRespawns = false;
  readonly scoreLabel = 'Plants';
  readonly noRespawnNote = 'Waiting for the next round';
  result: MatchResult | null = null;

  /** Each team's two bomb sites (near its own side: where it defends). */
  private sites: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
  private rings: RingVisual[] = [];
  private round = 0;
  private phase: Phase = 'over';
  private phaseTime = 0;
  private wins: [number, number] = [0, 0];
  private plant = [0, 0];
  private defuse = 0;
  private bombAt: THREE.Vector3 | null = null;
  private bombSite = 0;
  private bomb: THREE.Group;
  private bombLight: THREE.Mesh;
  private beep = 0;
  /** Where most attacking bots go this round. */
  private rush = 0;
  private plants = new Map<string, number>();
  private yourPlants = 0;
  private yourDefuses = 0;

  constructor(private ctx: ModeContext) {
    this.bomb = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.22), new THREE.MeshStandardMaterial({ color: 0x3a3f2a, roughness: 0.7 }));
    body.position.y = 0.07;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: 0x15171a }));
    pad.position.set(0.05, 0.15, 0);
    this.bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.bombLight.position.set(-0.1, 0.16, 0);
    this.bomb.add(body, pad, this.bombLight);
    this.bomb.visible = false;
    ctx.scene.add(this.bomb);
  }

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  /** Who attacks this round. */
  private get attackers(): number {
    return this.round % 2 === 0 ? 0 : 1;
  }
  private get defenders(): number {
    return 1 - this.attackers;
  }
  private get liveSites(): THREE.Vector3[] {
    return this.sites[this.defenders];
  }

  start(): void {
    const mid = (ps: SpawnPoint[]) => ps.reduce((c, p) => c.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).divideScalar(Math.max(1, ps.length));
    const ends = [mid(this.ctx.sides[0]), mid(this.ctx.sides[1])];
    for (const t of [0, 1]) {
      const a = ends[t], b = ends[1 - t];
      const dx = b.x - a.x, dz = b.z - a.z;
      this.sites[t] = [-1, 1].map((side) => snapToOpen(this.ctx.nav, a.x + dx * 0.3 - dz * 0.22 * side, a.z + dz * 0.3 + dx * 0.22 * side));
    }
    this.rings = [...this.sites[0], ...this.sites[1]].map((p) => new RingVisual(this.ctx.scene, this.ctx.world, p, S.siteRadius, false));
    this.startRound();
  }

  dispose(): void {
    this.bomb.removeFromParent();
  }

  private startRound(): void {
    this.phase = 'live';
    this.phaseTime = 0;
    this.plant = [0, 0];
    this.defuse = 0;
    this.bombAt = null;
    this.bomb.visible = false;
    this.rush = Math.random() < 0.5 ? 0 : 1;
    for (const c of this.ctx.combatants()) this.ctx.respawn(c);
    this.rings.forEach((r, i) => {
      const own = Math.floor(i / 2) === this.defenders;
      r.visible = own;
      r.setColor('#ffcf5a');
    });
    const you = this.ctx.player.team === this.attackers;
    this.ctx.announce(`Round ${this.round + 1}`, you ? 'Attack: plant the bomb at A or B' : 'Defend sites A and B', 2.5);
    this.ctx.cue('info');
  }

  private team(t: number): Combatant[] {
    return this.ctx.combatants().filter((c) => c.team === t);
  }

  private alive(t: number): number {
    return this.team(t).filter((c) => c.isAlive()).length;
  }

  private endRound(winner: number, why: string): void {
    this.phase = 'over';
    this.phaseTime = 0;
    this.wins[winner]++;
    const ours = winner === this.ctx.player.team;
    this.ctx.announce(ours ? 'Round won' : 'Round lost', `${why}  ·  ${TEAMS.names[0]} ${this.wins[0]} – ${this.wins[1]} ${TEAMS.names[1]}`, 3);
    this.ctx.cue(ours ? 'good' : 'bad');
    if (ours) this.ctx.award('Round won', 150);
    if (this.wins[winner] >= this.limit) {
      const me = this.scoreboard().find((r) => r.isPlayer)!;
      const win = ours;
      this.result = {
        title: win ? 'Your team wins!' : `${TEAMS.names[winner]} team wins`,
        subtitle: `Rounds: ${TEAMS.names[0]} ${this.wins[0]} – ${this.wins[1]} ${TEAMS.names[1]}`,
        win,
        stats: [`Your kills: ${me.kills}`, `Bombs you planted: ${this.yourPlants}`, `Bombs you defused: ${this.yourDefuses}`, `Rounds played: ${this.round + 1}`, `Match time: ${formatTime(this.ctx.time)}`],
      };
    }
  }

  update(dt: number): void {
    if (this.result) return;
    this.phaseTime += dt;
    if (this.phase === 'over') {
      if (this.phaseTime >= S.intermission) {
        this.round++;
        this.startRound();
      }
      return;
    }
    const att = this.attackers, def = this.defenders;
    const people = this.ctx.combatants().filter((c) => c.isAlive());

    if (this.phase === 'live') {
      // Planting: an attacker standing in a site (with no defender in it).
      this.liveSites.forEach((site, i) => {
        const a = people.filter((c) => c.team === att && inRing(c.position, site, S.siteRadius));
        const d = people.some((c) => c.team === def && inRing(c.position, site, S.siteRadius));
        this.plant[i] = a.length && !d ? this.plant[i] + dt : Math.max(0, this.plant[i] - dt * 2);
        if (this.plant[i] >= S.plantTime) {
          this.phase = 'planted';
          this.phaseTime = 0;
          this.bombSite = i;
          const planter = a.reduce((m, c) => (c.position.distanceTo(site) < m.position.distanceTo(site) ? c : m), a[0]);
          this.bombAt = planter.position.clone();
          this.bomb.position.copy(this.bombAt);
          this.bomb.visible = true;
          this.plants.set(planter.name, (this.plants.get(planter.name) ?? 0) + 1);
          if (planter === this.ctx.player) {
            this.yourPlants++;
            this.ctx.award('Bomb planted', 100);
          }
          const ours = att === this.ctx.player.team;
          this.ctx.announce(`Bomb planted at ${'AB'[i]}`, ours ? 'Defend it' : `Defuse it in ${S.bombTime} seconds`, 2.2);
          this.ctx.cue(ours ? 'good' : 'bad');
        }
      });
      if (this.phase === 'live') {
        if (this.alive(att) === 0) return this.endRound(def, 'The attackers were wiped out');
        if (this.alive(def) === 0) return this.endRound(att, 'The defenders were wiped out');
        if (this.phaseTime >= S.roundTime) return this.endRound(def, 'Time ran out');
      }
      return;
    }

    // Planted: tick, defuse, or boom.
    const at = this.bombAt!;
    const left = S.bombTime - this.phaseTime;
    this.beep -= dt;
    if (this.beep <= 0) {
      this.beep = Math.max(0.15, left / S.bombTime);
      audio.play('tick', { position: at, volume: 0.8 });
      this.bombLight.visible = true;
    } else if (this.beep < 0.08) this.bombLight.visible = false;
    const defusers = people.filter((c) => c.team === def && c.position.distanceTo(at) < 2);
    this.defuse = defusers.length ? this.defuse + dt : 0;
    if (this.defuse >= S.defuseTime) {
      if (defusers.includes(this.ctx.player)) {
        this.yourDefuses++;
        this.ctx.award('Bomb defused', 150);
      }
      this.bomb.visible = false;
      return this.endRound(def, 'The bomb was defused');
    }
    if (left <= 0) {
      this.bomb.visible = false;
      this.ctx.explode(at.clone().setY(at.y + 0.3), S.blastRadius, 300, 'Bomb');
      return this.endRound(att, 'The bomb went off');
    }
    if (this.alive(def) === 0) return this.endRound(att, 'The defenders were wiped out');
  }

  teamScores(): [number, number] {
    return this.wins;
  }

  status(): string {
    const you = this.ctx.player.team === this.attackers ? 'Attack' : 'Defend';
    let clock = '';
    if (this.phase === 'live') clock = formatTime(S.roundTime - this.phaseTime);
    else if (this.phase === 'planted') clock = `Bomb at ${'AB'[this.bombSite]}: ${formatTime(S.bombTime - this.phaseTime)}`;
    else clock = 'Next round…';
    return `Round ${this.round + 1}  ·  ${you}  ·  ${teamLine(this.wins)}  ·  ${clock}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.plants.get(n) ?? 0);
  }

  markers(): Marker[] {
    const out: Marker[] = this.liveSites.map((p, i) => ({ x: p.x, y: p.y, z: p.z, label: 'AB'[i], color: '#ffcf5a', always: true, radius: S.siteRadius }));
    if (this.phase === 'planted' && this.bombAt) out.push({ x: this.bombAt.x, y: this.bombAt.y + 0.8, z: this.bombAt.z, label: '💣', color: '#ff4a3a', always: true });
    return out;
  }

  progress(): ProgressInfo | null {
    const me = this.ctx.player;
    if (!me.isAlive()) return null;
    if (this.phase === 'live' && me.team === this.attackers) {
      const i = this.liveSites.findIndex((s) => inRing(me.position, s, S.siteRadius));
      if (i >= 0) return { label: `Planting at ${'AB'[i]}`, value: this.plant[i] / S.plantTime, color: '#ffcf5a' };
    }
    if (this.phase === 'planted' && me.team === this.defenders && this.bombAt && me.position.distanceTo(this.bombAt) < 2) {
      return { label: 'Defusing', value: this.defuse / S.defuseTime, color: '#5ad1ff' };
    }
    return null;
  }

  botObjective(bot: Bot): BotObjective | null {
    if (bot.team === null || this.phase === 'over') return null;
    const i = this.ctx.bots.bots.indexOf(bot);
    const d = (p: THREE.Vector3) => Math.hypot(p.x - bot.position.x, p.z - bot.position.z);
    if (this.phase === 'planted' && this.bombAt) {
      // Defenders rush the bomb; attackers guard it.
      if (bot.team === this.defenders) return { pos: this.bombAt, radius: 1, urgent: true, run: true };
      return { pos: this.bombAt, radius: 7, run: d(this.bombAt) > 12 };
    }
    if (bot.team === this.attackers) {
      // Most go for the same site; one in three tries the other.
      const site = this.liveSites[i % 3 === 2 ? 1 - this.rush : this.rush];
      return { pos: site, radius: 0.8, urgent: d(site) < 25, run: true };
    }
    // Defenders split between the two sites and hold there.
    const site = this.liveSites[i % 2];
    return { pos: site, radius: 5, run: d(site) > 15 };
  }
}
