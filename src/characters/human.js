// Procedural humans built from scratch (no model files):
// - skinned body lofted from anatomical cross-sections with muscle shaping
//   (chest, shoulder blades, glutes, deltoids, biceps, kneecaps, calves),
//   fingers and thumbs, shoes with soles, clothing hems and separate
//   skin / fabric materials (woven-fabric normal map on clothes)
// - sculpted head (nose bridge, nostrils, lips, chin, cheekbones, brow ridge,
//   eye sockets) with glossy eyeballs, a painted face texture registered to
//   the same landmarks, and hair made of hundreds of strand cards.
import * as THREE from 'three';
import { makeCanvas, toTexture, heightToNormal } from '../core/textures.js';
import { RNG, clamp, lerp, smoothstep, fbm, vnoise } from '../core/utils.js';
import { GeoBuilder } from '../core/geo.js';

export const SKIN_TONES = [[0.96, 0.8, 0.69], [0.9, 0.7, 0.56], [0.78, 0.57, 0.42], [0.62, 0.43, 0.3], [0.45, 0.3, 0.2], [0.3, 0.2, 0.14]];
const HAIR_COLS = [[0.03, 0.025, 0.02], [0.1, 0.06, 0.035], [0.26, 0.16, 0.08], [0.6, 0.45, 0.24], [0.42, 0.14, 0.05], [0.55, 0.55, 0.55]];
const SHIRT_COLS = [[0.92, 0.92, 0.9], [0.1, 0.1, 0.12], [0.75, 0.15, 0.2], [0.15, 0.35, 0.65], [0.95, 0.55, 0.65], [0.2, 0.6, 0.55], [0.95, 0.8, 0.3], [0.45, 0.25, 0.55], [0.3, 0.45, 0.25], [0.95, 0.45, 0.2]];
const PANT_COLS = [[0.12, 0.18, 0.32], [0.08, 0.08, 0.09], [0.55, 0.5, 0.42], [0.85, 0.83, 0.78], [0.2, 0.25, 0.32], [0.35, 0.3, 0.25]];
const SHOE_COLS = [[0.95, 0.95, 0.95], [0.08, 0.08, 0.08], [0.4, 0.25, 0.15], [0.2, 0.3, 0.6], [0.8, 0.15, 0.15]];
const EYE_COLS = ['#3b2414', '#5a3a1e', '#2c5a7b', '#3e6b3a', '#1c1410', '#6b7d8a'];

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

const TAU = Math.PI * 2;
const G = (d, s) => Math.exp(-(d * d) / (2 * s * s));
const G2 = (dx, dy, sx, sy) => Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)));
const angD = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const FRONT = Math.PI / 2, BACK = -Math.PI / 2;
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // sRGB -> linear

// ---------------------------------------------------------------- shared textures
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // fabric weave normal map
  const S = 128, H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = Math.sin((x / S) * TAU * 16), wy = Math.sin((y / S) * TAU * 16);
    const over = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? wx : wy;
    H[y * S + x] = 0.5 + over * 0.35 + (vnoise(x / 4, y / 4, 32) - 0.5) * 0.3;
  }
  const weave = toTexture(heightToNormal(H, S, S, 1.4), { srgb: false });
  // skin pores
  const P = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) P[y * S + x] = vnoise(x / 2, y / 2, 64) * 0.6 + vnoise(x / 6, y / 6, 21) * 0.4;
  const pores = toTexture(heightToNormal(P, S, S, 1.2), { srgb: false });
  pores.repeat.set(8, 8);
  // hair strands (alpha)
  const hw = 128, hh = 256, hc = makeCanvas(hw, hh), hx = hc.getContext('2d');
  hx.clearRect(0, 0, hw, hh);
  const r = new RNG(5);
  for (let i = 0; i < 420; i++) {
    const x = r.range(2, hw - 2), len = r.range(hh * 0.55, hh);
    const gg = r.range(150, 255);
    const grad = hx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, `rgba(${gg},${gg},${gg},1)`); grad.addColorStop(0.8, `rgba(${gg},${gg},${gg},0.9)`); grad.addColorStop(1, `rgba(${gg},${gg},${gg},0)`);
    hx.strokeStyle = grad; hx.lineWidth = r.range(0.8, 2.2);
    hx.beginPath(); hx.moveTo(x, 0); hx.quadraticCurveTo(x + r.range(-6, 6), len * 0.5, x + r.range(-8, 8), len); hx.stroke();
  }
  const strands = toTexture(hc, { repeat: false });
  SHARED = {
    weave, pores, strands,
    skinMat: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 0.12, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.6, 0.3, 0.25) }),
    clothMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, normalMap: weave, normalScale: new THREE.Vector2(0.3, 0.3) }),
    hairMats: new Map(), faceMats: new Map(),
  };
  return SHARED;
}

// ---------------------------------------------------------------- head sculpt
function headSize(female) { return female ? [0.074, 0.109, 0.093] : [0.077, 0.112, 0.096]; }
// base (pre-feature) head surface for a unit sphere direction
function headBase(x, y, z, female) {
  let [sx, sy, sz] = headSize(female);
  const jaw = smoothstep(-0.05, -0.85, y);
  sx *= 1 - jaw * (female ? 0.3 : 0.2);
  sz *= 1 - jaw * 0.12 * (z < 0 ? 2.2 : 1);
  if (z < 0 && y > -0.2) sz *= 1.06;
  if (y > 0.5) { const t = smoothstep(0.5, 1, y); sx *= 1 - t * 0.06; }
  return [x * sx, y * sy, z * sz];
}
// facial relief (added along +z) in head-local metres
function faceRelief(X, Y, female) {
  const ax = Math.abs(X);
  let d = 0;
  const nt = clamp((0.014 - Y) / 0.048, 0, 1);
  const ridge = lerp(0.0035, 0.0175, nt * nt * (3 - 2 * nt)) * G(X, lerp(0.0055, 0.0095, nt));
  d += ridge * smoothstep(-0.047, -0.036, Y) * smoothstep(0.026, 0.012, Y) * (female ? 0.85 : 1);
  d += 0.004 * G2(X, Y + 0.034, 0.008, 0.007);
  d += 0.0068 * G2(ax - 0.0135, Y + 0.04, 0.0048, 0.0055);          // alae
  d -= 0.0045 * G2(ax - 0.0068, Y + 0.0455, 0.0028, 0.0019);       // nostrils
  d -= 0.0078 * G2(ax - 0.031, Y - 0.006, 0.0125, 0.0088);         // eye sockets
  d += 0.0018 * G2(ax - 0.031, Y - 0.0145, 0.011, 0.0035);         // upper lid fold
  d += (female ? 0.0018 : 0.0045) * G2(ax - 0.03, Y - 0.028, 0.02, 0.006); // brow ridge
  d += 0.0042 * G2(ax - 0.044, Y + 0.016, 0.014, 0.013);           // cheekbones
  d -= 0.0028 * G2(ax - 0.046, Y + 0.056, 0.012, 0.015);           // cheek hollows
  d += 0.0058 * G2(X, Y + 0.0585, 0.0205, 0.0045);                 // upper lip
  d -= 0.0014 * G2(X, Y + 0.0545, 0.0035, 0.0025);                 // cupid's bow
  d -= 0.0012 * G2(X, Y + 0.0505, 0.0038, 0.0045);                 // philtrum
  d -= 0.003 * G2(X, Y + 0.0645, 0.024, 0.0011) * (ax < 0.027 ? 1 : 0); // mouth line
  d += (female ? 0.0074 : 0.0064) * G2(X, Y + 0.0715, 0.0175, 0.0048); // lower lip
  d -= 0.0028 * G2(X, Y + 0.081, 0.016, 0.0038);                  // labiomental groove
  d += 0.0095 * G2(X, Y + 0.096, 0.016, 0.012);                    // chin
  return d;
}
const EYE = { x: 0.031, y: 0.006, r: 0.0118 };
function headSurfaceZ(X, Y, female) {
  const [sx, sy, sz] = headSize(female);
  const y = Y / sy;
  const jaw = smoothstep(-0.05, -0.85, y);
  const x = X / (sx * (1 - jaw * (female ? 0.3 : 0.2)));
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return z * sz * (1 - jaw * 0.12) + faceRelief(X, Y, female);
}

const headGeoCache = {};
function headGeometry(female) {
  const key = female ? 'f' : 'm';
  if (headGeoCache[key]) return headGeoCache[key];
  const g = new THREE.SphereGeometry(1, 72, 56);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let [X, Y, Z] = headBase(x, y, z, female);
    if (Z > 0.02) Z += faceRelief(X, Y, female) * smoothstep(0.02, 0.055, Z);
    X += Math.sign(x) * 0.0035 * G(y + 0.12, 0.12) * smoothstep(0.3, 0.75, Math.abs(x)) * (z > 0 ? 1 : 0);
    p.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  // ears: helix rim + concha + lobe
  const parts = [g];
  for (const s of [1, -1]) {
    const helix = new THREE.TorusGeometry(0.019, 0.0045, 8, 20, Math.PI * 1.55);
    helix.scale(1, 1.45, 1); helix.rotateY(s * Math.PI / 2); helix.rotateZ(s * 0.15);
    helix.translate(s * 0.075, -0.008, -0.01);
    const concha = new THREE.SphereGeometry(1, 12, 10); concha.scale(0.007, 0.024, 0.016); concha.translate(s * 0.0745, -0.012, -0.008);
    const lobe = new THREE.SphereGeometry(1, 8, 6); lobe.scale(0.005, 0.008, 0.007); lobe.translate(s * 0.0755, -0.038, -0.006);
    parts.push(helix, concha, lobe);
  }
  const merged = mergeIndexed(parts);
  headGeoCache[key] = merged;
  return merged;
}

function mergeIndexed(geos) {
  const pos = [], nrm = [], uv = [], idx = [];
  let base = 0;
  geos.forEach((g, gi) => {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(gi === 0 ? u.getX(i) : 0.0, gi === 0 ? u.getY(i) : 0.5); // ears sample plain skin at the back
    }
    for (const i of g.index.array) idx.push(base + i);
    base += p.count;
  });
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  m.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  m.setIndex(idx);
  return m;
}

// map a head-local front landmark (X, Y) to face-texture pixel coords
function landmarkUV(X, Y, female, W, H) {
  let u = 0.25 + Math.atan2(X, 0.09) / TAU, v = 0.5 - Math.atan2(Y, 0.1) / Math.PI;
  const f = (uu, vv) => {
    const phi = uu * TAU, th = vv * Math.PI;
    const x = -Math.cos(phi) * Math.sin(th), y = Math.cos(th), z = Math.sin(phi) * Math.sin(th);
    const b = headBase(x, y, z, female);
    return [b[0], b[1]];
  };
  for (let it = 0; it < 14; it++) {
    const [x0, y0] = f(u, v), e = 1e-4;
    const [xu, yu] = f(u + e, v), [xv, yv] = f(u, v + e);
    const a = (xu - x0) / e, b = (xv - x0) / e, c = (yu - y0) / e, d = (yv - y0) / e;
    const det = a * d - b * c || 1e-9;
    const ex = X - x0, ey = Y - y0;
    u += (d * ex - b * ey) / det; v += (-c * ex + a * ey) / det;
  }
  return [u * W, v * H];
}

const faceCache = new Map();
function faceTexture(look) {
  const { tone, female, variant } = look;
  const beard = !female && !!look.beard;
  const key = `${tone}-${female}-${variant}-${beard}-${!!look.freckles}`;
  if (faceCache.has(key)) return faceCache.get(key);
  const W = 1024, H = 512;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const sk = SKIN_TONES[tone];
  const rgb = (k, a = 1) => `rgba(${Math.round(Math.min(255, sk[0] * 255 * k))},${Math.round(Math.min(255, sk[1] * 255 * k))},${Math.round(Math.min(255, sk[2] * 255 * k))},${a})`;
  ctx.fillStyle = rgb(1); ctx.fillRect(0, 0, W, H);
  // skin mottling from a small noise canvas blended over the base tone
  {
    const nw = 256, nh = 128, nc = makeCanvas(nw, nh), nx = nc.getContext('2d');
    const im = nx.createImageData(nw, nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const n = fbm(x / nw, y / nh, 8, 4, 0.5, tone * 3 + variant) * 0.8 + vnoise(x, y, 256) * 0.2;
      const i = (y * nw + x) * 4; const v = n * 255;
      im.data[i] = v; im.data[i + 1] = v * 0.92; im.data[i + 2] = v * 0.88; im.data[i + 3] = 255;
    }
    nx.putImageData(im, 0, 0);
    ctx.save(); ctx.globalAlpha = 0.16; ctx.globalCompositeOperation = 'soft-light'; ctx.drawImage(nc, 0, 0, W, H); ctx.restore();
  }
  const L = (X, Y) => landmarkUV(X, Y, female, W, H);
  const px = (m) => (m / 0.1) * (W / 3.7);
  const blob = (X, Y, r, col) => { const [x, y] = L(X, Y); const gg = ctx.createRadialGradient(x, y, 0, x, y, px(r)); gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.fillRect(x - px(r), y - px(r), px(r) * 2, px(r) * 2); };
  const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
  for (const s of [1, -1]) {
    blob(s * 0.045, -0.025, 0.022, `rgba(205,85,75,${female ? 0.2 : 0.12})`);
    blob(s * 0.031, -0.006, 0.012, rgb(0.72, 0.35));
    blob(s * 0.031, 0.017, 0.014, rgb(0.8, 0.3));
  }
  blob(0, -0.033, 0.01, 'rgba(200,90,80,0.15)');
  for (const s of [1, -1]) { const [x, y] = L(s * 0.0068, -0.0458); ctx.fillStyle = rgb(0.35, 0.85); ctx.beginPath(); ctx.ellipse(x, y, px(0.0032), px(0.0018), 0, 0, TAU); ctx.fill(); }
  // eyelids, lashes, crease and brows around each eyeball opening
  for (const s of [1, -1]) {
    const upper = [], crease = [], low = [];
    for (let k = 0; k <= 16; k++) { const a = Math.PI * (k / 16); upper.push(L(s * EYE.x + Math.cos(a) * 0.0124, EYE.y + Math.sin(a) * 0.0078)); }
    for (let k = 0; k <= 12; k++) { const a = Math.PI * (0.1 + 0.8 * k / 12); crease.push(L(s * EYE.x + Math.cos(a) * 0.0128, EYE.y + 0.004 + Math.sin(a) * 0.0085)); }
    for (let k = 0; k <= 12; k++) { const a = Math.PI * (1 + k / 12); low.push(L(s * EYE.x + Math.cos(a) * 0.0115, EYE.y + Math.sin(a) * 0.0068)); }
    ctx.strokeStyle = female ? 'rgba(15,8,5,0.95)' : rgb(0.25, 0.9); ctx.lineWidth = female ? 4.5 : 3;
    poly(upper); ctx.stroke();
    if (female) { ctx.lineWidth = 1.6; for (let k = 2; k <= 14; k += 2) { const [x, y] = upper[k]; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (k - 8) * 0.6, y - 7); ctx.stroke(); } }
    ctx.strokeStyle = rgb(0.65, 0.55); ctx.lineWidth = 2; poly(crease); ctx.stroke();
    ctx.strokeStyle = rgb(0.55, 0.45); ctx.lineWidth = 1.6; poly(low); ctx.stroke();
    const hc = look.hairCol || HAIR_COLS[variant % 3];
    const r = new RNG(variant * 31 + (s > 0 ? 1 : 2));
    for (let k = 0; k < (female ? 70 : 120); k++) {
      const t = r.next();
      const bx = s * lerp(0.0165, 0.047, t), by = 0.0215 + Math.sin(t * Math.PI) * (female ? 0.0065 : 0.0045) + t * 0.002 + r.range(-0.0018, 0.0018) * (female ? 0.6 : 1);
      const [x, y] = L(bx, by);
      ctx.strokeStyle = `rgba(${hc.map((v) => Math.round(v * 255 * 0.85)).join(',')},${r.range(0.5, 0.95)})`;
      ctx.lineWidth = r.range(1.2, 2.2);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * r.range(4, 9), y - r.range(1, 4)); ctx.stroke();
    }
  }
  // lips
  const lipCol = female ? [170, 72, 82] : [sk[0] * 255 * 0.78 + 12, sk[1] * 255 * 0.62, sk[2] * 255 * 0.62];
  {
    const up = [], lo = [], line = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, xx = lerp(-0.0235, 0.0235, t), e = 1 - Math.pow(Math.abs(xx) / 0.0235, 2);
      up.push(L(xx, -0.0645 + 0.0085 * e - 0.0016 * G(xx, 0.004) * e));
      lo.push(L(xx, -0.0645 - 0.0105 * Math.pow(e, 0.8)));
      line.push(L(xx, -0.0645 + 0.0004 * Math.sin(t * Math.PI * 3)));
    }
    ctx.fillStyle = `rgba(${lipCol.map((v) => Math.round(v)).join(',')},0.92)`;
    poly([...up, ...[...lo].reverse()]); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(60,20,20,0.75)'; ctx.lineWidth = 2; poly(line); ctx.stroke();
    const [hx, hy] = L(0, -0.0705); const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, px(0.008));
    hg.addColorStop(0, 'rgba(255,230,230,0.35)'); hg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = hg; ctx.fillRect(hx - 40, hy - 20, 80, 40);
  }
  if (beard || (!female && variant % 3 === 0)) {
    const r = new RNG(variant + 99);
    const dens = beard ? 9000 : 4000;
    for (let k = 0; k < dens; k++) {
      const xx = r.range(-0.07, 0.07), yy = r.range(-0.115, -0.03);
      const inMouth = Math.abs(xx) < 0.024 && yy > -0.078 && yy < -0.056;
      const jawZone = yy < -0.05 || (Math.abs(xx) < 0.03 && yy < -0.047);
      if (inMouth || !jawZone || Math.abs(xx) > 0.068) continue;
      const [x, y] = L(xx, yy);
      ctx.fillStyle = `rgba(25,15,10,${beard ? r.range(0.25, 0.6) : r.range(0.06, 0.18)})`;
      ctx.fillRect(x, y, beard ? 2 : 1.5, beard ? 3 : 1.5);
    }
  }
  if (look.freckles) {
    const r = new RNG(variant + 7);
    for (let k = 0; k < 160; k++) { const [x, y] = L(r.range(-0.055, 0.055), r.range(-0.035, 0.005)); ctx.fillStyle = `rgba(120,60,30,${r.range(0.15, 0.4)})`; ctx.beginPath(); ctx.arc(x, y, r.range(1, 2.4), 0, TAU); ctx.fill(); }
  }
  // store at half resolution (drawn at 1024 for clean anti-aliased features)
  const out = makeCanvas(W / 2, H / 2);
  out.getContext('2d').drawImage(c, 0, 0, W / 2, H / 2);
  const t = toTexture(out, { repeat: false });
  faceCache.set(key, t);
  return t;
}

const eyeCache = new Map();
function eyeMaterial(colIdx) {
  if (eyeCache.has(colIdx)) return eyeCache.get(colIdx);
  const W = 256, H = 128, c = makeCanvas(W, H), ctx = c.getContext('2d');
  const sc = ctx.createRadialGradient(W * 0.25, H / 2, 0, W * 0.25, H / 2, W * 0.3);
  sc.addColorStop(0, '#f6f1ea'); sc.addColorStop(0.7, '#e9dfd6'); sc.addColorStop(1, '#cdb7ad');
  ctx.fillStyle = '#d9c9be'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = sc; ctx.fillRect(0, 0, W / 2, H);
  const r = new RNG(colIdx + 1);
  ctx.strokeStyle = 'rgba(190,70,70,0.25)'; ctx.lineWidth = 0.7;
  for (let k = 0; k < 14; k++) { ctx.beginPath(); const a = r.range(0, TAU); ctx.moveTo(W * 0.25 + Math.cos(a) * 60, H / 2 + Math.sin(a) * 50); ctx.lineTo(W * 0.25 + Math.cos(a) * 30, H / 2 + Math.sin(a) * 25); ctx.stroke(); }
  const cx = W * 0.25, cy = H / 2, ir = 21;
  const col = EYE_COLS[colIdx % EYE_COLS.length];
  const ig = ctx.createRadialGradient(cx, cy, 2, cx, cy, ir);
  ig.addColorStop(0, '#000'); ig.addColorStop(0.3, col); ig.addColorStop(0.85, col); ig.addColorStop(1, '#0b0705');
  ctx.fillStyle = ig; ctx.beginPath(); ctx.ellipse(cx, cy, ir, ir, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let k = 0; k < 40; k++) { const a = (k / 40) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8); ctx.lineTo(cx + Math.cos(a) * ir * 0.9, cy + Math.sin(a) * ir * 0.9); ctx.stroke(); }
  ctx.fillStyle = '#020202'; ctx.beginPath(); ctx.arc(cx, cy, 7.5, 0, TAU); ctx.fill();
  const m = new THREE.MeshPhysicalMaterial({ map: toTexture(c, { repeat: false }), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.0 });
  eyeCache.set(colIdx, m);
  return m;
}

// ---------------------------------------------------------------- hair (cap + strand cards)
const hairCache = new Map();
function hairInRegion(d, style) {
  const [x, y, z] = d;
  if (style === 'long' || style === 'bun') return y > (z > 0.3 ? 0.4 - (1 - z) * 0.2 : z > -0.2 ? -0.05 - Math.max(0, -z) * 0.3 : -0.42);
  if (style === 'curly') return y > (z > 0.3 ? 0.36 : z > -0.2 ? 0.0 : -0.38);
  return y > (z > 0.35 ? 0.45 - (1 - z) * 0.25 : z > -0.15 ? 0.02 + (Math.abs(x) > 0.85 ? -0.12 : 0) : -0.42);
}
function hairGeometry(style, female) {
  const key = style + female;
  if (hairCache.has(key)) return hairCache.get(key);
  if (style === 'bald') { hairCache.set(key, null); return null; }
  const rng = new RNG(style.length * 13 + (female ? 7 : 3));
  const capB = new GeoBuilder();
  const B = new GeoBuilder();
  const [hx, hy, hz] = headSize(female);
  const surf = (d, k) => [d[0] * hx * k, d[1] * hy * k + 0.002, d[2] * hz * k - 0.002];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // scalp cap under the strands
  {
    const cap = new THREE.SphereGeometry(1, 40, 28, 0, TAU, 0, Math.PI * 0.82);
    const p = cap.attributes.position;
    const keep = [];
    for (let i = 0; i < p.count; i++) {
      const d = [p.getX(i), p.getY(i), p.getZ(i)];
      const inR = hairInRegion(d, style);
      const s = surf(d, inR ? (style === 'curly' ? 1.13 : 1.035) : 0.96);
      p.setXYZ(i, s[0], s[1], s[2]);
      keep.push(inR);
    }
    cap.computeVertexNormals();
    const ix = cap.index.array, nix = [];
    for (let t = 0; t < ix.length; t += 3) if (keep[ix[t]] && keep[ix[t + 1]] && keep[ix[t + 2]]) nix.push(ix[t], ix[t + 1], ix[t + 2]);
    cap.setIndex(nix);
    const uv = cap.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 0.5 + 0.3);
    capB.addGeometry(cap, new THREE.Matrix4());
  }
  if (style === 'buzz') { const g = { cap: capB.build(), cards: null }; hairCache.set(key, g); return g; }
  const N = style === 'long' ? 900 : style === 'curly' ? 800 : style === 'bun' ? 700 : 900;
  const crown = norm([0, 1, -0.35]);
  for (let i = 0; i < N; i++) {
    let d;
    for (let tries = 0; tries < 40; tries++) {
      const u = rng.next() * 2 - 1, th = rng.next() * TAU, s = Math.sqrt(1 - u * u);
      d = [s * Math.cos(th), u, s * Math.sin(th)];
      if (hairInRegion(d, style) && d[1] > -0.5) break;
    }
    const long = style === 'long' && d[2] < 0.25; // only side/back strands hang; the front is swept back
    const Lh = style === 'curly' ? rng.range(0.025, 0.045) : long ? rng.range(0.16, 0.32) : style === 'long' ? rng.range(0.06, 0.12) : style === 'bun' ? rng.range(0.04, 0.08) : rng.range(0.025, 0.05);
    const w = style === 'curly' ? rng.range(0.012, 0.02) : rng.range(0.008, 0.014);
    const S = long ? 7 : 4;
    let p = surf(d, style === 'curly' ? 1.1 : 1.03 + rng.next() * 0.015);
    let gdir;
    if (style === 'bun' || (style === 'long' && d[2] >= 0.25)) gdir = norm([d[0] * 0.4, 0.5 - d[1] * 0.4, -1 - d[2] * 0.2]);
    else {
      const v = [d[0] - crown[0], d[1] - crown[1], d[2] - crown[2]];
      const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
      gdir = norm([v[0] - d[0] * dot + rng.range(-0.25, 0.25), v[1] - d[1] * dot, v[2] - d[2] * dot + rng.range(-0.25, 0.25)]);
      if (!female && d[2] > 0.5 && style === 'short') gdir = norm([gdir[0] + 0.6, gdir[1] + 0.3, gdir[2] - 0.2]);
    }
    if (style === 'curly') gdir = norm([gdir[0] + d[0] * 0.9, gdir[1] + d[1] * 0.9, gdir[2] + d[2] * 0.9]);
    const base = B.n;
    let curlA = rng.range(0, TAU);
    for (let k = 0; k <= S; k++) {
      const t = k / S;
      const n = norm([p[0] / hx, (p[1] - 0.002) / hy, (p[2] + 0.002) / hz]);
      const side = norm(cross(n, gdir));
      const ww = w * (1 - t * 0.55) * 0.5;
      B.vert(p[0] + side[0] * ww, p[1] + side[1] * ww, p[2] + side[2] * ww, n[0], n[1], n[2], 0, t);
      B.vert(p[0] - side[0] * ww, p[1] - side[1] * ww, p[2] - side[2] * ww, n[0], n[1], n[2], 1, t);
      if (k === S) break;
      const step = Lh / S;
      p = [p[0] + gdir[0] * step, p[1] + gdir[1] * step, p[2] + gdir[2] * step];
      if (style === 'curly') { curlA += 1.6; gdir = norm([gdir[0] + Math.cos(curlA) * 0.6, gdir[1] + Math.sin(curlA) * 0.6, gdir[2] + Math.cos(curlA * 0.7) * 0.6]); }
      const rel = [p[0] / hx, (p[1] - 0.002) / hy, (p[2] + 0.002) / hz];
      const rl = Math.hypot(rel[0], rel[1], rel[2]);
      const minK = style === 'curly' ? 1.08 : 1.035 + t * 0.03;
      const hanging = long && p[1] < -0.01;
      if (rl < minK) p = surf(norm(rel), minK);
      else if (!hanging && style !== 'curly' && rl > minK + 0.03) p = surf(norm(rel), minK + 0.02);
      if (hanging) { gdir = norm([gdir[0] * 0.5 + Math.sign(p[0]) * 0.05, gdir[1] * 0.5 - 1.2, Math.min(gdir[2] * 0.5, 0) - 0.08]); if (p[2] > -0.01 && Math.abs(p[0]) < hx * 1.05) p[2] = -0.01; }
      else if (style !== 'curly') { const nn = norm(rel); const dd = gdir[0] * nn[0] + gdir[1] * nn[1] + gdir[2] * nn[2]; gdir = norm([gdir[0] - nn[0] * dd, gdir[1] - nn[1] * dd - (long ? 0.15 : 0.05), gdir[2] - nn[2] * dd]); }
    }
    for (let k = 0; k < S; k++) { const a = base + k * 2; B.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  if (style === 'bun') {
    const bun = new THREE.SphereGeometry(0.042, 16, 12); bun.scale(1, 0.9, 0.85);
    capB.addGeometry(bun, new THREE.Matrix4().makeTranslation(0, 0.07, -0.088));
  }
  const g = { cap: capB.build(), cards: B.build() };
  hairCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- skinned body
class SkinBuilder {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.si = []; this.sw = []; this.skin = []; this.idx = []; this.n = 0; }
  vert(p, c, w, uv, isSkin) {
    this.pos.push(p[0], p[1], p[2]); this.col.push(lin(c[0]), lin(c[1]), lin(c[2])); this.uv.push(uv[0], uv[1]); this.skin.push(isSkin ? 1 : 0);
    const ws = w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    let tot = 0; for (const e of ws) tot += e[1];
    for (let k = 0; k < 4; k++) { const e = ws[k]; this.si.push(e ? BONE_INDEX[e[0]] : 0); this.sw.push(e ? e[1] / tot : 0); }
    return this.n++;
  }
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
  // vertical tube of horizontal rings
  rings(list, segs, capTop = false, capBot = false) {
    const base = this.n, i0 = this.idx.length;
    for (const r of list) {
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rz = sa > 0 ? r.rzF : r.rzB;
        const e = r.sq || 2;
        const fx = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / e), fz = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / e);
        const m = r.mod ? r.mod(a) : 1;
        const off = r.off ? r.off(a) : 0;
        const x = r.cx + fx * r.rx * m + ca * off, z = r.cz + fz * rz * m + sa * off;
        this.vert([x, r.y, z], r.c(x, r.y, z, a), r.w(x, r.y, z), [(s / segs) * 22, r.y / 0.028], r.skin(x, r.y, z, a));
      }
    }
    for (let i = 0; i < list.length - 1; i++) for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = base + i * segs + s, b = base + i * segs + s1, c = base + (i + 1) * segs + s1, d = base + (i + 1) * segs + s;
      this.idx.push(a, d, b, b, d, c);
    }
    const near = (y) => { let best = list[0]; for (const r of list) if (Math.abs(r.y - y) < Math.abs(best.y - y)) best = r; return [best.cx, y, best.cz]; };
    this.orient(i0, this.idx.length, (x, y) => near(y));
    const cap = (ri, up) => {
      const r = list[ri], c0 = this.idx.length;
      const center = this.vert([r.cx, r.y + (up ? 0.004 : -0.004), r.cz], r.c(r.cx, r.y, r.cz, 0), r.w(r.cx, r.y, r.cz), [0, 0], r.skin(r.cx, r.y, r.cz, 0));
      for (let s = 0; s < segs; s++) this.idx.push(center, base + ri * segs + s, base + ri * segs + ((s + 1) % segs));
      this.orient(c0, this.idx.length, () => [r.cx, r.y + (up ? -1 : 1), r.cz]);
    };
    if (capTop) cap(0, true);
    if (capBot) cap(list.length - 1, false);
  }
  // tube along an arbitrary path (fingers)
  path(pts, radii, segs, w, col, isSkin, flat = 1) {
    const base = this.n, i0 = this.idx.length;
    let nPrev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      const t = new THREE.Vector3(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
      let n = nPrev ? nPrev.clone() : new THREE.Vector3(1, 0, 0);
      n.sub(t.clone().multiplyScalar(n.dot(t)));
      if (n.lengthSq() < 1e-6) n = new THREE.Vector3(0, 0, 1);
      n.normalize();
      nPrev = n;
      const b = new THREE.Vector3().crossVectors(t, n);
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * TAU;
        const r = radii[i];
        const v = n.clone().multiplyScalar(Math.cos(a) * r * flat).addScaledVector(b, Math.sin(a) * r);
        this.vert([p[0] + v.x, p[1] + v.y, p[2] + v.z], col, w, [s / segs, i / pts.length], isSkin);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const a = base + i * segs + s, b = base + i * segs + s1, c = base + (i + 1) * segs + s1, d = base + (i + 1) * segs + s;
      this.idx.push(a, d, b, b, d, c);
    }
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const tip = this.vert([last[0] + (last[0] - prev[0]) * 0.35, last[1] + (last[1] - prev[1]) * 0.35, last[2] + (last[2] - prev[2]) * 0.35], col, w, [0.5, 1], isSkin);
    const lb = base + (pts.length - 1) * segs;
    for (let s = 0; s < segs; s++) this.idx.push(tip, lb + s, lb + ((s + 1) % segs));
    const axis = (x, y, z) => {
      let best = pts[0], bd = Infinity;
      for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2; if (d < bd) { bd = d; best = p; } }
      return best;
    };
    this.orient(i0, this.idx.length, axis);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const skinI = [], clothI = [];
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t], b = this.idx[t + 1], c = this.idx[t + 2];
      (this.skin[a] + this.skin[b] + this.skin[c] >= 2 ? skinI : clothI).push(a, b, c);
    }
    g.setIndex([...skinI, ...clothI]);
    g.addGroup(0, skinI.length, 0);
    g.addGroup(skinI.length, clothI.length, 1);
    g.computeVertexNormals();
    return g;
  }
}

const blendW = (y, y0, y1, a, b) => { const t = smoothstep(y0, y1, y); return [[a, 1 - t], [b, t]]; };
function sample(table, y) {
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i], b = table[i + 1];
    if ((y - a[0]) * (y - b[0]) <= 0) { const t = (y - a[0]) / (b[0] - a[0] || 1); return a.map((v, k) => v + (b[k] - v) * t); }
  }
  return (Math.abs(y - table[0][0]) < Math.abs(y - table[table.length - 1][0]) ? table[0] : table[table.length - 1]).slice();
}
const steps = (y0, y1, dy) => { const n = Math.max(2, Math.round(Math.abs(y1 - y0) / dy)); return Array.from({ length: n + 1 }, (_, i) => y0 + (y1 - y0) * (i / n)); };

function bodyGeometry(o, Q) {
  const b = new SkinBuilder();
  const g = o.girth, f = o.female;
  const skin = o.skin;
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const shirt = o.shirt, pants = o.pants, shoes = o.shoes;
  const dy = Q >= 2 ? 0.012 : 0.02;
  const SEG = Q >= 2 ? 32 : 22, LSEG = Q >= 2 ? 20 : 14;
  const waist = 1.025;
  const inShirt = (x, y, z) => {
    if (y > 1.445 || y < waist) return false;
    if (o.tank && Math.abs(x) > 0.12 && y > 1.3) return false;
    if (o.vneck && y > 1.36 && z > 0.04 && Math.abs(x) < 0.05 + (y - 1.36) * 0.6) return false;
    return true;
  };
  // ---- torso
  const T = f ? [
    [0.79, 0.13, 0.085, 0.1], [0.85, 0.165, 0.095, 0.118], [0.92, 0.175, 0.095, 0.125], [0.99, 0.15, 0.085, 0.1], [1.06, 0.128, 0.082, 0.083],
    [1.13, 0.135, 0.09, 0.08], [1.2, 0.146, 0.106, 0.082], [1.26, 0.15, 0.11, 0.085], [1.31, 0.148, 0.104, 0.085], [1.36, 0.145, 0.088, 0.083],
    [1.395, 0.128, 0.072, 0.072], [1.425, 0.095, 0.056, 0.058], [1.455, 0.052, 0.048, 0.05],
  ] : [
    [0.79, 0.13, 0.085, 0.095], [0.85, 0.158, 0.095, 0.108], [0.92, 0.164, 0.098, 0.112], [0.99, 0.152, 0.092, 0.096], [1.06, 0.145, 0.095, 0.086],
    [1.13, 0.15, 0.1, 0.085], [1.2, 0.16, 0.108, 0.09], [1.27, 0.168, 0.112, 0.094], [1.33, 0.172, 0.106, 0.095], [1.37, 0.165, 0.096, 0.09],
    [1.4, 0.152, 0.08, 0.078], [1.425, 0.112, 0.064, 0.064], [1.455, 0.056, 0.052, 0.052],
  ];
  const torsoW = (x, y) => {
    let w;
    if (y < 0.98) w = [['hips', 1]];
    else if (y < 1.12) w = blendW(y, 0.98, 1.12, 'hips', 'spine');
    else if (y < 1.3) w = blendW(y, 1.12, 1.3, 'spine', 'chest');
    else if (y < 1.44) w = [['chest', 1]];
    else w = blendW(y, 1.44, 1.47, 'chest', 'neck');
    if (y > 1.3 && Math.abs(x) > 0.12) {
      const k = smoothstep(0.12, 0.18, Math.abs(x)) * smoothstep(1.3, 1.4, y) * 0.35;
      w = w.map(([n, v]) => [n, v * (1 - k)]).concat([[x > 0 ? 'upperArmL' : 'upperArmR', k]]);
    }
    return w;
  };
  const belly = Math.max(0, g - 1.05);
  const torsoRows = steps(0.79, 1.455, dy).map((y) => {
    const [, rx, rzF, rzB] = sample(T, y);
    const clothedTop = y > waist && y < 1.445;
    const clothedBot = y <= waist;
    const mod = (a) => {
      let m = 1;
      if (f) m += 0.2 * G(y - 1.255, 0.045) * (G(angD(a, FRONT - 0.48), 0.3) + G(angD(a, FRONT + 0.48), 0.3));
      else m += 0.07 * G(y - 1.285, 0.04) * (G(angD(a, FRONT - 0.45), 0.38) + G(angD(a, FRONT + 0.45), 0.38));
      m += 0.045 * G(y - 1.32, 0.05) * (G(angD(a, BACK - 0.55), 0.3) + G(angD(a, BACK + 0.55), 0.3));
      m += (f ? 0.12 : 0.07) * G(y - 0.885, 0.05) * (G(angD(a, BACK - 0.5), 0.38) + G(angD(a, BACK + 0.5), 0.38));
      m -= 0.03 * G(angD(a, BACK), 0.13) * smoothstep(0.98, 1.1, y) * (1 - smoothstep(1.38, 1.44, y));
      m += (0.02 + belly * 0.6) * G(y - 1.06, 0.07) * G(angD(a, FRONT), 0.7);
      m += 0.02 * G(y - 1.42, 0.012) * (G(angD(a, 0), 0.6) + G(angD(a, Math.PI), 0.6));
      if (clothedTop || clothedBot) m = 1 + (m - 1) * 0.75;
      return m;
    };
    const off = () => {
      if (y > waist && y < waist + 0.018) return 0.009; // shirt hem overhang
      if (y > 1.43 && y < 1.445) return 0.004;           // collar rib
      return clothedTop ? 0.004 : clothedBot ? 0.005 : 0;
    };
    return {
      y, cx: 0, cz: 0, rx: rx * g, rzF: rzF * g, rzB: rzB * g, sq: y > 1.15 && y < 1.4 ? 2.5 : 2.15, mod, off,
      w: torsoW,
      c: (x, yy, z) => (inShirt(x, yy, z) ? shirt : yy > 1.445 ? skin : yy > 1.0 ? shade(pants, 0.55) : pants),
      skin: (x, yy, z) => !inShirt(x, yy, z) && yy > waist,
    };
  });
  b.rings(torsoRows, SEG, false, true);
  // ---- neck
  b.rings(steps(1.44, 1.6, dy).map((y) => ({
    y, cx: 0, cz: -0.005, rx: 0.053 * (f ? 0.88 : 1) * Math.min(1.08, g) * lerp(1.04, 0.84, (y - 1.44) / 0.16), rzF: 0.05 * lerp(1, 0.9, (y - 1.44) / 0.16), rzB: 0.054,
    mod: (a) => 1 + 0.07 * G(y - 1.5, 0.04) * (G(angD(a, FRONT - 0.7), 0.25) + G(angD(a, FRONT + 0.7), 0.25)) + (f ? 0 : 0.09 * G(y - 1.515, 0.012) * G(angD(a, FRONT), 0.18)),
    w: () => blendW(y, 1.47, 1.55, 'neck', 'head'), c: () => skin, skin: () => true,
  })), LSEG);
  // ---- legs + shoes
  for (const side of [1, -1]) {
    const sn = side > 0 ? 'L' : 'R';
    const Lt = [
      [0.93, 0.082, 0.0], [0.86, 0.088, 0.0], [0.76, 0.08, 0.0], [0.64, 0.068, 0.0], [0.54, 0.058, 0.003], [0.48, 0.054, 0.006], [0.43, 0.055, 0.0],
      [0.35, 0.056, -0.008], [0.26, 0.049, -0.006], [0.17, 0.038, -0.002], [0.1, 0.033, 0.0], [0.075, 0.034, 0.0],
    ];
    const inner = side > 0 ? Math.PI : 0;
    const legW = (x, y) => y > 0.52 ? [['thigh' + sn, 1]] : y > 0.43 ? blendW(y, 0.43, 0.52, 'shin' + sn, 'thigh' + sn) : y > 0.12 ? [['shin' + sn, 1]] : blendW(y, 0.07, 0.12, 'foot' + sn, 'shin' + sn);
    const rows = steps(0.93, 0.075, dy).map((y) => {
      const [, r, cz] = sample(Lt, y);
      const cov = y > o.pantsTo;
      const mod = (a) => {
        let m = 1;
        m += 0.08 * G(y - 0.72, 0.07) * G(angD(a, FRONT), 0.6);
        m += 0.05 * G(y - 0.8, 0.06) * G(angD(a, inner), 0.5);
        m += 0.05 * G(y - 0.7, 0.07) * G(angD(a, BACK), 0.6);
        m += 0.11 * G(y - 0.49, 0.022) * G(angD(a, FRONT), 0.32);
        m += (f ? 0.13 : 0.17) * G(y - 0.34, 0.055) * (G(angD(a, BACK - 0.35), 0.35) + G(angD(a, BACK + 0.35), 0.35));
        m += 0.03 * G(y - 0.28, 0.08) * G(angD(a, FRONT), 0.15);
        m += 0.09 * G(y - 0.095, 0.015) * (G(angD(a, 0), 0.3) + G(angD(a, Math.PI), 0.3));
        if (cov) m = 1 + (m - 1) * 0.3;
        return m;
      };
      const off = () => {
        if (!cov) return 0;
        const hem = y < o.pantsTo + 0.015 ? 0.004 : 0;
        return (o.pantsTo < 0.3 ? 0.012 + Math.max(0, 0.45 - y) * 0.03 : 0.008) + hem;
      };
      return {
        y, cx: side * (0.09 - (y > 0.8 ? (y - 0.8) * 0.05 : 0)), cz, rx: r * (f ? 1.04 : 1) * Math.sqrt(g), rzF: r * Math.sqrt(g), rzB: r * Math.sqrt(g), mod, off,
        w: legW, c: () => (cov ? pants : skin), skin: () => !cov,
      };
    });
    b.rings(rows, LSEG);
    const shoeW = [['foot' + sn, 1]];
    const NSt = Q >= 2 ? 16 : 10, ringN = Q >= 2 ? 18 : 12;
    const base = b.n, si0 = b.idx.length;
    const stations = [];
    for (let i = 0; i <= NSt; i++) {
      const t = i / NSt;
      const z = -0.075 + t * 0.275;
      const end = Math.min(1, Math.min(t, 1 - t) * 7);
      const hw = (0.036 + Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.016) * (0.55 + 0.45 * Math.sqrt(end));
      const top = (t < 0.3 ? 0.105 : lerp(0.1, 0.045, (t - 0.3) / 0.7)) * (0.6 + 0.4 * Math.sqrt(end));
      stations.push({ z, hw, top });
    }
    for (const st of stations) {
      for (let k = 0; k < ringN; k++) {
        const a = (k / ringN) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = side * 0.09 + Math.sign(ca) * Math.pow(Math.abs(ca), 0.8) * st.hw;
        const y = Math.max(0, (sa * 0.5 + 0.5) * st.top);
        let col = shoes;
        if (y < 0.026) col = shoes[0] > 0.5 ? shade(shoes, 0.92) : [0.92, 0.92, 0.9];
        if (y > st.top * 0.85 && st.z > 0.0 && st.z < 0.12 && Math.abs(x - side * 0.09) < 0.02) col = [0.95, 0.95, 0.93];
        b.vert([x, y, st.z], col, shoeW, [k / ringN, st.z * 5], false);
      }
    }
    for (let i = 0; i < stations.length - 1; i++) for (let k = 0; k < ringN; k++) {
      const k1 = (k + 1) % ringN;
      const a = base + i * ringN + k, bb = base + i * ringN + k1, c = base + (i + 1) * ringN + k1, d = base + (i + 1) * ringN + k;
      b.idx.push(a, bb, c, a, c, d);
    }
    b.orient(si0, b.idx.length, (x, y, z) => [side * 0.09, 0.045, z]);
  }
  // ---- arms, hands, fingers
  for (const side of [1, -1]) {
    const sn = side > 0 ? 'L' : 'R';
    const ax = side * (f ? 0.168 : 0.178);
    const out = side > 0 ? 0 : Math.PI;
    const A = [
      [1.41, 0.034], [1.395, 0.045], [1.37, 0.05], [1.33, 0.049], [1.25, 0.045], [1.17, 0.04], [1.105, 0.036], [1.06, 0.038], [0.98, 0.036], [0.91, 0.03], [0.855, 0.026],
    ];
    const armW = (x, y) => y > 1.13 ? [['upperArm' + sn, 1]] : y > 1.07 ? blendW(y, 1.07, 1.13, 'forearm' + sn, 'upperArm' + sn) : y > 0.865 ? [['forearm' + sn, 1]] : blendW(y, 0.845, 0.865, 'hand' + sn, 'forearm' + sn);
    const sleeve = (y) => y > o.sleeves && !o.tank;
    const ag = (f ? 0.88 : 1.0) * Math.sqrt(g);
    const rows = steps(1.41, 0.855, dy * 0.8).map((y) => {
      const [, r] = sample(A, y);
      const cov = sleeve(y);
      const mod = (a) => {
        let m = 1;
        m += (cov ? 0.04 : 0.09) * G(y - 1.37, 0.03) * G(angD(a, out), 0.7);
        m += (f ? 0.05 : 0.1) * G(y - 1.22, 0.045) * G(angD(a, FRONT), 0.6);
        m += 0.06 * G(y - 1.26, 0.05) * G(angD(a, BACK), 0.6);
        m += 0.08 * G(y - 1.01, 0.04) * G(angD(a, FRONT + (side > 0 ? -0.5 : 0.5)), 0.6);
        m += 0.07 * G(y - 1.105, 0.015) * G(angD(a, BACK), 0.25);
        if (cov) m = 1 + (m - 1) * 0.4;
        return m;
      };
      const flat = smoothstep(0.93, 0.86, y);
      return {
        y, cx: ax + side * (1.42 - y) * 0.02, cz: 0, rx: r * ag * (1 - flat * 0.25), rzF: r * ag * (1 + flat * 0.12), rzB: r * ag * 1.05 * (1 + flat * 0.12), mod,
        off: () => (cov ? (y < o.sleeves + 0.012 ? 0.008 : 0.004) * smoothstep(1.43, 1.36, y) : 0),
        w: armW, c: () => (cov ? shirt : skin), skin: () => !cov,
      };
    });
    b.rings(rows, LSEG, true);
    const hx = ax + side * 0.01;
    const Hp = [[0.855, 0.02, 0.031], [0.83, 0.022, 0.042], [0.8, 0.021, 0.046], [0.775, 0.018, 0.045], [0.762, 0.015, 0.042]];
    b.rings(Hp.map(([y, rx, rz]) => ({ y, cx: hx, cz: 0.004, rx, rzF: rz, rzB: rz, w: () => [['hand' + sn, 1]], c: () => skin, skin: () => true })), LSEG, false, true);
    const fz = [0.028, 0.009, -0.01, -0.028], fl = [0.072, 0.08, 0.075, 0.06], fr = [0.0088, 0.009, 0.0085, 0.0075];
    const inward = -side;
    const FSEG = Q >= 2 ? 8 : 6;
    for (let k = 0; k < 4; k++) {
      const pts = [[hx, 0.768, fz[k] + 0.004]];
      let ang = 0;
      const seg = [0.42, 0.33, 0.25];
      for (let j = 0; j < 3; j++) {
        ang += [0.18, 0.32, 0.26][j];
        const dir = [Math.sin(ang) * inward, -Math.cos(ang), 0.02 * (k - 1.5)];
        const l = fl[k] * seg[j];
        const p = pts[pts.length - 1];
        pts.push([p[0] + dir[0] * l * 0.5, p[1] + dir[1] * l * 0.5, p[2] + dir[2] * l * 0.5]);
        pts.push([p[0] + dir[0] * l, p[1] + dir[1] * l, p[2] + dir[2] * l]);
      }
      const radii = pts.map((_, i) => fr[k] * lerp(1, 0.72, i / (pts.length - 1)));
      b.path(pts, radii, FSEG, [['hand' + sn, 1]], skin, true, 0.85);
    }
    const p0 = [hx + inward * 0.008, 0.835, 0.034];
    const tpts = [p0, [p0[0] + inward * 0.012, p0[1] - 0.018, p0[2] + 0.016], [p0[0] + inward * 0.018, p0[1] - 0.038, p0[2] + 0.026], [p0[0] + inward * 0.022, p0[1] - 0.056, p0[2] + 0.03]];
    b.path(tpts, [0.012, 0.011, 0.0095, 0.008], FSEG, [['hand' + sn, 1]], skin, true);
  }
  return b.build();
}

// ---------------------------------------------------------------- Human
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
    beard: !female && rng.chance(0.3),
    freckles: tone < 2 && rng.chance(0.3),
    eye: rng.int(0, EYE_COLS.length - 1),
    variant: rng.int(0, 5),
  };
}

export class Human {
  constructor(look, quality = 2) {
    this.look = look;
    const S = shared();
    const skin = SKIN_TONES[look.tone];
    const geo = bodyGeometry({ ...look, skin }, quality);
    const bones = [];
    const byName = {};
    for (const [n, p, o] of BONES) {
      const b = new THREE.Bone(); b.name = n;
      b.position.set(o[0], o[1], o[2]);
      if (p) byName[p].add(b);
      bones.push(b); byName[n] = b;
    }
    this.bones = byName;
    const mesh = new THREE.SkinnedMesh(geo, [S.skinMat, S.clothMat]);
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.geometry = geo;
    const fkey = `${look.tone}-${look.female}-${look.variant}-${!!look.beard}-${!!look.freckles}`;
    if (!S.faceMats.has(fkey)) S.faceMats.set(fkey, new THREE.MeshPhysicalMaterial({
      map: faceTexture(look), normalMap: S.pores, normalScale: new THREE.Vector2(0.12, 0.12), roughness: 0.5,
      sheen: 0.12, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.6, 0.3, 0.25),
    }));
    const head = new THREE.Mesh(headGeometry(look.female), S.faceMats.get(fkey));
    head.position.set(0, 0.085, 0.012);
    head.castShadow = true;
    byName.head.add(head);
    this.headMesh = head;
    const eyeMat = eyeMaterial(look.eye ?? look.variant);
    const lidKey = 'lid' + look.tone;
    if (!S.faceMats.has(lidKey)) { const t = SKIN_TONES[look.tone]; S.faceMats.set(lidKey, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(t[0] * 0.86, t[1] * 0.8, t[2] * 0.78, THREE.SRGBColorSpace), roughness: 0.55 })); }
    const lidMat = S.faceMats.get(lidKey);
    for (const s of [1, -1]) {
      const eg = new THREE.SphereGeometry(EYE.r, 22, 16);
      eg.scale(1.05, 0.66, 1);
      const eye = new THREE.Mesh(eg, eyeMat);
      const zc = headSurfaceZ(s * EYE.x, EYE.y, look.female) - EYE.r + 0.0024;
      eye.position.set(s * EYE.x, EYE.y, zc);
      head.add(eye);
      // upper lid covers the top of the iris, lower lid the bottom edge
      const up = new THREE.SphereGeometry(EYE.r * 1.07, 22, 8, 0, TAU, 0, Math.PI * 0.4); up.scale(1.07, 0.7, 1.02); up.rotateX(0.2);
      const lo = new THREE.SphereGeometry(EYE.r * 1.06, 22, 6, 0, TAU, Math.PI * 0.8, Math.PI * 0.2); lo.scale(1.06, 0.68, 1.02);
      for (const lg of [up, lo]) { const lid = new THREE.Mesh(lg, lidMat); lid.position.copy(eye.position); head.add(lid); }
    }
    const hg = hairGeometry(look.hair, look.female);
    if (hg) {
      const key = look.hairCol.join(',');
      if (!S.hairMats.has(key)) {
        const hc = new THREE.Color().setRGB(look.hairCol[0], look.hairCol[1], look.hairCol[2], THREE.SRGBColorSpace);
        S.hairMats.set(key, {
          cards: new THREE.MeshStandardMaterial({ color: hc.clone().multiplyScalar(1.25), map: S.strands, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.42 }),
          cap: new THREE.MeshStandardMaterial({ color: hc.clone().multiplyScalar(0.85), roughness: 0.6 }),
        });
      }
      const hm = S.hairMats.get(key);
      const cap = new THREE.Mesh(hg.cap, hm.cap); cap.castShadow = true; head.add(cap);
      if (hg.cards) { const cards = new THREE.Mesh(hg.cards, hm.cards); cards.castShadow = true; head.add(cards); }
    }
    const sc = look.height / 1.75;
    this.root = new THREE.Group();
    this.root.add(mesh);
    mesh.scale.setScalar(sc);
    this.scale = sc;
  }
  dispose() { this.geometry.dispose(); }
}
