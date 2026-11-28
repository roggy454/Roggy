// Core math / random / noise helpers shared by every system.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.r()); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length) % arr.length]; }
  chance(p) { return this.r() < p; }
  sign() { return this.r() < 0.5 ? -1 : 1; }
  gauss() { // approx normal(0,1)
    return (this.r() + this.r() + this.r() + this.r() - 2) * 1.7;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

// ---------- tileable value noise (for texture synthesis) ----------
const LAT = 256;
const lattice = new Float32Array(LAT * LAT);
{
  const r = mulberry32(1337);
  for (let i = 0; i < lattice.length; i++) lattice[i] = r();
}
function latt(x, y) { return lattice[((y & 255) << 8) | (x & 255)]; }

// periodic value noise, period p (integer <= 256)
export function vnoise(x, y, p = 256) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = latt(x0, y0), b = latt(x1, y0), c = latt(x0, y1), d = latt(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// tileable fbm: x,y in [0,1) maps to a seamless tile. base = lattice cells across tile
export function fbm(x, y, base = 4, oct = 5, gain = 0.5, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = base;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f + seed * 17.3 + o * 31.7, y * f + seed * 7.1 + o * 13.3, f);
    norm += amp; amp *= gain; f *= 2;
    if (f > 256) break;
  }
  return sum / norm;
}

// non-periodic smooth noise for runtime (cheap)
export function noise2(x, y) { return vnoise(x, y, 256); }

export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
export function sleep0() { return new Promise((r) => setTimeout(r, 0)); }
