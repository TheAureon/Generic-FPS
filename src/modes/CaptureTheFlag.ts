import * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { MODES, TEAMS } from '../config';
import {
  formatTime, modeLimit, scoreRows, teamLine, teamResult, TIME_LIMIT,
  type BotObjective, type Combatant, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';
import { FlagVisual, placeObjectives, RingVisual } from './objectives';

const S = MODES.ctf;

interface Flag {
  team: number;
  base: THREE.Vector3;
  /** Where the flag is now (on the stand, carried, or lying where it was dropped). */
  pos: THREE.Vector3;
  state: 'home' | 'carried' | 'dropped';
  carrier: Combatant | null;
  /** Seconds until a dropped flag goes home by itself. */
  returnTimer: number;
  visual: FlagVisual;
}

/**
 * Capture the Flag: each team has a flag at its base. Grab the enemy's flag
 * (walk into it) and bring it to your own base while your flag is safe at
 * home. Die while carrying it and you drop it: touching your own dropped
 * flag sends it home (or it goes home by itself after a while).
 */
export class CaptureTheFlag implements GameMode {
  readonly id = 'ctf' as const;
  readonly name = 'Capture the Flag';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Caps';
  result: MatchResult | null = null;

  private flags: Flag[] = [];
  private caps: [number, number] = [0, 0];
  private personal = new Map<string, number>();
  private t = 0;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    const { flags } = placeObjectives(this.ctx.map, this.ctx.nav, this.ctx.sides);
    this.flags = flags.map((base, team) => {
      new RingVisual(this.ctx.scene, this.ctx.world, base, 2, false).setColor(TEAMS.css[team]);
      const f: Flag = { team, base, pos: base.clone(), state: 'home', carrier: null, returnTimer: 0, visual: new FlagVisual(this.ctx.scene, TEAMS.colors[team]) };
      f.visual.group.position.copy(base);
      return f;
    });
    this.ctx.announce('Capture the Flag', `Bring the ${TEAMS.names[1]} flag to your base · first to ${this.limit}`, 3);
  }

  private teamName(t: number): string {
    return t === this.ctx.player.team ? 'Your team' : `${TEAMS.names[t]} team`;
  }

  private sendHome(f: Flag): void {
    f.state = 'home';
    f.carrier = null;
    f.pos.copy(f.base);
  }

  update(dt: number): void {
    if (this.result) return;
    this.t += dt;
    const me = this.ctx.player;

    for (const f of this.flags) {
      if (f.state === 'carried' && f.carrier && !f.carrier.isAlive()) {
        // Carrier died: drop it where they fell.
        f.state = 'dropped';
        f.pos.copy(f.carrier.position);
        f.carrier = null;
        f.returnTimer = S.returnTime;
        this.ctx.announce(`${TEAMS.names[f.team]} flag dropped`, '', 1.8);
      } else if (f.state === 'dropped') {
        f.returnTimer -= dt;
        if (f.returnTimer <= 0) {
          this.sendHome(f);
          this.ctx.announce(`${TEAMS.names[f.team]} flag returned`, '', 1.8);
        }
      }
      if (f.state === 'carried' && f.carrier) f.pos.copy(f.carrier.position);
    }

    for (const c of this.ctx.combatants()) {
      if (!c.isAlive() || c.team === null) continue;
      for (const f of this.flags) {
        const near = Math.hypot(c.position.x - f.pos.x, c.position.z - f.pos.z) < S.touchRadius && Math.abs(c.position.y - f.pos.y) < 2;
        if (!near) continue;
        if (f.team !== c.team && f.state !== 'carried') {
          f.state = 'carried';
          f.carrier = c;
          const you = c === (me as Combatant);
          this.ctx.announce(you ? 'You have the flag!' : `${c.name} has the ${TEAMS.names[f.team]} flag`, you ? 'Bring it back to your base' : '', 2);
          this.ctx.cue(c.team === me.team ? 'good' : 'bad');
        } else if (f.team === c.team && f.state === 'dropped') {
          this.sendHome(f);
          this.ctx.announce(`${TEAMS.names[f.team]} flag returned`, `by ${c.name}`, 1.8);
          this.ctx.cue(c.team === me.team ? 'good' : 'bad');
        }
      }
      // Capture: carrying their flag, at your own base, with your own flag at home.
      const own = this.flags[c.team], theirs = this.flags[1 - c.team];
      if (theirs.carrier === c && own.state === 'home' && Math.hypot(c.position.x - own.base.x, c.position.z - own.base.z) < S.touchRadius + 0.5 && Math.abs(c.position.y - own.base.y) < 2) {
        this.caps[c.team]++;
        this.personal.set(c.name, (this.personal.get(c.name) ?? 0) + 1);
        this.sendHome(theirs);
        this.ctx.announce(`${this.teamName(c.team)} scores!`, `${c.name} captured the ${TEAMS.names[theirs.team]} flag  ·  ${this.caps[0]} – ${this.caps[1]}`, 2.5);
        this.ctx.cue(c.team === me.team ? 'good' : 'bad');
      }
    }

    // Show the flags: on the stand, over the carrier's shoulder, or on the ground.
    for (const f of this.flags) {
      const g = f.visual.group;
      g.visible = !(f.state === 'carried' && f.carrier === (me as Combatant));
      g.position.copy(f.pos);
      if (f.state === 'carried') g.position.y += 0.5;
      f.visual.animate(this.t + f.team);
    }

    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (Math.max(...this.caps) >= this.limit || timeUp) {
      const mine = this.personal.get(me.name) ?? 0;
      this.result = teamResult(this.caps, timeUp, `First to ${this.limit}`, [`Your captures: ${mine}`, `Your kills: ${this.ctx.kills.get(me.name) ?? 0}`, `Match time: ${formatTime(this.ctx.time)}`]);
    }
  }

  teamScores(): [number, number] {
    return this.caps;
  }

  status(): string {
    return `${teamLine(this.caps)}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.personal.get(n) ?? 0);
  }

  markers(): Marker[] {
    return this.flags.map((f) => ({
      x: f.pos.x, y: f.pos.y + 2.4, z: f.pos.z,
      label: f.state === 'home' ? '⚑' : f.state === 'carried' ? '⚑!' : '⚑?',
      color: TEAMS.css[f.team],
      always: true,
    }));
  }

  progress(): ProgressInfo | null {
    const me = this.ctx.player;
    const own = this.flags[me.team ?? 0], theirs = this.flags[1 - (me.team ?? 0)];
    if (theirs?.carrier === (me as Combatant)) {
      return own.state === 'home'
        ? { label: 'You have the flag — bring it to your base!', value: null, color: TEAMS.css[theirs.team] }
        : { label: 'You have the flag — but yours is gone: get it back!', value: null, color: TEAMS.css[theirs.team] };
    }
    if (own && own.state !== 'home') return { label: own.state === 'carried' ? 'Your flag has been taken!' : 'Your flag is down — touch it to return it', value: null, color: TEAMS.css[own.team] };
    return null;
  }

  botObjective(bot: Bot): BotObjective | null {
    if (bot.team === null || !this.flags.length) return null;
    const own = this.flags[bot.team], theirs = this.flags[1 - bot.team];
    const dist = (p: THREE.Vector3) => Math.hypot(p.x - bot.position.x, p.z - bot.position.z);
    // Carrying their flag: home!
    if (theirs.carrier === (bot as Combatant)) return { pos: own.base, radius: 0.6, urgent: true, run: true };
    // A third of each team defends.
    const defender = this.ctx.bots.bots.indexOf(bot) % 3 === 0;
    if (own.state === 'carried' && own.carrier && (defender || dist(own.pos) < 35)) return { pos: own.pos, radius: 2, urgent: true, run: true };
    if (own.state === 'dropped' && (defender || dist(own.pos) < 30)) return { pos: own.pos, radius: 0.5, urgent: true, run: true };
    if (defender) return { pos: own.base, radius: 7, run: dist(own.base) > 15 };
    // Attackers: escort a teammate carrying their flag, else go get it.
    if (theirs.state === 'carried' && theirs.carrier) return { pos: theirs.pos, radius: 6, run: true };
    return { pos: theirs.pos, radius: 0.5, urgent: dist(theirs.pos) < 30, run: true };
  }
}
