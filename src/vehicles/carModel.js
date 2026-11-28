// Procedural car models built from scratch: a lofted body (cross-sections along the
// length) with flush glass, frit bands, wheel arches, wrap-around light clusters
// hugging the real surface, grille, badges of invented brands, readable plates,
// mirrors, shut lines, multi-part wheels (tyre, rim, disc, caliper, lugs), interior.
import * as THREE from 'three';
import { makeCanvas, toTexture } from '../core/textures.js';
import { RNG, clamp, lerp, smoothstep } from '../core/utils.js';
import { GeoBuilder } from '../core/geo.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STATE } from '../core/globals.js';

export function carDetail() { return { low: 0, medium: 1, high: 2, ultra: 3 }[STATE.quality] ?? 2; }

// ---------------------------------------------------------------- type specs
export const CAR_TYPES = {
  coupe: {
    brand: 'VORTEK', model: 'Strada GT', L: 4.5, W: 1.94, wb: 2.66, axleShift: 0.03, track: 1.66, wheelR: 0.345, tireW: 0.28,
    yBottom: 0.13, noseY: 0.6, beltY: 0.84, tailY: 0.9, roofY: 1.21, zWsBase: 0.78, zWsTop: -0.05, zRoofRear: -0.55, zRwBase: -1.5,
    roofW: 0.7, planN: 3.4, endW: 0.52, sporty: true, archPad: 0.06, caliper: [0.85, 0.05, 0.05],
    mass: 1480, power: 520, maxRpm: 7800, gears: [3.3, 2.3, 1.75, 1.38, 1.12, 0.92, 0.78], final: 3.5, drive: 'rwd', cyl: 8,
    colors: [[0.6, 0.02, 0.03], [0.95, 0.72, 0.02], [0.02, 0.02, 0.025], [0.92, 0.92, 0.9], [0.95, 0.32, 0.02], [0.03, 0.18, 0.55], [0.3, 0.32, 0.35]],
  },
  sedan: {
    brand: 'AURELIA', model: 'Lumen', L: 4.84, W: 1.86, wb: 2.86, axleShift: 0.05, track: 1.6, wheelR: 0.33, tireW: 0.235,
    yBottom: 0.17, noseY: 0.68, beltY: 0.93, tailY: 0.99, roofY: 1.45, zWsBase: 1.0, zWsTop: 0.22, zRoofRear: -0.78, zRwBase: -1.38,
    roofW: 0.76, planN: 4.4, endW: 0.6, chrome: true, rearDoor: true, archPad: 0.06, caliper: [0.35, 0.35, 0.37],
    mass: 1560, power: 255, maxRpm: 6500, gears: [3.9, 2.3, 1.5, 1.15, 0.9, 0.75], final: 3.2, drive: 'fwd', cyl: 6,
    colors: [[0.75, 0.76, 0.78], [0.08, 0.09, 0.1], [0.12, 0.16, 0.26], [0.95, 0.95, 0.94], [0.35, 0.05, 0.06], [0.42, 0.43, 0.42], [0.2, 0.3, 0.22]],
  },
  suv: {
    brand: 'KODIAK', model: 'Atlas', L: 4.92, W: 1.98, wb: 2.93, axleShift: 0.02, track: 1.7, wheelR: 0.385, tireW: 0.27,
    yBottom: 0.27, noseY: 0.98, beltY: 1.12, tailY: 1.14, roofY: 1.8, zWsBase: 1.32, zWsTop: 0.72, zRoofRear: -2.18, zRwBase: -2.4,
    roofW: 0.84, planN: 7, endW: 0.7, rearDoor: true, archPad: 0.09, quarterGlass: true, rails: true, caliper: [0.3, 0.3, 0.32],
    mass: 2150, power: 380, maxRpm: 6200, gears: [4.2, 2.6, 1.7, 1.25, 1.0, 0.82, 0.68], final: 3.6, drive: 'awd', cyl: 8,
    colors: [[0.05, 0.05, 0.06], [0.88, 0.88, 0.86], [0.18, 0.22, 0.17], [0.38, 0.4, 0.42], [0.08, 0.12, 0.25], [0.5, 0.36, 0.22]],
  },
  hatch: {
    brand: 'PICO', model: 'Citi', L: 3.98, W: 1.76, wb: 2.52, axleShift: 0.06, track: 1.52, wheelR: 0.305, tireW: 0.205,
    yBottom: 0.16, noseY: 0.72, beltY: 0.94, tailY: 1.0, roofY: 1.49, zWsBase: 0.92, zWsTop: 0.18, zRoofRear: -1.5, zRwBase: -1.9,
    roofW: 0.8, planN: 5, endW: 0.62, rearDoor: true, archPad: 0.055, quarterGlass: true, caliper: [0.3, 0.3, 0.32],
    mass: 1150, power: 135, maxRpm: 6800, gears: [3.6, 2.0, 1.35, 1.03, 0.82], final: 4.0, drive: 'fwd', cyl: 4,
    colors: [[0.1, 0.55, 0.75], [0.9, 0.85, 0.2], [0.85, 0.1, 0.12], [0.95, 0.95, 0.95], [0.4, 0.72, 0.3], [0.9, 0.45, 0.6]],
  },
  taxi: null, // filled below from sedan
  van: {
    brand: 'MARLIN', model: 'Cargo', L: 5.3, W: 2.02, wb: 3.3, axleShift: 0.1, track: 1.72, wheelR: 0.36, tireW: 0.24,
    yBottom: 0.24, noseY: 1.0, beltY: 1.18, tailY: 2.2, roofY: 2.3, zWsBase: 1.95, zWsTop: 1.35, zRoofRear: -2.52, zRwBase: -2.6,
    roofW: 0.92, planN: 9, endW: 0.82, cargo: true, archPad: 0.08, caliper: [0.3, 0.3, 0.32],
    mass: 2400, power: 210, maxRpm: 5200, gears: [4.0, 2.4, 1.5, 1.0, 0.78], final: 3.9, drive: 'rwd', cyl: 6,
    colors: [[0.95, 0.95, 0.95], [0.85, 0.85, 0.85], [0.12, 0.3, 0.6]],
  },
};
CAR_TYPES.taxi = { ...CAR_TYPES.sedan, model: 'Lumen Taxi', taxi: true, colors: [[0.98, 0.72, 0.02]] };
export const TYPE_KEYS = ['coupe', 'sedan', 'suv', 'hatch', 'taxi', 'van'];

// ---------------------------------------------------------------- shared materials & textures
let SHARED = null;
function logoTexture(brand) {
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const chrome = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#fdfdfd'); g.addColorStop(0.45, '#9aa0a6'); g.addColorStop(0.55, '#e8eaec'); g.addColorStop(1, '#5d6268'); return g; };
  ctx.save(); ctx.translate(S / 2, S / 2);
  if (brand === 'VORTEK') {
    ctx.beginPath(); ctx.moveTo(-80, -95); ctx.lineTo(80, -95); ctx.lineTo(80, 10); ctx.quadraticCurveTo(80, 80, 0, 110); ctx.quadraticCurveTo(-80, 80, -80, 10); ctx.closePath();
    ctx.fillStyle = chrome(-80, -95, 80, 110); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-66, -82); ctx.lineTo(66, -82); ctx.lineTo(66, 8); ctx.quadraticCurveTo(66, 66, 0, 94); ctx.quadraticCurveTo(-66, 66, -66, 8); ctx.closePath();
    ctx.fillStyle = '#b3001b'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-50, -60); ctx.lineTo(-22, -60); ctx.lineTo(0, 20); ctx.lineTo(22, -60); ctx.lineTo(50, -60); ctx.lineTo(8, 70); ctx.lineTo(-8, 70); ctx.closePath();
    ctx.fillStyle = chrome(-50, -60, 50, 70); ctx.fill();
  } else if (brand === 'AURELIA') {
    ctx.lineWidth = 16; ctx.strokeStyle = chrome(-100, -60, 100, 60);
    ctx.beginPath(); ctx.ellipse(0, 0, 108, 70, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = chrome(-60, -60, 60, 60);
    ctx.beginPath(); ctx.moveTo(0, -52); ctx.lineTo(42, 48); ctx.lineTo(24, 48); ctx.lineTo(0, -10); ctx.lineTo(-24, 48); ctx.lineTo(-42, 48); ctx.closePath(); ctx.fill();
    ctx.fillRect(-26, 14, 52, 10);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 50, -6); ctx.quadraticCurveTo(s * 90, -30, s * 98, 0); ctx.quadraticCurveTo(s * 80, -8, s * 50, 6); ctx.fill(); }
  } else if (brand === 'KODIAK') {
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(Math.cos(a) * 110, Math.sin(a) * 110); } ctx.closePath();
    ctx.fillStyle = chrome(-110, -110, 110, 110); ctx.fill();
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(Math.cos(a) * 92, Math.sin(a) * 92); } ctx.closePath();
    ctx.fillStyle = '#16181a'; ctx.fill();
    ctx.fillStyle = chrome(-60, -60, 60, 60);
    for (let k = -1; k <= 1; k++) { ctx.save(); ctx.rotate(k * 0.18); ctx.beginPath(); ctx.moveTo(k * 30 - 9, -60); ctx.lineTo(k * 30 + 9, -60); ctx.lineTo(k * 26 + 5, 30); ctx.lineTo(k * 26 - 5, 30); ctx.closePath(); ctx.fill(); ctx.restore(); }
    ctx.beginPath(); ctx.ellipse(0, 52, 44, 22, 0, 0, Math.PI * 2); ctx.fill();
  } else if (brand === 'PICO') {
    ctx.fillStyle = chrome(-110, -110, 110, 110); ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a58a8'; ctx.beginPath(); ctx.arc(0, 0, 94, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 150px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('p', -6, -10);
    ctx.beginPath(); ctx.arc(46, 40, 14, 0, Math.PI * 2); ctx.fill();
  } else { // MARLIN
    ctx.fillStyle = chrome(-110, -110, 110, 110); ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#006d77'; ctx.beginPath(); ctx.arc(0, 0, 94, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = chrome(-80, -80, 80, 80);
    ctx.beginPath(); ctx.moveTo(-70, 30); ctx.quadraticCurveTo(-10, -90, 70, -40); ctx.quadraticCurveTo(10, -40, 0, 50); ctx.quadraticCurveTo(-30, 20, -70, 30); ctx.fill();
  }
  ctx.restore();
  return toTexture(c, { repeat: false });
}

function plateTexture(text) {
  const c = makeCanvas(256, 128), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#fbfbf7'); g.addColorStop(1, '#e7ece9');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(255,140,60,0.35)'; ctx.beginPath(); ctx.arc(128, 70, 34, 0, Math.PI * 2); ctx.fill(); // sun motif
  ctx.fillStyle = '#0d6e3b'; ctx.font = 'bold 20px Arial, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('NEON COAST', 128, 26);
  ctx.fillStyle = '#123'; ctx.font = 'bold 62px "Arial Narrow", Arial, sans-serif';
  ctx.fillText(text, 128, 96);
  ctx.fillStyle = '#0d6e3b'; ctx.font = '13px Arial, sans-serif'; ctx.fillText('SUNSHINE  ·  COAST', 128, 118);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 122);
  return toTexture(c, { repeat: false, aniso: 4 });
}

function tireTexture() {
  const W = 512, H = 128, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, W, H);
  // v across profile: 0..0.3 sidewall A, 0.3..0.7 tread, 0.7..1 sidewall B (canvas y = 1 - v)
  for (let x = 0; x < W; x += 8) {
    ctx.fillStyle = '#060606';
    ctx.fillRect(x, H * 0.36, 3, H * 0.28);
    ctx.fillRect(x + 4, H * 0.42, 2, H * 0.16);
  }
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, H * 0.45, W, 3); ctx.fillRect(0, H * 0.55, W, 3);
  ctx.fillStyle = '#2e2e2e'; ctx.font = 'bold 15px Arial, sans-serif';
  for (let k = 0; k < 2; k++) {
    ctx.fillText('TERRAGRIP  P-ZERO  275/35 R20', 10 + k * 256, H * 0.17);
    ctx.save(); ctx.translate(10 + k * 256, H * 0.9); ctx.fillText('TERRAGRIP  SPORT  ·  M+S', 0, 0); ctx.restore();
  }
  return toTexture(c, { aniso: 4 });
}

function grilleTexture(kind) {
  const W = 256, H = 128, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#060707'; ctx.fillRect(0, 0, W, H);
  if (kind === 'hex') {
    ctx.strokeStyle = '#3a3d40'; ctx.lineWidth = 3;
    for (let y = 0; y < H + 16; y += 14) for (let x = (y / 14) % 2 ? 8 : 0; x < W + 16; x += 16) {
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); } ctx.closePath(); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = kind === 'chrome' ? '#c9ccd0' : '#2c2f33'; ctx.lineWidth = kind === 'chrome' ? 5 : 4;
    for (let y = 8; y < H; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.lineWidth = 2;
    for (let x = 8; x < W; x += 22) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  }
  return toTexture(c, { repeat: false, aniso: 4 });
}

function taxiSignTexture() {
  const c = makeCanvas(256, 64), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff6c8'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#111'; ctx.font = 'bold 44px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TAXI', 128, 34);
  ctx.fillStyle = '#111';
  for (let x = 0; x < 256; x += 16) { ctx.fillRect(x, 0, 8, 6); ctx.fillRect(x + 8, 58, 8, 6); }
  return toTexture(c, { repeat: false });
}

function clusterTexture() {
  const c = makeCanvas(256, 80), ctx = c.getContext('2d');
  ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, 256, 80);
  for (const [cx, lab] of [[64, 'km/h'], [192, 'rpm']]) {
    ctx.strokeStyle = '#2bd4ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, 44, 30, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
    ctx.strokeStyle = '#ff3355'; ctx.beginPath(); ctx.moveTo(cx, 44); ctx.lineTo(cx + 20, 30); ctx.stroke();
    ctx.fillStyle = '#9fe7ff'; ctx.font = '10px Arial'; ctx.textAlign = 'center'; ctx.fillText(lab, cx, 70);
  }
  ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.fillText('D', 128, 48);
  return toTexture(c, { repeat: false });
}
function screenTexture() {
  const c = makeCanvas(160, 96), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 160, 96); g.addColorStop(0, '#0a2540'); g.addColorStop(1, '#1d0b33');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 160, 96);
  ctx.strokeStyle = '#3ef0c8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, 80); ctx.bezierCurveTo(50, 20, 90, 90, 150, 30); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px Arial'; ctx.fillText('NEON FM 101.9', 10, 18);
  return toTexture(c, { repeat: false });
}

function getShared() {
  if (SHARED) return SHARED;
  SHARED = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x070a0d, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.86, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.25, metalness: 0.2 }),
    under: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 1.0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.85 }),
    housing: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.55, metalness: 0.15, envMapIntensity: 0.4 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4 }),
    redLens: new THREE.MeshPhysicalMaterial({ color: 0x6a0005, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false, clearcoat: 1, envMapIntensity: 2 }),
    tire: new THREE.MeshStandardMaterial({ map: tireTexture(), roughness: 0.82, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.18, metalness: 1.0 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.25, metalness: 0.9 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x6e6f72, roughness: 0.45, metalness: 0.9 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.75 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1e1c1b, roughness: 0.6 }),
    seatTan: new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.55 }),
    seatRed: new THREE.MeshStandardMaterial({ color: 0x3a0809, roughness: 0.55 }),
    cluster: new THREE.MeshBasicMaterial({ map: clusterTexture(), color: new THREE.Color(1.4, 1.4, 1.4) }),
    screen: new THREE.MeshBasicMaterial({ map: screenTexture(), color: new THREE.Color(1.2, 1.2, 1.2) }),
    liner: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.DoubleSide }),
    grille: { hex: grilleTexture('hex'), bars: grilleTexture('bars'), chrome: grilleTexture('chrome') },
    taxiSign: taxiSignTexture(),
    logos: {},
  };
  for (const b of ['VORTEK', 'AURELIA', 'KODIAK', 'PICO', 'MARLIN']) SHARED.logos[b] = new THREE.MeshStandardMaterial({ map: logoTexture(b), transparent: true, alphaTest: 0.3, roughness: 0.15, metalness: 0.8 });
  SHARED.darkVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  SHARED.wheelMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 1.0, side: THREE.DoubleSide });
  SHARED.rotor = new THREE.MeshStandardMaterial({ color: 0x6f7073, roughness: 0.38, metalness: 0.9 });
  // metallic flake normal map for paint (sparkles under the clear coat)
  {
    const S = 128, data = new Uint8Array(S * S * 4), r = new RNG(77);
    for (let i = 0; i < S * S; i++) {
      const a = r.range(0, Math.PI * 2), t = r.next() * 0.6;
      data[i * 4] = 128 + Math.cos(a) * t * 127; data[i * 4 + 1] = 128 + Math.sin(a) * t * 127; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }
    const ft = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(90, 45); ft.anisotropy = 4;
    ft.magFilter = THREE.NearestFilter; ft.minFilter = THREE.LinearMipmapLinearFilter; ft.generateMipmaps = true; ft.needsUpdate = true;
    SHARED.flakes = ft;
  }
  SHARED.grilleMats = {};
  for (const k of Object.keys(SHARED.grille)) SHARED.grilleMats[k] = new THREE.MeshStandardMaterial({ map: SHARED.grille[k], roughness: 0.4, metalness: 0.5 });
  return SHARED;
}

// ---------------------------------------------------------------- body section math
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class BodyShape {
  constructor(s) {
    this.s = s;
    this.zF = s.L / 2; this.zR = -s.L / 2;
    this.axF = s.wb / 2 + s.axleShift; this.axR = -s.wb / 2 + s.axleShift;
    this.archR = s.wheelR + s.archPad;
  }
  halfW(z) {
    const s = this.s;
    const u = clamp((z - (this.zF + this.zR) / 2) / (s.L / 2), -1, 1);
    const sup = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), s.planN)));
    return (s.W / 2) * (s.endW + (1 - s.endW) * sup);
  }
  belt(z) {
    const s = this.s;
    if (z > s.zWsBase) { const t = Math.min(1.2, (z - s.zWsBase) / Math.max(0.05, this.zF - s.zWsBase)); return s.beltY + (s.noseY - s.beltY) * Math.pow(t, 2.0); }
    if (z < s.zRwBase) { const t = Math.min(1.2, (s.zRwBase - z) / Math.max(0.05, s.zRwBase - this.zR)); return s.beltY + (s.tailY - s.beltY) * Math.pow(t, 0.8) - (s.sporty ? 0 : 0.02 * t); }
    return s.beltY + (s.zWsBase - z) * 0.012;
  }
  roof(z) {
    const s = this.s, b = this.belt(z);
    if (z >= s.zWsBase || z <= s.zRwBase) return b;
    if (z > s.zWsTop) { const t = (s.zWsBase - z) / (s.zWsBase - s.zWsTop); return b + (s.roofY - b) * (1 - Math.pow(1 - t, 1.5)); }
    if (z < s.zRoofRear) { const t = (z - s.zRwBase) / (s.zRoofRear - s.zRwBase); return b + (s.roofY - b) * (1 - Math.pow(1 - t, s.cargo ? 1 : 1.7)); }
    const mid = (s.zWsTop + s.zRoofRear) / 2, half = (s.zWsTop - s.zRoofRear) / 2;
    return s.roofY - 0.025 * Math.pow((z - mid) / half, 2);
  }
  bottom(z) {
    const s = this.s;
    const fo = smoothstep(this.axF + 0.3, this.zF, z), ro = smoothstep(this.axR - 0.3, this.zR, z);
    return s.yBottom + 0.16 * Math.max(fo, ro);
  }
  sill(z) {
    const s = this.s;
    let y = this.bottom(z) + 0.1;
    for (const az of [this.axF, this.axR]) {
      const dz = z - az;
      if (Math.abs(dz) < this.archR) y = Math.max(y, s.wheelR + Math.sqrt(this.archR * this.archR - dz * dz) * 0.98);
    }
    return y;
  }
  // control points of the +x half section
  controls(z) {
    const s = this.s;
    const w = this.halfW(z), yb = this.bottom(z), ys = Math.min(this.sill(z), this.belt(z) - 0.08), yBe = this.belt(z), yR = this.roof(z);
    const gh = yR - yBe;
    const g = clamp(gh / 0.1, 0, 1);
    const wr = w * s.roofW;
    // muscular fender flares over the wheels (lower body only)
    const fa = s.sporty ? 0.05 : s.cargo ? 0.008 : 0.026;
    const fl = fa * (Math.exp(-(((z - this.axF) / 0.62) ** 2)) + (s.sporty ? 1.3 : 1) * Math.exp(-(((z - this.axR) / 0.62) ** 2)));
    const wl = Math.min(w + fl, s.W / 2 + 0.03);
    const P = [
      [0, yb],
      [wl * 0.8, yb],
      [wl * 0.96, ys],
      [wl, ys + (yBe - ys) * 0.42],
      [wl * 0.985 - fl * 0.35, yBe - 0.06],
      [w * 0.935, yBe],
      [lerp(w * 0.74, wr + (w * 0.935 - wr) * 0.2, g), yBe + 0.014 + gh * 0.04],
      [lerp(w * 0.44, wr, g), yBe + 0.024 * (1 - g) + gh * 0.9],
      [lerp(w * 0.18, wr * 0.55, g), yR - 0.004 + 0.032 * (1 - g)],
      [0, yR + 0.012 + 0.036 * (1 - g)],
    ];
    // rounded nose and tail: inset the section along its own normals (a fillet
    // of different radius for the hood edge, the chin and the corners)
    let dT = 0, dB = 0, dS = 0;
    const fil = (t, R) => R * (1 - Math.sqrt(Math.max(0, 1 - t * t)));
    const cargo = s.cargo;
    if (z > this.zF - 0.3) {
      const Rt = cargo ? 0.07 : s.sporty ? 0.17 : 0.11, Rb = cargo ? 0.08 : 0.13, Rs = cargo ? 0.05 : 0.08;
      dT = fil(clamp((z - (this.zF - Rt)) / Rt, 0, 1), Rt); dB = fil(clamp((z - (this.zF - Rb)) / Rb, 0, 1), Rb); dS = fil(clamp((z - (this.zF - Rs)) / Rs, 0, 1), Rs);
    } else if (z < this.zR + 0.3) {
      const Rt = cargo ? 0.06 : 0.11, Rb = cargo ? 0.08 : 0.13, Rs = cargo ? 0.05 : 0.07;
      dT = fil(clamp(((this.zR + Rt) - z) / Rt, 0, 1), Rt); dB = fil(clamp(((this.zR + Rb) - z) / Rb, 0, 1), Rb); dS = fil(clamp(((this.zR + Rs) - z) / Rs, 0, 1), Rs);
    }
    if (dT + dB + dS > 0) {
      const H = P[9][1] - P[0][1];
      const k = Math.min(1, (H * 0.6) / Math.max(1e-4, dT + dB));
      dT *= k; dB *= k;
      const yMid = (P[0][1] + P[9][1]) / 2;
      const out = P.map((pt, i) => {
        let nx, ny;
        if (i === 0) { nx = 0; ny = -1; } else if (i === 9) { nx = 0; ny = 1; } else {
          const a = P[i - 1], c = P[i + 1];
          nx = c[1] - a[1]; ny = -(c[0] - a[0]);
          const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
          if (nx * pt[0] + ny * (pt[1] - yMid) < 0) { nx = -nx; ny = -ny; }
        }
        const d = (ny > 0 ? ny * dT : -ny * dB) + Math.abs(nx) * dS;
        return [Math.max(0, pt[0] - nx * d), pt[1] - ny * d];
      });
      return out;
    }
    return P;
  }
  // continuous contour parameter c in [0, 9]
  point(z, c, side = 1) {
    const P = this.controls(z);
    const i = clamp(Math.floor(c), 0, 8), t = c - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(9, i + 2)];
    return [catmull(p0[0], p1[0], p2[0], p3[0], t) * side, catmull(p0[1], p1[1], p2[1], p3[1], t), z];
  }
  // surface point + outward normal
  surf(z, c, side, off = 0) {
    const p = this.point(z, c, side);
    const a = this.point(z + 0.01, c, side), b = this.point(z - 0.01, c, side);
    const d = this.point(z, Math.min(9, c + 0.02), side), e = this.point(z, Math.max(0, c - 0.02), side);
    const tz = new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const tc = new THREE.Vector3(d[0] - e[0], d[1] - e[1], d[2] - e[2]);
    const n = new THREE.Vector3().crossVectors(tz, tc).normalize();
    const out = new THREE.Vector3(p[0], p[1] - 0.6, 0);
    if (n.dot(out) < 0) n.negate();
    return { p: new THREE.Vector3(p[0] + n.x * off, p[1] + n.y * off, p[2] + n.z * off), n };
  }
  // grid patch hugging the body; returns BufferGeometry
  patch(z0, z1, c0, c1, side, off, nz = 6, nc = 4, skirt = 0) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let i = 0; i <= nz; i++) for (let j = 0; j <= nc; j++) {
      const z = lerp(z0, z1, i / nz), c = lerp(c0, c1, j / nc);
      const s = this.surf(z, c, side, off);
      pos.push(s.p.x, s.p.y, s.p.z); nrm.push(s.n.x, s.n.y, s.n.z); uv.push(i / nz, j / nc);
    }
    for (let i = 0; i < nz; i++) for (let j = 0; j < nc; j++) {
      const a = i * (nc + 1) + j, b = a + 1, c = a + nc + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    if (skirt) {
      // side wall back into the body along the boundary
      const ring = [];
      for (let i = 0; i <= nz; i++) ring.push([i, 0]);
      for (let j = 1; j <= nc; j++) ring.push([nz, j]);
      for (let i = nz - 1; i >= 0; i--) ring.push([i, nc]);
      for (let j = nc - 1; j >= 1; j--) ring.push([0, j]);
      const base = pos.length / 3;
      for (const [i, j] of ring) {
        const z = lerp(z0, z1, i / nz), c = lerp(c0, c1, j / nc);
        const s = this.surf(z, c, side, off - skirt);
        pos.push(s.p.x, s.p.y, s.p.z); nrm.push(s.n.x, s.n.y, s.n.z); uv.push(0, 0);
      }
      for (let k = 0; k < ring.length; k++) {
        const k1 = (k + 1) % ring.length;
        const a = ring[k][0] * (nc + 1) + ring[k][1], b = ring[k1][0] * (nc + 1) + ring[k1][1];
        idx.push(a, base + k, b, b, base + k, base + k1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // make winding consistent with normals
    fixWinding(g);
    return g;
  }
}

function fixWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  let agree = 0;
  for (let t = 0; t < ix.length; t += 3) {
    a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]);
    fn.subVectors(b, a).cross(c.sub(a));
    vn.fromBufferAttribute(n, ix[t]);
    agree += fn.dot(vn) >= 0 ? 1 : -1;
  }
  if (agree < 0) for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
}

// ---------------------------------------------------------------- body mesh
export function buildBody(shape, NS = 16, sub = 1) {
  const s = shape.s;
  const zs = [];
  for (let i = 0; i < NS; i++) {
    const t = i / (NS - 1);
    const cosT = 0.5 - 0.5 * Math.cos(Math.PI * t);
    zs.push(shape.zR + (shape.zF - shape.zR) * (0.45 * t + 0.55 * cosT));
  }
  // half contour sample params
  const params = [];
  for (let i = 0; i < 9; i++) for (let k = 0; k < sub; k++) params.push(i + k / sub);
  params.push(9);
  const P = params.length;
  const R = 2 * (P - 1);
  const pos = new Float32Array(NS * R * 3);
  const uv = new Float32Array(NS * R * 2);
  for (let i = 0; i < NS; i++) {
    const z = zs[i];
    for (let k = 0; k < R; k++) {
      const half = k < P ? k : 2 * (P - 1) - k;
      const side = k < P ? 1 : -1;
      const p = shape.point(z, params[half], side);
      const o = (i * R + k) * 3;
      pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
      uv[(i * R + k) * 2] = (z - shape.zR) / s.L; uv[(i * R + k) * 2 + 1] = k / R;
    }
  }
  // classify cells
  const zone = (zm) => {
    if (zm < s.zWsBase && zm > s.zWsTop) return 'ws';
    if (zm <= s.zWsTop && zm >= s.zRoofRear) return 'roof';
    if (zm < s.zRoofRear && zm > s.zRwBase) return 'rw';
    return 'none';
  };
  const bPillar = s.rearDoor ? lerp(s.zWsTop, s.zRoofRear, 0.48) : null;
  const cls = new Uint8Array((NS - 1) * R); // 0 paint, 1 glass, 2 trim, 3 under
  for (let i = 0; i < NS - 1; i++) {
    const zm = (zs[i] + zs[i + 1]) / 2;
    const zn = zone(zm);
    for (let k = 0; k < R; k++) {
      const half = k < P - 1 ? k : 2 * (P - 1) - k - 1;
      const seg = Math.floor(params[Math.min(half, P - 2)]);
      let c = 0;
      if (seg <= 1) c = 3;
      if (seg === 6) {
        if (zn === 'roof') {
          c = 1;
          if (bPillar !== null && Math.abs(zm - bPillar) < 0.06) c = 2;
          if (s.cargo && zm < s.zWsTop - 0.7) c = 0;
        } else if (zn === 'rw' && (s.quarterGlass || (s.rearDoor && zm > s.zRoofRear - 0.22) || (s.sporty && zm > s.zRoofRear - 0.3))) c = 1;
        else if (zn === 'ws') c = (shape.roof(zm) - shape.belt(zm)) > 0.16 && !s.cargo ? 1 : (s.cargo && zm < s.zWsBase - 0.15 ? 1 : 0);
      }
      if (seg >= 7) {
        if (zn === 'ws') c = 1;
        else if (zn === 'rw') c = 1;
      }
      cls[i * R + k] = c;
    }
  }
  // frit: glass cells touching non-glass become trim
  const cls2 = cls.slice();
  for (let i = 0; i < NS - 1; i++) for (let k = 0; k < R; k++) {
    if (cls[i * R + k] !== 1) continue;
    const nb = [[i - 1, k], [i + 1, k], [i, (k + 1) % R], [i, (k - 1 + R) % R]];
    for (const [a, b] of nb) {
      if (a < 0 || a >= NS - 1) { cls2[i * R + k] = 2; break; }
      if (cls[a * R + b] !== 1) { cls2[i * R + k] = 2; break; }
    }
  }
  const groups = [[], [], [], []];
  for (let i = 0; i < NS - 1; i++) for (let k = 0; k < R; k++) {
    const k1 = (k + 1) % R;
    const a = i * R + k, b = i * R + k1, c = (i + 1) * R + k1, d = (i + 1) * R + k;
    groups[cls2[i * R + k]].push(a, b, c, a, c, d);
  }
  // caps
  const capVerts = [];
  const extraPos = [], extraUv = [];
  const capIdx = [];
  const addCap = (i, normalZ) => {
    const base = NS * R + extraPos.length / 3;
    let cy = 0;
    for (let k = 0; k < R; k++) cy += pos[(i * R + k) * 3 + 1];
    cy /= R;
    extraPos.push(0, cy, zs[i] + normalZ * 0.018); extraUv.push(0.5, 0.5);
    for (let k = 0; k < R; k++) { const o = (i * R + k) * 3; extraPos.push(pos[o], pos[o + 1], pos[o + 2]); extraUv.push(0, 0); }
    for (let k = 0; k < R; k++) {
      const k1 = (k + 1) % R;
      if (normalZ > 0) capIdx.push(base, base + 1 + k1, base + 1 + k);
      else capIdx.push(base, base + 1 + k, base + 1 + k1);
    }
  };
  addCap(NS - 1, 1); addCap(0, -1);
  const allPos = new Float32Array(pos.length + extraPos.length);
  allPos.set(pos); allPos.set(extraPos, pos.length);
  const allUv = new Float32Array(uv.length + extraUv.length);
  allUv.set(uv); allUv.set(extraUv, uv.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
  const index = [];
  const order = [0, 1, 2, 3];
  let start = 0;
  const groupDefs = [];
  for (const gi of order) {
    let list = groups[gi];
    if (gi === 0) list = list.concat(capIdx);
    index.push(...list);
    groupDefs.push([start, list.length, gi]);
    start += list.length;
  }
  g.setIndex(index);
  for (const [st, cnt, mi] of groupDefs) g.addGroup(st, cnt, mi);
  g.computeVertexNormals();
  // orient: ensure the roof-top normal points up
  const n = g.attributes.normal;
  const topIdx = Math.floor(NS / 2) * R + (P - 1);
  if (n.getY(topIdx) < 0) {
    const ix = g.index.array;
    for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
    g.computeVertexNormals();
  }
  // caps: make sure each fan faces outward (+z front, -z rear)
  {
    const ix = g.index.array, P = g.attributes.position.array;
    const capStart = groupDefs[0][0] + groups[0].length;
    const half = capIdx.length / 2;
    for (const [from, want] of [[capStart, 1], [capStart + half, -1]]) {
      const a = ix[from] * 3, b = ix[from + 1] * 3, c = ix[from + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1];
      const nz = ux * vy - uy * vx;
      if (Math.sign(nz) !== want) for (let t = from; t < from + half; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
    }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  g.userData = { NS, R };
  return g;
}

// ---------------------------------------------------------------- wheels
// D = detail level 0..3
function buildWheel(spec, sh, side, D = 2) {
  const r = spec.wheelR, tw = spec.tireW;
  const rimR = r * (spec.sporty ? 0.75 : spec.brand === 'KODIAK' ? 0.66 : spec.cargo ? 0.62 : 0.69);
  const seg = [20, 32, 48, 64][D];
  const g = new THREE.Group();
  // --- tyre sidewalls: lathe profiles (bulging sidewall, rounded shoulder)
  const sw = r - rimR;
  for (const sgn of [1, -1]) {
    const prof = [
      [rimR + 0.004, tw / 2 - 0.014], [rimR + sw * 0.25, tw / 2 + 0.004], [rimR + sw * 0.6, tw / 2 + 0.008],
      [r - 0.03, tw / 2 + 0.002], [r - 0.012, tw / 2 - 0.012], [r - 0.004, tw / 2 - 0.028],
    ].map(([rr, x]) => new THREE.Vector2(rr, x * sgn));
    if (sgn < 0) prof.reverse();
    const lg = new THREE.LatheGeometry(prof, seg);
    const uv = lg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, sgn > 0 ? 0.02 + uv.getY(i) * 0.28 : 0.7 + uv.getY(i) * 0.28);
    lg.rotateZ(-Math.PI / 2);
    g.add(new THREE.Mesh(lg, sh.tire));
  }
  // --- tread crown with real grooves and sipes
  {
    const N = seg * 2, M = [6, 8, 12, 14][D];
    const pos = [], uv = [], idx = [];
    const x0 = -tw / 2 + 0.028, x1 = tw / 2 - 0.028;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      for (let j = 0; j <= M; j++) {
        const f = j / M;
        const x = lerp(x0, x1, f);
        let rr = r - 0.004 * Math.pow(Math.abs(f - 0.5) * 2, 4);
        for (const gc of [0.27, 0.5, 0.73]) if (Math.abs(f - gc) < 0.045) rr -= 0.007;
        const blk = Math.floor(i / 2) % 2;
        if ((f < 0.22 || f > 0.78) && i % 4 === 0) rr -= 0.005;
        if (f > 0.32 && f < 0.68 && (i + blk) % 6 === 0 && D > 1) rr -= 0.003;
        pos.push(x, rr * Math.sin(a), rr * Math.cos(a));
        uv.push((i / N) * 2, 0.36 + f * 0.28);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const A = i * (M + 1) + j, B = A + 1, C = A + M + 1, Dd = C + 1;
      idx.push(A, C, B, B, C, Dd);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tg.setIndex(idx); tg.computeVertexNormals();
    // orient outward
    const n = tg.attributes.normal;
    const nx = n.getY((M + 1) * Math.floor(N / 4) + Math.floor(M / 2));
    if (nx < 0) { const ix = tg.index.array; for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; } tg.computeVertexNormals(); }
    g.add(new THREE.Mesh(tg, sh.tire));
  }
  // --- rim
  const metal = spec.sporty || spec.brand === 'KODIAK' ? sh.rimDark : sh.rim;
  const xr = tw / 2 - 0.016, xh = tw / 2 - (spec.sporty ? 0.075 : 0.055);
  const rh = rimR * 0.3;
  const toX = (geo) => { geo.rotateZ(Math.PI / 2); return geo; };
  const barrel = toX(new THREE.CylinderGeometry(rimR * 0.97, rimR * 0.97, tw - 0.04, seg, 1, true));
  g.add(new THREE.Mesh(barrel, sh.disc));
  const lip = new THREE.TorusGeometry(rimR * 0.985, 0.013, 8, seg); lip.rotateY(Math.PI / 2); lip.translate(xr + 0.004, 0, 0);
  g.add(new THREE.Mesh(lip, metal));
  const lip2 = new THREE.TorusGeometry(rimR * 0.985, 0.01, 6, seg); lip2.rotateY(Math.PI / 2); lip2.translate(-tw / 2 + 0.015, 0, 0);
  g.add(new THREE.Mesh(lip2, sh.disc));
  // concave lofted spokes
  const nSp = spec.sporty ? 5 : spec.brand === 'KODIAK' ? 6 : spec.cargo ? 8 : spec.brand === 'PICO' ? 4 : 5;
  const twin = spec.sporty || spec.brand === 'AURELIA';
  const spokeB = new GeoBuilder();
  const K = [4, 5, 7, 9][D];
  for (let si = 0; si < nSp; si++) {
    const angles = twin ? [-0.085, 0.085] : [0];
    for (const da of angles) {
      const th = (si / nSp) * Math.PI * 2 + da;
      const rd = [0, Math.sin(th), Math.cos(th)], td = [0, Math.cos(th), -Math.sin(th)];
      const rings = [];
      for (let k = 0; k <= K; k++) {
        const t = k / K;
        const rho = lerp(rh * 0.95, rimR * 0.965, t);
        const wd = (twin ? lerp(0.03, 0.022, t) : lerp(0.06, 0.042, t)) * (spec.cargo ? 0.8 : 1);
        const tk = lerp(0.03, 0.016, t);
        const xc = lerp(xh, xr, Math.pow(t, 0.65));
        const sec = [[-wd / 2, -tk * 0.4], [-wd * 0.45, tk * 0.55], [-wd * 0.2, tk], [wd * 0.2, tk], [wd * 0.45, tk * 0.55], [wd / 2, -tk * 0.4]];
        rings.push(sec.map(([u, hgt]) => [xc + hgt, rd[1] * rho + td[1] * u, rd[2] * rho + td[2] * u]));
      }
      const base = spokeB.n;
      const S = 6;
      for (const ring of rings) for (const q of ring) spokeB.vert(q[0], q[1], q[2], 1, 0, 0, 0, 0);
      for (let k = 0; k < K; k++) for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        const A = base + k * S + j, B = base + k * S + j1, C = base + (k + 1) * S + j1, Dd = base + (k + 1) * S + j;
        spokeB.idx.push(A, B, C, A, C, Dd);
      }
    }
  }
  const spokeG = spokeB.build();
  spokeG.computeVertexNormals();
  g.add(new THREE.Mesh(spokeG, metal));
  // hub, lug nuts, centre cap
  const hub = toX(new THREE.CylinderGeometry(rh * 1.05, rh * 1.15, 0.03, seg)); hub.translate(xh - 0.004, 0, 0);
  g.add(new THREE.Mesh(hub, metal));
  const lugs = [];
  const nLug = spec.mass > 2000 ? 6 : 5;
  for (let i = 0; i < nLug; i++) {
    const a = (i / nLug) * Math.PI * 2;
    const l = toX(new THREE.CylinderGeometry(0.0105, 0.0115, 0.028, 6)); l.translate(xh + 0.018, Math.cos(a) * rh * 0.6, Math.sin(a) * rh * 0.6);
    lugs.push(l);
  }
  g.add(new THREE.Mesh(mergeSimple(lugs), sh.chrome));
  const cap = new THREE.CircleGeometry(rh * 0.42, 20); cap.rotateY(Math.PI / 2); cap.translate(xh + 0.022, 0, 0);
  g.add(new THREE.Mesh(cap, sh.logos[spec.brand]));
  // vented brake disc with hat
  const disc = toX(new THREE.CylinderGeometry(rimR * 0.83, rimR * 0.83, 0.028, seg)); disc.translate(0.0, 0, 0);
  g.add(new THREE.Mesh(disc, sh.rotor));
  const hat = toX(new THREE.CylinderGeometry(rh * 1.1, rh * 1.1, 0.05, seg)); hat.translate(0.02, 0, 0);
  g.add(new THREE.Mesh(hat, sh.disc));
  if (side < 0) g.rotation.y = Math.PI;
  return g;
}

// caliper hugging the top-rear of the disc (attached to the steering knuckle)
function caliperGeometry(spec) {
  const rimR = spec.wheelR * (spec.sporty ? 0.75 : 0.68);
  const ro = rimR * 0.88, ri = rimR * 0.58, c = 0.55, span = spec.sporty ? 0.5 : 0.36;
  const sh = new THREE.Shape();
  sh.absarc(0, 0, ro, Math.PI / 2 - c - span, Math.PI / 2 - c + span, false);
  sh.absarc(0, 0, ri, Math.PI / 2 - c + span, Math.PI / 2 - c - span, true);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.025);
  g.rotateY(Math.PI / 2);
  return g;
}

function mergeSimple(geos) {
  const pos = [], nrm = [], idx = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (const i of g.index.array) idx.push(base + i); else for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  m.setIndex(idx);
  return m;
}

// merge every static mesh under `group` into one mesh per material (fewer draw calls)
// remap: Map(material -> { target, color:[r,g,b], uv:[u,v] }) folds several materials into one
function mergeByMaterial(group, keep = new Set(), castShadow = false, remap = null, layer = 0) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  group.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || keep.has(o)) return;
    for (let p = o.parent; p && p !== group; p = p.parent) if (keep.has(p)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const r = remap && remap.get(o.material);
    const target = r ? r.target : o.material;
    if (!buckets.has(target)) buckets.set(target, new GeoBuilder({ color: !!r }));
    const b = buckets.get(target);
    b.addGeometry(o.geometry, m, r ? r.color : null, r ? r.uv : null);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  // drop empty helper groups
  const empties = [];
  group.traverse((o) => { if (o !== group && o.type === 'Group' && o.children.length === 0) empties.push(o); });
  for (const e of empties) e.parent && e.parent.remove(e);
  for (const [mat, b] of buckets) {
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.castShadow = castShadow;
    if (layer) mesh.layers.set(layer);
    group.add(mesh);
  }
}
const col3 = (m) => [m.color.r, m.color.g, m.color.b];

let FAR_LIGHTS = null;
export function farLightMaterials() {
  if (!FAR_LIGHTS) FAR_LIGHTS = {
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.3, 0.3) }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.02, 0.02) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6 }),
  };
  return FAR_LIGHTS;
}
export function updateFarLights(night) {
  const F = farLightMaterials();
  const k = smoothstep(0.3, 0.7, night);
  F.head.color.setRGB(0.35 + k * 6, 0.35 + k * 5.6, 0.33 + k * 5);
  F.tail.color.setRGB(0.25 + k * 2.2, 0.02 + k * 0.04, 0.02 + k * 0.03);
}

// ---------------------------------------------------------------- full car
const plateChars = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export function randomPlate(rng) {
  return `${rng.int(1, 9)}${plateChars[rng.int(0, plateChars.length - 1)]}${plateChars[rng.int(0, plateChars.length - 1)]} ${rng.int(100, 999)}`;
}

export function buildCar(typeKey, { color = null, rng = new RNG(1), plate = null } = {}) {
  const spec = CAR_TYPES[typeKey];
  const sh = getShared();
  const shape = new BodyShape(spec);
  const root = new THREE.Group();
  root.name = 'car_' + typeKey;
  const col = color || rng.pick(spec.colors);
  const metallic = !(spec.taxi || spec.cargo);
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(col[0], col[1], col[2]),
    metalness: metallic ? 0.6 : 0.08, roughness: metallic ? 0.3 : 0.36,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3,
    normalMap: metallic ? sh.flakes : null, normalScale: new THREE.Vector2(0.07, 0.07),
  });
  // per-car light materials (independent brake / blinker state)
  const L = {
    head: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.96, 0.9), emissiveIntensity: 0.0, roughness: 0.3, metalness: 0.6 }),
    drl: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0.85, 0.92, 1), emissiveIntensity: 2.0 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: new THREE.Color(1, 0.02, 0.01), emissiveIntensity: 0.15, roughness: 0.4 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: new THREE.Color(1, 0.02, 0.01), emissiveIntensity: 0.0, roughness: 0.4 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.0, roughness: 0.3 }),
    indL: new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: new THREE.Color(1, 0.45, 0.02), emissiveIntensity: 0.0 }),
    indR: new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: new THREE.Color(1, 0.45, 0.02), emissiveIntensity: 0.0 }),
  };
  // all lamps share one material; a 8x1 float texture holds each lamp's emissive
  const LIGHT_ORDER = ['head', 'drl', 'tail', 'brake', 'reverse', 'indL', 'indR'];
  const lightData = new Float32Array(8 * 4);
  const lightTex = new THREE.DataTexture(lightData, 8, 1, THREE.RGBAFormat, THREE.FloatType);
  lightTex.minFilter = lightTex.magFilter = THREE.NearestFilter;
  lightTex.needsUpdate = true;
  const lightsMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveMap: lightTex, roughness: 0.35, metalness: 0.3 });
  const syncLights = () => {
    LIGHT_ORDER.forEach((k, i) => {
      const m = L[k], e = m.emissive, I = m.emissiveIntensity;
      lightData[i * 4] = e.r * I; lightData[i * 4 + 1] = e.g * I; lightData[i * 4 + 2] = e.b * I; lightData[i * 4 + 3] = 1;
    });
    lightTex.needsUpdate = true;
  };
  const plateText = plate || randomPlate(rng);
  const zF = shape.zF, zR = shape.zR;
  const front = shape.controls(zF);
  const noseY = front[5][1], botY = front[0][1];
  const fh = noseY - botY;
  const halfEnd = front[3][0];
  const rear = shape.controls(zR);
  const tailTop = rear[5][1], rbot = rear[0][1], rh = tailTop - rbot;
  const rearHalf = rear[3][0];
  const wy = spec.wheelR, hx = spec.track / 2;
  const wheelSlots = [];
  for (const [az, isFront] of [[shape.axF, true], [shape.axR, false]]) for (const side of [1, -1]) wheelSlots.push({ az, front: isFront, side });

  // --- far LOD: one mesh, 4 draw calls (paint / dark / head / tail)
  const F = farLightMaterials();
  const far = new THREE.Group();
  {
    const low = buildBody(shape, 18, 1);
    const pos = low.attributes.position, nrm = low.attributes.normal;
    const paintB = new GeoBuilder(), darkB = new GeoBuilder(), headB = new GeoBuilder(), tailB = new GeoBuilder();
    const ix = low.index.array;
    for (const grp of low.groups) {
      const B = grp.materialIndex === 0 ? paintB : darkB;
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const k = ix[i];
        B.vert(pos.getX(k), pos.getY(k), pos.getZ(k), nrm.getX(k), nrm.getY(k), nrm.getZ(k), 0, 0);
        B.idx.push(B.n - 1);
      }
    }
    low.dispose();
    const simpleWheel = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, spec.tireW, 10); simpleWheel.rotateZ(Math.PI / 2);
    for (const w of wheelSlots) darkB.addGeometry(simpleWheel, new THREE.Matrix4().makeTranslation(w.side * hx, wy, w.az));
    for (const side of [1, -1]) {
      headB.addGeometry(new THREE.PlaneGeometry(0.28, 0.1), new THREE.Matrix4().makeTranslation(side * halfEnd * 0.82, noseY - 0.1, zF + 0.025));
      tailB.addGeometry(new THREE.PlaneGeometry(0.3, 0.1), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(side * rearHalf * 0.8, tailTop - 0.12, zR - 0.025));
    }
    for (const [B, mat, cast] of [[paintB, paint, true], [darkB, F.dark, true], [headB, F.head, false], [tailB, F.tail, false]]) {
      const m = new THREE.Mesh(B.build(), mat); m.castShadow = cast; far.add(m);
    }
  }
  const lod = new THREE.LOD();
  lod.addLevel(far, 0);
  lod.addLevel(new THREE.Object3D(), 340);
  root.add(lod);
  root.userData.lod = lod;

  const car = { root, body: null, near: null, far, wheels: null, lights: L, syncLights, paint, spec, shape, plate: plateText, type: typeKey, built: false, perCar: [paint, lightsMat, lightTex, ...Object.values(L)] };

  // --- full-detail model, built the first time the car is seen up close
  car.buildNear = (D = 2) => {
    if (car.built) return;
    const NS = [64, 90, 130, 180][D], SUB = [3, 4, 6, 8][D];
    const body = new THREE.Mesh(buildBody(shape, NS, SUB), [paint, sh.glass, sh.trim, sh.under]);
    body.castShadow = true; body.receiveShadow = true;
    const near = new THREE.Group();
    near.add(body);
    const addG = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = false; near.add(m); return m; };
    const pq = D >= 2 ? 2 : 1; // patch resolution multiplier

    // headlights (asymmetric internals: one projector + LED row + L-shaped DRL + corner indicator)
    const hlZ0 = zF - 0.36, hlZ1 = zF - 0.01;
    const hlC0 = spec.cargo ? 3.2 : 3.4, hlC1 = spec.cargo ? 4.2 : 4.45;
    for (const side of [1, -1]) {
      addG(shape.patch(hlZ0, hlZ1, hlC0, hlC1, side, 0.002, 7 * pq, 4 * pq), sh.housing);
      const mid = shape.surf(lerp(hlZ0, hlZ1, 0.62), lerp(hlC0, hlC1, 0.5), side, 0.004);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), sh.chrome);
      bowl.position.copy(mid.p).addScaledVector(mid.n, -0.01); bowl.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), mid.n); near.add(bowl);
      const proj = new THREE.Mesh(new THREE.SphereGeometry(0.034, 18, 12), L.head);
      proj.position.copy(mid.p).addScaledVector(mid.n, 0.004); near.add(proj);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.007, 8, 28), sh.chrome);
      ring.position.copy(mid.p).addScaledVector(mid.n, 0.008); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mid.n); near.add(ring);
      for (let k = 0; k < 4; k++) {
        const s2 = shape.surf(lerp(hlZ0, hlZ1, 0.14 + k * 0.08), lerp(hlC0, hlC1, 0.45), side, 0.005);
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.012), L.head);
        led.position.copy(s2.p); led.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s2.n); near.add(led);
      }
      addG(shape.patch(hlZ0 + 0.02, hlZ1 - 0.01, hlC1 - 0.12, hlC1 - 0.05, side, 0.006, 7 * pq, 1), L.drl);
      addG(shape.patch(hlZ1 - 0.05, hlZ1 - 0.012, hlC0 + 0.15, hlC1 - 0.05, side, 0.006, 1, 3 * pq), L.drl);
      addG(shape.patch(hlZ0 + 0.005, hlZ0 + 0.07, hlC0 + 0.1, hlC1 - 0.18, side, 0.006, 2, 2), side > 0 ? L.indL : L.indR);
      addG(shape.patch(hlZ0 - 0.005, hlZ1 + 0.002, hlC0 - 0.05, hlC1 + 0.05, side, 0.011, 8 * pq, 5 * pq, 0.011), sh.lens);
      addG(shape.patch(zF - 0.6, zF - 0.53, 3.1, 3.35, side, 0.003, 1, 1), side > 0 ? L.indL : L.indR);
      addG(shape.patch(zR + 0.4, zR + 0.47, 3.2, 3.45, side, 0.003, 1, 1), L.tail);
      // bumper / fender seam ahead of and behind the wheel arches
      addG(shape.patch(zF - 0.39, zF - 0.384, 2.2, 4.7, side, 0.0012, 1, 6), sh.trim);
      addG(shape.patch(zR + 0.33, zR + 0.336, 2.2, 4.7, side, 0.0012, 1, 6), sh.trim);
    }
    // tail lights: deep red lens wrapping the corner, LED bars, separate reverse section
    const tlZ0 = zR + 0.01, tlZ1 = zR + (spec.cargo ? 0.12 : 0.32);
    const tlC0 = spec.cargo ? 2.6 : 3.75, tlC1 = spec.cargo ? 4.3 : 4.65;
    for (const side of [1, -1]) {
      addG(shape.patch(tlZ0, tlZ1, tlC0, tlC1, side, 0.002, 6 * pq, 4 * pq), sh.housing);
      for (let k = 0; k < 3; k++) {
        const cc = lerp(tlC0 + 0.1, tlC1 - 0.08, k / 2);
        addG(shape.patch(tlZ0 + 0.01, tlZ1 - 0.02, cc - 0.035, cc + 0.035, side, 0.005, 5 * pq, 1), L.tail);
      }
      addG(shape.patch(tlZ0 + 0.005, tlZ1 - 0.06, tlC0 + 0.02, tlC0 + 0.22, side, 0.006, 4, 1), L.brake);
      addG(shape.patch(tlZ0, tlZ0 + 0.05, tlC0 + 0.25, tlC1 - 0.25, side, 0.0065, 1, 2), L.reverse);
      addG(shape.patch(tlZ1 - 0.06, tlZ1 - 0.01, tlC0 + 0.25, tlC1 - 0.2, side, 0.0065, 1, 2), side > 0 ? L.indL : L.indR);
      addG(shape.patch(tlZ0 - 0.004, tlZ1 + 0.004, tlC0 - 0.04, tlC1 + 0.04, side, 0.01, 7 * pq, 5 * pq, 0.01), sh.redLens);
      addG(shape.patch(zR + 0.03, zR + 0.12, 1.6, 1.75, side, 0.003, 1, 1), L.tail);
    }
    {
      const zt = spec.zRoofRear - 0.02;
      const p = shape.surf(zt, 8.8, 1, 0.012);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.025, 0.02), L.brake);
      m.position.set(0, p.p.y, zt); near.add(m);
    }
    // front fascia: grille, badge, lower intake, plate, fog lights (on the slightly domed nose)
    const fz = zF + 0.02;
    const grilleKind = spec.sporty ? 'hex' : spec.chrome ? 'chrome' : 'bars';
    const gw = halfEnd * (spec.brand === 'KODIAK' ? 1.25 : spec.sporty ? 1.25 : 1.05), gh = fh * (spec.brand === 'KODIAK' ? 0.42 : 0.3);
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), sh.grilleMats[grilleKind]);
    grille.position.set(0, botY + fh * 0.58, fz); near.add(grille);
    {
      const fm = spec.chrome ? sh.chrome : sh.trim, t = 0.018;
      for (const [w, hh, x, y] of [[gw + t, t, 0, gh / 2], [gw + t, t, 0, -gh / 2], [t, gh, gw / 2, 0], [t, gh, -gw / 2, 0]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.02), fm);
        bar.position.set(x, grille.position.y + y, fz + 0.004); near.add(bar);
      }
    }
    const intake = new THREE.Mesh(new THREE.PlaneGeometry(halfEnd * 1.35, fh * 0.16), sh.grilleMats.hex);
    intake.position.set(0, botY + fh * 0.2, fz); near.add(intake);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), sh.logos[spec.brand]);
    badge.position.set(0, botY + fh * 0.6, fz + 0.01); near.add(badge);
    if (spec.sporty) { const sp = new THREE.Mesh(new THREE.BoxGeometry(halfEnd * 2.0, 0.022, 0.14), sh.trim); sp.position.set(0, botY + 0.02, zF - 0.04); near.add(sp); }
    for (const side of [1, -1]) {
      const fog = new THREE.Mesh(new THREE.CircleGeometry(0.035, 18), L.head);
      fog.position.set(side * halfEnd * 0.76, botY + fh * 0.22, fz + 0.002); near.add(fog);
      const fr = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.046, 18), sh.chrome); fr.position.copy(fog.position).z += 0.001; near.add(fr);
    }
    const plateTex = plateTexture(plateText);
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, metalness: 0.1 });
    car.perCar.push(plateTex, plateMat);
    const plateFront = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), plateMat);
    plateFront.position.set(0, botY + fh * 0.36, fz + 0.016); near.add(plateFront);
    const frameG = new THREE.BoxGeometry(0.335, 0.18, 0.01);
    const ff = new THREE.Mesh(frameG, sh.trim); ff.position.copy(plateFront.position).z -= 0.007; near.add(ff);
    // rear: plate, badge, light bar, diffuser, exhaust tips
    const rz = zR - 0.02;
    const plateRear = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), plateMat);
    plateRear.rotation.y = Math.PI; plateRear.position.set(0, rbot + rh * 0.45, rz - 0.016); near.add(plateRear);
    const fr2 = new THREE.Mesh(frameG, sh.trim); fr2.position.copy(plateRear.position).z += 0.007; near.add(fr2);
    const rbadge = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), sh.logos[spec.brand]);
    rbadge.rotation.y = Math.PI; rbadge.position.set(0, rbot + rh * 0.78, rz - 0.01); near.add(rbadge);
    {
      const tlY = shape.point(zR + 0.15, (tlC0 + tlC1) / 2, 1)[1];
      const rw = rearHalf * 2;
      if (!spec.cargo) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(rw * 0.8, 0.035, 0.01), L.tail); bar.position.set(0, tlY, rz - 0.004); near.add(bar);
        const barLens = new THREE.Mesh(new THREE.BoxGeometry(rw * 0.82, 0.06, 0.012), sh.redLens); barLens.position.set(0, tlY, rz - 0.008); near.add(barLens);
        const gap = new THREE.Mesh(new THREE.BoxGeometry(rw * 0.86, 0.006, 0.006), sh.trim); gap.position.set(0, tlY - 0.07, rz - 0.004); near.add(gap);
      } else {
        const split = new THREE.Mesh(new THREE.BoxGeometry(0.008, rh * 0.8, 0.008), sh.trim); split.position.set(0, rbot + rh * 0.52, rz - 0.004); near.add(split);
        for (const sx of [-1, 1]) {
          const w = new THREE.Mesh(new THREE.PlaneGeometry(rw * 0.3, rh * 0.2), sh.glass); w.rotation.y = Math.PI; w.position.set(sx * rw * 0.22, rbot + rh * 0.78, rz - 0.006); near.add(w);
          const hd = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), sh.trim); hd.position.set(sx * 0.06, rbot + rh * 0.48, rz - 0.012); near.add(hd);
          for (const hy of [0.25, 0.72]) { const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.03), sh.trim); hinge.position.set(sx * rw * 0.45, rbot + rh * hy, rz - 0.01); near.add(hinge); }
        }
      }
      const ins = new THREE.Mesh(new THREE.BoxGeometry(rw * 0.68, 0.05, 0.01), sh.trim); ins.position.set(0, rbot + rh * 0.2, rz - 0.004); near.add(ins);
    }
    const diff = new THREE.Mesh(new THREE.BoxGeometry(rearHalf * 1.5, 0.05, 0.18), sh.trim); diff.position.set(0, rbot + 0.02, zR + 0.12); near.add(diff);
    const tips = spec.sporty ? [-0.55, -0.42, 0.42, 0.55] : spec.cargo ? [0.6] : [-0.5, 0.5];
    for (const x of tips) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.04, 0.14, 20, 1, true), sh.chrome);
      t.rotation.x = Math.PI / 2; t.position.set(x * rearHalf, rbot + 0.07, zR + 0.03); near.add(t);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.036, 18), sh.under); inner.rotation.y = Math.PI; inner.position.set(x * rearHalf, rbot + 0.07, zR + 0.06); near.add(inner);
    }
    if (spec.brand === 'KODIAK' || spec.cargo) { const hitch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.25), sh.trim); hitch.position.set(0, rbot + 0.05, zR - 0.06); near.add(hitch); }
    // mirrors (dark glass, black base, LED repeater)
    for (const side of [1, -1]) {
      const mz = spec.zWsBase - 0.14;
      const base = shape.surf(mz, 4.95, side, 0);
      const mg = new THREE.Group();
      const hg = new THREE.SphereGeometry(1, 20, 14); hg.scale(0.11, 0.065, 0.06);
      const housing = new THREE.Mesh(hg, paint); housing.position.set(side * 0.16, 0.06, 0);
      const glassM = new THREE.Mesh(new THREE.CircleGeometry(1, 20), sh.glass); glassM.scale.set(0.095, 0.052, 1); glassM.rotation.y = Math.PI; glassM.position.set(side * 0.16, 0.06, -0.045);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.07), sh.trim); stalk.position.set(side * 0.05, 0.02, 0);
      const rep = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.07), side > 0 ? L.indL : L.indR); rep.position.set(side * 0.255, 0.05, 0.0);
      mg.add(housing, glassM, stalk, rep);
      mg.position.copy(base.p);
      near.add(mg);
    }
    // door handles & shut lines
    const doorFront = spec.zWsBase - 0.05;
    const bpz = spec.rearDoor ? lerp(spec.zWsTop, spec.zRoofRear, 0.48) : spec.zRoofRear + 0.25;
    const doors = spec.rearDoor ? [[doorFront, bpz + 0.02], [bpz - 0.02, spec.zRoofRear - 0.05]] : [[doorFront, bpz]];
    for (const side of [1, -1]) {
      for (const [d0, d1] of doors) {
        for (const dz of [d0, d1]) addG(shape.patch(dz - 0.003, dz + 0.003, 2.3, 5.0, side, 0.0012, 1, 6 * pq), sh.trim);
        const h = shape.surf(d1 + 0.12, 4.35, side, 0.006);
        const hm = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.12, 4, 8), spec.chrome ? sh.chrome : sh.trim);
        hm.rotation.x = Math.PI / 2; hm.position.copy(h.p); near.add(hm);
      }
      addG(shape.patch(doors[doors.length - 1][1], doorFront, 2.3, 2.34, side, 0.0012, 4 * pq, 1), sh.trim);
      if (spec.chrome) addG(shape.patch(spec.zRoofRear - 0.05, spec.zWsBase - 0.02, 5.02, 5.12, side, 0.002, 10 * pq, 1), sh.chrome);
      if (spec.sporty) addG(shape.patch(shape.axR + 0.5, shape.axF - 0.5, 2.05, 2.2, side, 0.01, 6 * pq, 1), sh.trim);
    }
    addG(shape.patch(spec.zWsBase + 0.18, spec.zWsBase + 0.186, 5.4, 9.0, 1, 0.0012, 1, 6 * pq), sh.trim);
    addG(shape.patch(spec.zWsBase + 0.18, spec.zWsBase + 0.186, 5.4, 9.0, -1, 0.0012, 1, 6 * pq), sh.trim);
    for (const x of [0.32, -0.12]) {
      const wp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.012, 0.02), sh.trim);
      const sp = shape.surf(spec.zWsBase - 0.04, 8.2, 1, 0.01);
      wp.position.set(x, sp.p.y + 0.01, spec.zWsBase - 0.05); wp.rotation.y = 0.12; near.add(wp);
    }
    if (spec.quarterGlass && !spec.cargo) {
      const sp = shape.surf(spec.zRwBase + 0.05, 8.6, 1, 0.012);
      const wp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.012, 0.02), sh.trim); wp.position.set(0.05, sp.p.y + 0.04, sp.p.z - 0.01); wp.rotation.z = 0.5; near.add(wp);
    }
    {
      const rz2 = spec.zRoofRear + 0.12;
      const top = shape.surf(rz2, 9, 1, 0);
      if (spec.rails) {
        for (const side of [1, -1]) {
          const s0 = shape.surf(spec.zRoofRear + 0.15, 7.9, side, 0.03), s1 = shape.surf(spec.zWsTop - 0.1, 7.9, side, 0.03);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, s1.p.z - s0.p.z), sh.trim);
          rail.position.set((s0.p.x + s1.p.x) / 2, (s0.p.y + s1.p.y) / 2 + 0.02, (s0.p.z + s1.p.z) / 2); near.add(rail);
        }
      } else if (!spec.taxi) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 8), sh.trim);
        fin.scale.set(0.5, 1, 2.2); fin.position.set(0, top.p.y + 0.03, rz2); near.add(fin);
      }
      if (spec.taxi) {
        const midz = (spec.zWsTop + spec.zRoofRear) / 2;
        const t = shape.surf(midz, 9, 1, 0);
        const signMat = new THREE.MeshStandardMaterial({ map: sh.taxiSign, emissiveMap: sh.taxiSign, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.4 });
        car.perCar.push(signMat);
        const signG = new THREE.Group();
        const sA = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.16), signMat); sA.position.set(0, 0, 0.121);
        const sB = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.16), signMat); sB.position.set(0, 0, -0.121); sB.rotation.y = Math.PI;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.17, 0.24), sh.trim);
        signG.add(box, sA, sB);
        signG.position.set(0, t.p.y + 0.1, midz);
        near.add(signG);
        L.taxiSign = signMat;
        for (const side of [1, -1]) addG(shape.patch(shape.axR + 0.3, shape.axF - 0.35, 3.85, 3.95, side, 0.0015, 10 * pq, 1), sh.trim);
      }
      if (spec.cargo) {
        const stripeMat = new THREE.MeshStandardMaterial({ color: 0x0a7f8f, roughness: 0.4 });
        car.perCar.push(stripeMat);
        for (const side of [1, -1]) addG(shape.patch(zR + 0.3, spec.zWsTop - 0.6, 3.75, 4.05, side, 0.0015, 10 * pq, 1), stripeMat);
      }
    }
    // wheel arch tubs + wheels on steering knuckles
    const wheels = [];
    const caliperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...spec.caliper), roughness: 0.35, metalness: 0.3 });
    car.perCar.push(caliperMat);
    const calG = caliperGeometry(spec);
    for (const w of wheelSlots) {
      const { az, side } = w;
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(shape.archR - 0.005, shape.archR - 0.005, spec.tireW + 0.14, 24, 1, true, -Math.PI * 0.1, Math.PI * 1.2), sh.liner);
      liner.rotation.set(0, 0, Math.PI / 2);
      liner.position.set(side * (hx - 0.02), wy, az);
      near.add(liner);
      const pivot = new THREE.Group();
      pivot.position.set(side * hx, wy, az);
      const spinner = buildWheel(spec, sh, side, D);
      const spinWrap = new THREE.Group(); spinWrap.add(spinner);
      pivot.add(spinWrap);
      const caliper = new THREE.Mesh(calG, caliperMat);
      caliper.position.set(side * 0.035, 0, 0);
      pivot.add(caliper);
      near.add(pivot);
      wheels.push({ pivot, spin: spinWrap, side, front: w.front, z: az, x: side * hx });
    }
    // interior (visible through tinted glass)
    let steering;
    {
      const s = spec;
      const floorY = s.yBottom + 0.12;
      const ih = clamp((s.roofY - 0.06 - floorY) / 1.13, 0.7, 1.3);
      const dashZ = s.zWsBase - 0.3;
      const hw = shape.halfW(0) * 0.86;
      const RB = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, D >= 2 ? 3 : 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
      const leather = spec.brand === 'AURELIA' ? sh.seatTan : spec.sporty ? sh.seatRed : sh.seat;
      const dash = new THREE.Mesh(RB(hw * 2, 0.2, 0.45, 0.06), sh.interior); dash.position.set(0, s.beltY - 0.06, dashZ); near.add(dash);
      const binn = new THREE.Mesh(RB(0.36, 0.08, 0.16, 0.03), sh.interior); binn.position.set(0.37, s.beltY + 0.06, dashZ - 0.14); near.add(binn);
      const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.09), sh.cluster); cluster.position.set(0.37, s.beltY + 0.045, dashZ - 0.225); cluster.rotation.y = Math.PI; cluster.rotation.x = -0.25; near.add(cluster);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), sh.screen); screen.position.set(0, s.beltY + 0.02, dashZ - 0.226); screen.rotation.y = Math.PI; screen.rotation.x = -0.15; near.add(screen);
      const consoleBox = new THREE.Mesh(RB(0.22, 0.22 * ih, 0.7, 0.04), sh.interior); consoleBox.position.set(0, floorY + 0.12 * ih, dashZ - 0.6); near.add(consoleBox);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 8), sh.chrome); lever.position.set(0, floorY + 0.29 * ih, dashZ - 0.55); near.add(lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), sh.interior); knob.position.set(0, floorY + 0.36 * ih, dashZ - 0.55); near.add(knob);
      const seatZ = (s.zWsTop + s.zRoofRear) / 2 + 0.15;
      for (const x of [0.37, -0.37]) {
        const cushion = new THREE.Mesh(RB(0.5, 0.13, 0.52, 0.05), leather); cushion.position.set(x, floorY + 0.22 * ih, seatZ); near.add(cushion);
        const back = new THREE.Mesh(RB(0.46, 0.58 * ih, 0.12, 0.05), leather); back.position.set(x, floorY + 0.56 * ih, seatZ - 0.3); back.rotation.x = -0.18; near.add(back);
        for (const bx of [-0.21, 0.21]) { const bol = new THREE.Mesh(RB(0.08, 0.48 * ih, 0.16, 0.035), leather); bol.position.set(x + bx, floorY + 0.53 * ih, seatZ - 0.28); bol.rotation.x = -0.18; near.add(bol); }
        const head = new THREE.Mesh(RB(0.25, 0.16, 0.1, 0.04), leather); head.position.set(x, floorY + 0.93 * ih, seatZ - 0.37); near.add(head);
        const card = new THREE.Mesh(RB(0.04, 0.32 * ih, 1.0, 0.02), sh.interior); card.position.set(Math.sign(x) * (hw - 0.02), floorY + 0.42 * ih, seatZ + 0.05); near.add(card);
      }
      if (s.rearDoor && !s.cargo) {
        const bench = new THREE.Mesh(RB(hw * 1.7, 0.18 * ih, 0.5, 0.06), leather); bench.position.set(0, floorY + 0.22 * ih, seatZ - 0.95); near.add(bench);
        const bback = new THREE.Mesh(RB(hw * 1.7, 0.55 * ih, 0.14, 0.06), leather); bback.position.set(0, floorY + 0.55 * ih, seatZ - 1.2); bback.rotation.x = -0.2; near.add(bback);
      }
      // steering wheel (rim + 3 spokes + hub) as one rotating mesh
      const swB = new GeoBuilder();
      swB.addGeometry(new THREE.TorusGeometry(0.17, 0.019, 10, 36), new THREE.Matrix4());
      for (const a of [0, Math.PI * 0.8, -Math.PI * 0.8]) swB.addGeometry(new THREE.BoxGeometry(0.15, 0.03, 0.015), new THREE.Matrix4().makeRotationZ(a - Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(0.075, 0, 0)));
      swB.addGeometry(new THREE.CylinderGeometry(0.05, 0.055, 0.04, 18).rotateX(Math.PI / 2), new THREE.Matrix4());
      steering = new THREE.Mesh(swB.build(), sh.interior);
      steering.position.set(0.37, s.beltY + 0.02, dashZ - 0.28); steering.rotation.x = -0.45 + Math.PI; near.add(steering);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.02, s.zWsBase - s.zRwBase), sh.interior); floor.position.set(0, floorY, (s.zWsBase + s.zRwBase) / 2); near.add(floor);
      root.userData.seat = new THREE.Vector3(0.37, floorY + 0.28 * ih, seatZ - 0.05);
      root.userData.steeringWheel = steering;
    }
    // collapse static detail: dark trim parts -> one vertex-coloured material, all lamps -> one
    const remap = new Map();
    for (const m of [sh.trim, sh.housing, sh.under, sh.liner, sh.interior, sh.seat, sh.seatTan, sh.seatRed, sh.rubber]) remap.set(m, { target: sh.darkVC, color: col3(m) });
    LIGHT_ORDER.forEach((k, i) => remap.set(L[k], { target: lightsMat, color: col3(L[k]), uv: [(i + 0.5) / 8, 0.5] }));
    mergeByMaterial(near, new Set([body, steering, ...wheels.map((w) => w.pivot)]), false, remap, 1);
    const wremap = new Map();
    for (const m of [sh.rim, sh.rimDark, sh.disc, sh.chrome, sh.rotor]) wremap.set(m, { target: sh.wheelMetal, color: col3(m) });
    for (const w of wheels) mergeByMaterial(w.spin.children[0], new Set(), false, wremap);
    // swap LOD levels: near (0-26 m) / far / hidden
    for (const lv of lod.levels) lod.remove(lv.object);
    lod.levels.length = 0;
    lod.addLevel(near, 0);
    lod.addLevel(far, 26);
    lod.addLevel(new THREE.Object3D(), 340);
    car.near = near; car.body = body; car.wheels = wheels; car.built = true;
  };

  car.dispose = () => {
    root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const r of car.perCar) r.dispose?.();
  };

  syncLights();
  return car;
}

// dent the body geometry around a local-space point
export function dentBody(car, localPoint, strength) {
  if (!car.body) return;
  const g = car.body.geometry;
  const p = g.attributes.position;
  const R = 0.55 + strength * 0.25;
  const depth = Math.min(0.12, strength * 0.05);
  const v = new THREE.Vector3();
  let changed = false;
  const center = new THREE.Vector3(0, localPoint.y, 0);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.distanceTo(localPoint);
    if (d > R) continue;
    const f = (1 - d / R) ** 2 * depth;
    const dir = v.clone().sub(center); dir.y *= 0.3; dir.normalize();
    v.addScaledVector(dir, -f);
    v.y -= f * 0.15;
    p.setXYZ(i, v.x, v.y, v.z);
    changed = true;
  }
  if (changed) { p.needsUpdate = true; g.computeVertexNormals(); }
}
