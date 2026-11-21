// Procedural PBR textures. Everything is generated at load time, so the game ships with no image files.
// Painting is done straight into float buffers (row 0 = bottom of the texture, i.e. v = 0),
// then packed into DataTextures: colour (sRGB), normal, ORM (G = roughness, B = metalness) and emissive.
import * as THREE from 'three';
import { mulberry32, clamp } from './utils.js';

let MAX_ANISO = 8;
export function setMaxAnisotropy(a) { MAX_ANISO = a; }

// ---------- tileable value-noise fields ----------
function latticeNoise(w, h, cx, cy, seed) {
  const rnd = mulberry32(seed);
  const grid = new Float32Array(cx * cy);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() * 2 - 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * cy;
    const y0 = Math.floor(gy), fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    const r0 = (y0 % cy) * cx, r1 = ((y0 + 1) % cy) * cx;
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cx;
      const x0 = Math.floor(gx), fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const c0 = x0 % cx, c1 = (x0 + 1) % cx;
      const a = grid[r0 + c0], b = grid[r0 + c1], c = grid[r1 + c0], d = grid[r1 + c1];
      out[y * w + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

export function fbmField(w, h, cells, octaves, seed, aspect = 1) {
  const out = new Float32Array(w * h);
  let amp = 1, norm = 0, c = cells;
  for (let o = 0; o < octaves; o++) {
    const f = latticeNoise(w, h, Math.max(1, Math.round(c * aspect)), Math.max(1, Math.round(c)), seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += f[i] * amp;
    norm += amp;
    amp *= 0.5;
    c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// ---------- painter ----------
class Layer {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.col = new Float32Array(n * 3);
    this.hgt = new Float32Array(n);
    this.rough = new Float32Array(n).fill(0.85);
    this.metal = new Float32Array(n);
    this.emi = new Float32Array(n * 3);
  }
  // Fill a rectangle given in pixel space. fn(i, x, y, lu, lv) where lu/lv are 0..1 across the rect.
  rect(x0, y0, x1, y1, fn) {
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(this.w, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(this.h, Math.ceil(y1));
    const iw = 1 / Math.max(1e-6, x1 - x0), ih = 1 / Math.max(1e-6, y1 - y0);
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) fn(y * this.w + x, x, y, (x + 0.5 - x0) * iw, (y + 0.5 - y0) * ih);
    }
  }
  setCol(i, r, g, b) { this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; }
  mulCol(i, f) { this.col[i * 3] *= f; this.col[i * 3 + 1] *= f; this.col[i * 3 + 2] *= f; }
  setEmi(i, r, g, b) { this.emi[i * 3] = r; this.emi[i * 3 + 1] = g; this.emi[i * 3 + 2] = b; }
}

function packTexture(w, h, getRGBA, srgb, opts = {}) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = getRGBA(i);
    data[i * 4] = clamp(p[0] * 255, 0, 255);
    data[i * 4 + 1] = clamp(p[1] * 255, 0, 255);
    data[i * 4 + 2] = clamp(p[2] * 255, 0, 255);
    data[i * 4 + 3] = clamp((p[3] ?? 1) * 255, 0, 255);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = MAX_ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const tmp4 = [0, 0, 0, 1];
function layerToTextures(L, normalStrength = 2, wantEmissive = false) {
  const { w, h } = L;
  const map = packTexture(w, h, (i) => {
    tmp4[0] = L.col[i * 3]; tmp4[1] = L.col[i * 3 + 1]; tmp4[2] = L.col[i * 3 + 2]; tmp4[3] = 1;
    return tmp4;
  }, true);
  const hg = L.hgt;
  const normal = packTexture(w, h, (i) => {
    const x = i % w, y = (i / w) | 0;
    const xl = (x - 1 + w) % w, xr = (x + 1) % w, yd = (y - 1 + h) % h, yu = (y + 1) % h;
    const dx = (hg[y * w + xr] - hg[y * w + xl]) * normalStrength;
    const dy = (hg[yu * w + x] - hg[yd * w + x]) * normalStrength;
    const len = Math.hypot(dx, dy, 1);
    tmp4[0] = (-dx / len) * 0.5 + 0.5; tmp4[1] = (-dy / len) * 0.5 + 0.5; tmp4[2] = (1 / len) * 0.5 + 0.5; tmp4[3] = 1;
    return tmp4;
  }, false);
  const orm = packTexture(w, h, (i) => {
    tmp4[0] = 1; tmp4[1] = L.rough[i]; tmp4[2] = L.metal[i]; tmp4[3] = 1;
    return tmp4;
  }, false);
  let emissive = null;
  if (wantEmissive) {
    emissive = packTexture(w, h, (i) => {
      tmp4[0] = L.emi[i * 3]; tmp4[1] = L.emi[i * 3 + 1]; tmp4[2] = L.emi[i * 3 + 2]; tmp4[3] = 1;
      return tmp4;
    }, true);
  }
  return { map, normal, orm, emissive };
}

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

// ---------- asphalt ----------
function paintAsphalt(L, seed, tileM) {
  const { w, h } = L;
  const macro = fbmField(w, h, Math.max(2, Math.round(tileM / 3)), 4, seed);
  const fine = fbmField(w, h, Math.round(tileM * 6), 2, seed + 7);
  const rnd = mulberry32(seed + 3);
  for (let i = 0; i < w * h; i++) {
    let v = 0.2 + macro[i] * 0.03 + fine[i] * 0.025 + (rnd() - 0.5) * 0.06;
    const speck = rnd();
    let r = v, g = v, b = v * 1.03;
    if (speck < 0.025) { const s = 0.36 + rnd() * 0.15; r = s; g = s * 0.98; b = s * 0.95; }
    else if (speck < 0.05) { r *= 0.6; g *= 0.6; b *= 0.6; }
    L.setCol(i, r, g, b);
    L.hgt[i] = rnd() * 0.5 + fine[i] * 0.5 + (speck < 0.025 ? 0.6 : 0);
    L.rough[i] = 0.82 + rnd() * 0.12 - Math.max(0, macro[i]) * 0.25;
  }
  // tar patches and cracks
  for (let k = 0; k < tileM * 0.6; k++) {
    let x = rnd() * w, y = rnd() * h, ang = rnd() * Math.PI * 2;
    const len = 40 + rnd() * 200;
    for (let s = 0; s < len; s++) {
      ang += (rnd() - 0.5) * 0.6;
      x = (x + Math.cos(ang) + w) % w; y = (y + Math.sin(ang) + h) % h;
      const i = (y | 0) * w + (x | 0);
      L.mulCol(i, 0.45); L.hgt[i] -= 0.8; L.rough[i] = 0.6;
    }
  }
}

export function makeAsphaltTextures(size, seed = 11) {
  const L = new Layer(size, size);
  paintAsphalt(L, seed, 8);
  return layerToTextures(L, 1.4);
}

// Road segment: u spans the full 14 m carriageway, v spans 9 m (one dash period).
export function makeRoadTextures(size, seed = 21) {
  const W = 14, H = 9;
  const L = new Layer(size, size);
  paintAsphalt(L, seed, 11);
  const pxU = size / W, pxV = size / H;
  const wear = fbmField(size, size, 24, 3, seed + 5);
  const rnd = mulberry32(seed + 9);
  const paint = (u0, u1, v0, v1, color) => {
    L.rect(u0 * pxU, v0 * pxV, u1 * pxU, v1 * pxV, (i) => {
      const keep = wear[i] * 0.5 + 0.75 + (rnd() - 0.5) * 0.25;
      if (keep < 0.5) return;
      const a = clamp(keep, 0, 1) * 0.92;
      L.col[i * 3] = L.col[i * 3] * (1 - a) + color[0] * a;
      L.col[i * 3 + 1] = L.col[i * 3 + 1] * (1 - a) + color[1] * a;
      L.col[i * 3 + 2] = L.col[i * 3 + 2] * (1 - a) + color[2] * a;
      L.hgt[i] += 0.6; L.rough[i] = 0.55;
    });
  };
  // wheel paths: slightly polished/darker strips in each lane
  const lanesC = [-5.25, -1.75, 1.75, 5.25];
  for (const c of lanesC) {
    for (const off of [-0.85, 0.85]) {
      const uc = (c + off + 7) * pxU;
      L.rect(uc - 0.35 * pxU, 0, uc + 0.35 * pxU, size, (i, x, y, lu) => {
        const f = 1 - Math.abs(lu - 0.5) * 2;
        L.mulCol(i, 1 - 0.12 * f); L.rough[i] -= 0.12 * f;
      });
    }
    const uc = (c + 7) * pxU; // oil drip line in lane centre
    L.rect(uc - 0.4 * pxU, 0, uc + 0.4 * pxU, size, (i, x, y, lu) => {
      const f = (1 - Math.abs(lu - 0.5) * 2) * (0.5 + wear[i] * 0.5);
      L.mulCol(i, 1 - 0.18 * Math.max(0, f)); L.rough[i] -= 0.2 * Math.max(0, f);
    });
  }
  const white = [0.86, 0.86, 0.83], yellow = [0.85, 0.66, 0.16];
  paint(0.35, 0.5, 0, H, white);           // edge lines
  paint(W - 0.5, W - 0.35, 0, H, white);
  paint(7 - 0.27, 7 - 0.13, 0, H, yellow);  // double yellow centre
  paint(7 + 0.13, 7 + 0.27, 0, H, yellow);
  paint(3.5 - 0.07, 3.5 + 0.07, 0, 3, white); // lane dashes 3 m on, 6 m off
  paint(10.5 - 0.07, 10.5 + 0.07, 0, 3, white);
  // gutter darkening near curbs
  L.rect(0, 0, 0.35 * pxU, size, (i, x, y, lu) => { L.mulCol(i, 0.75 + 0.25 * lu); });
  L.rect(size - 0.35 * pxU, 0, size, size, (i, x, y, lu) => { L.mulCol(i, 1 - 0.25 * lu); });
  return layerToTextures(L, 1.4);
}

// Crosswalk + stop-line decal sheet with alpha. Top 75 %: zebra band (14 m x 3 m). Bottom 25 %: stop bar.
export function makeMarkingTexture() {
  const w = 1024, h = 512;
  const wear = fbmField(w, h, 30, 3, 77);
  const rnd = mulberry32(78);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let a = 0;
      if (y >= h * 0.25) {
        const um = (x / w) * 14; // metres across road
        const stripe = ((um - 0.25) % 1.1 + 1.1) % 1.1;
        if (stripe < 0.55 && um > 0.4 && um < 13.6) a = 1;
        const vm = (y - h * 0.25) / (h * 0.75);
        if (vm < 0.03 || vm > 0.97) a = 0;
      } else {
        const vm = y / (h * 0.25);
        if (vm > 0.15 && vm < 0.85) a = 1;
      }
      const keep = wear[i] * 0.6 + 0.8 + (rnd() - 0.5) * 0.3;
      a *= clamp((keep - 0.45) * 3, 0, 1);
      data[i * 4] = 222; data[i * 4 + 1] = 222; data[i * 4 + 2] = 215; data[i * 4 + 3] = a * 235;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO; t.needsUpdate = true;
  return t;
}

// ---------- sidewalk / curb / pavers ----------
export function makeSidewalkTextures(size, seed = 31) {
  const L = new Layer(size, size);
  const tile = 4, slab = 4 / 3;
  const macro = fbmField(size, size, 6, 4, seed);
  const fine = fbmField(size, size, 120, 2, seed + 1);
  const rnd = mulberry32(seed + 2);
  const px = size / tile;
  const slabTone = [];
  for (let k = 0; k < 9; k++) slabTone.push(0.9 + rnd() * 0.18);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const mx = x / px, my = y / px;
      const sx = Math.floor(mx / slab), sy = Math.floor(my / slab);
      const fx = (mx % slab) / slab, fy = (my % slab) / slab;
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * slab; // metres to joint
      let v = 0.58 * slabTone[(sx + sy * 3) % 9] + macro[i] * 0.05 + fine[i] * 0.03 + (rnd() - 0.5) * 0.04;
      let hh = 1 + fine[i] * 0.2 + rnd() * 0.15;
      let r = 0.85 + rnd() * 0.08;
      if (edge < 0.012) { v *= 0.45; hh = 0.2; r = 0.95; }
      else if (edge < 0.03) { v *= 0.9; hh = 0.75; }
      L.setCol(i, v * 1.0, v * 0.985, v * 0.96);
      L.hgt[i] = hh; L.rough[i] = r;
    }
  }
  // gum spots & stains
  for (let k = 0; k < 120; k++) {
    const cx = rnd() * size, cy = rnd() * size, rr = 2 + rnd() * (k < 20 ? 30 : 5);
    const dark = k < 20 ? 0.88 : 0.6;
    L.rect(cx - rr, cy - rr, cx + rr, cy + rr, (i, x, y, lu, lv) => {
      const d = Math.hypot(lu - 0.5, lv - 0.5) * 2;
      if (d < 1) L.mulCol(i, dark + (1 - dark) * d);
    });
  }
  return layerToTextures(L, 2.5);
}

export function makePaverTextures(size, seed = 41) {
  const L = new Layer(size, size);
  const tile = 3; const bw = 0.2, bh = 0.1;
  const rnd = mulberry32(seed);
  const fine = fbmField(size, size, 64, 2, seed + 1);
  const px = size / tile;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const my = y / px; const row = Math.floor(my / bh);
      const mx = x / px + (row % 2) * bw * 0.5;
      const col = Math.floor(mx / bw);
      const fx = (mx % bw) / bw, fy = (my % bh) / bh;
      const edge = Math.min(fx * bw, (1 - fx) * bw, fy * bh, (1 - fy) * bh);
      const hsh = Math.sin(col * 127.1 + row * 311.7) * 43758.5453;
      const tone = 0.85 + (hsh - Math.floor(hsh)) * 0.3;
      let r = 0.48 * tone, g = 0.4 * tone, b = 0.34 * tone;
      let hh = 1 + fine[i] * 0.2;
      if (edge < 0.008) { r *= 0.5; g *= 0.5; b *= 0.5; hh = 0.1; }
      L.setCol(i, r + fine[i] * 0.02, g + fine[i] * 0.02, b + fine[i] * 0.02);
      L.hgt[i] = hh; L.rough[i] = 0.8 + rnd() * 0.1;
    }
  }
  return layerToTextures(L, 3);
}

// ---------- natural ground ----------
export function makeGrassGroundTextures(size, seed = 51) {
  const L = new Layer(size, size);
  const macro = fbmField(size, size, 4, 4, seed);
  const mid = fbmField(size, size, 16, 3, seed + 1);
  const rnd = mulberry32(seed + 2);
  for (let i = 0; i < size * size; i++) {
    const m = macro[i], d = mid[i];
    let r = 0.16 + m * 0.03 + d * 0.03, g = 0.27 + m * 0.05 + d * 0.04, b = 0.08 + d * 0.02;
    if (d > 0.35) { const t = (d - 0.35) * 2; r += 0.12 * t; g += 0.06 * t; b += 0.04 * t; } // dry/dirt
    L.setCol(i, r, g, b);
    L.hgt[i] = d * 0.4 + rnd() * 0.2;
    L.rough[i] = 0.95;
  }
  // blades strokes
  const strokes = size * 18;
  for (let k = 0; k < strokes; k++) {
    let x = rnd() * size, y = rnd() * size;
    const len = 3 + rnd() * 8, ang = Math.PI / 2 + (rnd() - 0.5) * 1.6;
    const tone = rnd();
    const c = tone < 0.5 ? [0.2, 0.36, 0.09] : tone < 0.85 ? [0.28, 0.42, 0.12] : [0.42, 0.44, 0.2];
    const f = 0.7 + rnd() * 0.5;
    for (let s = 0; s < len; s++) {
      x = (x + Math.cos(ang) + size) % size; y = (y + Math.sin(ang) + size) % size;
      const i = (y | 0) * size + (x | 0);
      L.setCol(i, c[0] * f, c[1] * f, c[2] * f); L.hgt[i] += 0.4;
    }
  }
  return layerToTextures(L, 2.0);
}

export function makeRockTextures(size, seed = 61) {
  const L = new Layer(size, size);
  const a = fbmField(size, size, 6, 5, seed);
  const b = fbmField(size, size, 30, 3, seed + 1);
  const rnd = mulberry32(seed + 2);
  for (let i = 0; i < size * size; i++) {
    const strata = Math.sin(((i / size) | 0) / size * 40 + a[i] * 6) * 0.5 + 0.5;
    let v = 0.36 + a[i] * 0.12 + b[i] * 0.06 + strata * 0.05 + (rnd() - 0.5) * 0.04;
    L.setCol(i, v * 1.02, v * 0.97, v * 0.9);
    L.hgt[i] = a[i] + b[i] * 0.5 + strata * 0.3;
    L.rough[i] = 0.9;
  }
  return layerToTextures(L, 4);
}

export function makeDirtTextures(size, seed = 71) {
  const L = new Layer(size, size);
  const a = fbmField(size, size, 8, 5, seed);
  const rnd = mulberry32(seed + 2);
  for (let i = 0; i < size * size; i++) {
    const p = rnd();
    let v = 0.32 + a[i] * 0.08 + (rnd() - 0.5) * 0.06;
    if (p < 0.03) v += 0.15;
    L.setCol(i, v * 1.05, v * 0.85, v * 0.62);
    L.hgt[i] = a[i] + (p < 0.03 ? 0.8 : rnd() * 0.3);
    L.rough[i] = 0.95;
  }
  return layerToTextures(L, 3);
}

export function makeRoofTextures(size, seed = 81) {
  const L = new Layer(size, size);
  const a = fbmField(size, size, 6, 4, seed);
  const rnd = mulberry32(seed + 1);
  const px = size / 10;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = 0.42 + a[i] * 0.06 + (rnd() - 0.5) * 0.12;
      const seam = (x % (px * 2.5)) < 1.5 || (y % (px * 5)) < 1.5;
      if (seam) v *= 0.8;
      L.setCol(i, v, v * 0.99, v * 0.97);
      L.hgt[i] = rnd() * 0.8 + (seam ? 0.5 : 0);
      L.rough[i] = 0.92;
    }
  }
  return layerToTextures(L, 2);
}

// ---------- facades ----------
// Each facade tile covers `cols` window columns and `floors` storeys. Building UVs are scaled so a
// face always shows a whole number of columns and storeys, and the window light shader uses the same grid.
export const FACADE_STYLES = {
  glassBlue: { cols: 4, floors: 4, colW: 3.0, floorH: 3.7, aspect: 1 },
  glassTeal: { cols: 4, floors: 4, colW: 3.0, floorH: 3.7, aspect: 1 },
  office: { cols: 4, floors: 4, colW: 3.3, floorH: 3.8, aspect: 1 },
  brickRed: { cols: 4, floors: 4, colW: 3.2, floorH: 3.2, aspect: 1 },
  brickTan: { cols: 4, floors: 4, colW: 3.2, floorH: 3.2, aspect: 1 },
  plaster: { cols: 4, floors: 4, colW: 3.6, floorH: 3.1, aspect: 1 },
};

function wallNoise(L, base, seed, grainAmt = 0.05) {
  const { w, h } = L;
  const a = fbmField(w, h, 5, 4, seed);
  const b = fbmField(w, h, 60, 2, seed + 1);
  const rnd = mulberry32(seed + 2);
  for (let i = 0; i < w * h; i++) {
    const f = 1 + a[i] * 0.08 + b[i] * grainAmt + (rnd() - 0.5) * grainAmt;
    L.setCol(i, base[0] * f, base[1] * f, base[2] * f);
    L.hgt[i] = 1 + b[i] * 0.15;
    L.rough[i] = 0.88 + (rnd() - 0.5) * 0.08;
  }
  // rain streaks below windows/top
  for (let k = 0; k < w * 0.15; k++) {
    const x = (rnd() * w) | 0, y0 = (rnd() * h) | 0, len = 20 + rnd() * h * 0.2;
    const s = 0.94 + rnd() * 0.04;
    for (let y = y0; y > y0 - len && y >= 0; y--) L.mulCol(y * w + x, s);
  }
}

function glassPane(L, x0, y0, x1, y1, tint, rnd, opts = {}) {
  const var1 = 0.85 + rnd() * 0.3;
  const rough = (opts.rough ?? 0.06) + rnd() * 0.04;
  const metal = opts.metal ?? 0.6;
  const blinds = rnd() < (opts.blinds ?? 0.3);
  const blindDepth = rnd() * 0.6;
  L.rect(x0, y0, x1, y1, (i, x, y, lu, lv) => {
    const grad = 0.85 + lv * 0.3;
    L.setCol(i, tint[0] * var1 * grad, tint[1] * var1 * grad, tint[2] * var1 * grad);
    L.hgt[i] = 0; L.rough[i] = rough; L.metal[i] = metal;
    // interior light mask: brighter near the ceiling, desks darker at the bottom
    let e = 0.55 + 0.45 * Math.pow(lv, 1.5);
    if (lv > 0.88) e = 1.2;
    if (blinds && lv > 1 - blindDepth) e *= ((y % 4) < 2 ? 0.55 : 0.8);
    if (lv < 0.25 && ((x >> 3) % 3 === 0)) e *= 0.6;
    L.setEmi(i, e, e, e);
  });
}

function frameRect(L, x0, y0, x1, y1, t, color, rough = 0.4, metal = 0.0, hg = 1.4) {
  const fill = (a, b, c, d) => L.rect(a, b, c, d, (i) => {
    L.setCol(i, color[0], color[1], color[2]); L.hgt[i] = hg; L.rough[i] = rough; L.metal[i] = metal; L.setEmi(i, 0, 0, 0);
  });
  fill(x0, y0, x1, y0 + t); fill(x0, y1 - t, x1, y1); fill(x0, y0, x0 + t, y1); fill(x1 - t, y0, x1, y1);
}

export function makeFacadeTextures(styleName, size, seed = 100) {
  const st = FACADE_STYLES[styleName];
  const w = size, h = Math.round(size * st.aspect);
  const L = new Layer(w, h);
  const rnd = mulberry32(seed);
  const cw = w / st.cols, fh = h / st.floors; // pixels per column / floor
  const pxm = cw / st.colW; // pixels per metre

  if (styleName.startsWith('glass')) {
    const tint = styleName === 'glassBlue' ? [0.16, 0.24, 0.32] : [0.13, 0.27, 0.27];
    const mull = [0.62, 0.64, 0.66];
    wallNoise(L, [0.2, 0.22, 0.24], seed, 0.02);
    for (let f = 0; f < st.floors; f++) {
      for (let c = 0; c < st.cols; c++) {
        const x0 = c * cw, y0 = f * fh;
        // spandrel panel (opaque, back-painted glass)
        L.rect(x0, y0, x0 + cw, y0 + 0.95 * pxm, (i) => {
          L.setCol(i, tint[0] * 0.55, tint[1] * 0.55, tint[2] * 0.55); L.hgt[i] = 0.2; L.rough[i] = 0.12; L.metal[i] = 0.5;
        });
        glassPane(L, x0, y0 + 0.95 * pxm, x0 + cw, y0 + fh, tint, rnd, { metal: 0.65, rough: 0.04 });
        // mullions & transoms
        L.rect(x0, y0, x0 + 0.06 * pxm, y0 + fh, (i) => { L.setCol(i, ...mull); L.hgt[i] = 1.6; L.rough[i] = 0.35; L.metal[i] = 0.9; L.setEmi(i, 0, 0, 0); });
        L.rect(x0 + cw - 0.06 * pxm, y0, x0 + cw, y0 + fh, (i) => { L.setCol(i, ...mull); L.hgt[i] = 1.6; L.rough[i] = 0.35; L.metal[i] = 0.9; L.setEmi(i, 0, 0, 0); });
        L.rect(x0, y0 + 0.92 * pxm, x0 + cw, y0 + 1.0 * pxm, (i) => { L.setCol(i, ...mull); L.hgt[i] = 1.2; L.rough[i] = 0.35; L.metal[i] = 0.9; L.setEmi(i, 0, 0, 0); });
        L.rect(x0, y0, x0 + cw, y0 + 0.05 * pxm, (i) => { L.setCol(i, ...mull); L.hgt[i] = 1.2; L.rough[i] = 0.35; L.metal[i] = 0.9; L.setEmi(i, 0, 0, 0); });
      }
    }
    const t = layerToTextures(L, 3, true);
    return { ...t, ...st, emissiveStrength: 1.0 };
  }

  if (styleName === 'office') {
    wallNoise(L, [0.66, 0.63, 0.58], seed, 0.06);
    for (let f = 0; f < st.floors; f++) {
      for (let c = 0; c < st.cols; c++) {
        const x0 = c * cw, y0 = f * fh;
        const wx0 = x0 + 0.45 * pxm, wx1 = x0 + cw - 0.45 * pxm, wy0 = y0 + 0.95 * pxm, wy1 = y0 + 3.0 * pxm;
        // deep reveal shading
        L.rect(wx0 - 0.08 * pxm, wy0 - 0.08 * pxm, wx1 + 0.08 * pxm, wy1 + 0.08 * pxm, (i, x, y, lu, lv) => {
          L.mulCol(i, 0.7); L.hgt[i] = 0.6;
        });
        glassPane(L, wx0, wy0, wx1, wy1, [0.12, 0.15, 0.18], rnd, { metal: 0.35, rough: 0.07, blinds: 0.5 });
        frameRect(L, wx0, wy0, wx1, wy1, 0.06 * pxm, [0.22, 0.23, 0.24], 0.4, 0.6, 0.3);
        L.rect((wx0 + wx1) / 2 - 0.03 * pxm, wy0, (wx0 + wx1) / 2 + 0.03 * pxm, wy1, (i) => { L.setCol(i, 0.22, 0.23, 0.24); L.hgt[i] = 0.3; L.rough[i] = 0.4; L.metal[i] = 0.6; L.setEmi(i, 0, 0, 0); });
        // sill
        L.rect(wx0 - 0.1 * pxm, wy0 - 0.12 * pxm, wx1 + 0.1 * pxm, wy0 - 0.02 * pxm, (i) => { L.mulCol(i, 1.12); L.hgt[i] = 1.6; });
      }
      // panel joint at floor line
      L.rect(0, f * fh, w, f * fh + 0.025 * pxm, (i) => { L.mulCol(i, 0.6); L.hgt[i] = 0.5; });
    }
    for (let c = 0; c < st.cols; c++) L.rect(c * cw, 0, c * cw + 0.02 * pxm, h, (i) => { L.mulCol(i, 0.7); L.hgt[i] = 0.6; });
    const t = layerToTextures(L, 3, true);
    return { ...t, ...st, emissiveStrength: 0.9 };
  }

  if (styleName.startsWith('brick')) {
    const base = styleName === 'brickRed' ? [0.42, 0.18, 0.12] : [0.6, 0.47, 0.32];
    const mortar = [0.62, 0.6, 0.56];
    const bw = 0.225 * pxm, bh = 0.075 * pxm, mt = Math.max(1, 0.012 * pxm);
    const fine = fbmField(w, h, 80, 2, seed + 3);
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / bh);
      const off = (row % 2) * bw * 0.5;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const col = Math.floor((x + off) / bw);
        const fx = (x + off) - col * bw, fy = y - row * bh;
        const hs = Math.sin(col * 91.7 + row * 47.3) * 43758.5453;
        const tone = 0.8 + (hs - Math.floor(hs)) * 0.38;
        if (fx < mt || fy < mt) {
          L.setCol(i, mortar[0], mortar[1], mortar[2]); L.hgt[i] = 0.3; L.rough[i] = 0.95;
        } else {
          const n = 1 + fine[i] * 0.12;
          L.setCol(i, base[0] * tone * n, base[1] * tone * n, base[2] * tone * n); L.hgt[i] = 1 + fine[i] * 0.2; L.rough[i] = 0.85;
        }
      }
    }
    for (let f = 0; f < st.floors; f++) {
      for (let c = 0; c < st.cols; c++) {
        const x0 = c * cw, y0 = f * fh;
        const wx0 = x0 + 0.85 * pxm, wx1 = x0 + cw - 0.85 * pxm, wy0 = y0 + 0.8 * pxm, wy1 = y0 + 2.65 * pxm;
        // lintel and sill (stone)
        L.rect(wx0 - 0.12 * pxm, wy1, wx1 + 0.12 * pxm, wy1 + 0.22 * pxm, (i) => { L.setCol(i, 0.7, 0.68, 0.63); L.hgt[i] = 1.4; L.rough[i] = 0.8; });
        L.rect(wx0 - 0.1 * pxm, wy0 - 0.12 * pxm, wx1 + 0.1 * pxm, wy0, (i) => { L.setCol(i, 0.72, 0.7, 0.66); L.hgt[i] = 1.8; L.rough[i] = 0.8; });
        // glass with curtains
        const curtain = rnd() < 0.6;
        const cc = [0.5 + rnd() * 0.4, 0.4 + rnd() * 0.4, 0.3 + rnd() * 0.4];
        glassPane(L, wx0, wy0, wx1, wy1, [0.1, 0.12, 0.13], rnd, { metal: 0.2, rough: 0.05, blinds: 0 });
        if (curtain) {
          const cwid = 0.18 + rnd() * 0.15;
          L.rect(wx0, wy0, wx1, wy1, (i, x, y, lu) => {
            if (lu < cwid || lu > 1 - cwid) {
              const fold = 0.8 + 0.2 * Math.sin(x * 0.9);
              L.setCol(i, cc[0] * 0.35 * fold, cc[1] * 0.35 * fold, cc[2] * 0.35 * fold);
              L.setEmi(i, cc[0] * 0.8 * fold, cc[1] * 0.75 * fold, cc[2] * 0.7 * fold); L.rough[i] = 0.9; L.metal[i] = 0;
            }
          });
        }
        frameRect(L, wx0, wy0, wx1, wy1, 0.07 * pxm, [0.85, 0.85, 0.82], 0.5, 0, 0.8);
        L.rect((wx0 + wx1) / 2 - 0.025 * pxm, wy0, (wx0 + wx1) / 2 + 0.025 * pxm, wy1, (i) => { L.setCol(i, 0.85, 0.85, 0.82); L.hgt[i] = 0.8; L.rough[i] = 0.5; L.metal[i] = 0; L.setEmi(i, 0, 0, 0); });
        L.rect(wx0, wy0 + (wy1 - wy0) * 0.66 - 0.025 * pxm, wx1, wy0 + (wy1 - wy0) * 0.66 + 0.025 * pxm, (i) => { L.setCol(i, 0.85, 0.85, 0.82); L.hgt[i] = 0.8; L.rough[i] = 0.5; L.metal[i] = 0; L.setEmi(i, 0, 0, 0); });
      }
      // stone string course every floor
      L.rect(0, f * fh, w, f * fh + 0.12 * pxm, (i) => { L.setCol(i, 0.6, 0.58, 0.54); L.hgt[i] = 1.5; L.rough[i] = 0.85; L.setEmi(i, 0, 0, 0); });
    }
    const t = layerToTextures(L, 3.5, true);
    return { ...t, ...st, emissiveStrength: 0.8 };
  }

  // plaster: modern apartments with balcony slabs and glass railings
  const tones = [[0.86, 0.84, 0.8], [0.78, 0.76, 0.72], [0.84, 0.8, 0.72]];
  wallNoise(L, tones[seed % 3], seed, 0.03);
  for (let f = 0; f < st.floors; f++) {
    for (let c = 0; c < st.cols; c++) {
      const x0 = c * cw, y0 = f * fh;
      const wx0 = x0 + 0.5 * pxm, wx1 = x0 + cw - 0.5 * pxm, wy0 = y0 + 0.3 * pxm, wy1 = y0 + 2.75 * pxm;
      glassPane(L, wx0, wy0, wx1, wy1, [0.11, 0.13, 0.15], rnd, { metal: 0.3, rough: 0.05, blinds: 0.45 });
      frameRect(L, wx0, wy0, wx1, wy1, 0.05 * pxm, [0.15, 0.15, 0.16], 0.4, 0.5, 0.3);
      L.rect(wx0 + (wx1 - wx0) * 0.62, wy0, wx0 + (wx1 - wx0) * 0.62 + 0.05 * pxm, wy1, (i) => { L.setCol(i, 0.15, 0.15, 0.16); L.hgt[i] = 0.3; L.setEmi(i, 0, 0, 0); });
      // glass railing band
      L.rect(x0 + 0.2 * pxm, y0 + 0.25 * pxm, x0 + cw - 0.2 * pxm, y0 + 1.25 * pxm, (i, x, y, lu, lv) => {
        L.col[i * 3] = L.col[i * 3] * 0.55 + 0.32 * 0.45; L.col[i * 3 + 1] = L.col[i * 3 + 1] * 0.55 + 0.4 * 0.45; L.col[i * 3 + 2] = L.col[i * 3 + 2] * 0.55 + 0.42 * 0.45;
        L.rough[i] = 0.1; L.metal[i] = 0.1; L.hgt[i] = 1.6;
        L.emi[i * 3] *= 0.6; L.emi[i * 3 + 1] *= 0.6; L.emi[i * 3 + 2] *= 0.6;
        if (lv > 0.94) { L.setCol(i, 0.5, 0.5, 0.5); L.metal[i] = 0.9; L.rough[i] = 0.3; }
      });
    }
    // balcony slab edge
    L.rect(0, f * fh, w, f * fh + 0.25 * pxm, (i) => { L.setCol(i, 0.9, 0.9, 0.88); L.hgt[i] = 2.0; L.rough[i] = 0.8; L.metal[i] = 0; L.setEmi(i, 0, 0, 0); });
    L.rect(0, f * fh + 0.25 * pxm, w, f * fh + 0.3 * pxm, (i) => { L.mulCol(i, 0.6); });
  }
  const t = layerToTextures(L, 3, true);
  return { ...t, ...st, emissiveStrength: 0.85 };
}

// Ground-floor shops: 4 shopfronts of 6 m, 4.6 m tall.
const SHOP_NAMES = ['CAFE', 'PIZZA', 'MARKET', 'BOOKS', 'PHARMACY', 'FLOWERS', 'DELI', 'BAKERY',
  'SHOES', 'TAILOR', 'NOODLES', 'BURGERS', 'VINYL', 'HARDWARE', 'TACOS', 'LAUNDRY'];
const SIGN_COLORS = ['#7a1f1f', '#1f3d7a', '#1e5e3a', '#2b2b2b', '#6b4a12', '#5a1f5e', '#0f5a63', '#8a3b12'];

export function makeShopTextures(size, seed = 300) {
  const w = size * 2, h = Math.round(size * 2 * (4.6 / 24));
  const L = new Layer(w, h);
  const rnd = mulberry32(seed);
  const pxm = w / 24;
  wallNoise(L, [0.55, 0.53, 0.5], seed, 0.04);
  // sign text canvas
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const names = [];
  for (let s = 0; s < 4; s++) names.push(SHOP_NAMES[(seed * 7 + s * 5 + Math.floor(rnd() * 16)) % SHOP_NAMES.length]);
  for (let s = 0; s < 4; s++) {
    const x0 = s * 6 * pxm;
    const signC = SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)];
    // sign band: canvas y is top-down
    const sy0 = h - 4.35 * pxm, sy1 = h - 3.5 * pxm;
    ctx.fillStyle = signC; ctx.fillRect(x0 + 0.4 * pxm, sy0, 5.2 * pxm, sy1 - sy0);
    ctx.fillStyle = '#f4efe2';
    ctx.font = `700 ${Math.round(0.55 * pxm)}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(names[s], x0 + 3 * pxm, (sy0 + sy1) / 2 + 1);
  }
  const img = ctx.getImageData(0, 0, w, h).data;
  for (let s = 0; s < 4; s++) {
    const x0 = s * 6 * pxm;
    // granite base
    L.rect(x0, 0, x0 + 6 * pxm, 0.35 * pxm, (i) => { L.setCol(i, 0.12, 0.12, 0.13); L.rough[i] = 0.3; L.hgt[i] = 1.5; });
    // storefront glass with interior
    const gx0 = x0 + 0.45 * pxm, gx1 = x0 + 5.55 * pxm, gy0 = 0.35 * pxm, gy1 = 3.3 * pxm;
    const warm = rnd() < 0.7;
    const doorAtLeft = rnd() < 0.5;
    L.rect(gx0, gy0, gx1, gy1, (i, x, y, lu, lv) => {
      const shelf = (Math.floor(lv * 6) % 2 === 0 && lv < 0.7) ? 0.75 : 1;
      const ir = warm ? [0.95, 0.8, 0.6] : [0.85, 0.92, 1];
      L.setCol(i, 0.08 + 0.05 * lv, 0.09 + 0.05 * lv, 0.1 + 0.06 * lv);
      L.rough[i] = 0.05; L.metal[i] = 0.25; L.hgt[i] = 0;
      const e = (0.55 + 0.35 * lv) * shelf;
      L.setEmi(i, ir[0] * e, ir[1] * e, ir[2] * e);
    });
    // door
    const dx0 = doorAtLeft ? gx0 + 0.2 * pxm : gx1 - 1.4 * pxm;
    frameRect(L, dx0, gy0, dx0 + 1.2 * pxm, gy0 + 2.3 * pxm, 0.07 * pxm, [0.1, 0.1, 0.1], 0.4, 0.8, 1.0);
    L.rect(dx0 + 0.95 * pxm, gy0 + 1.0 * pxm, dx0 + 1.0 * pxm, gy0 + 1.4 * pxm, (i) => { L.setCol(i, 0.7, 0.7, 0.7); L.metal[i] = 1; L.rough[i] = 0.25; L.hgt[i] = 2; });
    frameRect(L, gx0, gy0, gx1, gy1, 0.08 * pxm, [0.12, 0.12, 0.13], 0.4, 0.7, 1.0);
    for (let m = 1; m < 3; m++) {
      const mx = gx0 + (gx1 - gx0) * m / 3;
      L.rect(mx - 0.04 * pxm, gy0, mx + 0.04 * pxm, gy1, (i) => { L.setCol(i, 0.12, 0.12, 0.13); L.rough[i] = 0.4; L.metal[i] = 0.7; L.hgt[i] = 1; L.setEmi(i, 0, 0, 0); });
    }
    // pilasters
    L.rect(x0, 0, x0 + 0.42 * pxm, h, (i) => { L.mulCol(i, 1.2); L.hgt[i] = 1.8; });
    L.rect(x0 + 5.58 * pxm, 0, x0 + 6 * pxm, h, (i) => { L.mulCol(i, 1.2); L.hgt[i] = 1.8; });
    // awning shadow line above glass
    L.rect(x0 + 0.42 * pxm, 3.3 * pxm, x0 + 5.58 * pxm, 3.5 * pxm, (i) => { L.setCol(i, 0.18, 0.18, 0.18); L.hgt[i] = 1.2; });
  }
  // composite sign canvas (flip rows: canvas top-down, data bottom-up)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = ((h - 1 - y) * w + x) * 4;
      const a = img[ci + 3] / 255;
      if (a <= 0) continue;
      const i = y * w + x;
      const r = img[ci] / 255, g = img[ci + 1] / 255, b = img[ci + 2] / 255;
      const lr = r, lg = g, lb = b; // textures are stored sRGB-encoded
      L.col[i * 3] = L.col[i * 3] * (1 - a) + lr * a; L.col[i * 3 + 1] = L.col[i * 3 + 1] * (1 - a) + lg * a; L.col[i * 3 + 2] = L.col[i * 3 + 2] * (1 - a) + lb * a;
      L.rough[i] = 0.5; L.hgt[i] = 1.6; L.metal[i] = 0;
      const bright = (r + g + b) / 3 > 0.7 ? 1.4 : 0.25;
      L.setEmi(i, lr * bright, lg * bright, lb * bright);
    }
  }
  const t = layerToTextures(L, 3, true);
  return { ...t, tileW: 24, tileH: 4.6, cols: 4, floors: 1, emissiveStrength: 1.0 };
}

// ---------- misc ----------
export function makeCanvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

export function makeLightPoolTexture() {
  return makeCanvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

export function makeLeafTexture(seed = 501, autumn = false) {
  const rnd = mulberry32(seed);
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // twigs
    ctx.strokeStyle = 'rgba(60,45,30,1)'; ctx.lineWidth = 3;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath(); ctx.moveTo(w / 2, h);
      ctx.quadraticCurveTo(w * (0.2 + rnd() * 0.6), h * 0.6, w * (0.1 + rnd() * 0.8), h * (0.05 + rnd() * 0.5));
      ctx.stroke();
    }
    for (let k = 0; k < 420; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * w * 0.46;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.95;
      const s = 9 + rnd() * 12;
      const shade = 0.55 + rnd() * 0.6;
      const base = autumn && rnd() < 0.5 ? [150, 110, 40] : [58 + rnd() * 30, 92 + rnd() * 40, 30 + rnd() * 18];
      ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI * 2);
      const grd = ctx.createLinearGradient(-s, 0, s, 0);
      grd.addColorStop(0, `rgb(${base[0] * shade * 0.7 | 0},${base[1] * shade * 0.7 | 0},${base[2] * shade * 0.7 | 0})`);
      grd.addColorStop(1, `rgb(${Math.min(255, base[0] * shade * 1.2) | 0},${Math.min(255, base[1] * shade * 1.2) | 0},${Math.min(255, base[2] * shade * 1.1) | 0})`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });
}

export function makeBarkTexture(seed = 601) {
  const rnd = mulberry32(seed);
  return makeCanvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3d3024'; ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) {
      const x = rnd() * w, y = rnd() * h, l = 20 + rnd() * 80;
      const v = 30 + rnd() * 50;
      ctx.strokeStyle = `rgba(${v + 20},${v + 8},${v - 5},0.7)`;
      ctx.lineWidth = 1 + rnd() * 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 6, y + l); ctx.stroke();
    }
  });
}

export function makeWaterNormal(size = 512) {
  const L = new Layer(size, size);
  const a = fbmField(size, size, 8, 4, 901);
  const b = fbmField(size, size, 24, 2, 902);
  for (let i = 0; i < size * size; i++) L.hgt[i] = a[i] + b[i] * 0.4;
  const t = layerToTextures(L, 6);
  return t.normal;
}

// Number plates (generic, invented): an 8x8 atlas of 2:1 plates, plus taxi roof signs in the last row.
export function makePlateAtlas() {
  const rnd = mulberry32(4242);
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const t = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    const cw = w / 8, ch = h / 8;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const x = c * cw, y = r * ch;
        if (r === 7) {
          // taxi sign
          ctx.fillStyle = '#f3c623'; ctx.fillRect(x, y, cw, ch);
          ctx.fillStyle = '#151515'; ctx.fillRect(x + 4, y + 4, cw - 8, ch - 8);
          ctx.fillStyle = '#ffd84a';
          ctx.font = `800 ${ch * 0.62}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('TAXI', x + cw / 2, y + ch / 2 + 2);
          continue;
        }
        ctx.fillStyle = '#f2f2ee'; ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
        ctx.strokeStyle = '#1d2d5a'; ctx.lineWidth = 3; ctx.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
        ctx.fillStyle = '#9b1d20';
        ctx.font = `600 ${ch * 0.17}px "Barlow Condensed", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('ROGGY CITY', x + cw / 2, y + 7);
        let s = '';
        s += Math.floor(rnd() * 9 + 1);
        for (let k = 0; k < 3; k++) s += letters[Math.floor(rnd() * letters.length)];
        s += ' ';
        for (let k = 0; k < 3; k++) s += Math.floor(rnd() * 10);
        ctx.fillStyle = '#1d2d5a';
        ctx.font = `700 ${ch * 0.48}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(s, x + cw / 2, y + ch * 0.62);
      }
    }
  });
  return t;
}
