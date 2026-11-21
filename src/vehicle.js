// Player-drivable vehicle physics: full 3D rigid body with four raycast suspension struts,
// slip-angle tyre model with a friction circle, weight transfer, anti-roll bars, engine torque
// curve, automatic gearbox, brakes, handbrake drifts, collisions with buildings/props.
import * as THREE from 'three';
import { clamp, lerp, sign } from './utils.js';
import { WORLD_HALF, WATER_LEVEL } from './config.js';

const G = 9.81;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export const ENGINE_SPECS = {
  sedan: { torque: 300, peak: 4300, redline: 6800, gears: [3.5, 2.1, 1.45, 1.1, 0.87, 0.7], final: 3.6, drive: 'rwd', grip: 1.0, comH: 0.55, brake: 9500 },
  taxi: { torque: 290, peak: 4300, redline: 6600, gears: [3.5, 2.1, 1.45, 1.1, 0.87, 0.7], final: 3.6, drive: 'rwd', grip: 0.98, comH: 0.55, brake: 9500 },
  hatch: { torque: 230, peak: 4000, redline: 6800, gears: [3.6, 2.2, 1.5, 1.12, 0.9, 0.75], final: 3.9, drive: 'fwd', grip: 0.98, comH: 0.53, brake: 8000 },
  suv: { torque: 450, peak: 3800, redline: 6200, gears: [3.8, 2.3, 1.55, 1.15, 0.9, 0.72], final: 3.5, drive: 'awd', grip: 1.0, comH: 0.72, brake: 12500 },
  sports: { torque: 560, peak: 5600, redline: 7900, gears: [3.2, 2.15, 1.6, 1.25, 1.0, 0.82], final: 3.4, drive: 'rwd', grip: 1.15, comH: 0.46, brake: 13000 },
  van: { torque: 380, peak: 3200, redline: 5600, gears: [3.9, 2.3, 1.5, 1.1, 0.85, 0.7], final: 3.9, drive: 'rwd', grip: 0.92, comH: 0.85, brake: 13000 },
  pickup: { torque: 500, peak: 3500, redline: 6000, gears: [3.7, 2.2, 1.5, 1.12, 0.88, 0.72], final: 3.7, drive: 'rwd', grip: 0.97, comH: 0.75, brake: 13000 },
};

// Simplified Pacejka "magic formula" for lateral force (normalised -1..1)
function pacejka(slip, B = 9.5, C = 1.65, E = 0.95) {
  const x = slip;
  return Math.sin(C * Math.atan(B * x - E * (B * x - Math.atan(B * x))));
}

export class Vehicle {
  constructor(visual, typeName, world) {
    this.visual = visual;
    this.type = typeName;
    this.world = world; // { terrain, collision, surfaceAt }
    const T = visual.T;
    this.T = T;
    this.E = ENGINE_SPECS[typeName];
    this.mass = T.mass;
    this.comH = this.E.comH;
    const L = T.L, W = T.W, H = 1.2;
    const k = 1.25;
    this.inertia = new THREE.Vector3(this.mass / 12 * (H * H + L * L) * k, this.mass / 12 * (W * W + L * L) * k, this.mass / 12 * (W * W + H * H) * k);
    this.invI = new THREE.Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    this.restLen = 0.34;
    this.staticComp = 0.11;
    this.travel = 0.26;
    this.springK = (this.mass * G / 4) / this.staticComp;
    this.damp = 2 * 0.42 * Math.sqrt(this.springK * this.mass / 4);
    this.arb = this.springK * 0.55;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.R = new THREE.Matrix4();

    const anchorY = T.R + (this.restLen - this.staticComp) - this.comH;
    this.wheels = visual.model.wheels.map((w) => ({
      anchor: new THREE.Vector3(w.x, anchorY, w.z),
      front: w.front, left: w.left,
      driven: this.E.drive === 'awd' || (this.E.drive === 'fwd' ? w.front : !w.front),
      susp: this.restLen - this.staticComp, comp: this.staticComp, prevComp: this.staticComp,
      contact: false, load: 0, spin: 0, omega: 0, slipLat: 0, slipLong: 0, surface: 'asphalt',
      cp: new THREE.Vector3(), skid: 0,
    }));

    this.steer = 0; this.steerInput = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.gear = 1; this.rpm = 900; this.shiftTimer = 0; this.clutch = 1;
    this.reverseHold = 0;
    this.speed = 0; this.forwardSpeed = 0;
    this.impact = 0; this.upsideTimer = 0; this.waterTimer = 0;
    this.headlights = false; this.lastHit = 0;
    this.driven = false;
    this.sleeping = false;
  }

  place(x, z, yaw) {
    const gy = this.world.terrain.heightAt(x, z);
    this.pos.set(x, gy + this.comH + 0.05, z);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const w of this.wheels) { w.comp = w.prevComp = this.staticComp; w.susp = this.restLen - this.staticComp; }
    this.gear = 1; this.rpm = 900;
    this.sleeping = false;
    this.syncVisual(0);
  }

  get yaw() {
    const f = _v.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(f.x, f.z);
  }

  forward(out) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  up(out) { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  applyInverseInertia(vec) {
    // world-space I^-1 * vec using body-space diagonal inertia
    _v3.copy(vec).applyQuaternion(_qInv.copy(this.quat).invert());
    _v3.x *= this.invI.x; _v3.y *= this.invI.y; _v3.z *= this.invI.z;
    return _v3.applyQuaternion(this.quat);
  }

  // Controls: throttle/brake 0..1, steer -1..1 (positive = left), handbrake 0..1
  setInput(throttleKey, brakeKey, steer, handbrake) {
    this.inThrottle = throttleKey; this.inBrake = brakeKey; this.inSteer = steer; this.handbrake = handbrake;
  }

  torqueAt(rpm) {
    const E = this.E;
    const x = (rpm - E.peak) / (E.redline - 900);
    return E.torque * clamp(1 - x * x * 1.6, 0.35, 1);
  }

  step(dt) {
    if (this.sleeping) return;
    const E = this.E;
    const q = this.quat;
    const up = this.up(_up), fwd = this.forward(_fwd);
    const rightV = _right.set(-1, 0, 0).applyQuaternion(q);
    this.forwardSpeed = this.vel.dot(fwd);
    this.speed = this.vel.length();
    const vf = this.forwardSpeed;

    // ---- input mapping incl. automatic reverse ----
    let thr = 0, brk = 0;
    const tK = this.inThrottle || 0, bK = this.inBrake || 0;
    if (!this.driven) {
      // nobody inside: parking brake on, engine idle
      brk = 0.5; this.handbrake = 1;
    } else if (this.gear >= 1) {
      thr = tK; brk = bK;
      if (bK > 0.1 && tK < 0.1 && vf < 0.8) { this.reverseHold += dt; if (this.reverseHold > 0.15) { this.gear = -1; this.reverseHold = 0; } }
      else this.reverseHold = 0;
    } else {
      thr = bK; brk = tK;
      if (tK > 0.1 && bK < 0.1 && vf > -0.8) { this.reverseHold += dt; if (this.reverseHold > 0.1) { this.gear = 1; this.reverseHold = 0; } }
      else this.reverseHold = 0;
    }
    this.throttle = lerp(this.throttle, thr, 1 - Math.exp(-12 * dt));
    this.brake = brk;

    // ---- steering: speed-sensitive with smoothing ----
    const target = clamp(this.inSteer || 0, -1, 1);
    const rate = Math.abs(target) > Math.abs(this.steerInput) ? 3.2 : 5.5;
    this.steerInput += clamp(target - this.steerInput, -rate * dt, rate * dt);
    const maxSteer = lerp(0.62, 0.11, clamp(Math.abs(vf) / 42, 0, 1));
    // light stability assist: steer into a slide a little
    const latV = this.vel.dot(rightV);
    const assist = Math.abs(vf) > 5 ? clamp(Math.atan2(-latV, Math.abs(vf)) * 0.35, -0.25, 0.25) : 0;
    this.steer = this.steerInput * maxSteer + (this.driven ? assist * (1 - Math.abs(this.steerInput) * 0.6) : 0);

    // ---- engine & gearbox ----
    const R = this.T.R;
    const gearRatio = this.gear === -1 ? 3.3 : E.gears[this.gear - 1];
    let wheelRpm = 0, nd = 0;
    for (const w of this.wheels) if (w.driven) { wheelRpm += Math.abs(w.omega) * 60 / (Math.PI * 2); nd++; }
    wheelRpm /= nd;
    const engineFromWheels = wheelRpm * gearRatio * E.final;
    const targetRpm = Math.max(900 + this.throttle * (Math.abs(vf) < 2 ? 2600 : 0), engineFromWheels);
    this.rpm = lerp(this.rpm, clamp(targetRpm, 800, E.redline + 150), 1 - Math.exp(-14 * dt));
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.gear >= 1 && this.shiftTimer <= 0) {
      if (this.rpm > E.redline - 350 && this.gear < E.gears.length && this.throttle > 0.2) { this.gear++; this.shiftTimer = 0.28; this.onShift?.(1); }
      else if (this.gear > 1 && engineFromWheels < E.peak * 0.48) { this.gear--; this.shiftTimer = 0.2; this.onShift?.(-1); }
    }
    // traction control trims torque while the driven wheels spin (handbrake turns it off)
    if (this.wheelspin > 0.25 && this.handbrake < 0.1) this.tc = Math.max(0.35, (this.tc ?? 1) - dt * 4);
    else this.tc = Math.min(1, (this.tc ?? 1) + dt * 1.5);
    let engineTorque = this.torqueAt(this.rpm) * this.throttle * this.tc;
    if (this.rpm > E.redline) engineTorque = 0;
    if (this.shiftTimer > 0.05) engineTorque *= 0.1;
    const driveTotal = engineTorque * gearRatio * E.final * 0.88 / R * (this.gear === -1 ? -1 : 1);
    // engine braking when off throttle
    const engineBrake = this.throttle < 0.05 ? clamp(Math.abs(vf), 0, 3) * 120 * (this.gear === -1 ? -1 : 1) : 0;

    // ---- forces ----
    const F = _F.set(0, -this.mass * G, 0);
    const Tq = _Tq.set(0, 0, 0);
    const terrain = this.world.terrain;
    let onGround = 0;
    this.skidAmount = 0; this.wheelspin = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const aw = _aw.copy(w.anchor).applyQuaternion(q).add(this.pos);
      const gy = terrain.heightAt(aw.x, aw.z);
      terrain.normalAt(aw.x, aw.z, _n);
      const upN = Math.max(0.25, up.dot(_n));
      const dist = (aw.y - gy) * _n.y / upN;
      let susp = dist - R;
      w.prevComp = w.comp;
      if (susp >= this.restLen) {
        w.contact = false; w.comp = 0; w.susp = this.restLen; w.load = 0;
        w.omega *= Math.exp(-0.5 * dt);
        if (w.driven) w.omega = clamp(w.omega + driveTotal / nd * dt * 0.02, -400, 400);
        continue;
      }
      w.contact = true; onGround++;
      susp = Math.max(susp, this.restLen - this.travel - 0.06);
      w.susp = susp;
      w.comp = this.restLen - susp;
      let fs = this.springK * w.comp + this.damp * (w.comp - w.prevComp) / dt;
      if (w.comp > this.travel) fs += (w.comp - this.travel) * this.springK * 12;
      fs = Math.max(0, fs);
      w.load = fs;
      w.surface = this.world.surfaceAt(aw.x, aw.z);
      // contact point
      const cp = w.cp.copy(aw).addScaledVector(up, -(susp + R));
      // suspension force along the car's up axis at the strut
      _v.copy(up).multiplyScalar(fs);
      this.addForceAt(F, Tq, _v, aw);

      // tyre frame on the ground plane
      const steer = w.front ? this.steer : 0;
      const wf = _wf.copy(fwd).applyAxisAngle(up, steer);
      wf.addScaledVector(_n, -wf.dot(_n)).normalize();
      const wr = _wr.crossVectors(wf, _n).normalize(); // points to car's right
      // contact velocity
      _r.copy(cp).sub(this.pos);
      const vc = _vc.crossVectors(this.angVel, _r).add(this.vel);
      const vLong = vc.dot(wf), vLat = vc.dot(wr);
      const surf = w.surface;
      let mu = (surf === 'grass' ? 0.68 : surf === 'dirt' ? 0.72 : surf === 'sidewalk' ? 0.95 : 1.05) * E.grip;
      const Fz = Math.min(fs, this.mass * G * 1.6);
      const massShare = this.mass / 4;
      // longitudinal
      let Fx = 0;
      if (w.driven) Fx += driveTotal / nd;
      if (Math.abs(vLong) > 0.05 || brk > 0) {
        const bForce = brk * E.brake / 4 * (w.front ? 1.25 : 0.75);
        Fx -= sign(vLong) * Math.min(bForce, Math.abs(vLong) * massShare / dt);
      }
      let latGrip = 1;
      if (!w.front && this.handbrake > 0.1) {
        Fx = -sign(vLong) * Math.min(E.brake * 0.35, Math.abs(vLong) * massShare / dt);
        latGrip = 0.42;
      }
      if (w.driven) Fx -= sign(vLong) * Math.min(Math.abs(engineBrake) / nd, Math.abs(vLong) * massShare / dt);
      Fx -= sign(vLong) * Math.min(Math.abs(vLong) * 25, surf === 'grass' || surf === 'dirt' ? 320 : 45); // rolling resistance
      // lateral (slip angle)
      const slip = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.0));
      const maxF = mu * Fz;
      let Fy = -maxF * pacejka(slip) * latGrip;
      const capY = Math.abs(vLat) * massShare / dt;
      if (Math.abs(Fy) > capY) Fy = sign(Fy) * capY;
      // friction circle (driving force eats lateral grip)
      const tot = Math.hypot(Fx, Fy);
      let spin = 0;
      if (tot > maxF) {
        // wheelspin ratio; a wheel that touches with almost no load can't be divided by
        if (w.driven && maxF > 60 && Math.abs(driveTotal / nd) > maxF * 0.95) spin = Math.min(3, (Math.abs(driveTotal / nd) - maxF) / maxF);
        const s = maxF / tot;
        Fx *= s; Fy *= s * (spin > 0 ? 0.8 : 1);
      }
      _v.copy(wf).multiplyScalar(Fx).addScaledVector(wr, Fy);
      this.addForceAt(F, Tq, _v, cp);
      w.slipLat = vLat; w.slipLong = vLong;
      // wheel visual spin (spins up on wheelspin, stops when locked)
      const locked = (brk > 0.9 && Math.abs(vLong) > 3 && !w.driven) || (!w.front && this.handbrake > 0.1);
      w.omega = locked ? 0 : clamp(vLong / R + (w.driven ? spin * 25 * sign(driveTotal) : 0), -400, 400);
      w.skid = Math.max(0, Math.abs(vLat) - 2.2) * 0.4 + (spin > 0.1 ? 1 : 0) + (locked && Math.abs(vLong) > 2 ? 1 : 0);
      this.skidAmount = Math.max(this.skidAmount, w.skid);
      if (spin > this.wheelspin) this.wheelspin = spin;
    }
    // anti-roll bars
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const wa = this.wheels[a], wb = this.wheels[b];
      if (!wa.contact && !wb.contact) continue;
      const d = (wa.comp - wb.comp) * this.arb;
      _aw.copy(wa.anchor).applyQuaternion(q).add(this.pos);
      _v.copy(up).multiplyScalar(d); this.addForceAt(F, Tq, _v, _aw);
      _aw.copy(wb.anchor).applyQuaternion(q).add(this.pos);
      _v.copy(up).multiplyScalar(-d); this.addForceAt(F, Tq, _v, _aw);
    }
    // aerodynamic drag + a little downforce
    const sp = this.vel.length();
    F.addScaledVector(this.vel, -0.48 * sp);
    if (onGround) F.addScaledVector(up, -0.6 * sp * sp);
    // water: drag + buoyancy
    if (this.pos.y < WATER_LEVEL + 0.4) {
      const depth = clamp(WATER_LEVEL + 0.4 - this.pos.y, 0, 1.5);
      F.y += this.mass * G * 0.8 * depth;
      F.addScaledVector(this.vel, -this.mass * 1.6 * depth);
      this.angVel.multiplyScalar(1 - 2 * dt);
      this.waterTimer += dt;
    } else this.waterTimer = 0;

    // ---- integrate ----
    this.vel.addScaledVector(F, dt / this.mass);
    const angAcc = this.applyInverseInertia(Tq);
    this.angVel.addScaledVector(angAcc, dt);
    this.angVel.multiplyScalar(onGround ? 1 - 0.6 * dt : 1 - 0.1 * dt);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.angVel;
    _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(q);
    q.x += _q.x; q.y += _q.y; q.z += _q.z; q.w += _q.w; q.normalize();

    // safety: never sink below the ground
    const gyC = terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gyC + 0.15) { this.pos.y = gyC + 0.15; if (this.vel.y < 0) this.vel.y *= -0.2; }

    this.collideWorld(dt);

    // world bounds
    const lim = WORLD_HALF - 8;
    if (Math.abs(this.pos.x) > lim) { this.pos.x = sign(this.pos.x) * lim; this.vel.x *= -0.3; }
    if (Math.abs(this.pos.z) > lim) { this.pos.z = sign(this.pos.z) * lim; this.vel.z *= -0.3; }

    // upside-down auto recovery
    if (up.y < 0.25 && this.speed < 3) this.upsideTimer += dt; else this.upsideTimer = 0;
    if (this.upsideTimer > 2.5) this.resetUpright();
    if (this.waterTimer > 5) { this.onDrowned?.(); this.waterTimer = 0; }

    // sleep parked cars to save CPU
    if (!this.driven && this.speed < 0.05 && this.angVel.lengthSq() < 0.001 && onGround === 4) {
      this.sleepTimer = (this.sleepTimer || 0) + dt;
      if (this.sleepTimer > 1.5) { this.sleeping = true; this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); }
    } else this.sleepTimer = 0;
  }

  wake() { this.sleeping = false; this.sleepTimer = 0; }

  addForceAt(F, Tq, force, point) {
    F.add(force);
    _r2.copy(point).sub(this.pos);
    _c.crossVectors(_r2, force);
    Tq.add(_c);
  }

  resetUpright() {
    const yaw = this.yaw;
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.pos.y = this.world.terrain.heightAt(this.pos.x, this.pos.z) + this.comH + 0.6;
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.upsideTimer = 0;
  }

  // Apply an impulse J (world) at world point p (rigid body response)
  applyImpulse(J, p) {
    this.vel.addScaledVector(J, 1 / this.mass);
    _r2.copy(p).sub(this.pos);
    _c.crossVectors(_r2, J);
    this.angVel.add(this.applyInverseInertia(_c));
    this.wake();
  }

  // Effective inverse mass along normal n at contact r (planar contact, r.y forced small)
  invMassAt(r, n) {
    _c.crossVectors(r, n);
    const ia = this.applyInverseInertia(_c);
    _c2.crossVectors(ia, r);
    return 1 / this.mass + n.dot(_c2);
  }

  // OBB footprint in xz: centre, forward axis, half extents
  footprint() {
    const f = this.forward(_ff); const fx = f.x, fz = f.z, l = Math.hypot(fx, fz) || 1;
    return { cx: this.pos.x, cz: this.pos.z, fx: fx / l, fz: fz / l, hw: this.T.W / 2, hl: this.T.L / 2 };
  }

  collideWorld(dt) {
    const fp = this.footprint();
    const col = this.world.collision;
    const rad = fp.hl + 1;
    const boxes = col.queryBoxes(fp.cx - rad, fp.cz - rad, fp.cx + rad, fp.cz + rad, _boxes);
    for (const b of boxes) {
      if (b.h < this.pos.y - this.comH - 0.3) continue;
      const hit = obbVsAabb(fp, b);
      if (hit) this.resolveContact(hit, 0.15, dt);
    }
    const circles = col.queryCircles(fp.cx - rad, fp.cz - rad, fp.cx + rad, fp.cz + rad, _circles);
    for (const ci of circles) {
      const hit = obbVsCircle(fp, ci);
      if (hit) this.resolveContact(hit, 0.2, dt);
    }
  }

  resolveContact(hit, restitution, dt) {
    // hit: {nx, nz, depth, px, pz} normal points from obstacle to car
    _n.set(hit.nx, 0, hit.nz);
    this.pos.x += hit.nx * hit.depth; this.pos.z += hit.nz * hit.depth;
    _r.set(hit.px - this.pos.x, 0, hit.pz - this.pos.z);
    _vc.crossVectors(this.angVel, _r).add(this.vel);
    const vn = _vc.dot(_n);
    if (vn >= 0) return;
    const k = this.invMassAt(_r, _n);
    const j = -(1 + restitution) * vn / k;
    _v.copy(_n).multiplyScalar(j);
    // friction
    _t.copy(_vc).addScaledVector(_n, -vn); _t.y = 0;
    const tl = _t.length();
    if (tl > 1e-4) {
      _t.multiplyScalar(1 / tl);
      const kt = this.invMassAt(_r, _t);
      const jt = clamp(-tl / kt, -0.4 * j, 0.4 * j);
      _v.addScaledVector(_t, jt);
    }
    _p.set(hit.px, this.pos.y, hit.pz);
    this.vel.addScaledVector(_v, 1 / this.mass);
    _c.crossVectors(_r, _v);
    const dw = this.applyInverseInertia(_c);
    this.angVel.x += dw.x * 0.15; this.angVel.y += dw.y; this.angVel.z += dw.z * 0.15;
    const impact = j / this.mass;
    if (impact > this.impact) this.impact = impact;
    this.wake();
  }

  syncVisual(dt) {
    const vis = this.visual;
    vis.group.quaternion.copy(this.quat);
    _v.set(0, -this.comH, 0).applyQuaternion(this.quat);
    vis.group.position.copy(this.pos).add(_v);
    // keep the contact shadow on the ground (and fade it out when airborne)
    if (vis.contact) {
      const gy = this.world.terrain.heightAt(this.pos.x, this.pos.z);
      const lift = Math.max(0, vis.group.position.y - gy);
      vis.contact.position.y = 0.025 - lift;
      vis.contact.scale.setScalar(Math.max(0.2, 1 - lift * 0.6));
    }
    vis.wheelSteer = this.steer;
    const base = this.restLen - this.staticComp;
    this.wheels.forEach((w, i) => {
      // keep the angle bounded and finite so the wheel can never vanish
      w.spin = (w.spin + w.omega * dt) % (Math.PI * 2);
      if (!Number.isFinite(w.spin)) { w.spin = 0; w.omega = 0; }
      vis.wheelSpin[i] = w.spin;
      vis.wheelDrop[i] = base - w.susp;
    });
  }
}

// ---------- 2D collision helpers ----------
export function obbCorners(fp, out) {
  const rx = -fp.fz, rz = fp.fx;
  let k = 0;
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out[k++] = fp.cx + fp.fx * fp.hl * a + rx * fp.hw * b;
    out[k++] = fp.cz + fp.fz * fp.hl * a + rz * fp.hw * b;
  }
  return out;
}
const _corn = new Float64Array(8), _corn2 = new Float64Array(8);

export function obbVsAabb(fp, b) {
  const bcx = (b.minX + b.maxX) / 2, bcz = (b.minZ + b.maxZ) / 2;
  const bhx = (b.maxX - b.minX) / 2, bhz = (b.maxZ - b.minZ) / 2;
  const rx = -fp.fz, rz = fp.fx;
  const axes = [[1, 0], [0, 1], [fp.fx, fp.fz], [rx, rz]];
  let best = Infinity, bnx = 0, bnz = 0, bi = -1;
  const dx = fp.cx - bcx, dz = fp.cz - bcz;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = axes[i];
    const rc = fp.hl * Math.abs(fp.fx * ax + fp.fz * az) + fp.hw * Math.abs(rx * ax + rz * az);
    const rb = bhx * Math.abs(ax) + bhz * Math.abs(az);
    const d = dx * ax + dz * az;
    const o = rc + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const s = d >= 0 ? 1 : -1; bnx = ax * s; bnz = az * s; bi = i; }
  }
  let px, pz;
  if (bi < 2) {
    // deepest car corner against the box face
    obbCorners(fp, _corn);
    let m = Infinity;
    for (let k = 0; k < 4; k++) { const v = _corn[k * 2] * bnx + _corn[k * 2 + 1] * bnz; if (v < m) { m = v; px = _corn[k * 2]; pz = _corn[k * 2 + 1]; } }
  } else {
    // deepest box corner into the car
    let m = -Infinity;
    for (const [cx, cz] of [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]]) {
      const v = cx * bnx + cz * bnz; if (v > m) { m = v; px = cx; pz = cz; }
    }
  }
  return { nx: bnx, nz: bnz, depth: best, px, pz };
}

export function obbVsCircle(fp, c) {
  const rx = -fp.fz, rz = fp.fx;
  const dx = c.x - fp.cx, dz = c.z - fp.cz;
  const lf = dx * fp.fx + dz * fp.fz, lr = dx * rx + dz * rz;
  const cf = clamp(lf, -fp.hl, fp.hl), cr = clamp(lr, -fp.hw, fp.hw);
  const qx = fp.cx + fp.fx * cf + rx * cr, qz = fp.cz + fp.fz * cf + rz * cr;
  let nx = qx - c.x, nz = qz - c.z;
  const d = Math.hypot(nx, nz);
  if (d >= c.r) return null;
  if (d < 1e-5) {
    // centre inside: push out along the shallowest local axis
    const pf = fp.hl - Math.abs(lf), pr = fp.hw - Math.abs(lr);
    if (pf < pr) { nx = -fp.fx * sign(lf); nz = -fp.fz * sign(lf); return { nx, nz, depth: pf + c.r, px: c.x, pz: c.z }; }
    nx = -rx * sign(lr); nz = -rz * sign(lr); return { nx, nz, depth: pr + c.r, px: c.x, pz: c.z };
  }
  return { nx: nx / d, nz: nz / d, depth: c.r - d, px: qx, pz: qz };
}

// OBB vs OBB (SAT). Normal points from B to A. Contact = deepest corner.
export function obbVsObb(A, B) {
  const axes = [[A.fx, A.fz], [-A.fz, A.fx], [B.fx, B.fz], [-B.fz, B.fx]];
  const dx = A.cx - B.cx, dz = A.cz - B.cz;
  let best = Infinity, nx = 0, nz = 0, bi = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = axes[i];
    const ra = A.hl * Math.abs(A.fx * ax + A.fz * az) + A.hw * Math.abs(-A.fz * ax + A.fx * az);
    const rb = B.hl * Math.abs(B.fx * ax + B.fz * az) + B.hw * Math.abs(-B.fz * ax + B.fx * az);
    const d = dx * ax + dz * az;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const s = d >= 0 ? 1 : -1; nx = ax * s; nz = az * s; bi = i; }
  }
  let px = 0, pz = 0;
  if (bi < 2) {
    obbCorners(B, _corn2); let m = -Infinity;
    for (let k = 0; k < 4; k++) { const v = _corn2[k * 2] * nx + _corn2[k * 2 + 1] * nz; if (v > m) { m = v; px = _corn2[k * 2]; pz = _corn2[k * 2 + 1]; } }
  } else {
    obbCorners(A, _corn2); let m = Infinity;
    for (let k = 0; k < 4; k++) { const v = _corn2[k * 2] * nx + _corn2[k * 2 + 1] * nz; if (v < m) { m = v; px = _corn2[k * 2]; pz = _corn2[k * 2 + 1]; } }
  }
  return { nx, nz, depth: best, px, pz };
}

const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _ff = new THREE.Vector3();
const _F = new THREE.Vector3(), _Tq = new THREE.Vector3(), _aw = new THREE.Vector3(), _wf = new THREE.Vector3(), _wr = new THREE.Vector3();
const _r = new THREE.Vector3(), _r2 = new THREE.Vector3(), _vc = new THREE.Vector3(), _c = new THREE.Vector3(), _c2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qInv = new THREE.Quaternion(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
const _boxes = [], _circles = [];
void _v2; void _m3;

// ---------- skid marks ----------
export class SkidMarks {
  constructor(scene, max = 1600) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.02, vA); }',
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.i = 0;
    this.last = new Map();
  }
  add(key, p, dirX, dirZ, width, strength, groundY) {
    const prev = this.last.get(key);
    this.last.set(key, { x: p.x, z: p.z, y: groundY, t: performance.now() });
    if (!prev || strength <= 0) return;
    const dx = p.x - prev.x, dz = p.z - prev.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05 || d > 3) return;
    const nx = -dz / d * width / 2, nz = dx / d * width / 2;
    const b = (this.i % this.max) * 4;
    const P = this.pos;
    const y0 = prev.y + 0.025, y1 = groundY + 0.025;
    P.set([prev.x - nx, y0, prev.z - nz, prev.x + nx, y0, prev.z + nz, p.x + nx, y1, p.z + nz, p.x - nx, y1, p.z - nz], b * 3);
    const a = clamp(strength, 0, 1) * 0.55;
    this.alpha.set([a, a, a, a], b);
    this.i++;
    this.dirty = true;
  }
  cut(key) { this.last.delete(key); }
  update() {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.dirty = false;
  }
}

// ---------- tyre smoke ----------
export class TireSmoke {
  constructor(scene, max = 260) {
    this.max = max;
    this.p = []; for (let i = 0; i < max; i++) this.p.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 });
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.a = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color(0.85, 0.85, 0.85) } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float uScale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; uniform vec3 uColor;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor, a); }`,
    });
    this.mat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.k = 0;
  }
  emit(x, y, z, vx, vz, amount) {
    const p = this.p[this.k++ % this.max];
    p.life = 1; p.x = x; p.y = y + 0.2; p.z = z;
    p.vx = vx * 0.3 + (Math.random() - 0.5); p.vy = 0.6 + Math.random() * 0.8; p.vz = vz * 0.3 + (Math.random() - 0.5);
    p.s = 0.8 + Math.random() * 0.6; p.amt = clamp(amount, 0.2, 1);
  }
  update(dt, night) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life > 0) {
        p.life -= dt * 0.45;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 1 - dt; p.vz *= 1 - dt; p.vy *= 1 - 0.5 * dt;
        p.s += dt * 2.2;
      }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.life > 0 ? p.s : 0;
      this.a[i] = p.life > 0 ? p.life * 0.24 * (p.amt || 1) : 0;
    }
    this.mat.uniforms.uColor.value.setScalar(lerp(0.85, 0.25, night));
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
  }
}
