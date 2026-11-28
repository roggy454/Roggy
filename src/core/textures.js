// Procedural texture synthesis. Every texture in the game is generated here at
// load time from noise + canvas drawing — no image files are downloaded.
import * as THREE from 'three';
import { fbm, vnoise, RNG, clamp, smoothstep, sleep0 } from './utils.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(c, { srgb = true, repeat = true, aniso = 8, channel = 0, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.channel = channel;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// fn(u, v, x, y) -> writes into out[0..3] (0..255)
function pixelCanvas(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x / w, y / h, x, y, out);
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
      i += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// height field -> tangent space normal map canvas (tileable)
export function heightToNormal(hf, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const dx = (hf[yc + xr] - hf[yc + xl]) * strength;
      const dy = (hf[yd + x] - hf[yu + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (yc + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- surfaces

function asphaltDetail() {
  const S = 512;
  const H = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const albedo = pixelCanvas(S, S, (u, v, x, y, o) => {
    const broad = fbm(u, v, 6, 4, 0.5, 1);
    const grain = fbm(u, v, 64, 3, 0.6, 2);
    const st = vnoise(u * 128 + 3.1, v * 128 + 7.7, 128);
    const stone = smoothstep(0.66, 0.8, st);
    const fine = vnoise(u * 256, v * 256, 256);
    H[y * S + x] = grain * 0.5 + stone * 0.7 + fine * 0.15 + broad * 0.2;
    let g = 70 + broad * 24 + grain * 16 + (fine - 0.5) * 12;
    g += stone * (10 + 22 * vnoise(u * 64 + 9, v * 64 + 1, 64));
    if (broad < 0.38) g *= 0.82; // tar rich patches
    rough[y * S + x] = 0.93 - stone * 0.18 - (broad < 0.38 ? 0.08 : 0);
    o[0] = clamp(g * 0.98, 0, 255); o[1] = clamp(g * 0.99, 0, 255); o[2] = clamp(g * 1.03, 0, 255);
  });
  const normal = heightToNormal(H, S, S, 2.2);
  const roughC = pixelCanvas(S, S, (u, v, x, y, o) => { const r = rough[y * S + x] * 255; o[0] = o[1] = o[2] = r; });
  return { albedo, normal, rough: roughC };
}

function drawCracks(ctx, rng, n, W, H, color = 'rgba(15,15,15,0.55)') {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = rng.range(0, W), y = rng.range(0, H);
    let a = rng.range(0, Math.PI * 2);
    ctx.lineWidth = rng.range(1, 2.5);
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = rng.int(8, 30);
    for (let s = 0; s < steps; s++) {
      a += rng.range(-0.6, 0.6);
      x += Math.cos(a) * rng.range(4, 14); y += Math.sin(a) * rng.range(4, 14);
      ctx.lineTo(x, y);
      if (rng.chance(0.12)) { // branch
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
}

function speckleErase(ctx, rng, W, H, n, maxR) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.range(0.3, 1);
    const r = rng.range(0.5, maxR);
    ctx.fillRect(rng.range(0, W), rng.range(0, H), r, r * rng.range(0.5, 2));
  }
  ctx.restore();
}

// Road segment texture: 14m wide x 28m long. Lanes: 4 x 3.5m. u across, v along.
function roadTextures(detail, kind) {
  const W = 1024, H = kind === 'cross' ? 366 : kind === 'inter' ? 1024 : 2048;
  const lenM = kind === 'cross' ? 5 : kind === 'inter' ? 14 : 28;
  const ppm = W / 14; // px per meter
  const rng = new RNG(kind === 'road' ? 11 : kind === 'cross' ? 12 : 13);

  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const pat = ctx.createPattern(detail.albedo, 'repeat');
  pat.setTransform(new DOMMatrix().scale((4 * ppm) / 512));
  ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);

  const r = makeCanvas(W / 2, H / 2);
  const rc = r.getContext('2d');
  rc.scale(0.5, 0.5);
  const rpat = rc.createPattern(detail.rough, 'repeat');
  rpat.setTransform(new DOMMatrix().scale((4 * ppm) / 512));
  rc.fillStyle = rpat; rc.fillRect(0, 0, W, H);

  const X = (m) => (m + 7) * ppm; // meters from centre -> px

  // asphalt patches (repairs)
  for (let i = 0; i < (kind === 'road' ? 3 : 1); i++) {
    const pw = rng.range(1.5, 4) * ppm, ph = rng.range(2, 6) * ppm;
    const px = rng.range(0, W - pw), py = rng.range(0, H - ph);
    ctx.fillStyle = `rgba(20,20,22,${rng.range(0.18, 0.3)})`;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(10,10,10,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
  }

  // tyre wear bands (darker, smoother)
  if (kind !== 'inter') {
    for (const lc of [-5.25, -1.75, 1.75, 5.25]) {
      for (const off of [-0.8, 0.8]) {
        const cx = X(lc + off), bw = 0.55 * ppm;
        const g = ctx.createLinearGradient(cx - bw, 0, cx + bw, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(8,8,10,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - bw, 0, bw * 2, H);
        const g2 = rc.createLinearGradient(cx - bw, 0, cx + bw, 0);
        g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.5, 'rgba(0,0,0,0.18)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
        rc.fillStyle = g2; rc.fillRect(cx - bw, 0, bw * 2, H);
      }
      // oil drip line in lane centre
      for (let k = 0; k < (kind === 'road' ? 6 : 1); k++) {
        const ox = X(lc + rng.range(-0.3, 0.3)), oy = rng.range(0, H), rr = rng.range(0.15, 0.5) * ppm;
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
        g.addColorStop(0, 'rgba(5,5,8,0.5)'); g.addColorStop(1, 'rgba(5,5,8,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ox, oy, rr, rr * 1.6, 0, 0, Math.PI * 2); ctx.fill();
        const g3 = rc.createRadialGradient(ox, oy, 0, ox, oy, rr);
        g3.addColorStop(0, 'rgba(0,0,0,0.55)'); g3.addColorStop(1, 'rgba(0,0,0,0)');
        rc.fillStyle = g3; rc.beginPath(); rc.ellipse(ox, oy, rr, rr * 1.6, 0, 0, Math.PI * 2); rc.fill();
      }
    }
  }
  drawCracks(ctx, rng, kind === 'road' ? 14 : 6, W, H);

  // ---- paint layer
  const p = makeCanvas(W, H);
  const pc = p.getContext('2d');
  const white = 'rgb(232,232,226)', yellow = 'rgb(236,190,40)';
  if (kind === 'road') {
    pc.fillStyle = white;
    pc.fillRect(X(-6.65), 0, 0.15 * ppm, H);
    pc.fillRect(X(6.5), 0, 0.15 * ppm, H);
    for (const lx of [-3.5, 3.5]) {
      for (let d = 0; d < 4; d++) pc.fillRect(X(lx) - 0.06 * ppm, (d * 7 + 1) * ppm * (H / (lenM * ppm)), 0.12 * ppm, 3 * ppm);
    }
    pc.fillStyle = yellow;
    pc.fillRect(X(-0.2), 0, 0.11 * ppm, H);
    pc.fillRect(X(0.09), 0, 0.11 * ppm, H);
  } else if (kind === 'cross') {
    const vpm = H / lenM;
    pc.fillStyle = white;
    pc.fillRect(X(-6.65), 0, 0.15 * ppm, H);
    pc.fillRect(X(6.5), 0, 0.15 * ppm, H);
    // zebra: bars parallel to the road, 0.5m wide each 1m, 3m long near the intersection end (v=1 -> canvas top)
    for (let m = -6.5; m < 6.5; m += 1.0) pc.fillRect(X(m + 0.25), 0.2 * vpm, 0.5 * ppm, 3.0 * vpm);
    // stop line on the approach half (u > 0.5)
    pc.fillRect(X(0), 4.1 * vpm, 7 * ppm, 0.45 * vpm);
    pc.fillStyle = yellow;
    pc.fillRect(X(-0.2), 3.3 * vpm, 0.11 * ppm, H);
    pc.fillRect(X(0.09), 3.3 * vpm, 0.11 * ppm, H);
  }
  speckleErase(pc, rng, W, H, kind === 'inter' ? 0 : 5000, 3);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(p, 0, 0);
  ctx.globalAlpha = 1;
  // paint is smoother: draw paint mask brighter-dark into roughness
  {
    const pk = makeCanvas(W, H), pkc = pk.getContext('2d');
    pkc.drawImage(p, 0, 0);
    pkc.globalCompositeOperation = 'source-in';
    pkc.fillStyle = '#000'; pkc.fillRect(0, 0, W, H);
    rc.save(); rc.globalAlpha = 0.45; rc.drawImage(pk, 0, 0); rc.restore();
  }

  // manhole cover
  if (kind === 'road' || kind === 'inter') {
    const mx = X(rng.pick([-1.75, 1.75])), my = H * rng.range(0.3, 0.7), mr = 0.35 * ppm;
    ctx.fillStyle = '#2b2a28'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4a4744'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(90,85,80,0.8)'; ctx.lineWidth = 2;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(mx - mr * 0.8, my + k * mr * 0.22); ctx.lineTo(mx + mr * 0.8, my + k * mr * 0.22); ctx.stroke(); }
    rc.fillStyle = 'rgb(110,110,110)'; rc.beginPath(); rc.arc(mx, my, mr, 0, Math.PI * 2); rc.fill();
  }

  return {
    map: toTexture(c, { srgb: true }),
    rough: toTexture(r, { srgb: false }),
  };
}

function sidewalkTextures() {
  const S = 512; // 3m tile, 1.5m slabs
  const H = new Float32Array(S * S);
  const R = new Float32Array(S * S);
  const slabTone = [];
  const rng = new RNG(21);
  for (let i = 0; i < 4; i++) slabTone.push(rng.range(-12, 12));
  const albedo = pixelCanvas(S, S, (u, v, x, y, o) => {
    const sx = Math.floor(u * 2), sy = Math.floor(v * 2);
    const fx = (u * 2) % 1, fy = (v * 2) % 1;
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    const joint = edge < 0.008 ? 1 : 0;
    const n = fbm(u, v, 8, 5, 0.55, 3);
    const grain = vnoise(u * 256, v * 256, 256);
    const stain = smoothstep(0.62, 0.75, fbm(u, v, 3, 3, 0.5, 9));
    H[y * S + x] = joint ? 0 : 0.6 + n * 0.25 + grain * 0.12;
    let g = 168 + slabTone[sy * 2 + sx] + (n - 0.5) * 34 + (grain - 0.5) * 16 - stain * 30;
    if (joint) g = 95;
    R[y * S + x] = joint ? 0.95 : 0.82 + (grain - 0.5) * 0.1 - stain * 0.1;
    // gum spots
    const gum = vnoise(u * 64 + 1.7, v * 64 + 5.3, 64);
    if (gum > 0.86) g -= 25;
    o[0] = clamp(g * 1.01, 0, 255); o[1] = clamp(g * 0.99, 0, 255); o[2] = clamp(g * 0.95, 0, 255);
  });
  const normal = heightToNormal(H, S, S, 3.0);
  const rough = pixelCanvas(S, S, (u, v, x, y, o) => { o[0] = o[1] = o[2] = R[y * S + x] * 255; });
  return { map: toTexture(albedo), normal: toTexture(normal, { srgb: false }), rough: toTexture(rough, { srgb: false }) };
}

function grassGroundTextures() {
  const S = 512; // 4m
  const H = new Float32Array(S * S);
  const albedo = pixelCanvas(S, S, (u, v, x, y, o) => {
    const n = fbm(u, v, 6, 5, 0.55, 4);
    const f = fbm(u, v, 64, 3, 0.6, 5);
    const dirt = smoothstep(0.58, 0.72, fbm(u, v, 4, 4, 0.5, 6));
    H[y * S + x] = f * 0.7 + n * 0.3;
    const gr = [52 + n * 40 + f * 30, 88 + n * 45 + f * 40, 30 + n * 18 + f * 12];
    const di = [96 + f * 30, 80 + f * 25, 55 + f * 18];
    const t = dirt * 0.65;
    o[0] = gr[0] * (1 - t) + di[0] * t; o[1] = gr[1] * (1 - t) + di[1] * t; o[2] = gr[2] * (1 - t) + di[2] * t;
  });
  const normal = heightToNormal(H, S, S, 2.0);
  return { map: toTexture(albedo), normal: toTexture(normal, { srgb: false }) };
}

function sandTextures() {
  const S = 512; // 6m
  const H = new Float32Array(S * S);
  const albedo = pixelCanvas(S, S, (u, v, x, y, o) => {
    const n = fbm(u, v, 5, 4, 0.5, 7);
    const warp = fbm(u, v, 3, 3, 0.5, 8);
    const ripple = Math.sin((v * 22 + warp * 6) * Math.PI * 2) * 0.5 + 0.5;
    const grain = vnoise(u * 256, v * 256, 256);
    const shell = vnoise(u * 128 + 3, v * 128 + 9, 128) > 0.9 ? 1 : 0;
    H[y * S + x] = ripple * 0.5 + grain * 0.35 + n * 0.3;
    const g = 205 + (n - 0.5) * 30 + (grain - 0.5) * 30 + ripple * 8 + shell * 25;
    o[0] = clamp(g, 0, 255); o[1] = clamp(g * 0.91, 0, 255); o[2] = clamp(g * 0.74, 0, 255);
  });
  const normal = heightToNormal(H, S, S, 1.6);
  return { map: toTexture(albedo), normal: toTexture(normal, { srgb: false }) };
}

function concreteTextures() {
  const S = 512;
  const H = new Float32Array(S * S);
  const albedo = pixelCanvas(S, S, (u, v, x, y, o) => {
    const n = fbm(u, v, 4, 6, 0.55, 10);
    const g2 = vnoise(u * 200, v * 200, 200);
    const streak = fbm(u * 0.2, v, 16, 3, 0.5, 11);
    H[y * S + x] = n * 0.5 + g2 * 0.4;
    const g = 150 + (n - 0.5) * 50 + (g2 - 0.5) * 20 - smoothstep(0.55, 0.8, streak) * 25;
    o[0] = clamp(g, 0, 255); o[1] = clamp(g * 0.98, 0, 255); o[2] = clamp(g * 0.94, 0, 255);
  });
  return { map: toTexture(albedo), normal: toTexture(heightToNormal(H, S, S, 1.5), { srgb: false }) };
}

function noiseTexture() {
  const S = 256;
  const c = pixelCanvas(S, S, (u, v, x, y, o) => {
    const n = fbm(u, v, 4, 5, 0.55, 12);
    const m = fbm(u, v, 16, 3, 0.5, 13);
    o[0] = n * 255; o[1] = m * 255; o[2] = vnoise(u * 64, v * 64, 64) * 255;
  });
  return toTexture(c, { srgb: false });
}

function waterNormal() {
  const S = 512;
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    H[y * S + x] = fbm(u, v, 8, 5, 0.5, 14) * 0.8 + fbm(u + 0.3, v, 32, 3, 0.5, 15) * 0.25;
  }
  return toTexture(heightToNormal(H, S, S, 6), { srgb: false });
}

function foamTexture() {
  const S = 256;
  const c = pixelCanvas(S, S, (u, v, x, y, o) => {
    const n = fbm(u, v, 8, 4, 0.6, 16);
    const w = fbm(u, v, 24, 3, 0.5, 17);
    const f = smoothstep(0.45, 0.62, n) * (0.6 + 0.4 * w);
    o[0] = o[1] = o[2] = f * 255;
  });
  return toTexture(c, { srgb: false });
}

// ---------------------------------------------------------------- buildings
// Tile = 4 windows x 4 floors (12m x 14m). Emissive night map covers 16 x 32 windows.

const WIN_W = 3, FLOOR_H = 3.5;
export const FACADE_TILE = { w: WIN_W * 4, h: FLOOR_H * 4 };

function facadeStyle(style) {
  const S = 512, cell = 128; // px per window
  const rng = new RNG(100 + style.length * 7);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const r = makeCanvas(S / 2, S / 2), rc = r.getContext('2d'); rc.scale(0.5, 0.5);
  const m = makeCanvas(S / 2, S / 2), mc = m.getContext('2d'); mc.scale(0.5, 0.5);
  const noiseOverlay = (alpha) => {
    const n = pixelCanvas(128, 128, (u, v, x, y, o) => { const g = fbm(u, v, 4, 4, 0.5, 30 + style.length) * 255; o[0] = o[1] = o[2] = g; o[3] = 255; });
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(n, 0, 0, S, S); ctx.restore();
  };
  let glassRect; // relative glass area within a window cell [x0,y0,x1,y1]
  if (style === 'glass') {
    glassRect = [0.03, 0.2, 0.97, 0.98];
    ctx.fillStyle = '#6b7780'; ctx.fillRect(0, 0, S, S);
    rc.fillStyle = 'rgb(110,110,110)'; rc.fillRect(0, 0, S, S);
    mc.fillStyle = 'rgb(200,200,200)'; mc.fillRect(0, 0, S, S);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
      const x0 = fx * cell, y0 = fy * cell;
      // spandrel
      ctx.fillStyle = '#39434b'; ctx.fillRect(x0, y0, cell, cell * 0.2);
      const g = ctx.createLinearGradient(0, y0 + cell * 0.2, 0, y0 + cell);
      const tint = rng.range(-8, 8);
      g.addColorStop(0, `rgb(${40 + tint},${70 + tint},${88 + tint})`);
      g.addColorStop(1, `rgb(${22 + tint},${42 + tint},${58 + tint})`);
      ctx.fillStyle = g; ctx.fillRect(x0 + cell * 0.03, y0 + cell * 0.2, cell * 0.94, cell * 0.78);
      rc.fillStyle = 'rgb(10,10,10)'; rc.fillRect(x0 + cell * 0.03, y0 + cell * 0.2, cell * 0.94, cell * 0.78);
      mc.fillStyle = 'rgb(255,255,255)'; mc.fillRect(x0 + cell * 0.03, y0 + cell * 0.2, cell * 0.94, cell * 0.78);
      // mullion
      ctx.fillStyle = '#8d979e'; ctx.fillRect(x0 + cell / 2 - 2, y0 + cell * 0.2, 4, cell * 0.8);
    }
  } else if (style === 'concrete') {
    glassRect = [0.22, 0.25, 0.78, 0.85];
    ctx.fillStyle = '#d6cfc2'; ctx.fillRect(0, 0, S, S);
    rc.fillStyle = 'rgb(215,215,215)'; rc.fillRect(0, 0, S, S);
    mc.fillStyle = 'black'; mc.fillRect(0, 0, S, S);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
      const x0 = fx * cell, y0 = fy * cell;
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x0, y0 + cell - 6, cell, 6); // floor line
      ctx.fillStyle = '#9d968b'; ctx.fillRect(x0 + cell * 0.2, y0 + cell * 0.23, cell * 0.6, cell * 0.64); // reveal
      const shade = rng.range(0, 1);
      const g = ctx.createLinearGradient(0, y0 + cell * 0.25, 0, y0 + cell * 0.85);
      g.addColorStop(0, '#46525a'); g.addColorStop(1, '#1d252b');
      ctx.fillStyle = g; ctx.fillRect(x0 + cell * 0.22, y0 + cell * 0.25, cell * 0.56, cell * 0.6);
      if (shade > 0.6) { ctx.fillStyle = `rgba(230,225,210,${rng.range(0.4, 0.8)})`; ctx.fillRect(x0 + cell * 0.22, y0 + cell * 0.25, cell * 0.56, cell * 0.6 * rng.range(0.2, 0.9)); }
      ctx.fillStyle = '#ece6da'; ctx.fillRect(x0 + cell * 0.18, y0 + cell * 0.86, cell * 0.64, cell * 0.05); // sill
      ctx.fillStyle = '#5a646a'; ctx.fillRect(x0 + cell * 0.495, y0 + cell * 0.25, 3, cell * 0.6);
      rc.fillStyle = 'rgb(20,20,20)'; rc.fillRect(x0 + cell * 0.22, y0 + cell * 0.25, cell * 0.56, cell * 0.6);
      mc.fillStyle = 'rgb(170,170,170)'; mc.fillRect(x0 + cell * 0.22, y0 + cell * 0.25, cell * 0.56, cell * 0.6);
    }
    noiseOverlay(0.35);
  } else if (style === 'condo') {
    glassRect = [0.0, 0.12, 1.0, 0.88];
    ctx.fillStyle = '#20303a'; ctx.fillRect(0, 0, S, S);
    rc.fillStyle = 'rgb(25,25,25)'; rc.fillRect(0, 0, S, S);
    mc.fillStyle = 'rgb(220,220,220)'; mc.fillRect(0, 0, S, S);
    for (let fy = 0; fy < 4; fy++) {
      const y0 = fy * cell;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + cell);
      g.addColorStop(0, '#3b5868'); g.addColorStop(1, '#162630');
      ctx.fillStyle = g; ctx.fillRect(0, y0 + cell * 0.12, S, cell * 0.76);
      // sliding door frames
      ctx.fillStyle = '#7f8b90';
      for (let k = 0; k <= 8; k++) ctx.fillRect(k * S / 8 - 2, y0 + cell * 0.12, 4, cell * 0.76);
      // white slab edge
      ctx.fillStyle = '#f1efe9'; ctx.fillRect(0, y0 + cell * 0.88, S, cell * 0.12);
      ctx.fillRect(0, y0, S, cell * 0.05);
      rc.fillStyle = 'rgb(190,190,190)'; rc.fillRect(0, y0 + cell * 0.88, S, cell * 0.12); rc.fillRect(0, y0, S, cell * 0.05);
      mc.fillStyle = 'black'; mc.fillRect(0, y0 + cell * 0.88, S, cell * 0.12); mc.fillRect(0, y0, S, cell * 0.05);
      // glass railing (lighter teal band)
      ctx.fillStyle = 'rgba(150,200,205,0.35)'; ctx.fillRect(0, y0 + cell * 0.6, S, cell * 0.28);
      ctx.fillStyle = '#d8d8d4'; ctx.fillRect(0, y0 + cell * 0.6, S, 3);
    }
  } else { // stucco (low-rise / deco) — mostly white so vertex colour tints it
    glassRect = [0.25, 0.22, 0.75, 0.82];
    ctx.fillStyle = '#f3f0ea'; ctx.fillRect(0, 0, S, S);
    rc.fillStyle = 'rgb(225,225,225)'; rc.fillRect(0, 0, S, S);
    mc.fillStyle = 'black'; mc.fillRect(0, 0, S, S);
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
      const x0 = fx * cell, y0 = fy * cell;
      ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x0, y0 + cell * 0.1, cell, 3); // reveal groove
      ctx.fillStyle = '#c9c2b8'; ctx.fillRect(x0 + cell * 0.23, y0 + cell * 0.2, cell * 0.54, cell * 0.64);
      const g = ctx.createLinearGradient(0, y0 + cell * 0.22, 0, y0 + cell * 0.82);
      g.addColorStop(0, '#5f8f99'); g.addColorStop(1, '#264850');
      ctx.fillStyle = g; ctx.fillRect(x0 + cell * 0.25, y0 + cell * 0.22, cell * 0.5, cell * 0.6);
      ctx.fillStyle = '#fbfaf7';
      ctx.fillRect(x0 + cell * 0.495, y0 + cell * 0.22, 4, cell * 0.6);
      ctx.fillRect(x0 + cell * 0.25, y0 + cell * 0.5, cell * 0.5, 4);
      rc.fillStyle = 'rgb(18,18,18)'; rc.fillRect(x0 + cell * 0.25, y0 + cell * 0.22, cell * 0.5, cell * 0.6);
      mc.fillStyle = 'rgb(150,150,150)'; mc.fillRect(x0 + cell * 0.25, y0 + cell * 0.22, cell * 0.5, cell * 0.6);
    }
    noiseOverlay(0.15);
  }

  // night emissive: 16 x 32 windows, 32px each, with frames/mullions and interior variety
  const ec = 32, EW = 16 * ec, EH = 32 * ec;
  const e = makeCanvas(EW, EH), ectx = e.getContext('2d');
  ectx.fillStyle = 'black'; ectx.fillRect(0, 0, EW, EH);
  const officeFloors = style === 'glass';
  const mullions = style === 'glass' ? [0.5] : style === 'condo' ? [0.25, 0.5, 0.75] : style === 'concrete' ? [0.5] : [0.5];
  for (let wy = 0; wy < 32; wy++) {
    const floorLit = rng.chance(officeFloors ? 0.4 : 0.0);
    for (let wx = 0; wx < 16; wx++) {
      const lit = floorLit ? rng.chance(0.85) : rng.chance(style === 'condo' ? 0.4 : 0.33);
      if (!lit) continue;
      const kind = rng.next();
      let col;
      if (officeFloors) col = kind < 0.7 ? [225, 235, 255] : [255, 222, 180];
      else col = kind < 0.55 ? [255, 190, 115] : kind < 0.82 ? [255, 228, 185] : kind < 0.94 ? [130, 165, 255] : [255, 140, 195];
      const b = rng.range(0.35, 1.0);
      const x0 = wx * ec + glassRect[0] * ec, y0 = wy * ec + glassRect[1] * ec;
      const w = (glassRect[2] - glassRect[0]) * ec, h = (glassRect[3] - glassRect[1]) * ec;
      const g = ectx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, `rgba(${col[0] * b * 0.7},${col[1] * b * 0.7},${col[2] * b * 0.7},1)`);
      g.addColorStop(0.35, `rgba(${col[0] * b},${col[1] * b},${col[2] * b},1)`);
      g.addColorStop(1, `rgba(${col[0] * b * 0.55},${col[1] * b * 0.55},${col[2] * b * 0.55},1)`);
      ectx.fillStyle = g;
      const frac = rng.chance(0.3) ? rng.range(0.3, 0.8) : 1; // curtains / blinds
      ectx.fillRect(x0, y0 + h * (1 - frac), w, h * frac);
      if (frac < 1) { ectx.fillStyle = `rgba(${col[0] * b * 0.25},${col[1] * b * 0.22},${col[2] * b * 0.2},1)`; ectx.fillRect(x0, y0, w, h * (1 - frac)); }
      // furniture silhouettes / people
      if (rng.chance(0.35)) { ectx.fillStyle = 'rgba(0,0,0,0.55)'; const fw = w * rng.range(0.15, 0.35); ectx.fillRect(x0 + rng.range(0, w - fw), y0 + h * rng.range(0.55, 0.75), fw, h); }
      // mullions & frame
      ectx.fillStyle = 'black';
      for (const mu of mullions) ectx.fillRect(wx * ec + mu * ec - 1, y0, 2, h);
      ectx.strokeStyle = 'black'; ectx.lineWidth = 2; ectx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
      if (style === 'condo') ectx.fillRect(x0, y0 + h * 0.6, w, 2); // balcony rail
    }
  }
  return {
    map: toTexture(c), rough: toTexture(r, { srgb: false }), metal: toTexture(m, { srgb: false }),
    emissive: toTexture(e), glassRect,
  };
}

function storefrontTexture() {
  // ground floor shops: 12m x 5m tile, 3 shops
  const W = 768, H = 320, rng = new RNG(55);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const e = makeCanvas(W / 2, H / 2), ec = e.getContext('2d'); ec.scale(0.5, 0.5);
  ectx_fill(ec, W, H);
  ctx.fillStyle = '#cfc8bd'; ctx.fillRect(0, 0, W, H);
  const shopW = W / 3;
  const signCols = ['#b3243b', '#1f6fb2', '#e0a21a', '#2c8a5a', '#7b3fa0', '#d4552a'];
  const names = ['CAFE', 'DELI', 'BAR', 'TACOS', 'SURF', 'PHARMACY', 'BODEGA', 'PIZZA', 'GYM', 'BOOKS', 'JUICE', 'TATTOO'];
  for (let s = 0; s < 3; s++) {
    const x0 = s * shopW;
    ctx.fillStyle = '#3a3f44'; ctx.fillRect(x0 + 10, H * 0.32, shopW - 20, H * 0.66);
    const g = ctx.createLinearGradient(0, H * 0.34, 0, H);
    g.addColorStop(0, '#516672'); g.addColorStop(1, '#1b252b');
    ctx.fillStyle = g; ctx.fillRect(x0 + 16, H * 0.34, shopW - 32, H * 0.64);
    ctx.fillStyle = '#2a2e31'; ctx.fillRect(x0 + shopW * 0.62, H * 0.38, shopW * 0.22, H * 0.6); // door
    // interior hints
    for (let k = 0; k < 6; k++) { ctx.fillStyle = `rgba(${rng.int(120, 255)},${rng.int(120, 255)},${rng.int(120, 255)},0.25)`; ctx.fillRect(x0 + 20 + rng.range(0, shopW - 60), H * rng.range(0.5, 0.85), rng.range(10, 30), rng.range(10, 30)); }
    const sc = rng.pick(signCols);
    ctx.fillStyle = sc; ctx.fillRect(x0 + 10, H * 0.08, shopW - 20, H * 0.2);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 44px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const name = rng.pick(names);
    ctx.fillText(name, x0 + shopW / 2, H * 0.18);
    // emissive: sign + shop interior glow
    ec.fillStyle = sc; ec.fillRect(x0 + 10, H * 0.08, shopW - 20, H * 0.2);
    ec.fillStyle = '#fff'; ec.font = 'bold 44px Arial, sans-serif'; ec.textAlign = 'center'; ec.textBaseline = 'middle';
    ec.fillText(name, x0 + shopW / 2, H * 0.18);
    const lg = ec.createLinearGradient(0, H * 0.34, 0, H);
    lg.addColorStop(0, 'rgba(255,220,170,0.9)'); lg.addColorStop(1, 'rgba(255,200,140,0.5)');
    ec.fillStyle = lg; ec.fillRect(x0 + 16, H * 0.34, shopW - 32, H * 0.64);
    // awning stripe
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0 + 10, H * 0.28, shopW - 20, 6);
  }
  return { map: toTexture(c), emissive: toTexture(e) };
}
function ectx_fill(ec, W, H) { ec.fillStyle = 'black'; ec.fillRect(0, 0, W, H); }

function roofTexture() {
  const S = 256;
  const c = pixelCanvas(S, S, (u, v, x, y, o) => {
    const n = fbm(u, v, 8, 4, 0.5, 40), g = vnoise(u * 128, v * 128, 128);
    const val = 120 + (n - 0.5) * 40 + (g - 0.5) * 40;
    o[0] = val; o[1] = val * 0.98; o[2] = val * 0.95;
  });
  return toTexture(c);
}

// ---------------------------------------------------------------- vegetation

function palmFrondTexture() {
  const W = 128, H = 512, rng = new RNG(61);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // v = 0 (bottom) is frond base; leaflets along the rachis at centre x
  for (let i = 0; i < 70; i++) {
    const t = i / 70;
    const y = H - 20 - t * (H - 40);
    const len = (W * 0.5 - 4) * Math.sin(Math.min(1, t * 1.15 + 0.12) * Math.PI) * rng.range(0.85, 1.0);
    for (const side of [-1, 1]) {
      const gcol = `rgb(${rng.int(40, 70)},${rng.int(95, 130)},${rng.int(30, 50)})`;
      ctx.fillStyle = gcol;
      ctx.beginPath();
      const x0 = W / 2, x1 = W / 2 + side * len, yy = y - len * 0.55;
      ctx.moveTo(x0, y);
      ctx.quadraticCurveTo(x0 + side * len * 0.5, y - len * 0.12, x1, yy);
      ctx.quadraticCurveTo(x0 + side * len * 0.5, y - len * 0.25, x0, y - 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,210,120,0.35)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x0, y - 2); ctx.quadraticCurveTo(x0 + side * len * 0.5, y - len * 0.18, x1, yy); ctx.stroke();
    }
  }
  ctx.strokeStyle = '#8a7a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.lineTo(W / 2, 10); ctx.stroke();
  const t = toTexture(c, { repeat: false });
  return t;
}

function leafClusterTexture(seed, palette, flowers = null) {
  const S = 256, rng = new RNG(seed);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * S * 0.46;
    const x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr;
    const col = rng.pick(palette);
    const shade = 1 - (rr / (S * 0.5)) * 0.35 + rng.range(-0.1, 0.1);
    ctx.fillStyle = `rgb(${col[0] * shade | 0},${col[1] * shade | 0},${col[2] * shade | 0})`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rng.range(0, Math.PI * 2));
    const l = rng.range(7, 14), w = l * rng.range(0.35, 0.55);
    ctx.beginPath(); ctx.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (flowers && rng.chance(0.18)) {
      ctx.fillStyle = rng.pick(flowers);
      ctx.beginPath(); ctx.arc(x + rng.range(-4, 4), y + rng.range(-4, 4), rng.range(2.5, 4.5), 0, Math.PI * 2); ctx.fill();
    }
  }
  return toTexture(c, { repeat: false });
}

function barkTexture(kind) {
  const W = 128, H = 256;
  const Hf = new Float32Array(W * H);
  const c = pixelCanvas(W, H, (u, v, x, y, o) => {
    let h, col;
    if (kind === 'palm') {
      const ring = (v * 16) % 1;
      const n = fbm(u, v, 8, 4, 0.5, 50);
      h = smoothstep(0.0, 0.25, ring) * (1 - smoothstep(0.75, 1, ring)) * 0.7 + n * 0.3;
      const base = 95 + n * 40 + h * 35;
      col = [base * 1.0, base * 0.88, base * 0.7];
    } else {
      const fiss = fbm(u * 1, v * 0.25, 8, 4, 0.5, 51);
      const n = fbm(u, v, 16, 3, 0.5, 52);
      h = smoothstep(0.35, 0.6, fiss) * 0.8 + n * 0.2;
      const base = 55 + h * 55 + n * 20;
      col = [base * 1.0, base * 0.85, base * 0.7];
    }
    Hf[y * W + x] = h;
    o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
  });
  return { map: toTexture(c), normal: toTexture(heightToNormal(Hf, W, H, 3), { srgb: false }) };
}

// ---------------------------------------------------------------- misc sprites

function radialTexture(stops, S = 128) {
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false });
}

function moonTexture() {
  const S = 256, rng = new RNG(77);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const base = pixelCanvas(S, S, (u, v, x, y, o) => {
    const dx = u - 0.5, dy = v - 0.5, r = Math.hypot(dx, dy);
    const n = fbm(u, v, 4, 5, 0.55, 70);
    const mare = smoothstep(0.5, 0.62, fbm(u, v, 3, 3, 0.5, 71));
    const lum = (210 - mare * 70 + (n - 0.5) * 60) * (r < 0.48 ? 1 : 0);
    o[0] = lum; o[1] = lum; o[2] = lum * 0.97; o[3] = r < 0.48 ? 255 : r < 0.5 ? 255 * (0.5 - r) / 0.02 : 0;
  });
  ctx.drawImage(base, 0, 0);
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, Math.PI * 2), rr = rng.range(0, S * 0.42);
    const x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr, cr = rng.range(2, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, cr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.arc(x + 1, y + 1, cr * 0.8, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(c, { repeat: false });
}

// ---------------------------------------------------------------- entry

export async function buildTextures(progress) {
  const T = {};
  const step = async (label, fn) => { progress(label); await sleep0(); fn(); };
  let detail;
  await step('Synthesising asphalt', () => {
    detail = asphaltDetail();
    T.asphaltNormal = toTexture(detail.normal, { srgb: false, channel: 1 });
  });
  await step('Painting road markings', () => {
    T.road = roadTextures(detail, 'road');
    T.roadCross = roadTextures(detail, 'cross');
    T.roadInter = roadTextures(detail, 'inter');
  });
  await step('Pouring sidewalks', () => { T.sidewalk = sidewalkTextures(); T.concrete = concreteTextures(); });
  await step('Growing lawns & beach sand', () => { T.grass = grassGroundTextures(); T.sand = sandTextures(); });
  await step('Generating noise fields', () => { T.noise = noiseTexture(); T.waterNormal = waterNormal(); T.foam = foamTexture(); });
  await step('Designing facades', () => {
    T.facade = {
      glass: facadeStyle('glass'), concrete: facadeStyle('concrete'),
      condo: facadeStyle('condo'), stucco: facadeStyle('stucco'),
    };
    T.storefront = storefrontTexture();
    T.roof = roofTexture();
  });
  await step('Drawing foliage', () => {
    T.palmFrond = palmFrondTexture();
    T.leaves = leafClusterTexture(81, [[52, 92, 34], [70, 112, 40], [40, 75, 28], [86, 120, 50]]);
    T.bushLeaves = leafClusterTexture(82, [[48, 96, 38], [60, 110, 44], [36, 80, 30]]);
    T.flowerLeaves = leafClusterTexture(83, [[48, 96, 38], [60, 110, 44]], ['#e0338a', '#f05aa8', '#c41f6e', '#ff8ac4']);
    T.palmBark = barkTexture('palm');
    T.oakBark = barkTexture('oak');
  });
  await step('Lighting sprites', () => {
    T.lightPool = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
    T.glow = radialTexture([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.7)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    T.moon = moonTexture();
  });
  return T;
}
