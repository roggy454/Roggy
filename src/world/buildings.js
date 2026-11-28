// Procedural architecture: glass skyscrapers with LED crowns, condo towers with
// balconies, concrete mid-rises, shop-lined low-rises and pastel art-deco hotels
// with neon signage on the beach strip. Everything is merged per material.
import * as THREE from 'three';
import { GeoBuilder } from '../core/geo.js';
import { RNG, lerp, clamp } from '../core/utils.js';
import { FACADE_TILE, makeCanvas, toTexture } from '../core/textures.js';
import { blocks, CURB_H, SIDEWALK_W } from './map.js';
import { U } from '../core/globals.js';

const TW = FACADE_TILE.w, TH = FACADE_TILE.h; // 12m x 14m per uv unit
const GROUND = CURB_H;
const SHOP_H = 5;

const HOTEL_NAMES = ['The Coral', 'Flamingo Rose', 'Hotel Solana', 'Pelican Moon', 'Azure Tide', 'The Marlowe', 'Seabreeze',
  'Hotel Paloma', 'Starlite', 'Sunset Royale', 'The Tidewater', 'Hotel Lucerna', 'Orchid Palms', 'The Neptune', 'Casa Brisa',
  'Mango Club', 'The Riviera', 'Hotel Amalfi', 'Palm Breeze', 'Driftwood', 'Gulfstream', 'Hotel Cielo', 'Seashell Inn',
  'The Lumiere', 'Hotel Esmeralda', 'Velvet Sands', 'Blue Lagoon', 'The Avalon', 'Moonlight Bay', 'Hotel Tropicana', 'The Sandpiper', 'Cabana Club'];
const PASTELS = [[0.97, 0.72, 0.78], [0.72, 0.93, 0.84], [0.98, 0.91, 0.66], [0.71, 0.86, 0.95], [0.98, 0.81, 0.68], [0.85, 0.77, 0.94], [0.97, 0.96, 0.93], [0.62, 0.89, 0.87]];
const NEONS = [[1.0, 0.15, 0.6], [0.1, 0.9, 1.0], [0.7, 0.2, 1.0], [0.2, 1.0, 0.45], [1.0, 0.45, 0.1], [1.0, 0.9, 0.2]];
const MUTED = [[0.86, 0.8, 0.7], [0.93, 0.89, 0.8], [0.9, 0.84, 0.66], [0.82, 0.62, 0.5], [0.78, 0.8, 0.78], [0.95, 0.93, 0.9]];

function neonSignTexture(text, col, vertical = false) {
  const W = vertical ? 128 : 512, H = vertical ? 512 : 128;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const css = `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = css;
  if (vertical) {
    const letters = text.replace(/^(The|Hotel) /, '').toUpperCase().slice(0, 8).split('');
    const step = H / (letters.length + 0.5);
    ctx.font = `bold ${Math.min(76, step * 0.95)}px "Futura", "Century Gothic", "Trebuchet MS", sans-serif`;
    letters.forEach((l, i) => {
      for (const blur of [24, 10, 0]) { ctx.shadowBlur = blur; ctx.fillStyle = blur ? css : '#fff'; ctx.fillText(l, W / 2, step * (i + 0.75)); }
    });
  } else {
    ctx.font = `italic bold 70px "Brush Script MT", "Segoe Script", "Lucida Handwriting", cursive`;
    for (const blur of [28, 12, 0]) { ctx.shadowBlur = blur; ctx.fillStyle = blur ? css : '#fff'; ctx.fillText(text, W / 2, H / 2 + 4); }
  }
  const t = toTexture(c, { repeat: false });
  return t;
}

function billboardTexture(rng, i) {
  const ads = [
    { t: 'VORTEK', s: 'BORN TO RUN', bg: ['#0b0b12', '#b0102a'], fg: '#fff' },
    { t: 'SUNFIZZ', s: 'TASTE THE COAST', bg: ['#ff8a00', '#ffcf33'], fg: '#2a0a3a' },
    { t: 'NEON FM 101.9', s: 'SYNTHS ALL NIGHT', bg: ['#1a0533', '#e0208a'], fg: '#5ff' },
    { t: 'AURELIA', s: 'LUMEN  ·  QUIET LUXURY', bg: ['#d8dde3', '#7d8a99'], fg: '#111' },
    { t: 'KODIAK ATLAS', s: 'GO ANYWHERE', bg: ['#21331d', '#5f7f3a'], fg: '#f4f1e8' },
    { t: 'CLUB PARAISO', s: 'OCEAN DRIVE · FRI-SAT', bg: ['#00303a', '#00b3a4'], fg: '#ffe' },
  ];
  const a = ads[i % ads.length];
  const c = makeCanvas(512, 256), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, a.bg[0]); g.addColorStop(1, a.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = a.fg; ctx.textAlign = 'center';
  ctx.font = 'bold 64px "Arial Black", Arial, sans-serif'; ctx.fillText(a.t, 256, 130);
  ctx.font = 'bold 26px Arial, sans-serif'; ctx.fillText(a.s, 256, 190);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 496, 240);
  return toTexture(c, { repeat: false });
}

export class Buildings {
  constructor(scene, T, physics) {
    this.scene = scene;
    this.T = T;
    this.colliders = []; // {x0,x1,z0,z1,h}
    this.rng = new RNG(4242);
    this.B = {
      glass: new GeoBuilder(), concrete: new GeoBuilder(), condo: new GeoBuilder(),
      stucco: new GeoBuilder({ color: true }), shop: new GeoBuilder(), roof: new GeoBuilder(),
      detail: new GeoBuilder({ color: true }), neon: new GeoBuilder({ color: true }), dark: new GeoBuilder(),
    };
    this.signs = [];
    this.beacons = [];
    this.billboards = [];
    this.hotelFronts = [];
    this.awnings = [];
    let hotelIdx = 0;
    for (const b of blocks) {
      const lot = { x0: b.x0 + SIDEWALK_W + 0.5, x1: b.x1 - SIDEWALK_W - 0.5, z0: b.z0 + SIDEWALK_W + 0.5, z1: b.z1 - SIDEWALK_W - 0.5 };
      if (b.type === 'tower') this.towerBlock(lot, b);
      else if (b.type === 'midrise') this.midriseBlock(lot, b);
      else if (b.type === 'lowrise') this.lowriseBlock(lot, b);
      else if (b.type === 'deco') hotelIdx = this.decoBlock(lot, b, hotelIdx);
    }
    this.buildMeshes();
    for (const c of this.colliders) {
      const h = Math.min(c.h, 30);
      physics.addStaticBox((c.x0 + c.x1) / 2, h / 2, (c.z0 + c.z1) / 2, (c.x1 - c.x0) / 2, h / 2, (c.z1 - c.z0) / 2, physics.mat.wall);
    }
  }

  // --- primitives
  facade(builder, x0, z0, x1, z1, y0, y1, vBase, uOff = 0, vOff = 0, faces = null) {
    // 4 sides with continuous u around perimeter; windows aligned to 3m grid
    const sides = [
      { a: [x0, z1], b: [x1, z1], n: [0, 0, 1], key: 'pz' },
      { a: [x1, z1], b: [x1, z0], n: [1, 0, 0], key: 'px' },
      { a: [x1, z0], b: [x0, z0], n: [0, 0, -1], key: 'nz' },
      { a: [x0, z0], b: [x0, z1], n: [-1, 0, 0], key: 'nx' },
    ];
    let u = uOff;
    const v0 = (y0 - vBase) / TH + vOff, v1 = (y1 - vBase) / TH + vOff;
    for (const s of sides) {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const du = Math.round(len / 3) * 3 / TW;
      if (!faces || faces[s.key]) {
        builder.quad([s.a[0], y0, s.a[1]], [s.b[0], y0, s.b[1]], [s.b[0], y1, s.b[1]], [s.a[0], y1, s.a[1]], s.n, [u, v0, u + du, v0, u + du, v1, u, v1]);
      }
      u += du;
    }
  }
  roofTop(x0, z0, x1, z1, y) { this.B.roof.hRect(x0, z0, x1, z1, y, 8); }
  detailBox(x0, y0, z0, x1, y1, z1, col) { this.B.detail.setColor(...col); this.B.detail.box(x0, y0, z0, x1, y1, z1, 4, 4, { top: true, px: true, nx: true, pz: true, nz: true }); }
  neonBox(x0, y0, z0, x1, y1, z1, col) { this.B.neon.setColor(...col); this.B.neon.box(x0, y0, z0, x1, y1, z1, 1, 1, { top: true, bottom: true, px: true, nx: true, pz: true, nz: true }); }

  rooftop(x0, z0, x1, z1, y, big) {
    const rng = this.rng;
    // parapet
    const p = 0.35, ph = 1.1, col = [0.62, 0.62, 0.6];
    this.detailBox(x0, y, z0, x1, y + ph, z0 + p, col);
    this.detailBox(x0, y, z1 - p, x1, y + ph, z1, col);
    this.detailBox(x0, y, z0, x0 + p, y + ph, z1, col);
    this.detailBox(x1 - p, y, z0, x1, y + ph, z1, col);
    const w = x1 - x0, d = z1 - z0;
    const n = Math.min(8, Math.floor(w * d / 120));
    for (let i = 0; i < n; i++) {
      const cx = rng.range(x0 + 3, x1 - 3), cz = rng.range(z0 + 3, z1 - 3);
      const s = rng.range(1.2, 3);
      this.detailBox(cx - s, y, cz - s * 0.7, cx + s, y + rng.range(1, 2.2), cz + s * 0.7, [0.7, 0.71, 0.72]);
    }
    if (w > 14 && d > 14) {
      const cx = (x0 + x1) / 2 + rng.range(-w * 0.2, w * 0.2), cz = (z0 + z1) / 2 + rng.range(-d * 0.2, d * 0.2);
      this.detailBox(cx - 3, y, cz - 2.5, cx + 3, y + 4, cz + 2.5, [0.66, 0.64, 0.6]);
    }
    if (big) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      this.detailBox(cx - 0.25, y, cz - 0.25, cx + 0.25, y + 18, cz + 0.25, [0.5, 0.5, 0.52]);
      this.beacons.push(new THREE.Vector3(cx, y + 18.4, cz));
      this.beacons.push(new THREE.Vector3(x0 + 1, y + 1.6, z0 + 1));
      this.beacons.push(new THREE.Vector3(x1 - 1, y + 1.6, z1 - 1));
    }
  }

  tower(x0, z0, x1, z1, h, style, crownCol) {
    const rng = this.rng;
    const B = this.B[style];
    const uO = rng.int(0, 15) / 4, vO = rng.int(0, 31) / 4;
    // podium lobby (dark glass)
    this.B.shop.setColor?.(1, 1, 1);
    this.facade(this.B.shop, x0, z0, x1, z1, GROUND, GROUND + SHOP_H, GROUND, rng.int(0, 3) / 3, 0);
    let y = GROUND + SHOP_H;
    let tiers = h > 110 ? rng.int(2, 3) : 1;
    let cx0 = x0, cz0 = z0, cx1 = x1, cz1 = z1;
    for (let t = 0; t < tiers; t++) {
      const top = t === tiers - 1 ? h : y + (h - y) * rng.range(0.45, 0.7);
      const topQ = Math.round((top - GROUND - SHOP_H) / 3.5) * 3.5 + GROUND + SHOP_H;
      this.facade(B, cx0, cz0, cx1, cz1, y, topQ, GROUND + SHOP_H, uO, vO);
      // slab bands for glass towers every 4 floors (subtle)
      y = topQ;
      if (t < tiers - 1) {
        this.roofTop(cx0, cz0, cx1, cz1, y);
        const sx = Math.min(6, (cx1 - cx0) * 0.15), sz = Math.min(6, (cz1 - cz0) * 0.15);
        cx0 += Math.round(sx / 3) * 3; cx1 -= Math.round(sx / 3) * 3; cz0 += Math.round(sz / 3) * 3; cz1 -= Math.round(sz / 3) * 3;
      }
    }
    this.roofTop(cx0, cz0, cx1, cz1, y);
    if (crownCol) {
      // LED crown: neon bands
      const o = 0.12;
      for (const yy of [y - 1.2, y - 4.7]) {
        this.neonBox(cx0 - o, yy, cz1, cx1 + o, yy + 0.35, cz1 + o, crownCol);
        this.neonBox(cx0 - o, yy, cz0 - o, cx1 + o, yy + 0.35, cz0, crownCol);
        this.neonBox(cx1, yy, cz0, cx1 + o, yy + 0.35, cz1, crownCol);
        this.neonBox(cx0 - o, yy, cz0, cx0, yy + 0.35, cz1, crownCol);
      }
      // vertical corner strips
      for (const [px, pz] of [[cx0, cz0], [cx1, cz0], [cx0, cz1], [cx1, cz1]]) this.neonBox(px - 0.15, y - 30, pz - 0.15, px + 0.15, y, pz + 0.15, crownCol);
    }
    this.rooftop(cx0, cz0, cx1, cz1, y, h > 90);
    this.colliders.push({ x0, x1, z0, z1, h });
  }

  towerBlock(lot, b) {
    const rng = this.rng;
    const f = clamp(1 - b.dCore / 420, 0.15, 1);
    const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
    const count = rng.chance(0.5) ? 1 : 2;
    const style = () => rng.pick(['glass', 'glass', 'condo', 'concrete']);
    if (count === 1) {
      const w = Math.round(rng.range(30, 44) / 3) * 3, d = Math.round(rng.range(30, 44) / 3) * 3;
      const cx = (lot.x0 + lot.x1) / 2 + rng.range(-5, 5), cz = (lot.z0 + lot.z1) / 2 + rng.range(-5, 5);
      const h = lerp(70, 240, f * rng.range(0.6, 1.0));
      // podium
      this.lowBox(lot.x0 + 2, lot.z0 + 2, lot.x1 - 2, lot.z1 - 2, GROUND + SHOP_H + 7, 'concrete', true);
      const st = style();
      this.tower(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h, st, h > 120 && rng.chance(0.75) ? rng.pick(NEONS) : null);
    } else {
      const split = rng.chance(0.5) ? 'x' : 'z';
      for (let k = 0; k < 2; k++) {
        const w = Math.round(rng.range(24, 32) / 3) * 3, d = Math.round(rng.range(24, 34) / 3) * 3;
        let cx, cz;
        if (split === 'x') { cx = lot.x0 + W * (k === 0 ? 0.26 : 0.74); cz = (lot.z0 + lot.z1) / 2 + rng.range(-12, 12); }
        else { cz = lot.z0 + D * (k === 0 ? 0.26 : 0.74); cx = (lot.x0 + lot.x1) / 2 + rng.range(-12, 12); }
        const h = lerp(50, 190, f * rng.range(0.5, 1.0));
        this.tower(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h, style(), h > 110 && rng.chance(0.6) ? rng.pick(NEONS) : null);
      }
    }
  }

  lowBox(x0, z0, x1, z1, h, style, shop, color = null) {
    const rng = this.rng;
    const top = GROUND + Math.max(SHOP_H, Math.round((h - GROUND) / 3.5) * 3.5);
    if (shop) this.facade(this.B.shop, x0, z0, x1, z1, GROUND, GROUND + SHOP_H, GROUND, rng.int(0, 3) / 3, 0);
    const y0 = shop ? GROUND + SHOP_H : GROUND;
    const B = this.B[style];
    if (style === 'stucco') B.setColor(...(color || rng.pick(MUTED)));
    if (top > y0 + 0.5) this.facade(B, x0, z0, x1, z1, y0, top, y0, rng.int(0, 15) / 4, rng.int(0, 31) / 4);
    this.roofTop(x0, z0, x1, z1, top);
    this.rooftop(x0, z0, x1, z1, top, false);
    this.colliders.push({ x0, x1, z0, z1, h: top });
    return top;
  }

  midriseBlock(lot, b) {
    const rng = this.rng;
    const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
    const nx = rng.int(1, 2), nz = rng.int(1, 2);
    const cw = W / nx, cd = D / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const w = Math.floor((cw - rng.range(3, 8)) / 3) * 3, d = Math.floor((cd - rng.range(3, 8)) / 3) * 3;
      const cx = lot.x0 + cw * (i + 0.5), cz = lot.z0 + cd * (j + 0.5);
      const h = rng.range(18, 58);
      const style = rng.pick(['concrete', 'condo', 'glass', 'stucco']);
      const top = this.lowBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, h, style, rng.chance(0.7));
      if (rng.chance(0.12)) this.billboard(cx, top, cz, rng.int(0, 5));
    }
  }

  lowriseBlock(lot, b) {
    const rng = this.rng;
    const island = b.district === 'island';
    // perimeter of buildings facing streets, courtyard in the middle
    const depth = island ? 16 : 18;
    const sides = [
      { x0: lot.x0, x1: lot.x1, z0: lot.z0, z1: lot.z0 + depth, along: 'x' },
      { x0: lot.x0, x1: lot.x1, z0: lot.z1 - depth, z1: lot.z1, along: 'x' },
    ];
    for (const s of sides) {
      let x = s.x0;
      while (x < s.x1 - 6) {
        const w = Math.min(s.x1 - x, Math.round(rng.range(9, 21) / 3) * 3);
        if (w < 6) break;
        const h = island ? rng.range(8, 16) : rng.range(6, 20);
        const pastel = island ? rng.pick(PASTELS) : rng.pick(MUTED);
        const top = this.lowBox(x, s.z0, x + w - 0.4, s.z1, h, rng.chance(0.65) ? 'stucco' : 'concrete', rng.chance(island ? 0.4 : 0.8), pastel);
        if (!island && rng.chance(0.06)) this.billboard(x + w / 2, top, (s.z0 + s.z1) / 2, rng.int(0, 5));
        x += w;
      }
    }
    // a couple of buildings in the middle band
    if (rng.chance(0.7)) {
      const cz = (lot.z0 + lot.z1) / 2;
      this.lowBox(lot.x0 + 4, cz - 8, lot.x0 + 4 + Math.round((lot.x1 - lot.x0) * 0.4 / 3) * 3, cz + 8, rng.range(8, 14), 'stucco', false, island ? rng.pick(PASTELS) : rng.pick(MUTED));
    }
  }

  decoBlock(lot, b, hotelIdx) {
    const rng = this.rng;
    // hotels face east (Ocean Drive at x=520). Lot east edge = lot.x1
    let z = lot.z0;
    while (z < lot.z1 - 12) {
      const w = Math.min(lot.z1 - z, Math.round(rng.range(18, 27) / 3) * 3); // along z
      if (w < 12) break;
      const depth = Math.round(rng.range(18, 26) / 3) * 3;
      const floors = rng.int(3, 5);
      const h = GROUND + floors * 3.5 + 1.5;
      const x1 = lot.x1, x0 = x1 - depth;
      const z0 = z, z1 = z + w - 1;
      const col = PASTELS[(hotelIdx * 3 + 1) % PASTELS.length];
      const neon = NEONS[hotelIdx % NEONS.length];
      this.B.stucco.setColor(...col);
      this.facade(this.B.stucco, x0, z0, x1, z1, GROUND, h, GROUND + 1.5, rng.int(0, 15) / 4, rng.int(0, 31) / 4);
      this.roofTop(x0, z0, x1, z1, h);
      // parapet with stepped deco top
      const white = [0.98, 0.97, 0.95];
      this.detailBox(x0, h, z0, x1, h + 1.2, z0 + 0.4, white);
      this.detailBox(x0, h, z1 - 0.4, x1, h + 1.2, z1, white);
      this.detailBox(x1 - 0.4, h, z0, x1, h + 1.2, z1, white);
      this.detailBox(x0, h, z0, x0 + 0.4, h + 1.2, z1, white);
      // eyebrows over each floor on the facade (east face)
      for (let f = 1; f <= floors; f++) {
        const yy = GROUND + 1.5 + f * 3.5 - 0.55;
        this.detailBox(x1, yy, z0 + 0.3, x1 + 0.7, yy + 0.12, z1 - 0.3, white);
      }
      // ground floor porch canopy + columns
      this.detailBox(x1, GROUND + 3.6, z0 + 1, x1 + 3.2, GROUND + 3.9, z1 - 1, col.map((c) => c * 0.92));
      for (let k = 0; k < 3; k++) this.detailBox(x1 + 2.8, GROUND, z0 + 1.3 + k * (w - 3.6) / 2, x1 + 3.1, GROUND + 3.6, z0 + 1.6 + k * (w - 3.6) / 2, white);
      // central fin tower
      const fz = (z0 + z1) / 2;
      const finH = h + rng.range(4, 9);
      this.B.stucco.setColor(...white);
      this.facade(this.B.stucco, x1 - 2, fz - 1.6, x1 + 0.9, fz + 1.6, h, finH, GROUND + 1.5, 0, 0);
      this.roofTop(x1 - 2, fz - 1.6, x1 + 0.9, fz + 1.6, finH);
      this.B.dark.box(x1 + 0.9, GROUND + 4.5, fz - 1.5, x1 + 0.95, h - 1, fz + 1.5, 1, 1, { px: true });
      // neon outlines
      const t = 0.09;
      this.neonBox(x1 + 0.02, h + 1.15, z0, x1 + t + 0.02, h + 1.15 + t, z1, neon);
      this.neonBox(x1 + 0.02, GROUND + 3.95, z0 + 1, x1 + 3.2, GROUND + 3.95 + t, z0 + 1 + t, neon);
      this.neonBox(x1 + 3.2, GROUND + 3.95, z0 + 1, x1 + 3.2 + t, GROUND + 3.95 + t, z1 - 1, neon);
      this.neonBox(x1 + 0.9, h, fz - 1.6, x1 + 0.9 + t, finH, fz - 1.6 + t, neon);
      this.neonBox(x1 + 0.9, h, fz + 1.6 - t, x1 + 0.9 + t, finH, fz + 1.6, neon);
      // sign on the fin (vertical) and horizontal sign on the canopy
      const name = HOTEL_NAMES[hotelIdx % HOTEL_NAMES.length];
      this.signs.push({ text: name, col: neon, vertical: true, pos: new THREE.Vector3(x1 + 0.97, (h + finH) / 2 + 1, fz), w: 2.6, h: Math.min(finH - GROUND - 6, 10), rotY: Math.PI / 2 });
      this.signs.push({ text: name, col: neon, vertical: false, pos: new THREE.Vector3(x1 + 3.33, GROUND + 4.6, fz), w: 8, h: 2, rotY: Math.PI / 2 });
      this.colliders.push({ x0, x1: x1 + 0.9, z0, z1, h });
      this.hotelFronts.push({ x: x1 + 1.6, z0: z0 + 1.5, z1: z1 - 1.5 });
      hotelIdx++;
      z += w;
    }
    // back half: small pastel buildings
    const bx1 = lot.x1 - 28;
    if (bx1 - lot.x0 > 10) {
      let zz = lot.z0;
      while (zz < lot.z1 - 10) {
        const w = Math.min(lot.z1 - zz, Math.round(rng.range(12, 20) / 3) * 3);
        if (w < 9) break;
        this.lowBox(lot.x0, zz, bx1, zz + w - 1, rng.range(8, 13), 'stucco', false, rng.pick(PASTELS));
        zz += w;
      }
    }
    return hotelIdx;
  }

  billboard(cx, top, cz, i) {
    this.billboards.push({ pos: new THREE.Vector3(cx, top + 6, cz), i, rotY: this.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) });
    this.detailBox(cx - 0.2, top, cz - 0.2, cx + 0.2, top + 3.5, cz + 0.2, [0.3, 0.3, 0.32]);
  }

  buildMeshes() {
    const T = this.T, F = T.facade;
    const facadeMat = (f, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({
        map: f.map, roughnessMap: f.rough, metalnessMap: f.metal, metalness: 1, roughness: 1,
        emissiveMap: f.emissive, emissive: new THREE.Color(1, 0.92, 0.82), emissiveIntensity: 0, ...extra,
      });
      f.emissive.repeat.set(0.25, 0.125);
      return m;
    };
    this.mats = {
      glass: facadeMat(F.glass, { envMapIntensity: 1.15, metalness: 0.72 }),
      concrete: facadeMat(F.concrete),
      condo: facadeMat(F.condo, { envMapIntensity: 1.1, metalness: 0.75 }),
      stucco: facadeMat(F.stucco, { vertexColors: true }),
      shop: new THREE.MeshStandardMaterial({ map: T.storefront.map, emissiveMap: T.storefront.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.45, metalness: 0.2 }),
      roof: new THREE.MeshStandardMaterial({ map: T.roof, roughness: 0.92 }),
      detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      neon: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) }),
      dark: new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.1, metalness: 0.8 }),
    };
    // storefront uv: tile 12m x 5m
    T.storefront.map.repeat.set(1, 14 / 5);
    T.storefront.emissive.repeat.set(1, 14 / 5);
    this.meshes = [];
    for (const k of Object.keys(this.B)) {
      const g = this.B[k].build();
      if (!g.attributes.position.count) continue;
      const m = new THREE.Mesh(g, this.mats[k]);
      m.castShadow = k !== 'neon';
      m.receiveShadow = k !== 'neon';
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.name = 'bld_' + k;
      this.scene.add(m);
      this.meshes.push(m);
    }
    // signs
    this.signMats = [];
    for (const s of this.signs) {
      const tex = neonSignTexture(s.text, s.col, s.vertical);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1) });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      mesh.position.copy(s.pos); mesh.rotation.y = s.rotY;
      this.scene.add(mesh);
      this.signMats.push(mat);
    }
    // billboards
    const bbFrame = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 });
    this.bbMats = [];
    for (const b of this.billboards) {
      const tex = billboardTexture(this.rng, b.i);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 });
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), mat);
      panel.position.z = 0.16;
      const back = new THREE.Mesh(new THREE.BoxGeometry(12.4, 6.4, 0.3), bbFrame);
      g.add(panel, back);
      g.position.copy(b.pos); g.rotation.y = b.rotY;
      back.castShadow = true;
      this.scene.add(g);
      this.bbMats.push(mat);
    }
    // aircraft warning beacons (instanced)
    const bg = new THREE.SphereGeometry(0.35, 8, 6);
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.1, 0.05) });
    const inst = new THREE.InstancedMesh(bg, this.beaconMat, this.beacons.length);
    const m4 = new THREE.Matrix4();
    this.beacons.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m4); });
    this.scene.add(inst);
    this.beaconMesh = inst;
  }

  update(dt, night, time) {
    const n = night;
    this.mats.glass.emissiveIntensity = n * 1.7;
    this.mats.concrete.emissiveIntensity = n * 1.5;
    this.mats.condo.emissiveIntensity = n * 1.5;
    this.mats.stucco.emissiveIntensity = n * 1.4;
    this.mats.shop.emissiveIntensity = 0.15 + n * 2.2;
    const neonI = lerp(0.85, 4.2, n);
    this.mats.neon.color.setScalar(neonI);
    for (const m of this.signMats) m.color.setScalar(lerp(1.0, 5.0, n));
    for (const m of this.bbMats) m.emissiveIntensity = 0.1 + n * 1.6;
    const blink = (Math.sin(time * 3) > 0.2 ? 1 : 0.08) * (0.3 + n * 0.7);
    this.beaconMat.color.setRGB(5 * blink, 0.15 * blink, 0.08 * blink);
  }
}
