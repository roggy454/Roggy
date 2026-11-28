// Ocean & bay: Gerstner wave displacement (shared on CPU for floating objects),
// mirror reflections, depth-tinted Miami turquoise shallows, shore foam, rain rings.
import * as THREE from 'three';
import { U, LAYER_NO_REFLECT } from '../core/globals.js';
import { groundHeight, WATER_LEVEL } from './map.js';
import { makeCanvas, toTexture } from '../core/textures.js';
import { clamp, RNG } from '../core/utils.js';

const WAVES = [
  // dirX, dirZ, wavelength, amplitude, steepness
  [0.92, 0.38, 38, 0.34, 0.55],
  [0.6, -0.8, 21, 0.16, 0.5],
  [0.98, 0.18, 12, 0.08, 0.45],
  [-0.3, 0.95, 8, 0.045, 0.4],
  [0.75, 0.66, 5.2, 0.025, 0.35],
];
const SHORE_EXT = 1500;

function buildShoreMask() {
  const S = 512;
  const raw = new Float32Array(S * S), exp = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = (x + 0.5) / S * SHORE_EXT * 2 - SHORE_EXT;
    const wz = (y + 0.5) / S * SHORE_EXT * 2 - SHORE_EXT;
    const d = WATER_LEVEL - groundHeight(wx, wz);
    raw[y * S + x] = clamp(d / 4.5, 0, 1);
    exp[y * S + x] = wx > 600 || wz < -660 || wz > 660 || wx < -740 ? 1 : 0.28;
  }
  const blur = (src, r) => {
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const xx = clamp(x + k, 0, S - 1); s += src[y * S + xx]; n++; }
      out[y * S + x] = s / n;
    }
    const out2 = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const yy = clamp(y + k, 0, S - 1); s += out[yy * S + x]; n++; }
      out2[y * S + x] = s / n;
    }
    return out2;
  };
  const b = blur(raw, 1), e = blur(blur(exp, 6), 6);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // keep the true depth where it is deep, blurred near walls for soft wave damping
    const v = Math.min(raw[i], b[i] * 1.0 + 0.0);
    img.data[i * 4] = v * 255;
    img.data[i * 4 + 1] = e[i] * 255;
    img.data[i * 4 + 2] = raw[i] * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, { srgb: false, repeat: false, mips: false });
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { tex: t, raw, exp: e, S };
}

const waveGLSL = WAVES.map((w, i) => {
  const L = Math.hypot(w[0], w[1]);
  return `{ vec2 D = vec2(${(w[0] / L).toFixed(4)}, ${(w[1] / L).toFixed(4)}); float k = ${(2 * Math.PI / w[2]).toFixed(5)};
    float c = sqrt(9.81 / k); float A = ${w[3].toFixed(4)} * amp; float Q = ${w[4].toFixed(3)};
    float f = k * (dot(D, p.xz) - c * uTime);
    float cf = cos(f), sf = sin(f);
    disp.x += Q * A * D.x * cf; disp.z += Q * A * D.y * cf; disp.y += A * sf;
    nrm.x -= D.x * k * A * cf; nrm.z -= D.y * k * A * cf; nrm.y -= Q * k * A * sf;
    crest += A * sf * k; }`;
}).join('\n');

const vert = /* glsl */`
#include <common>
#include <fog_pars_vertex>
uniform float uTime, uWaveAmp;
uniform sampler2D uShore;
uniform float uShoreExt;
varying vec3 vWorld; varying vec3 vN; varying float vDepth; varying float vCrest;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 p = wp.xyz;
  vec2 suv = (p.xz + uShoreExt) / (2.0 * uShoreExt);
  vec4 sm = texture2D(uShore, suv);
  float depth = sm.r;
  float exposure = sm.g;
  float amp = uWaveAmp * mix(0.25, 1.0, exposure) * smoothstep(0.0, 0.35, depth) * (1.0 + (1.0 - smoothstep(0.1, 0.6, depth)) * exposure * 0.6);
  vec3 disp = vec3(0.0); vec3 nrm = vec3(0.0, 1.0, 0.0); float crest = 0.0;
  ${waveGLSL}
  p += disp;
  vWorld = p; vN = normalize(nrm); vDepth = sm.b; vCrest = crest;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNormalMap, uFoam, uReflTex;
uniform mat4 uReflMat;
uniform float uReflOn, uTime, uRain, uLight, uSunVis, uWaveAmp, uFlash;
uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uSkyCol;
varying vec3 vWorld; varying vec3 vN; varying float vDepth; varying float vCrest;
vec2 ripple(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 q = p * 0.9 + float(i) * 5.17;
    vec2 cell = floor(q); vec2 f = fract(q) - 0.5;
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float tt = fract(t * 1.1 + h);
    vec2 d = f - (vec2(fract(h * 7.1), fract(h * 3.7)) - 0.5) * 0.6;
    float r = length(d), front = tt * 0.5;
    acc += d / (r + 1e-3) * sin((r - front) * 50.0) * smoothstep(0.1, 0.0, abs(r - front)) * (1.0 - tt);
  }
  return acc;
}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec2 uv1 = vWorld.xz * 0.04 + uTime * vec2(0.014, 0.009);
  vec2 uv2 = vWorld.xz * 0.12 + uTime * vec2(-0.011, 0.017);
  vec3 n1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
  vec2 dn = (n1.xy + n2.xy * 0.6) * (0.28 + uWaveAmp * 0.18) * mix(1.0, 0.35, smoothstep(80.0, 600.0, dist));
  dn += ripple(vWorld.xz, uTime) * uRain * 0.35;
  vec3 N = normalize(vN + vec3(dn.x, 0.0, dn.y));
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 refl = uSkyCol;
  if (uReflOn > 0.5) {
    vec4 rc = uReflMat * vec4(vWorld.x, 0.0, vWorld.z, 1.0);
    vec2 ruv = rc.xy / rc.w + N.xz * 0.05;
    refl = texture2D(uReflTex, clamp(ruv, 0.001, 0.999)).rgb;
  }
  float d = vDepth;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.02, 0.75, d)) * uLight;
  float sss = pow(max(dot(V, normalize(-uSunDir + vec3(0.0, 0.4, 0.0))), 0.0), 4.0) * clamp(vCrest * 2.0, 0.0, 1.0);
  body += uShallow * sss * 0.6 * uSunVis;
  vec3 col = mix(body, refl, fres);
  vec3 H = normalize(V + uSunDir);
  float nh = max(dot(N, H), 0.0);
  col += uSunColor * (pow(nh, 600.0) * 9.0 + pow(nh, 80.0) * 0.25) * uSunVis;
  // foam
  float ft = texture2D(uFoam, vWorld.xz * 0.06 + uTime * vec2(0.01, 0.004)).r;
  float ft2 = texture2D(uFoam, vWorld.xz * 0.17 - uTime * 0.02).r;
  float crestFoam = smoothstep(0.35, 0.75, vCrest * 1.3) * (0.5 + uWaveAmp * 0.4);
  float band = 0.5 + 0.5 * sin(uTime * 1.2 - d * 70.0);
  float shoreFoam = (smoothstep(0.1, 0.0, d) + smoothstep(0.22, 0.05, d) * band * 0.6) * step(0.0001, d);
  float foam = clamp((crestFoam + shoreFoam) * (ft * 0.7 + ft2 * 0.5), 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.95, 0.96) * (uLight * 1.4 + 0.02), foam);
  col += vec3(0.5, 0.55, 0.7) * uFlash * fres;
  float alpha = mix(0.45, 1.0, smoothstep(0.0, 0.3, d));
  alpha = max(alpha, foam);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// CPU version (height only) for floating objects
export function waveHeight(x, z, t, waveAmp, shore) {
  let y = 0;
  let depth = 1, exposure = 0.3;
  if (shore) {
    const S = shore.S;
    const px = clamp(Math.floor((x + SHORE_EXT) / (2 * SHORE_EXT) * S), 0, S - 1);
    const pz = clamp(Math.floor((z + SHORE_EXT) / (2 * SHORE_EXT) * S), 0, S - 1);
    depth = shore.raw[pz * S + px]; exposure = shore.exp[pz * S + px];
  }
  const amp = waveAmp * (0.25 + 0.75 * exposure) * Math.min(1, depth / 0.35);
  for (const w of WAVES) {
    const L = Math.hypot(w[0], w[1]);
    const k = 2 * Math.PI / w[2], c = Math.sqrt(9.81 / k);
    y += w[3] * amp * Math.sin(k * ((w[0] / L) * x + (w[1] / L) * z - c * t));
  }
  return WATER_LEVEL + y;
}

function radialGrid(rMax, rings, segs) {
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  const radii = [];
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    radii.push(0.6 * i + Math.pow(t, 3.2) * rMax);
  }
  for (const r of radii) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs, a1 = 1 + (i + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, a1 + s);
      idx.push(a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Water {
  constructor(scene, textures) {
    this.shore = buildShoreMask();
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWaveAmp: { value: 0.5 }, uShore: { value: null }, uShoreExt: { value: SHORE_EXT },
      uNormalMap: { value: null }, uFoam: { value: null }, uReflTex: { value: null }, uReflMat: { value: null },
      uReflOn: { value: 0 }, uRain: { value: 0 }, uLight: { value: 1 }, uSunVis: { value: 1 }, uFlash: { value: 0 },
      uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uDeep: { value: new THREE.Vector3(0.006, 0.05, 0.075) }, uShallow: { value: new THREE.Vector3(0.05, 0.42, 0.42) },
      uSkyCol: { value: new THREE.Vector3(0.4, 0.5, 0.6) },
    }]);
    // share live uniform objects
    this.uniforms.uTime = U.uTime;
    this.uniforms.uReflTex = U.uReflTex;
    this.uniforms.uReflMat = U.uReflMat;
    this.uniforms.uReflOn = U.uReflOn;
    this.uniforms.uRain = U.uRain;
    this.uniforms.uSunDir = U.uSunDir;
    this.uniforms.uFlash = U.uFlash;
    this.uniforms.uShore.value = this.shore.tex;
    this.uniforms.uNormalMap.value = textures.waterNormal;
    this.uniforms.uFoam.value = textures.foam;
    textures.foam.wrapS = textures.foam.wrapT = THREE.RepeatWrapping;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, fog: true, depthWrite: true,
    });
    this.mesh = new THREE.Mesh(radialGrid(2600, 150, 200), this.mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.layers.set(LAYER_NO_REFLECT);
    scene.add(this.mesh);

    // seafloor
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1, map: textures.sand.map });
    textures.sand.map.repeat.set(1, 1);
    const fg = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    fg.rotateX(-Math.PI / 2);
    const uv = fg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1000, uv.getY(i) * 1000);
    this.floor = new THREE.Mesh(fg, floorMat);
    this.floor.position.y = -6.05;
    scene.add(this.floor);
    this.waveAmp = 0.5;
    this.boats = [];
  }

  addBoats(scene, rng) {
    const hullMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1b3d6b, roughness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1116, roughness: 0.05, metalness: 0.9 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.7 });
    const spots = [[60, 80], [110, 60], [150, 120], [230, 70], [90, -150], [200, -210], [40, -330], [250, -470], [120, 330], [280, 250], [700, 200], [760, -150]];
    for (const [x, z] of spots) {
      const L = rng.range(9, 18), W = L * 0.3;
      const g = new THREE.Group();
      // hull: lofted V sections
      const st = 14, sec = 9, pos = [], idx = [];
      for (let i = 0; i <= st; i++) {
        const t = i / st; // 0 stern .. 1 bow
        const zz = (t - 0.5) * L;
        const w = W / 2 * (t > 0.6 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.6) / 0.4, 2))) : 1) + 0.02;
        const depth = 1.0 * (t > 0.7 ? 1 - (t - 0.7) * 1.2 : 1);
        const sheer = 1.0 + t * t * 0.5;
        for (let j = 0; j <= sec; j++) {
          const a = j / sec; // 0 keel .. 1 deck edge (one side), mirrored
          for (const side of [-1, 1]) {
            const xx = side * w * Math.pow(a, 0.6);
            const yy = -depth * (1 - a) + sheer * a - 0.3;
            pos.push(xx, yy, zz);
          }
        }
      }
      const rowN = (sec + 1) * 2;
      for (let i = 0; i < st; i++) for (let j = 0; j < sec; j++) for (let s = 0; s < 2; s++) {
        const a = i * rowN + j * 2 + s, b = a + 2, c = a + rowN, d = c + 2;
        if (s === 0) { idx.push(a, c, b, b, c, d); } else { idx.push(a, b, c, b, d, c); }
      }
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      hg.setIndex(idx); hg.computeVertexNormals();
      const hull = new THREE.Mesh(hg, hullMat);
      hull.castShadow = true;
      g.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.08, L * 0.72), deckMat);
      deck.position.set(0, 0.72, -L * 0.08); g.add(deck);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 1.005, 0.12, L * 0.62), stripeMat);
      stripe.position.set(0, 0.35, -L * 0.1); g.add(stripe);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 1.1, L * 0.32), hullMat);
      cab.position.set(0, 1.3, -L * 0.02); cab.castShadow = true; g.add(cab);
      const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.64, 0.45, L * 0.3), glassMat);
      win.position.set(0, 1.45, -L * 0.02); g.add(win);
      if (L > 14) {
        const fly = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.6, L * 0.18), hullMat);
        fly.position.set(0, 2.1, -L * 0.05); g.add(fly);
      }
      g.position.set(x, WATER_LEVEL, z);
      g.rotation.y = rng.range(0, Math.PI * 2);
      scene.add(g);
      this.boats.push({ g, x, z, L, yaw: g.rotation.y, phase: rng.range(0, 10) });
    }
  }

  update(dt, camera, sky, weather) {
    const cx = Math.round(camera.position.x / 4) * 4, cz = Math.round(camera.position.z / 4) * 4;
    this.mesh.position.set(cx, WATER_LEVEL, cz);
    this.waveAmp += ((0.45 + weather.wind * 0.9 + weather.storm * 0.8) - this.waveAmp) * Math.min(1, dt * 0.2);
    const u = this.uniforms;
    u.uWaveAmp.value = this.waveAmp;
    const info = sky.info;
    u.uLight.value = 0.05 + info.dayK * 0.95 * (1 - weather.storm * 0.5);
    u.uSunVis.value = sky.uniforms.uSunVis.value;
    u.uSunColor.value.copy(sky.uniforms.uSunColor.value);
    u.uSkyCol.value.copy(sky.uniforms.uHorizon.value);
    const t = U.uTime.value;
    for (const b of this.boats) {
      const y = waveHeight(b.x, b.z, t, this.waveAmp, this.shore);
      const yF = waveHeight(b.x + Math.sin(b.yaw) * b.L * 0.4, b.z + Math.cos(b.yaw) * b.L * 0.4, t, this.waveAmp, this.shore);
      const yS = waveHeight(b.x + Math.cos(b.yaw) * 1.5, b.z - Math.sin(b.yaw) * 1.5, t, this.waveAmp, this.shore);
      b.g.position.y = y + 0.05;
      b.g.rotation.x = -(yF - y) / (b.L * 0.4) * 0.8;
      b.g.rotation.z = (yS - y) / 1.5 * 0.6;
    }
  }
}
