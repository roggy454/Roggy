// Player: on-foot controller (walk/jog/sprint/jump/swim, collisions, footsteps,
// grass trampling) and driving (enter/exit any car, controls, horn, lights).
import * as THREE from 'three';
import { Human, randomLook } from './human.js';
import { Animator } from './animator.js';
import { groundHeight, surfaceAt, WATER_LEVEL, isWater, SPAWN } from '../world/map.js';
import { clamp, damp, dampAngle, lerp, RNG, wrapAngle } from '../core/utils.js';
import { U } from '../core/globals.js';
import { Retarget } from './retarget.js';
import { fitCharacterModel } from '../core/models.js';

export class Player {
  constructor(game) {
    this.game = game;
    const look = { female: false, tone: 2, height: 1.82, girth: 1.02, shirt: [0.92, 0.92, 0.9], pants: [0.12, 0.16, 0.28], shoes: [0.95, 0.95, 0.95], sleeves: 1.2, pantsTo: 0.1, tank: false, vneck: false, hair: 'short', hairCol: [0.05, 0.035, 0.02], variant: 0, beard: true, eye: 1 };
    this.human = new Human(look, 3);
    this.anim = new Animator(this.human);
    this.root = this.human.root;
    game.scene.add(this.root);
    this.pos = new THREE.Vector3(SPAWN.x, groundHeight(SPAWN.x, SPAWN.z), SPAWN.z);
    this.vel = new THREE.Vector3();
    this.heading = SPAWN.heading;
    this.grounded = true;
    this.state = 'foot';
    this.vehicle = null;
    this.swimming = false;
    this.radius = 0.32;
    this.anim.onStep = (side, v) => this.footstep(side, v);
    this.stamina = 1;
    this.transition = 0;
    this.camYaw = SPAWN.heading + Math.PI;
  }

  get x() { return this.pos.x; } get z() { return this.pos.z; }

  // swap the visible body for an imported rigged model, driven by our animation
  useModel(gltf, { flip = false } = {}) {
    if (this.custom) { this.root.remove(this.custom.root); this.custom = null; }
    const model = fitCharacterModel(gltf.scene, this.human.look.height, { flip });
    this.root.add(model);
    const rt = new Retarget(this.human, model, this.root);
    if (!rt.ok) {
      this.root.remove(model);
      return { ok: false, missing: rt.missing || ['skeleton'] };
    }
    this.human.mesh.visible = false;
    this.custom = { root: model, rt };
    return { ok: true };
  }
  resetModel() {
    if (!this.custom) return;
    this.root.remove(this.custom.root);
    this.custom = null;
    this.human.mesh.visible = true;
  }

  footstep(side, v) {
    const s = this.swimming ? 'water' : surfaceAt(this.pos.x, this.pos.z);
    const wet = U.uWet.value > 0.35 && (s === 'road' || s === 'sidewalk' || s === 'lot');
    this.game.audio?.footstep(s, v, wet, true);
    const fx = Math.cos(this.heading) * (side === 'L' ? 0.1 : -0.1), fz = -Math.sin(this.heading) * (side === 'L' ? 0.1 : -0.1);
    if (s === 'grass') this.game.grass?.stamp(this.pos.x + fx, this.pos.z + fz, 0.28, this.vel.x, this.vel.z, 0.8);
    if (s === 'sand') this.game.fx?.footDust(this.pos, 'sand');
    if (wet || s === 'water') this.game.fx?.footDust(this.pos, 'wet');
  }

  nearestVehicle() {
    let best = null, bd = 4.2;
    for (const v of this.game.traffic.all()) {
      const d = v.doorPos(new THREE.Vector3()).distanceTo(this.pos);
      const dc = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - v.halfW;
      const dd = Math.min(d, dc + 0.8);
      if (dd < bd) { bd = dd; best = v; }
    }
    return best;
  }

  enter(v) {
    v.ensureDetail();
    this.game.traffic.claim(v);
    if (!v.vp) v.enablePhysics(v.vel.clone());
    v.mode = 'player';
    v.hazard = false;
    v.driver = this;
    v.vp.handbrake = false;
    v.vp.engineOn = true;
    this.vehicle = v;
    this.state = 'car';
    this.anim.mode = 'drive';
    v.root.add(this.root);
    const s = v.seat;
    this.root.position.set(s.x, s.y - 0.5 * this.human.scale + 0.02, s.z);
    this.root.rotation.set(0, 0, 0);
    this.game.audio?.door();
    this.game.hud?.notify(`${v.name}`, 2.5);
    this.game.audio?.startEngine(v);
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    if (Math.abs(v.speed) > 9) return;
    v.root.remove(this.root);
    this.game.scene.add(this.root);
    const door = v.doorPos(new THREE.Vector3());
    this.pos.set(door.x, groundHeight(door.x, door.z), door.z);
    // if door blocked, try other side
    const blocked = this.game.collide.resolve(this.pos.clone(), this.radius);
    if (blocked) {
      const other = new THREE.Vector3(-(v.halfW + 0.7), 0, 0).applyQuaternion(v.quat).add(v.pos);
      this.pos.set(other.x, groundHeight(other.x, other.z), other.z);
    }
    this.heading = v.yaw;
    this.vel.set(0, 0, 0);
    v.driver = null;
    v.vp.throttle = 0; v.vp.brake = 0; v.vp.handbrake = true; v.vp.steer = 0;
    this.game.traffic.release(v);
    this.vehicle = null;
    this.state = 'foot';
    this.anim.mode = 'move';
    this.game.audio?.door();
    this.game.audio?.stopEngine();
  }

  update(dt, input, camYaw) {
    const a = input.axes();
    if (this.state === 'car') return this.drive(dt, input, a);
    // ---- interact
    if (input.hit('KeyF') || input.hit('Enter') || input.touch.buttonsHit?.has('enter')) {
      const v = this.nearestVehicle();
      if (v) { this.enter(v); return; }
    }
    // ---- on foot movement
    const wantMove = Math.hypot(a.mx, a.my) > 0.1;
    const ground = groundHeight(this.pos.x, this.pos.z);
    const water = isWater(this.pos.x, this.pos.z) && ground < WATER_LEVEL - 1.25;
    this.swimming = water && this.pos.y < WATER_LEVEL - 0.6;
    let targetSpeed = 0;
    if (wantMove) {
      const mag = Math.min(1, Math.hypot(a.mx, a.my));
      if (this.swimming) targetSpeed = 1.6 * mag;
      else if (a.walk) targetSpeed = 1.5 * mag;
      else if (a.sprint && this.stamina > 0.05) targetSpeed = 7.4 * mag;
      else targetSpeed = 4.1 * mag;
      const ang = Math.atan2(-a.mx, a.my) + camYaw;
      // camera yaw: forward = camera looking direction
      const dirYaw = ang;
      this.heading = dampAngle(this.heading, dirYaw, this.swimming ? 4 : 11, dt);
    }
    if (a.sprint && wantMove && !this.swimming) this.stamina = Math.max(0, this.stamina - dt * 0.06);
    else this.stamina = Math.min(1, this.stamina + dt * 0.12);
    const surf = surfaceAt(this.pos.x, this.pos.z);
    if (surf === 'sand') targetSpeed *= 0.85;
    const cur = Math.hypot(this.vel.x, this.vel.z);
    const accel = this.grounded || this.swimming ? (targetSpeed > cur ? 9 : 14) : 2;
    const sp = damp(cur, targetSpeed, accel, dt);
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const vx = hx * sp, vz = hz * sp;
    this.vel.x = vx; this.vel.z = vz;
    // vertical
    if (this.swimming) {
      this.vel.y = damp(this.vel.y, 0, 4, dt);
      this.pos.y = damp(this.pos.y, WATER_LEVEL - 1.25, 3, dt);
      this.grounded = false;
    } else {
      if (this.grounded && a.jump) { this.vel.y = 4.6; this.grounded = false; this.game.audio?.jump(); }
      this.vel.y -= 9.81 * dt;
      this.pos.y += this.vel.y * dt;
    }
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const nGround = groundHeight(nx, nz);
    // step up small ledges (curbs), block tall ones
    if (nGround - this.pos.y > 0.45 && !this.swimming && nGround > WATER_LEVEL) { this.vel.x = 0; this.vel.z = 0; }
    else { this.pos.x = nx; this.pos.z = nz; }
    // collisions
    this.game.collide.resolve(this.pos, this.radius);
    for (const v of this.game.traffic.all()) v.pushOut2D(this.pos, this.radius);
    if (this.game.traffic.playerCar) this.game.traffic.playerCar.pushOut2D(this.pos, this.radius);
    // ground snap
    const g = groundHeight(this.pos.x, this.pos.z);
    if (!this.swimming) {
      if (this.pos.y <= g + 0.02) {
        if (!this.grounded && this.vel.y < -6) this.game.audio?.land(-this.vel.y);
        if (!this.grounded) this.game.audio?.footstep(surfaceAt(this.pos.x, this.pos.z), 2, U.uWet.value > 0.4, true);
        this.pos.y = g; this.vel.y = 0; this.grounded = true;
      } else if (this.grounded && this.pos.y - g < 0.5 && this.vel.y <= 0) { this.pos.y = g; this.vel.y = 0; }
      else this.grounded = false;
      if (g < WATER_LEVEL - 1.25 && this.pos.y < WATER_LEVEL - 0.6) { this.swimming = true; this.game.fx?.splash(this.pos, 3); this.game.audio?.splash(); }
    }
    // push dynamic props a bit
    // animation
    this.anim.mode = this.swimming ? 'swim' : this.grounded ? 'move' : 'air';
    this.anim.speed = sp;
    this.anim.vy = this.vel.y;
    this.anim.turn = 0;
    this.anim.update(dt);
    this.custom?.rt.update();
    this.root.position.copy(this.pos);
    if (this.swimming) this.root.position.y = WATER_LEVEL - 1.0;
    this.root.rotation.set(0, this.heading, 0);
    // swim splashes
    if (this.swimming && sp > 0.5 && Math.random() < 0.15) { this.game.fx?.footDust(new THREE.Vector3(this.pos.x, WATER_LEVEL, this.pos.z), 'water'); }
  }

  drive(dt, input, a) {
    const v = this.vehicle;
    const vp = v.vp;
    if (!vp) return;
    if (input.hit('KeyF') || input.hit('Enter') || input.touch.buttonsHit?.has('enter')) { this.exit(); return; }
    let throttle = Math.max(0, a.my) , brake = Math.max(0, -a.my);
    if (a.throttle) throttle = Math.max(throttle, a.throttle);
    if (a.brake) brake = Math.max(brake, a.brake);
    vp.throttle = damp(vp.throttle, throttle, 8, dt);
    vp.brake = damp(vp.brake, brake, 10, dt);
    vp.steer = a.mx;
    vp.handbrake = a.handbrake;
    if (input.hit('KeyR') && (vp.isUpsideDown() || Math.abs(v.speed) < 3)) vp.flipUpright();
    if (input.hit('KeyL')) v.headlights = !v.headlights;
    if (input.hit('KeyE') || input.hit('KeyH')) { this.game.audio?.horn(v, 0.5); }
    if (input.down('KeyE') || input.down('KeyH') || input.touch.buttons.has('horn')) this.game.audio?.hornHold(v);
    if (input.hit('KeyZ')) v.indicator = v.indicator === -1 ? 0 : -1;
    if (input.hit('KeyX')) v.indicator = v.indicator === 1 ? 0 : 1;
    if (input.hit('KeyG')) v.hazard = !v.hazard;
    this.anim.mode = 'drive';
    this.anim.steer = vp.steerAngle / 0.5;
    this.anim.update(dt);
    this.custom?.rt.update();
    if (input.hit('KeyB') && v.importSource) { this.exit(); this.game.reimportFlipped(v); return; }
    this.pos.copy(v.pos);
  }
}
