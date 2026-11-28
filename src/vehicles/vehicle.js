// A drivable/AI vehicle: visual model + physics + lights + damage + effects.
import * as THREE from 'three';
import { CANNON } from '../core/physics.js';
import { buildCar, dentBody, CAR_TYPES, carDetail } from './carModel.js';
import { VehiclePhysics } from './vehiclePhysics.js';
import { U } from '../core/globals.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';
import { surfaceAt, groundHeight, WATER_LEVEL, isWater } from '../world/map.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class Vehicle {
  constructor(game, type, opts = {}) {
    this.game = game;
    this.type = type;
    this.car = buildCar(type, opts);
    this.spec = this.car.spec;
    this.root = this.car.root;
    this.name = `${this.spec.brand} ${this.spec.model}`;
    game.scene.add(this.root);
    this.mode = 'parked';
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.yaw = 0;
    this.speed = 0;
    this.vel = new THREE.Vector3();
    this.health = 1000;
    this.vp = null;
    this.kin = null;
    this.wheelRot = 0;
    this.steerVis = 0;
    this.headlights = false;
    this.brakeLevel = 0;
    this.reversing = false;
    this.indicator = 0; // -1 left, 1 right
    this.hazard = false;
    this.broken = { head: false, tail: false };
    this.smoke = 0;
    this.submerged = 0;
    this.driver = null;
    this.lastHit = 0;
    this.horn = false;
    this.ai = null;
    this.halfL = this.spec.L / 2; this.halfW = this.spec.W / 2;
  }

  get seat() { this.ensureDetail(); return this.root.userData.seat; }
  ensureDetail() { if (!this.car.built) this.car.buildNear(carDetail()); }

  // ------------------------------------------------------------ physics lifecycle
  enablePhysics(vel = null) {
    if (this.vp) return;
    this.removeKinematic();
    const P = this.game.physics;
    this.vp = new VehiclePhysics(P.world, this.spec, P.mat);
    this.vp.addTo(P.world);
    this.vp.place(this.pos.x, this.pos.y, this.pos.z, this.yaw, vel);
    this.vp.body.addEventListener('collide', (e) => this.onCollide(e));
    this.vp.onShift = (d) => this.game.audio?.shift(this, d);
    this.mode = this.mode === 'ai' ? 'parked' : this.mode;
  }
  disablePhysics() {
    if (!this.vp) return;
    this.vp.remove();
    this.vp = null;
  }
  ensureKinematic() {
    if (this.kin || this.vp) return;
    const s = this.spec;
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.game.physics.mat.car });
    b.addShape(new CANNON.Box(new CANNON.Vec3(s.W / 2 * 0.95, (s.roofY - s.yBottom) / 2 * 0.95, s.L / 2 * 0.97)), new CANNON.Vec3(0, (s.roofY + s.yBottom) / 2, 0));
    b.addEventListener('collide', (e) => this.onKinCollide(e));
    this.game.physics.world.addBody(b);
    this.kin = b;
  }
  removeKinematic() {
    if (!this.kin) return;
    this.game.physics.world.removeBody(this.kin);
    this.kin = null;
  }
  dispose() {
    this.disablePhysics();
    this.removeKinematic();
    this.game.scene.remove(this.root);
    this.car.dispose();
    this.game.buildQueue?.delete(this);
  }

  setPose(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.quat.setFromAxisAngle(UP, yaw);
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    if (this.vp) this.vp.place(x, y, z, yaw);
  }

  // ------------------------------------------------------------ collisions
  onCollide(e) {
    const imp = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const other = e.body;
    if (imp < 2.2) return;
    const now = this.game.time;
    if (now - this.lastHit < 0.12) return;
    this.lastHit = now;
    // contact point in world
    const c = e.contact;
    const isBi = c.bi === this.vp.body;
    const rp = isBi ? c.ri : c.rj;
    const wp = new THREE.Vector3(this.vp.body.position.x + rp.x, this.vp.body.position.y + rp.y, this.vp.body.position.z + rp.z);
    const strength = clamp((imp - 2) / 8, 0, 2.5);
    this.applyDamage(wp, strength, imp);
    if (other && other.vehicle && other.vehicle !== this) other.vehicle.applyDamage(wp, strength * 0.8, imp);
    this.game.audio?.crash(wp, imp, other?.isProp);
    if (this.driver === this.game.player) this.game.cameraRig?.shake(Math.min(1, imp / 14));
    if (imp > 6) this.game.fx?.sparks(wp, Math.min(30, imp * 2));
  }
  onKinCollide(e) {
    const imp = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (imp > 2.0 && this.mode === 'ai') this.game.traffic?.queueWreck(this, imp);
  }
  applyDamage(worldPoint, strength, imp) {
    this.health -= imp * imp * 2.2;
    const local = this.root.worldToLocal(worldPoint.clone());
    local.y = clamp(local.y, this.spec.yBottom + 0.1, this.spec.roofY - 0.05);
    dentBody(this.car, local, strength);
    if (local.z > this.halfL - 0.6 && strength > 0.8) this.broken.head = true;
    if (local.z < -this.halfL + 0.6 && strength > 0.8) this.broken.tail = true;
    if (this.health < 0) this.health = 0;
  }

  // ------------------------------------------------------------ per-frame
  syncFromPhysics() {
    const b = this.vp.body;
    const P = this.vp.P;
    const bq = b.interpolatedQuaternion, bp = b.interpolatedPosition;
    this.quat.set(bq.x, bq.y, bq.z, bq.w);
    _v.set(0, -P.comY, 0).applyQuaternion(this.quat);
    this.pos.set(bp.x + _v.x, bp.y + _v.y, bp.z + _v.z);
    this.vel.set(b.velocity.x, b.velocity.y, b.velocity.z);
    this.speed = this.vp.speed;
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    this.yaw = e.y;
  }

  update(dt, night) {
    const vp = this.vp;
    if (vp) {
      this.syncFromPhysics();
      vp.body.vehicle = this;
      // surfaces + grass trample + water
      const rv = vp.rv;
      let wet = U.uWet.value;
      vp.wetness = wet;
      for (let i = 0; i < 4; i++) {
        const w = rv.wheelInfos[i];
        const cp = w.raycastResult.hitPointWorld;
        if (w.isInContact) {
          const s = surfaceAt(cp.x, cp.z);
          vp.surfaces[i] = s;
          const sp = Math.abs(this.speed);
          if (s === 'grass' && sp > 0.3) this.game.grass?.stamp(cp.x, cp.z, 0.42, this.vel.x, this.vel.z, 1);
          if ((s === 'grass' || s === 'sand') && sp > 6 && Math.random() < 0.3) this.game.fx?.dust(cp, s);
          const spinning = vp.wheelspin > 0.35 && vp.driven.includes(i);
          if ((vp.slip[i] > 0.35 || spinning) && (s === 'road' || s === 'lot')) {
            this.game.skids?.add(i, this, cp, w);
            const smokeK = Math.max(vp.slip[i] * Math.min(1, sp / 8), spinning ? vp.wheelspin : 0);
            if (Math.random() < smokeK * 0.6) this.game.fx?.tireSmoke(cp, wet);
          } else this.game.skids?.lift(i, this);
          if (wet > 0.3 && sp > 8 && Math.random() < 0.4) this.game.fx?.spray(cp, this.vel);
        } else this.game.skids?.lift(i, this);
      }
      // water
      const depth = WATER_LEVEL - this.pos.y;
      if (isWater(this.pos.x, this.pos.z) && depth > -0.4) {
        vp.inWater = clamp((depth + 0.4) / 1.4, 0, 1);
        this.submerged += dt * vp.inWater;
        if (this.submerged > 0.3 && Math.random() < 0.3) this.game.fx?.splash(this.pos, Math.abs(this.speed));
      } else { vp.inWater = 0; this.submerged = Math.max(0, this.submerged - dt); }
      if (this.submerged > 4) vp.engineOn = false;
      this.brakeLevel = vp.gear === -1 ? vp.throttle : vp.brake;
      this.reversing = vp.gear === -1;
      // wheels
      for (let i = 0; i < 4 && this.car.wheels; i++) {
        const w = rv.wheelInfos[i], W = this.car.wheels[i];
        W.pivot.position.y = vp.connY + vp.P.comY - w.suspensionLength;
        W.pivot.rotation.y = w.steering;
        W.spin.rotation.x = -w.rotation;
      }
      const sw = this.root.userData.steeringWheel;
      if (sw) sw.rotation.z = vp.steerAngle * 6;
    } else {
      // kinematic/parked visuals
      this.wheelRot += this.speed * dt / this.spec.wheelR;
      for (const W of this.car.wheels || []) {
        W.spin.rotation.x = this.wheelRot;
        W.pivot.rotation.y = W.front ? this.steerVis : 0;
        W.pivot.position.y = this.spec.wheelR;
      }
    }
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    // build the full-detail model once the car is seen up close
    if (!this.car.built) {
      const c = this.game.camera.position;
      if ((c.x - this.pos.x) ** 2 + (c.z - this.pos.z) ** 2 < 48 * 48) this.game.buildQueue?.add(this);
    }
    if (this.kin) {
      this.kin.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.kin.quaternion.set(this.quat.x, this.quat.y, this.quat.z, this.quat.w);
      this.kin.velocity.set(this.vel.x, this.vel.y, this.vel.z);
    }
    this.updateLights(dt, night);
    // engine smoke when badly damaged
    if (this.health < 350 && Math.random() < (350 - this.health) / 350 * 0.6) {
      _v.set(0, this.spec.beltY + 0.1, this.halfL - 0.7).applyQuaternion(this.quat).add(this.pos);
      this.game.fx?.engineSmoke(_v, this.health < 120);
    }
  }

  updateLights(dt, night) {
    const L = this.car.lights;
    const t = this.game.time;
    const wantHead = this.headlights || night > 0.45 || U.uRain.value > 0.4;
    const on = this.mode !== 'parked' || this.driver;
    const headOn = on && wantHead && !this.broken.head;
    L.head.emissiveIntensity = headOn ? 7 : 0;
    L.drl.emissiveIntensity = on && !this.broken.head ? (headOn ? 1.5 : 3.5) : 0;
    const tailBase = on && wantHead && !this.broken.tail ? 1.6 : 0;
    const braking = this.brakeLevel > 0.1 && on && !this.broken.tail;
    L.tail.emissiveIntensity = braking ? 7 : tailBase;
    L.brake.emissiveIntensity = braking ? 8 : 0; // third light & inner sections: brakes only
    L.reverse.emissiveIntensity = on && this.reversing ? 5 : 0;
    const blink = Math.sin(t * 9.4) > 0 ? 1 : 0;
    L.indL.emissiveIntensity = ((this.hazard || this.indicator < 0) && blink) ? 6 : 0.0;
    L.indR.emissiveIntensity = ((this.hazard || this.indicator > 0) && blink) ? 6 : 0.0;
    if (L.taxiSign) L.taxiSign.emissiveIntensity = 0.3 + night * 2.5;
    this.headOn = headOn;
    const key = `${L.head.emissiveIntensity}|${L.drl.emissiveIntensity}|${L.tail.emissiveIntensity}|${L.brake.emissiveIntensity}|${L.reverse.emissiveIntensity}|${L.indL.emissiveIntensity}|${L.indR.emissiveIntensity}`;
    if (key !== this._lightKey) { this._lightKey = key; this.car.syncLights(); }
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  doorPos(out = new THREE.Vector3()) {
    return out.set(this.halfW + 0.65, 0, (this.spec.zWsBase + this.spec.zWsTop) / 2 - 0.2).applyQuaternion(this.quat).add(this.pos);
  }
  // world-space OBB test for character collision (2D)
  contains2D(x, z, pad = 0.3) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < this.halfW + pad && Math.abs(lz) < this.halfL + pad;
  }
  pushOut2D(p, pad = 0.35) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ex = this.halfW + pad, ez = this.halfL + pad;
    if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return false;
    if (p.y > this.pos.y + this.spec.roofY + 0.1) return false;
    const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
    if (px < pz) lx = Math.sign(lx || 1) * ex; else lz = Math.sign(lz || 1) * ez;
    p.x = this.pos.x + lx * c + lz * s;
    p.z = this.pos.z - lx * s + lz * c;
    return true;
  }
}
