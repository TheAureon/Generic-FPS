import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { createWorldWeaponModel } from '../assets/weaponModels';
import type { Bot } from '../bots/Bot';
import type { NavNode } from '../bots/NavGraph';
import { BOT_DIFFICULTY, PARTY_MODES, WEAPONS, type WeaponId } from '../config';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import { formatTime, scoreRows, type BotObjective, type Combatant, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow } from './GameMode';

const Z = PARTY_MODES.zombies;
type PerkId = keyof typeof Z.perks;
const ALLY = 0;
const ZOMBIE = 1;
const GLOW = new THREE.Color(0.012, 0.035, 0.0);
const SHORT_GUN: Partial<Record<WeaponId, string>> = { smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper', lmg: 'LMG' };
const SHORT_PERK: Record<PerkId, string> = { tough: 'Tough', quick: 'Quick', doubletap: 'Dbl Tap' };
/** How close you have to be to a station to buy (meters). */
const BUY_RANGE = 2.2;

interface Station {
  kind: 'gun' | 'perk';
  id: WeaponId | PerkId;
  name: string;
  price: number;
  pos: THREE.Vector3;
  obj: THREE.Group;
  spin?: THREE.Object3D;
}

/**
 * Zombies (co-op): you and two bot allies against endless waves of zombies.
 * Zombies have no guns: they run at you and claw. Each wave has more of
 * them, and they get tougher and faster. Hits and kills earn points; spend
 * them at stations around the map (walk up and press F): guns (buy one you
 * have to refill its ammo for half price) and perks. If you go down, you're
 * back at the start of the next wave as long as an ally is still standing;
 * if everyone is down, it's over.
 */
export class Zombies implements GameMode {
  readonly id = 'zombies' as const;
  readonly name = 'Zombies';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly playerRespawns = false;
  readonly noRespawnNote = 'Down! You’re back next wave if an ally survives';
  readonly scoreLabel = 'Points';
  result: MatchResult | null = null;

  private wave = 0;
  private waveActive = false;
  private intermission = 5;
  /** Zombies still to come this wave (not yet on the map). */
  private toSpawn = 0;
  private points = 0;
  private earned = new Map<string, number>();
  private owned: WeaponId[] = ['pistol'];
  private perks = new Set<PerkId>();
  private stations: Station[] = [];
  private zombies: Bot[] = [];
  private allies: Bot[] = [];
  private overTimer = 0;
  private offs: (() => void)[] = [];
  private flash: { text: string; until: number } | null = null;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return Z.allies;
  }

  teamOf(): number {
    return ALLY;
  }

  private get firstWave(): number {
    return Math.max(3, this.ctx.config.botCount);
  }

  private waveSize(n: number): number {
    return this.firstWave + (n - 1) * Z.extraPerWave;
  }

  private isZombie(name: string): boolean {
    return this.zombies.some((z) => z.name === name);
  }

  start(): void {
    this.allies = [...this.ctx.bots.bots];
    this.ctx.loadout(this.ctx.player, this.owned, { grenades: 2 });
    rules.damage = (attacker, victim, amount) => {
      if (this.isZombie(victim)) {
        const tough = 1 + 0.18 * (this.wave - 1);
        return (amount * (attacker === this.ctx.player.name && this.perks.has('doubletap') ? 1.4 : 1)) / tough;
      }
      if (victim === this.ctx.player.name && this.perks.has('tough')) return amount * 0.65;
      return amount;
    };
    rules.speed = (name) => {
      if (this.isZombie(name)) return Math.min(1.25, 0.8 + 0.05 * this.wave);
      if (name === this.ctx.player.name && this.perks.has('quick')) return 1.12;
      return 1;
    };
    rules.grenades = (name) => !this.isZombie(name);
    this.offs.push(
      events.on('damage', (e) => {
        if (e.attacker === this.ctx.player.name && this.isZombie(e.victim) && !e.killed) this.earn(Z.points.hit);
      }),
      events.on('kill', (e) => {
        if (!this.isZombie(e.victim) || e.killer !== this.ctx.player.name) return;
        this.earn(Z.points.kill + (e.headshot ? Z.points.headshot : 0));
      }),
    );
    this.placeStations();
    this.ctx.announce('Zombies', 'Hold out with your allies. Kills earn points: buy guns and perks with F', 3.5);
  }

  dispose(): void {
    for (const o of this.offs) o();
    for (const s of this.stations) s.obj.removeFromParent();
  }

  private earn(n: number): void {
    this.points += n;
    this.earned.set(this.ctx.player.name, (this.earned.get(this.ctx.player.name) ?? 0) + n);
  }

  // ---- Stations ----------------------------------------------------------------------------------

  private placeStations(): void {
    const nodes = this.ctx.nav.nodes.filter((n: NavNode) => n.nearWall);
    const pool = nodes.length > 20 ? nodes : this.ctx.nav.nodes;
    const spots: THREE.Vector3[] = [];
    const want = Object.keys(Z.guns).length + Object.keys(Z.perks).length;
    // Spread out: as far from the others as possible (a few random tries each).
    for (let i = 0; i < want; i++) {
      let best: THREE.Vector3 | null = null, bestD = -1;
      for (let k = 0; k < 40; k++) {
        const n = pool[Math.floor(Math.random() * pool.length)];
        const p = new THREE.Vector3(n.x, n.y, n.z);
        const d = spots.length ? Math.min(...spots.map((q) => q.distanceTo(p))) : 99;
        if (d > bestD) { bestD = d; best = p; }
      }
      spots.push(best!);
    }
    let i = 0;
    for (const [id, price] of Object.entries(Z.guns) as [WeaponId, number][]) {
      const obj = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 }));
      base.position.y = 0.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.54), new THREE.MeshStandardMaterial({ color: 0x5ad1ff, emissive: 0x5ad1ff, emissiveIntensity: 1.2 }));
      top.position.y = 1.02;
      const spin = new THREE.Group();
      const gun = createWorldWeaponModel(id);
      gun.rotation.y = Math.PI / 2;
      spin.add(gun);
      spin.position.y = 1.45;
      obj.add(base, top, spin);
      obj.position.copy(spots[i++]);
      this.ctx.scene.add(obj);
      this.stations.push({ kind: 'gun', id, name: WEAPONS[id].name, price, pos: obj.position, obj, spin });
    }
    for (const [id, p] of Object.entries(Z.perks) as [PerkId, (typeof Z.perks)[PerkId]][]) {
      const obj = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.7), new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.55), roughness: 0.45, metalness: 0.3 }));
      body.position.y = 0.95;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.05), new THREE.MeshStandardMaterial({ color: 0x202020, emissive: p.color, emissiveIntensity: 0.9 }));
      glass.position.set(0, 1.2, 0.36);
      obj.add(body, glass);
      obj.position.copy(spots[i++]);
      // Face the open side (away from the nearest wall: toward the map's middle).
      obj.lookAt(this.ctx.playBounds.getCenter(new THREE.Vector3()).setY(obj.position.y));
      this.ctx.scene.add(obj);
      this.stations.push({ kind: 'perk', id, name: p.name, price: p.price, pos: obj.position, obj });
    }
  }

  /** The station you're standing at, if any. */
  private nearStation(): Station | null {
    const me = this.ctx.player;
    if (!me.isAlive()) return null;
    let best: Station | null = null, bestD = BUY_RANGE;
    for (const s of this.stations) {
      const d = Math.hypot(s.pos.x - me.position.x, s.pos.z - me.position.z);
      if (d < bestD && Math.abs(s.pos.y - me.position.y) < 2) { bestD = d; best = s; }
    }
    return best;
  }

  private priceFor(s: Station): number | null {
    if (s.kind === 'perk') return this.perks.has(s.id as PerkId) ? null : s.price;
    return this.owned.includes(s.id as WeaponId) ? Math.round(s.price / 2) : s.price;
  }

  private buy(s: Station): void {
    const price = this.priceFor(s);
    if (price === null) return;
    if (this.points < price) {
      audio.play('dry_fire');
      this.flash = { text: `Not enough points (${price.toLocaleString('en-US')} needed)`, until: this.ctx.time + 1.5 };
      return;
    }
    this.points -= price;
    audio.play('pickup');
    if (s.kind === 'perk') {
      this.perks.add(s.id as PerkId);
      const p = Z.perks[s.id as PerkId];
      this.ctx.announce(p.name, `You ${p.info}`, 2);
    } else {
      const id = s.id as WeaponId;
      const fresh = !this.owned.includes(id);
      this.owned = [id, ...this.owned.filter((w) => w !== id)];
      // (Every gun you own gets full ammo; the new one goes in your hands.)
      this.ctx.loadout(this.ctx.player, this.owned, { grenades: Math.max(2, this.ctx.weapons.grenades) });
      this.flash = { text: fresh ? `Bought the ${s.name}` : 'Ammo refilled', until: this.ctx.time + 1.5 };
    }
    this.ctx.cue('good');
  }

  // ---- Waves -----------------------------------------------------------------------------------------

  private setUpZombie(z: Bot): void {
    z.melee = { range: 1.7, damage: 14 + this.wave * 1.5, every: 0.9 };
    z.hideGun = true;
    z.tint = GLOW;
    z.grenadesPerLife = 0;
    z.ammoOverride = { ammo: 999, reserve: 999 };
    z.skill = { ...BOT_DIFFICULTY.hard, aggression: 1 };
    if (!this.zombies.includes(z)) this.zombies.push(z);
  }

  private startWave(n: number): void {
    this.wave = n;
    this.waveActive = true;
    this.toSpawn = this.waveSize(n);
    // Everyone who went down comes back.
    for (const a of this.allies) this.ctx.respawn(a);
    if (!this.ctx.player.isAlive()) this.ctx.respawn(this.ctx.player);
    audio.play('wave_start');
    this.ctx.announce(`Wave ${n}`, `${this.toSpawn} zombies`, 2.5);
  }

  /** Put more zombies on the map (up to the limit at once). */
  private spawnZombies(): void {
    const { bots } = this.ctx;
    let alive = this.zombies.filter((z) => z.isAlive()).length;
    while (this.toSpawn > 0 && alive < Z.maxAlive) {
      // Reuse a zombie that's dead and gone, or make a new one.
      let z = this.zombies.find((b) => !b.isAlive() && !b.model.root.visible);
      if (!z) {
        bots.spawnBots(1, this.ctx.config.difficulty, () => ZOMBIE);
        z = bots.bots[bots.bots.length - 1];
        this.setUpZombie(z);
      }
      this.setUpZombie(z);
      bots.revive(bots.bots.indexOf(z), z.skill);
      this.toSpawn--;
      alive++;
    }
  }

  update(dt: number): void {
    for (const s of this.stations) if (s.spin) s.spin.rotation.y += dt * 1.2;
    if (this.result) return;
    const me = this.ctx.player;
    // Buying.
    const st = this.nearStation();
    if (st && this.ctx.input.wasPressed('KeyF')) this.buy(st);

    // Everyone down: game over (a moment later, so you see it).
    const anyone = me.isAlive() || this.allies.some((a) => a.isAlive());
    if (!anyone && this.wave > 0) {
      this.overTimer += dt;
      if (this.overTimer > 2.5) this.finish();
      return;
    }
    this.overTimer = 0;

    if (this.waveActive) {
      this.spawnZombies();
      if (this.toSpawn === 0 && this.zombies.every((z) => !z.isAlive())) {
        this.waveActive = false;
        this.intermission = Z.intermission;
        me.heal(25);
        this.earn(100 + 20 * this.wave);
        this.ctx.announce(`Wave ${this.wave} cleared`, `+${100 + 20 * this.wave} points  ·  next wave in ${Z.intermission} s`, 3);
        this.ctx.cue('good');
        if (this.wave % 5 === 0) this.ctx.award(`Zombies: wave ${this.wave} cleared`, 50 * this.wave);
      }
      return;
    }
    this.intermission -= dt;
    if (this.intermission <= 0) this.startWave(this.wave + 1);
  }

  private finish(): void {
    const cleared = Math.max(0, this.wave - 1);
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    this.result = {
      title: cleared >= 10 ? 'You held out!' : 'Overrun',
      subtitle: `You survived ${cleared} wave${cleared === 1 ? '' : 's'}`,
      win: cleared >= 10,
      stats: [`Reached wave ${this.wave}`, `Zombies you killed: ${me.kills}`, `Points earned: ${(this.earned.get(me.name) ?? 0).toLocaleString('en-US')}`, `Time: ${formatTime(this.ctx.time)}`],
    };
  }

  /** Zombies go for the nearest living person; allies stay near you. */
  botObjective(bot: Bot): BotObjective | null {
    if (bot.team === ZOMBIE) {
      let best: Combatant | null = null, bestD = Infinity;
      for (const c of this.ctx.combatants()) {
        if (c.team !== ALLY || !c.isAlive()) continue;
        const d = c.position.distanceTo(bot.position);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best ? { pos: best.position.clone(), radius: 1, urgent: true, run: true } : null;
    }
    const me = this.ctx.player;
    if (!me.isAlive()) return null;
    return { pos: me.position.clone(), radius: 6, run: me.position.distanceTo(bot.position) > 12 };
  }

  markers(): Marker[] {
    const me = this.ctx.player.position;
    return this.stations
      .filter((s) => s.pos.distanceTo(me) < 18)
      .map((s) => {
        const price = this.priceFor(s);
        const short = s.kind === 'perk' ? SHORT_PERK[s.id as PerkId] : SHORT_GUN[s.id as WeaponId] ?? s.name;
        return { x: s.pos.x, y: s.pos.y + 2.3, z: s.pos.z, label: price === null ? `${short} ✓` : `${short} $${price.toLocaleString('en-US')}`, color: s.kind === 'perk' ? '#ffb04a' : '#5ad1ff' };
      });
  }

  progress(): ProgressInfo | null {
    if (this.flash && this.ctx.time < this.flash.until) return { label: this.flash.text, value: null, color: '#ffd35a' };
    const s = this.nearStation();
    if (!s) return null;
    const price = this.priceFor(s);
    if (price === null) return { label: `${s.name}: you have it`, value: null, color: '#9fd6a0' };
    const what = s.kind === 'perk' ? `${s.name} (${Z.perks[s.id as PerkId].info})` : this.owned.includes(s.id as WeaponId) ? `${s.name} ammo` : s.name;
    return { label: `Press F: ${what} for ${price.toLocaleString('en-US')}`, value: Math.min(1, this.points / price), color: this.points >= price ? '#5ad1ff' : '#ff8a5a' };
  }

  status(): string {
    const pts = `$${this.points.toLocaleString('en-US')}`;
    if (!this.waveActive) return this.wave === 0 ? `Get ready  ·  First wave in ${Math.ceil(this.intermission)}  ·  ${pts}` : `Next wave in ${Math.ceil(this.intermission)}  ·  ${pts}`;
    const left = this.toSpawn + this.zombies.filter((z) => z.isAlive()).length;
    return `Wave ${this.wave}  ·  Zombies left ${left}  ·  ${pts}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.earned.get(n) ?? 0).filter((r) => r.team !== ZOMBIE);
  }
}
