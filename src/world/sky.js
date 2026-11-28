// Sky dome with physically-motivated gradients, sun/moon, procedural clouds and
// stars; drives sun/moon/hemisphere lights, fog and the PBR environment map.
import * as THREE from 'three';
import { U, STATE, LAYER_NO_REFLECT } from '../core/globals.js';
import { clamp, smoothstep, lerp, RNG } from '../core/utils.js';

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZenith, uHorizon, uSunColor, uCloudLit, uCloudDark, uCityGlow;
uniform float uTime, uCloud, uStorm, uDay, uFlash, uSunVis;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float t = pow(1.0 - h, 3.0);
  vec3 col = mix(uZenith, uHorizon, t);
  col += uCityGlow * pow(1.0 - h, 8.0);
  if (d.y < 0.0) col = mix(uHorizon + uCityGlow, uHorizon * 0.35, clamp(-d.y * 3.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 90.0) * 0.8) * uSunVis;
  col += uSunColor * pow(sd, 2.5) * pow(1.0 - h, 5.0) * 0.55 * uSunVis;
  float disc = smoothstep(0.99955, 0.99975, sd);
  float cloudCover = 0.0;
  if (d.y > -0.02) {
    vec2 uv = d.xz / (max(d.y, 0.0) + 0.1) * 0.55;
    uv += uTime * vec2(0.006, 0.0025) * (1.0 + uStorm * 2.5);
    float n = fbm(uv * 1.3);
    float n2 = fbm(uv * 3.1 + n * 1.5 - uTime * 0.004);
    float cov = mix(0.18, 1.05, uCloud);
    float v = n * 0.72 + n2 * 0.38;
    float dens = smoothstep(1.0 - cov, 1.0 - cov + 0.32, v);
    float edge = smoothstep(1.0 - cov, 1.0 - cov + 0.08, v) - dens;
    float lit = clamp(0.55 + 0.45 * pow(sd, 3.0) - dens * 0.3, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc += uSunColor * edge * pow(sd, 4.0) * 1.5 * uSunVis; // silver lining
    cc += uCityGlow * 1.6 * (1.0 - uDay);                   // city light on cloud bases
    float fade = smoothstep(-0.02, 0.15, d.y);
    cloudCover = dens * fade;
    col = mix(col, cc, cloudCover * 0.96);
  }
  col += uSunColor * disc * 60.0 * (1.0 - cloudCover) * uSunVis;
  col = mix(col, uCloudDark * 0.9, uStorm * 0.35);
  col += vec3(0.55, 0.6, 0.8) * uFlash * (0.4 + cloudCover);
  gl_FragColor = vec4(col, 1.0);
}`;

const starVert = /* glsl */`
attribute float aSize; attribute float aPhase;
uniform float uTime;
varying float vTw;
void main() {
  vTw = 0.65 + 0.35 * sin(uTime * (1.5 + aPhase * 3.0) + aPhase * 30.0);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize;
}`;
const starFrag = /* glsl */`
uniform float uVis;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * 2.0 * vTw, a * uVis);
}`;

function v3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }
function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

export class Sky {
  constructor(scene, renderer, textures) {
    this.scene = scene;
    this.renderer = renderer;
    this.uniforms = {
      uSunDir: U.uSunDir,
      uZenith: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Vector3() }, uCloudLit: { value: new THREE.Vector3() },
      uCloudDark: { value: new THREE.Vector3() }, uCityGlow: { value: new THREE.Vector3() },
      uTime: U.uTime, uCloud: { value: 0.2 }, uStorm: { value: 0 }, uDay: { value: 1 }, uFlash: U.uFlash,
      uSunVis: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars
    const rng = new RNG(5);
    const N = 2600, pos = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = rng.next() * 2 - 1, th = rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * 900; pos[i * 3 + 1] = Math.abs(u) * 900; pos[i * 3 + 2] = r * Math.sin(th) * 900;
      size[i] = rng.next() < 0.03 ? rng.range(2.5, 3.5) : rng.range(1.0, 2.0);
      ph[i] = rng.next();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: starVert, fragmentShader: starFrag, uniforms: { uTime: U.uTime, uVis: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // moon
    this.moonMat = new THREE.MeshBasicMaterial({ map: textures.moon, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(2.2, 2.2, 2.3) });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), this.moonMat);
    this.moon.renderOrder = -8;
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = false;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.layers.enable(1); // objects kept out of reflections still cast shadows
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 1.0);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0x9fb4c8, 0.0009);

    // environment map: rendered from a mini scene with a copy of the sky dome
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    this.envScene.add(envDome);
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -8;
    this.envScene.add(ground);
    // a few bright "city" boxes in env so night reflections are not pitch black
    this.envCity = new THREE.Group();
    const rngc = new RNG(9);
    this.cityMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.4) });
    for (let i = 0; i < 40; i++) {
      const a = rngc.range(0, Math.PI * 2), r = rngc.range(55, 80);
      const b = new THREE.Mesh(new THREE.BoxGeometry(rngc.range(2, 6), rngc.range(1, 8), 1), this.cityMat);
      b.position.set(Math.cos(a) * r, rngc.range(-6, 4), Math.sin(a) * r);
      b.lookAt(0, b.position.y, 0);
      this.envCity.add(b);
    }
    this.envScene.add(this.envCity);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvKey = -999;
    this.lastEnvTime = -999;
    this.sunVec = new THREE.Vector3();
    this.moonVec = new THREE.Vector3();
    this.fogColor = new THREE.Color();
    this.info = { sunElev: 1, night: 0, dayK: 1 };
  }

  update(dt, camera, weather, focus, realTime) {
    const hour = STATE.hour;
    const a = ((hour - 6) / 12) * Math.PI;
    const lat = 0.45;
    const sun = this.sunVec.set(Math.cos(a), Math.sin(a) * Math.cos(lat), Math.sin(a) * Math.sin(lat)).normalize();
    U.uSunDir.value.copy(sun);
    const moon = this.moonVec.set(-sun.x * 0.9, -sun.y * 0.85 + 0.25, -sun.z * 0.9 - 0.2).normalize();
    const e = sun.y;

    const dayK = smoothstep(-0.06, 0.28, e);
    const sunset = Math.exp(-Math.pow((e - 0.04) / 0.13, 2));
    const night = 1 - smoothstep(-0.14, 0.04, e);
    const cloud = weather.cloud, storm = weather.storm;
    const overcast = clamp(cloud * 0.7 + storm * 0.5, 0, 1);

    let zen = mix3([0.0025, 0.004, 0.011], [0.08, 0.22, 0.6], dayK);
    zen = mix3(zen, [0.1, 0.12, 0.3], sunset * 0.6);
    let hor = mix3([0.018, 0.02, 0.03], [0.5, 0.64, 0.82], dayK);
    hor = mix3(hor, [1.0, 0.42, 0.16], sunset * 0.85);
    const grayDay = [0.32, 0.34, 0.37], grayNight = [0.015, 0.016, 0.02];
    const gray = mix3(grayNight, grayDay, dayK);
    const stormGray = mix3([0.006, 0.007, 0.009], [0.12, 0.13, 0.14], dayK);
    zen = mix3(zen, gray, overcast * 0.85); hor = mix3(hor, gray, overcast * 0.8);
    zen = mix3(zen, stormGray, storm * 0.8); hor = mix3(hor, stormGray, storm * 0.7);
    let sunCol = mix3([1.0, 0.45, 0.18], [1.0, 0.93, 0.84], smoothstep(0.02, 0.35, e));
    const cityGlow = [0.035 * night, 0.022 * night, 0.012 * night].map((v) => v * (1 + overcast * 1.5));

    const u = this.uniforms;
    u.uZenith.value.copy(v3(zen)); u.uHorizon.value.copy(v3(hor)); u.uSunColor.value.copy(v3(sunCol));
    u.uCityGlow.value.copy(v3(cityGlow));
    const cl = mix3([0.03, 0.032, 0.04], [0.95, 0.95, 0.97], dayK);
    const clSun = mix3(cl, [1.0, 0.6, 0.4], sunset * 0.6);
    const lit = mix3(clSun, mix3([0.025, 0.027, 0.03], [0.42, 0.44, 0.47], dayK), storm * 0.8 + overcast * 0.2);
    u.uCloudLit.value.copy(v3(lit));
    u.uCloudDark.value.copy(v3(lit.map((x) => x * (0.5 - storm * 0.15))));
    u.uCloud.value = cloud; u.uStorm.value = storm; u.uDay.value = dayK;
    u.uSunVis.value = smoothstep(-0.03, 0.02, e) * (1 - overcast * 0.85);

    this.starMat.uniforms.uVis.value = night * (1 - smoothstep(0.3, 0.8, cloud)) * 0.9;

    // follow camera
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    const moonVis = smoothstep(-0.1, 0.05, moon.y) * (1 - overcast * 0.9) * (0.3 + night * 0.7);
    this.moon.position.copy(camera.position).addScaledVector(moon, 850);
    this.moon.lookAt(camera.position);
    this.moonMat.opacity = moonVis;
    this.moon.visible = moonVis > 0.01;

    // lights: sun by day, moon by night (single shadow caster)
    const sunI = 3.4 * smoothstep(-0.02, 0.14, e) * (1 - overcast * 0.78);
    const moonI = 0.32 * smoothstep(-0.05, 0.15, moon.y) * (1 - overcast * 0.75);
    const useSun = e > -0.04;
    const dir = useSun ? sun : moon;
    this.sun.intensity = (useSun ? sunI : moonI) + U.uFlash.value * 4;
    this.sun.color.setRGB(useSun ? sunCol[0] : 0.62, useSun ? sunCol[1] * 0.97 : 0.72, useSun ? sunCol[2] * 0.92 : 1.0);
    this.sun.position.copy(focus).addScaledVector(dir, 300);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    if (this.sun.castShadow) {
      // snap shadow camera to texels to avoid shimmering
      const cam = this.sun.shadow.camera;
      const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
      this.sun.target.position.x = Math.round(focus.x / texel) * texel;
      this.sun.target.position.z = Math.round(focus.z / texel) * texel;
      this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 300);
      this.sun.target.updateMatrixWorld();
    }
    const hemiI = lerp(0.06, 1.15, dayK) * (1 - storm * 0.45) + night * 0.05;
    this.hemi.intensity = hemiI + U.uFlash.value * 2.5;
    this.hemi.color.setRGB(lerp(zen[0] * 4 + 0.05, 0.75, dayK), lerp(zen[1] * 4 + 0.06, 0.85, dayK), lerp(zen[2] * 4 + 0.09, 1.0, dayK));
    this.hemi.groundColor.setRGB(lerp(0.12, 0.35, dayK), lerp(0.08, 0.3, dayK), lerp(0.05, 0.24, dayK));

    // fog
    const fc = mix3(hor, gray, 0.35 + overcast * 0.4);
    this.fogColor.setRGB(fc[0] + cityGlow[0], fc[1] + cityGlow[1], fc[2] + cityGlow[2]);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = weather.fog * (1 - night * 0.25);

    this.scene.environmentIntensity = lerp(0.22, 1.0, dayK) * (1 - storm * 0.4);
    this.cityMat.color.setRGB(0.9 * night + 0.28 * dayK, 0.6 * night + 0.3 * dayK, 0.35 * night + 0.33 * dayK);
    this.groundMat.color.setRGB(lerp(0.01, 0.3, dayK), lerp(0.01, 0.3, dayK), lerp(0.012, 0.29, dayK));

    U.uNight.value = night;
    this.info.sunElev = e; this.info.night = night; this.info.dayK = dayK; this.info.sunset = sunset;

    // environment refresh when lighting changed noticeably
    const key = e * 20 + cloud * 7 + storm * 5;
    if ((Math.abs(key - this.lastEnvKey) > 0.15 && realTime - this.lastEnvTime > 1.0) || this.envRT === null) {
      this.lastEnvKey = key; this.lastEnvTime = realTime;
      const flash = U.uFlash.value; U.uFlash.value = 0;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 500);
      this.scene.environment = this.envRT.texture;
      if (old) old.dispose();
      U.uFlash.value = flash;
    }
  }

  setShadows(size) {
    const s = this.sun;
    if (!size) { s.castShadow = false; return; }
    s.castShadow = true;
    s.shadow.mapSize.set(size, size);
    const ext = size >= 4096 ? 140 : size >= 2048 ? 110 : 80;
    const cam = s.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.near = 50; cam.far = 700;
    cam.updateProjectionMatrix();
    if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
  }
}
