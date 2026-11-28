// Third-person camera: free orbit on foot, chase cam in vehicles that swings
// behind the car when you are not steering it with the mouse, speed FOV, shake,
// collision with buildings, plus hood/first-person view.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, wrapAngle } from './utils.js';
import { groundHeight, WATER_LEVEL } from '../world/map.js';

export class CameraRig {
  constructor(camera, collide) {
    this.cam = camera;
    this.collide = collide;
    this.yaw = 0; this.pitch = 0.18;
    this.dist = 4.2;
    this.mode = 0; // 0 normal, 1 far, 2 first person / hood
    this.shakeAmt = 0;
    this.lastMouse = 0;
    this.target = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.fov = 62;
    this.time = 0;
  }
  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  update(dt, player, input) {
    this.time += dt;
    if (this.free) { // scripted camera (screenshots / photo mode)
      this.cam.position.copy(this.free.pos);
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(this.free.target);
      if (this.free.fov) this.cam.fov = this.free.fov;
      this.cam.updateProjectionMatrix();
      this.cam.updateMatrixWorld();
      return;
    }
    const a = input.axes();
    const looking = Math.abs(a.lx) + Math.abs(a.ly) > 0.0005;
    if (looking) this.lastMouse = this.time;
    this.yaw -= a.lx * 1.0;
    this.pitch = clamp(this.pitch + a.ly * 0.8, -0.5, 1.2);
    if (input.hit('KeyV')) this.mode = (this.mode + 1) % 3;
    if (input.wheel) this.dist = clamp(this.dist + input.wheel * 0.5, 2.5, 12);
    const cam = this.cam;
    const v = player.vehicle;
    let desiredFov = 62;
    if (v) {
      const spec = v.spec;
      const sp = Math.abs(v.speed);
      // swing behind the car when idle on the mouse
      const carYaw = v.yaw + (v.speed < -1 ? Math.PI : 0);
      if (this.time - this.lastMouse > 1.4 && sp > 1.5) this.yaw = dampAngle(this.yaw, carYaw, 2.5, dt);
      if (this.time - this.lastMouse > 1.4 && sp > 1.5) this.pitch = damp(this.pitch, 0.12, 2, dt);
      if (this.mode === 2) {
        // hood/driver view
        const eye = new THREE.Vector3(0.37, spec.beltY + 0.42, spec.zWsTop - 0.15).applyQuaternion(v.quat).add(v.pos);
        cam.position.copy(eye);
        const look = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch * 0.5), -this.pitch * 0.5 + 0.02, Math.cos(this.yaw) * Math.cos(this.pitch * 0.5));
        cam.up.set(0, 1, 0).applyQuaternion(v.quat);
        cam.lookAt(eye.clone().add(look));
        desiredFov = 70 + sp * 0.15;
      } else {
        const len = spec.L;
        const dist = (this.mode === 1 ? 1.7 : 1.15) * (len * 0.75 + 2.6) + sp * 0.04;
        const height = spec.roofY * 0.55 + 1.0;
        this.target.set(v.pos.x, v.pos.y + spec.roofY * 0.75, v.pos.z);
        const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
        const want = new THREE.Vector3(this.target.x - Math.sin(this.yaw) * dist * cp, this.target.y + height * 0.4 + dist * spch, this.target.z - Math.cos(this.yaw) * dist * cp);
        this.place(want, dt, 12);
        cam.up.set(0, 1, 0);
        cam.lookAt(this.target.x, this.target.y + 0.3, this.target.z);
        desiredFov = 62 + clamp(sp * 0.33, 0, 20);
      }
    } else {
      const p = player.pos;
      const eyeH = player.swimming ? 0.35 : 1.62 * player.human.scale;
      if (this.mode === 2) {
        const eye = new THREE.Vector3(p.x, (player.swimming ? WATER_LEVEL : p.y) + eyeH + 0.05, p.z);
        eye.x += Math.sin(player.heading) * 0.15; eye.z += Math.cos(player.heading) * 0.15;
        cam.position.copy(eye);
        cam.up.set(0, 1, 0);
        cam.lookAt(eye.x + Math.sin(this.yaw) * Math.cos(this.pitch), eye.y - Math.sin(this.pitch), eye.z + Math.cos(this.yaw) * Math.cos(this.pitch));
        player.human.headMesh.visible = false;
      } else {
        player.human.headMesh.visible = true;
        const dist = this.mode === 1 ? this.dist * 1.8 : this.dist;
        const sp = Math.hypot(player.vel.x, player.vel.z);
        // auto-follow behind when running and not using the mouse
        if (this.time - this.lastMouse > 2.5 && sp > 2) this.yaw = dampAngle(this.yaw, player.heading, 1.2, dt);
        const baseY = player.swimming ? WATER_LEVEL + 0.2 : p.y;
        this.target.set(p.x, baseY + eyeH - 0.05, p.z);
        // over-the-shoulder offset
        const sx = Math.cos(this.yaw) * -0.45, sz = -Math.sin(this.yaw) * -0.45;
        const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
        const want = new THREE.Vector3(this.target.x - Math.sin(this.yaw) * dist * cp + sx, this.target.y + dist * spch, this.target.z - Math.cos(this.yaw) * dist * cp + sz);
        this.place(want, dt, 18);
        cam.up.set(0, 1, 0);
        cam.lookAt(this.target.x + sx * 0.7, this.target.y, this.target.z + sz * 0.7);
        desiredFov = 60 + clamp((sp - 4) * 1.5, 0, 6);
      }
    }
    // shake
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.12;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt = damp(this.shakeAmt, 0, 6, dt);
    }
    this.fov = damp(this.fov, desiredFov, 3, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  place(want, dt, rate) {
    // collide with buildings: pull in along target->camera ray
    const t = this.collide.segment(this.target, want, 0.35);
    const wp = new THREE.Vector3().lerpVectors(this.target, want, Math.max(0.12, t - 0.02));
    const g = groundHeight(wp.x, wp.z);
    wp.y = Math.max(wp.y, Math.max(g, WATER_LEVEL) + 0.35);
    if (this.pos.lengthSq() === 0) this.pos.copy(wp);
    const k = 1 - Math.exp(-rate * dt);
    // snap in quickly when occluded, ease out slowly
    if (t < 0.98) this.pos.lerp(wp, Math.min(1, k * 2.5)); else this.pos.lerp(wp, k);
    this.cam.position.copy(this.pos);
  }
}
