// Pedestrians walk the sidewalks around each block, wait for the walk signal and cross at
// crosswalks, idle on their phones, dodge speeding cars, get knocked down (and get back up)
// and flee from carjackings.
import { NB, PED_RING, lineCoord } from './config.js';
import { signalState, greenLeft } from './city.js';
import { createHuman, HumanAnimator, randomAppearance } from './human.js';
import { RNG, clamp, lerp, dampAngle, wrapAngle } from './utils.js';

export class Pedestrians {
  constructor(scene, city, terrain, quality) {
    this.scene = scene; this.city = city; this.terrain = terrain;
    this.rng = new RNG(31337);
    this.buildGraph();
    this.pool = [];
    this.active = [];
    const n = quality.peds;
    for (let i = 0; i < n + 4; i++) {
      const h = createHuman(randomAppearance(this.rng), quality.texSize > 512 ? 10 : 8);
      h.group.visible = false;
      scene.add(h.group);
      this.pool.push({ h, anim: new HumanAnimator(h) });
    }
    this.target = n;
    this.time = 0;
  }

  // Corner nodes of each block's sidewalk ring + crossing links between neighbouring blocks.
  buildGraph() {
    this.nodes = [];
    const id = (bi, bj, c) => (bj * NB + bi) * 4 + c;
    for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
      const x0 = lineCoord(bi) + PED_RING, x1 = lineCoord(bi + 1) - PED_RING;
      const z0 = lineCoord(bj) + PED_RING, z1 = lineCoord(bj + 1) - PED_RING;
      const cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      cs.forEach(([x, z], c) => { this.nodes[id(bi, bj, c)] = { x, z, links: [] }; });
    }
    for (let bj = 0; bj < NB; bj++) for (let bi = 0; bi < NB; bi++) {
      for (let c = 0; c < 4; c++) {
        const a = this.nodes[id(bi, bj, c)];
        a.links.push({ to: this.nodes[id(bi, bj, (c + 1) % 4)] });
        a.links.push({ to: this.nodes[id(bi, bj, (c + 3) % 4)] });
      }
      // crossings: corner c of this block <-> neighbour's matching corner
      const link = (c1, bi2, bj2, c2, axis, ni, nj) => {
        if (bi2 < 0 || bj2 < 0 || bi2 >= NB || bj2 >= NB) return;
        const a = this.nodes[id(bi, bj, c1)], b = this.nodes[id(bi2, bj2, c2)];
        const node = this.city.nodeAt(ni, nj);
        a.links.push({ to: b, cross: { axis, node } });
      };
      // corner 0 (x0,z0): cross the x-road at z=lineCoord(bj) to block (bi,bj-1) corner 3; cross z-road to (bi-1,bj) corner 1
      link(0, bi, bj - 1, 3, 'x', bi, bj); link(0, bi - 1, bj, 1, 'z', bi, bj);
      link(1, bi, bj - 1, 2, 'x', bi + 1, bj); link(1, bi + 1, bj, 0, 'z', bi + 1, bj);
      link(2, bi, bj + 1, 1, 'x', bi + 1, bj + 1); link(2, bi + 1, bj, 3, 'z', bi + 1, bj + 1);
      link(3, bi, bj + 1, 0, 'x', bi, bj + 1); link(3, bi - 1, bj, 2, 'z', bi, bj + 1);
    }
  }

  spawn(p, focus, initial) {
    const rng = this.rng;
    for (let tries = 0; tries < 20; tries++) {
      const a = this.nodes[rng.int(0, this.nodes.length - 1)];
      const l = a.links.filter((k) => !k.cross);
      const b = l[rng.int(0, l.length - 1)].to;
      const t = rng.next();
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (initial ? d > 140 : (d < 45 || d > 140)) continue;
      p.from = a; p.to = b; p.x = x; p.z = z; p.y = this.terrain.heightAt(x, z);
      p.lat = rng.float(0.3, 1.1) * (rng.chance(0.5) ? 1 : -1);
      p.speed = rng.float(1.15, 1.55); p.v = p.speed;
      p.state = rng.chance(0.12) ? 'idle' : 'walk'; p.idleT = rng.float(4, 14);
      p.phone = rng.chance(0.5);
      p.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      p.vx = 0; p.vz = 0; p.vy = 0; p.downT = 0; p.fleeT = 0; p.cross = null;
      p.h.group.visible = true;
      p.h.group.position.set(p.x, p.y, p.z);
      this.active.push(p);
      return true;
    }
    return false;
  }

  populate(focus, initial = false) {
    let guard = 0;
    while (this.active.length < this.target && guard++ < (initial ? 200 : 2)) {
      const free = this.pool.find((p) => !this.active.includes(p));
      if (!free) break;
      this.spawn(free, focus, initial);
    }
  }

  // Spawn a fleeing person (e.g. a carjacked driver) at a position.
  spawnFleeing(x, z, awayX, awayZ) {
    let p = this.pool.find((q) => !this.active.includes(q));
    if (!p) {
      // recycle the farthest one
      p = this.active.reduce((a, b) => (Math.hypot(a.x - x, a.z - z) > Math.hypot(b.x - x, b.z - z) ? a : b));
      this.active.splice(this.active.indexOf(p), 1);
    }
    const n = this.nearestNode(x, z);
    p.from = n; p.to = n.links[0].to;
    p.x = x; p.z = z; p.y = this.terrain.heightAt(x, z);
    p.lat = 0.6; p.speed = 1.4; p.v = 0;
    p.state = 'flee'; p.fleeT = 7; p.fleeDir = Math.atan2(awayX, awayZ);
    p.yaw = p.fleeDir; p.vx = p.vz = p.vy = 0; p.downT = 0; p.cross = null; p.phone = false;
    p.h.group.visible = true;
    this.active.push(p);
    return p;
  }

  nearestNode(x, z) {
    let best = null, bd = 1e9;
    for (const n of this.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  chooseNext(p) {
    const opts = p.to.links.filter((l) => l.to !== p.from);
    const cross = opts.filter((l) => l.cross), walk = opts.filter((l) => !l.cross);
    if (cross.length && this.rng.chance(0.4)) return cross[this.rng.int(0, cross.length - 1)];
    return walk[this.rng.int(0, walk.length - 1)] || opts[0];
  }

  // ---- update ----
  update(dt, ctx) {
    this.time += dt;
    const { focus, cars, camera, collision } = ctx;
    for (const p of [...this.active]) {
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d > 175) { this.deactivate(p); continue; }
      this.step(p, dt, cars, collision, d);
      const g = p.h.group;
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.yaw;
      g.visible = d < 150;
      if (d < 75 || (d < 150 && Math.floor(this.time * 10 + p.x) % 3 === 0)) {
        p.anim.update(d < 75 ? dt : dt * 3, p.state === 'down' ? 0 : p.v, {
          down: p.state === 'down', air: p.state === 'down' && p.y > this.terrain.heightAt(p.x, p.z) + 0.2,
          phone: p.state === 'idle' && p.phone, turnRate: p.turnRate || 0,
        });
      }
    }
    this.populate(focus);
  }

  deactivate(p) {
    const i = this.active.indexOf(p);
    if (i >= 0) this.active.splice(i, 1);
    p.h.group.visible = false;
  }

  step(p, dt, cars, collision, distFocus) {
    const prevYaw = p.yaw;
    if (p.state === 'down') {
      // ballistic then lying
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      p.vy -= 9.8 * dt;
      const gy = this.terrain.heightAt(p.x, p.z);
      if (p.y <= gy) { p.y = gy; p.vy = 0; p.vx *= Math.exp(-6 * dt); p.vz *= Math.exp(-6 * dt); }
      this.pushOutOfBuildings(p, collision);
      p.downT -= dt;
      if (p.downT <= 0) { p.state = 'flee'; p.fleeT = 5; p.fleeDir = p.yaw; const n = this.nearestNode(p.x, p.z); p.from = n; p.to = n.links[0].to; }
      p.v = 0;
      return;
    }
    // danger check: fast cars heading at me
    for (const c of cars) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const dd = Math.hypot(dx, dz);
      if (dd > 14) continue;
      const sp = Math.hypot(c.vx, c.vz);
      // hit test against the car footprint
      const fx = c.fx, fz = c.fz, rx = -fz, rz = fx;
      const lf = dx * fx + dz * fz, lr = dx * rx + dz * rz;
      if (Math.abs(lf) < c.hl + 0.25 && Math.abs(lr) < c.hw + 0.25 && sp > 2.5 && p.y < c.y + 1.2) {
        this.knockDown(p, c.vx, c.vz, sp);
        return;
      }
      if (sp > 5 && c.player) {
        const approach = -(dx * c.vx + dz * c.vz) / (dd + 0.01);
        const lateral = Math.abs(lr);
        if (approach > 4 && lateral < c.hw + 2 && lf > 0 && dd < 4 + sp * 0.7 && p.state !== 'dodge') {
          p.state = 'dodge'; p.dodgeT = 0.9;
          const side = lr >= 0 ? 1 : -1;
          p.dodgeVx = rx * side * 4.2; p.dodgeVz = rz * side * 4.2;
        }
      }
    }
    if (p.state === 'dodge') {
      p.dodgeT -= dt;
      p.x += p.dodgeVx * dt; p.z += p.dodgeVz * dt;
      p.v = 4.2; p.yaw = dampAngle(p.yaw, Math.atan2(p.dodgeVx, p.dodgeVz), 10, dt);
      this.pushOutOfBuildings(p, collision);
      p.y = this.terrain.heightAt(p.x, p.z);
      if (p.dodgeT <= 0) { p.state = 'flee'; p.fleeT = 3; p.fleeDir = p.yaw; }
      return;
    }
    if (p.state === 'flee') {
      p.fleeT -= dt;
      p.v = lerp(p.v, 4.6, 1 - Math.exp(-3 * dt));
      p.x += Math.sin(p.fleeDir) * p.v * dt; p.z += Math.cos(p.fleeDir) * p.v * dt;
      p.yaw = dampAngle(p.yaw, p.fleeDir, 6, dt);
      if (this.pushOutOfBuildings(p, collision)) p.fleeDir += Math.PI / 2;
      p.y = this.terrain.heightAt(p.x, p.z);
      if (p.fleeT <= 0) {
        // rejoin the sidewalk network
        const n = this.nearestNode(p.x, p.z);
        p.to = n; p.from = n.links[0].to; p.state = 'walk';
      }
      p.turnRate = wrapAngle(p.yaw - prevYaw) / Math.max(dt, 1e-3);
      return;
    }
    if (p.state === 'idle') {
      p.idleT -= dt; p.v = lerp(p.v, 0, 1 - Math.exp(-6 * dt));
      if (p.idleT <= 0) p.state = 'walk';
      return;
    }
    if (p.state === 'wait') {
      p.v = lerp(p.v, 0, 1 - Math.exp(-6 * dt));
      const c = p.cross;
      const perp = c.axis === 'x' ? 'z' : 'x';
      if (signalState(c.node, c.axis, this.time) === 'R' && greenLeft(c.node, perp, this.time) > 6) {
        p.state = 'walk'; p.from = p.waitFrom; p.to = p.waitTo;
      }
      p.yaw = dampAngle(p.yaw, Math.atan2(p.waitTo.x - p.x, p.waitTo.z - p.z), 4, dt);
      return;
    }
    // walking along from -> to
    const ax = p.to.x - p.from.x, az = p.to.z - p.from.z, L = Math.hypot(ax, az) || 1;
    const dx = ax / L, dz = az / L, rx = -dz, rz = dx;
    const tx = p.to.x + rx * p.lat, tz = p.to.z + rz * p.lat;
    let mx = tx - p.x, mz = tz - p.z;
    const md = Math.hypot(mx, mz);
    if (md < 0.6) {
      // arrived at a corner: choose the next leg
      const next = this.chooseNext(p);
      if (next.cross) {
        p.state = 'wait'; p.cross = next.cross; p.waitFrom = p.to; p.waitTo = next.to;
      } else { p.from = p.to; p.to = next.to; }
      if (this.rng.chance(0.06)) { p.state = 'idle'; p.idleT = this.rng.float(3, 10); }
      return;
    }
    mx /= md; mz /= md;
    // separation from other pedestrians
    for (const o of this.active) {
      if (o === p) continue;
      const ox = p.x - o.x, oz = p.z - o.z, od = ox * ox + oz * oz;
      if (od < 0.64 && od > 1e-6) { const k = (0.8 - Math.sqrt(od)) * 1.5; mx += ox * k; mz += oz * k; }
    }
    const desired = p.speed;
    p.v = lerp(p.v, desired, 1 - Math.exp(-3 * dt));
    const ml = Math.hypot(mx, mz) || 1;
    p.x += (mx / ml) * p.v * dt; p.z += (mz / ml) * p.v * dt;
    p.yaw = dampAngle(p.yaw, Math.atan2(mx, mz), 7, dt);
    p.y = lerp(p.y, this.terrain.heightAt(p.x, p.z), 1 - Math.exp(-20 * dt));
    p.turnRate = wrapAngle(p.yaw - prevYaw) / Math.max(dt, 1e-3);
  }

  pushOutOfBuildings(p, collision) {
    const boxes = collision.queryBoxes(p.x - 1, p.z - 1, p.x + 1, p.z + 1, this._b || (this._b = []));
    let hit = false;
    for (const b of boxes) {
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d < 0.35) {
        hit = true;
        if (d > 1e-5) { p.x = cx + dx / d * 0.35; p.z = cz + dz / d * 0.35; }
        else { p.x += 0.4; }
      }
    }
    return hit;
  }

  knockDown(p, vx, vz, sp) {
    p.state = 'down';
    p.downT = 3.5 + Math.random() * 2;
    p.vx = vx * 0.7 + (Math.random() - 0.5) * 2; p.vz = vz * 0.7 + (Math.random() - 0.5) * 2;
    p.vy = Math.min(7, 2 + sp * 0.25);
    p.yaw = Math.atan2(-vx, -vz);
    this.onHit?.(p, sp);
  }

  // Obstacles for the traffic AI
  obstacles(out) {
    for (const p of this.active) out.push({ x: p.x, z: p.z, vx: Math.sin(p.yaw) * p.v, vz: Math.cos(p.yaw) * p.v, r: 0.4, half: 0.3, kind: 'ped' });
    return out;
  }

  // Simple push against the player on foot
  separateFrom(x, z, r) {
    for (const p of this.active) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d < r + 0.35 && d > 1e-4 && p.state !== 'down') { p.x = x + dx / d * (r + 0.35); p.z = z + dz / d * (r + 0.35); }
    }
  }
}
