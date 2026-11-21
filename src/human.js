// Procedural people: one SkinnedMesh per person (single draw call) built from lathed body parts
// with smooth skin weights across joints, a real bone hierarchy, faces, hair styles and clothing.
// HumanAnimator drives idle / walk / run / jump / fall / knocked-down / get-up poses procedurally,
// with stride-locked phase so feet don't slide.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, RNG } from './utils.js';

const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

const SKIN_TONES = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0xa8714a, 0x8a5a3a, 0x5f3c25, 0xf6d7bd];
const HAIR_COLORS = [0x1a1410, 0x2b1d14, 0x4a3020, 0x6b4a2a, 0xa07a48, 0xd8c08a, 0x7a7a78, 0x2a2a2a, 0x8a2a14];
const TOP_COLORS = [0x2b3a55, 0x7a1f24, 0x1f4a3a, 0xd8d6d0, 0x222222, 0x8a6a3a, 0x3a6aa0, 0xc0504a, 0x5a4a7a, 0xe0b040, 0x445048, 0xb8b8b0, 0x1a2a40];
const PANT_COLORS = [0x2a3248, 0x1a1c22, 0x3a3a3c, 0x5a4a36, 0x23324f, 0x6a6a64, 0x2f2a24];
const SHOE_COLORS = [0x151515, 0xe8e8e4, 0x4a3022, 0x2a2a30, 0x8a1a1a];

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
  };
}

export const PLAYER_APPEARANCE = {
  female: false, height: 1.83, build: 1.06, skin: 0xd6a07a, hair: 0x1c140e, hairStyle: 'short',
  top: 'jacket', topColor: 0x2a211b, topColor2: 0xdedad2, pants: 0x27324a, shorts: false, shoes: 0x1a1a1a, beard: true,
};

// ----- geometry helpers -----
function lathe(profile, segs) {
  // profile: [[r, y], ...] from top to bottom; returns geometry around Y
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)).reverse();
  return new THREE.LatheGeometry(pts, segs);
}

class Parts {
  constructor() { this.geos = []; }
  // weightFn(pos) -> [[boneIndex, weight], ...]
  add(geo, color, weightFn, rough = 0.7) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), rg = new Float32Array(n);
    const c = new THREE.Color(color);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      p.fromBufferAttribute(g.attributes.position, i);
      const w = typeof weightFn === 'number' ? [[weightFn, 1]] : weightFn(p);
      let tot = 0;
      for (let k = 0; k < Math.min(4, w.length); k++) { si[i * 4 + k] = w[k][0]; sw[i * 4 + k] = w[k][1]; tot += w[k][1]; }
      for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot || 1;
      rg[i] = rough;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('rough', new THREE.BufferAttribute(rg, 1));
    this.geos.push(g);
  }
}

// Weight helper: blend between bone a (below yA) and bone b (above yB) linearly in y.
const blendY = (a, b, yA, yB) => (p) => {
  const t = clamp((p.y - yA) / (yB - yA), 0, 1);
  if (t <= 0) return [[a, 1]];
  if (t >= 1) return [[b, 1]];
  return [[a, 1 - t], [b, t]];
};

const humanMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
humanMaterial.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float rough;\nvarying float vRough;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vRough;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
};
humanMaterial.customProgramCacheKey = () => 'human-v1';

export function createHuman(look, detail = 10) {
  const s = look.height / 1.8;  // overall scale is applied to the mesh
  const bw = look.build * (look.female ? 0.92 : 1);
  const hipW = look.female ? 1.08 : 1;
  const segs = detail;
  const parts = new Parts();
  const skin = look.skin;
  const top = look.topColor;
  const pants = look.pants;

  // ----- bones (model space at 1.8 m, scaled later) -----
  const shoulderX = 0.19 * bw;
  const legX = 0.095 * hipW;
  const restPos = {
    root: [0, 0, 0], hips: [0, 0.98, 0], spine: [0, 1.1, 0], chest: [0, 1.28, 0], neck: [0, 1.5, 0], head: [0, 1.59, 0],
    shoulderL: [0.07, 1.45, 0], upperArmL: [shoulderX, 1.44, 0], foreArmL: [shoulderX, 1.15, 0], handL: [shoulderX, 0.895, 0],
    shoulderR: [-0.07, 1.45, 0], upperArmR: [-shoulderX, 1.44, 0], foreArmR: [-shoulderX, 1.15, 0], handR: [-shoulderX, 0.895, 0],
    thighL: [legX, 0.94, 0], shinL: [legX, 0.505, 0], footL: [legX, 0.085, 0],
    thighR: [-legX, 0.94, 0], shinR: [-legX, 0.505, 0], footR: [-legX, 0.085, 0],
  };
  const parent = {
    hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
    shoulderL: 'chest', upperArmL: 'shoulderL', foreArmL: 'upperArmL', handL: 'foreArmL',
    shoulderR: 'chest', upperArmR: 'shoulderR', foreArmR: 'upperArmR', handR: 'foreArmR',
    thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
  };

  // ----- torso -----
  const longTop = look.top !== 'tshirt';
  const torsoProf = [[0.06, 1.515], [0.12, 1.495], [0.175, 1.46], [0.185, 1.4], [0.175, 1.3], [0.158, 1.18], [0.148, 1.07], [0.152 * hipW, 0.99], [0.16 * hipW, 0.92], [0.12, 0.86]];
  const torso = lathe(torsoProf, segs + 4);
  {
    const p = torso.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * bw, z = p.getZ(i) * 0.6 * bw;
      const y = p.getY(i);
      if (look.female && y > 1.22 && y < 1.4 && z > 0) z *= 1 + 0.35 * Math.sin(((y - 1.22) / 0.18) * Math.PI);
      if (y > 1.2 && z < 0) z *= 1.05; // shoulder blades
      p.setXYZ(i, x, y, z);
    }
  }
  const torsoW = (p) => {
    if (p.y < 0.995) return [[BI.hips, 1]];
    if (p.y < 1.12) { const t = (p.y - 0.995) / 0.125; return [[BI.hips, 1 - t], [BI.spine, t]]; }
    if (p.y < 1.32) { const t = (p.y - 1.12) / 0.2; return [[BI.spine, 1 - t], [BI.chest, t]]; }
    if (p.y > 1.49) { const t = clamp((p.y - 1.49) / 0.03, 0, 1); return [[BI.chest, 1 - t * 0.5], [BI.neck, t * 0.5]]; }
    return [[BI.chest, 1]];
  };
  // split colour: top above the waist, pants below
  {
    const tg = torso.toNonIndexed();
    const pos = tg.attributes.position;
    const upper = [], lower = [];
    for (let i = 0; i < pos.count; i += 3) {
      const yc = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      (yc > 1.0 ? upper : lower).push(i);
    }
    torso.computeVertexNormals();
    const nrm = torso.toNonIndexed().attributes.normal;
    const pick = (list) => {
      const arr = new Float32Array(list.length * 9), na = new Float32Array(list.length * 9);
      list.forEach((i, k) => {
        for (let j = 0; j < 3; j++) {
          arr[k * 9 + j * 3] = pos.getX(i + j); arr[k * 9 + j * 3 + 1] = pos.getY(i + j); arr[k * 9 + j * 3 + 2] = pos.getZ(i + j);
          na[k * 9 + j * 3] = nrm.getX(i + j); na[k * 9 + j * 3 + 1] = nrm.getY(i + j); na[k * 9 + j * 3 + 2] = nrm.getZ(i + j);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(na, 3));
      return g;
    };
    parts.add(pick(upper), top, torsoW, look.top === 'jacket' ? 0.5 : 0.8);
    parts.add(pick(lower), look.top === 'dress' ? top : pants, torsoW, 0.8);
  }
  // belt
  if (look.top !== 'dress') {
    const belt = new THREE.CylinderGeometry(0.153 * hipW * bw, 0.155 * hipW * bw, 0.04, segs + 4, 1, true);
    belt.scale(1, 1, 0.62); belt.translate(0, 0.995, 0);
    parts.add(belt, 0x2a1e14, BI.hips, 0.4);
  }
  // dress skirt
  if (look.top === 'dress') {
    const skirt = lathe([[0.16 * hipW, 0.96], [0.2, 0.75], [0.24, 0.55]], segs + 4);
    skirt.scale(bw, 1, 0.75 * bw);
    parts.add(skirt, look.topColor, (p) => [[BI.hips, 0.6], [BI.thighL, 0.2], [BI.thighR, 0.2]], 0.8);
  }
  // jacket: collar + zipper line + open front
  if (look.top === 'jacket' || look.top === 'hoodie') {
    const col = new THREE.TorusGeometry(0.085 * bw, 0.022, 6, segs + 4);
    col.rotateX(Math.PI / 2); col.scale(1, 1, 0.8); col.translate(0, 1.495, -0.005);
    parts.add(col, look.topColor, () => [[BI.chest, 0.7], [BI.neck, 0.3]], 0.6);
    const zip = new THREE.BoxGeometry(0.012, 0.5, 0.01);
    zip.translate(0, 1.23, 0.108 * bw);
    parts.add(zip, look.top === 'jacket' ? 0x9a9a9a : look.topColor2, (p) => p.y < 1.12 ? [[BI.spine, 1]] : [[BI.chest, 1]], 0.3);
    if (look.top === 'jacket') {
      // visible t-shirt under the open jacket
      const tee = new THREE.PlaneGeometry(0.11, 0.34);
      tee.translate(0, 1.3, 0.112 * bw);
      parts.add(tee, look.topColor2, (p) => p.y < 1.2 ? [[BI.spine, 0.5], [BI.chest, 0.5]] : [[BI.chest, 1]], 0.85);
    }
    if (look.top === 'hoodie') {
      const hood = new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      hood.scale(1.1 * bw, 0.6, 0.8); hood.rotateX(-0.4); hood.translate(0, 1.47, -0.1);
      parts.add(hood, look.topColor, BI.chest, 0.85);
    }
  }
  if (look.top === 'shirt') {
    for (let k = 0; k < 5; k++) {
      const b = new THREE.SphereGeometry(0.006, 5, 4); b.translate(0, 1.43 - k * 0.09, 0.104 * bw);
      parts.add(b, 0xeeeeee, k > 2 ? BI.spine : BI.chest, 0.3);
    }
    const col = new THREE.TorusGeometry(0.075 * bw, 0.016, 5, segs + 4);
    col.rotateX(Math.PI / 2 - 0.25); col.scale(1, 1, 0.85); col.translate(0, 1.5, 0.0);
    parts.add(col, look.topColor, (p) => [[BI.chest, 0.6], [BI.neck, 0.4]], 0.7);
  }

  // ----- neck & head -----
  const neck = new THREE.CylinderGeometry(0.052, 0.058, 0.14, segs);
  neck.translate(0, 1.56, 0.0);
  parts.add(neck, skin, blendY(BI.chest, BI.head, 1.5, 1.62), 0.55);
  const head = new THREE.SphereGeometry(0.105, segs + 6, segs + 2);
  {
    const p = head.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      x *= 0.88; y *= 1.12;
      if (y < 0) { const t = clamp(-y / 0.11, 0, 1); x *= 1 - 0.28 * t; z *= 1 - 0.1 * t; if (z > 0) z += 0.012 * t; }
      if (z < 0 && y > -0.02) z *= 1.06; // back of skull
      p.setXYZ(i, x, y + 1.685, z + 0.012);
    }
    head.computeVertexNormals();
  }
  parts.add(head, skin, BI.head, 0.55);
  // ears
  for (const sx of [1, -1]) {
    const ear = new THREE.SphereGeometry(0.022, 6, 5); ear.scale(0.45, 1.05, 0.8); ear.translate(sx * 0.094, 1.682, 0.0);
    parts.add(ear, skin, BI.head, 0.6);
  }
  // nose
  const nose = new THREE.ConeGeometry(0.014, 0.04, 6); nose.rotateX(Math.PI / 2 + 0.35); nose.translate(0, 1.67, 0.113);
  parts.add(nose, new THREE.Color(skin).multiplyScalar(0.93).getHex(), BI.head, 0.5);
  // eyes (whites + irises), brows, mouth
  for (const sx of [1, -1]) {
    const w = new THREE.SphereGeometry(0.0145, 8, 6); w.scale(1.15, 0.8, 0.6); w.translate(sx * 0.036, 1.698, 0.092);
    parts.add(w, 0xf2f0ea, BI.head, 0.2);
    const ir = new THREE.SphereGeometry(0.0075, 6, 5); ir.scale(1, 1, 0.5); ir.translate(sx * 0.036, 1.698, 0.1);
    parts.add(ir, 0x2a1e14, BI.head, 0.1);
    const brow = new THREE.BoxGeometry(0.034, 0.007, 0.01); brow.rotateZ(sx * -0.12); brow.translate(sx * 0.037, 1.722, 0.1);
    parts.add(brow, look.hair, BI.head, 0.9);
  }
  const mouth = new THREE.BoxGeometry(0.036, 0.007, 0.01); mouth.translate(0, 1.636, 0.1);
  parts.add(mouth, 0x8a4a42, BI.head, 0.5);
  if (look.beard) {
    const beard = new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
    beard.scale(0.86, 1.0, 1.0); beard.translate(0, 1.70, 0.014);
    const p = beard.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0.01) p.setZ(i, p.getZ(i) * 0.4);
    beard.computeVertexNormals();
    parts.add(beard, look.hair, BI.head, 0.95);
  }
  // hair
  const hs = look.hairStyle;
  if (hs !== 'bald') {
    const hr = hs === 'buzz' ? 0.108 : 0.113;
    const hair = new THREE.SphereGeometry(hr, segs + 6, segs);
    const p = hair.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * 0.9, y = p.getY(i) * 1.1, z = p.getZ(i) + 0.008;
      // hairline: pull the face region inside the head
      const face = z > 0.02 && y < 0.045;
      const sides = Math.abs(x) > 0.07 && y < -0.01 && z > -0.04;
      if (face || sides || y < -0.06) { x *= 0.85; y = Math.min(y, 0.02); z *= 0.85; }
      if (y > 0 && hs !== 'buzz') y *= 1.08;
      p.setXYZ(i, x, y + 1.69, z + 0.005);
    }
    hair.computeVertexNormals();
    parts.add(hair, look.hair, BI.head, 0.9);
    if (hs === 'long') {
      const back = lathe([[0.1, 1.72], [0.115, 1.62], [0.11, 1.5], [0.09, 1.4]], 10);
      back.scale(0.95, 1, 0.55); back.translate(0, 0, -0.055);
      parts.add(back, look.hair, (q) => q.y > 1.55 ? [[BI.head, 1]] : [[BI.head, 0.5], [BI.chest, 0.5]], 0.85);
    }
    if (hs === 'bun') {
      const bun = new THREE.SphereGeometry(0.045, 8, 6); bun.translate(0, 1.77, -0.07);
      parts.add(bun, look.hair, BI.head, 0.85);
    }
    if (hs === 'cap') {
      const cap = new THREE.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.48);
      cap.scale(0.92, 0.9, 1); cap.translate(0, 1.7, 0.005);
      parts.add(cap, look.topColor2, BI.head, 0.7);
      const brim = new THREE.CylinderGeometry(0.075, 0.075, 0.01, 12, 1, false, -Math.PI / 2, Math.PI);
      brim.scale(1.1, 1, 1.25); brim.translate(0, 1.705, 0.09);
      parts.add(brim, look.topColor2, BI.head, 0.7);
    }
  }

  // ----- arms -----
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const X = shoulderX * sx;
    const sh = new THREE.SphereGeometry(0.066 * bw, segs, 8); sh.scale(1.05, 1, 0.9); sh.translate(X - sx * 0.01, 1.435, 0);
    parts.add(sh, top, (p) => [[BI['upperArm' + side], 0.6], [BI.chest, 0.4]], 0.75);
    const ua = lathe([[0.056 * bw, 1.45], [0.054 * bw, 1.36], [0.047 * bw, 1.22], [0.043 * bw, 1.15]], segs);
    ua.translate(X, 0, 0);
    const uaW = (p) => {
      if (p.y > 1.4) return [[BI['upperArm' + side], 0.7], [BI.chest, 0.3]];
      if (p.y < 1.17) return [[BI['upperArm' + side], 0.6], [BI['foreArm' + side], 0.4]];
      return [[BI['upperArm' + side], 1]];
    };
    if (longTop) parts.add(ua, top, uaW, 0.75);
    else {
      // t-shirt sleeve over the upper half, skin below
      const sleeve = lathe([[0.062 * bw, 1.45], [0.06 * bw, 1.36], [0.055 * bw, 1.29]], segs);
      sleeve.translate(X, 0, 0);
      parts.add(sleeve, top, uaW, 0.8);
      parts.add(ua, skin, uaW, 0.55);
    }
    const fa = lathe([[0.043 * bw, 1.16], [0.041 * bw, 1.08], [0.033, 0.95], [0.028, 0.9]], segs);
    fa.translate(X, 0, 0);
    parts.add(fa, longTop ? top : skin, (p) => p.y > 1.12 ? [[BI['foreArm' + side], 0.6], [BI['upperArm' + side], 0.4]] : [[BI['foreArm' + side], 1]], longTop ? 0.75 : 0.55);
    if (longTop) {
      const cuff = new THREE.CylinderGeometry(0.032, 0.032, 0.025, segs, 1, true); cuff.translate(X, 0.91, 0);
      parts.add(cuff, new THREE.Color(top).multiplyScalar(0.7).getHex(), BI['foreArm' + side], 0.8);
    }
    // hand: palm + fingers block + thumb (palm faces the body)
    const palm = new THREE.SphereGeometry(0.045, 8, 6); palm.scale(0.5, 1.05, 0.85); palm.translate(X, 0.86, 0.005);
    parts.add(palm, skin, BI['hand' + side], 0.55);
    const fing = new THREE.SphereGeometry(0.04, 8, 6); fing.scale(0.45, 1.0, 0.8); fing.translate(X, 0.8, 0.01);
    parts.add(fing, skin, BI['hand' + side], 0.55);
    const th = new THREE.CapsuleGeometry(0.011, 0.035, 3, 6); th.rotateX(0.5); th.translate(X - sx * 0.012, 0.85, 0.035);
    parts.add(th, skin, BI['hand' + side], 0.55);
    if (side === 'L' && look.top === 'jacket') {
      // watch
      const w = new THREE.CylinderGeometry(0.031, 0.031, 0.018, 10, 1, true); w.translate(X, 0.93, 0);
      parts.add(w, 0x9a8a5a, BI.foreArmL, 0.25);
    }
  }

  // ----- legs -----
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const X = legX * sx;
    const thigh = lathe([[0.088 * hipW * bw, 0.97], [0.084 * bw, 0.86], [0.068 * bw, 0.62], [0.058 * bw, 0.5]], segs);
    thigh.translate(X, 0, 0);
    const thW = (p) => {
      if (p.y > 0.9) return [[BI['thigh' + side], 0.55], [BI.hips, 0.45]];
      if (p.y < 0.53) return [[BI['thigh' + side], 0.55], [BI['shin' + side], 0.45]];
      return [[BI['thigh' + side], 1]];
    };
    const dress = look.top === 'dress';
    if (look.shorts) {
      const sh = lathe([[0.092 * bw, 0.97], [0.088 * bw, 0.8], [0.08 * bw, 0.66]], segs); sh.translate(X, 0, 0);
      parts.add(sh, pants, thW, 0.8);
      parts.add(thigh, skin, thW, 0.55);
    } else parts.add(thigh, dress ? skin : pants, thW, dress ? 0.5 : 0.8);
    const shin = lathe([[0.058 * bw, 0.52], [0.055 * bw, 0.4], [0.044, 0.2], [0.038, 0.1]], segs);
    shin.translate(X, 0, 0);
    parts.add(shin, (dress || look.shorts) ? skin : pants, (p) => p.y > 0.47 ? [[BI['shin' + side], 0.55], [BI['thigh' + side], 0.45]] : [[BI['shin' + side], 1]], dress ? 0.5 : 0.8);
    // shoe: rounded block + sole
    const shoe = new THREE.SphereGeometry(0.06, 10, 7);
    {
      const p = shoe.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) * 0.82, y = p.getY(i) * 0.85, z = p.getZ(i) * 2.2;
        if (y < -0.01) y = -0.01 + (y + 0.01) * 0.2;
        p.setXYZ(i, x + X, y + 0.06, z + 0.045);
      }
      shoe.computeVertexNormals();
    }
    parts.add(shoe, look.shoes, (p) => p.y > 0.1 ? [[BI['foot' + side], 0.6], [BI['shin' + side], 0.4]] : [[BI['foot' + side], 1]], 0.45);
    const sole = new THREE.BoxGeometry(0.1, 0.018, 0.27); sole.translate(X, 0.009, 0.045);
    parts.add(sole, look.shoes === 0xe8e8e4 ? 0xcfcfcf : 0x1a1a1a, BI['foot' + side], 0.9);
  }

  // ----- assemble -----
  const geo = mergeGeometries(parts.geos, false);
  for (const g of parts.geos) g.dispose();
  const bones = {};
  for (const name of BONES) {
    const b = new THREE.Bone(); b.name = name; bones[name] = b;
  }
  for (const name of BONES) {
    const rp = restPos[name];
    if (name === 'root') { bones.root.position.set(0, 0, 0); continue; }
    const pp = restPos[parent[name]];
    bones[name].position.set(rp[0] - pp[0], rp[1] - pp[1], rp[2] - pp[2]);
    bones[parent[name]].add(bones[name]);
  }
  const mesh = new THREE.SkinnedMesh(geo, humanMaterial);
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
