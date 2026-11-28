// Lightweight geometry accumulator used to merge thousands of quads/boxes into
// a handful of draw calls.
import * as THREE from 'three';

export class GeoBuilder {
  constructor({ uv1 = false, color = false } = {}) {
    this.pos = []; this.nrm = []; this.uv = []; this.idx = [];
    this.hasUv1 = uv1; this.uv1 = [];
    this.hasColor = color; this.col = [];
    this.n = 0;
    this.cur = [1, 1, 1];
  }
  setColor(r, g, b) { this.cur = [r, g, b]; return this; }
  vert(x, y, z, nx, ny, nz, u, v, u1 = 0, v1 = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v);
    if (this.hasUv1) this.uv1.push(u1, v1);
    if (this.hasColor) this.col.push(this.cur[0], this.cur[1], this.cur[2]);
    return this.n++;
  }
  // p0..p3 counter-clockwise when seen from the front; uvs per corner
  quad(p0, p1, p2, p3, n, uvs, uv1s = null) {
    const a = this.vert(p0[0], p0[1], p0[2], n[0], n[1], n[2], uvs[0], uvs[1], uv1s ? uv1s[0] : 0, uv1s ? uv1s[1] : 0);
    const b = this.vert(p1[0], p1[1], p1[2], n[0], n[1], n[2], uvs[2], uvs[3], uv1s ? uv1s[2] : 0, uv1s ? uv1s[3] : 0);
    const c = this.vert(p2[0], p2[1], p2[2], n[0], n[1], n[2], uvs[4], uvs[5], uv1s ? uv1s[4] : 0, uv1s ? uv1s[5] : 0);
    const d = this.vert(p3[0], p3[1], p3[2], n[0], n[1], n[2], uvs[6], uvs[7], uv1s ? uv1s[6] : 0, uv1s ? uv1s[7] : 0);
    this.idx.push(a, b, c, a, c, d);
  }
  // horizontal rectangle (facing up) with world-space uvs scaled by 1/tile
  hRect(x0, z0, x1, z1, y, tile = 1, uv1Tile = 0) {
    const uvs = [x0 / tile, -z1 / tile, x1 / tile, -z1 / tile, x1 / tile, -z0 / tile, x0 / tile, -z0 / tile];
    const u1 = uv1Tile ? [x0 / uv1Tile, -z1 / uv1Tile, x1 / uv1Tile, -z1 / uv1Tile, x1 / uv1Tile, -z0 / uv1Tile, x0 / uv1Tile, -z0 / uv1Tile] : null;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], uvs, u1);
  }
  // axis-aligned box. faces: which sides to emit {top,bottom,px,nx,pz,nz}. uv: world/tile
  box(x0, y0, z0, x1, y1, z1, tileU = 1, tileV = 1, faces = null, uvOff = [0, 0]) {
    const f = faces || { top: true, bottom: false, px: true, nx: true, pz: true, nz: true };
    const [ou, ov] = uvOff;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    if (f.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, dx / tileU, 0, dx / tileU, dz / tileU, 0, dz / tileU]);
    if (f.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [0, 0, dx / tileU, 0, dx / tileU, dz / tileU, 0, dz / tileU]);
    const v0 = y0 / tileV + ov, v1 = y1 / tileV + ov;
    if (f.pz) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [ou, v0, ou + dx / tileU, v0, ou + dx / tileU, v1, ou, v1]);
    if (f.px) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [ou + dx / tileU, v0, ou + (dx + dz) / tileU, v0, ou + (dx + dz) / tileU, v1, ou + dx / tileU, v1]);
    if (f.nz) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [ou + (dx + dz) / tileU, v0, ou + (2 * dx + dz) / tileU, v0, ou + (2 * dx + dz) / tileU, v1, ou + (dx + dz) / tileU, v1]);
    if (f.nx) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [ou + (2 * dx + dz) / tileU, v0, ou + (2 * dx + 2 * dz) / tileU, v0, ou + (2 * dx + 2 * dz) / tileU, v1, ou + (2 * dx + dz) / tileU, v1]);
  }
  // append an arbitrary BufferGeometry transformed by matrix (non-indexed or indexed)
  addGeometry(geo, matrix, color = null, uvFixed = null) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), vn = new THREE.Vector3();
    const base = this.n;
    const c = color || this.cur;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      if (n) vn.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); else vn.set(0, 1, 0);
      this.pos.push(v.x, v.y, v.z); this.nrm.push(vn.x, vn.y, vn.z);
      if (uvFixed) this.uv.push(uvFixed[0], uvFixed[1]); else this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      if (this.hasUv1) this.uv1.push(0, 0);
      if (this.hasColor) this.col.push(c[0], c[1], c[2]);
      this.n++;
    }
    if (geo.index) { const ix = geo.index.array; for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]); }
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.hasUv1) g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    if (this.hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
