// Fully synthesized audio (Web Audio API) — no sample files.
import { clamp, lerp, RNG } from '../core/utils.js';

function noiseBuffer(ctx, type = 'white', seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'white') d[i] = w;
    else if (type === 'pink') { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2; }
    else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  return buf;
}

function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

class Loop {
  // looping noise -> filter chain -> gain
  constructor(A, buf, filters, out, gain = 0) {
    const ctx = A.ctx;
    this.src = ctx.createBufferSource(); this.src.buffer = buf; this.src.loop = true;
    this.src.playbackRate.value = 0.9 + Math.random() * 0.2;
    let node = this.src;
    this.filters = filters.map(([type, f, q]) => { const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q ?? 0.7; node.connect(fl); node = fl; return fl; });
    this.gain = ctx.createGain(); this.gain.gain.value = gain;
    node.connect(this.gain); this.gain.connect(out);
    this.src.start(0, Math.random() * 1.5);
  }
  set(v, t = 0.1) { this.gain.gain.setTargetAtTime(v, this.gain.context.currentTime, t); }
}

class EngineSound {
  constructor(A, spec) {
    const ctx = A.ctx;
    this.A = A; this.spec = spec;
    this.cyl = spec.cyl || 6;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(A.engineBus);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 1.6; this.lp.frequency.value = 600;
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = distCurve(spec.sporty ? 6 : 3);
    this.mix = ctx.createGain(); this.mix.gain.value = 0.5;
    this.am = ctx.createGain(); this.am.gain.value = 1;
    this.mix.connect(this.shaper); this.shaper.connect(this.lp); this.lp.connect(this.am); this.am.connect(this.out);
    const mk = (type, g, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.detune.value = det; const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(this.mix); o.start(); return o; };
    this.o1 = mk('sawtooth', 0.55);
    this.o2 = mk('square', 0.35, -8);
    this.o3 = mk('sawtooth', 0.22, 7);
    this.o4 = mk('sine', 0.6);
    // lumpy idle / firing irregularity
    this.lfo = ctx.createOscillator(); this.lfo.type = 'triangle';
    this.lfoG = ctx.createGain(); this.lfoG.gain.value = 0.25;
    this.lfo.connect(this.lfoG); this.lfoG.connect(this.am.gain); this.lfo.start();
    // intake / exhaust rasp
    this.noise = new Loop(A, A.white, [['bandpass', 800, 0.9]], this.lp, 0);
    // turbo
    this.turbo = null;
    if (spec.brand === 'PICO' || spec.brand === 'KODIAK') {
      const t = ctx.createOscillator(); t.type = 'sine'; const tg = ctx.createGain(); tg.gain.value = 0;
      t.connect(tg); tg.connect(this.out); t.start(); this.turbo = { o: t, g: tg };
    }
    this.lastThrottle = 0;
    this.boost = 0;
  }
  update(rpm, throttle, shifting, dt) {
    const ctx = this.A.ctx, t = ctx.currentTime;
    const f = rpm / 60 * this.cyl / 2;
    const s = 0.04;
    this.o1.frequency.setTargetAtTime(f, t, s);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, s);
    this.o3.frequency.setTargetAtTime(f * 2.0, t, s);
    this.o4.frequency.setTargetAtTime(f * 0.5, t, s);
    this.lfo.frequency.setTargetAtTime(f / this.cyl * 1.5, t, s);
    const rn = rpm / this.spec.maxRpm;
    this.lp.frequency.setTargetAtTime(280 + throttle * 2400 * (0.4 + rn) + rn * 900, t, 0.05);
    this.lfoG.gain.setTargetAtTime(lerp(0.35, 0.08, rn), t, 0.1);
    this.noise.filters[0].frequency.setTargetAtTime(f * 2.2, t, 0.05);
    this.noise.set(0.08 + throttle * 0.35 * (0.3 + rn), 0.05);
    const vol = (0.22 + throttle * 0.32 + rn * 0.22) * (shifting ? 0.55 : 1);
    this.out.gain.setTargetAtTime(vol, t, 0.04);
    // decel crackles
    if (this.spec.sporty && this.lastThrottle > 0.6 && throttle < 0.15 && rpm > this.spec.maxRpm * 0.45) {
      for (let i = 0; i < 6; i++) this.A.pop(t + 0.05 + Math.random() * 0.7, 0.35 + Math.random() * 0.4);
    }
    if (this.turbo) {
      this.boost = lerp(this.boost, throttle * rn, Math.min(1, dt * 3));
      this.turbo.o.frequency.setTargetAtTime(2500 + this.boost * 5000, t, 0.1);
      this.turbo.g.gain.setTargetAtTime(this.boost * 0.035, t, 0.1);
      if (this.lastThrottle > 0.7 && throttle < 0.2 && this.boost > 0.3) this.A.blowoff();
    }
    this.lastThrottle = throttle;
  }
  stop() {
    const t = this.A.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => { try { [this.o1, this.o2, this.o3, this.o4, this.lfo, this.noise.src].forEach((o) => o.stop()); this.turbo?.o.stop(); this.out.disconnect(); } catch (e) { /* */ } }, 900);
  }
}

// ------------------------------------------------------------ procedural radio
class Radio {
  constructor(A) {
    this.A = A; this.ctx = A.ctx;
    this.out = this.ctx.createGain(); this.out.gain.value = 0.0;
    this.lp = this.ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 16000;
    this.out.connect(this.lp); this.lp.connect(A.musicBus);
    this.station = 0; // 0 off
    this.stations = [null, { name: 'NEON FM 101.9', genre: 'Synthwave', bpm: 104 }, { name: 'PALM WAVES 88.3', genre: 'Chillhop', bpm: 82 }, { name: 'CALLE OCHO 95.5', genre: 'Latin House', bpm: 122 }];
    this.step = 0; this.nextTime = 0; this.bar = 0;
    this.rng = new RNG(1985);
    this.timer = setInterval(() => this.schedule(), 25);
    this.vol = 0.0;
  }
  setStation(i) { this.station = i; this.step = 0; this.nextTime = this.ctx.currentTime + 0.05; this.bar = 0; this.rng = new RNG(1985 + i * 7); }
  next() { this.setStation((this.station + 1) % this.stations.length); return this.station ? this.stations[this.station] : null; }
  setVolume(v, muffled) { const t = this.ctx.currentTime; this.out.gain.setTargetAtTime(this.station ? v : 0, t, 0.3); this.lp.frequency.setTargetAtTime(muffled ? 900 : 16000, t, 0.3); }
  note(freq, t, dur, type, gain, cutoff = 3000, attack = 0.005, rel = 0.1, detune = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setTargetAtTime(0, t + dur, rel);
    o.connect(f); f.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + rel * 6);
  }
  kick(t, g = 0.9) {
    const ctx = this.ctx, o = ctx.createOscillator(), gn = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(gn); gn.connect(this.out); o.start(t); o.stop(t + 0.4);
  }
  noiseHit(t, dur, g, f, type = 'highpass') {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.A.white;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const gn = ctx.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  schedule() {
    if (!this.station || this.ctx.state !== 'running') return;
    const st = this.stations[this.station];
    const spb = 60 / st.bpm / 4; // 16th
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.play(this.step, this.nextTime, spb);
      this.nextTime += spb * (this.station === 2 && this.step % 2 ? 1.1 : this.station === 2 ? 0.9 : 1);
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }
  play(s, t, spb) {
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const prog = this.station === 1 ? [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]] : this.station === 2 ? [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 48, 52, 55]] : [[57, 60, 64], [62, 65, 69], [55, 59, 62], [53, 57, 60]];
    const chord = prog[Math.floor(this.bar / (this.station === 2 ? 1 : 2)) % prog.length];
    if (this.station === 1) {
      if (s % 4 === 0) this.kick(t, 0.8);
      if (s === 4 || s === 12) { this.noiseHit(t, 0.18, 0.35, 1500, 'bandpass'); this.note(180, t, 0.05, 'triangle', 0.25, 2000); }
      if (s % 2 === 0) this.noiseHit(t, 0.04, 0.08, 7000);
      if (s % 2 === 0) this.note(mtof(chord[0] - 24), t, spb * 1.6, 'sawtooth', 0.22, 600 + 300 * Math.sin(this.bar), 0.005, 0.05);
      const arp = chord[(s % 3)] + 12 + (s % 8 > 5 ? 12 : 0);
      this.note(mtof(arp), t, spb * 0.8, 'square', 0.05, 2200, 0.003, 0.06);
      if (s === 0 && this.bar % 2 === 0) for (const n of chord) this.note(mtof(n), t, spb * 30, 'sawtooth', 0.04, 1400, 0.5, 0.8, (Math.random() - 0.5) * 14);
      if (this.bar % 4 >= 2 && s % 4 === 2 && this.rng.chance(0.7)) this.note(mtof(chord[this.rng.int(0, 2)] + 24), t, spb * 2.5, 'triangle', 0.07, 4000, 0.01, 0.2);
    } else if (this.station === 2) {
      if (s === 0 || s === 10) this.kick(t, 0.55);
      if (s === 4 || s === 12) this.noiseHit(t, 0.12, 0.18, 1800, 'bandpass');
      if (s % 2 === 0) this.noiseHit(t, 0.03, 0.04, 8000);
      if (s === 0) for (const n of chord) this.note(mtof(n), t, spb * 14, 'sine', 0.07, 1800, 0.02, 0.6);
      if (s === 0 || s === 7 || s === 10) this.note(mtof(chord[0] - 24), t, spb * 3, 'sine', 0.35, 400, 0.01, 0.1);
      if (s % 4 === 3 && this.rng.chance(0.5)) this.note(mtof(chord[this.rng.int(0, 3)] + 12), t, spb * 1.5, 'triangle', 0.05, 2500, 0.01, 0.3);
      if (this.rng.chance(0.3)) this.noiseHit(t, 0.01, 0.015, 3000); // vinyl crackle
    } else {
      if (s % 4 === 0) this.kick(t, 0.85);
      if (s % 4 === 2) this.noiseHit(t, 0.06, 0.12, 6000);
      if (s === 4 || s === 12) { this.noiseHit(t, 0.1, 0.2, 2200, 'bandpass'); }
      if ([0, 3, 6, 10, 12].includes(s)) this.note(mtof(chord[0] - 12 + ([3, 10].includes(s) ? 7 : 0)), t, spb * 1.2, 'sawtooth', 0.12, 900, 0.005, 0.05);
      if ([2, 5, 8, 11, 14].includes(s)) for (const n of chord) this.note(mtof(n + 12), t, spb * 0.7, 'square', 0.025, 2500, 0.003, 0.05);
      if (s % 3 === 0) this.noiseHit(t, 0.05, 0.05, 4000, 'bandpass'); // conga-ish shaker
    }
  }
}

export class Audio {
  constructor() {
    this.ok = false;
  }
  init() {
    if (this.ok) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    const bus = (g) => { const n = ctx.createGain(); n.gain.value = g; n.connect(this.master); return n; };
    this.sfx = bus(0.9); this.engineBus = bus(0.7); this.amb = bus(0.6); this.musicBus = bus(0.55);
    this.white = noiseBuffer(ctx, 'white', 2); this.pink = noiseBuffer(ctx, 'pink', 3); this.brown = noiseBuffer(ctx, 'brown', 3);
    // ambience loops
    this.city = new Loop(this, this.brown, [['lowpass', 320]], this.amb, 0);
    this.cityHigh = new Loop(this, this.pink, [['bandpass', 1200, 0.4]], this.amb, 0);
    this.wind = new Loop(this, this.pink, [['bandpass', 500, 0.6]], this.amb, 0);
    this.rain = new Loop(this, this.white, [['highpass', 900], ['lowpass', 9000]], this.amb, 0);
    this.rainRoof = new Loop(this, this.pink, [['bandpass', 400, 0.8]], this.amb, 0);
    this.surf = new Loop(this, this.pink, [['lowpass', 650]], this.amb, 0);
    this.screech = new Loop(this, this.white, [['bandpass', 1900, 7], ['peaking', 2700, 6]], this.sfx, 0);
    this.offroad = new Loop(this, this.brown, [['lowpass', 500]], this.sfx, 0);
    this.roadNoise = new Loop(this, this.brown, [['lowpass', 180]], this.sfx, 0);
    this.windCar = new Loop(this, this.pink, [['bandpass', 700, 0.5]], this.sfx, 0);
    this.crickets = this.makeCrickets();
    this.radio = new Radio(this);
    this.engine = null;
    this.engineFor = null;
    this.hornNodes = new Map();
    this.nextBird = 2; this.nextSiren = 30;
    this.ok = true;
    if (ctx.state === 'suspended') ctx.resume();
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  makeCrickets() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.value = 4600;
    const am = ctx.createGain(); am.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 28;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(am); am.connect(g); g.connect(this.amb);
    o.start(); lfo.start();
    return g;
  }

  // ---------- one-shots
  burst(t, dur, gain, filters, out = this.sfx, buf = this.white, panner = null) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf;
    let n = s;
    for (const [type, f, q] of filters) { const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q ?? 0.8; n.connect(fl); n = fl; }
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    n.connect(g);
    if (panner) { g.connect(panner); panner.connect(out); } else g.connect(out);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }
  tone(t, f0, f1, dur, gain, type = 'sine', out = this.sfx, panner = null) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); if (panner) { g.connect(panner); panner.connect(out); } else g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 200; p.rolloffFactor = 1.3;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }
  pop(t, g) { if (!this.ok) return; this.burst(t, 0.05, g, [['bandpass', 600 + Math.random() * 600, 1.5]]); this.tone(t, 120, 60, 0.05, g * 0.5); }
  blowoff() { if (!this.ok) return; this.burst(this.ctx.currentTime, 0.35, 0.18, [['highpass', 2500]]); }
  shift(v, d) { if (!this.ok || v !== this.engineFor) return; this.burst(this.ctx.currentTime, 0.04, 0.12, [['bandpass', 3000, 2]]); if (v.spec.sporty && d > 0) this.pop(this.ctx.currentTime + 0.03, 0.5); }

  footstep(surface, speed, wet, isPlayer, pos = null) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const run = clamp((speed - 2) / 5, 0, 1);
    const g = (isPlayer ? 0.32 : 0.22) * (0.55 + run * 0.6);
    const pn = pos ? this.panner(pos) : null;
    if (surface === 'grass') {
      this.burst(t, 0.13 + run * 0.04, g * 0.7, [['lowpass', 1500], ['highpass', 200]], this.sfx, this.pink, pn);
      this.burst(t + 0.02, 0.08, g * 0.25, [['highpass', 3500]], this.sfx, this.white, pn ? this.panner(pos) : null);
    } else if (surface === 'sand') {
      for (let i = 0; i < 3; i++) this.burst(t + i * 0.025, 0.07, g * 0.45, [['bandpass', 800 + i * 300, 0.7]], this.sfx, this.white, pn && i === 0 ? pn : pos ? this.panner(pos) : null);
    } else if (surface === 'water') {
      this.burst(t, 0.35, g * 0.8, [['lowpass', 1100]], this.sfx, this.pink, pn);
    } else {
      this.burst(t, 0.045 + run * 0.02, g, [['bandpass', 2400 - run * 600, 1.1]], this.sfx, this.white, pn);
      this.tone(t, 110 + run * 30, 55, 0.07, g * 0.9, 'sine', this.sfx, pos ? this.panner(pos) : null);
      if (wet) this.burst(t + 0.01, 0.14, g * 0.55, [['highpass', 2600]], this.sfx, this.white, pos ? this.panner(pos) : null);
    }
  }
  jump() { if (!this.ok) return; this.burst(this.ctx.currentTime, 0.08, 0.12, [['lowpass', 900]], this.sfx, this.pink); }
  land(v) { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(t, 90, 40, 0.15, clamp(v / 10, 0.2, 0.7)); this.burst(t, 0.12, 0.3, [['lowpass', 1200]]); }
  splash() { if (!this.ok) return; this.burst(this.ctx.currentTime, 0.6, 0.5, [['lowpass', 1800]], this.sfx, this.pink); }
  door() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(t, 140, 60, 0.12, 0.5); this.burst(t, 0.08, 0.25, [['lowpass', 1500]]); }
  thud(pos, sp) { if (!this.ok) return; const t = this.ctx.currentTime; this.tone(t, 100, 45, 0.2, 0.8, 'sine', this.sfx, this.panner(pos)); this.burst(t, 0.15, 0.6, [['lowpass', 900]], this.sfx, this.pink, this.panner(pos)); }
  crash(pos, imp, prop) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, g = clamp(imp / 14, 0.15, 1.2);
    this.burst(t, 0.3 + g * 0.3, g, [['lowpass', 1400 + g * 1500]], this.sfx, this.pink, this.panner(pos));
    this.tone(t, 70, 35, 0.3, g * 0.9, 'sine', this.sfx, this.panner(pos));
    for (const f of [420, 690, 1130, 1780]) this.tone(t, f * (0.9 + Math.random() * 0.2), f * 0.97, 0.25 + Math.random() * 0.4, g * 0.08, 'triangle', this.sfx, this.panner(pos));
    if (imp > 9) for (let i = 0; i < 8; i++) this.burst(t + 0.05 + Math.random() * 0.25, 0.05, 0.15, [['highpass', 5000 + Math.random() * 4000]], this.sfx, this.white, this.panner(pos));
  }
  horn(v, dur = 0.4) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = v === this.engineFor ? null : this.panner(v.pos);
    const base = v.spec.mass > 2000 ? 330 : v.spec.sporty ? 500 : 420;
    for (const f of [base, base * 1.26]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 2200;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.setValueAtTime(0.12, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      o.connect(fl); fl.connect(g); if (p) { g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  hornHold(v) { if (!this.ok) return; const now = this.ctx.currentTime; if (!this._hornUntil || this._hornUntil < now + 0.05) { this.horn(v, 0.15); this._hornUntil = now + 0.15; } }
  thunder(dist) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, g = clamp(900 / (dist + 200), 0.3, 1.6);
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.brown;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(dist < 500 ? 900 : 300, t); f.frequency.exponentialRampToValueAtTime(60, t + 5);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + 0.08);
    for (let i = 1; i < 8; i++) gn.gain.linearRampToValueAtTime(g * (0.3 + Math.random() * 0.7) * (1 - i / 9), t + i * 0.6);
    gn.gain.linearRampToValueAtTime(0, t + 6);
    s.connect(f); f.connect(gn); gn.connect(this.amb); s.start(t); s.stop(t + 6.2);
    if (dist < 500) this.burst(t, 0.25, g * 0.6, [['highpass', 1500]], this.amb, this.white);
  }
  bird(pos) {
    const t = this.ctx.currentTime, p = this.panner(pos);
    const base = 2500 + Math.random() * 2000;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(t + i * 0.13, base * (1 + Math.random() * 0.3), base * (0.7 + Math.random() * 0.5), 0.09, 0.05, 'sine', this.amb, i === 0 ? p : this.panner(pos));
  }
  siren(pos) {
    const ctx = this.ctx, t = ctx.currentTime, p = this.panner(pos);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    for (let i = 0; i < 8; i++) { o.frequency.setValueAtTime(650, t + i * 0.9); o.frequency.linearRampToValueAtTime(1300, t + i * 0.9 + 0.45); o.frequency.linearRampToValueAtTime(650, t + i * 0.9 + 0.9); }
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 1); g.gain.linearRampToValueAtTime(0, t + 7.5);
    o.connect(f); f.connect(g); g.connect(p); p.connect(this.amb); o.start(t); o.stop(t + 7.6);
  }

  startEngine(v) {
    if (!this.ok) return;
    this.stopEngine();
    this.engine = new EngineSound(this, v.spec);
    this.engineFor = v;
    const t = this.ctx.currentTime;
    this.burst(t, 0.5, 0.25, [['bandpass', 400, 1]]); // starter
    this.radio.setVolume(this.radio.station ? 0.5 : 0, false);
  }
  stopEngine() { if (this.engine) { this.engine.stop(); this.engine = null; this.engineFor = null; } this.radio?.setVolume(0, true); }
  nextStation() { if (!this.ok) return null; const s = this.radio.next(); this.radio.setVolume(this.engineFor ? 0.5 : 0, false); return s; }

  // ---------- per frame
  update(dt, game) {
    if (!this.ok) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const cam = game.camera;
    const L = ctx.listener;
    const f = cam.getWorldDirection(new cam.position.constructor());
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, t, 0.02); L.positionY.setTargetAtTime(cam.position.y, t, 0.02); L.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    const W = game.weather, sky = game.sky;
    const p = game.player;
    const v = p.vehicle;
    const inCar = !!v;
    const pos = p.pos;
    const downtown = pos.x < -20 ? 1 : pos.x > 330 && pos.x < 555 ? 0.6 : 0.25;
    const night = sky.info.night;
    this.city.set(0.12 * downtown * (1 - night * 0.4) * (inCar ? 0.5 : 1), 0.5);
    this.cityHigh.set(0.025 * downtown * (1 - night * 0.6), 0.5);
    this.wind.set((0.02 + W.wind * 0.12) * (inCar ? 0.3 : 1), 0.5);
    this.rain.set(W.rain * (inCar ? 0.06 : 0.22), 0.5);
    this.rainRoof.set(inCar ? W.rain * 0.35 : 0, 0.3);
    const shoreD = Math.abs(pos.x - 612);
    const surfLevel = pos.x > 480 ? clamp(1 - shoreD / 140, 0, 1) : 0;
    const swell = 0.6 + 0.4 * Math.sin(t * 0.85) * Math.sin(t * 0.31);
    this.surf.set(surfLevel * 0.35 * swell * (0.6 + W.wind * 0.6) * (inCar ? 0.4 : 1), 0.3);
    this.crickets.gain.setTargetAtTime(night * 0.012 * (1 - W.rain) * (pos.x > -80 && pos.x < 600 ? 1 : 0.5) * (inCar ? 0.2 : 1), t, 1);
    // birds by day in parks / beach
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 1.5 + Math.random() * 5;
      if (sky.info.dayK > 0.5 && W.rain < 0.2 && !inCar) this.bird({ x: pos.x + (Math.random() - 0.5) * 40, y: 8, z: pos.z + (Math.random() - 0.5) * 40 });
    }
    this.nextSiren -= dt;
    if (this.nextSiren <= 0) { this.nextSiren = 60 + Math.random() * 120; if (downtown > 0.5) this.siren({ x: pos.x + (Math.random() - 0.5) * 600, y: 5, z: pos.z + (Math.random() - 0.5) * 600 }); }
    // vehicle sounds
    if (inCar && v.vp && this.engine) {
      const vp = v.vp;
      this.engine.update(vp.rpm, vp.engineOn ? vp.load : 0, vp.shiftT > 0, dt);
      if (!vp.engineOn) this.engine.out.gain.setTargetAtTime(0, t, 0.3);
      const sp = Math.abs(v.speed);
      let slip = 0, off = 0;
      for (let i = 0; i < 4; i++) {
        const s = vp.surfaces[i];
        const sl = Math.max(vp.slip[i], vp.driven.includes(i) ? vp.wheelspin : 0);
        if (s === 'road' || s === 'lot' || s === 'sidewalk') slip = Math.max(slip, sl * clamp(sp / 4 + vp.wheelspin, 0, 1));
        else off = Math.max(off, s === 'water' ? 0 : 1);
      }
      this.screech.set(slip * 0.16 * (1 - W.wet * 0.6), 0.05);
      this.offroad.set(off * clamp(sp / 15, 0, 1) * 0.3, 0.1);
      this.roadNoise.set(clamp(sp / 30, 0, 1) * 0.22 + W.wet * clamp(sp / 20, 0, 1) * 0.1, 0.2);
      this.windCar.set(Math.pow(clamp(sp / 60, 0, 1), 2) * 0.25, 0.2);
      this.radio.setVolume(0.5, false);
    } else {
      this.screech.set(0, 0.1); this.offroad.set(0, 0.1); this.roadNoise.set(0, 0.2); this.windCar.set(0, 0.2);
    }
  }
}
