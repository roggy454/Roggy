// Procedural car models. Bodies are lofted from cross-sections (real wheel arches, tumblehome,
// sloped glass), then detailed: projector headlights with LED rows and an L-shaped DRL, wrap-around
// tail lights with LED bars, reverse lights and a third brake light, grille with bars both ways,
// mirrors with repeaters, door shut lines, handles, wipers, plates, exhausts and type extras.
// All static parts merge into ONE draw call per car; paint colour and lights are uniforms.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './utils.js';

// ---------- vehicle types ----------
export const CAR_TYPES = {
  sedan: {
    L: 4.75, W: 1.84, R: 0.335, tw: 0.235, track: 1.58, wb: 2.82, axleOff: 0.05, yb: 0.27, doors: 4, chromeBelt: true,
    top: [[-2.375, 0.78], [-2.3, 0.93], [-2.0, 1.0], [-1.45, 1.01], [0.0, 0.99], [0.75, 0.98], [1.6, 0.93], [2.25, 0.84], [2.375, 0.72]],
    gh: { ws: 0.72, rf: -0.12, rr: -0.95, rb: -1.55, roof: 1.44, tumble: 0.2, crown: 0.045 },
    side: [[-9, -1.22, 'paint'], [-1.22, -0.47, 'glass'], [-0.47, -0.37, 'black'], [-0.37, 9, 'glass']],
    shut: [0.7, -0.42, -1.2], handles: [-0.3, -1.1], mass: 1450, power: 1.0, fin: true,
  },
  hatch: {
    L: 4.1, W: 1.78, R: 0.31, tw: 0.21, track: 1.53, wb: 2.6, axleOff: 0.05, yb: 0.26, doors: 4,
    top: [[-2.05, 0.82], [-2.0, 0.98], [-1.85, 1.02], [0, 0.99], [0.65, 0.97], [1.5, 0.9], [1.95, 0.8], [2.05, 0.7]],
    gh: { ws: 0.68, rf: -0.1, rr: -1.55, rb: -1.9, roof: 1.47, tumble: 0.18, crown: 0.04 },
    side: [[-9, -1.35, 'paint'], [-1.35, -0.5, 'glass'], [-0.5, -0.4, 'black'], [-0.4, 9, 'glass']],
    shut: [0.66, -0.45, -1.3], handles: [-0.33, -1.15], mass: 1200, power: 0.75, rearWiper: true, fin: true,
  },
  suv: {
    L: 4.8, W: 1.94, R: 0.38, tw: 0.255, track: 1.65, wb: 2.86, axleOff: 0.05, yb: 0.42, doors: 4,
    top: [[-2.4, 1.0], [-2.35, 1.16], [-2.2, 1.21], [0, 1.19], [0.9, 1.18], [1.7, 1.13], [2.3, 1.05], [2.4, 0.93]],
    gh: { ws: 0.85, rf: 0.15, rr: -2.08, rb: -2.33, roof: 1.84, tumble: 0.13, crown: 0.04 },
    side: [[-9, -1.85, 'paint'], [-1.85, -1.42, 'glass'], [-1.42, -1.32, 'black'], [-1.32, -0.42, 'glass'], [-0.42, -0.32, 'black'], [-0.32, 9, 'glass']],
    shut: [0.83, -0.37, -1.37], handles: [-0.25, -1.25], mass: 1950, power: 1.15, roofRails: true, rearWiper: true, hitch: true, cladding: true, fin: true,
  },
  sports: {
    L: 4.5, W: 1.92, R: 0.345, tw: 0.27, track: 1.64, wb: 2.65, axleOff: -0.05, yb: 0.2, doors: 2,
    top: [[-2.25, 0.7], [-2.15, 0.88], [-1.8, 0.92], [-1.0, 0.9], [0, 0.86], [0.5, 0.84], [1.5, 0.74], [2.1, 0.62], [2.25, 0.52]],
    gh: { ws: 0.55, rf: -0.45, rr: -0.95, rb: -1.9, roof: 1.28, tumble: 0.24, crown: 0.035 },
    side: [[-9, -1.15, 'paint'], [-1.15, 9, 'glass']],
    shut: [0.5, -1.05], handles: [-0.85], mass: 1380, power: 1.9, sporty: true, redCaliper: true,
  },
  taxi: null, // sedan variant (filled below)
  van: {
    L: 5.3, W: 2.0, R: 0.36, tw: 0.235, track: 1.7, wb: 3.4, axleOff: 0.2, yb: 0.33, doors: 2,
    top: [[-2.65, 0.85], [-2.6, 1.05], [-2.5, 1.1], [1.5, 1.1], [2.0, 1.05], [2.5, 0.95], [2.65, 0.82]],
    gh: { ws: 1.85, rf: 1.15, rr: -2.55, rb: -2.63, roof: 2.28, tumble: 0.06, crown: 0.05 },
    side: [[-9, 0.62, 'paint'], [0.62, 9, 'glass']],
    shut: [1.82, 0.55, -0.4], handles: [0.65], mass: 2300, power: 0.9, whip: true, vanRear: true,
  },
  pickup: {
    L: 5.4, W: 1.98, R: 0.39, tw: 0.26, track: 1.68, wb: 3.3, axleOff: 0.0, yb: 0.4, doors: 2,
    top: [[-2.7, 0.95], [-2.65, 1.12], [-2.5, 1.15], [0.6, 1.14], [1.4, 1.12], [2.3, 1.05], [2.7, 0.92]],
    gh: { ws: 1.1, rf: 0.4, rr: -0.55, rb: -0.66, roof: 1.86, tumble: 0.14, crown: 0.04 },
    side: [[-9, -0.45, 'paint'], [-0.45, 9, 'glass']],
    shut: [1.08, -0.6], handles: [-0.35], mass: 2100, power: 1.2, bed: -0.7, whip: true, hitch: true, chromeBelt: true, cladding: true,
  },
};
CAR_TYPES.taxi = { ...CAR_TYPES.sedan, taxi: true, fin: false };

export const PAINTS = [
  0xe8e8e6, 0xf4f4f2, 0x111214, 0x1c1d20, 0x9ea3a8, 0x6d7278, 0x3b4048, 0x7a0f12, 0xa31d1d,
  0x14284f, 0x2a4d7a, 0x1f3a2e, 0x4a5a3a, 0xb8a888, 0x5c3a24, 0xd0862a, 0x2f6f7a,
];

// ---------- material ----------
// Physical material whose metalness/roughness/clearcoat come from vertex attributes and whose
// emissive comes from light "channels". Every car clones it to get its own paint + light uniforms.
const baseCarMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0,
});
baseCarMaterial.onBeforeCompile = function (sh) {
  const u = this.userData;
  sh.uniforms.uPaint = u.uPaint; sh.uniforms.uPaintMR = u.uPaintMR;
  sh.uniforms.uLights = u.uLights; sh.uniforms.uInd = u.uInd;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec3 mrc; attribute float paint; attribute float emi;
      varying vec3 vMRC; varying float vPaint; varying float vEmi;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vMRC = mrc; vPaint = paint; vEmi = emi;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform vec3 uPaint; uniform vec2 uPaintMR; uniform vec4 uLights; uniform vec3 uInd;
      varying vec3 vMRC; varying float vPaint; varying float vEmi;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, uPaint, vPaint);`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(vMRC.y, uPaintMR.y, vPaint);')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(vMRC.x, uPaintMR.x, vPaint);')
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      material.clearcoat = vMRC.z;`)
    .replace('#include <emissivemap_fragment>', `
      float ch = floor(vEmi + 0.5);
      float ei = 0.0;
      if (ch == 1.0) ei = uLights.x * 5.0;
      else if (ch == 2.0) ei = uLights.y * 0.9 + uLights.z * 2.2;
      else if (ch == 3.0) ei = uLights.z * 4.0;
      else if (ch == 4.0) ei = uInd.x * 4.0;
      else if (ch == 5.0) ei = uInd.y * 4.0;
      else if (ch == 6.0) ei = uLights.w * 3.0;
      else if (ch == 7.0) ei = uInd.z * 2.2 + uLights.x * 1.5;
      else if (ch == 9.0) ei = uLights.y * 1.3 + uLights.z * 3.2;
      else if (ch == 8.0) ei = uInd.z * 1.4;
      totalEmissiveRadiance += diffuseColor.rgb * ei;
    `);
};
baseCarMaterial.customProgramCacheKey = () => 'car-body-v2';

export function makeCarMaterial(paintHex, metallic = true) {
  const m = baseCarMaterial.clone();
  m.onBeforeCompile = baseCarMaterial.onBeforeCompile;
  m.customProgramCacheKey = baseCarMaterial.customProgramCacheKey;
  const c = new THREE.Color(paintHex);
  m.userData = {
    uPaint: { value: new THREE.Vector3(c.r, c.g, c.b) },
    uPaintMR: { value: new THREE.Vector2(metallic ? 0.55 : 0.05, metallic ? 0.32 : 0.42) },
    uLights: { value: new THREE.Vector4(0, 0, 0, 0) },
    uInd: { value: new THREE.Vector3(0, 0, 1) },
  };
  return m;
}

// ---------- part specs ----------
const S = {
  paint: { color: [1, 1, 1], mr: [0.5, 0.3], cc: 1, paint: 1 },
  glass: { color: [0.006, 0.008, 0.011], mr: [0.0, 0.04], cc: 0.55, glass: true },
  black: { color: [0.025, 0.025, 0.027], mr: [0.0, 0.55], cc: 0.3 },
  gloss: { color: [0.01, 0.01, 0.012], mr: [0.0, 0.2], cc: 1 },
  plastic: { color: [0.05, 0.05, 0.052], mr: [0.0, 0.75], cc: 0 },
  under: { color: [0.02, 0.02, 0.02], mr: [0.0, 0.95], cc: 0 },
  chrome: { color: [0.92, 0.92, 0.94], mr: [1.0, 0.08], cc: 0 },
  alu: { color: [0.7, 0.71, 0.73], mr: [1.0, 0.3], cc: 0 },
  housing: { color: [0.06, 0.065, 0.07], mr: [0.4, 0.35], cc: 0.5 },
  rubber: { color: [0.018, 0.018, 0.018], mr: [0.0, 0.9], cc: 0 },
  head: { color: [0.92, 0.95, 1.0], mr: [0.0, 0.1], cc: 1, emi: 1 },
  drl: { color: [0.95, 0.97, 1.0], mr: [0.0, 0.1], cc: 1, emi: 7 },
  tail: { color: [0.42, 0.015, 0.02], mr: [0.0, 0.08], cc: 1, emi: 2 },
  tailLed: { color: [0.9, 0.05, 0.04], mr: [0.0, 0.15], cc: 1, emi: 9 },
  brake3: { color: [0.6, 0.02, 0.02], mr: [0.0, 0.1], cc: 1, emi: 3 },
  indL: { color: [0.95, 0.45, 0.03], mr: [0.0, 0.1], cc: 1, emi: 4 },
  indR: { color: [0.95, 0.45, 0.03], mr: [0.0, 0.1], cc: 1, emi: 5 },
  rev: { color: [0.85, 0.85, 0.85], mr: [0.0, 0.08], cc: 1, emi: 6 },
  reflector: { color: [0.45, 0.02, 0.02], mr: [0.0, 0.3], cc: 0.5 },
  amberMark: { color: [0.75, 0.35, 0.02], mr: [0.0, 0.2], cc: 0.5 },
  mirrorGlass: { color: [0.25, 0.27, 0.3], mr: [1.0, 0.02], cc: 0 },
  exhaust: { color: [0.004, 0.004, 0.004], mr: [0.0, 1.0], cc: 0 },
  // interior
  carpet: { color: [0.028, 0.028, 0.03], mr: [0.0, 0.95], cc: 0 },
  dash: { color: [0.032, 0.032, 0.035], mr: [0.0, 0.55], cc: 0.15 },
  trim: { color: [0.055, 0.055, 0.06], mr: [0.0, 0.7], cc: 0 },
  headliner: { color: [0.34, 0.32, 0.3], mr: [0.0, 0.95], cc: 0 },
  screen: { color: [0.012, 0.03, 0.065], mr: [0.0, 0.1], cc: 1, emi: 8 },
  gauge: { color: [0.11, 0.11, 0.12], mr: [0.0, 0.2], cc: 1, emi: 8 },
  seatFrame: { color: [0.02, 0.02, 0.02], mr: [0.3, 0.6], cc: 0 },
};
// seat upholstery per vehicle type (linear colours)
const SEATS = {
  sedan: { color: [0.3, 0.23, 0.16], mr: [0, 0.5], cc: 0.2 },
  taxi: { color: [0.03, 0.03, 0.032], mr: [0, 0.45], cc: 0.2 },
  hatch: { color: [0.09, 0.09, 0.1], mr: [0, 0.9], cc: 0 },
  suv: { color: [0.1, 0.055, 0.03], mr: [0, 0.45], cc: 0.2 },
  sports: { color: [0.28, 0.02, 0.02], mr: [0, 0.45], cc: 0.2 },
  van: { color: [0.07, 0.07, 0.075], mr: [0, 0.9], cc: 0 },
  pickup: { color: [0.2, 0.14, 0.09], mr: [0, 0.6], cc: 0.1 },
};

class PartList {
  constructor() { this.geos = []; this.glassGeos = []; }
  add(geo, spec) {
    const g = geo.index ? geo : geo; // keep indexed
    if (!g.index) {
      const n = g.attributes.position.count; const idx = [];
      for (let i = 0; i < n; i++) idx.push(i);
      g.setIndex(idx);
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), mrc = new Float32Array(n * 3), pt = new Float32Array(n), em = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[i * 3] = spec.color[0]; col[i * 3 + 1] = spec.color[1]; col[i * 3 + 2] = spec.color[2];
      mrc[i * 3] = spec.mr[0]; mrc[i * 3 + 1] = spec.mr[1]; mrc[i * 3 + 2] = spec.cc ?? 0;
      pt[i] = spec.paint || 0; em[i] = spec.emi || 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('mrc', new THREE.BufferAttribute(mrc, 3));
    g.setAttribute('paint', new THREE.BufferAttribute(pt, 1));
    g.setAttribute('emi', new THREE.BufferAttribute(em, 1));
    (spec.glass ? this.glassGeos : this.geos).push(g);
  }
  // Box centred at (x,y,z) with size, rotation (Euler XYZ) — mirrored copy if mirror=true at -x.
  box(x, y, z, sx, sy, sz, spec, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
    g.translate(x, y, z);
    this.add(g, spec);
  }
  cyl(x, y, z, r, len, axis, spec, segs = 12, r2 = null) {
    const g = new THREE.CylinderGeometry(r2 ?? r, r, len, segs);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.add(g, spec);
  }
  merge() {
    const m = mergeGeometries(this.geos, false);
    m.computeBoundingSphere();
    return m;
  }
  mergeGlass() {
    const m = mergeGeometries(this.glassGeos, false);
    m.computeBoundingSphere();
    return m;
  }
}

// A box whose faces point inwards (for cabin walls seen through the windows).
function invertedBox(x0, x1, y0, y1, z0, z1, skip = []) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const idx = g.index.array, out = [];
  for (let f = 0; f < 6; f++) {
    if (skip.includes(names[f])) continue;
    for (let t = 0; t < 2; t++) { const b = f * 6 + t * 3; out.push(idx[b], idx[b + 2], idx[b + 1]); }
  }
  g.setIndex(out);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

// ---------- profile helpers ----------
function interp(pts, z) {
  if (z <= pts[0][0]) return pts[0][1];
  if (z >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  let i = 0;
  while (z > pts[i + 1][0]) i++;
  const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
  const t = (z - z0) / (z1 - z0);
  const m0 = i > 0 ? (y1 - pts[i - 1][1]) / (z1 - pts[i - 1][0]) : (y1 - y0) / (z1 - z0);
  const m1 = i < pts.length - 2 ? (pts[i + 2][1] - y0) / (pts[i + 2][0] - z0) : (y1 - y0) / (z1 - z0);
  const dz = z1 - z0, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * dz * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * dz * m1;
}

function makeProfile(T) {
  const zf = T.L / 2, zr = -T.L / 2;
  const zFa = T.wb / 2 + T.axleOff, zRa = -T.wb / 2 + T.axleOff;
  const ra = T.R + 0.06, cy = T.R + 0.03;
  const endE = (z) => {
    const ef = clamp((z - (zf - 0.32)) / 0.32, 0, 1), er = clamp(((zr + 0.28) - z) / 0.28, 0, 1);
    return Math.max(ef, er);
  };
  const hw = (z) => {
    const e = endE(z);
    const mid = 1 - 0.02 * Math.pow(Math.abs(z) / zf, 2);
    return (T.W / 2) * mid * (1 - 0.075 * Math.pow(e, 2.2));
  };
  const yt = (z) => interp(T.top, z) - 0.035 * Math.pow(endE(z), 2);
  const yb = (z) => {
    let b = T.yb + 0.05 * Math.pow(endE(z), 2);
    for (const a of [zFa, zRa]) {
      const dz = z - a;
      if (Math.abs(dz) < ra) b = Math.max(b, cy + Math.sqrt(ra * ra - dz * dz));
    }
    return b;
  };
  // right-hand ring (x >= 0), bottom centre -> top centre
  const ring = (z) => {
    const w = hw(z), b = yb(z), t = yt(z);
    const m = b + (t - b) * 0.42;
    return [
      [0, b], [w - 0.08, b], [w - 0.018, b + 0.04], [w, Math.min(m, t - 0.12)],
      [w - 0.022, t - 0.07], [w - 0.07, t - 0.006], [w - 0.2, t + 0.012], [w * 0.5, t + 0.035], [0, t + 0.04],
    ].map(([x, y]) => [x, y, z]);
  };
  const sideX = (z, y) => {
    const r = ring(z);
    for (let k = 1; k < 5; k++) {
      if (y >= r[k][1] && y <= r[k + 1][1]) {
        const t = (y - r[k][1]) / Math.max(1e-6, r[k + 1][1] - r[k][1]);
        return r[k][0] + (r[k + 1][0] - r[k][0]) * t;
      }
    }
    return hw(z);
  };
  const g = T.gh;
  const roofY = (z) => {
    if (z >= g.rf) { const t = (z - g.rf) / (g.ws - g.rf); return g.roof + (yt(g.ws) - g.roof) * Math.pow(t, 1.15); }
    if (z >= g.rr) { const t = (z - g.rr) / (g.rf - g.rr); return g.roof - 0.015 * Math.pow(2 * t - 1, 2) + 0.0; }
    const t = (g.rr - z) / (g.rr - g.rb); return g.roof + (yt(g.rb) - g.roof) * Math.pow(t, 1.1);
  };
  const ghRing = (z) => {
    const base = yt(z) - 0.012;
    const r = roofY(z);
    const span = Math.max(0, r - base);
    const w0 = hw(z) - 0.09, w1 = w0 - g.tumble * clamp(span / 0.4, 0, 1);
    const cr = g.crown * clamp(span / 0.3, 0, 1);
    const gt = Math.max(base, r - 0.065);
    return [
      [w0, base], [w1 + (w0 - w1) * 0.06, gt], [w1, r], [w1 * 0.55, r + cr * 0.8], [0, r + cr],
    ].map(([x, y]) => [x, y, z]);
  };
  return { zf, zr, zFa, zRa, hw, yt, yb, ring, sideX, roofY, ghRing };
}

function rangeStations(a, b, step) {
  const n = Math.max(1, Math.ceil((b - a) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * (i / n));
  return out;
}

// Build a lofted strip from rings (each ring = array of [x,y,z]) using points k0..k1, mirrored.
// inner = true builds the same strip facing inwards, slightly inset (headliner, inside of pillars).
function loftStrip(rings, k0, k1, parts, spec, inner = false) {
  const pos = [], idx = [];
  const nk = k1 - k0 + 1, ns = rings.length;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let s = 0; s < ns; s++) for (let k = k0; k <= k1; k++) {
      const p = rings[s][k];
      if (inner) pos.push(p[0] * side * 0.975, p[1] - 0.012, p[2]);
      else pos.push(p[0] * side, p[1], p[2]);
    }
    for (let s = 0; s < ns - 1; s++) for (let k = 0; k < nk - 1; k++) {
      const A = base + s * nk + k, B = base + (s + 1) * nk + k, C = B + 1, D = A + 1;
      if ((side === 1) !== inner) idx.push(A, D, C, A, C, B); else idx.push(A, C, D, A, B, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  parts.add(g, spec);
}

function capRing(ring, front, parts, spec) {
  const pts = ring;
  let cx = 0, cy = 0;
  for (const p of pts) cy += p[1];
  cy /= pts.length;
  const z = pts[0][2];
  const pos = [cx, cy, z];
  for (const p of pts) pos.push(p[0], p[1], p[2]);
  for (const p of pts) pos.push(-p[0], p[1], p[2]);
  const n = pts.length, idx = [];
  for (let k = 0; k < n - 1; k++) {
    const a = 1 + k, b = 2 + k, la = 1 + n + k, lb = 2 + n + k;
    if (front) idx.push(0, a, b, 0, lb, la); else idx.push(0, b, a, 0, la, lb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  parts.add(g, spec);
}

// Thin strip hugging the side surface (shut lines, seals) from (z, y0) to (z, y1)
function sideLine(P, parts, z, y0, y1, spec, width = 0.007, out = 0.0025) {
  const n = 6, pos = [], idx = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const y = y0 + (y1 - y0) * (i / n);
      const x = P.sideX(z, y) + out;
      pos.push(x * side, y, z - width / 2, x * side, y, z + width / 2);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      if (side === 1) idx.push(a, a + 1, a + 3, a, a + 3, a + 2); else idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  parts.add(g, spec);
}

// Horizontal strip hugging the side at height y between z0..z1
function sideHLine(P, parts, z0, z1, y, h, spec, out = 0.003) {
  const n = Math.max(2, Math.ceil((z1 - z0) / 0.1)), pos = [], idx = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const z = z0 + (z1 - z0) * (i / n);
      const xa = P.sideX(z, y - h / 2) + out, xb = P.sideX(z, y + h / 2) + out;
      pos.push(xa * side, y - h / 2, z, xb * side, y + h / 2, z);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      if (side === 1) idx.push(a, a + 2, a + 3, a, a + 3, a + 1); else idx.push(a, a + 3, a + 2, a, a + 1, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  parts.add(g, spec);
}

// ---------- interior ----------
// Cabin tub, dashboard with gauges and a screen, steering column, seats, console and door
// panels. Returns where the driver sits and where the steering wheel goes.
function addInterior(typeName, T, P, parts) {
  const g = T.gh;
  const seat = SEATS[typeName] || SEATS.sedan;
  const floorY = T.yb + (T.sporty ? 0.02 : 0.07);
  const zFw = g.ws - 0.02;
  const zDashBack = g.ws - (T.vanRear ? 0.55 : 0.5);
  const tilt = T.vanRear ? 0.62 : 0.42;
  const wheelZ = zDashBack - 0.13;
  const hipZ = wheelZ - 0.56;
  const rearSeatZ = hipZ - 0.88;
  const zRear = T.vanRear ? g.rb + 0.08 : Math.max(g.rb + 0.04, P.zr + 0.12);
  const wI = Math.min(P.hw(hipZ), P.hw(zDashBack)) - 0.1;
  const beltMin = Math.min(P.yt(hipZ), P.yt(zDashBack), P.yt(Math.max(zRear, hipZ - 1.2))) - 0.035;
  const roofHead = P.roofY(hipZ - 0.1);
  const seatH = Math.max(floorY + 0.14, Math.min(beltMin - 0.38, roofHead - 0.95));
  const maxScale = Math.min(1.06, (roofHead - 0.05 - seatH) / 0.91);
  const dX = wI * 0.47;
  const wheelY = seatH + (T.sporty ? 0.36 : 0.4);
  // tub: door panels, firewall, rear wall and carpet
  parts.add(invertedBox(-wI, wI, floorY - 0.02, beltMin, zRear, zFw, ['py', 'ny']), S.trim);
  const fl = new THREE.PlaneGeometry(wI * 2, zFw - zRear);
  fl.rotateX(-Math.PI / 2); fl.translate(0, floorY, (zFw + zRear) / 2);
  parts.add(fl, S.carpet);
  // dashboard: upper dash, recessed lower dash, instrument binnacle, gauges, screen, vents
  const dashTop = P.yt(g.ws) - 0.015;
  parts.box(0, dashTop - 0.11, (zDashBack + zFw) / 2, wI * 2, 0.22, zFw - zDashBack, S.dash);
  const lowH = dashTop - 0.22 - (floorY + 0.18);
  if (lowH > 0.05) parts.box(0, floorY + 0.18 + lowH / 2, (zDashBack + 0.15 + zFw) / 2, wI * 2, lowH, zFw - zDashBack - 0.15, S.dash);
  parts.box(dX, dashTop + 0.02, zDashBack + 0.1, 0.36, 0.07, 0.22, S.dash);
  for (const o of [-0.075, 0.075]) parts.cyl(dX + o, dashTop - 0.035, zDashBack - 0.004, 0.052, 0.01, 'z', S.gauge, 18);
  parts.box(0, dashTop - 0.09, zDashBack - 0.012, 0.26, 0.15, 0.02, S.screen);
  for (const vx of [-(wI - 0.16), -0.2, 0.2, wI - 0.16]) parts.box(vx, dashTop - 0.06, zDashBack - 0.006, 0.13, 0.045, 0.015, S.gloss);
  // steering column along the wheel axis
  {
    const col = new THREE.CylinderGeometry(0.03, 0.04, 0.26, 10);
    col.rotateX(Math.PI / 2 + tilt);
    col.translate(dX, wheelY - Math.sin(tilt) * 0.14, wheelZ + Math.cos(tilt) * 0.14);
    parts.add(col, S.dash);
  }
  // front seats
  for (const x of [dX, -dX]) {
    parts.box(x, seatH - 0.06, hipZ + 0.18, 0.5, 0.12, 0.5, seat);
    if (seatH - 0.12 - floorY > 0.03) parts.box(x, (floorY + seatH - 0.12) / 2, hipZ + 0.18, 0.4, seatH - 0.12 - floorY, 0.4, S.seatFrame);
    parts.box(x, seatH + 0.3, hipZ - 0.15, 0.5, 0.64, 0.11, seat, -0.22);
    parts.box(x, seatH + 0.7, hipZ - 0.24, 0.26, 0.18, 0.1, seat, -0.22);
    parts.box(x > 0 ? wI - 0.035 : -(wI - 0.035), seatH + 0.14, hipZ + 0.15, 0.07, 0.05, 0.55, S.dash);
  }
  // centre console + gear lever
  const conLen = zDashBack - (hipZ - 0.15);
  parts.box(0, (floorY + seatH + 0.05) / 2, hipZ - 0.15 + conLen / 2, 0.2, seatH + 0.05 - floorY, conLen, S.dash);
  parts.cyl(0, seatH + 0.12, hipZ + 0.38, 0.011, 0.15, 'y', S.chrome, 8);
  parts.add(new THREE.SphereGeometry(0.03, 10, 8).translate(0, seatH + 0.2, hipZ + 0.38), S.gloss);
  // ---------- the back of the cabin ----------
  const sp = (c, r = 0.85, m = 0, cc = 0) => ({ color: c, mr: [m, r], cc });
  const card = sp([0.3, 0.2, 0.1], 0.95), tape = sp([0.45, 0.38, 0.22], 0.6), wood = sp([0.2, 0.12, 0.055], 0.8);
  const rack = sp([0.32, 0.33, 0.35], 0.4, 0.85), duffel = sp([0.05, 0.07, 0.04], 0.9), suitcase = sp([0.03, 0.045, 0.1], 0.45, 0, 0.3);
  const shelfY = beltMin - 0.015;
  const box = (...a) => parts.box(...a);
  const crate = (x, y, z, w, h, d, ry = 0) => {
    box(x, y + h / 2, z, w, h, d, card, 0, ry);
    box(x, y + h + 0.002, z, w * 0.98, 0.004, 0.06, tape, 0, ry);
  };
  const seatPockets = () => { for (const x of [dX, -dX]) box(x, seatH + 0.2, hipZ - 0.225, 0.38, 0.3, 0.02, S.trim, -0.22); };
  const parcelShelf = (z0, z1) => {
    if (z1 - z0 < 0.08) return;
    const zc = (z0 + z1) / 2;
    box(0, shelfY, zc, wI * 2, 0.025, z1 - z0, S.trim);
    for (const sx of [1, -1]) {
      parts.cyl(sx * (wI - 0.28), shelfY + 0.016, zc, 0.07, 0.008, 'y', S.gloss, 18);
      parts.cyl(sx * (wI - 0.28), shelfY + 0.02, zc, 0.024, 0.006, 'y', S.chrome, 12);
    }
  };
  if (T.vanRear) {
    // work van: steel partition behind the seats, plank floor, shelving on both sides, boxes
    const pz = hipZ - 0.42;
    // the van's upper walls lean in, so keep everything above the belt well inside them
    box(0, (floorY + g.roof - 0.08) / 2, pz, (wI - 0.1) * 2, g.roof - 0.08 - floorY, 0.03, rack);
    const c0 = zRear + 0.04, c1 = pz - 0.04, cm = (c0 + c1) / 2, cl = c1 - c0;
    box(0, floorY + 0.012, cm, wI * 2 - 0.02, 0.024, cl, wood);
    for (let x = -wI + 0.16; x < wI - 0.05; x += 0.24) box(x, floorY + 0.026, cm, 0.025, 0.006, cl, sp([0.1, 0.06, 0.03], 0.8));
    for (const sx of [1, -1]) {
      const rx = sx * (wI - 0.3);
      for (const y of [floorY + 0.38, floorY + 0.82, floorY + 1.26]) box(rx, y, cm, 0.32, 0.025, cl - 0.2, rack);
      for (let k = 0; k < 4; k++) box(rx + sx * 0.15, floorY + 0.68, c0 + 0.12 + k * (cl - 0.24) / 3, 0.03, 1.32, 0.03, rack);
      crate(rx, floorY + 0.395, c0 + 0.45, 0.26, 0.24, 0.34, 0.08 * sx);
      crate(rx, floorY + 0.395, c0 + 0.9, 0.27, 0.3, 0.38, -0.05);
      crate(rx, floorY + 0.835, c1 - 0.55, 0.26, 0.28, 0.4, 0.1);
      parts.cyl(rx, floorY + 1.4, c0 + 0.7, 0.09, 0.26, 'y', sp([0.55, 0.12, 0.05], 0.5, 0, 0.4), 14);
    }
    crate(0.12, floorY + 0.025, c0 + 0.55, 0.5, 0.36, 0.45, 0.25);
    crate(-0.08, floorY + 0.385, c0 + 0.6, 0.38, 0.26, 0.34, -0.2);
  } else if (T.bed) {
    // pickup cab: storage shelf behind the seats with a folded jacket
    seatPockets();
    parcelShelf(zRear, hipZ - 0.3);
    box(-0.2, shelfY + 0.05, (zRear + hipZ - 0.3) / 2, 0.42, 0.08, 0.2, sp([0.18, 0.1, 0.05], 0.8), 0, 0.2);
  } else if (T.sporty) {
    // 2+2: small, steeply reclined rear seats under the rear glass and a parcel deck behind them
    const rz = hipZ - 0.72;
    for (const x of [dX * 0.95, -dX * 0.95]) {
      box(x, floorY + 0.19, rz + 0.12, 0.42, 0.1, 0.4, seat);
      box(x, floorY + 0.43, rz - 0.13, 0.42, 0.44, 0.09, seat, -0.5);
      box(x, floorY + 0.65, rz - 0.26, 0.22, 0.13, 0.08, seat, -0.5);
    }
    box(0, floorY + 0.14, rz, 0.24, 0.22, 0.5, S.dash);
    seatPockets();
    parcelShelf(zRear, rz - 0.36);
    // a sports bag on the parcel deck
    if (rz - 0.36 - zRear > 0.12) {
      const bag = new THREE.CapsuleGeometry(0.09, 0.3, 4, 10);
      bag.rotateZ(Math.PI / 2); bag.translate(0.15, shelfY + 0.1, (zRear + rz - 0.36) / 2);
      parts.add(bag, duffel);
    }
  } else if (rearSeatZ - 0.35 > zRear) {
    // rear bench with fold-down armrest, door armrests and map pockets on the front seat backs
    parts.box(0, seatH - 0.08, rearSeatZ + 0.16, wI * 2 - 0.12, 0.13, 0.48, seat);
    parts.box(0, (floorY + seatH - 0.14) / 2, rearSeatZ + 0.16, wI * 2 - 0.2, Math.max(0.02, seatH - 0.14 - floorY), 0.4, S.seatFrame);
    parts.box(0, seatH + 0.26, rearSeatZ - 0.13, wI * 2 - 0.12, 0.56, 0.11, seat, -0.2);
    for (const x of [dX, -dX]) parts.box(x, seatH + 0.62, rearSeatZ - 0.2, 0.24, 0.15, 0.09, seat, -0.2);
    box(0, seatH + 0.08, rearSeatZ + 0.06, 0.22, 0.07, 0.36, seat);
    for (const sx of [1, -1]) box(sx * (wI - 0.035), seatH + 0.12, rearSeatZ + 0.08, 0.07, 0.05, 0.42, S.dash);
    seatPockets();
    const backZ = rearSeatZ - 0.26;
    if (typeName === 'suv' && backZ - zRear > 0.4) {
      // cargo bay: mat, side trims, a suitcase and a duffel bag
      const cm = (zRear + backZ) / 2;
      box(0, floorY + 0.012, cm, wI * 2 - 0.02, 0.024, backZ - zRear, sp([0.035, 0.035, 0.038], 0.95));
      for (const sx of [1, -1]) box(sx * (wI - 0.06), floorY + 0.2, cm, 0.12, 0.36, backZ - zRear - 0.05, S.trim);
      box(0.22, floorY + 0.15, cm + 0.02, 0.62, 0.25, 0.44, suitcase, 0, 0.1);
      box(0.22, floorY + 0.29, cm + 0.02, 0.18, 0.03, 0.04, S.gloss, 0, 0.1);
      const bag = new THREE.CapsuleGeometry(0.13, 0.34, 4, 12);
      bag.rotateZ(Math.PI / 2); bag.rotateY(0.3); bag.translate(-0.28, floorY + 0.15, cm - 0.05);
      parts.add(bag, duffel);
    } else {
      // hatch / sedan: parcel shelf (cargo cover) behind the rear seats
      parcelShelf(zRear, backZ);
    }
  }
  return { driverX: dX, seatH, hipZ, maxScale, wheel: { x: dX, y: wheelY, z: wheelZ, tilt, r: 0.185 } };
}

function addPickupBed(T, P, parts) {
  const liner = { color: [0.022, 0.022, 0.024], mr: [0, 0.92], cc: 0 };
  const z1 = T.bed - 0.03, z0 = P.zr + 0.07;
  const top = P.yt((z0 + z1) / 2) - 0.012;
  const wB = Math.min(P.hw(z1), P.hw(z0 + 0.25)) - 0.2;
  const bedY = top - 0.5;
  parts.add(invertedBox(-wB, wB, bedY, top, z0, z1, ['py', 'ny']), liner);
  const fl = new THREE.PlaneGeometry(wB * 2, z1 - z0);
  fl.rotateX(-Math.PI / 2); fl.translate(0, bedY, (z0 + z1) / 2);
  parts.add(fl, liner);
  for (let x = -wB + 0.12; x < wB - 0.05; x += 0.18) parts.box(x, bedY + 0.008, (z0 + z1) / 2, 0.05, 0.016, z1 - z0 - 0.04, liner);
  // wheel wells
  for (const sx of [1, -1]) parts.box(sx * (wB - 0.12), bedY + 0.16, P.zRa, 0.24, 0.32, 0.95, liner);
  // close the gap between the cab and the bed
  parts.box(0, top - 0.005, (T.bed - 0.04 + T.gh.rb + 0.06) / 2, (P.hw(T.bed) - 0.07) * 2, 0.03, T.gh.rb + 0.06 - (T.bed - 0.04), S.paint);
  // cross-bed toolbox resting on the rails
  parts.box(0, top + 0.12, z1 - 0.21, wB * 2 + 0.26, 0.3, 0.36, { color: [0.62, 0.63, 0.65], mr: [1, 0.32], cc: 0 });
  parts.box(0, top + 0.27, z1 - 0.21, wB * 2 + 0.2, 0.012, 0.3, { color: [0.5, 0.51, 0.53], mr: [1, 0.4], cc: 0 });
  // cargo: wooden crates and a spare tyre
  const wood = { color: [0.24, 0.15, 0.07], mr: [0, 0.8], cc: 0 };
  parts.box(-0.25, bedY + 0.18, z0 + 0.45, 0.5, 0.36, 0.45, wood, 0, 0.15);
  parts.box(0.3, bedY + 0.14, z0 + 0.95, 0.42, 0.28, 0.42, wood, 0, -0.2);
  const tyre = new THREE.TorusGeometry(0.28, 0.1, 10, 22);
  tyre.rotateX(Math.PI / 2); tyre.translate(0.2, bedY + 0.1, z1 - 0.75);
  parts.add(tyre, S.rubber);
}

// Steering wheel (rim, hub, three spokes, badge) built in its own frame: rim in the XY plane,
// +Z towards the driver. Instanced for all cars and rotated with the steering.
export function buildSteeringWheelGeometry() {
  const parts = new PartList();
  const rim = new THREE.TorusGeometry(0.185, 0.017, 8, 30);
  parts.add(rim, { color: [0.02, 0.02, 0.02], mr: [0, 0.5], cc: 0 });
  const hub = new THREE.CylinderGeometry(0.06, 0.065, 0.06, 18);
  hub.rotateX(Math.PI / 2); hub.translate(0, -0.01, 0.02);
  parts.add(hub, { color: [0.03, 0.03, 0.03], mr: [0, 0.6], cc: 0 });
  for (const [x, y, w, h] of [[-0.11, -0.01, 0.13, 0.035], [0.11, -0.01, 0.13, 0.035], [0, -0.11, 0.035, 0.11]]) {
    const sp = new THREE.BoxGeometry(w, h, 0.022); sp.translate(x, y, 0.01);
    parts.add(sp, { color: [0.035, 0.035, 0.035], mr: [0.2, 0.5], cc: 0 });
  }
  const badge = new THREE.CylinderGeometry(0.018, 0.018, 0.01, 14);
  badge.rotateX(Math.PI / 2); badge.translate(0, -0.01, 0.052);
  parts.add(badge, S.chrome);
  return parts.merge();
}

// Shared see-through tinted glass: more transparent head-on, more reflective at grazing angles.
export const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x0b1116, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false,
  clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3,
});
glassMaterial.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
    float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 2.2);
    diffuseColor.a = mix(opacity, 0.93, fres);
    #include <opaque_fragment>`);
};
glassMaterial.customProgramCacheKey = () => 'car-glass-v1';

// ---------- model builder ----------
const cache = new Map();

export function getCarModel(typeName) {
  if (cache.has(typeName)) return cache.get(typeName);
  const T = CAR_TYPES[typeName];
  const P = makeProfile(T);
  const parts = new PartList();
  const { zf, zr, zFa, zRa } = P;
  const ra = T.R + 0.06;

  // ---- lower body ----
  let zs = rangeStations(zr, zf, 0.085);
  for (const a of [zFa, zRa]) zs.push(a - ra - 0.001, a - ra + 0.001, a + ra - 0.001, a + ra + 0.001);
  zs.push(zf - 0.02, zf - 0.06, zr + 0.02, zr + 0.06);
  // the cabin opening runs from the windshield base back to the rear glass (or the pickup bed)
  const zCabF = T.gh.ws, zCabR = T.bed ? T.bed : T.gh.rb;
  zs.push(zCabF, zCabR);
  zs = [...new Set(zs.map((z) => Math.round(z * 10000) / 10000))].sort((a, b) => a - b);
  const rings = zs.map((z) => P.ring(z));
  loftStrip(rings, 0, 1, parts, S.under);
  // body sides full length; the top surface is split so the cabin is open to the glass above
  // (only the window-sill lip runs along the cabin)
  loftStrip(rings, 1, 5, parts, S.paint);
  const front = rings.filter((r) => r[0][2] >= zCabF - 0.0001);
  const cabinR = rings.filter((r) => r[0][2] >= zCabR - 0.0001 && r[0][2] <= zCabF + 0.0001);
  const back = rings.filter((r) => r[0][2] <= zCabR + 0.0001);
  loftStrip(front, 5, 8, parts, S.paint);
  loftStrip(cabinR, 5, 6, parts, S.paint);
  if (T.bed) {
    // open bed: rail caps on top, then a lined tub with wheel wells, a toolbox and cargo
    loftStrip(back, 5, 6, parts, S.paint);
    addPickupBed(T, P, parts);
  } else {
    loftStrip(back, 5, 8, parts, S.paint);
  }
  capRing(rings[rings.length - 1], true, parts, S.paint);
  capRing(rings[0], false, parts, S.paint);

  // ---- greenhouse ----
  const g = T.gh;
  const ghStations = (a, b) => rangeStations(a, b, 0.06).map((z) => P.ghRing(z));
  // side band split by z ranges (glass / pillars)
  for (const [a0, a1, kind] of T.side) {
    const a = Math.max(a0, g.rb), b = Math.min(a1, g.ws);
    if (b - a < 0.005) continue;
    loftStrip(ghStations(a, b), 0, 1, parts, kind === 'glass' ? S.glass : kind === 'black' ? S.gloss : S.paint);
    if (kind !== 'glass') loftStrip(ghStations(a, b), 0, 1, parts, S.trim, true);
  }
  // roof rail band (A / C pillars follow the glass slope)
  loftStrip(ghStations(g.rb, g.ws), 1, 2, parts, T.sporty ? S.gloss : S.paint);
  loftStrip(ghStations(g.rb, g.ws), 1, 2, parts, S.headliner, true);
  // windshield / roof / rear glass
  loftStrip(ghStations(g.rf, g.ws), 2, 4, parts, S.glass);
  loftStrip(ghStations(g.rr, g.rf), 2, 4, parts, T.sporty ? S.gloss : S.paint);
  loftStrip(ghStations(g.rr, g.rf), 2, 4, parts, S.headliner, true);
  loftStrip(ghStations(g.rb, g.rr), 2, 4, parts, T.vanRear ? S.paint : S.glass);
  if (T.vanRear) loftStrip(ghStations(g.rb, g.rr), 2, 4, parts, S.headliner, true);
  const cabin = addInterior(typeName, T, P, parts);

  // ---- details ----
  const ytF = P.yt(zf), ybF = P.yb(zf), hwF = P.hw(zf);
  const ytR = P.yt(zr), ybR = P.yb(zr), hwR = P.hw(zr);
  const fz = zf + 0.004, rz = zr - 0.004;

  // window seals / chrome belt line
  sideHLine(P, parts, g.rb + 0.02, g.ws - 0.02, P.yt(0) - 0.02, 0.022, T.chromeBelt ? S.chrome : S.rubber);
  // frit band at windshield base + wipers
  {
    const wy = P.yt(g.ws) + 0.03, wz = g.ws - 0.08;
    parts.box(0, wy - 0.012, g.ws - 0.03, (P.hw(g.ws) - 0.12) * 2, 0.03, 0.08, S.plastic);
    parts.box(0.25, wy + 0.02, wz - 0.04, 0.62, 0.012, 0.02, S.black, 0, 0.12, 0.05);
    parts.box(-0.3, wy + 0.02, wz - 0.04, 0.58, 0.012, 0.02, S.black, 0, 0.08, 0.05);
  }
  // door shut lines and handles
  const beltY = (z) => P.yt(z) - 0.03;
  for (const sz of T.shut) {
    const y0 = P.yb(sz) + 0.06;
    sideLine(P, parts, sz, y0, beltY(sz), S.under);
  }
  for (const hz of T.handles) {
    const hy = beltY(hz) - 0.1, hx = P.sideX(hz, hy) + 0.012;
    parts.box(hx, hy, hz, 0.025, 0.035, 0.17, T.chromeBelt ? S.chrome : S.paint);
    parts.box(-hx, hy, hz, 0.025, 0.035, 0.17, T.chromeBelt ? S.chrome : S.paint);
  }
  // side cladding / skirts
  if (T.cladding || T.sporty) {
    const y = P.yb(0) + 0.07;
    sideHLine(P, parts, zRa + ra + 0.02, zFa - ra - 0.02, y, 0.12, T.sporty ? S.gloss : S.plastic, 0.006);
  }
  // mirrors: housing (paint), black base, dark glass facing back, LED repeater
  {
    const mz = g.ws - 0.15, my = P.yt(mz) + 0.13, mx = P.hw(mz) + 0.06;
    for (const s of [1, -1]) {
      parts.box(s * (mx - 0.07), my - 0.08, mz + 0.02, 0.1, 0.05, 0.12, S.black);
      parts.box(s * (mx + 0.05), my, mz, 0.2, 0.12, 0.1, S.paint);
      parts.box(s * (mx + 0.05), my, mz - 0.051, 0.17, 0.095, 0.004, S.mirrorGlass);
      parts.box(s * (mx + 0.08), my - 0.05, mz + 0.035, 0.12, 0.012, 0.03, s > 0 ? S.indL : S.indR);
    }
  }
  // ---- front: grille (bars both ways), headlights (asymmetric internals), plate, badge ----
  {
    const gw = hwF * (T.sporty ? 0.9 : 0.95), gy = ybF + (ytF - ybF) * (T.sporty ? 0.28 : 0.4), gh = (ytF - ybF) * (T.sporty ? 0.3 : 0.36);
    parts.box(0, gy, fz, gw, gh, 0.03, S.gloss);
    const nb = 5, nv = 9;
    for (let i = 0; i < nb; i++) parts.box(0, gy - gh / 2 + (i + 0.5) * gh / nb, fz + 0.016, gw * 0.96, 0.012, 0.014, S.plastic);
    for (let i = 0; i < nv; i++) parts.box(-gw / 2 + (i + 0.5) * gw / nv, gy, fz + 0.018, 0.01, gh * 0.96, 0.012, S.plastic);
    parts.box(0, gy + gh / 2 + 0.012, fz + 0.012, gw * 1.02, 0.02, 0.02, S.chrome);
    // badge (generic oval)
    parts.cyl(0, gy + gh * 0.15, fz + 0.03, 0.045, 0.012, 'z', S.chrome, 16);
    // lower lip / splitter
    parts.box(0, ybF + 0.025, fz - 0.01, hwF * 1.9, 0.05, 0.07, S.plastic);
    if (T.sporty) parts.box(0, ybF - 0.01, fz + 0.02, hwF * 1.85, 0.015, 0.12, S.gloss);
    // fog lights
    for (const s of [1, -1]) {
      parts.cyl(s * (hwF - 0.22), ybF + 0.1, fz + 0.005, 0.045, 0.02, 'z', S.chrome, 14);
      parts.cyl(s * (hwF - 0.22), ybF + 0.1, fz + 0.016, 0.036, 0.01, 'z', S.head, 14);
    }
    // headlights
    const hy = ytF - (T.sporty ? 0.075 : 0.11), hwid = T.sporty ? 0.46 : 0.48, hh = T.sporty ? 0.095 : 0.15;
    for (const s of [1, -1]) {
      const hx = s * (hwF - hwid / 2 - 0.03);
      parts.box(hx, hy, fz + 0.005, hwid, hh, 0.03, S.housing);
      // projector in a chrome ring (inner side)
      const px = hx - s * (hwid / 2 - 0.07);
      parts.cyl(px, hy - 0.005, fz + 0.02, 0.04, 0.02, 'z', S.chrome, 16);
      parts.cyl(px, hy - 0.005, fz + 0.028, 0.03, 0.012, 'z', S.head, 16);
      // LED row (middle)
      for (let k = 0; k < 3; k++) parts.box(hx + s * (-0.03 + k * 0.045), hy - 0.015, fz + 0.022, 0.032, 0.03, 0.01, S.head);
      // L-shaped DRL: along the top and down the outer edge
      parts.box(hx, hy + hh / 2 - 0.012, fz + 0.024, hwid * 0.92, 0.012, 0.008, S.drl);
      parts.box(hx + s * (hwid / 2 - 0.018), hy, fz + 0.024, 0.012, hh * 0.8, 0.008, S.drl);
      // amber indicator in the outer corner
      parts.box(hx + s * (hwid / 2 - 0.05), hy - hh / 2 + 0.02, fz + 0.023, 0.05, 0.025, 0.008, s > 0 ? S.indL : S.indR);
      // side marker (amber, flush)
      const mz = zf - 0.16, my = hy - 0.02;
      parts.box(s * (P.sideX(mz, my) + 0.003), my, mz, 0.006, 0.025, 0.07, S.amberMark);
    }
    // plate frame (plate itself is a textured mesh)
    parts.box(0, ybF + 0.2, fz + 0.006, 0.36, 0.19, 0.012, S.plastic);
  }
  // ---- rear: wrap tail lights with LED bars, reverse lights, third brake light, reflectors, exhaust ----
  {
    const ty = ytR - (T.vanRear ? 0.3 : 0.11), tw = T.vanRear ? 0.16 : 0.42, th = T.vanRear ? 0.42 : 0.14;
    for (const s of [1, -1]) {
      const tx = s * (hwR - tw / 2 - 0.02);
      parts.box(tx, ty, rz - 0.004, tw, th, 0.03, S.tail);
      // LED bars
      parts.box(tx, ty + th * 0.22, rz - 0.022, tw * 0.85, 0.014, 0.008, S.tailLed);
      parts.box(tx, ty - th * 0.18, rz - 0.022, tw * 0.85, 0.014, 0.008, S.tailLed);
      // reverse lamp at the inner end
      parts.box(tx - s * (tw / 2 - 0.05), ty, rz - 0.021, 0.07, th * 0.45, 0.01, S.rev);
      // rear amber indicator segment
      parts.box(tx + s * (tw / 2 - 0.05), ty - th * 0.36, rz - 0.021, 0.07, th * 0.18, 0.01, s > 0 ? S.indL : S.indR);
      // wrap-around onto the side
      const wz = zr + 0.12, wy = ty;
      parts.box(s * (P.sideX(wz, wy) + 0.004), wy, wz, 0.01, th * 0.85, 0.2, S.tail);
      // bumper reflectors and red side marker
      parts.box(s * (hwR - 0.12), ybR + 0.12, rz - 0.006, 0.1, 0.025, 0.01, S.reflector);
      // exhaust (driver side opposite) dark inside
      if (s < 0 || T.sporty) {
        const ex = s * (hwR - 0.4);
        parts.cyl(ex, ybR + 0.02, rz - 0.02, 0.04, 0.12, 'z', S.chrome, 14);
        parts.cyl(ex, ybR + 0.02, rz - 0.078, 0.032, 0.005, 'z', S.exhaust, 14);
      }
    }
    // third brake light: at the top of the rear glass / roof edge
    const b3z = g.rb + (g.rr - g.rb) * 0.85, b3y = P.roofY(b3z) - 0.03;
    parts.box(0, b3y, b3z - 0.04, 0.32, 0.025, 0.02, S.brake3);
    // bumper lower black
    parts.box(0, ybR + 0.03, rz + 0.01, hwR * 1.85, 0.06, 0.06, S.plastic);
    parts.box(0, ybR + 0.32, rz - 0.006, 0.36, 0.19, 0.012, S.plastic);
    if (T.sporty) {
      for (let k = -3; k <= 3; k++) parts.box(k * 0.13, ybR - 0.01, rz + 0.08, 0.012, 0.07, 0.2, S.gloss);
    }
    if (T.hitch) {
      parts.box(0, ybR - 0.05, rz - 0.08, 0.07, 0.07, 0.2, S.black);
      parts.cyl(0, ybR + 0.0, rz - 0.18, 0.028, 0.05, 'y', S.chrome, 10);
    }
    if (T.rearWiper) {
      const wz = g.rb + (g.rr - g.rb) * 0.25, wy = P.roofY(wz);
      parts.box(0.1, wy - 0.12, wz - 0.03, 0.35, 0.015, 0.015, S.black, 0, 0, 0.4);
    }
    if (T.vanRear) {
      // rear door windows
      for (const s of [1, -1]) parts.box(s * 0.42, g.roof - 0.45, rz - 0.004, 0.62, 0.5, 0.012, S.glass);
      // twin rear doors: centre line, hinges, handle
      parts.box(0, (ybR + g.roof) / 2, rz - 0.003, 0.006, g.roof - ybR - 0.1, 0.006, S.under);
      for (const s of [1, -1]) for (const hy of [ybR + 0.4, g.roof - 0.4]) parts.box(s * (hwR - 0.05), hy, rz - 0.012, 0.08, 0.06, 0.02, S.black);
      parts.box(0.1, ybR + 0.75, rz - 0.015, 0.14, 0.03, 0.02, S.chrome);
    }
  }
  // ---- roof extras ----
  if (T.roofRails) {
    for (const s of [1, -1]) {
      const z0 = g.rr + 0.15, z1 = g.rf - 0.1, ry = g.roof + 0.03;
      const rx = (P.hw((z0 + z1) / 2) - 0.09 - g.tumble) * 0.9;
      parts.box(s * rx, ry + 0.04, (z0 + z1) / 2, 0.035, 0.03, z1 - z0, S.black);
      for (const zz of [z0 + 0.05, z1 - 0.05]) parts.box(s * rx, ry + 0.015, zz, 0.04, 0.04, 0.08, S.black);
    }
  }
  if (T.fin) {
    const fz2 = g.rr + 0.1, fy = P.roofY(fz2);
    const fin = new THREE.CylinderGeometry(0.0, 0.035, 0.16, 4, 1);
    fin.rotateZ(Math.PI / 2); fin.rotateY(Math.PI / 2); fin.scale(1, 0.9, 1);
    fin.translate(0, fy + 0.05, fz2);
    parts.add(fin, S.paint);
  }
  if (T.whip) {
    const wz = g.ws - 0.2;
    parts.cyl(P.hw(wz) - 0.05, P.yt(wz) + 0.4, wz, 0.004, 0.75, 'y', S.black, 4);
  }

  const geometry = parts.merge();
  const glassGeometry = parts.mergeGlass();
  const model = {
    type: typeName, T, P, geometry, glassGeometry, cabin,
    wheels: [
      { x: T.track / 2, z: zFa, front: true, left: true },
      { x: -T.track / 2, z: zFa, front: true, left: false },
      { x: T.track / 2, z: zRa, front: false, left: true },
      { x: -T.track / 2, z: zRa, front: false, left: false },
    ],
    plates: { front: { y: ybF + 0.2, z: fz + 0.014 }, rear: { y: ybR + 0.32, z: rz - 0.014 } },
    roofY: g.roof, length: T.L, width: T.W,
    headLightPos: [{ x: hwF - 0.25, y: ytF - 0.1, z: zf }, { x: -(hwF - 0.25), y: ytF - 0.1, z: zf }],
  };
  cache.set(typeName, model);
  return model;
}

// Plate quads (+ taxi sign) for one car. Atlas 8x8; row 7 = taxi signs.
export function makePlateGeometry(model, plateIndex) {
  const col = plateIndex % 8, row = Math.floor(plateIndex / 8) % 7;
  const u0 = col / 8, u1 = (col + 1) / 8, v1 = 1 - row / 8, v0 = 1 - (row + 1) / 8;
  const pos = [], uv = [], nor = [], idx = [];
  const quad = (pts, n, uvs) => {
    const b = pos.length / 3;
    for (const p of pts) pos.push(...p);
    for (const t of uvs) uv.push(...t);
    for (let i = 0; i < 4; i++) nor.push(...n);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const w = 0.17, h = 0.085;
  const f = model.plates.front, r = model.plates.rear;
  quad([[-w, f.y - h, f.z], [w, f.y - h, f.z], [w, f.y + h, f.z], [-w, f.y + h, f.z]], [0, 0, 1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  quad([[w, r.y - h, r.z], [-w, r.y - h, r.z], [-w, r.y + h, r.z], [w, r.y + h, r.z]], [0, 0, -1], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  if (model.T.taxi) {
    const tc = plateIndex % 8;
    const tu0 = tc / 8, tu1 = (tc + 1) / 8, tv0 = 0, tv1 = 1 / 8;
    const y0 = model.roofY + 0.04, y1 = y0 + 0.26, zz = model.T.gh.rr + (model.T.gh.rf - model.T.gh.rr) * 0.45;
    const sw = 0.42, sd = 0.11;
    quad([[-sw, y0, zz + sd], [sw, y0, zz + sd], [sw, y1, zz + sd], [-sw, y1, zz + sd]], [0, 0, 1], [[tu0, tv0], [tu1, tv0], [tu1, tv1], [tu0, tv1]]);
    quad([[sw, y0, zz - sd], [-sw, y0, zz - sd], [-sw, y1, zz - sd], [sw, y1, zz - sd]], [0, 0, -1], [[tu0, tv0], [tu1, tv0], [tu1, tv1], [tu0, tv1]]);
    const ye = (tu0 + 0.004);
    quad([[sw, y0, zz + sd], [sw, y0, zz - sd], [sw, y1, zz - sd], [sw, y1, zz + sd]], [1, 0, 0], [[ye, 0.002], [ye, 0.002], [ye, 0.004], [ye, 0.004]]);
    quad([[-sw, y0, zz - sd], [-sw, y0, zz + sd], [-sw, y1, zz + sd], [-sw, y1, zz - sd]], [-1, 0, 0], [[ye, 0.002], [ye, 0.002], [ye, 0.004], [ye, 0.004]]);
    quad([[-sw, y1, zz + sd], [sw, y1, zz + sd], [sw, y1, zz - sd], [-sw, y1, zz - sd]], [0, 1, 0], [[ye, 0.002], [ye, 0.002], [ye, 0.004], [ye, 0.004]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------- wheels ----------
// One instanced mesh for every rotating wheel (tyre + rim + disc) and one for calipers.
function buildWheelGeometry(R, W, spokes = 5) {
  const parts = new PartList();
  const rr = R * 0.66;
  // tyre: lathe of a rounded section, axis along X
  const prof = [];
  const sec = [[rr, -W / 2 + 0.01], [R - 0.045, -W / 2], [R - 0.012, -W / 2 + 0.025], [R, -W / 2 + 0.05], [R, W / 2 - 0.05], [R - 0.012, W / 2 - 0.025], [R - 0.045, W / 2], [rr, W / 2 - 0.01]];
  for (const [r, y] of sec) prof.push(new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof, 26);
  tyre.rotateZ(Math.PI / 2);
  parts.add(tyre, S.rubber);
  // sidewall ring detail (raised lettering band)
  const band = new THREE.TorusGeometry((R + rr) / 2 + 0.01, 0.006, 4, 26);
  band.rotateY(Math.PI / 2); band.translate(W / 2 - 0.005, 0, 0);
  parts.add(band, { color: [0.05, 0.05, 0.05], mr: [0, 0.7], cc: 0 });
  // rim barrel
  const barrel = new THREE.CylinderGeometry(rr, rr, W * 0.9, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.add(barrel, S.alu);
  // brake disc inside
  const disc = new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.03, 22);
  disc.rotateZ(Math.PI / 2); disc.translate(-0.01, 0, 0);
  parts.add(disc, { color: [0.45, 0.45, 0.46], mr: [1, 0.45], cc: 0 });
  // face: lip ring, spokes, hub, lug nuts, centre cap
  const lip = new THREE.TorusGeometry(rr - 0.01, 0.014, 6, 26);
  lip.rotateY(Math.PI / 2); lip.translate(W * 0.42, 0, 0);
  parts.add(lip, S.alu);
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    for (const off of [-0.11, 0.11]) {
      const sp = new THREE.BoxGeometry(0.03, rr * 0.82, 0.035);
      sp.translate(0, rr * 0.47, 0);
      sp.rotateX(a + off);
      sp.translate(W * 0.36, 0, 0);
      parts.add(sp, S.alu);
    }
  }
  const hub = new THREE.CylinderGeometry(rr * 0.3, rr * 0.34, 0.05, 16);
  hub.rotateZ(Math.PI / 2); hub.translate(W * 0.36, 0, 0);
  parts.add(hub, S.alu);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.03, 6);
    nut.rotateZ(Math.PI / 2); nut.translate(W * 0.4, Math.cos(a) * rr * 0.2, Math.sin(a) * rr * 0.2);
    parts.add(nut, S.chrome);
  }
  const cap = new THREE.CylinderGeometry(rr * 0.12, rr * 0.12, 0.02, 14);
  cap.rotateZ(Math.PI / 2); cap.translate(W * 0.405, 0, 0);
  parts.add(cap, { color: [0.08, 0.08, 0.09], mr: [0.5, 0.3], cc: 0 });
  return parts.merge();
}

function buildCaliperGeometry(R, W, red) {
  const parts = new PartList();
  const rr = R * 0.66;
  const g = new THREE.BoxGeometry(0.06, rr * 0.5, rr * 0.3);
  g.translate(0.02, rr * 0.62, 0);
  g.rotateX(-0.7);
  parts.add(g, red ? { color: [0.6, 0.04, 0.03], mr: [0.2, 0.35], cc: 0.6 } : { color: [0.12, 0.12, 0.13], mr: [0.5, 0.45], cc: 0 });
  return parts.merge();
}

export class WheelRenderer {
  constructor(scene, maxCars = 90) {
    this.scene = scene;
    this.max = maxCars * 4;
    this.material = baseCarMaterial.clone();
    this.material.onBeforeCompile = baseCarMaterial.onBeforeCompile;
    this.material.customProgramCacheKey = baseCarMaterial.customProgramCacheKey;
    this.material.userData = {
      uPaint: { value: new THREE.Vector3(1, 1, 1) }, uPaintMR: { value: new THREE.Vector2(0, 0.5) },
      uLights: { value: new THREE.Vector4() }, uInd: { value: new THREE.Vector3() },
    };
    this.meshes = new Map(); // key -> {wheel, caliper, n}
    this.m = new THREE.Matrix4();
  }
  group(T) {
    const key = `${T.R}-${T.tw}-${T.redCaliper ? 1 : 0}`;
    if (!this.meshes.has(key)) {
      const w = new THREE.InstancedMesh(buildWheelGeometry(T.R, T.tw, T.sporty ? 10 : 5), this.material, this.max);
      const c = new THREE.InstancedMesh(buildCaliperGeometry(T.R, T.tw, !!T.redCaliper), this.material, this.max);
      for (const im of [w, c]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0; this.scene.add(im); }
      this.meshes.set(key, { wheel: w, caliper: c, n: 0 });
    }
    return this.meshes.get(key);
  }
  begin() { for (const g of this.meshes.values()) g.n = 0; }
  // world matrices for spinning wheel + caliper (steered but not spinning)
  push(T, wheelMatrix, caliperMatrix) {
    const g = this.group(T);
    if (g.n >= this.max) return;
    g.wheel.setMatrixAt(g.n, wheelMatrix);
    g.caliper.setMatrixAt(g.n, caliperMatrix);
    g.n++;
  }
  end() {
    for (const g of this.meshes.values()) {
      g.wheel.count = g.n; g.caliper.count = g.n;
      g.wheel.instanceMatrix.needsUpdate = true; g.caliper.instanceMatrix.needsUpdate = true;
    }
  }
}

// A drivable/displayable car: body mesh + plates + light uniforms + wheel state.
let plateCounter = 0;
export class CarVisual {
  constructor(typeName, paintHex, plateMat, poolMat) {
    this.model = getCarModel(typeName);
    this.T = this.model.T;
    this.group = new THREE.Group();
    this.material = makeCarMaterial(paintHex, Math.random() < 0.75);
    this.body = new THREE.Mesh(this.model.geometry, this.material);
    this.body.castShadow = true; this.body.receiveShadow = true;
    this.group.add(this.body);
    this.glass = new THREE.Mesh(this.model.glassGeometry, glassMaterial);
    this.glass.receiveShadow = true;
    this.group.add(this.glass);
    this.plates = new THREE.Mesh(makePlateGeometry(this.model, plateCounter++ % 56), plateMat);
    this.group.add(this.plates);
    // headlight light pools on the road (night)
    if (poolMat) {
      const pg = new THREE.PlaneGeometry(4.2, 9);
      pg.rotateX(-Math.PI / 2);
      pg.translate(0, 0.05, this.model.length / 2 + 4.5);
      this.beam = new THREE.Mesh(pg, poolMat);
      this.beam.renderOrder = 3;
      this.beam.visible = false;
      this.group.add(this.beam);
    }
    this.wheelSpin = [0, 0, 0, 0];
    this.wheelSteer = 0;
    this.wheelDrop = [0, 0, 0, 0]; // suspension offset per wheel (m)
    this.lights = this.material.userData.uLights.value;
    this.ind = this.material.userData.uInd.value;
  }
  setPaint(hex) {
    const c = new THREE.Color(hex);
    this.material.userData.uPaint.value.set(c.r, c.g, c.b);
  }
  // Push wheel instance matrices given the car's world matrix.
  pushWheels(renderer, worldMatrix) {
    const T = this.T, model = this.model;
    const m = _wm, q = _wq, e = _we, p = _wp, one = _one;
    model.wheels.forEach((w, i) => {
      const steer = w.front ? this.wheelSteer : 0;
      p.set(w.x, T.R + this.wheelDrop[i], w.z);
      const spin = w.left ? this.wheelSpin[i] : -this.wheelSpin[i];
      e.set(spin, steer + (w.left ? 0 : Math.PI), 0, 'YXZ');
      q.setFromEuler(e);
      m.compose(p, q, one).premultiply(worldMatrix);
      e.set(0, steer + (w.left ? 0 : Math.PI), 0, 'YXZ');
      q.setFromEuler(e);
      _cm.compose(p, q, one).premultiply(worldMatrix);
      renderer.push(T, m, _cm);
    });
  }
  dispose() {
    this.material.dispose();
    this.plates.geometry.dispose();
    if (this.beam) this.beam.geometry.dispose();
  }
}
const _wm = new THREE.Matrix4(), _cm = new THREE.Matrix4(), _wq = new THREE.Quaternion(), _we = new THREE.Euler(), _wp = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
