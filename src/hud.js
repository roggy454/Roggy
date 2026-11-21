// HUD: minimap (pre-rendered city + terrain, rotates with the camera), speedometer with RPM
// ring and gear, radio station banner, clock, prompts and toasts.
import { CITY_HALF, ROAD_HALF, CITY_EDGE, WORLD_HALF, WATER_LEVEL, LINES, lineCoord } from './config.js';
import { clamp } from './utils.js';

export class HUD {
  constructor(city, terrain) {
    this.el = (id) => document.getElementById(id);
    this.radioEl = this.el('radio');
    this.radioName = this.el('radio-name');
    this.radioSong = this.el('radio-song');
    this.clockEl = this.el('clock');
    this.promptEl = this.el('prompt');
    this.toastEl = this.el('toast');
    this.fpsEl = this.el('fps');
    this.mini = this.el('minimap'); this.miniCtx = this.mini.getContext('2d');
    this.speedo = this.el('speedo'); this.speedoCtx = this.speedo.getContext('2d');
    this.speedoWrap = this.el('speedo-wrap');
    this.radioTimer = 0; this.toastTimer = 0;
    this.prerender(city, terrain);
    this.lastPrompt = '';
  }

  prerender(city, terrain) {
    // terrain overview
    const T = document.createElement('canvas'); T.width = T.height = 600;
    const tc = T.getContext('2d');
    const img = tc.createImageData(600, 600);
    for (let j = 0; j < 600; j++) for (let i = 0; i < 600; i++) {
      const x = -WORLD_HALF + (i + 0.5) * (2 * WORLD_HALF / 600), z = -WORLD_HALF + (j + 0.5) * (2 * WORLD_HALF / 600);
      const h = terrain.terrainHeight(x, z);
      let c;
      if (h < WATER_LEVEL) c = [32, 62, 84];
      else if (h < 40) c = [44 + h * 0.3, 70 + h * 0.4, 46];
      else if (h < 140) c = [62 + (h - 40) * 0.2, 82 + (h - 40) * 0.05, 58];
      else c = [100, 100, 94];
      const k = (j * 600 + i) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    this.terrainMap = T;
    // city detail at 2 px / m
    const S = 2, size = Math.ceil(CITY_EDGE * 2 * S);
    const C = document.createElement('canvas'); C.width = C.height = size;
    const cc = C.getContext('2d');
    const X = (x) => (x + CITY_EDGE) * S;
    cc.fillStyle = '#3c424a'; cc.fillRect(0, 0, size, size);
    for (const b of city.blocks) {
      const I = b.inner;
      cc.fillStyle = b.type === 'park' ? '#2f5d3b' : b.type === 'parking' ? '#41464e' : '#30353c';
      cc.fillRect(X(I.minX), X(I.minZ), (I.maxX - I.minX) * S, (I.maxZ - I.minZ) * S);
    }
    for (const p of city.parks) { cc.fillStyle = '#2f5d3b'; cc.fillRect(X(p.minX), X(p.minZ), (p.maxX - p.minX) * S, (p.maxZ - p.minZ) * S); }
    for (const b of city.buildings) {
      cc.fillStyle = b.top > 80 ? '#6a7380' : '#555c66';
      cc.fillRect(X(b.minX) + 1, X(b.minZ) + 1, (b.maxX - b.minX) * S - 2, (b.maxZ - b.minZ) * S - 2);
    }
    cc.fillStyle = '#878d96';
    for (let i = 0; i < LINES; i++) {
      const L = lineCoord(i);
      cc.fillRect(X(L - ROAD_HALF), X(-CITY_HALF - ROAD_HALF), ROAD_HALF * 2 * S, (CITY_HALF + ROAD_HALF) * 2 * S);
      cc.fillRect(X(-CITY_HALF - ROAD_HALF), X(L - ROAD_HALF), (CITY_HALF + ROAD_HALF) * 2 * S, ROAD_HALF * 2 * S);
    }
    cc.strokeStyle = 'rgba(240,200,80,0.55)'; cc.lineWidth = 1;
    for (let i = 0; i < LINES; i++) {
      const L = lineCoord(i);
      cc.beginPath(); cc.moveTo(X(L), X(-CITY_HALF - ROAD_HALF)); cc.lineTo(X(L), X(CITY_HALF + ROAD_HALF)); cc.stroke();
      cc.beginPath(); cc.moveTo(X(-CITY_HALF - ROAD_HALF), X(L)); cc.lineTo(X(CITY_HALF + ROAD_HALF), X(L)); cc.stroke();
    }
    this.cityMap = C; this.cityS = S;
  }

  drawMinimap(px, pz, camYaw, headingYaw, cars, zoom) {
    const ctx = this.miniCtx, W = this.mini.width, H = this.mini.height;
    const scale = zoom; // px per metre
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 3, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#20262b'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    // camera forward is "up" on the map. World +z (screen down) rotated so forward points up.
    ctx.rotate(camYaw - Math.PI);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrainMap, -WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
    ctx.drawImage(this.cityMap, -CITY_EDGE, -CITY_EDGE, CITY_EDGE * 2, CITY_EDGE * 2);
    // traffic dots
    ctx.fillStyle = '#e8d27a';
    for (const c of cars) { ctx.fillRect(c.x - 1.4, c.z - 1.4, 2.8, 2.8); }
    ctx.restore();
    // player arrow (rotated relative to camera)
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-(headingYaw - camYaw));
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
    // north marker
    // world north (-z) rotated into screen space
    const r = W / 2 - 14;
    const nx = W / 2 - Math.sin(camYaw) * r, ny = H / 2 + Math.cos(camYaw) * r;
    ctx.fillStyle = '#0d1114'; ctx.beginPath(); ctx.arc(nx, ny, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff5a4f'; ctx.font = '700 12px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 3, 0, Math.PI * 2); ctx.stroke();
  }

  drawSpeedo(kmh, rpm, redline, gear, maxKmh) {
    const ctx = this.speedoCtx, W = this.speedo.width, H = this.speedo.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = W / 2 - 10;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // backing
    ctx.fillStyle = 'rgba(10,13,16,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, Math.PI * 2); ctx.fill();
    // rpm ring
    const rf = clamp(rpm / (redline + 500), 0, 1);
    ctx.lineWidth = 7; ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, a0, a1); ctx.stroke();
    const redA = a0 + (a1 - a0) * (redline / (redline + 500));
    ctx.strokeStyle = 'rgba(255,70,60,0.35)';
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, redA, a1); ctx.stroke();
    ctx.strokeStyle = rpm > redline - 300 ? '#ff4b3e' : '#f2c14e';
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, a0, a0 + (a1 - a0) * rf); ctx.stroke();
    // speed ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '600 11px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const step = maxKmh > 260 ? 40 : 20;
    for (let v = 0; v <= maxKmh; v += step / 2) {
      const a = a0 + (a1 - a0) * (v / maxKmh);
      const major = v % step === 0;
      const r0 = R - (major ? 22 : 17), r1 = R - 12;
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
      if (major) ctx.fillText(String(v), cx + Math.cos(a) * (R - 33), cy + Math.sin(a) * (R - 33));
    }
    // needle
    const na = a0 + (a1 - a0) * clamp(kmh / maxKmh, 0, 1.02);
    ctx.strokeStyle = '#ff5a4f'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * 10, cy - Math.sin(na) * 10); ctx.lineTo(cx + Math.cos(na) * (R - 16), cy + Math.sin(na) * (R - 16)); ctx.stroke();
    ctx.fillStyle = '#1a1f24'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    // digital
    ctx.fillStyle = '#ffffff'; ctx.font = '700 30px "Saira Condensed", sans-serif';
    ctx.fillText(String(Math.round(kmh)), cx, cy + R * 0.42);
    ctx.font = '600 10px "Saira Condensed", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('KM/H', cx, cy + R * 0.42 + 19);
    ctx.font = '700 17px "Saira Condensed", sans-serif'; ctx.fillStyle = '#f2c14e';
    ctx.fillText(gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear), cx, cy - R * 0.38);
  }

  showRadio(station, song) {
    this.radioName.textContent = station.name;
    this.radioName.style.color = station.color;
    this.radioSong.textContent = station.id === 'off' ? '' : station.id === 'talk' ? 'News, weather and opinions' : song ? `${song.title} · ${song.artist}` : station.genre;
    this.radioEl.classList.add('show');
    this.radioTimer = 4.5;
  }

  toast(text, t = 2.5) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = t;
  }

  setPrompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    this.promptEl.innerHTML = text;
    this.promptEl.classList.toggle('show', !!text);
  }

  update(dt, s) {
    if (this.radioTimer > 0) { this.radioTimer -= dt; if (this.radioTimer <= 0) this.radioEl.classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.remove('show'); }
    this.clockEl.textContent = s.clock;
    this.speedoWrap.classList.toggle('show', s.inCar);
    if (s.inCar) this.drawSpeedo(s.kmh, s.rpm, s.redline, s.gear, s.maxKmh);
    this.minimapT = (this.minimapT || 0) + dt;
    if (this.minimapT > 1 / 30) {
      this.minimapT = 0;
      this.drawMinimap(s.px, s.pz, s.camYaw, s.heading, s.cars, s.zoom);
    }
    if (this.fpsEl && s.fps !== undefined) this.fpsEl.textContent = `${Math.round(s.fps)} FPS`;
  }
}
