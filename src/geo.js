// Geometry helpers: a quad builder with world-scaled UVs and a primitive merger with vertex colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class GeoBuilder {
  constructor({ color = false, seed = false } = {}) {
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
    this.col = color ? [] : null;
    this.seed = seed ? [] : null;
    this.n = 0;
  }
  // p0..p3 counter-clockwise seen from the front side.
  quad(p0, p1, p2, p3, nrm, uvs, color = null, seed = 0) {
    const b = this.n;
    for (const p of [p0, p1, p2, p3]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nrm[0], nrm[1], nrm[2]); }
    for (const t of uvs) this.uv.push(t[0], t[1]);
    if (this.col) for (let k = 0; k < 4; k++) this.col.push(color[0], color[1], color[2]);
    if (this.seed) for (let k = 0; k < 4; k++) this.seed.push(seed);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  // Vertical wall from A to B (xz), outward normal on the right of A->B.
  wall(ax, az, bx, bz, y0, y1, u0, u1, v0, v1, color, seed) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const n = [-dz / l, 0, dx / l];
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], n,
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color, seed);
  }
  top(x0, z0, x1, z1, y, uvScale = 1, color, seed, uOff = 0, vOff = 0) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0],
      [[x0 / uvScale + uOff, -z0 / uvScale + vOff], [x0 / uvScale + uOff, -z1 / uvScale + vOff],
       [x1 / uvScale + uOff, -z1 / uvScale + vOff], [x1 / uvScale + uOff, -z0 / uvScale + vOff]], color, seed);
  }
  bottom(x0, z0, x1, z1, y, uvScale = 1, color) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0],
      [[x0 / uvScale, z0 / uvScale], [x1 / uvScale, z0 / uvScale], [x1 / uvScale, z1 / uvScale], [x0 / uvScale, z1 / uvScale]], color);
  }
  // Axis-aligned box with world-scaled UVs.
  box(x0, y0, z0, x1, y1, z1, uvScale = 1, color = null, seed = 0, skipBottom = true) {
    const s = uvScale;
    this.wall(x0, z1, x1, z1, y0, y1, x0 / s, x1 / s, y0 / s, y1 / s, color, seed);
    this.wall(x1, z1, x1, z0, y0, y1, -z1 / s, -z0 / s, y0 / s, y1 / s, color, seed);
    this.wall(x1, z0, x0, z0, y0, y1, -x1 / s, -x0 / s, y0 / s, y1 / s, color, seed);
    this.wall(x0, z0, x0, z1, y0, y1, z0 / s, z1 / s, y0 / s, y1 / s, color, seed);
    this.top(x0, z0, x1, z1, y1, s, color, seed);
    if (!skipBottom) this.bottom(x0, z0, x1, z1, y0, s, color);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.seed) g.setAttribute('aSeed', new THREE.Float32BufferAttribute(this.seed, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Collects transformed primitives with a flat vertex colour (and optional extra float attributes)
// and merges them into one geometry, so a whole category of props costs one draw call.
export class PrimMerger {
  constructor(extra = {}) {
    this.list = [];
    this.extra = extra; // name -> default value (array length = itemSize)
  }
  add(geo, matrix, color, extraValues = {}) {
    const g = geo.index ? geo.clone() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    const col = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const [name, def] of Object.entries(this.extra)) {
      const v = extraValues[name] ?? def;
      const size = Array.isArray(v) ? v.length : 1;
      const arr = new Float32Array(n * size);
      for (let i = 0; i < n; i++) {
        if (size === 1) arr[i] = v; else for (let k = 0; k < size; k++) arr[i * size + k] = v[k];
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    if (!g.index) {
      const idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx);
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.list.push(g);
    return g;
  }
  merge() {
    if (!this.list.length) return new THREE.BufferGeometry();
    const m = mergeGeometries(this.list, false);
    m.computeBoundingSphere();
    for (const g of this.list) g.dispose();
    this.list = [];
    return m;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function mtx(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z); _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}
