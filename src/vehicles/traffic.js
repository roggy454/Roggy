// AI traffic: cars follow right-hand lanes on the road graph, turn through
// intersections on smooth curves, obey traffic lights, keep distance with an
// IDM car-following model, yield to pedestrians/player and indicate turns.
// When rammed they turn into full physics wrecks.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { edges, nodes, signalState, HALF_ROAD, LANE_OFFSETS, slabs } from '../world/map.js';
import { RNG, clamp, lerp, wrapAngle } from '../core/utils.js';
import { STATE } from '../core/globals.js';

const TYPE_WEIGHTS = [['sedan', 20], ['taxi', 9], ['suv', 16], ['hatch', 13], ['coupe', 6], ['van', 7], ['truck', 12], ['wagon', 7], ['muscle', 6], ['supercar', 4]];
function pickType(rng) {
  let r = rng.next() * 100;
  for (const [k, w] of TYPE_WEIGHTS) { if ((r -= w) < 0) return k; }
  return 'sedan';
}

function laneGeom(edge, forward, lane) {
  const A = forward ? edge.a : edge.b, B = forward ? edge.b : edge.a;
  const dx = forward ? edge.dx : -edge.dx, dz = forward ? edge.dz : -edge.dz;
  const rx = -dz, rz = dx;
  const off = LANE_OFFSETS[lane];
  return {
    A, B, dx, dz,
    sx: A.x + dx * HALF_ROAD + rx * off, sz: A.z + dz * HALF_ROAD + rz * off,
    ex: B.x - dx * HALF_ROAD + rx * off, ez: B.z - dz * HALF_ROAD + rz * off,
    len: edge.len - 2 * HALF_ROAD,
    axis: edge.axis,
  };
}

function bezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  out.x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
  out.z = u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z;
  return out;
}

let VID = 1;
export class Traffic {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(777);
    this.cars = [];
    this.parked = [];
    this.wrecks = [];
    this.pendingWrecks = [];
    this.spawnTimer = 0;
  }

  newVehicle(type, opts = {}) {
    const v = new Vehicle(this.game, type, { rng: this.rng, ...opts });
    v.id = VID++;
    return v;
  }

  spawnParked() {
    // parking lots
    for (const s of slabs) {
      if (s.kind !== 'parking' || !s.stalls) continue;
      for (const st of s.stalls) {
        if (!this.rng.chance(0.3)) continue;
        const v = this.newVehicle(pickType(this.rng));
        v.setPose(st.x, 0.15, st.z, this.rng.chance(0.5) ? 0 : Math.PI);
        v.mode = 'parked';
        this.parked.push(v);
      }
    }
  }

  spawnShowcase(x, z, yaw, type, color) {
    const v = this.newVehicle(type, { color });
    v.setPose(x, 0.15, z, yaw);
    v.mode = 'parked';
    this.parked.push(v);
    return v;
  }

  randomLanePlacement(focus, minD, maxD) {
    for (let tries = 0; tries < 30; tries++) {
      const e = this.rng.pick(edges);
      const fwd = this.rng.chance(0.5);
      const lane = this.rng.int(0, 1);
      const g = laneGeom(e, fwd, lane);
      const t = this.rng.range(8, Math.max(9, g.len - 20));
      const x = g.sx + g.dx * t, z = g.sz + g.dz * t;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d < minD || d > maxD) continue;
      // keep clear of other cars
      let ok = true;
      for (const c of this.cars) if ((c.pos.x - x) ** 2 + (c.pos.z - z) ** 2 < 144) { ok = false; break; }
      if (ok) return { e, fwd, lane, g, t, x, z };
    }
    return null;
  }

  spawn(focus, minD = 90, maxD = 340) {
    const pl = this.randomLanePlacement(focus, minD, maxD);
    if (!pl) return;
    const v = this.newVehicle(pickType(this.rng));
    v.mode = 'ai';
    v.ai = { edge: pl.e, fwd: pl.fwd, lane: pl.lane, g: pl.g, t: pl.t, state: 'lane', speed: pl.e.speed * 0.7, desire: pl.e.speed * this.rng.range(0.85, 1.12), next: null, turn: null, s: 0, honk: 0, stuck: 0 };
    this.chooseNext(v);
    v.setPose(pl.x, 0, pl.z, Math.atan2(pl.g.dx, pl.g.dz));
    this.cars.push(v);
  }

  chooseNext(v) {
    const ai = v.ai;
    const B = ai.g.B;
    const opts = B.edges.filter((e) => e !== ai.edge);
    const e = opts.length ? this.rng.pick(opts) : ai.edge;
    const fwd = e.a === B;
    // keep lane; prefer outer lane for right turns, inner for left
    const g0 = ai.g;
    const ng = laneGeom(e, fwd, ai.lane);
    const cross = g0.dx * ng.dz - g0.dz * ng.dx; // >0: turning right (x east, z south)
    let lane = ai.lane;
    if (cross > 0.5) lane = 1; else if (cross < -0.5) lane = 0;
    ai.next = { e, fwd, lane, g: laneGeom(e, fwd, lane), turn: cross > 0.5 ? 1 : cross < -0.5 ? -1 : 0 };
  }

  queueWreck(v, imp) { if (!this.pendingWrecks.includes(v)) this.pendingWrecks.push(v); }

  makeWreck(v) {
    const i = this.cars.indexOf(v);
    if (i >= 0) this.cars.splice(i, 1);
    const vel = v.vel.clone();
    v.ai = null;
    v.mode = 'wreck';
    v.enablePhysics(vel);
    v.mode = 'wreck';
    v.hazard = true;
    v.vp.throttle = 0; v.vp.brake = 0.3;
    this.wrecks.push(v);
  }

  // detach a vehicle for the player (from any list)
  claim(v) {
    for (const list of [this.cars, this.parked, this.wrecks]) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); }
    v.ai = null;
    v.hazard = false;
  }
  release(v) {
    // player left the car: it stays as a parked physics car
    v.mode = 'parked';
    this.parked.push(v);
  }

  all() { return [...this.cars, ...this.parked, ...this.wrecks]; }

  update(dt, focus, playerVehicle, pedestrians, playerOnFoot) {
    // wrecks from collisions
    for (const v of this.pendingWrecks) if (v.mode === 'ai') this.makeWreck(v);
    this.pendingWrecks.length = 0;
    const time = this.game.time;
    const target = STATE.q.traffic;
    // despawn far
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      const d = Math.hypot(v.pos.x - focus.x, v.pos.z - focus.z);
      if (d > 460 || v.ai.stuck > 40) { v.dispose(); this.cars.splice(i, 1); }
    }
    this.spawnTimer -= dt;
    if (this.cars.length < target && this.spawnTimer <= 0) {
      this.spawn(focus, this.cars.length < target * 0.5 ? 40 : 110, 360);
      this.spawnTimer = 0.15;
    }
    // leaders: brute force neighbour list
    const all = this.cars;
    const others = [];
    if (playerVehicle) others.push({ pos: playerVehicle.pos, vel: playerVehicle.vel, halfL: playerVehicle.halfL });
    for (const w of this.wrecks) others.push({ pos: w.pos, vel: w.vel, halfL: w.halfL });
    for (const p of this.parked) if (p.vp) others.push({ pos: p.pos, vel: p.vel, halfL: p.halfL });
    const tmp = { x: 0, z: 0 };
    for (const v of all) {
      const ai = v.ai;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      // ---- leader gap
      let gap = 999, leadV = 0;
      const look = 32 + ai.speed * 1.2;
      const consider = (px, pz, hl, lvx, lvz, latMax) => {
        const dx = px - v.pos.x, dz = pz - v.pos.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > look) return;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > latMax) return;
        const g = ahead - v.halfL - hl;
        if (g < gap) { gap = g; leadV = lvx * fx + lvz * fz; }
      };
      for (const o of all) if (o !== v) consider(o.pos.x, o.pos.z, o.halfL, o.vel.x, o.vel.z, 1.7);
      for (const o of others) consider(o.pos.x, o.pos.z, o.halfL, o.vel.x, o.vel.z, 1.9);
      let pedAhead = false;
      for (const p of pedestrians) {
        if (!p.onRoad) continue;
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
        const ahead = dx * fx + dz * fz;
        if (ahead > 0 && ahead < 14 && Math.abs(dx * fz - dz * fx) < 2.0) { gap = Math.min(gap, ahead - v.halfL - 1.5); leadV = 0; pedAhead = true; }
      }
      if (playerOnFoot) {
        const dx = playerOnFoot.x - v.pos.x, dz = playerOnFoot.z - v.pos.z;
        const ahead = dx * fx + dz * fz;
        if (ahead > 0 && ahead < 16 && Math.abs(dx * fz - dz * fx) < 2.0) {
          gap = Math.min(gap, ahead - v.halfL - 2); leadV = 0;
          ai.honk += dt;
        }
      }
      // ---- signal / stop line
      let stopDist = 999;
      if (ai.state === 'lane') {
        const remain = ai.g.len - ai.t;
        const st = signalState(ai.g.B, ai.g.axis, time);
        if (st !== 'green' && remain < 60) {
          const toLine = remain - 4.9 - v.halfL;
          if (st === 'red' || (st === 'yellow' && toLine > ai.speed * 1.2)) stopDist = toLine;
        }
        if (remain < 30) v.indicator = ai.next ? ai.next.turn : 0;
        if (ai.next && ai.next.turn === -1 && remain < 12) {
          for (const o of all) {
            if (o === v) continue;
            const odx = o.pos.x - v.pos.x, odz = o.pos.z - v.pos.z;
            const ofx = Math.sin(o.yaw), ofz = Math.cos(o.yaw);
            if (ofx * fx + ofz * fz > -0.7) continue;
            const ahead = odx * fx + odz * fz;
            if (ahead > 0 && ahead < 45 && Math.abs(odx * fz - odz * fx) < 9 && o.ai && o.ai.speed > 1) { stopDist = Math.min(stopDist, remain - 4.9 - v.halfL); break; }
          }
        }
      }
      // ---- IDM acceleration
      const v0 = ai.state === 'turn' ? Math.min(ai.desire, ai.next && ai.next.turn ? 7.5 : ai.desire) : ai.desire;
      const aMax = 2.2, bComf = 3.0, s0 = 2.2, T = 1.2;
      const sp = ai.speed;
      let acc = aMax * (1 - Math.pow(sp / Math.max(v0, 0.1), 4));
      const effGap = Math.min(gap, stopDist);
      const dv = sp - (stopDist < gap ? 0 : leadV);
      if (effGap < 900) {
        const sStar = s0 + Math.max(0, sp * T + sp * dv / (2 * Math.sqrt(aMax * bComf)));
        acc -= aMax * Math.pow(sStar / Math.max(0.3, effGap), 2);
      }
      // slow before turns
      if (ai.state === 'lane' && ai.next && ai.next.turn) {
        const remain = ai.g.len - ai.t;
        if (remain < 25) acc = Math.min(acc, (7.5 * 7.5 - sp * sp) / (2 * Math.max(2, remain)));
      }
      acc = clamp(acc, -8, aMax);
      ai.speed = Math.max(0, sp + acc * dt);
      if (ai.speed < 0.2 && effGap > 50 && stopDist > 50) ai.stuck += dt; else if (ai.speed > 1) ai.stuck = 0;
      v.brakeLevel = acc < -0.6 || ai.speed < 0.3 ? 1 : 0;
      // ---- advance along path
      let d = ai.speed * dt;
      let px, pz, yaw;
      if (ai.state === 'lane') {
        ai.t += d;
        if (ai.t >= ai.g.len) {
          const over = ai.t - ai.g.len;
          const n = ai.next;
          const p0 = { x: ai.g.ex, z: ai.g.ez }, p3 = { x: n.g.sx, z: n.g.sz };
          const k = Math.hypot(p3.x - p0.x, p3.z - p0.z) * 0.5;
          const p1 = { x: p0.x + ai.g.dx * k, z: p0.z + ai.g.dz * k }, p2 = { x: p3.x - n.g.dx * k, z: p3.z - n.g.dz * k };
          let len = 0; const a = { x: 0, z: 0 }, b = { x: p0.x, z: p0.z };
          for (let i = 1; i <= 12; i++) { bezier(p0, p1, p2, p3, i / 12, a); len += Math.hypot(a.x - b.x, a.z - b.z); b.x = a.x; b.z = a.z; }
          ai.turn = { p0, p1, p2, p3, len };
          ai.s = over; ai.state = 'turn';
        }
      } else {
        ai.s += d;
      }
      if (ai.state === 'turn' && ai.s >= ai.turn.len) {
        const n = ai.next;
        ai.edge = n.e; ai.fwd = n.fwd; ai.lane = n.lane; ai.g = n.g; ai.t = ai.s - ai.turn.len; ai.state = 'lane';
        ai.desire = n.e.speed * this.rng.range(0.85, 1.12);
        v.indicator = 0;
        this.chooseNext(v);
      }
      if (ai.state === 'lane') {
        px = ai.g.sx + ai.g.dx * ai.t; pz = ai.g.sz + ai.g.dz * ai.t;
        yaw = Math.atan2(ai.g.dx, ai.g.dz);
      } else {
        const tt = clamp(ai.s / ai.turn.len, 0, 1);
        bezier(ai.turn.p0, ai.turn.p1, ai.turn.p2, ai.turn.p3, tt, tmp);
        px = tmp.x; pz = tmp.z;
        const t2 = Math.min(1, tt + 0.02);
        const b2 = bezier(ai.turn.p0, ai.turn.p1, ai.turn.p2, ai.turn.p3, t2, { x: 0, z: 0 });
        const t1 = Math.max(0, tt - 0.02);
        const b1 = bezier(ai.turn.p0, ai.turn.p1, ai.turn.p2, ai.turn.p3, t1, { x: 0, z: 0 });
        yaw = Math.atan2(b2.x - b1.x, b2.z - b1.z);
      }
      const prevYaw = v.yaw;
      v.vel.set(Math.sin(yaw) * ai.speed, 0, Math.cos(yaw) * ai.speed);
      v.pos.set(px, 0, pz);
      v.yaw = yaw;
      v.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      v.speed = ai.speed;
      const yawRate = wrapAngle(yaw - prevYaw) / Math.max(dt, 1e-3);
      v.steerVis = lerp(v.steerVis, clamp(yawRate * v.spec.wb / Math.max(ai.speed, 1), -0.6, 0.6), 0.2);
      // horn at blocking player
      if (ai.honk > 1.2) { this.game.audio?.horn(v, 0.6); ai.honk = -3; }
      // kinematic collider only near the player
      const dFocus = (v.pos.x - focus.x) ** 2 + (v.pos.z - focus.z) ** 2;
      if (dFocus < 110 * 110) v.ensureKinematic(); else v.removeKinematic();
    }
    // parked: physics only near focus
    for (const v of [...this.parked, ...this.wrecks]) {
      const d2 = (v.pos.x - focus.x) ** 2 + (v.pos.z - focus.z) ** 2;
      if (!v.vp && d2 < 70 * 70) { v.enablePhysics(); if (v.vp) { v.vp.brake = 0.4; v.vp.handbrake = true; } }
      else if (v.vp && d2 > 95 * 95 && v.vp.body.sleepState === 2) { v.syncFromPhysics(); v.disablePhysics(); }
      if (v.vp && v.mode !== 'player') { v.vp.throttle = 0; v.vp.steer = 0; }
    }
  }

  updateVisuals(dt, night) {
    for (const v of this.cars) v.update(dt, night);
    for (const v of this.parked) v.update(dt, night);
    for (const v of this.wrecks) v.update(dt, night);
  }
}
