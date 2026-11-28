// Procedural humans built from scratch: a skinned body mesh (torso, limbs, hands,
// shoes) lofted from anatomical cross-sections with smooth skin weights, a sculpted
// head with a painted face texture, ears and hair styles. Clothing via vertex colour.
import * as THREE from 'three';
import { makeCanvas, toTexture } from '../core/textures.js';
import { RNG, clamp, lerp, smoothstep, fbm } from '../core/utils.js';

export const SKIN_TONES = [[0.96, 0.8, 0.69], [0.9, 0.7, 0.56], [0.78, 0.57, 0.42], [0.62, 0.43, 0.3], [0.45, 0.3, 0.2], [0.3, 0.2, 0.14]];
const HAIR_COLS = [[0.03, 0.025, 0.02], [0.12, 0.07, 0.04], [0.3, 0.18, 0.09], [0.62, 0.46, 0.25], [0.45, 0.15, 0.06], [0.55, 0.55, 0.55]];
const SHIRT_COLS = [[0.92, 0.92, 0.9], [0.1, 0.1, 0.12], [0.75, 0.15, 0.2], [0.15, 0.35, 0.65], [0.95, 0.55, 0.65], [0.2, 0.6, 0.55], [0.95, 0.8, 0.3], [0.45, 0.25, 0.55], [0.3, 0.45, 0.25], [0.95, 0.45, 0.2]];
const PANT_COLS = [[0.12, 0.18, 0.32], [0.08, 0.08, 0.09], [0.55, 0.5, 0.42], [0.85, 0.83, 0.78], [0.2, 0.25, 0.32], [0.35, 0.3, 0.25]];
const SHOE_COLS = [[0.95, 0.95, 0.95], [0.08, 0.08, 0.08], [0.4, 0.25, 0.15], [0.2, 0.3, 0.6], [0.8, 0.15, 0.15]];

// rest-pose skeleton (metres, character faces +z, left = +x)
const BONES = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, 0.95, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.17, 0]],
  ['neck', 'chest', [0, 0.21, 0]],
  ['head', 'neck', [0, 0.09, 0]],
  ['upperArmL', 'chest', [0.175, 0.155, 0]],
  ['forearmL', 'upperArmL', [0, -0.285, 0]],
  ['handL', 'forearmL', [0, -0.255, 0]],
  ['upperArmR', 'chest', [-0.175, 0.155, 0]],
  ['forearmR', 'upperArmR', [0, -0.285, 0]],
  ['handR', 'forearmR', [0, -0.255, 0]],
  ['thighL', 'hips', [0.09, -0.06, 0]],
  ['shinL', 'thighL', [0, -0.42, 0]],
  ['footL', 'shinL', [0, -0.41, 0]],
  ['thighR', 'hips', [-0.09, -0.06, 0]],
  ['shinR', 'thighR', [0, -0.42, 0]],
  ['footR', 'shinR', [0, -0.41, 0]],
];
export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

function restWorld() {
  const w = {};
  for (const [n, p, o] of BONES) {
    const base = p ? w[p] : [0, 0, 0];
    w[n] = [base[0] + o[0], base[1] + o[1], base[2] + o[2]];
  }
  return w;
}
const REST = restWorld();

// ---------------------------------------------------------------- face / hair textures
const faceCache = new Map();
function faceTexture(tone, female, variant) {
  const key = `${tone}-${female}-${variant}`;
  if (faceCache.has(key)) return faceCache.get(key);
  const W = 512, H = 256;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const sk = SKIN_TONES[tone];
  const rgb = (k, a = 1) => `rgba(${Math.round(sk[0] * 255 * k)},${Math.round(sk[1] * 255 * k)},${Math.round(sk[2] * 255 * k)},${a})`;
  ctx.fillStyle = rgb(1); ctx.fillRect(0, 0, W, H);
  // subtle skin mottling
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / W, y / H, 16, 3, 0.5, tone * 3 + variant) - 0.5;
    const i = (y * W + x) * 4;
    img.data[i] += n * 18; img.data[i + 1] += n * 14; img.data[i + 2] += n * 12;
  }
  ctx.putImageData(img, 0, 0);
  const cx = 128, ey = 127;
  // cheeks blush & shading
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(cx + s * 44, 150, 2, cx + s * 44, 150, 26);
    g.addColorStop(0, `rgba(200,80,70,${female ? 0.22 : 0.1})`); g.addColorStop(1, 'rgba(200,80,70,0)');
    ctx.fillStyle = g; ctx.fillRect(cx + s * 44 - 30, 120, 60, 60);
  }
  // nose shading
  const ng = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
  ng.addColorStop(0, rgb(0.86, 0.6)); ng.addColorStop(0.5, rgb(1.02, 0.0)); ng.addColorStop(1, rgb(0.86, 0.6));
  ctx.fillStyle = ng; ctx.fillRect(cx - 9, ey + 4, 18, 26);
  ctx.fillStyle = rgb(0.6, 0.7);
  ctx.beginPath(); ctx.ellipse(cx - 5, ey + 30, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 5, ey + 30, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  // eyes
  const eyeCols = ['#3b2414', '#5a3a1e', '#2c4f6b', '#3e6b3a', '#1c1410'];
  const iris = eyeCols[variant % eyeCols.length];
  for (const s of [-1, 1]) {
    const x = cx + s * 33;
    ctx.fillStyle = rgb(0.78, 0.7); // socket shadow
    ctx.beginPath(); ctx.ellipse(x, ey - 2, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e9e2d8';
    ctx.beginPath(); ctx.ellipse(x, ey, 11, 4.0, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(x + s * 0.8, ey + 0.2, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(x + s * 0.8, ey + 0.2, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(x + s * 0.8 - 1.2, ey - 1, 0.8, 0, Math.PI * 2); ctx.fill();
    // upper lid covers top of iris, lashes, crease
    ctx.fillStyle = rgb(0.82); ctx.beginPath(); ctx.ellipse(x, ey - 2.6, 11.5, 2.6, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = female ? '#140c08' : rgb(0.38); ctx.lineWidth = female ? 2.0 : 1.4;
    ctx.beginPath(); ctx.ellipse(x, ey + 0.3, 11.5, 4.4, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = rgb(0.7, 0.55); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, ey - 1.5, 12, 6.8, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = rgb(0.75, 0.5); ctx.beginPath(); ctx.ellipse(x, ey + 1.0, 10, 3.8, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    // brows
    const hc = HAIR_COLS[variant % 3];
    ctx.strokeStyle = `rgb(${hc.map((v) => v * 255 * 0.9 | 0).join(',')})`;
    ctx.lineWidth = female ? 2.6 : 4.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - s * 14, ey - 13); ctx.quadraticCurveTo(x + s * 2, ey - 18, x + s * 16, ey - 12); ctx.stroke();
  }
  // mouth
  const my = 170;
  const lip = female ? 'rgba(170,60,70,0.95)' : rgb(0.72, 0.9);
  ctx.fillStyle = lip;
  ctx.beginPath(); ctx.moveTo(cx - 22, my); ctx.quadraticCurveTo(cx - 8, my - 7, cx, my - 3); ctx.quadraticCurveTo(cx + 8, my - 7, cx + 22, my); ctx.quadraticCurveTo(cx, my + 2, cx - 22, my); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - 20, my + 1); ctx.quadraticCurveTo(cx, my + 12, cx + 20, my + 1); ctx.quadraticCurveTo(cx, my + 4, cx - 20, my + 1); ctx.fill();
  ctx.strokeStyle = rgb(0.45, 0.8); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx - 21, my + 0.5); ctx.quadraticCurveTo(cx, my + 3, cx + 21, my + 0.5); ctx.stroke();
  // stubble for some men
  if (!female && variant % 3 === 0) {
    ctx.fillStyle = 'rgba(30,20,15,0.22)';
    ctx.beginPath(); ctx.ellipse(cx, 178, 46, 26, 0, 0, Math.PI); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, 160, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  const t = toTexture(c, { repeat: false });
  faceCache.set(key, t);
  return t;
}

let hairTex = null;
function hairTexture() {
  if (hairTex) return hairTex;
  const W = 256, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const rng = new RNG(9);
  for (let i = 0; i < 2400; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    ctx.strokeStyle = `rgba(0,0,0,${rng.range(0.05, 0.25)})`; ctx.lineWidth = rng.range(0.5, 1.5);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-2, 2), y + rng.range(6, 18)); ctx.stroke();
  }
  hairTex = toTexture(c);
  return hairTex;
}

// ---------------------------------------------------------------- geometry
class SkinBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.si = []; this.sw = []; this.idx = []; this.n = 0; }
  vert(p, n, c, w) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]);
    const ws = w.slice(0, 4).sort((a, b) => b[1] - a[1]);
    let tot = 0; for (const e of ws) tot += e[1];
    for (let k = 0; k < 4; k++) { const e = ws[k]; this.si.push(e ? BONE_INDEX[e[0]] : 0); this.sw.push(e ? e[1] / tot : 0); }
    return this.n++;
  }
  // vertical tube of elliptical rings: rings [{y, cx, cz, rx, rzF, rzB, w:[[bone,wt]], c:[r,g,b], sq}]
  tube(rings, segs = 16, capTop = false, capBot = false) {
    const base = this.n;
    const i0 = this.idx.length;
    for (const r of rings) {
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rz = sa > 0 ? r.rzF : r.rzB;
        const e = r.sq || 2; // superellipse exponent
        const fx = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / e), fz = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / e);
        const x = r.cx + fx * r.rx, z = r.cz + fz * rz;
        const nx = ca / r.rx, nz = sa / rz;
        const l = Math.hypot(nx, nz);
        const w = typeof r.w === 'function' ? r.w(x, r.y, z) : r.w;
        const col = typeof r.c === 'function' ? r.c(x, r.y, z) : r.c;
        this.vert([x, r.y, z], [nx / l, 0, nz / l], col, w);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = base + i * segs + s, b = base + i * segs + s1, c = base + (i + 1) * segs + s1, d = base + (i + 1) * segs + s;
      // rings go top -> bottom or bottom -> top; fix orientation later via normals
      this.idx.push(a, d, b, b, d, c);
    }
    const yAt = (y) => { // ring centre at height y (rings are horizontal)
      let best = rings[0];
      for (const r of rings) if (Math.abs(r.y - y) < Math.abs(best.y - y)) best = r;
      return [best.cx, y, best.cz];
    };
    this.orient(i0, this.idx.length, (x, y, z) => yAt(y));
    const capRing = (ri, up) => {
      const c0 = this.idx.length;
      const r = rings[ri];
      const center = this.vert([r.cx, r.y + (up ? 0.004 : -0.004), r.cz], [0, up ? 1 : -1, 0], typeof r.c === 'function' ? r.c(r.cx, r.y, r.cz) : r.c, typeof r.w === 'function' ? r.w(r.cx, r.y, r.cz) : r.w);
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        const a = base + ri * segs + s, b = base + ri * segs + s1;
        if (up) this.idx.push(center, b, a); else this.idx.push(center, a, b);
      }
      const r0 = rings[ri];
      this.orient(c0, this.idx.length, () => [r0.cx, r0.y + (up ? -1 : 1), r0.cz]);
    };
    if (capTop) capRing(0, true);
    if (capBot) capRing(rings.length - 1, false);
  }
  // make triangles idx[i0..i1) face away from an axis point (centre(x,y,z) -> [cx,cy,cz])
  orient(i0, i1, centre) {
    const P = this.pos, I = this.idx;
    let score = 0;
    for (let t = i0; t < i1; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (P[a] + P[b] + P[c]) / 3, my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      const [cx, cy, cz] = centre(mx, my, mz);
      score += Math.sign(nx * (mx - cx) + ny * (my - cy) + nz * (mz - cz));
    }
    if (score < 0) for (let t = i0; t < i1; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// insert interpolated rings at the given heights so colour boundaries stay crisp
function densify(rows, ys) {
  const out = rows.slice();
  for (const y of ys) {
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      if ((a[0] - y) * (b[0] - y) < 0) {
        const t = (y - a[0]) / (b[0] - a[0]);
        out.splice(i + 1, 0, a.map((v, k) => (k === 0 ? y : v + (b[k] - v) * t)));
        break;
      }
    }
  }
  return out;
}

function blendW(y, y0, y1, boneA, boneB) {
  const t = smoothstep(y0, y1, y);
  return [[boneA, 1 - t], [boneB, t]];
}

function bodyGeometry(o) {
  const b = new SkinBuilder();
  const g = o.girth, f = o.female;
  const skin = o.skin;
  const shirtTop = o.sleeves; // y where sleeves end on the arm
  const shirtCol = o.shirt, pantCol = o.pants, shoeCol = o.shoes;
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const torsoColor = (x, y, z) => {
    if (y > 1.445) return skin;
    if (y > 1.025) {
      if (o.tank && Math.abs(x) > 0.12 && y > 1.3) return skin;
      if (o.vneck && y > 1.36 && z > 0.04 && Math.abs(x) < 0.05 + (y - 1.36) * 0.6) return skin;
      return shirtCol;
    }
    if (y > 1.0) return shade(pantCol, 0.6); // belt
    return pantCol;
  };
  // torso
  const T = f ? [
    [0.79, 0.13, 0.085, 0.1], [0.85, 0.165, 0.095, 0.118], [0.92, 0.175, 0.095, 0.125], [0.99, 0.15, 0.085, 0.1], [1.06, 0.128, 0.082, 0.083],
    [1.13, 0.135, 0.09, 0.08], [1.2, 0.146, 0.112, 0.082], [1.26, 0.15, 0.128, 0.085], [1.31, 0.148, 0.116, 0.085], [1.36, 0.145, 0.09, 0.083],
    [1.395, 0.128, 0.072, 0.072], [1.425, 0.095, 0.056, 0.058], [1.455, 0.052, 0.048, 0.05],
  ] : [
    [0.79, 0.13, 0.085, 0.095], [0.85, 0.158, 0.095, 0.108], [0.92, 0.164, 0.098, 0.112], [0.99, 0.152, 0.092, 0.096], [1.06, 0.145, 0.095, 0.086],
    [1.13, 0.15, 0.102, 0.085], [1.2, 0.16, 0.112, 0.09], [1.27, 0.168, 0.118, 0.094], [1.33, 0.172, 0.11, 0.095], [1.37, 0.165, 0.098, 0.09],
    [1.4, 0.142, 0.08, 0.078], [1.425, 0.105, 0.064, 0.064], [1.455, 0.058, 0.054, 0.054],
  ];
  const torsoW = (x, y, z) => {
    let w;
    if (y < 0.98) w = [['hips', 1]];
    else if (y < 1.12) w = blendW(y, 0.98, 1.12, 'hips', 'spine');
    else if (y < 1.3) w = blendW(y, 1.12, 1.3, 'spine', 'chest');
    else if (y < 1.44) w = [['chest', 1]];
    else w = blendW(y, 1.44, 1.47, 'chest', 'neck');
    // shoulders follow the arms a little
    if (y > 1.3 && Math.abs(x) > 0.12) {
      const k = smoothstep(0.12, 0.18, Math.abs(x)) * smoothstep(1.3, 1.4, y) * 0.35;
      w = w.map(([n, v]) => [n, v * (1 - k)]).concat([[x > 0 ? 'upperArmL' : 'upperArmR', k]]);
    }
    return w;
  };
  const Td = densify(T, [0.995, 1.004, 1.021, 1.03, 1.44]);
  b.tube(Td.map(([y, rx, rzF, rzB]) => ({ y, cx: 0, cz: 0, rx: rx * g, rzF: rzF * g, rzB: rzB * g, w: torsoW, c: torsoColor, sq: y > 1.15 && y < 1.4 ? 2.6 : 2.2 })), 20, false, true);
  // neck
  b.tube([[1.44, 0.056], [1.5, 0.05], [1.56, 0.048], [1.6, 0.045]].map(([y, r]) => ({ y, cx: 0, cz: -0.005, rx: r * (f ? 0.9 : 1.0) * Math.min(1.1, g), rzF: r * 0.95, rzB: r, w: blendW(y, 1.47, 1.55, 'neck', 'head'), c: skin })), 14);
  // legs
  for (const side of [1, -1]) {
    const sn = side > 0 ? 'L' : 'R';
    const L = [
      [0.93, 0.082, 0.0], [0.86, 0.088, 0.0], [0.76, 0.08, 0.0], [0.64, 0.068, 0.0], [0.54, 0.058, 0.003], [0.48, 0.054, 0.006], [0.43, 0.055, 0.0],
      [0.35, 0.058, -0.012], [0.26, 0.05, -0.008], [0.17, 0.038, -0.002], [0.1, 0.033, 0.0], [0.075, 0.034, 0.0],
    ];
    const legW = (x, y) => y > 0.52 ? [['thigh' + sn, 1]] : y > 0.43 ? blendW(y, 0.43, 0.52, 'shin' + sn, 'thigh' + sn) : y > 0.12 ? [['shin' + sn, 1]] : blendW(y, 0.07, 0.12, 'foot' + sn, 'shin' + sn);
    const legC = (x, y) => (y > o.pantsTo ? pantCol : skin);
    const Ld = densify(L, [o.pantsTo + 0.006, o.pantsTo - 0.006]);
    b.tube(Ld.map(([y, r, cz]) => ({ y, cx: side * (0.09 - (y > 0.8 ? (y - 0.8) * 0.05 : 0)), cz, rx: r * (f ? 1.04 : 1) * Math.sqrt(g), rzF: r * (y < 0.4 ? 0.95 : 1.0) * Math.sqrt(g), rzB: r * (y < 0.4 && y > 0.2 ? 1.25 : 1.0) * Math.sqrt(g), w: legW, c: legC })), 14);
    // shoe: loft along z
    const shoe = [];
    const S = 9;
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      const z = -0.075 + t * 0.27;
      const hw = 0.04 + Math.sin(t * Math.PI) * 0.014;
      const top = t < 0.35 ? 0.11 : lerp(0.11, 0.045, (t - 0.35) / 0.65);
      shoe.push({ z, hw, top });
    }
    const base = b.n;
    const shoeI0 = b.idx.length;
    const ringN = 12;
    const shoeW = [['foot' + sn, 1]];
    for (const r of shoe) {
      for (let s = 0; s < ringN; s++) {
        const a = (s / ringN) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = side * 0.09 + ca * r.hw;
        const y = 0.0 + (sa * 0.5 + 0.5) * r.top;
        const col = y < 0.018 ? shade(shoeCol, 0.35) : shoeCol;
        b.vert([x, Math.max(0.0, y), r.z], [ca, sa, 0], col, shoeW);
      }
    }
    for (let i = 0; i < shoe.length - 1; i++) for (let s = 0; s < ringN; s++) {
      const s1 = (s + 1) % ringN;
      const a = base + i * ringN + s, bb = base + i * ringN + s1, c = base + (i + 1) * ringN + s1, d = base + (i + 1) * ringN + s;
      b.idx.push(a, bb, c, a, c, d);
    }
    b.orient(shoeI0, b.idx.length, (x, y, z) => [side * 0.09, 0.045, z]);
    // toe & heel caps
    for (const [ri, dir] of [[shoe.length - 1, 1], [0, -1]]) {
      const r = shoe[ri];
      const ci0 = b.idx.length;
      const c = b.vert([side * 0.09, r.top * 0.5, r.z + dir * 0.01], [0, 0, dir], shoeCol, shoeW);
      for (let s = 0; s < ringN; s++) { const s1 = (s + 1) % ringN; const a = base + ri * ringN + s, bb = base + ri * ringN + s1; b.idx.push(c, a, bb); }
      b.orient(ci0, b.idx.length, () => [side * 0.09, r.top * 0.5, r.z - dir]);
    }
  }
  // arms
  for (const side of [1, -1]) {
    const sn = side > 0 ? 'L' : 'R';
    const ax = side * (f ? 0.168 : 0.178);
    const A = [
      [1.425, 0.03], [1.41, 0.046], [1.38, 0.053], [1.33, 0.05], [1.25, 0.045], [1.17, 0.04], [1.105, 0.036], [1.06, 0.038], [0.98, 0.036], [0.91, 0.03], [0.855, 0.026],
    ];
    const armW = (x, y) => y > 1.13 ? [['upperArm' + sn, 1]] : y > 1.07 ? blendW(y, 1.07, 1.13, 'forearm' + sn, 'upperArm' + sn) : y > 0.865 ? [['forearm' + sn, 1]] : blendW(y, 0.845, 0.865, 'hand' + sn, 'forearm' + sn);
    const armC = (x, y) => (y > shirtTop && !o.tank ? shirtCol : skin);
    const ag = f ? 0.88 : 1.0;
    const Ad = densify(A, [shirtTop + 0.006, shirtTop - 0.006]);
    b.tube(Ad.map(([y, r]) => ({ y, cx: ax + side * (1.42 - y) * 0.02, cz: 0, rx: r * ag * Math.sqrt(g), rzF: r * ag * Math.sqrt(g), rzB: r * ag * Math.sqrt(g) * 1.05, w: armW, c: armC })), 12, true);
    // hand (mitten with palm facing inward)
    const H = [[0.855, 0.022, 0.032], [0.82, 0.024, 0.044], [0.77, 0.02, 0.046], [0.72, 0.016, 0.04], [0.685, 0.01, 0.026], [0.672, 0.004, 0.012]];
    const hx = ax + side * 0.012;
    b.tube(H.map(([y, rx, rz]) => ({ y, cx: hx, cz: 0.005, rx, rzF: rz, rzB: rz, w: [['hand' + sn, 1]], c: skin })), 10, false, true);
    // thumb
    b.tube([[0.83, 0.012], [0.8, 0.011], [0.77, 0.009], [0.75, 0.005]].map(([y, r], i) => ({ y, cx: hx - side * 0.012, cz: 0.04 + i * 0.006, rx: r, rzF: r, rzB: r, w: [['hand' + sn, 1]], c: skin })), 8, false, true);
  }
  return b.build();
}

let headGeoCache = {};
function headGeometry(female) {
  const key = female ? 'f' : 'm';
  if (headGeoCache[key]) return headGeoCache[key];
  const g = new THREE.SphereGeometry(1, 36, 26);
  const p = g.attributes.position;
  const bump = (v, c, w) => Math.exp(-((v - c) * (v - c)) / (w * w));
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // base skull proportions
    let sx = 0.077, sy = 0.112, sz = 0.096;
    if (female) { sx *= 0.96; sy *= 0.97; sz *= 0.97; }
    // jaw taper below cheekbones
    const jaw = smoothstep(-0.05, -0.85, y);
    sx *= 1 - jaw * (female ? 0.34 : 0.27);
    sz *= 1 - jaw * 0.12 * (z < 0 ? 2.2 : 1);
    // back of skull fuller
    if (z < 0 && y > -0.2) sz *= 1.06;
    let X = x * sx, Y = y * sy, Z = z * sz;
    // chin forward
    if (z > 0) Z += 0.012 * bump(y, -0.82, 0.14) * smoothstep(0.4, 0.0, Math.abs(x));
    // nose: bridge to tip
    const nx = Math.exp(-(x * x) / 0.012);
    if (z > 0.5) Z += nx * (0.024 * bump(y, -0.3, 0.15) + 0.01 * bump(y, -0.05, 0.15) + 0.004 * bump(y, 0.12, 0.1)) * (female ? 0.85 : 1);
    // eye sockets
    if (z > 0.6) Z -= 0.006 * Math.exp(-((Math.abs(x) - 0.42) ** 2) / 0.02) * bump(y, 0.02, 0.12);
    // brow ridge
    if (z > 0.6) Z += 0.004 * bump(y, 0.17, 0.07) * (female ? 0.4 : 1);
    // cheekbones
    X += Math.sign(x) * 0.004 * bump(y, -0.12, 0.15) * smoothstep(0.3, 0.75, Math.abs(x)) * (z > 0 ? 1 : 0);
    // lips
    if (z > 0.6) Z += 0.0055 * Math.exp(-(x * x) / 0.05) * (bump(y, -0.52, 0.06) + bump(y, -0.6, 0.05));
    p.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  // ears merged
  const ear = new THREE.SphereGeometry(1, 12, 10);
  ear.scale(0.009, 0.028, 0.018);
  const parts = [g];
  for (const s of [1, -1]) { const e = ear.clone(); e.translate(s * 0.076, -0.01, -0.008); parts.push(e); }
  const merged = mergeIndexed(parts);
  headGeoCache[key] = merged;
  return merged;
}

function mergeIndexed(geos) {
  const pos = [], nrm = [], uv = [], idx = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(base === 0 ? u.getX(i) : 0.97, base === 0 ? u.getY(i) : 0.5); }
    for (const i of g.index.array) idx.push(base + i);
    base += p.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  m.setIndex(idx);
  return m;
}

const hairGeoCache = {};
function hairGeometry(style) {
  if (hairGeoCache[style]) return hairGeoCache[style];
  let g;
  if (style === 'long' || style === 'bun' || style === 'short' || style === 'buzz' || style === 'curly') {
    const thetaLen = style === 'long' ? Math.PI * 0.78 : style === 'buzz' ? Math.PI * 0.5 : Math.PI * 0.6;
    g = new THREE.SphereGeometry(1, 26, 16, 0, Math.PI * 2, 0, thetaLen);
    const p = g.attributes.position;
    const bulk = style === 'curly' ? 1.18 : style === 'buzz' ? 1.03 : style === 'long' ? 1.08 : 1.07;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let X = x * 0.079 * bulk, Y = y * 0.115 * bulk + 0.006, Z = z * 0.099 * bulk - 0.006;
      // hairline: lift the front edge above the forehead
      if (z > 0.2 && y < 0.55) { const k = smoothstep(0.2, 0.9, z) * smoothstep(0.55, 0.0, y); Y += k * 0.05; Z -= k * 0.02; }
      if (style === 'long' && z < 0.3 && y < 0.2) { Y -= smoothstep(0.2, -0.6, y) * 0.12; Z -= 0.01; X *= 1.02; }
      if (style === 'curly') { const n = Math.sin(x * 23) * Math.sin(y * 19) * Math.sin(z * 21); X += x * n * 0.006; Y += y * n * 0.006; Z += z * n * 0.006; }
      p.setXYZ(i, X, Y, Z);
    }
    g.computeVertexNormals();
    if (style === 'bun') {
      const bun = new THREE.SphereGeometry(0.045, 12, 10); bun.translate(0, 0.07, -0.085);
      g = mergeIndexed([g, bun]);
    }
  } else g = null;
  hairGeoCache[style] = g;
  return g;
}

// ---------------------------------------------------------------- Human
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 });
const hairMats = new Map();
export function randomLook(rng, female = rng.chance(0.5)) {
  const tone = rng.int(0, SKIN_TONES.length - 1);
  const shortSleeve = rng.chance(0.75);
  const shorts = rng.chance(0.45);
  return {
    female, tone,
    height: female ? rng.range(1.58, 1.76) : rng.range(1.68, 1.92),
    girth: rng.range(0.92, 1.18),
    shirt: rng.pick(SHIRT_COLS), pants: rng.pick(PANT_COLS), shoes: rng.pick(SHOE_COLS),
    sleeves: shortSleeve ? 1.2 : 0.87, pantsTo: shorts ? 0.52 : 0.1,
    tank: rng.chance(0.15), vneck: rng.chance(0.3),
    hair: female ? rng.pick(['long', 'long', 'bun', 'short', 'curly']) : rng.pick(['short', 'short', 'buzz', 'curly', 'bald']),
    hairCol: rng.pick(HAIR_COLS),
    variant: rng.int(0, 5),
  };
}

export class Human {
  constructor(look) {
    this.look = look;
    const skin = SKIN_TONES[look.tone];
    const geo = bodyGeometry({ ...look, skin });
    // skeleton
    const bones = [];
    const byName = {};
    for (const [n, p, o] of BONES) {
      const b = new THREE.Bone(); b.name = n;
      b.position.set(o[0], o[1], o[2]);
      if (p) byName[p].add(b);
      bones.push(b); byName[n] = b;
    }
    this.bones = byName;
    const mesh = new THREE.SkinnedMesh(geo, bodyMat);
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    // head
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(look.tone, look.female, look.variant), roughness: 0.6 });
    const head = new THREE.Mesh(headGeometry(look.female), faceMat);
    head.position.set(0, 0.085, 0.012);
    head.castShadow = true;
    byName.head.add(head);
    this.headMesh = head;
    const hg = hairGeometry(look.hair);
    if (hg) {
      const key = look.hairCol.join(',');
      if (!hairMats.has(key)) hairMats.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(...look.hairCol), map: hairTexture(), roughness: 0.55 }));
      const hair = new THREE.Mesh(hg, hairMats.get(key));
      hair.position.copy(head.position);
      hair.castShadow = true;
      byName.head.add(hair);
    }
    // overall scale for height
    const s = look.height / 1.75;
    this.root = new THREE.Group();
    this.root.add(mesh);
    mesh.scale.setScalar(s);
    this.scale = s;
  }
}
