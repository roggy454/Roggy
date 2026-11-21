// Day/night cycle: a custom sky dome (zenith/horizon palette keyed by the hour, sun disc and
// glow, stars, moon), sun/moon lights with a player-following shadow camera, fog that always
// matches the horizon, and a reflection environment map regenerated from the current sky.
import * as THREE from 'three';
import { smoothstep, lerp } from './utils.js';
import { globalUniforms } from './materials.js';

const hex = (h) => new THREE.Color().setHex(h); // sRGB hex -> linear working colour
// [hour, zenith, horizon]
const KEYS = [
  [0, 0x02040c, 0x0b1324],
  [4.6, 0x040917, 0x131b2e],
  [5.4, 0x16223f, 0x7a5a6a],
  [6.0, 0x2a3f72, 0xe39a6c],
  [6.9, 0x3d6ab0, 0xf1c9a4],
  [8.5, 0x3d74c6, 0xbcd4ec],
  [12, 0x2e66c8, 0xbfd8f0],
  [16, 0x386dc0, 0xc8d8e8],
  [17.2, 0x3a62a8, 0xf0cca0],
  [17.9, 0x2c447e, 0xff9c5c],
  [18.5, 0x1a2550, 0xb0606a],
  [19.1, 0x0b1230, 0x3a2e48],
  [19.8, 0x040818, 0x141b30],
  [24, 0x02040c, 0x0b1324],
].map(([h, z, r]) => [h, hex(z), hex(r)]);

function paletteAt(hour, zen, hor) {
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
  const [h0, z0, r0] = KEYS[i], [h1, z1, r1] = KEYS[i + 1];
  const t = smoothstep(0, 1, (hour - h0) / (h1 - h0));
  zen.copy(z0).lerp(z1, t); hor.copy(r0).lerp(r1, t);
}

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }`;
const skyFrag = /* glsl */`
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
  uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunVis; uniform float uExposureBoost;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // warm horizon toward the sun, cooler on the opposite side
    vec2 dxz = normalize(d.xz + 1e-5), sxz = normalize(uSunDir.xz + 1e-5);
    float toward = smoothstep(-0.4, 0.95, dot(dxz, sxz));
    vec3 hor = mix(mix(uHorizon, uZenith, 0.45) * 1.05, uHorizon, toward);
    vec3 col = mix(hor, uZenith, 1.0 - exp(-max(h, 0.0) * 5.0));
    col = mix(col, hor, exp(-max(h, 0.0) * 22.0) * 0.4); // haze band
    if (h < 0.0) col = mix(hor, uGround, clamp(-h * 5.0, 0.0, 1.0));
    float sd = max(dot(d, uSunDir), 0.0);
    float lowSun = 1.0 - clamp(uSunDir.y * 3.0, 0.0, 1.0);
    col += uSunCol * (pow(sd, 5.0) * (0.12 + 0.35 * lowSun) + pow(sd, 48.0) * 0.6) * uSunVis;
    col += uSunCol * smoothstep(0.99965, 0.99985, sd) * 25.0 * uSunVis * step(-0.02, h);
    gl_FragColor = vec4(col * uExposureBoost, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSunVis: { value: 1 },
      uExposureBoost: { value: 1 },
    },
    vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}

export class SkySystem {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.time = 16.6; // hours
    this.timeScale = 1 / 50; // game hours per real second (1 game hour = 50 s, full day = 20 min)
    this.fast = false;
    this.zen = new THREE.Color(); this.hor = new THREE.Color();

    this.skyMat = makeSkyMaterial();
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.skyMat);
    this.sky.scale.setScalar(1000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // stars
    const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2, y = Math.random() * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 4200; pos[i * 3 + 1] = y * 4200; pos[i * 3 + 2] = Math.sin(th) * r * 4200;
      const b = 0.4 + Math.random() * 0.6, t = Math.random();
      col[i * 3] = b * (t < 0.2 ? 0.8 : 1); col[i * 3 + 1] = b * 0.95; col[i * 3 + 2] = b * (t > 0.8 ? 0.8 : 1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.moon = new THREE.Mesh(new THREE.CircleGeometry(70, 32), new THREE.MeshBasicMaterial({ map: makeMoonTexture(), color: 0xdfe6ff, transparent: true, depthWrite: false, fog: false }));
    this.moon.renderOrder = -8;
    scene.add(this.moon);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows;
    const sh = this.sun.shadow;
    sh.mapSize.set(quality.shadowSize, quality.shadowSize);
    const R = quality.shadowSize >= 4096 ? 95 : 75;
    sh.camera.left = -R; sh.camera.right = R; sh.camera.top = R; sh.camera.bottom = -R;
    sh.camera.near = 1; sh.camera.far = 900;
    sh.bias = -0.00025; sh.normalBias = 0.035;
    this.shadowR = R;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5048, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xa8c0d8, 0.0011);

    // environment map rendered from a copy of the sky + a dim city ring
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSkyMat = makeSkyMaterial();
    const envSky = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), this.envSkyMat);
    this.envScene.add(envSky);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0x3a3a3a }));
    this.envGround.rotation.x = -Math.PI / 2; this.envGround.position.y = -3;
    this.envScene.add(this.envGround);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4a5058, vertexColors: true });
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2, h = 4 + Math.random() * 14, w = 6 + Math.random() * 6;
      const g = new THREE.BoxGeometry(w, h, 3);
      const cl = new Float32Array(g.attributes.position.count * 3).fill(0.4 + Math.random() * 0.4);
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      const b = new THREE.Mesh(g, ringMat);
      b.position.set(Math.cos(a) * 45, h / 2 - 3, Math.sin(a) * 45);
      b.lookAt(0, b.position.y, 0);
      this.envScene.add(b);
    }
    this.envRingMat = ringMat;
    this.envRT = null;
    this.lastEnvTime = -999;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.night = 0;
    this.update(0, new THREE.Vector3(), null, true);
  }

  sunDirection(hour, out) {
    const a = ((hour - 6) / 24) * Math.PI * 2;
    out.set(Math.cos(a), Math.sin(a) * 0.92, 0.38).normalize();
    return out;
  }

  applySkyUniforms(mat, sunVis, sunCol) {
    const u = mat.uniforms;
    u.uZenith.value.copy(this.zen); u.uHorizon.value.copy(this.hor);
    u.uGround.value.copy(this.hor).multiplyScalar(0.35);
    u.uSunDir.value.copy(this.sunDir); u.uSunVis.value = sunVis; u.uSunCol.value.copy(sunCol);
  }

  update(dt, focus, camera, force = false) {
    this.time = (this.time + dt * this.timeScale * (this.fast ? 40 : 1)) % 24;
    const d = this.sunDirection(this.time, this.sunDir);
    const elev = d.y;
    const day = smoothstep(-0.06, 0.14, elev);
    const golden = 1 - smoothstep(0.04, 0.38, elev);
    this.night = 1 - smoothstep(-0.12, 0.04, elev);
    globalUniforms.uNight.value = this.night;
    const h = this.time;
    globalUniforms.uLitFrac.value = h > 1 && h < 5 ? 0.16 : 0.38;

    paletteAt(this.time, this.zen, this.hor);
    const sunVis = smoothstep(-0.08, 0.03, elev);
    const sunCol = this.sunCol || (this.sunCol = new THREE.Color());
    sunCol.setRGB(1.0, 0.9, 0.75).lerp(new THREE.Color(1.3, 0.45, 0.15), golden * golden);
    this.applySkyUniforms(this.skyMat, sunVis, sunCol);

    // sun / moon light
    const moonDir = this.moonDir.copy(d).multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.25; moonDir.normalize();
    if (day > 0.02) {
      this.sun.color.setRGB(1, 0.95, 0.88).lerp(new THREE.Color(1, 0.55, 0.28), golden * golden);
      this.sun.intensity = 3.1 * day;
      this.lightDir = d;
    } else {
      this.sun.color.set(0x8fa6d8);
      this.sun.intensity = 0.7;
      this.lightDir = moonDir;
    }
    this.hemi.color.copy(this.zen).lerp(this.hor, 0.4).multiplyScalar(1.7).lerp(new THREE.Color(0.13, 0.16, 0.26), this.night);
    this.hemi.groundColor.copy(this.hor).multiplyScalar(0.35).lerp(new THREE.Color(0.05, 0.04, 0.035), this.night);
    this.hemi.intensity = 1.0;

    // fog matches the horizon exactly so the far hills melt into the sky
    this.scene.fog.color.copy(this.hor).lerp(this.zen, 0.22);
    this.scene.fog.density = lerp(0.0008, 0.00115, this.night);

    this.stars.material.opacity = this.night;
    this.stars.visible = this.night > 0.01;
    this.renderer.toneMappingExposure = lerp(0.68, 1.25, this.night);

    if (focus) {
      const R = this.shadowR, ld = this.lightDir;
      const texel = (2 * R) / this.sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx + ld.x * 400, focus.y + ld.y * 400, fz + ld.z * 400);
      this.sun.target.updateMatrixWorld();
    }
    if (camera) {
      this.sky.position.copy(camera.position);
      this.stars.position.copy(camera.position);
      this.moon.position.copy(camera.position).addScaledVector(moonDir, 3800);
      this.moon.lookAt(camera.position);
      this.moon.visible = this.night > 0.05;
      this.moon.material.opacity = this.night;
    }
    if (force || Math.abs(this.time - this.lastEnvTime) > 0.2) this.updateEnv(sunVis, sunCol);
  }

  updateEnv(sunVis, sunCol) {
    this.lastEnvTime = this.time;
    this.applySkyUniforms(this.envSkyMat, sunVis, sunCol);
    // night reflections need a little city glow or cars render pitch black
    this.envSkyMat.uniforms.uExposureBoost.value = lerp(1, 2.2, this.night);
    this.envGround.material.color.copy(this.hor).multiplyScalar(0.25).lerp(new THREE.Color(0.03, 0.025, 0.02), this.night * 0.5);
    this.envRingMat.color.setRGB(0.35, 0.37, 0.4).lerp(new THREE.Color(0.16, 0.12, 0.08), this.night);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 400);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(1.0, 0.7, this.night);
    if (old) old.dispose();
  }

  clockString() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function makeMoonTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 90, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-atop';
  for (let k = 0; k < 40; k++) {
    const x = 40 + Math.random() * 176, y = 40 + Math.random() * 176, r = 5 + Math.random() * 22;
    ctx.fillStyle = `rgba(150,155,170,${0.15 + Math.random() * 0.25})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
