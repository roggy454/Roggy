// Instanced trees: leaf-card broadleaf trees for streets/parks and layered pines for the hills.
// Chunked so frustum culling skips far groups; leaves sway in the wind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from './utils.js';
import { CITY_EDGE, WATER_LEVEL, WORLD_HALF } from './config.js';
import { globalUniforms } from './materials.js';

function cardQuad(center, normalDir, size, rotZ, out) {
  // A camera-independent card oriented with its plane perpendicular to normalDir.
  const n = normalDir.clone().normalize();
  const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3().crossVectors(up, n).normalize();
  const b = new THREE.Vector3().crossVectors(n, t).normalize();
  const c = Math.cos(rotZ), s = Math.sin(rotZ);
  const T = t.clone().multiplyScalar(c).addScaledVector(b, s).multiplyScalar(size / 2);
  const B = b.clone().multiplyScalar(c).addScaledVector(t, -s).multiplyScalar(size / 2);
  const base = out.pos.length / 3;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [u, v] of corners) {
    const p = center.clone().addScaledVector(T, u).addScaledVector(B, v);
    out.pos.push(p.x, p.y, p.z);
    out.uv.push((u + 1) / 2, (v + 1) / 2);
    out.nor.push(n.x, n.y, n.z);
  }
  out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildBroadleaf(rng) {
  const trunk = new THREE.CylinderGeometry(0.14, 0.24, 4.2, 7, 3);
  trunk.translate(0, 2.1, 0);
  // slight bend
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 0.6) * 0.08); }
  const branches = [];
  for (let k = 0; k < 4; k++) {
    const br = new THREE.CylinderGeometry(0.05, 0.09, 2.2, 5);
    br.translate(0, 1.1, 0);
    br.rotateZ(0.7 + rng.float(-0.2, 0.2));
    br.rotateY(k * Math.PI / 2 + rng.float(-0.3, 0.3));
    br.translate(0, 3.2 + k * 0.2, 0);
    branches.push(br);
  }
  const wood = mergeGeometries([trunk.toNonIndexed(), ...branches.map((b) => b.toNonIndexed())]);
  const leaves = { pos: [], uv: [], nor: [], idx: [] };
  const center = new THREE.Vector3(0, 5.6, 0);
  const cards = 34;
  for (let k = 0; k < cards; k++) {
    const dir = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.55, 1), rng.float(-1, 1)).normalize();
    const pos = center.clone().add(new THREE.Vector3(dir.x * 2.3, dir.y * 1.9, dir.z * 2.3).multiplyScalar(rng.float(0.45, 1)));
    const nd = dir.clone().add(new THREE.Vector3(rng.float(-0.5, 0.5), rng.float(-0.5, 0.5), rng.float(-0.5, 0.5)));
    cardQuad(pos, nd, rng.float(2.0, 2.8), rng.float(0, Math.PI * 2), leaves);
  }
  // normals point away from the canopy centre for soft volumetric shading
  for (let i = 0; i < leaves.pos.length; i += 3) {
    const v = new THREE.Vector3(leaves.pos[i], leaves.pos[i + 1], leaves.pos[i + 2]).sub(center).normalize();
    leaves.nor[i] = v.x; leaves.nor[i + 1] = v.y * 0.8 + 0.2; leaves.nor[i + 2] = v.z;
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(leaves.pos, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(leaves.nor, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(leaves.uv, 2));
  lg.setIndex(leaves.idx);
  return { wood, leaves: lg };
}

function buildPine(rng) {
  const trunk = new THREE.CylinderGeometry(0.1, 0.28, 9, 6, 1);
  trunk.translate(0, 4.5, 0);
  const leaves = { pos: [], uv: [], nor: [], idx: [] };
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const y = 2.2 + t * 1.05;
    const r = 2.6 * (1 - t / tiers) + 0.5;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + t * 0.6 + rng.float(-0.2, 0.2);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const c = new THREE.Vector3(dir.x * r * 0.55, y - 0.2, dir.z * r * 0.55);
      const nd = new THREE.Vector3(dir.x * 0.4, 1, dir.z * 0.4);
      cardQuad(c, nd, r * 1.25 + 0.6, a, leaves);
    }
  }
  // top
  cardQuad(new THREE.Vector3(0, 2.2 + tiers * 1.05, 0), new THREE.Vector3(1, 0.2, 0), 1.6, 0, leaves);
  cardQuad(new THREE.Vector3(0, 2.2 + tiers * 1.05, 0), new THREE.Vector3(0, 0.2, 1), 1.6, 0, leaves);
  for (let i = 0; i < leaves.pos.length; i += 3) {
    const v = new THREE.Vector3(leaves.pos[i], 0, leaves.pos[i + 2]).normalize();
    leaves.nor[i] = v.x * 0.6; leaves.nor[i + 1] = 0.8; leaves.nor[i + 2] = v.z * 0.6;
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(leaves.pos, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(leaves.nor, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(leaves.uv, 2));
  lg.setIndex(leaves.idx);
  return { wood: trunk, leaves: lg };
}

function windify(mat, strength) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = globalUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sw = sin(uTime * 1.3 + ip.x * 0.21 + ip.z * 0.17) * 0.6 + sin(uTime * 2.7 + ip.z * 0.5 + position.x) * 0.25;
        float hf = max(0.0, position.y - 2.0) * ${strength.toFixed(3)};
        transformed.x += sw * hf; transformed.z += sw * hf * 0.6;
      `);
  };
  mat.customProgramCacheKey = () => 'wind-' + strength;
}

export class Trees {
  constructor(scene, terrain, city, tex, density, collision) {
    const rng = new RNG(8080);
    this.group = new THREE.Group();
    scene.add(this.group);
    const broad = buildBroadleaf(rng);
    const pine = buildPine(rng);

    tex.bark.wrapS = tex.bark.wrapT = THREE.RepeatWrapping;
    const barkMat = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.95, color: 0xb8a898 });
    const leafMat = new THREE.MeshStandardMaterial({ map: tex.leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xd8e8c8 });
    const pineMat = new THREE.MeshStandardMaterial({ map: tex.leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0x6a8a62 });
    windify(leafMat, 0.035); windify(pineMat, 0.02);

    // instances: [x, y, z, scale, rotY]
    const broadList = [], pineList = [];
    for (const t of city.treeSpots) broadList.push([t.x, t.y, t.z, t.s * (t.kind === 'street' ? 0.85 : 1), rng.float(0, Math.PI * 2)]);
    const countryN = Math.floor(6500 * density);
    let tries = 0;
    const noise = terrain.noise;
    while ((broadList.length + pineList.length) < countryN + city.treeSpots.length && tries < countryN * 8) {
      tries++;
      const x = rng.float(-WORLD_HALF + 20, WORLD_HALF - 20), z = rng.float(-WORLD_HALF + 20, WORLD_HALF - 20);
      if (Math.abs(x) < CITY_EDGE + 25 && Math.abs(z) < CITY_EDGE + 25) continue;
      const forest = noise(x * 0.004, z * 0.004) * 0.5 + 0.5;
      if (rng.next() > forest * forest * 1.6) continue;
      const y = terrain.terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.6 || y > 230) continue;
      const nx = terrain.terrainHeight(x + 2, z) - terrain.terrainHeight(x - 2, z);
      const nz = terrain.terrainHeight(x, z + 2) - terrain.terrainHeight(x, z - 2);
      if (Math.hypot(nx, nz) > 2.6) continue;
      const s = rng.float(0.8, 1.5);
      if (rng.next() < 0.7 || y > 90) pineList.push([x, y - 0.1, z, s, rng.float(0, 6.28)]);
      else broadList.push([x, y - 0.1, z, s, rng.float(0, 6.28)]);
      collision.addCircle({ x, z, r: 0.35 * s, h: 8 });
    }
    this.makeChunks(broadList, broad, barkMat, leafMat);
    this.makeChunks(pineList, pine, barkMat, pineMat);
  }

  makeChunks(list, geo, woodMat, leafMat) {
    const CH = 400;
    const chunks = new Map();
    for (const t of list) {
      const k = Math.floor(t[0] / CH) * 1000 + Math.floor(t[2] / CH);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(t);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const arr of chunks.values()) {
      const wood = new THREE.InstancedMesh(geo.wood, woodMat, arr.length);
      const leaf = new THREE.InstancedMesh(geo.leaves, leafMat, arr.length);
      arr.forEach((t, i) => {
        p.set(t[0], t[1], t[2]); q.setFromAxisAngle(up, t[4]); s.setScalar(t[3]);
        m.compose(p, q, s);
        wood.setMatrixAt(i, m); leaf.setMatrixAt(i, m);
      });
      for (const im of [wood, leaf]) {
        im.castShadow = true; im.receiveShadow = true;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    }
  }
}
