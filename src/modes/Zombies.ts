import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import { createWorldWeaponModel } from '../assets/weaponModels';
import type { Bot } from '../bots/Bot';
import type { NavNode } from '../bots/NavGraph';
import { BOT_DIFFICULTY, PARTY_MODES, WEAPONS, type WeaponId } from '../config';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import type { AABB } from '../core/CollisionWorld';
import { openArea, planBarricades, planDoors, type BarricadeSpot, type DoorSpot } from './zombieMap';
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
/** Doors: what each one costs (in the order they're found). */
const DOOR_PRICES = [750, 1000, 1250];
/** Barricades: boards when whole, seconds per board for a zombie to tear off / for you to put back, points per board (and the most per wave). */
const BOARDS = 5;
const TEAR_TIME = 1.3;
const REPAIR_TIME = 0.6;
const REPAIR_POINTS = 10;
const REPAIR_CAP = 40;

interface Door {
  spot: DoorSpot;
  price: number;
  obj: THREE.Group;
  box: AABB | null;
  /** Seconds since it was opened (-1 = closed). */
  openT: number;
}

interface Barricade {
  spot: BarricadeSpot;
  node: number;
  boards: number;
  obj: THREE.Group;
  boardMeshes: THREE.Mesh[];
  /** Zombies stuck behind it, tearing at the boards. */
  waiting: Bot[];
  tear: number;
  active: boolean;
}

type Usable = { kind: 'station'; s: Station; d: number } | { kind: 'door'; door: Door; d: number } | { kind: 'barricade'; b: Barricade; d: number };

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
  private doors: Door[] = [];
  private barricades: Barricade[] = [];
  /** Where you started (the open area grows from here as doors open). */
  private home = new THREE.Vector3();
  private repairT = 0;
  private repairedThisWave = 0;

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
    this.home.copy(this.ctx.player.position);
    this.placeDoors();
    this.placeStations();
    this.placeBarricades();
    const doors = this.doors.length ? ` Open doors to new areas (${this.doors.length} on this map).` : '';
    this.ctx.announce('Zombies', `Zombies break in through the barricades: hold F to board them up. Buy guns and perks with F.${doors}`, 4);
  }

  dispose(): void {
    for (const o of this.offs) o();
    for (const s of this.stations) s.obj.removeFromParent();
    for (const d of this.doors) {
      d.obj.removeFromParent();
      if (d.box) this.ctx.world.removeBox(d.box);
    }
    this.ctx.nav.blocked.clear();
    for (const b of this.barricades) b.obj.removeFromParent();
  }

  // ---- Doors and barricades ----------------------------------------------------------------------

  private placeDoors(): void {
    const spots = planDoors(this.ctx.world, this.ctx.nav, this.home, DOOR_PRICES.length);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.6, roughness: 0.45 });
    const sign = new THREE.MeshStandardMaterial({ color: 0x2a2010, emissive: 0xffb04a, emissiveIntensity: 0.6 });
    spots.forEach((spot, i) => {
      const h = Math.min(spot.height, 2.6);
      const w = spot.width;
      const obj = new THREE.Group();
      // Planks across the doorway, two metal straps and a lit price plate.
      const planks = Math.max(3, Math.round(w / 0.32));
      for (let k = 0; k < planks; k++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(w / planks - 0.02, h, 0.1), wood);
        p.position.set(-w / 2 + (k + 0.5) * (w / planks), h / 2, 0);
        obj.add(p);
      }
      for (const y of [0.5, h - 0.5]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.14), metal);
        strap.position.y = y;
        obj.add(strap);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.16), sign);
      plate.position.y = 1.5;
      obj.add(plate);
      obj.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      obj.position.copy(spot.center);
      if (spot.across === 'z') obj.rotation.y = Math.PI / 2;
      this.ctx.scene.add(obj);
      // Solid until opened, for everyone (and the bots' route finding).
      const box = this.ctx.world.addBox({ x: spot.center.x, y: spot.center.y, z: spot.center.z, w: spot.across === 'x' ? w + 0.2 : 0.3, h: spot.height, d: spot.across === 'x' ? 0.3 : w + 0.2 });
      for (const id of spot.nodes) this.ctx.nav.blocked.add(id);
      this.doors.push({ spot, price: DOOR_PRICES[i], obj, box, openT: -1 });
    });
  }

  private openDoor(d: Door): void {
    if (d.box) this.ctx.world.removeBox(d.box);
    d.box = null;
    d.openT = 0;
    for (const id of d.spot.nodes) this.ctx.nav.blocked.delete(id);
    audio.play('explosion', { position: d.spot.center, volume: 0.4 });
    const before = this.barricades.filter((b) => b.active).length;
    this.refreshArea();
    const added = this.barricades.filter((b) => b.active).length - before;
    this.ctx.announce('Door opened', added > 0 ? `A new area is open, with ${added} more barricade${added === 1 ? '' : 's'}` : 'A new area is open', 2);
  }

  /** Which barricades are in play: the ones in the part of the map that's open. */
  private refreshArea(): void {
    const area = openArea(this.ctx.nav, this.home, this.doors.filter((d) => d.openT < 0).map((d) => d.spot));
    for (const b of this.barricades) {
      b.active = area.has(b.node);
      b.obj.visible = b.active;
    }
  }

  private placeBarricades(): void {
    const nav = this.ctx.nav;
    const closed = this.doors.map((d) => d.spot);
    const start = openArea(nav, this.home, closed);
    const everywhere = openArea(nav, this.home, []);
    const avoid = [this.home, ...this.stations.map((s) => s.pos)];
    // A few in the starting area, and some more in the areas behind doors.
    const spots = planBarricades(this.ctx.world, nav, start, avoid, 4);
    if (this.doors.length) {
      const behind = new Set([...everywhere].filter((id) => !start.has(id)));
      spots.push(...planBarricades(this.ctx.world, nav, behind, [...avoid, ...spots.map((s) => s.pos)], Math.min(4, this.doors.length * 2)));
    }
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 });
    const hole = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const spot of spots) {
      const obj = new THREE.Group();
      // A dark opening in a wooden frame, boarded up.
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), hole);
      back.position.set(0, 1.25, 0.03);
      obj.add(back);
      for (const [x, y, w, h] of [[-0.69, 1.25, 0.18, 1.78], [0.69, 1.25, 0.18, 1.78], [0, 2.1, 1.56, 0.18], [0, 0.4, 1.56, 0.18]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), frameMat);
        f.position.set(x, y, 0.1);
        f.castShadow = true;
        obj.add(f);
      }
      const boardMeshes: THREE.Mesh[] = [];
      for (let k = 0; k < BOARDS; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.17, 0.05), wood);
        b.position.set((Math.random() - 0.5) * 0.08, 0.66 + k * 0.29, 0.16);
        b.rotation.z = (Math.random() - 0.5) * 0.35;
        b.castShadow = true;
        obj.add(b);
        boardMeshes.push(b);
      }
      obj.position.copy(spot.wall);
      obj.lookAt(spot.wall.clone().add(spot.facing));
      this.ctx.scene.add(obj);
      const node = nav.nearestNode(spot.pos)?.id ?? -1;
      this.barricades.push({ spot, node, boards: BOARDS, obj, boardMeshes, waiting: [], tear: TEAR_TIME, active: true });
    }
    this.refreshArea();
  }

  private setBoards(b: Barricade, n: number): void {
    b.boards = n;
    b.boardMeshes.forEach((m, i) => (m.visible = i < n));
  }

  /** Zombies at barricades tear boards off; once it's open they climb through. */
  private updateBarricades(dt: number): void {
    for (const b of this.barricades) {
      b.waiting = b.waiting.filter((z) => z.isAlive());
      if (!b.waiting.length) continue;
      if (b.boards > 0) {
        b.tear -= dt;
        if (b.tear <= 0) {
          b.tear = TEAR_TIME;
          this.setBoards(b, b.boards - 1);
          b.waiting[0].anim.fire();
          audio.play('impact', { position: b.spot.wall, volume: 1 });
        }
      } else {
        for (const z of b.waiting) z.frozen = false;
        b.waiting = [];
      }
    }
  }

  private earn(n: number): void {
    this.points += n;
    this.earned.set(this.ctx.player.name, (this.earned.get(this.ctx.player.name) ?? 0) + n);
  }

  // ---- Stations ----------------------------------------------------------------------------------

  private placeStations(): void {
    const nav = this.ctx.nav;
    const closed = this.doors.map((d) => d.spot);
    const start = openArea(nav, this.home, closed);
    const spots: THREE.Vector3[] = [];
    /** A spot along a wall in `area`, as far from the other stations as possible. */
    const pick = (area: Set<number>) => {
      const all = nav.nodes.filter((n: NavNode) => area.has(n.id));
      const walls = all.filter((n) => n.nearWall);
      const pool = walls.length > 6 ? walls : all;
      let best: THREE.Vector3 | null = null, bestD = -1;
      for (let k = 0; k < 40 && pool.length; k++) {
        const n = pool[Math.floor(Math.random() * pool.length)];
        const p = new THREE.Vector3(n.x, n.y, n.z);
        const d = Math.min(99, ...spots.map((q) => q.distanceTo(p)), p.distanceTo(this.home) + 4);
        if (d > bestD) { bestD = d; best = p; }
      }
      return best ?? this.home.clone();
    };
    // Guns in the starting area.
    for (let k = 0; k < Object.keys(Z.guns).length; k++) spots.push(pick(start));
    // Perks: one behind each door (that's what the doors are for), the rest at the start.
    const perkAreas = this.doors.map((d) => {
      const opened = openArea(nav, this.home, closed.filter((c) => c !== d.spot));
      return new Set([...opened].filter((id) => !start.has(id)));
    });
    for (let k = 0; k < Object.keys(Z.perks).length; k++) spots.push(pick(perkAreas[k] && perkAreas[k].size ? perkAreas[k] : start));
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

  /** The station, door or barricade you're standing at, if any (the closest). */
  private nearest(): Usable | null {
    const me = this.ctx.player;
    if (!me.isAlive()) return null;
    const flat = (p: THREE.Vector3) => (Math.abs(p.y - me.position.y) < 2 ? Math.hypot(p.x - me.position.x, p.z - me.position.z) : Infinity);
    let best: Usable | null = null;
    for (const s of this.stations) {
      const d = flat(s.pos);
      if (d < BUY_RANGE && (!best || d < best.d)) best = { kind: 'station', s, d };
    }
    for (const door of this.doors) {
      if (door.openT >= 0) continue;
      const d = flat(door.spot.center);
      if (d < 2.6 && (!best || d < best.d)) best = { kind: 'door', door, d };
    }
    for (const b of this.barricades) {
      if (!b.active || b.boards >= BOARDS) continue;
      const d = flat(b.spot.pos);
      if (d < 2.0 && (!best || d < best.d)) best = { kind: 'barricade', b, d };
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
    this.repairedThisWave = 0;
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
      // In through a barricade (one near the living, if there is one).
      const b = this.pickBarricade();
      if (b) {
        z.body.position.copy(b.spot.pos);
        z.body.velocity.set(0, 0, 0);
        z.frozen = b.boards > 0;
        if (z.frozen) b.waiting.push(z);
      } else z.frozen = false;
      this.toSpawn--;
      alive++;
    }
  }

  update(dt: number): void {
    for (const s of this.stations) if (s.spin) s.spin.rotation.y += dt * 1.2;
    if (this.result) return;
    const me = this.ctx.player;
    // Buying, opening doors, repairing barricades.
    const use = this.nearest();
    const input = this.ctx.input;
    if (use?.kind === 'station' && input.wasPressed('KeyF')) this.buy(use.s);
    if (use?.kind === 'door' && input.wasPressed('KeyF')) {
      if (this.points >= use.door.price) {
        this.points -= use.door.price;
        this.openDoor(use.door);
      } else {
        audio.play('dry_fire');
        this.flash = { text: `Not enough points (${use.door.price.toLocaleString('en-US')} needed)`, until: this.ctx.time + 1.5 };
      }
    }
    if (use?.kind === 'barricade' && input.isDown('KeyF')) {
      this.repairT += dt;
      if (this.repairT >= REPAIR_TIME) {
        this.repairT = 0;
        this.setBoards(use.b, use.b.boards + 1);
        audio.play('reload_end', { volume: 0.8 });
        if (this.repairedThisWave < REPAIR_CAP) {
          this.repairedThisWave++;
          this.earn(REPAIR_POINTS);
        }
      }
    } else this.repairT = 0;
    // Doors slide up into the frame and go.
    for (const d of this.doors) {
      if (d.openT < 0 || !d.obj.parent) continue;
      d.openT += dt;
      d.obj.position.y = d.spot.center.y + Math.min(1, d.openT) * d.spot.height;
      if (d.openT > 1) d.obj.removeFromParent();
    }
    this.updateBarricades(dt);

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

  /** A barricade in play for a new zombie: a random one, preferring ones near the living. */
  private pickBarricade(): Barricade | null {
    const live = this.barricades.filter((b) => b.active);
    if (!live.length) return null;
    const people = this.ctx.combatants().filter((c) => c.team === ALLY && c.isAlive());
    const near = live.filter((b) => people.some((c) => c.position.distanceTo(b.spot.pos) < 45));
    const pool = near.length ? near : live;
    return pool[Math.floor(Math.random() * pool.length)];
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
    const out: Marker[] = [];
    for (const d of this.doors) {
      if (d.openT < 0 && d.spot.center.distanceTo(me) < 25) out.push({ x: d.spot.center.x, y: d.spot.center.y + 2.6, z: d.spot.center.z, label: `Door $${d.price.toLocaleString('en-US')}`, color: '#ffb04a' });
    }
    for (const b of this.barricades) {
      if (b.active && b.boards < BOARDS && b.spot.pos.distanceTo(me) < 14) out.push({ x: b.spot.wall.x, y: b.spot.wall.y + 2.4, z: b.spot.wall.z, label: `Boards ${b.boards}/${BOARDS}`, color: b.boards === 0 ? '#ff5a4a' : '#d8b080' });
    }
    return out.concat(this.stations
      .filter((s) => s.pos.distanceTo(me) < 18)
      .map((s) => {
        const price = this.priceFor(s);
        const short = s.kind === 'perk' ? SHORT_PERK[s.id as PerkId] : SHORT_GUN[s.id as WeaponId] ?? s.name;
        return { x: s.pos.x, y: s.pos.y + 2.3, z: s.pos.z, label: price === null ? `${short} ✓` : `${short} $${price.toLocaleString('en-US')}`, color: s.kind === 'perk' ? '#ffb04a' : '#5ad1ff' };
      }));
  }

  progress(): ProgressInfo | null {
    if (this.flash && this.ctx.time < this.flash.until) return { label: this.flash.text, value: null, color: '#ffd35a' };
    const use = this.nearest();
    if (!use) return null;
    if (use.kind === 'door') {
      const p = use.door.price;
      return { label: `Press F: open the door for ${p.toLocaleString('en-US')}`, value: Math.min(1, this.points / p), color: this.points >= p ? '#ffb04a' : '#ff8a5a' };
    }
    if (use.kind === 'barricade') {
      const capped = this.repairedThisWave >= REPAIR_CAP ? ' (no more points this wave)' : ` (+${REPAIR_POINTS} a board)`;
      return { label: `Hold F: board up the barricade${capped}`, value: use.b.boards / BOARDS, color: '#d8b080' };
    }
    const s = use.s;
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
