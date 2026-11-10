import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import type { Bot } from '../bots/Bot';
import type { NavNode } from '../bots/NavGraph';
import { PARTY_MODES } from '../config';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import { formatTime, scoreRows, type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow } from './GameMode';

const P = PARTY_MODES.prophunt;
/** How far a seeker can spot you, and how long out of sight before they lose you. */
const SPOT_RANGE = 16;
const LOSE_AFTER = 8;
/** Health lost for every shot that hits nothing (when you're the seeker). */
const MISS_PENALTY = 3;
/** Every so often a hidden bot whistles (a hint). */
const WHISTLE_EVERY = 25;

type PropKind = 'barrel' | 'crate' | 'cone' | 'bin' | 'tires';
const KINDS: PropKind[] = ['barrel', 'crate', 'cone', 'bin', 'tires'];
const NAMES: Record<PropKind, string> = { barrel: 'a barrel', crate: 'a crate', cone: 'a traffic cone', bin: 'a trash can', tires: 'a stack of tires' };

/** A simple prop and its height. */
function makeProp(kind: PropKind): { obj: THREE.Group; height: number } {
  const g = new THREE.Group();
  const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  let height = 1;
  switch (kind) {
    case 'barrel': {
      const c = [0x2f5d8a, 0xa8402c, 0x3d6b35][Math.floor(Math.random() * 3)];
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), mat(c, { metalness: 0.4 }), 0.45);
      for (const y of [0.2, 0.7]) add(new THREE.TorusGeometry(0.305, 0.02, 4, 16).rotateX(Math.PI / 2), mat(0x222222), y);
      height = 0.95;
      break;
    }
    case 'crate':
      add(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat(0x8a6238), 0.4);
      add(new THREE.BoxGeometry(0.84, 0.1, 0.84), mat(0x6a4a28), 0.4);
      height = 0.82;
      break;
    case 'cone':
      add(new THREE.ConeGeometry(0.22, 0.7, 12), mat(0xe8601c), 0.4);
      add(new THREE.BoxGeometry(0.45, 0.05, 0.45), mat(0x222222), 0.025);
      add(new THREE.CylinderGeometry(0.135, 0.165, 0.1, 12), mat(0xf2f2f2), 0.42);
      height = 0.75;
      break;
    case 'bin':
      add(new THREE.CylinderGeometry(0.28, 0.24, 0.8, 12), mat(0x5d6670, { metalness: 0.5 }), 0.4);
      add(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12), mat(0x4a525a, { metalness: 0.5 }), 0.83);
      height = 0.88;
      break;
    case 'tires':
      for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.3, 0.12, 8, 16).rotateX(Math.PI / 2), mat(0x1c1c1e, { roughness: 0.9 }), 0.12 + i * 0.22);
      height = 0.75;
      break;
  }
  return { obj: g, height };
}

/**
 * Prop Hunt: two rounds.
 * 1. You hide: you're disguised as a prop (no gun). The bots wait, then
 *    search; one that gets a good look at you (easier if you move, and up
 *    close) spots you and they come shooting. Break line of sight for a
 *    while and they lose you. Survive the round to win it.
 * 2. You seek: the bots run off and hide as props among lots of decoy props
 *    (you can't see while they hide). Shoot them to find them; every shot
 *    that hits nothing costs you a little health. Hidden bots whistle now
 *    and then. Find them all to win the round.
 */
export class PropHunt implements GameMode {
  readonly id = 'prophunt' as const;
  readonly name = 'Prop Hunt';
  readonly teams = false;
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly playerRespawns = false;
  readonly scoreLabel = 'Found';
  readonly removePickups = ['armor'] as const;
  result: MatchResult | null = null;

  /** 0 = you hide, 1 = you seek; phase 'hide' (getting ready), 'play', 'over'. */
  private round = 0;
  private phase: 'hide' | 'play' | 'over' = 'hide';
  private phaseTime = 0;
  private roundWins = [false, false];
  private yourProp: PropKind = 'barrel';
  private spotted = false;
  private outOfSight = 0;
  private spotters = new Map<string, number>();
  private decoys: THREE.Object3D[] = [];
  private hideSpot = new Map<Bot, THREE.Vector3>();
  private searchSpot = new Map<Bot, { p: THREE.Vector3; until: number }>();
  private found = 0;
  private hiders = 0;
  private survivedFor = 0;
  private missed = 0;
  private hitThisShot = false;
  private whistle: { at: THREE.Vector3; until: number } | null = null;
  private nextWhistle = WHISTLE_EVERY;
  private blind: HTMLDivElement | null = null;
  private offs: (() => void)[] = [];

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  /** Spots along walls (where a prop would sit), spread out. */
  private wallSpots(n: number, minGap: number): THREE.Vector3[] {
    const nodes = this.ctx.nav.nodes.filter((x: NavNode) => x.nearWall);
    const pool = nodes.length > 20 ? nodes : this.ctx.nav.nodes;
    const out: THREE.Vector3[] = [];
    for (let tries = 0; tries < n * 30 && out.length < n; tries++) {
      const node = pool[Math.floor(Math.random() * pool.length)];
      const p = new THREE.Vector3(node.x, node.y, node.z);
      if (out.every((q) => q.distanceTo(p) >= minGap)) out.push(p);
    }
    return out;
  }

  start(): void {
    // Decoy props all over the map (the same kinds the hiders use).
    for (const p of this.wallSpots(P.decoys, 4)) {
      const { obj } = makeProp(KINDS[Math.floor(Math.random() * KINDS.length)]);
      obj.position.copy(p);
      obj.rotation.y = Math.random() * Math.PI * 2;
      this.ctx.scene.add(obj);
      this.decoys.push(obj);
    }
    rules.canTarget = (_a, v) => this.round === 0 && this.phase === 'play' && this.spotted && v === this.ctx.player.name;
    rules.grenades = () => false;
    this.offs.push(
      // Seeking: shots that hit nothing cost health. (A shot's hits are
      // announced before the shot itself.)
      events.on('damage', (e) => {
        if (e.attacker === this.ctx.player.name && e.victim !== e.attacker) this.hitThisShot = true;
      }),
      events.on('shot', (e) => {
        if (e.shooter !== this.ctx.player.name) return;
        if (this.round === 1 && this.phase === 'play' && !this.hitThisShot) this.missed++;
        this.hitThisShot = false;
      }),
      events.on('kill', (e) => {
        const b = this.ctx.bots.bots.find((x) => x.name === e.victim);
        if (!b || this.round !== 1) return;
        b.disguise(null);
        this.found++;
        if (e.killer === this.ctx.player.name) this.ctx.award('Hider found', 100);
      }),
    );
    this.startRound(0);
  }

  dispose(): void {
    for (const o of this.offs) o();
    for (const d of this.decoys) d.removeFromParent();
    for (const b of this.ctx.bots.bots) b.disguise(null);
    this.ctx.weapons.holstered = false;
    this.blind?.remove();
  }

  private startRound(r: number): void {
    this.round = r;
    this.phase = 'hide';
    this.phaseTime = 0;
    this.spotted = false;
    this.spotters.clear();
    for (const c of this.ctx.combatants()) this.ctx.respawn(c);
    for (const b of this.ctx.bots.bots) {
      b.disguise(null);
      b.frozen = r === 0; // seekers wait while you hide
    }
    if (r === 0) {
      this.yourProp = KINDS[Math.floor(Math.random() * KINDS.length)];
      this.ctx.weapons.holstered = true;
      this.ctx.announce('Hide!', `You're ${NAMES[this.yourProp]}. The bots start looking in ${P.hideTime} seconds`, 3);
    } else {
      this.ctx.weapons.holstered = false;
      // Each bot runs for a spot along a wall, away from you.
      const me = this.ctx.player.position;
      const spots = this.wallSpots(this.ctx.bots.bots.length * 4, 6).sort((a, b) => b.distanceTo(me) - a.distanceTo(me));
      this.ctx.bots.bots.forEach((b, i) => this.hideSpot.set(b, spots[i % Math.max(1, spots.length)] ?? b.position.clone()));
      this.hiders = this.ctx.bots.bots.length;
      this.found = 0;
      this.nextWhistle = WHISTLE_EVERY;
      this.blind = document.createElement('div');
      this.blind.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,12,0.94);z-index:40;display:flex;align-items:center;justify-content:center;color:#e8e2cf;font:600 28px Rajdhani,sans-serif;letter-spacing:.06em;pointer-events:none;text-align:center';
      document.body.appendChild(this.blind);
      this.ctx.announce('Your turn to seek', `The bots are hiding as props. Missed shots cost ${MISS_PENALTY} health`, 3);
    }
    this.ctx.refreshTeams();
    this.ctx.cue('info');
  }

  private endRound(won: boolean, why: string): void {
    this.roundWins[this.round] = won;
    this.phase = 'over';
    this.phaseTime = 0;
    this.ctx.announce(won ? 'Round won' : 'Round lost', why, 3);
    this.ctx.cue(won ? 'good' : 'bad');
    if (won) this.ctx.award('Prop Hunt round won', 250);
    if (this.round === 1) this.finish();
  }

  private finish(): void {
    const n = this.roundWins.filter(Boolean).length;
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    this.result = {
      title: n === 2 ? 'You won both rounds!' : n === 1 ? 'You won a round' : 'The props win',
      subtitle: `Hiding: ${this.roundWins[0] ? 'survived' : 'found'}  ·  Seeking: found ${this.found} of ${this.hiders}`,
      win: n >= 1,
      stats: [`You hid for ${formatTime(this.survivedFor)}`, `Hiders you found: ${me.kills}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  update(dt: number): void {
    if (this.result) return;
    this.phaseTime += dt;
    if (this.phase === 'over') {
      if (this.phaseTime > 4 && this.round === 0) this.startRound(1);
      return;
    }
    return this.round === 0 ? this.updateHiding(dt) : this.updateSeeking(dt);
  }

  /** Round 1: you hide, they seek. */
  private updateHiding(dt: number): void {
    const me = this.ctx.player;
    if (this.phase === 'hide') {
      if (this.phaseTime >= P.hideTime) {
        this.phase = 'play';
        this.phaseTime = 0;
        for (const b of this.ctx.bots.bots) b.frozen = false;
        this.ctx.announce('Ready or not…', 'The bots are looking for you', 2);
        this.ctx.cue('bad');
      }
      return;
    }
    if (!me.isAlive()) return this.endRound(false, `Found after ${formatTime(this.phaseTime)}`);
    this.survivedFor = this.phaseTime;
    if (this.phaseTime >= P.roundTime) return this.endRound(true, 'They never found you');

    // Seekers that can see you may notice you: more likely up close, and much more if you move.
    const moving = Math.hypot(me.velocity.x, me.velocity.z) > 0.8;
    const eye = me.position.clone().setY(me.position.y + 0.6);
    let seen = false;
    for (const b of this.ctx.bots.bots) {
      if (!b.isAlive()) continue;
      const d = b.position.distanceTo(me.position);
      if (d > SPOT_RANGE) continue;
      const e = b.eyePosition();
      if (!this.ctx.world.hasLineOfSight(e.x, e.y, e.z, eye.x, eye.y, eye.z)) continue;
      seen = true;
      if (this.spotted) continue;
      const close = 1 - d / SPOT_RANGE;
      const rate = (moving ? 1.2 : 0.1) * close * close + (d < 2.5 ? 1.5 : 0);
      const t = (this.spotters.get(b.name) ?? 0) + rate * dt;
      this.spotters.set(b.name, t);
      if (t >= 1) {
        this.spotted = true;
        this.outOfSight = 0;
        this.ctx.refreshTeams();
        this.ctx.announce(`${b.name} spotted you!`, 'Run!', 1.6);
        this.ctx.cue('bad');
      }
    }
    if (this.spotted) {
      this.outOfSight = seen ? 0 : this.outOfSight + dt;
      if (this.outOfSight >= LOSE_AFTER) {
        this.spotted = false;
        this.spotters.clear();
        this.ctx.refreshTeams();
        this.ctx.announce('They lost you', 'Find a new spot', 1.6);
        this.ctx.cue('good');
      }
    }
  }

  /** Round 2: they hide, you seek. */
  private updateSeeking(dt: number): void {
    const me = this.ctx.player;
    if (this.phase === 'hide') {
      if (this.blind) this.blind.textContent = `The props are hiding…  ${Math.ceil(P.hideTime - this.phaseTime)}`;
      // Hiders that reach their spot turn into a prop on the spot.
      for (const b of this.ctx.bots.bots) {
        const s = this.hideSpot.get(b);
        if (!b.disguised && s && b.position.distanceTo(s) < 1.2) this.hide(b);
      }
      if (this.phaseTime >= P.hideTime) {
        for (const b of this.ctx.bots.bots) if (!b.disguised) this.hide(b);
        this.blind?.remove();
        this.blind = null;
        this.phase = 'play';
        this.phaseTime = 0;
        this.ctx.announce('Find them!', `${this.hiders} props are hiding`, 2);
      }
      return;
    }
    // Missed shots hurt.
    if (this.missed > 0 && me.isAlive()) {
      me.takeDamage({ amount: MISS_PENALTY * this.missed, part: 'body', attacker: me.name, weapon: 'pistol', from: me.position.clone() });
      this.missed = 0;
    }
    if (this.whistle && this.ctx.time > this.whistle.until) this.whistle = null;
    this.nextWhistle -= dt;
    if (this.nextWhistle <= 0) {
      this.nextWhistle = WHISTLE_EVERY;
      const left = this.ctx.bots.bots.filter((b) => b.isAlive());
      const w = left[Math.floor(Math.random() * left.length)];
      if (w) {
        audio.play('objective_info', { position: w.position });
        this.whistle = { at: w.position.clone(), until: this.ctx.time + 2.5 };
      }
    }
    const left = this.ctx.bots.bots.filter((b) => b.isAlive()).length;
    if (left === 0) return this.endRound(true, `You found all ${this.hiders} in ${formatTime(this.phaseTime)}`);
    if (!me.isAlive()) return this.endRound(false, 'Missed shots wore you down');
    if (this.phaseTime >= P.roundTime) return this.endRound(false, `${left} prop${left === 1 ? '' : 's'} stayed hidden`);
  }

  private hide(b: Bot): void {
    const { obj, height } = makeProp(KINDS[Math.floor(Math.random() * KINDS.length)]);
    obj.rotation.y = Math.random() * Math.PI * 2;
    b.frozen = true;
    b.disguise(obj, height);
  }

  /** Seekers wander between search spots; hiders run to their hiding spot. */
  botObjective(bot: Bot): BotObjective | null {
    if (this.round === 1) {
      const s = this.hideSpot.get(bot);
      return s && this.phase === 'hide' ? { pos: s, radius: 0.4, urgent: true, run: true } : null;
    }
    if (this.phase !== 'play' || this.spotted) return null;
    let s = this.searchSpot.get(bot);
    if (!s || this.ctx.time > s.until || bot.position.distanceTo(s.p) < 2) {
      const n = this.ctx.nav.randomNode();
      s = { p: new THREE.Vector3(n.x, n.y, n.z), until: this.ctx.time + 15 };
      this.searchSpot.set(bot, s);
    }
    return { pos: s.p, radius: 1.5 };
  }

  markers(): Marker[] {
    return this.whistle ? [{ x: this.whistle.at.x, y: this.whistle.at.y + 1.2, z: this.whistle.at.z, label: '♪', color: '#ffd35a', always: true }] : [];
  }

  progress(): ProgressInfo | null {
    if (this.round !== 0 || this.phase === 'over' || !this.ctx.player.isAlive()) return null;
    if (this.spotted) return { label: 'Spotted! Break their line of sight', value: null, color: '#ff5a4a' };
    const worst = Math.max(0, ...this.spotters.values());
    return { label: `Hidden as ${NAMES[this.yourProp]}`, value: worst > 0.05 ? worst : null, color: worst > 0.5 ? '#ffb04a' : '#9fd6a0' };
  }

  status(): string {
    const t = this.phase === 'hide' ? P.hideTime - this.phaseTime : P.roundTime - this.phaseTime;
    if (this.phase === 'over') return this.round === 0 ? 'Next: you seek…' : 'Prop Hunt';
    if (this.round === 0) return this.phase === 'hide' ? `Hide!  ·  Seekers come in ${Math.ceil(t)}` : `Stay hidden  ·  ${formatTime(t)}`;
    const left = this.ctx.bots.bots.filter((b) => b.isAlive()).length;
    return this.phase === 'hide' ? `The props are hiding  ·  ${Math.ceil(t)}` : `${left} prop${left === 1 ? '' : 's'} left  ·  ${formatTime(t)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => (n === this.ctx.player.name ? this.found : 0));
  }
}
