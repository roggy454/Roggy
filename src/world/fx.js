// Particles (tyre smoke, dust, rain spray, splashes, sparks, engine smoke,
// hydrant geysers) and persistent skid marks.
import * as THREE from 'three';
import { U, LAYER_NO_REFLECT } from '../core/globals.js';
import { RNG } from '../core/utils.js';

const vert = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vA; varying vec3 vC;
uniform float uScale;
void main() {
  vA = aAlpha; vC = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
}`;
const frag = /* glsl */`
uniform sampler2D uMap; varying float vA; varying vec3 vC;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC, a);
}`;

class ParticlePool {
  constructor(scene, max, tex, blending) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uniforms = { uMap: { value: tex }, uScale: { value: 600 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending,
    }));
    this.points.frustumCulled = false;
    this.points.layers.set(LAYER_NO_REFLECT);
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, size, grow, life, alpha, r, g, b, grav = 0, drag = 0.5) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.maxLife[i] = life;
    this.a0[i] = alpha; this.alpha[i] = alpha;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, T, renderer) {
    this.rng = new RNG(5150);
    const smokeTex = T.glow;
    this.soft = new ParticlePool(scene, 1600, smokeTex, THREE.NormalBlending);
    this.add = new ParticlePool(scene, 500, smokeTex, THREE.AdditiveBlending);
    this.light = 1;
    this.geysers = [];
  }
  setScale(h) { this.soft.uniforms.uScale.value = h * 0.9; this.add.uniforms.uScale.value = h * 0.9; }
  tireSmoke(p, wet) {
    const r = this.rng, L = this.light;
    const c = (wet > 0.4 ? 0.75 : 0.85) * L;
    this.soft.emit(p.x + r.range(-0.2, 0.2), p.y + 0.12, p.z + r.range(-0.2, 0.2), r.range(-0.6, 0.6), r.range(0.3, 0.9), r.range(-0.6, 0.6), 0.35, 1.1, r.range(0.9, 1.8), wet > 0.4 ? 0.06 : 0.1, c, c, c, -0.05, 0.8);
  }
  dust(p, surface) {
    const r = this.rng, L = this.light;
    const col = surface === 'sand' ? [0.82, 0.72, 0.52] : [0.42, 0.4, 0.28];
    this.soft.emit(p.x, p.y + 0.1, p.z, r.range(-1, 1), r.range(0.5, 1.5), r.range(-1, 1), 0.5, 1.6, r.range(0.8, 1.6), 0.35, col[0] * L, col[1] * L, col[2] * L, 0.3, 0.8);
  }
  spray(p, vel) {
    const r = this.rng, L = this.light;
    this.soft.emit(p.x, p.y + 0.1, p.z, -vel.x * 0.1 + r.range(-0.5, 0.5), r.range(0.5, 1.5), -vel.z * 0.1 + r.range(-0.5, 0.5), 0.4, 2.0, 0.6, 0.18, 0.8 * L, 0.85 * L, 0.9 * L, 1, 1.5);
  }
  splash(p, speed) {
    const r = this.rng, L = this.light;
    for (let i = 0; i < 3; i++) this.soft.emit(p.x + r.range(-1, 1), p.y + 0.3, p.z + r.range(-1, 1), r.range(-2, 2), r.range(2, 4) + speed * 0.1, r.range(-2, 2), 0.5, 1.4, 1.0, 0.5, 0.85 * L, 0.9 * L, 0.95 * L, 9.8, 0.4);
  }
  sparks(p, n) {
    const r = this.rng;
    for (let i = 0; i < n; i++) this.add.emit(p.x, p.y, p.z, r.range(-5, 5), r.range(1, 6), r.range(-5, 5), 0.12, -0.05, r.range(0.25, 0.6), 1, 6, 3, 0.8, 9.8, 0.3);
  }
  engineSmoke(p, black) {
    const r = this.rng, L = this.light;
    const c = (black ? 0.12 : 0.6) * L;
    this.soft.emit(p.x + r.range(-0.2, 0.2), p.y, p.z + r.range(-0.2, 0.2), r.range(-0.3, 0.3), r.range(1, 2), r.range(-0.3, 0.3), 0.5, 1.8, r.range(1.5, 3), black ? 0.5 : 0.3, c, c, c, -0.2, 0.3);
  }
  footDust(p, surface) {
    const r = this.rng, L = this.light;
    if (surface === 'sand') this.soft.emit(p.x, p.y + 0.05, p.z, r.range(-0.3, 0.3), r.range(0.2, 0.6), r.range(-0.3, 0.3), 0.15, 0.6, 0.5, 0.35, 0.85 * L, 0.75 * L, 0.55 * L, 1, 1);
    else if (surface === 'water' || surface === 'wet') this.soft.emit(p.x, p.y + 0.05, p.z, r.range(-0.5, 0.5), r.range(0.8, 1.6), r.range(-0.5, 0.5), 0.12, 0.5, 0.4, 0.4, 0.85 * L, 0.9 * L, 0.95 * L, 9.8, 0.5);
  }
  addGeyser(p) { this.geysers.push({ x: p.x, y: p.y, z: p.z, t: 14 }); }
  update(dt, light) {
    this.light = light;
    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const g = this.geysers[i];
      g.t -= dt;
      if (g.t <= 0) { this.geysers.splice(i, 1); continue; }
      const r = this.rng;
      for (let k = 0; k < 4; k++) this.soft.emit(g.x + r.range(-0.1, 0.1), g.y + 0.6, g.z + r.range(-0.1, 0.1), r.range(-0.8, 0.8), r.range(7, 10), r.range(-0.8, 0.8), 0.35, 1.2, 1.6, 0.45, 0.8 * light, 0.88 * light, 0.95 * light, 9.8, 0.1);
    }
    this.soft.update(dt);
    this.add.update(dt);
  }
}

export class SkidMarks {
  constructor(scene) {
    this.max = 4000;
    this.pos = new Float32Array(this.max * 4 * 3);
    const idx = new Uint32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.n = 0; this.count = 0;
    this.last = new Map();
  }
  add(i, veh, cp, wheel) {
    const key = veh.id * 4 + i;
    const prev = this.last.get(key);
    const p = new THREE.Vector3(cp.x, cp.y + 0.015, cp.z);
    if (prev && prev.distanceTo(p) < 0.25) return;
    if (prev && prev.distanceTo(p) < 2.5) {
      const dx = p.x - prev.x, dz = p.z - prev.z, l = Math.hypot(dx, dz) || 1;
      const w = veh.spec.tireW * 0.45;
      const nx = -dz / l * w, nz = dx / l * w;
      const o = this.n * 12;
      this.pos.set([prev.x + nx, prev.y, prev.z + nz, prev.x - nx, prev.y, prev.z - nz, p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz], o);
      this.n = (this.n + 1) % this.max;
      this.count = Math.min(this.max, this.count + 1);
      this.geo.attributes.position.needsUpdate = true;
      this.geo.setDrawRange(0, this.count * 6);
    }
    this.last.set(key, p);
  }
  lift(i, veh) { this.last.delete(veh.id * 4 + i); }
}
