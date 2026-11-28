// Weather state machine (clear / cloudy / rain / storm / fog), rain streaks,
// ground splashes, wetness accumulation and lightning with delayed thunder.
import * as THREE from 'three';
import { U, LAYER_NO_REFLECT } from '../core/globals.js';
import { RNG, clamp, damp, smoothstep } from '../core/utils.js';

export const WEATHERS = {
  clear:  { label: 'Clear',        cloud: 0.12, rain: 0,    storm: 0,   wind: 0.25, fog: 0.00075 },
  cloudy: { label: 'Cloudy',       cloud: 0.68, rain: 0,    storm: 0.1, wind: 0.45, fog: 0.0011 },
  rain:   { label: 'Rain',         cloud: 0.92, rain: 0.65, storm: 0.45, wind: 0.6, fog: 0.0021 },
  storm:  { label: 'Thunderstorm', cloud: 1.0,  rain: 1.0,  storm: 1.0, wind: 1.0,  fog: 0.003 },
  fog:    { label: 'Fog',          cloud: 0.55, rain: 0,    storm: 0.15, wind: 0.08, fog: 0.0085 },
};
const ORDER = ['clear', 'cloudy', 'rain', 'storm', 'fog'];

const rainVert = /* glsl */`
attribute float aEnd; attribute float aIdx;
uniform vec3 uCam; uniform float uTime, uRain, uBox, uLen; uniform vec3 uVel;
varying float vA;
void main() {
  vec3 seed = position * uBox;
  vec3 fall = uVel * uTime;
  vec3 base = uCam - vec3(uBox * 0.5, uBox * 0.35, uBox * 0.5);
  vec3 p = base + mod(seed + fall - base, vec3(uBox));
  p -= normalize(uVel) * uLen * aEnd;
  vA = step(aIdx, uRain) * (0.25 + 0.75 * aEnd);
  float dist = length(p - uCam);
  vA *= smoothstep(1.0, 3.0, dist) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, dist));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const rainFrag = /* glsl */`
uniform vec3 uColor; varying float vA;
void main() { gl_FragColor = vec4(uColor, vA * 0.55); }`;

const splashVert = /* glsl */`
attribute float aPhase;
uniform vec3 uCam; uniform float uTime, uRain, uBox;
varying float vA;
void main() {
  vec3 base = uCam - vec3(uBox * 0.5, 0.0, uBox * 0.5);
  vec3 seed = position * vec3(uBox, 1.0, uBox);
  float cyc = floor(uTime * 2.2 + aPhase);
  vec3 jitter = vec3(fract(sin(cyc * 12.9898 + aPhase * 78.233) * 43758.5) - 0.5, 0.0, fract(sin(cyc * 39.346 + aPhase * 11.135) * 23421.6) - 0.5) * 6.0;
  vec3 p = base + mod(seed + jitter - base, vec3(uBox, 1.0, uBox));
  p.y = position.y;
  float t = fract(uTime * 2.2 + aPhase);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dz = -mv.z;
  vA = (1.0 - t) * step(aPhase, uRain) * smoothstep(2.5, 6.0, dz);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(18.0, (0.6 + t * 2.2) * (55.0 / max(dz, 0.5)));
}`;
const splashFrag = /* glsl */`
uniform vec3 uColor; varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r = length(c);
  float ring = smoothstep(0.5, 0.35, r) * smoothstep(0.15, 0.32, r);
  gl_FragColor = vec4(uColor, ring * vA * 0.28);
}`;

export class Weather {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.rng = new RNG(99);
    this.current = 'clear';
    this.target = { ...WEATHERS.clear };
    this.cloud = 0.12; this.rain = 0; this.storm = 0; this.wind = 0.25; this.fog = 0.00075;
    this.wet = 0;
    this.auto = true;
    this.nextChange = 200;
    this.transitionRate = 0.05;
    this.flashT = 0; this.nextBolt = 8; this.bolts = [];
    this.pendingThunder = [];

    // rain streaks
    const N = 16000;
    const pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), idx = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = this.rng.next(), y = this.rng.next(), z = this.rng.next(), id = this.rng.next();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k; idx[i * 2 + k] = id;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    this.rainU = {
      uCam: { value: new THREE.Vector3() }, uTime: U.uTime, uRain: { value: 0 }, uBox: { value: 46 },
      uLen: { value: 0.75 }, uVel: { value: new THREE.Vector3(1, -13, 0.5) }, uColor: { value: new THREE.Color(0.7, 0.75, 0.82) },
    };
    this.rainMesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      vertexShader: rainVert, fragmentShader: rainFrag, uniforms: this.rainU,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.rainMesh.frustumCulled = false;
    this.rainMesh.layers.set(LAYER_NO_REFLECT);
    scene.add(this.rainMesh);

    // splashes
    const SN = 1400, sp = new Float32Array(SN * 3), sph = new Float32Array(SN);
    for (let i = 0; i < SN; i++) { sp[i * 3] = this.rng.next(); sp[i * 3 + 1] = 0.08; sp[i * 3 + 2] = this.rng.next(); sph[i] = this.rng.next(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
    this.splashU = { uCam: this.rainU.uCam, uTime: U.uTime, uRain: { value: 0 }, uBox: { value: 30 }, uColor: { value: new THREE.Color(0.8, 0.85, 0.9) } };
    this.splash = new THREE.Points(sg, new THREE.ShaderMaterial({
      vertexShader: splashVert, fragmentShader: splashFrag, uniforms: this.splashU,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.splash.frustumCulled = false;
    this.splash.layers.set(LAYER_NO_REFLECT);
    scene.add(this.splash);

    // lightning bolt mesh (rebuilt per strike)
    this.boltMat = new THREE.LineBasicMaterial({ color: new THREE.Color(8, 8, 12), transparent: true, fog: false });
    this.bolt = new THREE.LineSegments(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.bolt);
  }

  set(name, fast = true) {
    this.current = name;
    this.target = { ...WEATHERS[name] };
    this.transitionRate = fast ? 0.6 : 0.04;
    this.nextChange = this.rng.range(160, 320);
  }
  cycle() { this.set(ORDER[(ORDER.indexOf(this.current) + 1) % ORDER.length]); return WEATHERS[this.current].label; }
  label() { return WEATHERS[this.current].label; }

  strike(camPos) {
    const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(250, 1100);
    const x = camPos.x + Math.cos(a) * d, z = camPos.z + Math.sin(a) * d;
    const pts = [];
    const build = (x0, y0, z0, y1, spread, depth) => {
      let px = x0, py = y0, pz = z0;
      while (py > y1) {
        const nx = px + this.rng.range(-spread, spread), ny = py - this.rng.range(10, 28), nz = pz + this.rng.range(-spread, spread);
        pts.push(px, py, pz, nx, ny, nz);
        if (depth < 2 && this.rng.chance(0.12)) build(nx, ny, nz, ny - this.rng.range(40, 120), spread * 0.8, depth + 1);
        px = nx; py = ny; pz = nz;
      }
    };
    build(x, 420, z, 0, 14, 0);
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry();
    this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bolt.visible = true;
    this.flashT = 0.0001;
    this.boltLife = 0.35;
    const delay = d / 343;
    this.pendingThunder.push({ t: delay, dist: d });
  }

  update(dt, camPos) {
    // automatic weather
    if (this.auto) {
      this.nextChange -= dt;
      if (this.nextChange <= 0) {
        const r = this.rng.next();
        const name = r < 0.38 ? 'clear' : r < 0.62 ? 'cloudy' : r < 0.82 ? 'rain' : r < 0.94 ? 'storm' : 'fog';
        this.set(name, false);
      }
    }
    const k = this.transitionRate;
    const t = this.target;
    this.cloud = damp(this.cloud, t.cloud, k, dt);
    this.rain = damp(this.rain, t.rain, k * (t.rain > this.rain ? 0.8 : 1.4), dt);
    this.storm = damp(this.storm, t.storm, k, dt);
    this.wind = damp(this.wind, t.wind, k, dt);
    this.fog = damp(this.fog, t.fog, k, dt);
    if (this.transitionRate > 0.05) this.transitionRate = damp(this.transitionRate, 0.05, 0.1, dt);

    if (this.rain > 0.15) this.wet = Math.min(1, this.wet + dt * 0.045 * this.rain);
    else this.wet = Math.max(0, this.wet - dt * 0.007);

    U.uWet.value = this.wet;
    U.uRain.value = this.rain;
    U.uWind.value = this.wind;

    this.rainU.uCam.value.copy(camPos);
    this.rainU.uRain.value = this.rain;
    this.rainU.uVel.value.set(this.wind * 4.5, -13 - this.storm * 3, this.wind * 2.2);
    this.splashU.uRain.value = this.rain * smoothstep(0, 0.2, this.wet + this.rain * 0.2);
    this.rainMesh.visible = this.rain > 0.01;
    this.splash.visible = this.rain > 0.05;
    this.splash.position.y = 0;

    // lightning
    if (this.storm > 0.7) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.strike(camPos); this.nextBolt = this.rng.range(5, 18); }
    }
    if (this.flashT > 0) {
      this.flashT += dt;
      const f = this.flashT;
      const flash = f < 0.08 ? 1 : f < 0.14 ? 0.2 : f < 0.22 ? 0.8 : Math.max(0, 0.6 - (f - 0.22) * 2.5);
      U.uFlash.value = flash;
      this.boltMat.opacity = f < this.boltLife ? (f < 0.14 && f > 0.08 ? 0.3 : 1) : 0;
      if (f > this.boltLife) this.bolt.visible = false;
      if (f > 0.6) { this.flashT = 0; U.uFlash.value = 0; }
    }
    for (let i = this.pendingThunder.length - 1; i >= 0; i--) {
      const p = this.pendingThunder[i];
      p.t -= dt;
      if (p.t <= 0) { this.audio?.thunder(p.dist); this.pendingThunder.splice(i, 1); }
    }
  }
}
