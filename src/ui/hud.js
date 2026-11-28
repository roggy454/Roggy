// HUD: rotating minimap, speedometer/tachometer, clock & weather, location,
// notifications, radio banner, help and settings menu.
import { slabs, edges, nodes, grassRects, LAND, BEACH, HALF_ROAD, districtName, nearestRoad, STREET_NAMES } from '../world/map.js';
import { STATE, QUALITY } from '../core/globals.js';
import { WEATHERS } from '../world/weather.js';
import { clamp } from '../core/utils.js';

const EW_NAMES = ['Harbor St', 'Pelican St', 'Mango St', 'Bayview St', 'Coquina St', 'Hibiscus St', 'Flamingo Way', 'Sunset St', 'Tarpon St', 'Seagrape St', 'Marlin St', 'Orchid St', 'Manatee St'];
const MAP = { x0: -760, x1: 800, z0: -680, z1: 680, s: 0.7 }; // px per metre

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = (id) => document.getElementById(id);
    this.mini = this.el('minimap');
    this.mctx = this.mini.getContext('2d');
    this.speedEl = this.el('speed');
    this.tacho = this.el('tacho');
    this.tctx = this.tacho.getContext('2d');
    this.notes = [];
    this.buildMap();
    this.lastLoc = '';
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;
    this.helpVisible = true;
    setTimeout(() => this.toggleHelp(false), 14000);
  }

  buildMap() {
    const W = Math.ceil((MAP.x1 - MAP.x0) * MAP.s), H = Math.ceil((MAP.z1 - MAP.z0) * MAP.s);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const X = (x) => (x - MAP.x0) * MAP.s, Z = (z) => (z - MAP.z0) * MAP.s;
    ctx.fillStyle = '#123a52'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d8c48f'; ctx.fillRect(X(BEACH.x0), Z(BEACH.z0), (615 - BEACH.x0) * MAP.s, (BEACH.z1 - BEACH.z0) * MAP.s);
    ctx.fillStyle = '#3a3d42';
    for (const l of LAND) ctx.fillRect(X(l.x0), Z(l.z0), (l.x1 - l.x0) * MAP.s, (l.z1 - l.z0) * MAP.s);
    for (const s of slabs) {
      ctx.fillStyle = s.kind === 'park' ? '#3f7a45' : s.kind === 'parking' ? '#45484d' : '#6c6f74';
      ctx.fillRect(X(s.x0), Z(s.z0), (s.x1 - s.x0) * MAP.s, (s.z1 - s.z0) * MAP.s);
    }
    ctx.fillStyle = '#3f7a45';
    for (const g of grassRects) ctx.fillRect(X(g.x0), Z(g.z0), (g.x1 - g.x0) * MAP.s, (g.z1 - g.z0) * MAP.s);
    ctx.fillStyle = '#26282c';
    for (const b of this.game.buildings.colliders) ctx.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * MAP.s, (b.z1 - b.z0) * MAP.s);
    ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 1.2 * MAP.s * 3;
    this.mapCanvas = c;
    this.X = X; this.Z = Z;
  }

  drawMinimap(px, pz, heading, camYaw) {
    const ctx = this.mctx, S = this.mini.width;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#123a52'; ctx.fillRect(0, 0, S, S);
    const zoom = this.game.player.vehicle ? 1.0 + clamp(Math.abs(this.game.player.vehicle.speed) / 60, 0, 0.6) : 1.0;
    ctx.translate(S / 2, S / 2);
    // camera-up map: rotate so camera forward points up
    ctx.rotate(Math.PI + camYaw);
    ctx.scale(1.25 / zoom, 1.25 / zoom);
    ctx.drawImage(this.mapCanvas, -this.X(px), -this.Z(pz));
    // traffic dots
    ctx.fillStyle = '#e8e8e8';
    for (const v of this.game.traffic.cars) ctx.fillRect(this.X(v.pos.x) - this.X(px) - 1.5, this.Z(v.pos.z) - this.Z(pz) - 1.5, 3, 3);
    ctx.restore();
    // player arrow (relative to camera)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-(heading - camYaw));
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // north marker
    const nr = S / 2 - 12;
    const nx = S / 2 - Math.sin(camYaw) * nr, ny = S / 2 + Math.cos(camYaw) * nr;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(nx, ny, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny + 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.stroke();
  }

  drawTacho(v) {
    const ctx = this.tctx, W = this.tacho.width, H = this.tacho.height;
    ctx.clearRect(0, 0, W, H);
    const vp = v.vp;
    const rpm = vp ? vp.rpm : 0, max = v.spec.maxRpm;
    const cx = W / 2, cy = H * 0.62, r = W * 0.42;
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    const t = clamp(rpm / (max * 1.02), 0, 1);
    const grad = ctx.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#3ef0c8'); grad.addColorStop(0.75, '#ffd23f'); grad.addColorStop(1, '#ff3b5c');
    ctx.strokeStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * t); ctx.stroke();
    ctx.strokeStyle = '#ff3b5c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r + 7, a0 + (a1 - a0) * 0.88, a1); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center';
    const steps = Math.floor(max / 1000);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i * 1000 / (max * 1.02));
      ctx.fillText(String(i), cx + Math.cos(a) * (r - 15), cy + Math.sin(a) * (r - 15) + 3);
    }
  }

  notify(text, dur = 3) {
    const box = this.el('notify');
    box.textContent = text;
    box.classList.add('show');
    clearTimeout(this._nt);
    this._nt = setTimeout(() => box.classList.remove('show'), dur * 1000);
  }
  banner(title, sub) {
    const b = this.el('banner');
    b.innerHTML = `<div class="b-title"></div><div class="b-sub"></div>`;
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-sub').textContent = sub || '';
    b.classList.add('show');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.remove('show'), 3200);
  }
  toggleHelp(force) {
    this.helpVisible = force ?? !this.helpVisible;
    this.el('help').classList.toggle('hidden', !this.helpVisible);
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; this.el('fps').textContent = `${Math.round(this.fps)} FPS · ${STATE.q.name}`; }
    const h = Math.floor(STATE.hour), m = Math.floor((STATE.hour % 1) * 60);
    const hh = ((h + 11) % 12) + 1;
    this.el('clock').textContent = `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    const temp = Math.round(24 + 7 * Math.sin((STATE.hour - 9) / 24 * Math.PI * 2) - g.weather.rain * 4);
    this.el('weather').textContent = `${g.weather.label()} · ${temp}°C`;
    const pos = p.pos;
    this.locT = (this.locT || 0) - dt;
    if (this.locT <= 0) {
      this.locT = 0.5;
      const d = districtName(pos.x, pos.z);
      const nr = nearestRoad(pos.x, pos.z);
      let street = '';
      if (nr && nr.dist < 14) {
        const e = nr.edge;
        if (e.axis === 'z') street = STREET_NAMES.x[String(e.a.x)] || '';
        else street = Math.abs(e.a.z) < 1 && e.len > 200 ? 'MacKenna Causeway' : Math.abs(e.a.z + 400) < 1 && e.len > 200 ? 'Venetian Causeway' : EW_NAMES[Math.round((e.a.z + 600) / 100)] || '';
      }
      this.el('location').innerHTML = `<div class="loc-d"></div><div class="loc-s"></div>`;
      this.el('location').querySelector('.loc-d').textContent = d;
      this.el('location').querySelector('.loc-s').textContent = street;
      if (d !== this.lastLoc) { this.lastLoc = d; }
    }
    const v = p.vehicle;
    const sp = this.el('speedo');
    if (v) {
      sp.classList.add('show');
      const kmh = Math.abs(v.speed) * 3.6;
      this.speedEl.textContent = Math.round(kmh);
      const vp = v.vp;
      this.el('gear').textContent = vp ? (vp.gear === -1 ? 'R' : Math.abs(v.speed) < 0.5 && vp.throttle < 0.05 ? 'N' : String(vp.gear)) : 'N';
      this.el('carname').textContent = v.name;
      const hp = clamp(v.health / 1000, 0, 1);
      this.el('health').style.width = `${hp * 100}%`;
      this.el('health').style.background = hp > 0.5 ? '#3ef0c8' : hp > 0.25 ? '#ffd23f' : '#ff3b5c';
      this.drawTacho(v);
    } else sp.classList.remove('show');
    const stam = this.el('stamina');
    stam.style.width = `${p.stamina * 100}%`;
    stam.parentElement.classList.toggle('hidden', !!v || p.stamina > 0.98);
    // prompt
    const prompt = this.el('prompt');
    if (!v) {
      const nv = p.nearestVehicle();
      if (nv) { prompt.textContent = `Press F to enter ${nv.name}`; prompt.classList.add('show'); }
      else prompt.classList.remove('show');
    } else if (v.vp && v.vp.isUpsideDown()) { prompt.textContent = 'Press R to flip the car'; prompt.classList.add('show'); }
    else if (v.submerged > 2) { prompt.textContent = 'Engine flooded — press F to swim out'; prompt.classList.add('show'); }
    else prompt.classList.remove('show');
    this.drawMinimap(pos.x, pos.z, v ? v.yaw : p.heading, g.cameraRig.yaw);
  }
}
