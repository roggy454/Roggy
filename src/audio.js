// Sound: synthesized engine (pitch follows RPM, timbre follows load), tyre squeal, wind,
// horn, crashes, footsteps, city ambience, distant NPC honks, plus the radio.
import { Radio, STATIONS } from './radio.js';
import { clamp } from './utils.js';

export class AudioSystem {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.volumes = { master: 0.8, radio: 0.7, sfx: 0.9 };
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volumes.master;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
    // car radio speakers: slight mid boost, gentle low cut
    this.radioOut = ctx.createGain(); this.radioOut.gain.value = this.volumes.radio * 0.8;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2500; pk.gain.value = 2;
    this.radioOut.connect(hp); hp.connect(pk); pk.connect(this.master);

    this.white = this.noiseBuffer(3, 'white');
    this.brown = this.noiseBuffer(4, 'brown');

    this.buildEngine();
    this.buildLoops();
    this.radio = new Radio(ctx, this.radioOut);
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  noiseBuffer(sec, kind) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  loop(buf, filterType, freq, q, gain) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(0, Math.random() * 2);
    return { src: s, filter: f, gain: g };
  }

  buildEngine() {
    const ctx = this.ctx;
    const e = {};
    e.out = ctx.createGain(); e.out.gain.value = 0;
    e.lp = ctx.createBiquadFilter(); e.lp.type = 'lowpass'; e.lp.frequency.value = 800; e.lp.Q.value = 1.5;
    e.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
    e.shaper.curve = curve;
    e.mix = ctx.createGain(); e.mix.gain.value = 0.5;
    e.o1 = ctx.createOscillator(); e.o1.type = 'sawtooth';
    e.o2 = ctx.createOscillator(); e.o2.type = 'square';
    e.o3 = ctx.createOscillator(); e.o3.type = 'sawtooth'; e.o3.detune.value = 12;
    e.g1 = ctx.createGain(); e.g1.gain.value = 0.5;
    e.g2 = ctx.createGain(); e.g2.gain.value = 0.35;
    e.g3 = ctx.createGain(); e.g3.gain.value = 0.18;
    e.o1.connect(e.g1); e.o2.connect(e.g2); e.o3.connect(e.g3);
    e.g1.connect(e.mix); e.g2.connect(e.mix); e.g3.connect(e.mix);
    // firing-pulse amplitude modulation gives the "putter" at idle
    e.am = ctx.createGain(); e.am.gain.value = 0.7;
    e.amOsc = ctx.createOscillator(); e.amOsc.type = 'sine';
    e.amDepth = ctx.createGain(); e.amDepth.gain.value = 0.3;
    e.amOsc.connect(e.amDepth); e.amDepth.connect(e.am.gain);
    e.mix.connect(e.am); e.am.connect(e.shaper); e.shaper.connect(e.lp);
    // intake/exhaust noise
    e.noise = ctx.createBufferSource(); e.noise.buffer = this.brown; e.noise.loop = true;
    e.nbp = ctx.createBiquadFilter(); e.nbp.type = 'bandpass'; e.nbp.frequency.value = 300; e.nbp.Q.value = 0.8;
    e.ng = ctx.createGain(); e.ng.gain.value = 0.2;
    e.noise.connect(e.nbp); e.nbp.connect(e.ng); e.ng.connect(e.lp);
    e.lp.connect(e.out); e.out.connect(this.sfx);
    for (const o of [e.o1, e.o2, e.o3, e.amOsc]) o.start();
    e.noise.start();
    this.engine = e;
  }

  buildLoops() {
    this.squeal = this.loop(this.white, 'bandpass', 1500, 6, 0);
    this.wind = this.loop(this.brown, 'lowpass', 500, 0.5, 0);
    this.road = this.loop(this.brown, 'lowpass', 180, 0.7, 0);
    this.ambient = this.loop(this.brown, 'lowpass', 260, 0.5, 0.05);
    this.hornNodes = null;
  }

  // ---- per-frame ----
  update(state) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const e = this.engine;
    const inCar = state.inCar;
    const rpm = state.rpm || 900;
    const cyl = state.cylinders || 4;
    const f = (rpm / 60) * (cyl / 2);
    const thr = state.throttle || 0;
    const set = (p, v, tc = 0.05) => p.setTargetAtTime(v, t, tc);
    set(e.o1.frequency, f); set(e.o2.frequency, f / 2); set(e.o3.frequency, f * 2);
    set(e.amOsc.frequency, f / 2);
    set(e.lp.frequency, 350 + thr * 2400 + rpm * 0.25);
    set(e.nbp.frequency, 200 + rpm * 0.15);
    set(e.ng.gain, 0.08 + thr * 0.35);
    set(e.out.gain, inCar ? 0.13 + thr * 0.17 + rpm / 60000 : 0, 0.08);
    const speed = state.speed || 0;
    set(this.squeal.gain.gain, inCar ? clamp(state.skid || 0, 0, 1.2) * 0.22 : 0, 0.05);
    set(this.squeal.filter.frequency, 1300 + Math.sin(t * 7) * 150);
    set(this.wind.gain.gain, inCar ? clamp(speed / 60, 0, 1) ** 2 * 0.35 : clamp(speed / 10, 0, 1) * 0.05, 0.2);
    set(this.road.gain.gain, inCar ? clamp(speed / 30, 0, 1) * 0.25 * (state.offroad ? 2 : 1) : 0, 0.15);
    set(this.ambient.gain.gain, (state.night ? 0.035 : 0.06) * (inCar ? 0.5 : 1) + clamp(state.traffic || 0, 0, 1) * 0.06, 0.5);
    if (this.radio) this.radio.setOn(inCar && !this.muted);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.ctx.currentTime, 0.05);
  }
  setVolume(kind, v) {
    this.volumes[kind] = v;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (kind === 'master' && !this.muted) this.master.gain.setTargetAtTime(v, t, 0.05);
    if (kind === 'radio') this.radioOut.gain.setTargetAtTime(v * 0.8, t, 0.05);
    if (kind === 'sfx') this.sfx.gain.setTargetAtTime(v, t, 0.05);
  }

  horn(on) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.hornNodes) {
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const os = [349.2, 440].map((f) => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      lp.connect(g); g.connect(this.sfx);
      this.hornNodes = { g, os };
    } else if (!on && this.hornNodes) {
      const { g, os } = this.hornNodes;
      g.gain.setTargetAtTime(0, t, 0.02);
      os.forEach((o) => o.stop(t + 0.15));
      this.hornNodes = null;
    }
  }

  // distant one-shot honk with distance attenuation and stereo pan
  honkAt(dx, dz, listenerYaw, dist) {
    if (!this.ready || dist > 90) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.2;
    const vol = clamp(1 - dist / 90, 0, 1) ** 1.5 * 0.16;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const ang = Math.atan2(dx, dz) - listenerYaw;
    if (pan) pan.pan.value = clamp(-Math.sin(ang), -1, 1) * 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02);
    const dur = 0.25 + Math.random() * 0.4;
    g.gain.setValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600 - dist * 8;
    const base = 300 + Math.random() * 120;
    for (const f of [base, base * 1.26]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + dur + 0.1); }
    lp.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.sfx); } else g.connect(this.sfx);
  }

  crash(strength) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const v = clamp(strength, 0.05, 1);
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + v * 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(v * 0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + v * 0.4);
    s.connect(lp); lp.connect(g); g.connect(this.sfx); s.start(t, Math.random()); s.stop(t + 1);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(v * 0.9, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g2); g2.connect(this.sfx); o.start(t); o.stop(t + 0.5);
    if (v > 0.45) {
      // glass / metal tinkle
      for (let k = 0; k < 6; k++) {
        const tt = t + 0.04 + Math.random() * 0.35;
        const n = ctx.createBufferSource(); n.buffer = this.white;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4000 + Math.random() * 5000; bp.Q.value = 8;
        const gg = ctx.createGain(); gg.gain.setValueAtTime(0.15 * v, tt); gg.gain.exponentialRampToValueAtTime(0.001, tt + 0.08);
        n.connect(bp); bp.connect(gg); gg.connect(this.sfx); n.start(tt, Math.random()); n.stop(tt + 0.1);
      }
    }
  }

  footstep(surface, vol = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = surface === 'grass' ? 900 : 1700 + Math.random() * 400; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + (surface === 'grass' ? 0.09 : 0.05));
    s.connect(bp); bp.connect(g); g.connect(this.sfx); s.start(t, Math.random() * 2); s.stop(t + 0.12);
  }

  door() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.2);
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.18, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    s.connect(lp); lp.connect(g2); g2.connect(this.sfx); s.start(t); s.stop(t + 0.1);
  }

  shift() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(bp); bp.connect(g); g.connect(this.sfx); s.start(t); s.stop(t + 0.15);
  }

  thud(v) { this.crash(v * 0.4); }
}

export { STATIONS };
