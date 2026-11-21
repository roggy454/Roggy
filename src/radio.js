// In-car radio: every station is a live generative music engine (Web Audio synthesis),
// so songs never repeat. Stations: synthwave, lo-fi hip hop, house, jazz, and a talk station.
const NOTE = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
};

const ADJ = ['Neon', 'Midnight', 'Velvet', 'Golden', 'Electric', 'Silent', 'Crystal', 'Lonely', 'Faded', 'Burning', 'Paper', 'Chrome', 'Ocean', 'Last', 'Endless', 'Rainy', 'Hidden', 'Northern'];
const NOUN = ['Highway', 'Avenue', 'Skyline', 'Hearts', 'Static', 'Signal', 'Sunset', 'Dreams', 'Motel', 'Rooftops', 'Lights', 'Boulevard', 'Weekend', 'Summer', 'Tide', 'Coffee', 'Parade', 'Satellites'];
const ARTISTS = {
  neon: ['Vector Hearts', 'Night Driver 84', 'Laser Bloom', 'Palm Circuit', 'The Grid Kids'],
  lowtide: ['sleepy.wav', 'Mellow Tape', 'kotori', 'Dust & Rain', 'lofi caretaker'],
  pulse: ['Deep Mass', 'Kollektiv 9', 'Warehouse Saints', 'Mira Volt', 'Subroutine'],
  velvet: ['The Roggy Quartet', 'Eddie Blue Trio', 'Late Set', 'Smoke Ring Combo', 'Ella Marsh'],
};

export const STATIONS = [
  { id: 'neon', name: 'NEON 88.7', genre: 'Synthwave', color: '#ff4fa3' },
  { id: 'lowtide', name: 'LOW TIDE 94.1', genre: 'Lo-fi Hip Hop', color: '#7fd1c7' },
  { id: 'pulse', name: 'PULSE 101.5', genre: 'House & Techno', color: '#ffd23f' },
  { id: 'velvet', name: 'VELVET 97.3', genre: 'Late Night Jazz', color: '#c99cff' },
  { id: 'talk', name: 'ROGGY TALK 104.9', genre: 'News & Talk', color: '#9fb8ff' },
  { id: 'off', name: 'RADIO OFF', genre: '', color: '#aaaaaa' },
];

const TALK_LINES = [
  'Good evening Roggy City, this is Talk one oh four point nine. Traffic on the downtown grid is moving, but watch out for drivers who think red lights are a suggestion.',
  'Weather update: clear skies over the city, light winds coming off the hills. Perfect night for a drive. Please drive like your grandmother is watching.',
  'This hour is brought to you by Gary\'s Discount Tires. Gary says: if your tires squeal, that is the sound of savings.',
  'A listener called in to say the fountain in Central Park is the best place to think. Another listener called to say it is the best place to lose your keys.',
  'Reminder: the city has twelve thousand street lamps and every single one of them is working. We checked. Well, most of them.',
  'Sports news: the Roggy City Rovers lost again tonight. The coach says the team is building for the future. The future, apparently, is very far away.',
  'Traffic report: a van is parked in the left lane on the east side. Drivers are going around it. The van does not care.',
  'Our late night tip: if you see a taxi with its light on, it is available. If you see a taxi doing donuts in a parking lot, it is probably not.',
  'You are listening to Roggy Talk. Stay tuned for more news, more talk, and more opinions nobody asked for.',
  'A new noodle shop opened downtown. Reviews say the noodles are long, the line is longer, and the parking is impossible.',
];

const DJ_IDENTS = {
  neon: ['Neon eighty eight point seven. The night is long and the road is longer.', 'You are tuned to Neon. Keep your headlights on and your synths warm.'],
  lowtide: ['Low Tide ninety four one. Beats to drive slow to.', 'This is Low Tide. Take a breath, take the long way home.'],
  pulse: ['Pulse one oh one five. Non stop, all night.', 'Pulse radio. Turn it up.'],
  velvet: ['Velvet ninety seven three. Smooth jazz for smooth streets.', 'You are listening to Velvet. Good music for good company.'],
};

export class Radio {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.index = 0;
    this.on = false;
    this.voice = true;
    this.listeners = [];
    // per-station FX chain
    this.bus = ctx.createGain(); this.bus.gain.value = 1;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 18000;
    this.bus.connect(this.tone); this.tone.connect(out);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.makeIR(2.6);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain); this.revGain.connect(this.bus);
    this.delay = ctx.createDelay(2); this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.35;
    this.delayLP = ctx.createBiquadFilter(); this.delayLP.type = 'lowpass'; this.delayLP.frequency.value = 2600;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.3;
    this.delay.connect(this.delayLP); this.delayLP.connect(this.delayFb); this.delayFb.connect(this.delay);
    this.delayLP.connect(this.delayOut); this.delayOut.connect(this.bus);
    this.noiseBuf = this.makeNoise(2);
    this.crackle = null;
    this.step = 0; this.nextTime = 0; this.song = null;
    this.timer = setInterval(() => this.schedule(), 40);
  }

  makeIR(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }
  makeNoise(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  get station() { return STATIONS[this.index]; }

  setOn(on) {
    if (on === this.on) return;
    this.on = on;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(on ? 1 : 0, t, 0.25);
    if (on) { this.startStation(); } else { this.stopSpeech(); this.stopCrackle(); }
  }

  next(dir = 1) {
    this.index = (this.index + dir + STATIONS.length) % STATIONS.length;
    this.static();
    this.startStation();
    return this.station;
  }

  static() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(bp); bp.connect(g); g.connect(this.out);
    src.start(t, Math.random()); src.stop(t + 0.4);
  }

  startStation() {
    this.stopSpeech(); this.stopCrackle();
    const st = this.station;
    this.song = null;
    this.nextTime = this.ctx.currentTime + 0.15;
    this.step = 0;
    if (!this.on || st.id === 'off') { this.emit(); return; }
    this.newSong(true);
    if (st.id === 'talk') this.talkLoop();
    if (st.id === 'lowtide') this.startCrackle();
  }

  // ---------- song generation ----------
  newSong(tuneIn = false) {
    const st = this.station.id;
    const r = Math.random;
    const pick = (a) => a[Math.floor(r() * a.length)];
    const s = { st, bar: 0, beat: 0 };
    if (st === 'neon') {
      s.bpm = 92 + Math.floor(r() * 22); s.root = 45 + Math.floor(r() * 7); s.scale = SCALES.minor;
      s.prog = pick([[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0], [0, 6, 5, 6], [0, 5, 3, 4]]);
      this.tone.frequency.value = 16000; this.revGain.gain.value = 0.45; this.delayOut.gain.value = 0.32;
    } else if (st === 'lowtide') {
      s.bpm = 74 + Math.floor(r() * 14); s.root = 50 + Math.floor(r() * 7); s.scale = SCALES.major;
      s.prog = pick([[1, 4, 0, 5], [3, 2, 1, 0], [0, 5, 1, 4], [3, 4, 2, 5], [5, 3, 1, 4]]);
      this.tone.frequency.value = 3800; this.revGain.gain.value = 0.3; this.delayOut.gain.value = 0.18;
    } else if (st === 'pulse') {
      s.bpm = 121 + Math.floor(r() * 8); s.root = 43 + Math.floor(r() * 7); s.scale = pick([SCALES.minor, SCALES.dorian]);
      s.prog = pick([[0, 0, 5, 6], [0, 3, 0, 3], [0, 6, 5, 4], [0, 0, 0, 3]]);
      this.tone.frequency.value = 17000; this.revGain.gain.value = 0.28; this.delayOut.gain.value = 0.25;
    } else if (st === 'velvet') {
      s.bpm = 96 + Math.floor(r() * 30); s.root = 48 + Math.floor(r() * 7); s.scale = SCALES.major;
      s.prog = pick([[1, 4, 0, 5], [1, 4, 0, 0], [3, 4, 2, 5], [0, 5, 1, 4]]);
      this.tone.frequency.value = 9000; this.revGain.gain.value = 0.32; this.delayOut.gain.value = 0.0;
    } else { // talk bed
      s.bpm = 80; s.root = 52; s.scale = SCALES.major; s.prog = [0, 3, 5, 4];
      this.tone.frequency.value = 6000; this.revGain.gain.value = 0.5; this.delayOut.gain.value = 0;
    }
    s.spb = 60 / s.bpm; // seconds per beat
    this.delay.delayTime.value = s.spb * 0.75;
    s.length = st === 'talk' ? 9999 : 32 + 4 * Math.floor(r() * 3);
    s.bar = tuneIn ? Math.floor(r() * 12) : 0; // tuning in mid-song
    s.title = `${pick(ADJ)} ${pick(NOUN)}`;
    s.artist = st === 'talk' ? 'Roggy Talk' : pick(ARTISTS[st] || ['Unknown']);
    s.swing = st === 'lowtide' ? 0.17 : st === 'velvet' ? 0.2 : 0;
    s.melody = [];
    for (let i = 0; i < 16; i++) s.melody.push(r() < 0.6 ? Math.floor(r() * 7) : -1);
    s.arpPat = pick([[0, 1, 2, 1], [0, 1, 2, 3], [0, 2, 1, 2], [2, 1, 0, 1]]);
    s.bassPat = pick([[1, 0, 1, 1, 0, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 1, 0, 0, 1, 0]]);
    this.song = s;
    this.emit();
    if (!tuneIn && this.voice && st !== 'talk' && Math.random() < 0.5) {
      const lines = DJ_IDENTS[st];
      if (lines) this.speak(lines[Math.floor(Math.random() * lines.length)], 1.0);
    }
  }

  emit() { for (const f of this.listeners) f(this.station, this.song); }
  onChange(f) { this.listeners.push(f); }

  chordNotes(s, deg, count = 4, octave = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const d = deg + i * 2;
      const n = s.scale[d % 7] + 12 * Math.floor(d / 7);
      out.push(s.root + n + 12 * octave);
    }
    return out;
  }
  scaleNote(s, deg, octave = 0) {
    const d = ((deg % 7) + 7) % 7;
    return s.root + s.scale[d] + 12 * (octave + Math.floor(deg / 7));
  }

  schedule() {
    if (!this.on || !this.song) return;
    const ctx = this.ctx;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const s = this.song;
      const step = this.step % 16;
      let t = this.nextTime;
      if (s.swing && step % 2 === 1) t += s.spb * 0.25 * s.swing * 2;
      this.playStep(s, step, t);
      this.nextTime += s.spb / 4;
      this.step++;
      if (this.step % 16 === 0) {
        s.bar++;
        if (s.bar >= s.length) { this.newSong(); return; }
      }
    }
  }

  section(s) {
    const b = s.bar, L = s.length;
    if (b < 4) return 'intro';
    if (b >= L - 4) return 'outro';
    const m = (b - 4) % 16;
    if (m < 8) return 'verse';
    if (m < 14) return 'chorus';
    return 'break';
  }

  playStep(s, step, t) {
    const st = s.st;
    const sec = this.section(s);
    const chordDeg = s.prog[Math.floor(s.bar / (st === 'velvet' ? 1 : 1)) % s.prog.length];
    const beat = step / 4;
    if (st === 'neon') {
      const drums = sec !== 'break' && sec !== 'intro';
      if (drums && step % 4 === 0) this.kick(t, 0.9);
      if (drums && (step === 4 || step === 12)) this.snare(t, 0.7, 0.9);
      if (sec !== 'break' && step % 2 === 0) this.hat(t, 0.18, false);
      // pad on the bar
      if (step === 0) for (const n of this.chordNotes(s, chordDeg, 3, 1)) this.pad(t, n, s.spb * 4, 0.05);
      // bass eighths
      if (sec !== 'intro' && step % 2 === 0 && s.bassPat[step / 2]) this.bass(t, this.chordNotes(s, chordDeg, 1, -1)[0], s.spb * 0.45, 0.33, 'sawtooth', 700);
      // arpeggio 16ths
      if (sec === 'chorus' || sec === 'verse') {
        const cn = this.chordNotes(s, chordDeg, 4, 2);
        this.pluck(t, cn[s.arpPat[step % 4]] + (step >= 8 ? 0 : 0), s.spb * 0.22, 0.07, 'square');
      }
      if (sec === 'chorus' && step % 2 === 0) {
        const m = s.melody[(step / 2 + (s.bar % 2) * 8) % 16];
        if (m >= 0) this.lead(t, this.scaleNote(s, m + chordDeg, 2), s.spb * 0.9, 0.06);
      }
    } else if (st === 'lowtide') {
      const drums = sec !== 'intro' && sec !== 'break';
      if (drums && (step === 0 || step === 7 || step === 10)) this.kick(t, 0.7, true);
      if (drums && (step === 4 || step === 12)) this.snare(t, 0.45, 0.25, true);
      if (sec !== 'break' && step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.12 : 0.07, false, true);
      if (step === 0 || (step === 10 && Math.random() < 0.5)) {
        const notes = this.chordNotes(s, chordDeg, 4, 0);
        notes.forEach((n, i) => this.rhodes(t + i * 0.012, n + 12, s.spb * 3.2, 0.06));
      }
      if (sec !== 'intro' && (step === 0 || step === 6 || step === 11)) this.bass(t, this.chordNotes(s, chordDeg, 1, -1)[0], s.spb * 0.9, 0.38, 'sine', 400);
      if (sec === 'chorus' && step % 4 === 2 && Math.random() < 0.6) {
        this.rhodes(t, this.scaleNote(s, chordDeg + Math.floor(Math.random() * 5), 2), s.spb * 1.2, 0.04);
      }
    } else if (st === 'pulse') {
      const full = sec === 'chorus' || sec === 'verse';
      if (sec !== 'break' && step % 4 === 0) this.kick(t, 1.0);
      if (full && (step === 4 || step === 12)) this.clap(t, 0.45);
      if (sec !== 'intro' && step % 4 === 2) this.hat(t, 0.22, true);
      if (step % 2 === 1) this.hat(t, 0.07, false);
      if (sec !== 'intro') {
        const acc = step % 3 === 0;
        const bn = this.chordNotes(s, chordDeg, 1, -1)[0] + (step % 8 === 6 ? 12 : 0);
        if (s.bassPat[(step >> 1) % 8] || step % 4 === 2) this.acid(t, bn, s.spb * 0.22, acc ? 0.28 : 0.18, acc);
      }
      if (sec === 'chorus' && (step === 3 || step === 11)) for (const n of this.chordNotes(s, chordDeg, 3, 1)) this.stab(t, n, 0.06);
      if (sec === 'break' && step === 0) for (const n of this.chordNotes(s, chordDeg, 3, 1)) this.pad(t, n, s.spb * 4, 0.05);
    } else if (st === 'velvet') {
      // swing ride, brushes, walking bass, comping
      if (sec !== 'intro' || s.bar > 1) {
        if (step % 4 === 0 || step % 8 === 6) this.ride(t, step % 8 === 6 ? 0.06 : 0.09);
        if (step === 4 || step === 12) this.brush(t, 0.12);
      }
      if (step % 4 === 0 && sec !== 'intro') {
        const target = this.chordNotes(s, chordDeg, 4, -1);
        const b = beat === 0 ? target[0] : target[Math.floor(Math.random() * 3)] + (Math.random() < 0.3 ? 1 : 0);
        this.upright(t, b, s.spb * 0.95, 0.42);
      }
      if ((step === 0 && Math.random() < 0.9) || (step === 6 && Math.random() < 0.5) || (step === 10 && Math.random() < 0.3)) {
        const notes = this.chordNotes(s, chordDeg, 4, 0).slice(1);
        notes.forEach((n, i) => this.rhodes(t + i * 0.008, n + 12, s.spb * 1.4, 0.05));
      }
      if (sec === 'chorus' && step % 2 === 0 && Math.random() < 0.45) {
        this.rhodes(t, this.scaleNote(s, chordDeg + Math.floor(Math.random() * 7), 2), s.spb * 0.6, 0.05);
      }
    } else if (st === 'talk') {
      if (step === 0 && s.bar % 2 === 0) for (const n of this.chordNotes(s, chordDeg, 3, 1)) this.pad(t, n, s.spb * 8, 0.02);
    }
  }

  // ---------- instruments ----------
  env(g, t, a, d, peak, sustain = 0, rel = 0.05, dur = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (dur) {
      g.gain.setTargetAtTime(Math.max(0.0001, peak * sustain), t + a, d / 3);
      g.gain.setTargetAtTime(0.0001, t + dur, rel / 3);
    } else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  osc(type, f, t, stop) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(stop); return o; }
  kick(t, v, soft = false) {
    const ctx = this.ctx;
    const o = this.osc('sine', 150, t, t + 0.5);
    o.frequency.exponentialRampToValueAtTime(soft ? 50 : 42, t + 0.12);
    const g = ctx.createGain(); this.env(g, t, 0.002, soft ? 0.32 : 0.42, v * 0.9);
    o.connect(g); g.connect(this.bus);
  }
  noise(t, dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.start(t, Math.random() * 1.5); s.stop(t + dur); return s; }
  snare(t, v, verb = 0.3, soft = false) {
    const ctx = this.ctx;
    const n = this.noise(t, 0.3);
    const hp = ctx.createBiquadFilter(); hp.type = soft ? 'bandpass' : 'highpass'; hp.frequency.value = soft ? 1800 : 1400;
    const g = ctx.createGain(); this.env(g, t, 0.001, soft ? 0.14 : 0.2, v * 0.5);
    n.connect(hp); hp.connect(g); g.connect(this.bus);
    const rs = ctx.createGain(); rs.gain.value = verb; g.connect(rs); rs.connect(this.reverb);
    const o = this.osc('triangle', 190, t, t + 0.15);
    const g2 = ctx.createGain(); this.env(g2, t, 0.001, 0.1, v * 0.35);
    o.connect(g2); g2.connect(this.bus);
  }
  clap(t, v) {
    const ctx = this.ctx;
    for (let k = 0; k < 3; k++) {
      const tt = t + k * 0.011;
      const n = this.noise(tt, 0.2);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.2;
      const g = ctx.createGain(); this.env(g, tt, 0.001, k === 2 ? 0.16 : 0.03, v * 0.6);
      n.connect(bp); bp.connect(g); g.connect(this.bus); g.connect(this.reverb);
    }
  }
  hat(t, v, open, soft = false) {
    const ctx = this.ctx;
    const n = this.noise(t, open ? 0.35 : 0.08);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = soft ? 6000 : 8000;
    const g = ctx.createGain(); this.env(g, t, 0.001, open ? 0.25 : 0.04, v * 0.5);
    n.connect(hp); hp.connect(g); g.connect(this.bus);
  }
  ride(t, v) {
    const ctx = this.ctx;
    const g = ctx.createGain(); this.env(g, t, 0.001, 0.9, v);
    const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 5000;
    for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) { const o = this.osc('square', f * 2.1, t, t + 1); o.connect(bp); }
    bp.connect(g); g.connect(this.bus);
  }
  brush(t, v) {
    const ctx = this.ctx;
    const n = this.noise(t, 0.3);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(bp); bp.connect(g); g.connect(this.bus);
  }
  bass(t, m, dur, v, type = 'sawtooth', cut = 600) {
    const ctx = this.ctx;
    const o = this.osc(type, NOTE(m), t, t + dur + 0.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(cut * 2, t); lp.frequency.exponentialRampToValueAtTime(cut * 0.5, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.005, dur, v, 0.7, 0.06, dur);
    o.connect(lp); lp.connect(g); g.connect(this.bus);
  }
  acid(t, m, dur, v, accent) {
    const ctx = this.ctx;
    const o = this.osc('sawtooth', NOTE(m), t, t + dur + 0.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = accent ? 14 : 9;
    const peak = 400 + (Math.sin(ctx.currentTime * 0.4) * 0.5 + 0.5) * 2200;
    lp.frequency.setValueAtTime(peak * (accent ? 1.8 : 1), t); lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.003, dur, v, 0.6, 0.03, dur);
    o.connect(lp); lp.connect(g); g.connect(this.bus); g.connect(this.delay);
  }
  pad(t, m, dur, v) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.5); g.gain.setTargetAtTime(0.0001, t + dur - 0.2, 0.4);
    for (const d of [-7, 0, 7]) { const o = this.osc('sawtooth', NOTE(m), t, t + dur + 1.5); o.detune.value = d; o.connect(lp); }
    lp.connect(g); g.connect(this.bus); g.connect(this.reverb);
  }
  pluck(t, m, dur, v, type) {
    const ctx = this.ctx;
    const o = this.osc(type, NOTE(m), t, t + dur + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.003, dur + 0.1, v);
    o.connect(lp); lp.connect(g); g.connect(this.bus); g.connect(this.delay);
  }
  lead(t, m, dur, v) {
    const ctx = this.ctx;
    const o = this.osc('sawtooth', NOTE(m), t, t + dur + 0.3);
    const lfo = this.osc('sine', 5.5, t, t + dur + 0.3); const lg = ctx.createGain(); lg.gain.value = 6; lfo.connect(lg); lg.connect(o.detune);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ctx.createGain(); this.env(g, t, 0.02, dur, v, 0.8, 0.15, dur);
    o.connect(lp); lp.connect(g); g.connect(this.bus); g.connect(this.delay); g.connect(this.reverb);
  }
  rhodes(t, m, dur, v) {
    const ctx = this.ctx;
    const f = NOTE(m);
    const car = this.osc('sine', f, t, t + dur + 0.5);
    const mod = this.osc('sine', f, t, t + dur + 0.5);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.6);
    mod.connect(mg); mg.connect(car.frequency);
    const trem = this.osc('sine', 4.2, t, t + dur + 0.5); const tg = ctx.createGain(); tg.gain.value = v * 0.15;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.setTargetAtTime(v * 0.35, t + 0.01, 0.4); g.gain.setTargetAtTime(0.0001, t + dur, 0.15);
    trem.connect(tg); tg.connect(g.gain);
    car.connect(g); g.connect(this.bus); g.connect(this.reverb);
  }
  stab(t, m, v) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = ctx.createGain(); this.env(g, t, 0.002, 0.25, v);
    for (const d of [-10, 10]) { const o = this.osc('sawtooth', NOTE(m), t, t + 0.4); o.detune.value = d; o.connect(lp); }
    lp.connect(g); g.connect(this.bus); g.connect(this.reverb); g.connect(this.delay);
  }
  upright(t, m, dur, v) {
    const ctx = this.ctx;
    const o = this.osc('triangle', NOTE(m), t, t + dur + 0.2);
    const o2 = this.osc('sine', NOTE(m), t, t + dur + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.setTargetAtTime(0.0001, t + 0.05, dur / 2.5);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.bus);
  }

  startCrackle() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.8 : 0) + (Math.random() * 2 - 1) * 0.012;
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.25;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    s.connect(hp); hp.connect(g); g.connect(this.bus);
    s.start();
    this.crackle = s;
  }
  stopCrackle() { if (this.crackle) { try { this.crackle.stop(); } catch (e) { /* already stopped */ } this.crackle = null; } }

  // ---------- speech (DJ / talk) ----------
  speak(text, rate = 1) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate; u.pitch = 0.95; u.volume = this.speechVolume ?? 0.9;
      const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
      if (voices.length) u.voice = voices[Math.floor(Math.random() * Math.min(4, voices.length))];
      speechSynthesis.speak(u);
      return u;
    } catch (e) { return null; }
  }
  stopSpeech() { try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* ignore */ } clearTimeout(this.talkTimer); }
  talkLoop() {
    if (!this.on || this.station.id !== 'talk') return;
    const line = TALK_LINES[Math.floor(Math.random() * TALK_LINES.length)];
    const u = this.voice ? this.speak(line, 1.02) : null;
    const next = () => { this.talkTimer = setTimeout(() => this.talkLoop(), 2500 + Math.random() * 3000); };
    if (u) { u.onend = next; u.onerror = next; } else this.talkTimer = setTimeout(() => this.talkLoop(), 9000);
  }
}
