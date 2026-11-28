// Pedestrian crowds: varied procedural people strolling the sidewalks, parks,
// promenades and beach; they idle, look around, dodge speeding cars, get knocked
// down when hit (then get up and run) and sunbathe on the beach.
import * as THREE from 'three';
import { Human, randomLook } from './human.js';
import { Animator } from './animator.js';
import { slabs, groundHeight, surfaceAt, BEACH, SIDEWALK_W, CURB_H } from '../world/map.js';
import { RNG, clamp, damp, dampAngle, lerp } from '../core/utils.js';
import { STATE, U } from '../core/globals.js';

function pathFor(s, rng) {
  if (s.ring) {
    const inset = 2.0 + rng.range(-0.8, 0.8);
    const r = { x0: s.x0 + inset, z0: s.z0 + inset, x1: s.x1 - inset, z1: s.z1 - inset };
    return { type: 'ring', r, per: 2 * ((r.x1 - r.x0) + (r.z1 - r.z0)), s: rng.range(0, 1e4), dir: rng.sign() };
  }
  const long = (s.x1 - s.x0) > (s.z1 - s.z0);
  const off = rng.range(-0.25, 0.25);
  if (long) { const z = lerp(s.z0, s.z1, 0.5 + off); return { type: 'line', ax: s.x0 + 2, az: z, bx: s.x1 - 2, bz: z, s: rng.next(), dir: rng.sign() }; }
  const x = s.kind === 'oceanpark' ? s.x0 + 1.5 + rng.range(0, 1.5) : lerp(s.x0, s.x1, 0.5 + off);
  return { type: 'line', ax: x, az: s.z0 + 2, bx: x, bz: s.z1 - 2, s: rng.next(), dir: rng.sign() };
}

function pathPos(p, out) {
  if (p.type === 'ring') {
    const r = p.r, w = r.x1 - r.x0, h = r.z1 - r.z0;
    let s = ((p.s % p.per) + p.per) % p.per;
    if (s < w) { out.x = r.x0 + s; out.z = r.z0; return 0; }
    s -= w; if (s < h) { out.x = r.x1; out.z = r.z0 + s; return 1; }
    s -= h; if (s < w) { out.x = r.x1 - s; out.z = r.z1; return 2; }
    s -= w; out.x = r.x0; out.z = r.z1 - s; return 3;
  }
  if (p.type === 'line') {
    const t = clamp(p.s, 0, 1);
    out.x = lerp(p.ax, p.bx, t); out.z = lerp(p.az, p.bz, t); return 0;
  }
  out.x = p.tx; out.z = p.tz; return 0;
}

export class Pedestrians {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(4321);
    this.list = [];
    this.sunbathers = [];
    this.walkable = slabs.filter((s) => s.kind !== 'causewalk' || true);
    this.timer = 0;
    this.tmp = new THREE.Vector3();
  }

  make(look) {
    const h = new Human(look);
    const anim = new Animator(h);
    h.root.traverse((o) => o.layers.set(1)); // keep crowds out of the mirror pass
    this.game.scene.add(h.root);
    return { h, anim, root: h.root, pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, speed: 0 };
  }

  spawn(focus) {
    const rng = this.rng;
    // pick a slab or the beach near focus
    for (let tries = 0; tries < 20; tries++) {
      const beach = focus.x > 480 && rng.chance(0.35);
      let p;
      if (beach) {
        p = { type: 'wander', tx: rng.range(BEACH.x0 + 4, 612), tz: focus.z + rng.range(-120, 120), bounds: true };
      } else {
        const s = rng.pick(this.walkable);
        const cx = clamp(focus.x, s.x0, s.x1), cz = clamp(focus.z, s.z0, s.z1);
        const d = Math.hypot(cx - focus.x, cz - focus.z);
        if (d > 130) continue;
        p = pathFor(s, rng);
      }
      const ped = this.make(randomLook(rng));
      ped.path = p;
      if (p.type === 'wander') { ped.pos.set(p.tx, 0, p.tz); this.newTarget(ped); }
      else {
        // start at a point of the path near focus but not right on top
        for (let k = 0; k < 8; k++) {
          if (p.type === 'ring') p.s = rng.range(0, p.per); else p.s = rng.next();
          pathPos(p, this.tmp);
          const d = Math.hypot(this.tmp.x - focus.x, this.tmp.z - focus.z);
          if (d > 25 && d < 140) break;
        }
        pathPos(p, this.tmp);
        ped.pos.set(this.tmp.x, 0, this.tmp.z);
      }
      ped.pos.y = groundHeight(ped.pos.x, ped.pos.z);
      ped.walkSpeed = rng.range(1.05, 1.6);
      ped.state = 'walk';
      ped.pause = rng.range(6, 30);
      ped.lat = rng.range(-0.8, 0.8);
      ped.anim.onStep = (side, v) => { if (this.near(ped)) this.game.audio?.footstep(surfaceAt(ped.pos.x, ped.pos.z), v, U.uWet.value > 0.35, false, ped.pos); };
      this.list.push(ped);
      return;
    }
  }

  near(ped) { const c = this.game.camera.position; return (ped.pos.x - c.x) ** 2 + (ped.pos.z - c.z) ** 2 < 400; }

  newTarget(ped) {
    const p = ped.path, rng = this.rng;
    p.tx = clamp(ped.pos.x + rng.range(-25, 25), BEACH.x0 + 3, 612);
    p.tz = clamp(ped.pos.z + rng.range(-40, 40), BEACH.z0 + 5, BEACH.z1 - 5);
  }

  spawnSunbathers(props) {
    const loungers = props.byKind.lounger || [];
    for (let i = 0; i < loungers.length; i += 4) {
      const l = loungers[i];
      const ped = this.make(randomLook(this.rng));
      ped.anim.mode = 'lie';
      ped.root.position.set(l.x, l.y + 0.35, l.z);
      ped.root.rotation.y = l.rot + Math.PI;
      ped.static = true;
      ped.lounger = l;
      ped.pos.copy(ped.root.position);
      this.sunbathers.push(ped);
    }
  }

  dispose(ped) { this.game.scene.remove(ped.root); }

  update(dt, focus, vehicles) {
    const target = STATE.q.peds;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (Math.hypot(p.pos.x - focus.x, p.pos.z - focus.z) > 175) { this.dispose(p); this.list.splice(i, 1); }
    }
    this.timer -= dt;
    if (this.list.length < target && this.timer <= 0) { this.spawn(focus); this.timer = 0.12; }
    const tmp = this.tmp;
    for (const ped of this.list) {
      // ---- danger & hits
      for (const v of vehicles) {
        const sp = Math.abs(v.speed);
        if (sp < 2.5) continue;
        const dx = ped.pos.x - v.pos.x, dz = ped.pos.z - v.pos.z;
        if (dx * dx + dz * dz > 400) continue;
        if (ped.state !== 'down' && v.contains2D(ped.pos.x, ped.pos.z, 0.25)) {
          ped.state = 'down'; ped.downT = 3.5 + this.rng.range(0, 1.5);
          ped.vel.set(v.vel.x * 0.55 + dx * 0.5, Math.min(6, 1.5 + sp * 0.18), v.vel.z * 0.55 + dz * 0.5);
          ped.anim.mode = 'down';
          ped.heading = Math.atan2(-v.vel.x, -v.vel.z);
          this.game.audio?.thud(ped.pos, sp);
          continue;
        }
        const fx = v.vel.x / sp, fz = v.vel.z / sp;
        const ahead = dx * fx + dz * fz, lat = dx * fz - dz * fx;
        if (ahead > 0 && ahead < 6 + sp * 0.6 && Math.abs(lat) < 2.6 && (ped.state === 'walk' || ped.state === 'idle')) {
          ped.state = 'flee'; ped.fleeT = 2.5;
          const side = lat >= 0 ? 1 : -1;
          ped.fleeDir = Math.atan2(fz * side, -fx * side);
        }
      }
      // ---- behaviour
      let targetSpeed = 0, targetHeading = ped.heading;
      if (ped.state === 'down') {
        ped.downT -= dt;
        ped.vel.y -= 9.81 * dt;
        ped.pos.addScaledVector(ped.vel, dt);
        const g = groundHeight(ped.pos.x, ped.pos.z);
        if (ped.pos.y < g) { ped.pos.y = g; ped.vel.y = 0; ped.vel.x *= Math.max(0, 1 - dt * 5); ped.vel.z *= Math.max(0, 1 - dt * 5); }
        this.game.collide.resolve(ped.pos, 0.3);
        if (ped.downT <= 0) { ped.state = 'flee'; ped.fleeT = 4; ped.anim.mode = 'getup'; ped.anim.getupT = 0; ped.fleeDir = ped.heading + Math.PI; }
      } else if (ped.state === 'flee') {
        ped.fleeT -= dt;
        targetSpeed = ped.anim.mode === 'getup' ? 0 : 5.2;
        targetHeading = ped.fleeDir;
        if (ped.fleeT <= 0) ped.state = 'return';
      } else if (ped.state === 'idle') {
        ped.pause -= dt;
        if (ped.pause <= 0) { ped.state = 'walk'; ped.pause = this.rng.range(10, 40); }
      } else {
        // walk / return along path
        const p = ped.path;
        if (p.type === 'wander') {
          tmp.set(p.tx, 0, p.tz);
          if (Math.hypot(tmp.x - ped.pos.x, tmp.z - ped.pos.z) < 1.5) { this.newTarget(ped); if (this.rng.chance(0.4)) { ped.state = 'idle'; ped.pause = this.rng.range(3, 10); } }
        } else {
          if (ped.state === 'return') {
            // snap path parameter to the nearest point (coarse search)
            let best = p.s, bd = Infinity;
            const n = 40, span = p.type === 'ring' ? p.per : 1;
            for (let k = 0; k < n; k++) {
              p.s = (k / n) * span; pathPos(p, tmp);
              const d = (tmp.x - ped.pos.x) ** 2 + (tmp.z - ped.pos.z) ** 2;
              if (d < bd) { bd = d; best = p.s; }
            }
            p.s = best; ped.state = 'walk';
          }
          const adv = ped.walkSpeed * dt;
          if (p.type === 'ring') p.s += adv * p.dir;
          else { p.s += adv * p.dir / Math.max(1, Math.hypot(p.bx - p.ax, p.bz - p.az)); if (p.s > 1 || p.s < 0) { p.dir *= -1; p.s = clamp(p.s, 0, 1); } }
          // aim at a point slightly ahead on the path
          const s0 = p.s;
          p.s += (p.type === 'ring' ? 2.0 : 2.0 / Math.max(1, Math.hypot(p.bx - p.ax, p.bz - p.az))) * p.dir;
          pathPos(p, tmp);
          p.s = s0;
          ped.pause -= dt;
          if (ped.pause <= 0) { ped.state = 'idle'; ped.pause = this.rng.range(2, 7); }
        }
        const dx = tmp.x - ped.pos.x, dz = tmp.z - ped.pos.z;
        if (dx * dx + dz * dz > 0.01) targetHeading = Math.atan2(dx, dz);
        targetSpeed = ped.state === 'idle' ? 0 : ped.walkSpeed;
        // separation from others
        for (const o of this.list) {
          if (o === ped) continue;
          const ox = o.pos.x - ped.pos.x, oz = o.pos.z - ped.pos.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < 1.0 && d2 > 1e-4) { ped.pos.x -= ox * 0.5 * dt * 3; ped.pos.z -= oz * 0.5 * dt * 3; }
        }
      }
      if (ped.state !== 'down') {
        ped.heading = dampAngle(ped.heading, targetHeading, 6, dt);
        ped.speed = damp(ped.speed, targetSpeed, 5, dt);
        ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
        ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
        ped.vel.set(Math.sin(ped.heading) * ped.speed, 0, Math.cos(ped.heading) * ped.speed);
        this.game.collide.resolve(ped.pos, 0.3);
        for (const v of vehicles) if (Math.abs(v.speed) < 2.5) v.pushOut2D(ped.pos, 0.3);
        const g = groundHeight(ped.pos.x, ped.pos.z);
        ped.pos.y = damp(ped.pos.y, g, 20, dt);
        if (surfaceAt(ped.pos.x, ped.pos.z) === 'grass' && ped.speed > 0.3) this.game.grass?.stamp(ped.pos.x, ped.pos.z, 0.25, ped.vel.x, ped.vel.z, 0.5);
      }
      ped.onRoad = surfaceAt(ped.pos.x, ped.pos.z) === 'road';
      ped.anim.speed = ped.state === 'down' ? 0 : ped.speed;
      if (ped.anim.mode !== 'down' && ped.anim.mode !== 'getup') ped.anim.mode = 'move';
      // LOD: animate distant peds less often
      const cd = (ped.pos.x - focus.x) ** 2 + (ped.pos.z - focus.z) ** 2;
      ped.animAcc = (ped.animAcc || 0) + dt;
      if (cd < 50 * 50 || ped.animAcc > 0.1) { ped.anim.update(ped.animAcc); ped.animAcc = 0; }
      ped.root.position.copy(ped.pos);
      ped.root.rotation.y = ped.heading;
    }
    for (const s of this.sunbathers) {
      const d = (s.pos.x - focus.x) ** 2 + (s.pos.z - focus.z) ** 2;
      s.root.visible = d < 200 * 200;
      if (s.root.visible && d < 80 * 80) s.anim.update(dt);
      if (s.lounger && s.lounger.moved) { s.root.visible = false; }
    }
  }

  all() { return this.list; }
}
