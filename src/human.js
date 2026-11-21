// Procedural people: one SkinnedMesh per person (two materials: body + hair cards), a real bone
// hierarchy and smooth skin weights across joints. The head is sculpted (brow, eye sockets,
// cheekbones, jaw, chin) with real eyes (iris, pupil, blinking lids, lashes), a nose, lips and
// ears; hair is a scalp shell plus strand-textured cards; hands have fingers; clothes carry seams,
// pockets, collars, belts and sneakers. A detail shader adds skin pores, knit, denim twill,
// leather grain, hair strands and soft fabric folds.
// HumanAnimator drives idle / walk / run / jump / fall / knocked-down / sit / blink procedurally,
// with stride-locked phase so feet don't slide.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, RNG } from './utils.js';

const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'lids'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

const SKIN_TONES = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0xa8714a, 0x8a5a3a, 0x5f3c25, 0xf6d7bd];
const HAIR_COLORS = [0x1a1410, 0x2b1d14, 0x4a3020, 0x6b4a2a, 0xa07a48, 0xd8c08a, 0x7a7a78, 0x2a2a2a, 0x8a2a14];
const TOP_COLORS = [0x2b3a55, 0x7a1f24, 0x1f4a3a, 0xd8d6d0, 0x222222, 0x8a6a3a, 0x3a6aa0, 0xc0504a, 0x5a4a7a, 0xe0b040, 0x445048, 0xb8b8b0, 0x1a2a40];
const PANT_COLORS = [0x2a3248, 0x1a1c22, 0x3a3a3c, 0x5a4a36, 0x23324f, 0x6a6a64, 0x2f2a24];
const SHOE_COLORS = [0x151515, 0xe8e8e4, 0x4a3022, 0x2a2a30, 0x8a1a1a];
const EYE_COLORS = [0x3b2414, 0x4a2e18, 0x2a1a10, 0x3d5a78, 0x4d6a3a, 0x6a5232];

// material types for the detail shader
const M = { skin: 0, cotton: 1, denim: 2, leather: 3, hair: 4, shoe: 5, metal: 6, eye: 7 };

export function randomAppearance(rng) {
  const female = rng.chance(0.5);
  const top = rng.pick(['tshirt', 'tshirt', 'jacket', 'hoodie', 'shirt', female ? 'dress' : 'shirt']);
  return {
    female,
    height: female ? rng.float(1.58, 1.76) : rng.float(1.68, 1.92),
    build: rng.float(0.9, 1.15),
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(HAIR_COLORS),
    hairStyle: female ? rng.pick(['long', 'long', 'bun', 'short']) : rng.pick(['short', 'short', 'buzz', 'bald', 'cap']),
    top, topColor: rng.pick(TOP_COLORS), topColor2: rng.pick(TOP_COLORS),
    pants: rng.pick(PANT_COLORS), shorts: !female && top === 'tshirt' && rng.chance(0.25),
    shoes: rng.pick(SHOE_COLORS), beard: !female && rng.chance(0.25),
    eyes: rng.pick(EYE_COLORS), denim: rng.chance(0.6), seed: Math.floor(rng.next() * 1e6),
  };
}

export const PLAYER_APPEARANCE = {
  female: false, height: 1.83, build: 1.06, skin: 0xd6a07a, hair: 0x1c140e, hairStyle: 'short',
  top: 'jacket', topColor: 0x2a211b, topColor2: 0xdedad2, pants: 0x27324a, shorts: false, shoes: 0x1a1a1a, beard: true,
  eyes: 0x3b2414, denim: true, seed: 1234,
};

// ----- textures -----
let hairTex = null;
function hairTexture() {
  if (hairTex) return hairTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 256);
  const rnd = new RNG(77);
  for (let k = 0; k < 140; k++) {
    const x = rnd.float(2, 62), w = rnd.float(0.6, 1.6), len = rnd.float(150, 250), v = rnd.float(150, 255) | 0;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(${v},${v},${v},1)`); g.addColorStop(0.75, `rgba(${v},${v},${v},0.9)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.strokeStyle = g; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + rnd.float(-4, 4), len * 0.3, x + rnd.float(-6, 6), len * 0.7, x + rnd.float(-8, 8), len);
    ctx.stroke();
  }
  hairTex = new THREE.CanvasTexture(c);
  hairTex.colorSpace = THREE.SRGBColorSpace;
  return hairTex;
}

// ----- shared materials -----
const DETAIL_GLSL = /* glsl */`
  float hh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hh3(i), hh3(i + vec3(1, 0, 0)), f.x), mix(hh3(i + vec3(0, 1, 0)), hh3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hh3(i + vec3(0, 0, 1)), hh3(i + vec3(1, 0, 1)), f.x), mix(hh3(i + vec3(0, 1, 1)), hh3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  vec3 bumpN(vec3 surf_pos, vec3 surf_norm, float h, float faceDir) {
    vec2 dHdxy = vec2(dFdx(h), dFdy(h));
    vec3 vSigmaX = normalize(dFdx(surf_pos)), vSigmaY = normalize(dFdy(surf_pos));
    vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDir;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
  // surface height (metres) by material type; fine detail fades with distance
  float detailH(vec3 p, float t, float near) {
    float folds = 0.0, fine = 0.0;
    if (t < 0.5) { fine = vn3(p * 700.0) * 0.00012 + vn3(p * 160.0) * 0.00012; }
    else if (t < 1.5) { fine = vn3(p * 900.0) * 0.00018; folds = vn3(p * 13.0) * 0.006 + vn3(p * 31.0) * 0.002; }
    else if (t < 2.5) { fine = (sin((p.x * 0.8 + p.y + p.z * 0.7) * 1900.0) * 0.5 + 0.5) * 0.00018 + vn3(p * 380.0) * 0.0001; folds = vn3(p * 15.0) * 0.005; }
    else if (t < 3.5) { fine = vn3(p * 170.0) * 0.00028; folds = vn3(p * 11.0) * 0.005; }
    else if (t < 4.5) { fine = (sin(p.x * 2600.0 + vn3(p * 35.0) * 7.0) * 0.5 + 0.5) * 0.0004; }
    else if (t < 5.5) { fine = vn3(p * 260.0) * 0.0002; }
    return folds + fine * near;
  }`;

function makeBodyMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rough;\nattribute float mtype;\nvarying float vRough;\nvarying float vMType;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough; vMType = mtype; vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vRough;\nvarying float vMType;\nvarying vec3 vObj;\n${DETAIL_GLSL}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMType > 5.5 && vMType < 6.5 ? 1.0 : 0.0;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vMType < 6.5) {
          float near = clamp(1.0 - length(vViewPosition) / 5.0, 0.0, 1.0);
          float h = detailH(vObj, vMType, near);
          normal = bumpN(-vViewPosition, normal, h, faceDirection);
        }`);
  };
  m.customProgramCacheKey = () => 'human-body-v2';
  return m;
}
function makeHairMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: hairTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rough;\nattribute float mtype;');
  };
  m.customProgramCacheKey = () => 'human-hair-v1';
  return m;
}
const bodyMaterial = makeBodyMaterial();
const hairMaterial = makeHairMaterial();

// ----- geometry helpers -----
// Loft around a vertical axis: profile rows [y, rx, rzFront, rzBack]; shape(x, y, z, cosT, sinT) may adjust.
function loftY(profile, radial, rings, shape = null) {
  const y0 = profile[0][0], y1 = profile[profile.length - 1][0];
  const pos = [], idx = [];
  const sample = (y) => {
    let i = 0;
    while (i < profile.length - 2 && y > profile[i + 1][0]) i++;
    const a = profile[i], b = profile[i + 1];
    const t = clamp((y - a[0]) / (b[0] - a[0]), 0, 1), s = t * t * (3 - 2 * t);
    return [lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)];
  };
  for (let i = 0; i <= rings; i++) {
    const y = y0 + (y1 - y0) * (i / rings);
    const [rx, rf, rb] = sample(y);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      let x = rx * c, z = (sn >= 0 ? rf : rb) * sn, yy = y;
      if (shape) [x, yy, z] = shape(x, y, z, c, sn);
      pos.push(x, yy, z);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const A = i * row + j, B = (i + 1) * row + j, C = A + 1, D = B + 1;
    idx.push(A, B, C, B, D, C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const _up = new THREE.Vector3(0, 1, 0);
function capsuleBetween(a, b, r, segs = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, segs);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function tubeThrough(points, r, segs = 4) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 3, r, segs, false);
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

class Parts {
  constructor() { this.geos = []; this.hair = []; }
  // color: hex or fn(p)->THREE.Color ; weights: bone index or fn(p)->[[bone, w], ...]
  add(geo, color, weights, rough = 0.7, mtype = M.cotton, hair = false) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const keepUV = hair && g.attributes.uv;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv')) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!keepUV) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), rg = new Float32Array(n), mt = new Float32Array(n);
    const fixed = typeof color === 'function' ? null : new THREE.Color(color);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(g.attributes.position, i);
      const c = fixed || color(p);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      const w = typeof weights === 'number' ? [[weights, 1]] : weights(p);
      let tot = 0;
      for (let k = 0; k < Math.min(4, w.length); k++) { si[i * 4 + k] = w[k][0]; sw[i * 4 + k] = w[k][1]; tot += w[k][1]; }
      for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot || 1;
      rg[i] = rough; mt[i] = mtype;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('rough', new THREE.BufferAttribute(rg, 1));
    g.setAttribute('mtype', new THREE.BufferAttribute(mt, 1));
    (hair ? this.hair : this.geos).push(g);
  }
}
const blendY = (a, b, yA, yB) => (p) => {
  const t = clamp((p.y - yA) / (yB - yA), 0, 1);
  if (t <= 0) return [[a, 1]];
  if (t >= 1) return [[b, 1]];
  return [[a, 1 - t], [b, t]];
};
const gauss = (dx, dy, s) => Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
const tint = (hex, r, g, b) => { const c = new THREE.Color(hex); c.r *= r; c.g *= g; c.b *= b; return c; };

// ----- the head -----
const HEAD_C = new THREE.Vector3(0, 1.69, 0.008);
function sculptHead(d, female) {
  const ax = 0.077, ay = d.y >= 0 ? 0.107 : 0.117, az = d.z >= 0 ? 0.094 : 0.104;
  const r = 1 / Math.sqrt((d.x / ax) ** 2 + (d.y / ay) ** 2 + (d.z / az) ** 2);
  const p = d.clone().multiplyScalar(r);
  // jaw and chin
  if (p.y < -0.02) {
    const t = smoothstep(-0.02, -0.112, p.y);
    p.x *= 1 - (female ? 0.33 : 0.22) * t;
    if (p.z < 0) p.z *= 1 - 0.5 * t; else p.z *= 1 - 0.04 * t;
  }
  if (p.z > 0) {
    p.z += (female ? 0.005 : 0.008) * gauss(p.x, p.y + 0.1, 0.018);        // chin
    p.z += 0.005 * gauss(p.x, p.y + 0.056, 0.02);                           // mouth area
    p.z += 0.006 * gauss(p.x * 1.6, p.y - 0.005, 0.014) * smoothstep(-0.03, 0.02, p.y); // nose bridge
    for (const s of [1, -1]) {
      p.z -= 0.011 * gauss(p.x - s * 0.031, p.y - 0.016, 0.011);           // eye sockets
      p.z += (female ? 0.002 : 0.0045) * gauss(p.x - s * 0.032, p.y - 0.036, 0.012); // brow ridge
      const ck = gauss(p.x - s * 0.052, p.y + 0.012, 0.016);               // cheekbones
      p.x += s * 0.004 * ck; p.z += 0.004 * ck;
    }
    if (Math.abs(p.x) > 0.055 && p.y > 0.015) p.x *= 0.975;                 // temples
  }
  return p.add(HEAD_C);
}

export function createHuman(look, detail = 10) {
  const s = look.height / 1.8;
  const hi = detail >= 12;
  const fem = look.female;
  const bw = look.build * (fem ? 0.92 : 1);
  const hipW = fem ? 1.1 : 1;
  const shW = fem ? 0.9 : 1;
  const rad = hi ? 30 : 14, rings = hi ? 44 : 18;
  const LR = hi ? 18 : 10, LV = hi ? 14 : 8; // limb radial / ring segments
  const parts = new Parts();
  const skin = look.skin;
  const rnd = new RNG(look.seed || 7);
  const top = look.topColor, pants = look.pants;
  const jacket = look.top === 'jacket', hoodie = look.top === 'hoodie', shirt = look.top === 'shirt', dress = look.top === 'dress', tee = look.top === 'tshirt';
  const longTop = !tee && !dress;
  const pantsM = look.denim ? M.denim : M.cotton;
  const topM = jacket ? M.leather : M.cotton;

  // ----- bones (model space at 1.8 m, scaled later) -----
  const shoulderX = 0.19 * bw * shW;
  const legX = 0.095 * hipW;
  const restPos = {
    root: [0, 0, 0], hips: [0, 0.98, 0], spine: [0, 1.1, 0], chest: [0, 1.28, 0], neck: [0, 1.5, 0], head: [0, 1.59, 0],
    shoulderL: [0.07, 1.45, 0], upperArmL: [shoulderX, 1.44, 0], foreArmL: [shoulderX, 1.15, 0], handL: [shoulderX, 0.895, 0],
    shoulderR: [-0.07, 1.45, 0], upperArmR: [-shoulderX, 1.44, 0], foreArmR: [-shoulderX, 1.15, 0], handR: [-shoulderX, 0.895, 0],
    thighL: [legX, 0.94, 0], shinL: [legX, 0.505, 0], footL: [legX, 0.085, 0],
    thighR: [-legX, 0.94, 0], shinR: [-legX, 0.505, 0], footR: [-legX, 0.085, 0],
    lids: [0, 0, 0], // set from the eye position below
  };
  const parent = {
    hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
    shoulderL: 'chest', upperArmL: 'shoulderL', foreArmL: 'upperArmL', handL: 'foreArmL',
    shoulderR: 'chest', upperArmR: 'shoulderR', foreArmR: 'upperArmR', handR: 'foreArmR',
    thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', lids: 'head',
  };

  // ----- torso: lofted with chest, shoulder blades, glutes, trapezius slope -----
  const torsoProf = [
    [0.86, 0.13, 0.08, 0.09], [0.92, 0.165 * hipW, 0.095, 0.115], [0.98, 0.168 * hipW, 0.1, 0.12], [1.04, 0.155 * (fem ? 0.92 : 1), 0.1, 0.098],
    [1.1, 0.15 * (fem ? 0.9 : 1), 0.104, 0.092], [1.18, 0.158 * (fem ? 0.94 : 1), 0.11, 0.096], [1.26, 0.172 * shW, 0.12, 0.1], [1.34, 0.182 * shW, 0.125, 0.105],
    [1.4, 0.188 * shW, 0.115, 0.106], [1.45, 0.185 * shW, 0.095, 0.096], [1.48, 0.15 * shW, 0.075, 0.08], [1.505, 0.09, 0.062, 0.066], [1.525, 0.06, 0.052, 0.056],
  ];
  const jacketPad = jacket ? 0.008 : hoodie ? 0.01 : 0;
  const torso = loftY(torsoProf, rad + 6, rings, (x, y, z, c, sn) => {
    x *= bw; z *= bw;
    if (sn > 0 && y > 1.24 && y < 1.4) {
      const t = Math.sin(((y - 1.24) / 0.16) * Math.PI);
      z += (fem ? 0.035 : 0.008) * t * Math.pow(Math.max(0, Math.cos((Math.abs(c) - 0.45) * 2.2)), 2); // pecs / bust
    }
    if (sn < 0 && y > 1.28 && y < 1.44) z -= 0.008 * Math.sin(((y - 1.28) / 0.16) * Math.PI) * Math.abs(c); // shoulder blades
    if (sn < 0 && y > 0.88 && y < 1.02) z -= (fem ? 0.012 : 0.006) * Math.sin(((y - 0.88) / 0.14) * Math.PI) * (1 - Math.abs(c) * 0.5); // glutes
    if (y > 0.99 && y < 1.47) { const k = 1 + jacketPad / 0.15; x *= k; z *= k; }
    return [x, y, z];
  });
  // z of the torso's front surface at height y (for things sewn onto the front)
  const frontAt = (y) => {
    let i = 0;
    while (i < torsoProf.length - 2 && y > torsoProf[i + 1][0]) i++;
    const a = torsoProf[i], b = torsoProf[i + 1];
    const t = clamp((y - a[0]) / (b[0] - a[0]), 0, 1), sm = t * t * (3 - 2 * t);
    let z = lerp(a[2], b[2], sm) * bw;
    if (y > 1.24 && y < 1.4) z += (fem ? 0.035 : 0.008) * Math.sin(((y - 1.24) / 0.16) * Math.PI) * 0.3;
    if (y > 0.99 && y < 1.47) z *= 1 + jacketPad / 0.15;
    return z;
  };
  const waistY = dress ? 0.0 : 1.0;
  const teeColor = new THREE.Color(look.topColor2);
  const torsoColor = (p) => {
    if (p.y < waistY && !dress) return new THREE.Color(pants);
    // open jacket: a V of t-shirt shows at the front
    if (jacket && p.z > 0.02 && p.y > 1.12 && Math.abs(p.x) < 0.016 + (p.y - 1.12) * 0.13) return teeColor;
    return new THREE.Color(top);
  };
  const torsoW = (p) => {
    if (p.y < 0.995) return [[BI.hips, 1]];
    if (p.y < 1.12) { const t = (p.y - 0.995) / 0.125; return [[BI.hips, 1 - t], [BI.spine, t]]; }
    if (p.y < 1.32) { const t = (p.y - 1.12) / 0.2; return [[BI.spine, 1 - t], [BI.chest, t]]; }
    if (p.y > 1.49) { const t = clamp((p.y - 1.49) / 0.03, 0, 1); return [[BI.chest, 1 - t * 0.5], [BI.neck, t * 0.5]]; }
    return [[BI.chest, 1]];
  };
  // torso split by material so jeans and tops get their own surface detail
  {
    const tg = torso.toNonIndexed();
    const pos = tg.attributes.position, nrm = tg.attributes.normal;
    const up = [], lo = [];
    for (let i = 0; i < pos.count; i += 3) ((pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3 > waistY ? up : lo).push(i);
    const pick = (list) => {
      const a = new Float32Array(list.length * 9), b = new Float32Array(list.length * 9);
      list.forEach((i, k) => { for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) { a[k * 9 + j * 3 + c] = pos.array[(i + j) * 3 + c]; b[k * 9 + j * 3 + c] = nrm.array[(i + j) * 3 + c]; } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3)); g.setAttribute('normal', new THREE.BufferAttribute(b, 3)); return g;
    };
    if (up.length) parts.add(pick(up), torsoColor, torsoW, jacket ? 0.45 : 0.85, topM);
    if (lo.length) parts.add(pick(lo), torsoColor, torsoW, 0.82, pantsM);
  }
  // waist: belt + buckle, jacket hem band, jeans back pockets
  if (!dress) {
    const belt = loftY([[0.975, 0.154 * hipW, 0.098, 0.114], [1.015, 0.152 * hipW, 0.098, 0.11]], rad, 2, (x, y, z) => [x * bw * 1.035, y, z * bw * 1.035]);
    parts.add(belt, 0x2a1d13, BI.hips, 0.4, M.leather);
    parts.add(new THREE.BoxGeometry(0.045, 0.032, 0.01).translate(0, 0.995, 0.1 * bw + 0.004), 0xb0a890, BI.hips, 0.25, M.metal);
    for (const sx of [1, -1]) {
      const pk = new THREE.BoxGeometry(0.115, 0.13, 0.006); pk.rotateX(0.12); pk.translate(sx * 0.072 * hipW, 0.905, -(0.12 * bw + 0.004));
      parts.add(pk, tint(pants, 0.82, 0.82, 0.82), BI.hips, 0.85, pantsM);
    }
  }
  if (jacket || hoodie) {
    const hem = loftY([[0.97, 0.162 * hipW, 0.104, 0.118], [1.01, 0.16 * hipW, 0.104, 0.114]], rad, 2, (x, y, z) => [x * bw * 1.07, y, z * bw * 1.07]);
    parts.add(hem, tint(top, 0.75, 0.75, 0.75), BI.hips, 0.6, topM);
  }
  // jacket: standing collar, zipper, angled pockets, shoulder seams
  if (jacket) {
    const col = new THREE.TorusGeometry(0.072 * bw, 0.014, 6, 24, Math.PI * 1.6);
    col.rotateX(Math.PI / 2); col.rotateY(Math.PI * 1.3); col.scale(1, 2.2, 0.85); col.translate(0, 1.512, -0.008);
    parts.add(col, top, () => [[BI.chest, 0.6], [BI.neck, 0.4]], 0.45, M.leather);
    for (const sx of [1, -1]) {
      // zip edges either side of the opening
      const zp = [];
      for (let k = 0; k <= 8; k++) { const y = 1.0 + k * 0.058, xo = 0.018 + Math.max(0, y - 1.12) * 0.13; zp.push(v3(sx * xo, y, frontAt(y) + 0.003)); }
      parts.add(tubeThrough(zp, 0.004), 0x8a8a8a, (p) => (p.y < 1.12 ? [[BI.spine, 1]] : [[BI.chest, 1]]), 0.3, M.metal);
      const pk = new THREE.BoxGeometry(0.11, 0.012, 0.008); pk.rotateZ(sx * 0.5); pk.translate(sx * 0.085 * bw, 1.06, frontAt(1.06) - 0.004);
      parts.add(pk, tint(top, 0.6, 0.6, 0.6), BI.spine, 0.5, M.leather);
      const seam = [];
      for (let k = 0; k <= 5; k++) { const t = k / 5; seam.push(v3(sx * lerp(0.085, 0.17, t) * bw, lerp(1.5, 1.455, t), 0.0)); }
      parts.add(tubeThrough(seam, 0.0028), tint(top, 0.6, 0.6, 0.6), BI.chest, 0.6, M.leather);
    }
  }
  if (hoodie) {
    const hood = new THREE.TorusGeometry(0.085 * bw, 0.035, 8, 22, Math.PI * 1.3);
    hood.rotateX(Math.PI / 2); hood.rotateY(Math.PI * 1.15); hood.translate(0, 1.505, -0.03);
    parts.add(hood, top, () => [[BI.chest, 0.7], [BI.neck, 0.3]], 0.9, M.cotton);
    for (const sx of [1, -1]) parts.add(capsuleBetween(v3(sx * 0.03, 1.47, frontAt(1.47) + 0.006), v3(sx * 0.034, 1.33, frontAt(1.33) + 0.006), 0.0035, 5), 0xe0e0e0, BI.chest, 0.6, M.cotton);
    const pouch = new THREE.BoxGeometry(0.24, 0.13, 0.012); pouch.translate(0, 1.08, frontAt(1.08));
    parts.add(pouch, tint(top, 0.85, 0.85, 0.85), BI.spine, 0.9, M.cotton);
  }
  if (shirt) {
    for (const sx of [1, -1]) {
      const cp = new THREE.BoxGeometry(0.06, 0.045, 0.006); cp.rotateZ(sx * 0.6); cp.rotateX(-0.35); cp.translate(sx * 0.03, 1.49, 0.07 * bw);
      parts.add(cp, top, () => [[BI.chest, 0.6], [BI.neck, 0.4]], 0.8, M.cotton);
    }
    const plk = new THREE.BoxGeometry(0.03, 0.42, 0.006); plk.translate(0, 1.25, frontAt(1.25) + 0.001);
    parts.add(plk, tint(top, 0.95, 0.95, 0.95), (p) => (p.y < 1.12 ? [[BI.spine, 1]] : [[BI.chest, 1]]), 0.8, M.cotton);
    for (let k = 0; k < 5; k++) { const by = 1.43 - k * 0.085; parts.add(new THREE.SphereGeometry(0.0055, 6, 4).translate(0, by, frontAt(by) + 0.005), 0xeeeeee, k > 2 ? BI.spine : BI.chest, 0.3, M.cotton); }
  }
  if (tee) {
    const rib = new THREE.TorusGeometry(0.066 * bw, 0.006, 4, 22);
    rib.rotateX(Math.PI / 2 - 0.25); rib.scale(1, 1, 0.82); rib.translate(0, 1.5, 0.006);
    parts.add(rib, tint(top, 0.9, 0.9, 0.9), () => [[BI.chest, 0.6], [BI.neck, 0.4]], 0.85, M.cotton);
  }
  if (dress) {
    const skirt = loftY([[0.55, 0.25, 0.2, 0.22], [0.75, 0.2, 0.16, 0.17], [0.96, 0.165 * hipW, 0.1, 0.12]], rad, 12, (x, y, z) => [x * bw, y, z * bw]);
    parts.add(skirt, top, (p) => [[BI.hips, 0.6], [BI.thighL, 0.2], [BI.thighR, 0.2]], 0.8, M.cotton);
  }

  // ----- neck -----
  const neck = loftY([[1.495, 0.07, 0.068, 0.07], [1.53, 0.061, 0.058, 0.064], [1.585, 0.057, 0.054, 0.06], [1.625, 0.058, 0.054, 0.064]], hi ? 18 : 12, 6);
  parts.add(neck, skin, blendY(BI.chest, BI.head, 1.5, 1.63), 0.55, M.skin);
  if (!fem) parts.add(new THREE.SphereGeometry(0.0065, 8, 6).scale(1, 1.5, 0.6).translate(0, 1.56, 0.049), skin, BI.neck, 0.55, M.skin);

  // ----- head -----
  const head = new THREE.SphereGeometry(1, hi ? 44 : 22, hi ? 34 : 16);
  {
    const p = head.attributes.position, d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const q = sculptHead(d, fem);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    head.computeVertexNormals();
  }
  const headPos = head.attributes.position;
  const frontZ = (x, y) => {
    let best = HEAD_C.z;
    for (let i = 0; i < headPos.count; i++) {
      const hx = headPos.getX(i), hy = headPos.getY(i), hz = headPos.getZ(i);
      if (hz > 0 && Math.abs(hx - x) < 0.015 && Math.abs(hy - y) < 0.013 && hz > best) best = hz;
    }
    return best;
  };
  const cheekRed = tint(skin, 1.03, 0.9, 0.88);
  const stubble = !fem && !look.beard;
  const headColor = (p) => {
    const lx = p.x - HEAD_C.x, ly = p.y - HEAD_C.y;
    const c = new THREE.Color(skin);
    if (p.z > 0) {
      let w = 0;
      for (const sx of [1, -1]) w = Math.max(w, gauss(lx - sx * 0.05, ly + 0.02, 0.018));
      c.lerp(cheekRed, w * 0.6);
      const nose = gauss(lx, ly + 0.02, 0.012); c.lerp(cheekRed, nose * 0.4);
      for (const sx of [1, -1]) c.multiplyScalar(1 - 0.12 * gauss(lx - sx * 0.031, ly - 0.004, 0.009));
    }
    if (stubble && ly < -0.04 && p.z > -0.03) c.multiplyScalar(0.9 - 0.04 * smoothstep(-0.04, -0.1, ly));
    return c;
  };
  parts.add(head, headColor, (p) => (p.y < 1.6 ? [[BI.head, 0.7], [BI.neck, 0.3]] : [[BI.head, 1]]), 0.5, M.skin);

  // nose: bridge blending into the face, rounded tip, wings, nostrils underneath
  {
    const zr = frontZ(0, HEAD_C.y + 0.008), zt = frontZ(0, HEAD_C.y - 0.03);
    const ns = fem ? 0.85 : 1;
    const tipY = HEAD_C.y - 0.031, tipZ = zt + 0.0025 * ns;
    parts.add(capsuleBetween(v3(0, HEAD_C.y + 0.006, zr - 0.007), v3(0, tipY + 0.007, tipZ - 0.004), 0.0052 * ns, 6), skin, BI.head, 0.45, M.skin);
    parts.add(new THREE.SphereGeometry(0.0105 * ns, 12, 10).scale(1.05, 0.88, 0.95).translate(0, tipY, tipZ), cheekRed, BI.head, 0.42, M.skin);
    for (const sx of [1, -1]) {
      parts.add(new THREE.SphereGeometry(0.0078 * ns, 10, 8).scale(1, 0.9, 0.9).translate(sx * 0.0098 * ns, tipY - 0.004, tipZ - 0.008), cheekRed, BI.head, 0.45, M.skin);
      parts.add(new THREE.SphereGeometry(0.0036 * ns, 6, 4).scale(1, 0.35, 1.2).translate(sx * 0.0052, tipY - 0.0098, tipZ - 0.005), 0x2a1410, BI.head, 0.8, M.skin);
    }
  }
  // lips and mouth line
  {
    const my = HEAD_C.y - 0.066, mz = frontZ(0, my);
    const lip = new THREE.Color(skin).lerp(new THREE.Color(fem ? 0xa8505a : 0x9a5a52), fem ? 0.55 : 0.4);
    const ul = new THREE.CapsuleGeometry(0.0042, 0.03, 3, 8); ul.rotateZ(Math.PI / 2); ul.scale(1, 0.85, 0.7); ul.translate(0, my + 0.0038, mz - 0.003);
    parts.add(ul, lip, BI.head, 0.35, M.skin);
    const ll = new THREE.CapsuleGeometry(0.0052, 0.026, 3, 8); ll.rotateZ(Math.PI / 2); ll.scale(1, 0.9, 0.72); ll.translate(0, my - 0.0048, mz - 0.0035);
    parts.add(ll, lip, BI.head, 0.32, M.skin);
    parts.add(new THREE.BoxGeometry(0.032, 0.0014, 0.004).translate(0, my - 0.0004, mz + 0.0005), 0x3a1a16, BI.head, 0.6, M.skin);
  }
  // ears
  for (const sx of [1, -1]) {
    const ear = new THREE.SphereGeometry(1, 10, 8); ear.scale(0.009, 0.029, 0.018); ear.rotateY(sx * -0.35); ear.translate(sx * 0.079, HEAD_C.y + 0.002, -0.004);
    parts.add(ear, tint(skin, 1.02, 0.94, 0.92), BI.head, 0.5, M.skin);
    const inner = new THREE.SphereGeometry(1, 8, 6); inner.scale(0.005, 0.016, 0.009); inner.translate(sx * 0.0855, HEAD_C.y - 0.003, -0.002);
    parts.add(inner, tint(skin, 0.75, 0.62, 0.6), BI.head, 0.6, M.skin);
  }
  // eyes: eyeball, iris, pupil; upper lids + lashes on the 'lids' bone (blinking), lower lids, brows
  const eyeDir = new THREE.Vector3(0.36, 0.13, 0.93).normalize();
  const eyeSurf = sculptHead(eyeDir, fem);
  const eyeR = 0.0116;
  const eyeY = HEAD_C.y + 0.016, eyeZ = eyeSurf.z - 0.0062;
  restPos.lids = [0, eyeY, eyeZ];
  const iris = new THREE.Color(look.eyes || 0x3b2414);
  for (const sx of [1, -1]) {
    const ex = sx * 0.031;
    parts.add(new THREE.SphereGeometry(eyeR, hi ? 16 : 10, hi ? 12 : 8).translate(ex, eyeY, eyeZ), 0xd9d4cc, BI.head, 0.06, M.eye);
    parts.add(new THREE.CylinderGeometry(0.0059, 0.0059, 0.0012, 20).rotateX(Math.PI / 2).translate(ex, eyeY, eyeZ + eyeR - 0.0006), iris, BI.head, 0.05, M.eye);
    parts.add(new THREE.CylinderGeometry(0.0025, 0.0025, 0.0012, 12).rotateX(Math.PI / 2).translate(ex, eyeY, eyeZ + eyeR + 0.0001), 0x050505, BI.head, 0.04, M.eye);
    // upper lid: a cap over the top of the eyeball, plus lashes along its edge
    const lid = new THREE.SphereGeometry(eyeR + 0.0014, hi ? 16 : 10, hi ? 8 : 5, 0, Math.PI * 2, 0, 1.22);
    lid.translate(ex, eyeY, eyeZ);
    parts.add(lid, tint(skin, 0.92, 0.86, 0.84), BI.lids, 0.5, M.skin);
    const lash = new THREE.TorusGeometry((eyeR + 0.0014) * Math.sin(1.22), 0.0009, 3, 14, Math.PI * 0.9);
    lash.rotateX(Math.PI / 2); lash.rotateY(-Math.PI * 0.05); lash.translate(ex, eyeY + (eyeR + 0.0014) * Math.cos(1.22), eyeZ);
    parts.add(lash, 0x0a0806, BI.lids, 0.8, M.hair);
    const low = new THREE.SphereGeometry(eyeR + 0.001, hi ? 14 : 10, hi ? 6 : 4, 0, Math.PI * 2, 1.98, 0.95);
    low.translate(ex, eyeY, eyeZ);
    parts.add(low, tint(skin, 0.95, 0.88, 0.86), BI.head, 0.5, M.skin);
    // eyebrow
    const bp = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, x = sx * lerp(0.014, 0.05, t), y = eyeY + 0.019 + Math.sin(t * Math.PI) * 0.005 - t * 0.004;
      bp.push(v3(x, y, frontZ(x, y) + 0.0012));
    }
    parts.add(tubeThrough(bp, fem ? 0.0018 : 0.0028), look.hair, BI.head, 0.9, M.hair);
  }
  if (look.beard) {
    const beard = new THREE.SphereGeometry(1, hi ? 30 : 16, hi ? 20 : 10);
    const p = beard.attributes.position, d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const q = sculptHead(d, false);
      const lx = q.x - HEAD_C.x, ly = q.y - HEAD_C.y;
      const mouth = ly > -0.078 && ly < -0.052 && Math.abs(lx) < 0.021 && d.z > 0.6;
      const moustache = ly > -0.058 && ly < -0.046 && Math.abs(lx) < 0.026 && d.z > 0.6;
      const onJaw = (ly < -0.05 && d.z > -0.3 && !mouth) || moustache;
      const push = onJaw ? 0.0028 : -0.008;
      q.addScaledVector(d, push);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    beard.computeVertexNormals();
    parts.add(beard, new THREE.Color(look.hair).lerp(new THREE.Color(skin), 0.22), (q) => (q.y < 1.6 ? [[BI.head, 0.8], [BI.neck, 0.2]] : [[BI.head, 1]]), 0.9, M.hair);
  }

  // ----- hair: scalp shell + strand cards -----
  const hs = look.hairStyle;
  const hairCol = new THREE.Color(look.hair);
  const scalpHit = (d) => {
    const q = sculptHead(d, fem);
    const lx = q.x - HEAD_C.x, ly = q.y - HEAD_C.y;
    const face = d.z > 0.35 && ly < 0.066;
    const sides = Math.abs(lx) > 0.06 && ly < 0.0 && d.z > -0.2;
    const nape = ly < -0.055;
    return { q, bald: face || sides || nape };
  };
  if (hs !== 'bald') {
    const shell = new THREE.SphereGeometry(1, hi ? 40 : 18, hi ? 28 : 12);
    const p = shell.attributes.position, d = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const { q, bald } = scalpHit(d);
      const thick = hs === 'buzz' ? 0.0025 : 0.006 + Math.max(0, d.y) * 0.008;
      q.addScaledVector(d, bald ? -0.01 : thick);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    shell.computeVertexNormals();
    parts.add(shell, hs === 'buzz' ? tint(look.hair, 1, 1, 1).lerp(new THREE.Color(skin), 0.3) : hairCol, BI.head, 0.6, M.hair);
    if (hs !== 'buzz' && hs !== 'cap') {
      // cards: quads lying on the scalp, flowing back and down, textured with strands
      const nCards = Math.round((hs === 'long' ? 300 : 320) * (hi ? 1 : 0.32));
      const pos = [], uv = [], nor = [];
      const quad = (a, b, c, dd, n) => {
        for (const v of [a, b, c, a, c, dd]) pos.push(v.x, v.y, v.z);
        for (const t of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) uv.push(t[0], t[1]);
        for (let k = 0; k < 6; k++) nor.push(n.x, n.y, n.z);
      };
      for (let k = 0; k < nCards; k++) {
        const d2 = new THREE.Vector3(rnd.float(-1, 1), rnd.float(-0.25, 1), rnd.float(-1, 1)).normalize();
        const { q, bald } = scalpHit(d2);
        if (bald) continue;
        const n = d2.clone();
        const flow = new THREE.Vector3(d2.x * 0.3, -0.55, -1).addScaledVector(n, -0.0);
        if (d2.z > 0.25 && d2.y > 0.3) flow.set(rnd.float(-0.3, 0.3), 0.15, -1); // front swept back
        flow.addScaledVector(n, -flow.dot(n)).normalize();
        const side = new THREE.Vector3().crossVectors(n, flow).normalize();
        const len = hs === 'long' ? rnd.float(0.06, 0.1) : rnd.float(0.035, 0.06), w = rnd.float(0.025, 0.038);
        const base = q.clone().addScaledVector(n, 0.008);
        const tip = base.clone().addScaledVector(flow, len).addScaledVector(n, rnd.float(-0.001, 0.003));
        quad(base.clone().addScaledVector(side, -w / 2), base.clone().addScaledVector(side, w / 2), tip.clone().addScaledVector(side, w / 2), tip.clone().addScaledVector(side, -w / 2), n);
      }
      if (hs === 'long') {
        // long strands hanging from the back and sides down to the shoulders
        const nLong = hi ? 90 : 30;
        for (let k = 0; k < nLong; k++) {
          const a = rnd.float(-Math.PI * 0.55, Math.PI * 0.55) + Math.PI; // around the back
          const d2 = new THREE.Vector3(Math.sin(a), rnd.float(-0.05, 0.4), Math.cos(a)).normalize();
          const { q } = scalpHit(d2);
          const n = new THREE.Vector3(d2.x, 0, d2.z).normalize();
          const side = new THREE.Vector3(-n.z, 0, n.x);
          const w = rnd.float(0.035, 0.05), len = rnd.float(0.2, 0.3);
          const base = q.clone().addScaledVector(n, 0.008);
          const tip = base.clone().add(new THREE.Vector3(n.x * 0.03, -len, n.z * 0.03));
          quad(base.clone().addScaledVector(side, -w / 2), base.clone().addScaledVector(side, w / 2), tip.clone().addScaledVector(side, w / 2), tip.clone().addScaledVector(side, -w / 2), n);
        }
      }
      if (pos.length) {
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        parts.add(cg, (p) => hairCol.clone().multiplyScalar(0.85 + 0.3 * rnd.next()), (p) => (p.y > 1.56 ? [[BI.head, 1]] : [[BI.head, 0.5], [BI.chest, 0.5]]), 0.55, M.hair, true);
      }
    }
    if (hs === 'bun') parts.add(new THREE.SphereGeometry(0.042, 12, 10).translate(0, HEAD_C.y + 0.085, -0.07), hairCol, BI.head, 0.6, M.hair);
    if (hs === 'cap') {
      const cap = new THREE.SphereGeometry(0.119, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.47);
      cap.scale(0.9, 0.92, 1.02); cap.translate(0, HEAD_C.y + 0.012, 0.0);
      parts.add(cap, look.topColor2, BI.head, 0.8, M.cotton);
      const brim = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 16, 1, false, -Math.PI / 2, Math.PI);
      brim.scale(1.1, 1, 1.3); brim.rotateX(0.12); brim.translate(0, HEAD_C.y + 0.018, 0.095);
      parts.add(brim, look.topColor2, BI.head, 0.8, M.cotton);
    }
  }
  if (fem && rnd.chance(0.6)) for (const sx of [1, -1]) parts.add(new THREE.SphereGeometry(0.004, 6, 4).translate(sx * 0.084, HEAD_C.y - 0.028, 0.0), 0xd4b060, BI.head, 0.2, M.metal);

  // ----- arms -----
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const X = shoulderX * sx;
    const sleeve = longTop || jacket;
    const armCol = sleeve ? top : skin, armM = sleeve ? topM : M.skin, armR = sleeve ? (jacket ? 0.45 : 0.85) : 0.55;
    const pad = sleeve ? (jacket ? 0.006 : 0.003) : 0;
    // deltoid cap
    parts.add(new THREE.SphereGeometry(0.057 * bw + pad * 0.5, 16, 12).scale(1.05, 0.85, 0.92).translate(X - sx * 0.016, 1.43, 0), tee ? top : armCol,
      () => [[BI['upperArm' + side], 0.6], [BI.chest, 0.4]], tee ? 0.85 : armR, tee ? M.cotton : armM);
    const uaW = (p) => {
      if (p.y > 1.4) return [[BI['upperArm' + side], 0.7], [BI.chest, 0.3]];
      if (p.y < 1.17) return [[BI['upperArm' + side], 0.6], [BI['foreArm' + side], 0.4]];
      return [[BI['upperArm' + side], 1]];
    };
    const ua = loftY([[1.15, 0.042, 0.043, 0.043], [1.24, 0.047, 0.05, 0.046], [1.33, 0.052, 0.054, 0.05], [1.45, 0.056, 0.055, 0.055]], LR, LV,
      (x, y, z) => [x * bw + X + pad * Math.sign(x), y, z * bw + pad * Math.sign(z)]);
    if (tee) {
      parts.add(loftY([[1.28, 0.059, 0.06, 0.058], [1.36, 0.061, 0.062, 0.06], [1.45, 0.062, 0.062, 0.062]], LR, 3, (x, y, z) => [x * bw + X, y, z * bw]), top, uaW, 0.85, M.cotton);
      parts.add(ua, skin, uaW, 0.55, M.skin);
    } else parts.add(ua, armCol, uaW, armR, armM);
    const fa = loftY([[0.9, 0.028, 0.03, 0.03], [0.96, 0.033, 0.036, 0.035], [1.06, 0.041, 0.045, 0.043], [1.16, 0.042, 0.044, 0.044]], LR, LV,
      (x, y, z) => [x * bw + X + pad * Math.sign(x), y, z * bw + pad * Math.sign(z)]);
    parts.add(fa, armCol, (p) => (p.y > 1.12 ? [[BI['foreArm' + side], 0.6], [BI['upperArm' + side], 0.4]] : [[BI['foreArm' + side], 1]]), armR, armM);
    if (sleeve) parts.add(new THREE.CylinderGeometry(0.032 + pad, 0.032 + pad, 0.022, 14, 1, true).translate(X, 0.91, 0), tint(top, 0.7, 0.7, 0.7), BI['foreArm' + side], 0.6, armM);
    if (side === 'L' && (jacket || shirt)) parts.add(new THREE.CylinderGeometry(0.03, 0.03, 0.014, 14, 1, true).translate(X, 0.935, 0), 0x9a8a5a, BI.foreArmL, 0.25, M.metal);
    // hand: palm, four two-segment fingers curling towards the palm, thumb
    const H = BI['hand' + side];
    parts.add(new THREE.SphereGeometry(1, 12, 10).scale(0.014, 0.046, 0.042).translate(X - sx * 0.002, 0.852, 0.004), skin, H, 0.5, M.skin);
    if (hi) {
      const fz = [0.027, 0.009, -0.009, -0.025], fl = [0.075, 0.082, 0.077, 0.062], fr = [0.0082, 0.0085, 0.008, 0.007];
      for (let k = 0; k < 4; k++) {
        const a = v3(X, 0.812, fz[k]), b = v3(X - sx * 0.005, 0.812 - fl[k] * 0.55, fz[k] * 1.05);
        const c = v3(X - sx * 0.016, 0.812 - fl[k] * 0.95, fz[k] * 1.08);
        parts.add(capsuleBetween(a, b, fr[k], 6), skin, H, 0.5, M.skin);
        parts.add(capsuleBetween(b, c, fr[k] * 0.9, 6), skin, H, 0.5, M.skin);
        parts.add(new THREE.SphereGeometry(fr[k] * 0.75, 6, 4).scale(0.5, 0.9, 0.9).translate(c.x + sx * 0.004, c.y + 0.004, c.z), tint(skin, 1.05, 0.95, 0.93), H, 0.3, M.skin);
      }
    } else {
      const fb = new THREE.SphereGeometry(1, 8, 6); fb.scale(0.011, 0.04, 0.038); fb.rotateZ(sx * 0.2); fb.translate(X - sx * 0.006, 0.785, 0.0);
      parts.add(fb, skin, H, 0.5, M.skin);
    }
    const t0 = v3(X - sx * 0.01, 0.872, 0.034), t1 = v3(X - sx * 0.018, 0.84, 0.05), t2 = v3(X - sx * 0.02, 0.812, 0.052);
    parts.add(capsuleBetween(t0, t1, 0.0098, hi ? 6 : 4), skin, H, 0.5, M.skin);
    parts.add(capsuleBetween(t1, t2, 0.0088, hi ? 6 : 4), skin, H, 0.5, M.skin);
  }

  // ----- legs -----
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const X = legX * sx;
    const bare = dress || look.shorts;
    const thW = (p) => {
      if (p.y > 0.9) return [[BI['thigh' + side], 0.55], [BI.hips, 0.45]];
      if (p.y < 0.53) return [[BI['thigh' + side], 0.55], [BI['shin' + side], 0.45]];
      return [[BI['thigh' + side], 1]];
    };
    const legPad = bare ? 0 : 0.006;
    const thigh = loftY([[0.5, 0.058, 0.06, 0.058], [0.62, 0.066, 0.07, 0.066], [0.75, 0.076, 0.08, 0.075], [0.86, 0.084, 0.088, 0.085], [0.97, 0.088 * hipW, 0.09, 0.092]], LR + 2, LV + 2,
      (x, y, z) => [x * bw + X + legPad * Math.sign(x), y, z * bw + legPad * Math.sign(z)]);
    if (look.shorts) {
      parts.add(loftY([[0.66, 0.08, 0.084, 0.08], [0.8, 0.088, 0.09, 0.088], [0.97, 0.094 * hipW, 0.095, 0.098]], LR + 2, 5, (x, y, z) => [x * bw + X, y, z * bw]), pants, thW, 0.82, pantsM);
      parts.add(thigh, skin, thW, 0.55, M.skin);
    } else parts.add(thigh, dress ? skin : pants, thW, dress ? 0.5 : 0.82, dress ? M.skin : pantsM);
    // knee cap
    if (bare) parts.add(new THREE.SphereGeometry(0.03, 10, 8).scale(1, 1.1, 0.7).translate(X, 0.51, 0.04), skin, (p) => [[BI['shin' + side], 0.5], [BI['thigh' + side], 0.5]], 0.5, M.skin);
    // shin with the calf muscle at the back; trousers fall straight to the shoe
    const shinProf = bare
      ? [[0.1, 0.036, 0.038, 0.04], [0.2, 0.042, 0.044, 0.048], [0.36, 0.05, 0.05, 0.064], [0.44, 0.054, 0.052, 0.062], [0.52, 0.057, 0.058, 0.06]]
      : [[0.07, 0.058, 0.062, 0.06], [0.2, 0.058, 0.062, 0.062], [0.36, 0.06, 0.064, 0.068], [0.52, 0.062, 0.066, 0.066]];
    const shin = loftY(shinProf, LR, LV, (x, y, z) => [x * bw + X, y, z * bw]);
    parts.add(shin, bare ? skin : pants, (p) => (p.y > 0.47 ? [[BI['shin' + side], 0.55], [BI['thigh' + side], 0.45]] : [[BI['shin' + side], 1]]), bare ? 0.5 : 0.82, bare ? M.skin : pantsM);
    if (!bare) {
      // outer seam with lighter stitching, and a hem
      const seam = [];
      for (let k = 0; k <= 10; k++) { const y = lerp(0.09, 0.97, k / 10); seam.push(v3(X + sx * ((y > 0.5 ? lerp(0.06, 0.09, (y - 0.5) / 0.47) : 0.062) * bw + 0.009), y, 0)); }
      parts.add(tubeThrough(seam, 0.0022), tint(pants, 1.5, 1.4, 1.2), (p) => (p.y > 0.5 ? [[BI['thigh' + side], 1]] : [[BI['shin' + side], 1]]), 0.8, pantsM);
      parts.add(new THREE.CylinderGeometry(0.061 * bw, 0.061 * bw, 0.025, 16, 1, true).scale(1, 1, 1.05).translate(X, 0.085, 0), tint(pants, 0.85, 0.85, 0.85), BI['shin' + side], 0.85, pantsM);
    }
    // sneaker: sculpted upper, white midsole, outsole, toe cap, laces, heel tab
    const shoe = new THREE.SphereGeometry(1, hi ? 16 : 12, hi ? 12 : 8);
    {
      const p = shoe.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const toe = smoothstep(0.2, 1, z);
        x *= 0.048 * (1 - 0.25 * toe); z *= 0.13; y = y * 0.045 * (1 - 0.45 * toe);
        if (y < -0.01) y = -0.01 + (y + 0.01) * 0.2;
        p.setXYZ(i, x + X, y + 0.047, z + 0.045);
      }
      shoe.computeVertexNormals();
    }
    const shoeW = (p) => (p.y > 0.1 ? [[BI['foot' + side], 0.6], [BI['shin' + side], 0.4]] : [[BI['foot' + side], 1]]);
    parts.add(shoe, look.shoes, shoeW, 0.45, M.shoe);
    const white = look.shoes !== 0x4a3022;
    const mid = new THREE.CylinderGeometry(1, 1, 1, 20); mid.scale(0.052, 0.024, 0.142); mid.translate(X, 0.016, 0.045);
    parts.add(mid, white ? 0xe9e7e1 : 0x2a1c14, BI['foot' + side], 0.7, M.shoe);
    const sole = new THREE.CylinderGeometry(1, 1, 1, 20); sole.scale(0.053, 0.008, 0.143); sole.translate(X, 0.004, 0.045);
    parts.add(sole, 0x1a1a1a, BI['foot' + side], 0.9, M.shoe);
    for (let k = 0; k < 4; k++) {
      const lz = 0.04 + k * 0.022, zu = (lz - 0.045) / 0.13, toe = smoothstep(0.2, 1, zu);
      const ly = 0.047 + 0.045 * (1 - 0.45 * toe) * Math.sqrt(Math.max(0, 1 - zu * zu)) * 0.98 + 0.002;
      parts.add(new THREE.BoxGeometry(0.044, 0.004, 0.006).rotateX(-0.5).translate(X, ly, lz), white ? 0xf2f2f0 : 0x111111, BI['foot' + side], 0.8, M.cotton);
    }
    parts.add(new THREE.BoxGeometry(0.02, 0.03, 0.01).translate(X, 0.092, -0.08), tint(look.shoes, 0.7, 0.7, 0.7), BI['foot' + side], 0.6, M.shoe);
  }

  // ----- assemble: body + hair as two material groups of one skinned mesh -----
  const body = mergeVertices(mergeGeometries(parts.geos, false), 1e-5);
  let geo, materials;
  if (parts.hair.length) {
    const hair = mergeVertices(mergeGeometries(parts.hair, false), 1e-5);
    geo = mergeGeometries([body, hair], true);
    materials = [bodyMaterial, hairMaterial];
    hair.dispose();
  } else { geo = body; materials = bodyMaterial; }
  if (geo !== body) body.dispose();
  for (const g of parts.geos) g.dispose();
  for (const g of parts.hair) g.dispose();
  const bones = {};
  for (const name of BONES) { const b = new THREE.Bone(); b.name = name; bones[name] = b; }
  for (const name of BONES) {
    const rp = restPos[name];
    if (name === 'root') continue;
    const pp = restPos[parent[name]];
    bones[name].position.set(rp[0] - pp[0], rp[1] - pp[1], rp[2] - pp[2]);
    bones[parent[name]].add(bones[name]);
  }
  const mesh = new THREE.SkinnedMesh(geo, materials);
  mesh.add(bones.root);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.scale.setScalar(s);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
  const container = new THREE.Group();
  container.add(mesh);
  const rest = {};
  for (const n of BONES) rest[n] = bones[n].position.clone();
  return { group: container, mesh, bones, rest, height: look.height, look };
}

// ----- animation -----
const _e = new THREE.Euler();
export class HumanAnimator {
  constructor(h) {
    this.h = h; this.phase = Math.random() * 6.28; this.t = Math.random() * 10;
    this.walkW = 0; this.runW = 0; this.airW = 0; this.downW = 0; this.idleVar = Math.random();
    this.lean = 0; this.turn = 0; this.wave = 0; this.phoneW = 0; this.sitW = 0;
    this.pose = {};
    for (const n of BONES) this.pose[n] = [0, 0, 0];
  }
  // speed in m/s, air: bool, down: 0..1 lying, turnRate rad/s
  update(dt, speed, opts = {}) {
    this.t += dt;
    const h = this.h;
    const scale = h.height / 1.8;
    const sp = speed / scale;
    const runT = smoothstep(2.3, 3.8, sp);
    const walkT = smoothstep(0.08, 0.6, sp) * (1 - runT);
    const k = 1 - Math.exp(-8 * dt);
    this.walkW = lerp(this.walkW, walkT, k);
    this.runW = lerp(this.runW, runT, k);
    this.airW = lerp(this.airW, opts.air ? 1 : 0, 1 - Math.exp(-10 * dt));
    this.downW = lerp(this.downW, opts.down ? 1 : 0, 1 - Math.exp(-(opts.down ? 7 : 3) * dt));
    this.phoneW = lerp(this.phoneW, opts.phone ? 1 : 0, 1 - Math.exp(-3 * dt));
    this.sitW = lerp(this.sitW, opts.sit ? 1 : 0, 1 - Math.exp(-6 * dt));
    this.turn = lerp(this.turn, clamp(opts.turnRate || 0, -3, 3), 1 - Math.exp(-6 * dt));
    // stride-locked phase
    const stride = lerp(1.38, 2.5, this.runW);
    this.phase += (sp / stride) * Math.PI * 2 * dt;
    if (sp < 0.05) this.phase += dt * 0.0;
    const ph = this.phase;
    const P = this.pose;
    for (const n of BONES) { P[n][0] = 0; P[n][1] = 0; P[n][2] = 0; }
    let bob = 0;
    const wI = Math.max(0, 1 - this.walkW - this.runW);
    const wW = this.walkW, wR = this.runW;
    const sn = Math.sin(ph), cs = Math.cos(ph);

    // idle: breathing, weight shift, glance around
    if (wI > 0) {
      const t = this.t;
      const br = Math.sin(t * 1.7) * 0.02;
      P.chest[0] += br * wI; P.spine[0] += br * 0.5 * wI;
      P.upperArmL[2] += (0.09 + br) * wI; P.upperArmR[2] -= (0.09 + br) * wI;
      P.foreArmL[0] -= 0.14 * wI; P.foreArmR[0] -= 0.14 * wI;
      const shift = Math.sin(t * 0.45 + this.idleVar * 6) * 0.04;
      P.hips[2] += shift * wI; P.spine[2] -= shift * 0.6 * wI;
      P.thighL[2] -= shift * wI * 0.5; P.thighR[2] -= shift * wI * 0.5;
      P.head[1] += Math.sin(t * 0.33 + this.idleVar * 3) * 0.35 * wI;
      P.head[0] += Math.sin(t * 0.21) * 0.06 * wI;
      // phone idle variant
      if (this.phoneW > 0.01) {
        const w = this.phoneW * wI;
        P.upperArmR[0] -= 0.5 * w; P.upperArmR[2] -= 0.15 * w; P.foreArmR[0] -= 1.6 * w; P.head[0] += 0.3 * w; P.head[1] *= 1 - w;
      }
    }
    // walk
    if (wW > 0) {
      const amp = 0.42, w = wW;
      P.thighL[0] += -sn * amp * w; P.thighR[0] += sn * amp * w;
      const kneeL = 0.08 + 0.95 * Math.pow(Math.max(0, Math.cos(ph + 0.35)), 2);
      const kneeR = 0.08 + 0.95 * Math.pow(Math.max(0, Math.cos(ph + Math.PI + 0.35)), 2);
      P.shinL[0] += kneeL * w; P.shinR[0] += kneeR * w;
      P.footL[0] += (sn * amp - kneeL) * 0.55 * w; P.footR[0] += (-sn * amp - kneeR) * 0.55 * w;
      P.hips[1] += sn * 0.09 * w; P.chest[1] -= sn * 0.13 * w;
      P.hips[2] += Math.sin(ph * 2) * 0.025 * w;
      P.upperArmL[0] += sn * 0.36 * w; P.upperArmR[0] -= sn * 0.36 * w;
      P.upperArmL[2] += 0.07 * w; P.upperArmR[2] -= 0.07 * w;
      P.foreArmL[0] += (-0.22 + Math.min(0, sn) * 0.35) * w; P.foreArmR[0] += (-0.22 + Math.min(0, -sn) * 0.35) * w;
      P.spine[0] += 0.03 * w;
      P.head[1] += sn * 0.06 * w;
      bob += (Math.cos(ph * 2) * 0.022 - 0.008) * w;
    }
    // run
    if (wR > 0) {
      const w = wR;
      P.thighL[0] += (-sn * 0.72 - 0.12) * w; P.thighR[0] += (sn * 0.72 - 0.12) * w;
      const kneeL = 0.25 + 1.55 * Math.pow(Math.max(0, Math.cos(ph + 0.6)), 1.5);
      const kneeR = 0.25 + 1.55 * Math.pow(Math.max(0, Math.cos(ph + Math.PI + 0.6)), 1.5);
      P.shinL[0] += kneeL * w; P.shinR[0] += kneeR * w;
      P.footL[0] += (sn * 0.4 - kneeL * 0.4) * w; P.footR[0] += (-sn * 0.4 - kneeR * 0.4) * w;
      P.spine[0] += 0.16 * w; P.chest[0] += 0.05 * w; P.head[0] -= 0.12 * w;
      P.hips[1] += sn * 0.16 * w; P.chest[1] -= sn * 0.24 * w;
      P.upperArmL[0] += sn * 0.75 * w; P.upperArmR[0] -= sn * 0.75 * w;
      P.upperArmL[2] += 0.12 * w; P.upperArmR[2] -= 0.12 * w;
      P.foreArmL[0] -= 1.45 * w; P.foreArmR[0] -= 1.45 * w;
      bob += (Math.abs(Math.cos(ph)) * 0.07 - 0.05) * w;
    }
    // leaning into turns
    P.spine[2] += -this.turn * 0.05 * (wW + wR * 2);
    // airborne
    if (this.airW > 0.01) {
      const w = this.airW;
      for (const n of BONES) { P[n][0] *= 1 - w * 0.7; P[n][1] *= 1 - w * 0.7; P[n][2] *= 1 - w * 0.7; }
      P.thighL[0] -= 0.65 * w; P.thighR[0] -= 0.25 * w; P.shinL[0] += 0.9 * w; P.shinR[0] += 0.6 * w;
      P.upperArmL[0] -= 0.5 * w; P.upperArmR[0] -= 0.3 * w; P.upperArmL[2] += 0.4 * w; P.upperArmR[2] -= 0.4 * w;
      P.foreArmL[0] -= 0.6 * w; P.foreArmR[0] -= 0.6 * w;
    }
    // sitting (in a car seat, partially visible through the glass)
    if (this.sitW > 0.01) {
      const w = this.sitW;
      P.thighL[0] -= 1.45 * w; P.thighR[0] -= 1.45 * w; P.shinL[0] += 1.45 * w; P.shinR[0] += 1.45 * w;
      P.upperArmL[0] -= 0.9 * w; P.upperArmR[0] -= 0.9 * w; P.foreArmL[0] -= 0.5 * w; P.foreArmR[0] -= 0.5 * w;
      bob -= 0.42 * w;
    }
    // blinking every few seconds (eyes stay shut while knocked down)
    this.blinkT = (this.blinkT ?? Math.random() * 3) - dt;
    if (this.blinkT < 0) { this.blinkT = 2.2 + Math.random() * 3.8; this.blinkP = 0; }
    let blink = 0;
    if (this.blinkP !== undefined && this.blinkP < 1) { this.blinkP += dt / 0.17; blink = Math.sin(Math.min(1, this.blinkP) * Math.PI); }
    P.lids[0] = Math.min(0.95, blink * 0.95 + this.downW * 0.95);
    // knocked down: lie on the back with limbs loose
    const dW = this.downW;
    for (const n of BONES) {
      const b = h.bones[n];
      const p = P[n];
      _e.set(p[0], p[1], p[2], 'XYZ');
      b.quaternion.setFromEuler(_e);
    }
    h.bones.hips.position.y = h.rest.hips.y + bob;
    if (dW > 0.001) {
      const root = h.bones.root;
      root.rotation.set(-Math.PI / 2 * dW, 0, 0.2 * dW);
      root.position.set(0, 0.12 * dW, 0.9 * dW);
      h.bones.upperArmL.rotation.z += 1.1 * dW; h.bones.upperArmR.rotation.z -= 1.1 * dW;
      h.bones.thighL.rotation.z += 0.25 * dW; h.bones.thighR.rotation.z -= 0.15 * dW;
      h.bones.shinL.rotation.x += 0.4 * dW; h.bones.head.rotation.y += 0.5 * dW;
    } else {
      h.bones.root.rotation.set(0, 0, 0); h.bones.root.position.set(0, 0, 0);
    }
  }
}

export { RNG };
