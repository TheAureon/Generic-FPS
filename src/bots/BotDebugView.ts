import * as THREE from 'three';
import type { BotManager } from './BotManager';

const STATE_COLORS: Record<string, string> = {
  patrol: '#9be29b',
  investigate: '#f0e06a',
  attack: '#ff5a4e',
  cover: '#6ab8ff',
  retreat: '#c78bff',
  resupply: '#e0b33a',
  chase: '#ff9f43',
  search: '#ffd23a',
  dead: '#888888',
};

/**
 * Debug view (toggle with F4): shows the navigation graph, each bot's
 * current path, and a label above each bot with its state.
 */
export class BotDebugView {
  readonly group = new THREE.Group();
  private paths: THREE.Line[] = [];
  private labels: { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; text: string }[] = [];

  constructor(private manager: BotManager, scene: THREE.Scene) {
    this.group.visible = false;
    scene.add(this.group);

    // The graph: walkable links in blue, ledge drops in orange.
    const nav = manager.nav;
    const walk: number[] = [];
    const drop: number[] = [];
    for (const n of nav.nodes) {
      for (const e of n.edges) {
        if (e.to < n.id && nav.nodes[e.to].edges.some((b) => b.to === n.id)) continue; // draw two-way links once
        const m = nav.nodes[e.to];
        const list = Math.abs(m.y - n.y) > 0.6 && m.y < n.y && !m.edges.some((b) => b.to === n.id) ? drop : walk;
        list.push(n.x, n.y + 0.08, n.z, m.x, m.y + 0.08, m.z);
      }
    }
    const lines = (pts: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    };
    this.group.add(lines(walk, 0x4aa3ff, 0.35), lines(drop, 0xff9f43, 0.9));

    for (let i = 0; i < manager.bots.length; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
      line.frustumCulled = false;
      line.renderOrder = 10;
      this.paths.push(line);
      this.group.add(line);

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(2, 0.5, 1);
      sprite.renderOrder = 11;
      this.labels.push({ sprite, ctx: canvas.getContext('2d')!, tex, text: '' });
      this.group.add(sprite);
    }
  }

  get visible(): boolean {
    return this.group.visible;
  }
  set visible(v: boolean) {
    this.group.visible = v;
  }

  update(): void {
    if (!this.group.visible) return;
    const { bots, brains } = this.manager;
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i], brain = brains[i];

      // Path from the bot through its remaining waypoints.
      const line = this.paths[i];
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const nav = brain.navigator;
      let count = 0;
      if (bot.isAlive() && nav.path.length > 0 && !nav.arrived) {
        attr.setXYZ(count++, bot.position.x, bot.position.y + 0.15, bot.position.z);
        for (let k = nav.index; k < nav.path.length && count < 64; k++) {
          const p = nav.path[k];
          attr.setXYZ(count++, p.x, p.y + 0.15, p.z);
        }
      }
      line.geometry.setDrawRange(0, count);
      attr.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).color.set(STATE_COLORS[brain.state] ?? '#ffffff');

      // Label: name + state (+ who it's fighting).
      const label = this.labels[i];
      const text = `${bot.name}: ${brain.state}${brain.target && bot.perception.canSee ? ' → ' + brain.target.name : ''}`;
      if (text !== label.text) {
        label.text = text;
        const c = label.ctx;
        c.clearRect(0, 0, 256, 64);
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(0, 8, 256, 48);
        c.font = 'bold 26px sans-serif';
        c.textAlign = 'center';
        c.fillStyle = STATE_COLORS[brain.state] ?? '#fff';
        c.fillText(text, 128, 42, 248);
        label.tex.needsUpdate = true;
      }
      label.sprite.visible = bot.model.root.visible;
      label.sprite.position.set(bot.position.x, bot.position.y + 2.3, bot.position.z);
    }
  }
}
