// GPU grass: blades are instanced around the camera and wrapped on a fixed world lattice,
// so the field looks infinite and doesn't slide when you move. Height comes from the terrain
// height texture, density from parks/terrain masks, and every blade sways in the wind.
import * as THREE from 'three';
import { CITY_EDGE, CURB_H, WATER_LEVEL } from './config.js';
import { globalUniforms } from './materials.js';

function bladeGeometry(segments = 4) {
  const pos = [], col = [], idx = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const w = 1 - t * 0.92;
    if (s < segments) {
      pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0);
      const c = 0.35 + t * 0.65;
      col.push(c, c, c, c, c, c);
    } else {
      pos.push(0, 1, 0);
      col.push(1, 1, 1);
    }
  }
  for (let s = 0; s < segments - 1; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, terrain, parks, density) {
    this.layers = [];
    const parkArr = [];
    for (let i = 0; i < 16; i++) {
      const p = parks[i];
      parkArr.push(p ? new THREE.Vector4(p.minX, p.minZ, p.maxX, p.maxZ) : new THREE.Vector4(1e6, 1e6, 1e6, 1e6));
    }
    const common = {
      uHeight: { value: terrain.heightTex },
      uHInfo: { value: new THREE.Vector4(terrain.origin, terrain.res, terrain.N, 0) },
      uParks: { value: parkArr },
      uCenter: { value: new THREE.Vector3() },
      uTime: globalUniforms.uTime,
      uWind: { value: new THREE.Vector2(1, 0.4) },
    };
    this.common = common;
    const specs = [
      { R: 24, count: Math.floor(110000 * density), h: 0.5, w: 0.07, seg: 4 },
      { R: 75, count: Math.floor(70000 * density), h: 0.7, w: 0.16, seg: 2 },
    ];
    for (const sp of specs) {
      if (sp.count < 1000) continue;
      const base = bladeGeometry(sp.seg);
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      g.setAttribute('position', base.attributes.position);
      g.setAttribute('normal', base.attributes.normal);
      g.setAttribute('color', base.attributes.color);
      const off = new Float32Array(sp.count * 2), rnd = new Float32Array(sp.count * 4);
      for (let i = 0; i < sp.count; i++) {
        off[i * 2] = Math.random() * sp.R * 2; off[i * 2 + 1] = Math.random() * sp.R * 2;
        rnd[i * 4] = Math.random(); rnd[i * 4 + 1] = Math.random(); rnd[i * 4 + 2] = Math.random(); rnd[i * 4 + 3] = Math.random();
      }
      g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
      g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
      g.instanceCount = sp.count;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      const R = sp.R, BH = sp.h, BW = sp.w;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, common);
        sh.uniforms.uR = { value: R };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            attribute vec2 aOffset; attribute vec4 aRand;
            uniform sampler2D uHeight; uniform vec4 uHInfo; uniform vec4 uParks[16];
            uniform vec3 uCenter; uniform float uTime; uniform vec2 uWind; uniform float uR;
            varying float vFade;
            float hAt(vec2 w) {
              if (abs(w.x) < ${CITY_EDGE.toFixed(1)} && abs(w.y) < ${CITY_EDGE.toFixed(1)}) return ${(CURB_H + 0.01).toFixed(3)};
              vec2 g = (w - vec2(uHInfo.x)) / uHInfo.y;
              float N = uHInfo.z;
              g = clamp(g, vec2(0.0), vec2(N - 1.001));
              ivec2 i = ivec2(floor(g)); vec2 f = fract(g);
              float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
              float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r, d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
              return f.x > f.y ? a + (b - a) * f.x + (d - b) * f.y : a + (d - c) * f.x + (c - a) * f.y;
            }
            float vhash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
              return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y); }
            float grassMask(vec2 w, float gy) {
              float m = 0.0;
              if (abs(w.x) < ${(CITY_EDGE + 1.5).toFixed(1)} && abs(w.y) < ${(CITY_EDGE + 1.5).toFixed(1)}) {
                for (int k = 0; k < 16; k++) {
                  vec4 p = uParks[k];
                  if (w.x > p.x + 0.3 && w.x < p.z - 0.3 && w.y > p.y + 0.3 && w.y < p.w - 0.3) {
                    m = 1.0;
                    if (p.z - p.x > 60.0) {
                      vec2 c = vec2(p.x + p.z, p.y + p.w) * 0.5;
                      if (abs(w.x - c.x) < 2.5 || abs(w.y - c.y) < 2.5 || length(w - c) < 6.5) m = 0.0;
                    }
                  }
                }
              } else {
                m = 1.0;
                if (gy < ${(WATER_LEVEL + 0.35).toFixed(2)}) m = 0.0;
                if (gy > 150.0) m *= 0.3;
              }
              float n = vnoise(w * 0.07) * 0.7 + vnoise(w * 0.31) * 0.3;
              return m * smoothstep(0.18, 0.5, n + 0.15);
            }`)
          .replace('#include <beginnormal_vertex>', `
            vec2 rel = mod(aOffset - uCenter.xz + uR, 2.0 * uR) - uR;
            vec2 wxz = uCenter.xz + rel;
            float gy = hAt(wxz);
            float dist = length(rel);
            float fade = 1.0 - smoothstep(uR * 0.65, uR, dist);
            float mask = grassMask(wxz, gy);
            float sc = fade * mask * (0.55 + aRand.x * 0.9);
            float rot = aRand.y * 6.2831;
            float cr = cos(rot), sr = sin(rot);
            vec3 objectNormal = normalize(vec3(sr * 0.35, 1.0, cr * 0.35));
            vFade = fade;
          `)
          .replace('#include <begin_vertex>', `
            float hh = position.y;
            vec3 transformed = vec3(position.x * ${BW.toFixed(3)} * (0.7 + aRand.w * 0.6), hh * ${BH.toFixed(3)} * sc, 0.0);
            float gust = sin(uTime * 1.7 + wxz.x * 0.11 + wxz.y * 0.07) * 0.5 + sin(uTime * 3.1 + wxz.x * 0.37) * 0.25;
            float lean = (aRand.z - 0.3) * 0.5 + gust * 0.45;
            vec2 wd = uWind * lean * hh * hh * ${BH.toFixed(3)} * sc;
            vec3 rp = vec3(transformed.x * cr, transformed.y, -transformed.x * sr);
            transformed = vec3(wxz.x + rp.x + wd.x, gy + rp.y - abs(lean) * hh * hh * 0.12 * sc, wxz.y + rp.z + wd.y);
          `)
          .replace('#include <color_vertex>', `#include <color_vertex>
            // linear-space albedo (sRGB #487a1e .. #9aac3c)
            vec3 tintA = vec3(0.022, 0.085, 0.009), tintB = vec3(0.12, 0.165, 0.028);
            vColor.rgb *= mix(tintA, tintB, aRand.w * 0.8 + aRand.x * 0.2);
          `);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vFade;');
      };
      mat.customProgramCacheKey = () => `grass-${R}`;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      scene.add(mesh);
      this.layers.push(mesh);
    }
  }
  update(camPos) {
    this.common.uCenter.value.copy(camPos);
  }
}
