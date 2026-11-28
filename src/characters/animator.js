// Procedural animation: biomechanically-shaped gait curves (heel strike, stance
// knee flex, toe-off, swing), arm counter-swing, pelvis rotation/bob, running lean,
// idle breathing & weight shift, jump/fall, swimming, seated driving, knock-down
// and get-up. Emits footstep events at heel strike.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/utils.js';

const D = Math.PI / 180;
const bump = (p, c, w) => { let d = p - c; d -= Math.round(d); return Math.exp(-(d * d) / (w * w)); };

export class Animator {
  constructor(human) {
    this.h = human;
    this.b = human.bones;
    this.phase = Math.random();
    this.time = Math.random() * 10;
    this.mode = 'move'; // move | air | swim | drive | down | getup | sit | lie
    this.speed = 0;
    this.turn = 0;
    this.steer = 0;
    this.blendDown = 0;
    this.lastStepSide = 0;
    this.onStep = null;
    this.e = new THREE.Euler();
    this.targets = {};
    this.look = 0;
    this.vy = 0;
  }
  set(name, x, y = 0, z = 0) {
    const t = this.targets[name] || (this.targets[name] = new THREE.Vector3());
    t.set(x, y, z);
  }
  apply(blend) {
    for (const k in this.targets) {
      const bone = this.b[k];
      const t = this.targets[k];
      this.e.set(t.x, t.y, t.z, 'YXZ');
      const q = new THREE.Quaternion().setFromEuler(this.e);
      if (blend >= 1) bone.quaternion.copy(q); else bone.quaternion.slerp(q, blend);
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const v = this.speed;
    const b = this.b;
    for (const k in this.targets) this.targets[k].set(0, 0, 0);
    let hipY = 0, hipZ = 0, blend = 1;

    if (this.mode === 'move' || this.mode === 'air') {
      const stride = clamp(0.9 + 0.45 * v, 1.0, 3.6);
      const freq = v > 0.05 ? v / stride : 0;
      const prev = this.phase;
      this.phase = (this.phase + freq * dt) % 1;
      // footstep events at heel strike (phase 0 for left, 0.5 for right)
      if (freq > 0 && this.mode === 'move') {
        if (prev > this.phase || (prev < 0.5 && this.phase >= 0.5)) this.onStep?.(prev > this.phase ? 'L' : 'R', v);
      }
      const run = smoothstep(2.3, 4.2, v);
      const sprint = smoothstep(5, 7.5, v);
      const walk = smoothstep(0.05, 0.9, v);
      const idle = 1 - walk;
      const tA = lerp(24, 40, run) * D * walk, tB = lerp(22, 26, run) * D * walk;
      const kneeSwing = lerp(60, 105, run) * D, kneeStance = lerp(12, 28, run) * D;
      for (const [side, off] of [['L', 0], ['R', 0.5]]) {
        const p = (this.phase + off) % 1;
        const c = Math.cos(p * Math.PI * 2);
        const thigh = c > 0 ? c * tA : c * tB;
        let knee = (kneeStance * bump(p, 0.12, 0.09) + kneeSwing * bump(p, run > 0.5 ? 0.64 : 0.72, run > 0.5 ? 0.16 : 0.12)) * walk;
        let ankle = (-8 * bump(p, 0.0, 0.08) + lerp(18, 28, run) * bump(p, 0.56, 0.07) - 6 * bump(p, 0.8, 0.1)) * D * walk;
        // idle: slight knee flex, weight shift
        knee += idle * (4 + (side === 'L' ? 2 : 0) * (0.5 + 0.5 * Math.sin(t * 0.4))) * D;
        this.set('thigh' + side, -thigh - run * 6 * D * walk, 0, side === 'L' ? 0.03 : -0.03);
        this.set('shin' + side, knee);
        this.set('foot' + side, ankle - knee * 0.2 + thigh * 0.25);
        // arms counter swing
        const aA = lerp(16, 42, run) * D * walk;
        const arm = (side === 'L' ? Math.cos(this.phase * Math.PI * 2) : Math.cos((this.phase + 0.5) * Math.PI * 2)) * aA;
        const elbow = lerp(12, 88, run) * D * walk + idle * 8 * D + (walk * (1 - run)) * 6 * D * (0.5 + 0.5 * Math.sin(p * Math.PI * 2));
        const abd = (6 + run * 4) * D;
        this.set('upperArm' + side, arm + idle * 2 * D * Math.sin(t * 0.8), 0, side === 'L' ? abd : -abd);
        this.set('forearm' + side, -elbow);
        this.set('hand' + side, -0.1 * run, 0, 0);
      }
      const bob = walk * (run > 0.5 ? 0.05 : 0.022);
      hipY = -Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0 + (run > 0.5 ? Math.abs(Math.cos(this.phase * Math.PI * 4)) * bob - bob : -Math.cos(this.phase * Math.PI * 4) * bob * 0.5 - bob * 0.5);
      hipY -= run * 0.04;
      const lean = (run * 9 + sprint * 8) * D;
      const pelvisYaw = Math.sin(this.phase * Math.PI * 2) * lerp(5, 9, run) * D * walk;
      const pelvisRoll = Math.sin(this.phase * Math.PI * 4) * 2.5 * D * walk * (1 - run * 0.5);
      this.set('hips', lean * 0.5, pelvisYaw, pelvisRoll + idle * 1.5 * D * Math.sin(t * 0.4));
      this.set('spine', lean * 0.5 + idle * Math.sin(t * 1.7) * 0.6 * D, -pelvisYaw * 0.9, -pelvisRoll * 0.6 - this.turn * 0.08);
      this.set('chest', idle * Math.sin(t * 1.7 + 0.5) * 1.2 * D, -pelvisYaw * 0.6, 0);
      this.set('neck', -lean * 0.4, 0, 0);
      this.set('head', -lean * 0.4 + idle * 2 * D * Math.sin(t * 0.3), this.look + idle * 12 * D * Math.sin(t * 0.23) * Math.sin(t * 0.11), 0);
      if (this.mode === 'air') {
        const up = clamp(this.vy / 5, -1, 1);
        for (const s of ['L', 'R']) {
          this.set('thigh' + s, -(30 + (s === 'L' ? 15 : -5)) * D, 0, s === 'L' ? 0.05 : -0.05);
          this.set('shin' + s, (55 + (s === 'L' ? 20 : 0)) * D);
          this.set('foot' + s, 10 * D);
          this.set('upperArm' + s, -20 * D, 0, (s === 'L' ? 1 : -1) * (25 + up * 15) * D);
          this.set('forearm' + s, -40 * D);
        }
        this.set('spine', 8 * D, 0, 0);
        blend = clamp(dt * 10, 0, 1);
      }
    } else if (this.mode === 'swim') {
      const f = 0.55;
      this.phase = (this.phase + f * dt * (0.4 + Math.min(1, v))) % 1;
      const p = this.phase * Math.PI * 2;
      this.set('hips', 78 * D, 0, Math.sin(p) * 12 * D);
      this.set('spine', -10 * D, 0, 0);
      this.set('neck', -35 * D, 0, 0);
      this.set('head', -25 * D, Math.sin(p) * 15 * D, 0);
      this.set('upperArmL', -Math.PI + p, 0, 0.25);
      this.set('upperArmR', -Math.PI + p + Math.PI, 0, -0.25);
      this.set('forearmL', -0.3); this.set('forearmR', -0.3);
      const kick = Math.sin(t * 9) * 14 * D;
      this.set('thighL', kick, 0, 0.05); this.set('thighR', -kick, 0, -0.05);
      this.set('shinL', 18 * D); this.set('shinR', 18 * D);
      this.set('footL', 40 * D); this.set('footR', 40 * D);
      hipY = -0.15;
      blend = clamp(dt * 6, 0, 1);
    } else if (this.mode === 'drive' || this.mode === 'sit') {
      const st = this.mode === 'drive' ? this.steer : 0;
      this.set('hips', 0, 0, 0);
      for (const s of ['L', 'R']) {
        this.set('thigh' + s, -84 * D, 0, s === 'L' ? 0.1 : -0.1);
        this.set('shin' + s, 78 * D);
        this.set('foot' + s, -8 * D);
      }
      this.set('spine', -8 * D, 0, 0);
      this.set('chest', -4 * D, 0, -st * 3 * D);
      this.set('head', 4 * D, -st * 6 * D, 0);
      if (this.mode === 'drive') {
        this.set('upperArmL', -52 * D + st * 8 * D, 0, 14 * D);
        this.set('upperArmR', -52 * D - st * 8 * D, 0, -14 * D);
        this.set('forearmL', -38 * D, 0, 0); this.set('forearmR', -38 * D, 0, 0);
      } else {
        this.set('upperArmL', -10 * D, 0, 8 * D); this.set('upperArmR', -10 * D, 0, -8 * D);
        this.set('forearmL', -60 * D); this.set('forearmR', -60 * D);
      }
      hipY = -0.42;
      hipZ = -0.05;
      blend = clamp(dt * 8, 0, 1);
    } else if (this.mode === 'lie') {
      this.set('hips', -88 * D, 0, 0);
      this.set('upperArmL', -150 * D, 0, 20 * D); this.set('upperArmR', -150 * D, 0, -20 * D);
      this.set('forearmL', -40 * D); this.set('forearmR', -40 * D);
      this.set('thighL', 2 * D, 0, 0.12); this.set('thighR', 4 * D, 0, -0.06);
      this.set('shinR', 25 * D);
      this.set('head', 10 * D, 0.3 * Math.sin(t * 0.1), 0);
      hipY = -0.78; hipZ = 0;
      blend = clamp(dt * 6, 0, 1);
    } else if (this.mode === 'down' || this.mode === 'getup') {
      // knocked down on the back, then get up (blend back to stand)
      const k = this.mode === 'down' ? 1 : clamp(1 - this.getupT / 1.1, 0, 1);
      this.set('hips', -82 * D * k, 0, 0.2 * k);
      this.set('spine', 8 * D * k, 0, 0);
      this.set('upperArmL', -60 * D * k, 0, 70 * D * k); this.set('upperArmR', -40 * D * k, 0, -80 * D * k);
      this.set('forearmL', -50 * D * k); this.set('forearmR', -30 * D * k);
      this.set('thighL', -30 * D * k, 0, 0.2 * k); this.set('thighR', -5 * D * k, 0, -0.15 * k);
      this.set('shinL', 60 * D * k); this.set('shinR', 15 * D * k);
      hipY = -0.8 * k;
      blend = clamp(dt * (this.mode === 'down' ? 12 : 8), 0, 1);
      if (this.mode === 'getup') { this.getupT = (this.getupT || 0) + dt; if (this.getupT > 1.1) { this.mode = 'move'; this.getupT = 0; } }
    }
    this.apply(blend);
    // hip height & position (bone positions in rest units)
    const hb = b.hips;
    hb.position.y = lerp(hb.position.y, 0.95 + hipY, blend >= 1 ? 1 : blend);
    hb.position.z = lerp(hb.position.z, hipZ, blend >= 1 ? 1 : blend);
  }
}
