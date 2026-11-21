// Rolling hills around the city, mountains at the world edge and lakes in the low valleys.
// The same height grid drives the mesh, car suspension raycasts, the grass shader and tree placement.
import * as THREE from 'three';
import { CITY_EDGE, WORLD_HALF, WATER_LEVEL, CURB_H, CITY_HALF, ROAD_HALF, GRID } from './config.js';
import { makeNoise2D, fbm, ridged, smoothstep, clamp } from './utils.js';

export class Terrain {
  constructor(quality) {
    this.half = WORLD_HALF + 300;
    this.res = quality === 'low' ? 10 : 6;
    this.N = Math.floor((this.half * 2) / this.res) + 1;
    this.origin = -this.half;
    const noise = makeNoise2D(9001);
    const noise2 = makeNoise2D(4242);
    this.noise = noise;
    const N = this.N;
    this.h = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = this.origin + i * this.res, z = this.origin + j * this.res;
        this.h[j * N + i] = this.rawHeight(x, z, noise, noise2);
      }
    }
  }

  rawHeight(x, z, noise, noise2) {
    const inner = CITY_EDGE + 12;
    const dx = Math.max(Math.abs(x) - inner, 0), dz = Math.max(Math.abs(z) - inner, 0);
    const d = Math.hypot(dx, dz);
    const f = smoothstep(10, 280, d);
    const hills = fbm(noise, x * 0.0015, z * 0.0015, 5) * 58 + 16;
    const detail = fbm(noise2, x * 0.012, z * 0.012, 3) * 2.5;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const mountains = smoothstep(780, 1180, edge) * (60 + ridged(noise2, x * 0.0011, z * 0.0011, 5) * 320);
    let h = (hills + detail) * f + mountains;
    if (d <= 0) h = 0;
    return h;
  }

  // Bilinear sample of the grid (matches the mesh closely).
  terrainHeight(x, z) {
    const N = this.N;
    const gx = clamp((x - this.origin) / this.res, 0, N - 1.001);
    const gz = clamp((z - this.origin) / this.res, 0, N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const a = this.h[j * N + i], b = this.h[j * N + i + 1];
    const c = this.h[(j + 1) * N + i], d = this.h[(j + 1) * N + i + 1];
    // match the triangle split used by the mesh (diagonal from a to d)
    if (fx > fz) return a + (b - a) * fx + (d - b) * fz;
    return a + (d - c) * fx + (c - a) * fz;
  }

  // Ground height anywhere in the world: roads are at 0, sidewalks/blocks raised by the curb.
  heightAt(x, z) {
    if (Math.abs(x) < CITY_EDGE && Math.abs(z) < CITY_EDGE) {
      return onRoad(x, z) ? 0 : CURB_H;
    }
    return this.terrainHeight(x, z);
  }

  normalAt(x, z, out) {
    const e = 1.0;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
    return out;
  }

  buildMesh(tex) {
    const N = this.N, res = this.res;
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const col = new Float32Array(N * N * 3);
    const blend = new Float32Array(N * N * 3);
    const noise = this.noise;
    const n = new THREE.Vector3();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = this.origin + i * res, z = this.origin + j * res;
        let y = this.h[k];
        const inCity = Math.abs(x) < CITY_EDGE - 1 && Math.abs(z) < CITY_EDGE - 1;
        if (inCity) y = -0.6;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const il = Math.max(0, i - 1), ir = Math.min(N - 1, i + 1);
        const jd = Math.max(0, j - 1), ju = Math.min(N - 1, j + 1);
        n.set(this.h[j * N + il] - this.h[j * N + ir], 2 * res, this.h[jd * N + i] - this.h[ju * N + i]).normalize();
        nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
        uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
        const slope = 1 - n.y;
        const m = fbm(noise, x * 0.004, z * 0.004, 3);
        const lush = 0.5 + m * 0.6;
        col[k * 3] = 0.9 + (1 - lush) * 0.25; col[k * 3 + 1] = 0.95 + lush * 0.1; col[k * 3 + 2] = 0.85;
        const rock = smoothstep(0.18, 0.38, slope) + smoothstep(120, 220, y) * 0.8;
        const dirt = smoothstep(0.25, 0.6, fbm(noise, x * 0.02 + 40, z * 0.02, 2)) * 0.7;
        const sand = 1 - smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL + 2.2, y);
        blend[k * 3] = clamp(rock, 0, 1); blend[k * 3 + 1] = dirt; blend[k * 3 + 2] = sand;
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let p = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = d;
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aBlend', new THREE.BufferAttribute(blend, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      map: tex.grass.map, normalMap: tex.grass.normal, normalScale: new THREE.Vector2(0.8, 0.8),
      vertexColors: true, roughness: 0.95, metalness: 0,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.rockMap = { value: tex.rock.map };
      sh.uniforms.dirtMap = { value: tex.dirt.map };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBlend;\nvarying vec3 vBlend;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = aBlend;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D rockMap;\nuniform sampler2D dirtMap;\nvarying vec3 vBlend;')
        .replace('#include <map_fragment>', `
          vec3 gC = texture2D(map, vMapUv).rgb;
          vec3 gFar = texture2D(map, vMapUv * 0.093).rgb;
          gC = mix(gC, gFar, 0.35) * (0.8 + 0.4 * gFar.g / max(0.05, (gFar.r + gFar.g + gFar.b) / 3.0) * 0.5);
          vec3 rC = texture2D(rockMap, vMapUv * 0.37).rgb;
          vec3 dC = texture2D(dirtMap, vMapUv * 0.8).rgb;
          vec3 sC = vec3(0.62, 0.55, 0.42) * (0.85 + 0.3 * dC.r);
          vec3 cc = mix(gC, dC, vBlend.y);
          cc = mix(cc, sC, vBlend.z);
          cc = mix(cc, rC, vBlend.x);
          diffuseColor.rgb *= cc;
        `);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';

    // Height texture for the grass shader.
    const ht = new THREE.DataTexture(this.h, N, N, THREE.RedFormat, THREE.FloatType);
    ht.magFilter = THREE.NearestFilter; ht.minFilter = THREE.NearestFilter;
    ht.needsUpdate = true;
    this.heightTex = ht;
    return mesh;
  }

  buildWater(normalTex) {
    const g = new THREE.PlaneGeometry(this.half * 2, this.half * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    normalTex.repeat.set(220, 220);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d2a33, roughness: 0.08, metalness: 0.1, normalMap: normalTex,
      normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.92,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.y = WATER_LEVEL;
    mesh.receiveShadow = true;
    mesh.name = 'water';
    this.waterNormal = normalTex;
    return mesh;
  }
}

// Is (x, z) on the asphalt of the city grid (inside the city footprint)?
export function onRoad(x, z) {
  const lim = CITY_HALF + ROAD_HALF;
  if (Math.abs(x) > lim + 0.0001 && Math.abs(z) > lim + 0.0001) return false;
  const ix = Math.round((x + CITY_HALF) / GRID), iz = Math.round((z + CITY_HALF) / GRID);
  const dx = Math.abs(x - (-CITY_HALF + clamp(ix, 0, 8) * GRID));
  const dz = Math.abs(z - (-CITY_HALF + clamp(iz, 0, 8) * GRID));
  return (dx < ROAD_HALF && Math.abs(z) < lim) || (dz < ROAD_HALF && Math.abs(x) < lim);
}
