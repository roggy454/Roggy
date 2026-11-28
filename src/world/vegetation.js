// Procedural palms, broadleaf shade trees and bushes. Instanced, with wind sway
// shared between colour and shadow passes.
import * as THREE from 'three';
import { U } from '../core/globals.js';
import { RNG } from '../core/utils.js';
import { GeoBuilder } from '../core/geo.js';

function windify(material, { trunk = 0.012, flutter = 0.0, height = 10 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWind = U.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        float hh = max(transformed.y, 0.0) / ${height.toFixed(1)};
        float ph = uTime * (0.9 + uWind * 0.8) + ip.x * 0.09 + ip.z * 0.07;
        float gust = 0.6 + 0.4 * sin(uTime * 0.37 + ip.x * 0.01);
        float sw = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25) * uWind * gust;
        transformed.x += sw * hh * hh * ${(trunk * height * 10).toFixed(4)};
        transformed.z += sw * 0.6 * hh * hh * ${(trunk * height * 10 * 0.6).toFixed(4)};
        float fl = ${flutter.toFixed(4)} * uWind * (0.5 + gust);
        transformed.y += sin(uTime * 7.0 + position.x * 3.1 + position.z * 2.3 + ip.x) * fl * length(position.xz - vec2(0.0));
        transformed.x += cos(uTime * 6.0 + position.z * 2.7 + ip.z) * fl * 0.5;
      }`);
  };
  material.customProgramCacheKey = () => 'wind' + trunk + flutter + height;
  return material;
}

function depthFor(material, opts) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map, alphaTest: material.alphaTest, side: THREE.DoubleSide });
  return windify(d, opts);
}

// ---------------------------------------------------------------- palm
function palmGeometry(rng, curve) {
  const H = 10;
  const trunk = new GeoBuilder();
  const segs = 8, rows = 14;
  const center = (t) => [curve * t * t * 1.6, t * H, curve * t * t * 0.3];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const [cx, cy, cz] = center(t);
    const r = 0.17 + 0.11 * (1 - t) + 0.12 * Math.max(0, 1 - t * 8) ** 2;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      trunk.vert(cx + nx * r, cy, cz + nz * r, nx, 0.15, nz, (s / segs) * 2, cy / 2.6);
    }
  }
  for (let i = 0; i < rows; i++) for (let s = 0; s < segs; s++) {
    const a = i * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
    trunk.idx.push(a, c, b, b, c, d);
  }
  const top = center(1);
  // crown
  const crown = new GeoBuilder({ color: true });
  const nf = rng.int(12, 15);
  for (let f = 0; f < nf; f++) {
    const yaw = (f / nf) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const dead = f % 6 === 0 && rng.chance(0.6);
    const up = dead ? -1.1 : rng.range(-0.15, 0.75);
    const len = dead ? rng.range(2.2, 2.8) : rng.range(3.6, 4.6);
    const width = 1.15;
    const steps = 9;
    const dir = [Math.cos(yaw), Math.sin(yaw)];
    const side = [-dir[1], dir[0]];
    const g = dead ? [0.55, 0.42, 0.25] : [rng.range(0.85, 1.05), rng.range(0.9, 1.05), rng.range(0.8, 1.0)];
    crown.setColor(...g);
    const base = crown.n;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const dist = t * len;
      // arching then drooping centreline
      const y = top[1] + 0.15 + Math.sin(Math.min(1, t * 1.4) * 1.2) * up * len * 0.35 - t * t * len * 0.45;
      const cx = top[0] + dir[0] * dist * (dead ? 0.35 : 1), cz = top[2] + dir[1] * dist * (dead ? 0.35 : 1);
      const w = width * Math.sin(Math.min(1, t * 1.1 + 0.08) * Math.PI) * 0.5;
      const droop = w * 0.55; // leaflets hang down from the rachis
      crown.vert(cx - side[0] * w, y - droop, cz - side[1] * w, 0, 1, 0, 0, t);
      crown.vert(cx, y, cz, 0, 1, 0, 0.5, t);
      crown.vert(cx + side[0] * w, y - droop, cz + side[1] * w, 0, 1, 0, 1, t);
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 3;
      crown.idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  // coconuts
  const nut = new THREE.SphereGeometry(0.13, 6, 5);
  const m = new THREE.Matrix4();
  for (let k = 0; k < rng.int(3, 7); k++) {
    const a = rng.range(0, Math.PI * 2);
    m.makeTranslation(top[0] + Math.cos(a) * 0.22, top[1] - 0.25 + rng.range(-0.1, 0.1), top[2] + Math.sin(a) * 0.22);
    crown.addGeometry(nut, m, [0.45, 0.38, 0.12]);
  }
  const cg = crown.build();
  // soften lighting: blend normals toward up + outward from crown
  const p = cg.attributes.position, n = cg.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const ox = p.getX(i) - top[0], oy = p.getY(i) - top[1] + 1.5, oz = p.getZ(i) - top[2];
    const l = Math.hypot(ox, oy, oz) || 1;
    n.setXYZ(i, ox / l * 0.5, 0.8 + oy / l * 0.2, oz / l * 0.5);
  }
  n.needsUpdate = true;
  cg.normalizeNormals?.();
  return { trunk: trunk.build(), crown: cg };
}

// ---------------------------------------------------------------- broadleaf
function cardCluster(builder, rng, cx, cy, cz, radius, count, sphereC) {
  for (let i = 0; i < count; i++) {
    const u = rng.next() * 2 - 1, th = rng.next() * Math.PI * 2;
    const rr = Math.cbrt(rng.next()) * radius;
    const s = Math.sqrt(1 - u * u);
    const px = cx + s * Math.cos(th) * rr, py = cy + u * rr * 0.75, pz = cz + s * Math.sin(th) * rr;
    const size = rng.range(0.9, 1.4);
    // random orientation
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, Math.PI), rng.range(0, Math.PI * 2), rng.range(0, Math.PI)));
    const ax = new THREE.Vector3(size, 0, 0).applyQuaternion(q), ay = new THREE.Vector3(0, size, 0).applyQuaternion(q);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const shade = rng.range(0.8, 1.1);
    builder.setColor(shade, shade, shade);
    const base = builder.n;
    for (const [a, b] of corners) {
      const x = px + ax.x * a * 0.5 + ay.x * b * 0.5, y = py + ax.y * a * 0.5 + ay.y * b * 0.5, z = pz + ax.z * a * 0.5 + ay.z * b * 0.5;
      let nx = x - sphereC[0], ny = y - sphereC[1], nz = z - sphereC[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      builder.vert(x, y, z, nx / l, ny / l + 0.25, nz / l, (a + 1) / 2, (b + 1) / 2);
    }
    builder.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function tubeBetween(builder, a, b, r0, r1, segs = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length(); dir.normalize();
  const tmp = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, tmp).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const base = builder.n;
  for (let i = 0; i <= 1; i++) {
    const c = i ? b : a, r = i ? r1 : r0;
    for (let s = 0; s <= segs; s++) {
      const t = (s / segs) * Math.PI * 2;
      const n = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t));
      builder.vert(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r, n.x, n.y, n.z, s / segs, i * len / 2);
    }
  }
  for (let s = 0; s < segs; s++) { const a0 = base + s, b0 = a0 + 1, c0 = a0 + segs + 1, d0 = c0 + 1; builder.idx.push(a0, c0, b0, b0, c0, d0); }
}

function broadleafGeometry(rng) {
  const wood = new GeoBuilder();
  const leaves = new GeoBuilder({ color: true });
  const trunkTop = new THREE.Vector3(rng.range(-0.3, 0.3), 3.2, rng.range(-0.3, 0.3));
  tubeBetween(wood, new THREE.Vector3(0, -0.2, 0), trunkTop, 0.32, 0.24, 8);
  const crownC = [0, 6.2, 0];
  const nb = rng.int(4, 6);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const end = new THREE.Vector3(Math.cos(a) * rng.range(2, 3.2), rng.range(5, 6.8), Math.sin(a) * rng.range(2, 3.2));
    tubeBetween(wood, trunkTop, end, 0.18, 0.07, 6);
    cardCluster(leaves, rng, end.x, end.y + 0.4, end.z, rng.range(1.5, 2.1), 34, crownC);
  }
  cardCluster(leaves, rng, 0, 7.0, 0, 2.2, 40, crownC);
  return { wood: wood.build(), leaves: leaves.build() };
}

function bushGeometry(rng) {
  const b = new GeoBuilder({ color: true });
  const c = [0, 0.1, 0];
  cardCluster(b, rng, 0, 0.55, 0, 0.75, 26, c);
  cardCluster(b, rng, rng.range(-0.4, 0.4), 0.4, rng.range(-0.4, 0.4), 0.55, 14, c);
  const g = b.build();
  // flatten bottom
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.02) p.setY(i, 0.02);
  return g;
}

// ---------------------------------------------------------------- manager
export class Vegetation {
  constructor(scene, T) {
    this.scene = scene;
    const rng = new RNG(808);
    this.palmVariants = [palmGeometry(rng, 0.25), palmGeometry(rng, 1.1), palmGeometry(rng, 0.65)];
    this.treeVariants = [broadleafGeometry(rng), broadleafGeometry(rng)];
    this.bushVariants = [bushGeometry(rng), bushGeometry(rng)];
    const barkPalm = new THREE.MeshStandardMaterial({ map: T.palmBark.map, normalMap: T.palmBark.normal, roughness: 0.9 });
    const frond = new THREE.MeshStandardMaterial({ map: T.palmFrond, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 });
    const barkOak = new THREE.MeshStandardMaterial({ map: T.oakBark.map, normalMap: T.oakBark.normal, roughness: 0.95 });
    const leaf = new THREE.MeshStandardMaterial({ map: T.leaves, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8 });
    const bush = new THREE.MeshStandardMaterial({ map: T.bushLeaves, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 });
    const flower = new THREE.MeshStandardMaterial({ map: T.flowerLeaves, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 });
    this.mats = {
      barkPalm: windify(barkPalm, { trunk: 0.012, height: 10 }),
      frond: windify(frond, { trunk: 0.012, flutter: 0.035, height: 10 }),
      barkOak: windify(barkOak, { trunk: 0.002, height: 8 }),
      leaf: windify(leaf, { trunk: 0.004, flutter: 0.015, height: 8 }),
      bush: windify(bush, { trunk: 0.01, flutter: 0.01, height: 1.2 }),
      flower: windify(flower, { trunk: 0.01, flutter: 0.01, height: 1.2 }),
    };
    this.depth = {
      frond: depthFor(frond, { trunk: 0.012, flutter: 0.035, height: 10 }),
      leaf: depthFor(leaf, { trunk: 0.004, flutter: 0.015, height: 8 }),
      bush: depthFor(bush, { trunk: 0.01, flutter: 0.01, height: 1.2 }),
    };
    this.palms = []; this.trees = []; this.bushes = [];
  }

  addPalm(x, y, z, scale, rot) { this.palms.push({ x, y, z, scale, rot, v: this.palms.length % 3 }); }
  addTree(x, y, z, scale, rot) { this.trees.push({ x, y, z, scale, rot, v: this.trees.length % 2 }); }
  addBush(x, y, z, sx, sy, sz, rot, flowering) { this.bushes.push({ x, y, z, sx, sy, sz, rot, flowering, v: this.bushes.length % 2 }); }

  build() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const make = (geo, mat, list, depth, cast = true) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot);
        s.set(it.sx ?? it.scale, it.sy ?? it.scale, it.sz ?? it.scale);
        p.set(it.x, it.y, it.z);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = cast; im.receiveShadow = true;
      if (depth) im.customDepthMaterial = depth;
      im.computeBoundingSphere();
      this.scene.add(im);
      return im;
    };
    for (let v = 0; v < 3; v++) {
      const list = this.palms.filter((t) => t.v === v);
      make(this.palmVariants[v].trunk, this.mats.barkPalm, list, null);
      make(this.palmVariants[v].crown, this.mats.frond, list, this.depth.frond);
    }
    for (let v = 0; v < 2; v++) {
      const list = this.trees.filter((t) => t.v === v);
      make(this.treeVariants[v].wood, this.mats.barkOak, list, null);
      make(this.treeVariants[v].leaves, this.mats.leaf, list, this.depth.leaf);
    }
    for (let v = 0; v < 2; v++) {
      make(this.bushVariants[v], this.mats.bush, this.bushes.filter((t) => t.v === v && !t.flowering), this.depth.bush);
      make(this.bushVariants[v], this.mats.flower, this.bushes.filter((t) => t.v === v && t.flowering), this.depth.bush);
    }
  }
}
