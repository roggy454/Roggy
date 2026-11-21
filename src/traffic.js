// NPC traffic. Cars follow lane centre lines and Bézier turn paths through intersections,
// obey traffic lights, yield on left turns, keep the box clear, follow the car ahead with the
// Intelligent Driver Model, stop for pedestrians and the player, change lanes around stopped
// obstacles and get knocked around (then recover) when you hit them.
import * as THREE from 'three';
import { STOP_DIST, WORLD_HALF } from './config.js';
import { signalState, greenLeft } from './city.js';
import { CarVisual, PAINTS } from './carModel.js';
import { clamp, lerp, wrapAngle, sign, dampAngle, RNG } from './utils.js';

const TYPE_WEIGHTS = [['sedan', 30], ['hatch', 22], ['suv', 20], ['taxi', 12], ['van', 7], ['pickup', 8], ['sports', 6]];

class BezierPath {
  constructor(p0, p1, p2, p3, n = 28) {
    this.pts = []; this.len = [0];
    let total = 0, prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
      const z = u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z;
      if (prev) { total += Math.hypot(x - prev.x, z - prev.z); this.len.push(total); }
      prev = { x, z }; this.pts.push(prev);
    }
    this.length = total;
  }
  sample(s, out) {
    s = clamp(s, 0, this.length);
    let i = 1;
    while (i < this.len.length - 1 && this.len[i] < s) i++;
    const s0 = this.len[i - 1], s1 = this.len[i];
    const t = (s - s0) / Math.max(1e-6, s1 - s0);
    const a = this.pts[i - 1], b = this.pts[i];
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    out.dx = dx / l; out.dz = dz / l;
    return out;
  }
}

export class Traffic {
  constructor(scene, city, terrain, wheelRenderer, mats, quality) {
    this.scene = scene; this.city = city; this.terrain = terrain;
    this.wheels = wheelRenderer; this.mats = mats;
    this.target = quality.cars;
    this.agents = [];
    this.turnCache = new Map();
    this.rng = new RNG(99);
    this.time = 0;
    this.laneLen = city.edges[0].len - 2 * STOP_DIST;
    this.laneOcc = new Map(); // "edge-k" -> agents
    this.nextId = 1;
    this.events = []; // honks etc. for audio
  }

  // ---------- geometry ----------
  lanePoint(e, k, s, out) {
    const off = this.city.laneOffset(k);
    out.x = e.from.x + e.dir.x * (STOP_DIST + s) + e.right.x * off;
    out.z = e.from.z + e.dir.z * (STOP_DIST + s) + e.right.z * off;
    out.dx = e.dir.x; out.dz = e.dir.z;
    return out;
  }
  turnType(eIn, eOut) {
    const c = eIn.dir.x * eOut.dir.z - eIn.dir.z * eOut.dir.x;
    const d = eIn.dir.x * eOut.dir.x + eIn.dir.z * eOut.dir.z;
    if (d > 0.9) return 'S';
    return c > 0 ? 'R' : 'L';
  }
  laneForTurn(t, rng) { return t === 'R' ? 0 : t === 'L' ? 1 : (rng.chance(0.5) ? 0 : 1); }
  turnPath(eIn, kIn, eOut, kOut) {
    const key = `${eIn.id}-${kIn}-${eOut.id}-${kOut}`;
    let p = this.turnCache.get(key);
    if (p) return p;
    const a = {}, b = {};
    this.lanePoint(eIn, kIn, this.laneLen, a);
    this.lanePoint(eOut, kOut, 0, b);
    const type = this.turnType(eIn, eOut);
    let p1, p2, radius = 1e9;
    if (type === 'S') {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      p1 = { x: a.x + eIn.dir.x * L / 3, z: a.z + eIn.dir.z * L / 3 };
      p2 = { x: b.x - eOut.dir.x * L / 3, z: b.z - eOut.dir.z * L / 3 };
    } else {
      // corner = intersection of incoming and outgoing lines
      const den = eIn.dir.x * (-eOut.dir.z) - eIn.dir.z * (-eOut.dir.x);
      const t = ((b.x - a.x) * (-eOut.dir.z) - (b.z - a.z) * (-eOut.dir.x)) / den;
      const c = { x: a.x + eIn.dir.x * t, z: a.z + eIn.dir.z * t };
      const r1 = Math.hypot(c.x - a.x, c.z - a.z), r2 = Math.hypot(b.x - c.x, b.z - c.z);
      radius = Math.min(r1, r2);
      p1 = { x: a.x + eIn.dir.x * r1 * 0.55, z: a.z + eIn.dir.z * r1 * 0.55 };
      p2 = { x: b.x - eOut.dir.x * r2 * 0.55, z: b.z - eOut.dir.z * r2 * 0.55 };
    }
    p = new BezierPath(a, p1, p2, b);
    p.type = type; p.radius = radius;
    p.vMax = type === 'S' ? 99 : Math.sqrt(2.6 * radius) + 0.5;
    p.curv = type === 'S' ? 0 : (type === 'L' ? 1 : -1) / radius;
    this.turnCache.set(key, p);
    return p;
  }

  chooseNext(edge, k, rng) {
    const node = edge.to;
    const opts = node.out.filter((o) => !(o.to === edge.from));
    // prefer exits consistent with the lane we're in
    const weighted = [];
    for (const o of opts) {
      const t = this.turnType(edge, o);
      let w = t === 'S' ? 5 : 2.5;
      if (k !== undefined && ((t === 'R' && k === 1) || (t === 'L' && k === 0))) w *= 0.15;
      weighted.push([o, w]);
    }
    let sum = weighted.reduce((a, b) => a + b[1], 0), r = rng.next() * sum;
    for (const [o, w] of weighted) { r -= w; if (r <= 0) return o; }
    return weighted[weighted.length - 1][0];
  }

  // ---------- spawning ----------
  randomType(rng) {
    const total = TYPE_WEIGHTS.reduce((a, b) => a + b[1], 0);
    let r = rng.next() * total;
    for (const [t, w] of TYPE_WEIGHTS) { r -= w; if (r <= 0) return t; }
    return 'sedan';
  }

  spawnAgent(edge, k, s, typeName) {
    const rng = this.rng;
    const type = typeName || this.randomType(rng);
    let paint = type === 'taxi' ? 0xf0b81c : PAINTS[rng.int(0, PAINTS.length - 1)];
    const vis = new CarVisual(type, paint, this.mats.plate, this.mats.beam);
    this.scene.add(vis.group);
    const a = {
      id: this.nextId++, visual: vis, type, T: vis.T,
      piece: 'lane', edge, k, s, path: null,
      v: 6 + rng.next() * 4, acc: 0,
      v0: 13.5 * rng.float(0.85, 1.12), aMax: rng.float(1.6, 2.6), hw: 1.1 + rng.next() * 0.6,
      lateral: 0, latTarget: 0, state: 'drive',
      x: 0, z: 0, yaw: 0, dx: 0, dz: 1, curv: 0,
      stopped: 0, blockedStatic: 0, ignoreCars: 0, honkCd: 0,
      pitch: 0, roll: 0, spin: 0, phys: null, recoverT: 0, indicator: 0,
    };
    a.halfL = vis.T.L / 2; a.halfW = vis.T.W / 2;
    a.nextEdge = this.chooseNext(edge, k, rng);
    this.agents.push(a);
    this.updatePose(a, 0);
    return a;
  }

  laneFree(edge, k, s, gap = 14) {
    for (const o of this.agents) {
      if (o.piece === 'lane' && o.edge === edge && o.k === k && Math.abs(o.s - s) < gap) return false;
    }
    return true;
  }

  populate(focus, initial = false) {
    const rng = this.rng;
    let attempts = 0;
    while (this.agents.length < this.target && attempts < 60) {
      attempts++;
      const e = this.city.edges[rng.int(0, this.city.edges.length - 1)];
      const k = rng.int(0, 1), s = rng.float(4, this.laneLen - 6);
      const p = this.lanePoint(e, k, s, {});
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (initial ? (d < 30 || d > 340) : (d < 110 || d > 320)) continue;
      if (!this.laneFree(e, k, s)) continue;
      this.spawnAgent(e, k, s);
      if (!initial && attempts > 3) break;
    }
  }

  remove(a) {
    const i = this.agents.indexOf(a);
    if (i >= 0) this.agents.splice(i, 1);
  }
  despawn(a) {
    this.remove(a);
    this.scene.remove(a.visual.group);
    a.visual.dispose();
  }

  // ---------- update ----------
  update(dt, ctx) {
    this.time += dt;
    const { focus, obstacles, peds, night, camera } = ctx;
    this.night = night;
    // occupancy per lane for gridlock checks
    this.laneOcc.clear();
    for (const a of this.agents) {
      if (a.piece !== 'lane' || a.state !== 'drive') continue;
      const key = a.edge.id * 2 + a.k;
      let arr = this.laneOcc.get(key);
      if (!arr) { arr = []; this.laneOcc.set(key, arr); }
      arr.push(a);
    }
    // gather obstacles list once (other cars as obstacles too)
    const all = this._all || (this._all = []);
    all.length = 0;
    for (const a of this.agents) all.push({ x: a.x, z: a.z, vx: a.dx * a.v, vz: a.dz * a.v, r: a.halfW, half: a.halfL, agent: a, kind: 'npc', static: a.state !== 'drive' });
    for (const o of obstacles) all.push(o);
    for (const p of peds) all.push(p);

    for (const a of [...this.agents]) {
      const dx = a.x - focus.x, dz = a.z - focus.z;
      const dist = Math.hypot(dx, dz);
      if (a.state === 'abandoned') a.abandonedT = (a.abandonedT || 0) + dt;
      // wrecks get towed: immediately when far away, after a while when out of the player's way
      if (dist > 390 || (a.state === 'abandoned' && (dist > 130 || (a.abandonedT > 25 && dist > 35)))) { this.despawn(a); continue; }
      if (a.state === 'physics') this.stepPhysics(a, dt, ctx);
      else if (a.state === 'drive') this.stepDrive(a, dt, all, dist);
      this.updateVisual(a, dt, dist, camera);
    }
    if (this.agents.length < this.target) this.populate(focus);
  }

  stepDrive(a, dt, all, distToFocus) {
    const city = this.city;
    a.honkCd -= dt;
    if (a.ignoreCars > 0) a.ignoreCars -= dt;
    // far away cars use a cheap update
    const cheap = distToFocus > 220;
    let gap = 999, vLead = 0, blockKind = null;

    if (a.piece === 'lane') {
      const remain = this.laneLen - a.s;
      const node = a.edge.to;
      // --- traffic light / yield at the stop line ---
      if (remain < 45) {
        const sig = signalState(node, a.edge.axis, this.time);
        const stopGap = remain - a.halfL - 0.4;
        let mustStop = false;
        if (sig === 'R') mustStop = true;
        else if (sig === 'Y') mustStop = stopGap > (a.v * a.v) / (2 * 3.2) + 1;
        if (!mustStop && stopGap < 25) {
          const type = this.turnType(a.edge, a.nextEdge);
          if (type === 'L' && this.oncomingBlocks(a, node)) mustStop = true;
          // don't block the box: is there room on the exit lane?
          if (!mustStop && !this.exitHasRoom(a.nextEdge)) mustStop = true;
          if (!mustStop && sig === 'G' && greenLeft(node, a.edge.axis, this.time) < 1 && stopGap > 6) mustStop = true;
        }
        if (mustStop && stopGap > -1.5) { gap = Math.max(0.1, stopGap); vLead = 0; blockKind = 'light'; }
      }
      // slow down for the coming turn
      if (a.nextEdge) {
        const tType = this.turnType(a.edge, a.nextEdge);
        if (tType !== 'S') {
          const vT = tType === 'L' ? 6.6 : 4.8;
          const vAllowed = Math.sqrt(vT * vT + 2 * 2.2 * Math.max(0, remain - 2));
          a.vCap = vAllowed;
        } else a.vCap = 99;
        a.indicator = tType === 'S' || remain > 35 ? 0 : (tType === 'L' ? 1 : -1);
      }
    } else {
      a.vCap = a.path.vMax;
      a.indicator = a.path.type === 'S' ? 0 : (a.path.type === 'L' ? 1 : -1);
    }

    // --- obstacles along the planned path ---
    if (!cheap || distToFocus < 260) {
      const look = Math.max(18, a.v * 3 + 14);
      const res = this.scanAhead(a, all, look);
      if (res.gap < gap) { gap = res.gap; vLead = res.vLead; blockKind = res.kind; a.blockObs = res.obs; }
    }

    // --- IDM ---
    const v0 = Math.min(a.v0, a.vCap ?? 99);
    const v = a.v;
    const b = 2.8, s0 = 2.2;
    const sStar = s0 + Math.max(0, v * a.hw + v * (v - vLead) / (2 * Math.sqrt(a.aMax * b)));
    let acc = a.aMax * (1 - Math.pow(v / Math.max(0.1, v0), 4) - (gap < 900 ? Math.pow(sStar / Math.max(0.1, gap), 2) : 0));
    acc = clamp(acc, -9, a.aMax);
    a.acc = lerp(a.acc, acc, 1 - Math.exp(-6 * dt));
    a.v = Math.max(0, a.v + a.acc * dt);
    if (gap < 0.3 && blockKind !== 'light') a.v = Math.min(a.v, 0.5);

    // --- stuck handling ---
    if (a.v < 0.3) a.stopped += dt; else a.stopped = 0;
    if (blockKind && blockKind !== 'light' && a.v < 0.3) a.blockedStatic += dt; else a.blockedStatic = 0;
    if (a.blockedStatic > 2.5 && (blockKind === 'player' || blockKind === 'playerCar') && a.honkCd <= 0) {
      this.events.push({ type: 'honk', x: a.x, z: a.z });
      a.honkCd = 4 + Math.random() * 3;
    }
    if (a.blockedStatic > 2.2 && a.piece === 'lane' && (blockKind === 'static' || blockKind === 'playerCar')) {
      const other = 1 - a.k;
      if (this.laneFree(a.edge, other, a.s, 16) && this.laneLen - a.s > 18) {
        const off0 = city.laneOffset(a.k), off1 = city.laneOffset(other);
        a.lateral = off0 + a.lateral - off1; a.k = other; a.blockedStatic = 0;
      }
    }
    if (a.blockedStatic > 6 && blockKind === 'npc') { a.ignoreCars = 1.5; a.blockedStatic = 0; }
    a.lateral = lerp(a.lateral, 0, 1 - Math.exp(-0.9 * dt));

    // --- advance along the path ---
    a.s += a.v * dt;
    if (a.piece === 'lane' && a.s >= this.laneLen) {
      const over = a.s - this.laneLen;
      const e2 = a.nextEdge;
      const e3 = this.chooseNext(e2, undefined, this.rng);
      const k2 = this.laneForTurn(this.turnType(e2, e3), this.rng);
      a.path = this.turnPath(a.edge, a.k, e2, k2);
      a.piece = 'turn'; a.s = over; a.toEdge = e2; a.toK = k2; a.after = e3;
    } else if (a.piece === 'turn' && a.s >= a.path.length) {
      const over = a.s - a.path.length;
      a.piece = 'lane'; a.edge = a.toEdge; a.k = a.toK; a.s = over; a.nextEdge = a.after; a.path = null;
    }
    this.updatePose(a, dt);
  }

  oncomingBlocks(a, node) {
    // opposite approach into the same node
    for (const o of this.agents) {
      if (o === a || o.state !== 'drive') continue;
      if (o.piece === 'lane' && o.edge.to === node && o.edge.dir.x === -a.edge.dir.x && o.edge.dir.z === -a.edge.dir.z) {
        const rem = this.laneLen - o.s;
        if (rem < 42 && (o.v > 1.5 || rem < 8)) {
          const t = o.nextEdge ? this.turnType(o.edge, o.nextEdge) : 'S';
          if (t !== 'L') return true;
        }
      }
      if (o.piece === 'turn' && o.path.type !== 'L' && o.edge && o.edge.to === node && o.edge.dir.x === -a.edge.dir.x && o.edge.dir.z === -a.edge.dir.z) {
        if (o.s < o.path.length * 0.8) return true;
      }
    }
    return false;
  }

  exitHasRoom(edge) {
    for (const k of [0, 1]) {
      const arr = this.laneOcc.get(edge.id * 2 + k);
      if (!arr) continue;
      for (const o of arr) if (o.s < 9 && o.v < 2) return false;
    }
    return true;
  }

  // Sample the planned path ahead and find the nearest obstacle on it.
  scanAhead(a, all, look) {
    const out = this._res || (this._res = { gap: 999, vLead: 0, kind: null, obs: null });
    out.gap = 999; out.vLead = 0; out.kind = null; out.obs = null;
    const pts = this._pts || (this._pts = []);
    pts.length = 0;
    const step = 2.2;
    let d = 1.5;
    const p = this._p || (this._p = {});
    // walk current piece then the next
    let piece = a.piece, s = a.s + d, edge = a.edge, k = a.k, path = a.path;
    let guard = 0;
    let nextPath = null;
    while (d < look && guard++ < 60) {
      if (piece === 'lane') {
        if (s > this.laneLen) {
          if (!a.nextEdge || edge !== a.edge) break;
          nextPath = nextPath || this.turnPath(edge, k, a.nextEdge, this.laneForTurnGuess(a));
          s -= this.laneLen; piece = 'turn'; path = nextPath; continue;
        }
        this.lanePoint(edge, k, s, p);
      } else {
        if (s > path.length) {
          if (path !== a.path) break;
          s -= path.length; piece = 'lane'; edge = a.toEdge; k = a.toK; continue;
        }
        path.sample(s, p);
      }
      pts.push(p.x, p.z, d);
      d += step; s += step;
    }
    const hx = a.dx, hz = a.dz;
    for (const o of all) {
      if (o.agent === a) continue;
      const ox = o.x - a.x, oz = o.z - a.z;
      const dd = ox * ox + oz * oz;
      if (dd > (look + 6) * (look + 6)) continue;
      if (ox * hx + oz * hz < 0.5) continue; // behind
      const isCar = o.kind === 'npc';
      if (isCar && a.ignoreCars > 0 && !o.static) continue;
      const thr = (o.r || 0.4) + a.halfW + 0.35;
      for (let i = 0; i < pts.length; i += 3) {
        const ex = pts[i] - o.x, ez = pts[i + 1] - o.z;
        if (ex * ex + ez * ez < thr * thr) {
          const g = pts[i + 2] - a.halfL - (o.half || 0.3) * 0.8;
          if (g < out.gap) {
            out.gap = Math.max(0.05, g);
            out.vLead = Math.max(0, (o.vx || 0) * hx + (o.vz || 0) * hz);
            out.kind = o.static ? 'static' : o.kind;
            out.obs = o;
          }
          break;
        }
      }
    }
    return out;
  }
  laneForTurnGuess(a) { return a.k; }

  updatePose(a, dt) {
    const p = this._pp || (this._pp = {});
    if (a.piece === 'lane') this.lanePoint(a.edge, a.k, a.s, p);
    else a.path.sample(a.s, p);
    const rx = -p.dz, rz = p.dx;
    a.x = p.x + rx * a.lateral; a.z = p.z + rz * a.lateral;
    const newYaw = Math.atan2(p.dx, p.dz);
    const dyaw = wrapAngle(newYaw - a.yaw);
    a.yawRate = dt > 0 ? dyaw / dt : 0;
    a.yaw = newYaw; a.dx = p.dx; a.dz = p.dz;
    a.curv = a.piece === 'turn' ? a.path.curv : 0;
  }

  // ---------- knocked-around physics state ----------
  hit(a, vx, vz, yawRate) {
    if (a.state === 'drive') {
      a.state = 'physics';
      a.phys = { vx: a.dx * a.v, vz: a.dz * a.v, w: 0 };
    }
    a.phys.vx += vx; a.phys.vz += vz; a.phys.w += yawRate;
    a.recoverT = 0;
    this.events.push({ type: 'honk', x: a.x, z: a.z, delay: 0.6 });
  }

  stepPhysics(a, dt, ctx) {
    const ph = a.phys;
    // friction in the car frame
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -fz, rz = fx;
    let vl = ph.vx * fx + ph.vz * fz, vlat = ph.vx * rx + ph.vz * rz;
    vl -= sign(vl) * Math.min(Math.abs(vl), 3.5 * dt);
    vlat -= sign(vlat) * Math.min(Math.abs(vlat), 8 * dt);
    ph.vx = fx * vl + rx * vlat; ph.vz = fz * vl + rz * vlat;
    ph.w *= Math.exp(-2.5 * dt);
    a.x += ph.vx * dt; a.z += ph.vz * dt; a.yaw += ph.w * dt;
    a.dx = Math.sin(a.yaw); a.dz = Math.cos(a.yaw);
    a.v = Math.abs(vl);
    // building collisions
    const col = ctx.collision;
    const boxes = col.queryBoxes(a.x - 4, a.z - 4, a.x + 4, a.z + 4, this._bx || (this._bx = []));
    for (const b of boxes) {
      const cx = clamp(a.x, b.minX, b.maxX), cz = clamp(a.z, b.minZ, b.maxZ);
      const ddx = a.x - cx, ddz = a.z - cz, d = Math.hypot(ddx, ddz);
      const r = a.halfW + 0.3;
      if (d < r && d > 1e-4) {
        a.x += ddx / d * (r - d); a.z += ddz / d * (r - d);
        const vn = ph.vx * ddx / d + ph.vz * ddz / d;
        if (vn < 0) { ph.vx -= 1.3 * vn * ddx / d; ph.vz -= 1.3 * vn * ddz / d; }
      }
    }
    const lim = WORLD_HALF - 5;
    a.x = clamp(a.x, -lim, lim); a.z = clamp(a.z, -lim, lim);
    const speed = Math.hypot(ph.vx, ph.vz);
    if (speed < 0.15 && Math.abs(ph.w) < 0.1) {
      a.recoverT += dt;
      if (a.recoverT > 1.8) this.tryRecover(a);
    }
  }

  tryRecover(a) {
    // find nearest lane centre along any edge with matching heading
    let best = null, bestD = 5.5;
    for (const e of this.city.edges) {
      if (e.dir.x * a.dx + e.dir.z * a.dz < 0.5) continue;
      for (const k of [0, 1]) {
        const off = this.city.laneOffset(k);
        const sx = e.from.x + e.dir.x * STOP_DIST + e.right.x * off, sz = e.from.z + e.dir.z * STOP_DIST + e.right.z * off;
        const px = a.x - sx, pz = a.z - sz;
        const s = px * e.dir.x + pz * e.dir.z;
        if (s < 2 || s > this.laneLen - 4) continue;
        const lat = px * e.right.x + pz * e.right.z;
        if (Math.abs(lat) < bestD) { bestD = Math.abs(lat); best = { e, k, s, lat }; }
      }
    }
    if (best) {
      a.state = 'drive'; a.piece = 'lane'; a.edge = best.e; a.k = best.k; a.s = best.s; a.lateral = best.lat;
      a.v = 0; a.acc = 0; a.path = null; a.nextEdge = this.chooseNext(best.e, best.k, this.rng);
      a.phys = null;
    } else {
      a.state = 'abandoned';
    }
  }

  // ---------- visuals ----------
  updateVisual(a, dt, dist, camera) {
    const vis = a.visual;
    const g = vis.group;
    const visible = dist < 360;
    g.visible = visible;
    if (!visible) return;
    const y = this.terrain.heightAt(a.x, a.z);
    // body pitch / roll from accelerations (visual only)
    const latAcc = a.state === 'drive' ? a.v * a.v * (a.curv || 0) : 0;
    a.pitch = lerp(a.pitch, clamp(-a.acc * 0.006, -0.03, 0.03), 1 - Math.exp(-5 * dt));
    a.roll = lerp(a.roll, clamp(latAcc * 0.008, -0.04, 0.04), 1 - Math.exp(-5 * dt));
    g.position.set(a.x, y, a.z);
    a.visYaw = a.visYaw === undefined ? a.yaw : dampAngle(a.visYaw, a.yaw, 9, dt);
    g.rotation.set(a.pitch, a.visYaw, a.roll, 'YXZ');
    a.spin += (a.v / a.T.R) * dt;
    for (let i = 0; i < 4; i++) vis.wheelSpin[i] = a.spin;
    vis.wheelSteer = a.state === 'drive' ? clamp(Math.atan(a.T.wb * (a.curv || 0)), -0.6, 0.6) : 0;
    // lights
    const n = this.night;
    const braking = a.state === 'drive' && (a.acc < -0.9 || a.v < 0.2);
    vis.lights.set(n > 0.3 ? 1 : 0, n > 0.3 ? 1 : 0, braking ? 1 : 0, 0);
    const blink = Math.floor(this.time * 3) % 2 === 0 ? 1 : 0;
    const hazard = a.state !== 'drive';
    vis.ind.set((a.indicator === 1 || hazard) ? blink : 0, (a.indicator === -1 || hazard) ? blink : 0, 1);
    if (vis.beam) vis.beam.visible = n > 0.3 && dist < 140;
    g.updateMatrixWorld(true);
    if (dist < 160) vis.pushWheels(this.wheels, g.matrixWorld);
  }

  // Obstacle footprint (for player collisions)
  footprint(a) {
    return { cx: a.x, cz: a.z, fx: a.dx, fz: a.dz, hw: a.halfW, hl: a.halfL };
  }
}
