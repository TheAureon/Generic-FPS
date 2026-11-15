import * as THREE from 'three';
import { settings } from './Settings';
import type { Input } from './Input';

/**
 * Photo mode (P during a match): the match freezes, the HUD and your gun
 * disappear, and you fly a free camera around to frame a shot.
 * - WASD: fly, mouse: look, Space / C: up / down, Shift: faster
 * - Mouse wheel: zoom (field of view)
 * - Q / E: tilt the camera
 * - Enter (or F2): save a screenshot
 * - P: back to the match
 */
export class PhotoMode {
  private yaw: number;
  private pitch: number;
  private roll = 0;
  private fov: number;
  private hint: HTMLDivElement;
  /** Save a screenshot right after the next frame is drawn. */
  wantShot = false;

  constructor(private camera: THREE.PerspectiveCamera) {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.fov = camera.fov;
    this.hint = document.createElement('div');
    this.hint.className = 'photo-hint';
    this.hint.innerHTML =
      '<b>Photo mode</b> · WASD fly · mouse look · Space / C up / down · Shift faster · wheel zoom · Q / E tilt · <b>Enter</b> save picture · <b>P</b> back';
    document.body.appendChild(this.hint);
  }

  update(dt: number, input: Input): void {
    const { dx, dy } = input.consumeMouseDelta();
    const sens = settings.get().mouseSensitivity * 0.0022 * (this.fov / 80);
    this.yaw -= dx * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * sens));
    const wheel = input.consumeWheel();
    if (wheel) this.fov = Math.max(15, Math.min(110, this.fov + wheel * 4));
    if (input.isDown('KeyQ')) this.roll += dt * 0.8;
    if (input.isDown('KeyE')) this.roll -= dt * 0.8;

    const speed = (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 14 : 4) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const c = this.camera;
    if (input.isDown('KeyW')) c.position.addScaledVector(fwd, speed);
    if (input.isDown('KeyS')) c.position.addScaledVector(fwd, -speed);
    if (input.isDown('KeyD')) c.position.addScaledVector(right, speed);
    if (input.isDown('KeyA')) c.position.addScaledVector(right, -speed);
    if (input.isDown('Space')) c.position.y += speed;
    if (input.isDown('KeyC')) c.position.y -= speed;
    c.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    if (Math.abs(c.fov - this.fov) > 0.01) {
      c.fov = this.fov;
      c.updateProjectionMatrix();
    }
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || input.wasPressed('F2')) this.wantShot = true;
  }

  /** Save what's on screen as a picture (call right after drawing the frame). */
  saveShot(canvas: HTMLCanvasElement): void {
    this.wantShot = false;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      a.download = `generic-fps-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
    // A quick flash so you know it was taken.
    this.hint.classList.remove('snap');
    void this.hint.offsetWidth;
    this.hint.classList.add('snap');
  }

  dispose(): void {
    this.hint.remove();
  }
}
