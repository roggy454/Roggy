// The on-foot player: camera-relative movement, jog / sprint / walk, jumping, collision with
// buildings, props, cars and pedestrians, footstep sounds and getting knocked down by cars.
import * as THREE from 'three';
import { createHuman, HumanAnimator, PLAYER_APPEARANCE } from './human.js';
import { clamp, lerp, dampAngle, wrapAngle } from './utils.js';
import { obbVsCircle } from './vehicle.js';
import { WORLD_HALF, WATER_LEVEL } from './config.js';

export class Player {
  constructor(scene, terrain, collision) {
    this.h = createHuman(PLAYER_APPEARANCE, 14);
    this.anim = new HumanAnimator(this.h);
    scene.add(this.h.group);
    this.terrain = terrain; this.collision = collision;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.grounded = true; this.radius = 0.33;
    this.downT = 0; this.lastPhase = 0;
    this.visible = true;
  }

  place(x, z, yaw) {
    this.pos.set(x, this.terrain.heightAt(x, z), z);
    this.vel.set(0, 0, 0); this.yaw = yaw;
    this.sync();
  }

  setVisible(v) { this.visible = v; this.h.group.visible = v; }

  update(dt, input, camYaw, world) {
    const down = this.downT > 0;
    if (down) this.downT -= dt;
    // camera-relative wish direction
    let mx = input.moveX, my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    let speed = 0;
    if (!down && mag > 0.05) {
      const sprint = input.sprint;
      const walk = input.walk || mag < 0.5;
      speed = sprint ? 6.4 : walk ? 1.55 : 3.6;
      speed *= mag > 0.5 ? 1 : mag * 2;
    }
    // forward = direction the camera looks
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let wx = fx * my + rx * mx, wz = fz * my + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; }
    const accel = this.grounded ? 14 : 3;
    const tvx = wx * speed, tvz = wz * speed;
    this.vel.x += clamp(tvx - this.vel.x, -accel * dt, accel * dt);
    this.vel.z += clamp(tvz - this.vel.z, -accel * dt, accel * dt);
    if (speed > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wx, wz), 11, dt);

    // jump & gravity
    if (input.jumpPressed && this.grounded && !down) { this.vel.y = 5.0; this.grounded = false; }
    this.vel.y -= 18 * dt;
    const prevYaw = this.yaw;
    this.pos.addScaledVector(this.vel, dt);

    // collisions with the world
    this.collide(world);
    const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy + 0.001) {
      if (!this.grounded && this.vel.y < -9) this.onLand?.(-this.vel.y);
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
    } else if (this.pos.y - gy > 0.35) this.grounded = false;
    else if (this.vel.y <= 0) { this.pos.y = lerp(this.pos.y, gy, 1 - Math.exp(-25 * dt)); this.grounded = true; this.vel.y = 0; }
    // swimming? keep people out of deep water
    if (gy < WATER_LEVEL - 1.2) {
      this.pos.x -= this.vel.x * dt * 1.5; this.pos.z -= this.vel.z * dt * 1.5; this.vel.x *= 0.5; this.vel.z *= 0.5;
    }
    const lim = WORLD_HALF - 6;
    this.pos.x = clamp(this.pos.x, -lim, lim); this.pos.z = clamp(this.pos.z, -lim, lim);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.anim.update(dt, down ? 0 : hs, { air: !this.grounded && !down, down, turnRate: wrapAngle(this.yaw - prevYaw) / Math.max(dt, 1e-3) });
    // footsteps on the stride phase
    if (this.grounded && hs > 0.5) {
      const ph = Math.floor(this.anim.phase / Math.PI);
      if (ph !== this.lastPhase) { this.lastPhase = ph; this.onStep?.(hs); }
    }
    this.speed = hs;
    this.sync();
  }

  collide(world) {
    const r = this.radius, p = this.pos;
    const boxes = this.collision.queryBoxes(p.x - 2, p.z - 2, p.x + 2, p.z + 2, this._b || (this._b = []));
    for (const b of boxes) {
      if (p.y > b.h) continue;
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-5) { p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
        else {
          // inside: push to nearest face
          const opts = [[b.minX - r - p.x, 0], [b.maxX + r - p.x, 0], [0, b.minZ - r - p.z], [0, b.maxZ + r - p.z]];
          opts.sort((a, c) => Math.hypot(...a) - Math.hypot(...c));
          p.x += opts[0][0]; p.z += opts[0][1];
        }
      }
    }
    const circles = this.collision.queryCircles(p.x - 2, p.z - 2, p.x + 2, p.z + 2, this._c || (this._c = []));
    for (const c of circles) {
      if (p.y > (c.h || 3) + 0.2) continue;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = r + c.r;
      if (d < m && d > 1e-5) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
    }
    // cars (footprints)
    for (const fp of world.carFootprints) {
      const hit = obbVsCircle(fp, { x: p.x, z: p.z, r });
      if (!hit) continue;
      if (p.y > fp.y + fp.top - 0.1) continue; // standing on the roof
      // hit normal points from circle (us) to car: move us the other way
      if (fp.speed > 4 && this.downT <= 0) {
        this.downT = 2.6;
        this.vel.x = fp.vx * 0.8 - hit.nx * 2; this.vel.z = fp.vz * 0.8 - hit.nz * 2; this.vel.y = 4 + fp.speed * 0.2;
        this.grounded = false;
        this.onKnocked?.(fp.speed);
      }
      p.x -= hit.nx * hit.depth; p.z -= hit.nz * hit.depth;
      // stand on cars if jumping onto them
    }
  }

  sync() {
    this.h.group.position.copy(this.pos);
    this.h.group.rotation.y = this.yaw;
  }
}
