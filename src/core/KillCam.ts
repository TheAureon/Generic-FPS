import * as THREE from 'three';
import { BOTS, KILLCAM } from '../config';
import { createCharacterModel, type CharacterModel } from '../assets/characterModel';

/**
 * Kill-cam: when a bot kills you, the last couple of seconds before you
 * died are replayed from its eyes while you wait to respawn.
 *
 * Everyone's position and facing is recorded every frame (a few seconds'
 * worth). The replay only changes what's drawn: just before each frame is
 * rendered the characters are put where they were back then and the camera
 * goes to the killer's eyes, and right after rendering everything is put
 * back, so the match itself carries on untouched.
 */

/** One character in one recorded frame. */
interface Snap {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
}

interface Frame {
  t: number;
  snaps: Map<string, Snap>;
}

/** Something whose look the replay moves around: a bot's model, or the stand-in for you. */
export interface Actor {
  name: string;
  root: THREE.Object3D;
}

export class KillCam {
  private frames: Frame[] = [];
  private time = 0;
  /** The replay: who to watch, from when to when (match time), and how far in. */
  private play: { killer: string; from: number; to: number; at: number; wait: number } | null = null;
  /** You, as others saw you (only shown in the replay). */
  readonly body: CharacterModel;
  private saved: { root: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; visible: boolean }[] = [];
  private tracers: { t: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  private replayedTracer = -1;

  constructor(scene: THREE.Scene, playerTeamColor: number) {
    this.body = createCharacterModel(playerTeamColor, 0x36404f);
    this.body.root.visible = false;
    scene.add(this.body.root);
  }

  get active(): boolean {
    return !!this.play && this.play.wait <= 0;
  }

  get killer(): string | null {
    return this.active ? this.play!.killer : null;
  }

  /** Record this moment (call once per frame, after everyone has moved). */
  record(dt: number, chars: { name: string; position: THREE.Vector3; yaw: number; pitch: number; alive: boolean }[]): void {
    this.time += dt;
    const snaps = new Map<string, Snap>();
    for (const c of chars) snaps.set(c.name, { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.yaw, pitch: c.pitch, alive: c.alive });
    this.frames.push({ t: this.time, snaps });
    const keep = this.time - KILLCAM.length - 1;
    while (this.frames.length && this.frames[0].t < keep) this.frames.shift();
    while (this.tracers.length && this.tracers[0].t < keep) this.tracers.shift();
  }

  /** A shot's tracer (so it can be shown again in the replay). */
  recordTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    if (this.active) return;
    this.tracers.push({ t: this.time, from: from.clone(), to: to.clone() });
  }

  /** You were killed by `killer`: start the replay shortly. */
  start(killer: string): void {
    if (!KILLCAM.enabled || !this.frames.length) return;
    const to = this.time + KILLCAM.after;
    const from = Math.max(this.frames[0].t, this.time - KILLCAM.length + KILLCAM.after);
    this.play = { killer, from, to, at: 0, wait: KILLCAM.delay };
    this.replayedTracer = this.tracers.findIndex((tr) => tr.t >= from) - 1;
  }

  stop(): void {
    this.play = null;
  }

  /** Advance the replay; calls `tracer` for shots fired at this point of the replay. */
  update(dt: number, tracer: (from: THREE.Vector3, to: THREE.Vector3) => void): void {
    const p = this.play;
    if (!p) return;
    if (p.wait > 0) {
      p.wait -= dt;
      return;
    }
    p.at += dt;
    const t = p.from + p.at;
    if (t > p.to) {
      this.play = null;
      return;
    }
    for (let i = Math.max(0, this.replayedTracer + 1); i < this.tracers.length && this.tracers[i].t <= t; i++) {
      tracer(this.tracers[i].from, this.tracers[i].to);
      this.replayedTracer = i;
    }
  }

  /**
   * Before rendering: put everyone where they were and the camera in the
   * killer's eyes. Returns false (and changes nothing) if no replay is on.
   * `you` is your own name (drawn with the stand-in body).
   */
  beginRender(camera: THREE.PerspectiveCamera, actors: Actor[], you: string): boolean {
    const p = this.play;
    if (!p || p.wait > 0) return false;
    const t = p.from + p.at;
    let i = 0;
    while (i < this.frames.length - 2 && this.frames[i + 1].t < t) i++;
    const a = this.frames[i], b = this.frames[Math.min(i + 1, this.frames.length - 1)];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const snap = (name: string): Snap | null => {
      const s0 = a.snaps.get(name), s1 = b.snaps.get(name) ?? s0;
      if (!s0 || !s1) return null;
      let dyaw = s1.yaw - s0.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      return {
        x: s0.x + (s1.x - s0.x) * k,
        y: s0.y + (s1.y - s0.y) * k,
        z: s0.z + (s1.z - s0.z) * k,
        yaw: s0.yaw + dyaw * k,
        pitch: s0.pitch + (s1.pitch - s0.pitch) * k,
        alive: k < 0.5 ? s0.alive : s1.alive,
      };
    };

    this.saved.length = 0;
    const all: Actor[] = [...actors, { name: you, root: this.body.root }];
    for (const act of all) {
      const s = snap(act.name);
      this.saved.push({ root: act.root, pos: act.root.position.clone(), quat: act.root.quaternion.clone(), visible: act.root.visible });
      if (!s || act.name === p.killer) {
        // The killer is the camera; hide its own body (it would block the view).
        act.root.visible = !s ? act.root.visible && act !== all[all.length - 1] : false;
        continue;
      }
      act.root.position.set(s.x, s.y, s.z);
      act.root.rotation.set(0, s.yaw, 0);
      act.root.visible = s.alive;
    }

    const eye = snap(p.killer);
    if (!eye) return false;
    camera.position.set(eye.x, eye.y + BOTS.eyeHeight, eye.z);
    camera.rotation.set(eye.pitch, eye.yaw, 0, 'YXZ');
    return true;
  }

  /** After rendering: put everything back as it really is. */
  endRender(): void {
    for (const s of this.saved) {
      s.root.position.copy(s.pos);
      s.root.quaternion.copy(s.quat);
      s.root.visible = s.visible;
    }
    this.saved.length = 0;
    this.body.root.visible = false;
  }

  dispose(): void {
    this.body.root.removeFromParent();
  }
}
