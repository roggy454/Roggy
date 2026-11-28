// Interactive grass: instanced blade clumps in parks/lawns that sway in the wind
// and get flattened & pushed aside by tyres and feet. A top-down "trample" render
// target around the player stores pressure + push direction and slowly recovers.
import * as THREE from 'three';
import { U, STATE, LAYER_NO_REFLECT } from '../core/globals.js';
import { RNG } from '../core/utils.js';
import { grassRects, CURB_H } from './map.js';

const TRAMPLE_RES = 512;
const TRAMPLE_SIZE = 128; // metres covered

function bladeClumpGeometry() {
  // 4 blades per clump, each 4 segments, normalised height 1
  const pos = [], uv = [], idx = [], col = [], nrm = [];
  const rng = new RNG(31);
  for (let b = 0; b < 4; b++) {
    const a = rng.range(0, Math.PI * 2);
    const ox = rng.range(-0.09, 0.09), oz = rng.range(-0.09, 0.09);
    const h = rng.range(0.7, 1.0), w = rng.range(0.025, 0.04);
    const lean = rng.range(0.05, 0.25);
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = pos.length / 3;
    const segs = 4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ww = w * (1 - t * 0.85);
      const bend = lean * t * t;
      const cx = ox + dx * bend, cz = oz + dz * bend, y = h * t;
      pos.push(cx - dz * ww, y, cz + dx * ww, cx + dz * ww, y, cz - dx * ww);
      uv.push(0, t, 1, t);
      const shade = 0.35 + 0.65 * t;
      col.push(shade, shade, shade, shade, shade, shade);
      nrm.push(dx * 0.3, 1, dz * 0.3, dx * 0.3, 1, dz * 0.3);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    // trample targets (ping-pong for recentering)
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(TRAMPLE_RES, TRAMPLE_RES, opts);
    this.rtB = new THREE.WebGLRenderTarget(TRAMPLE_RES, TRAMPLE_RES, opts);
    this.origin = new THREE.Vector2(0, 0);
    U.uTrampleSize.value = TRAMPLE_SIZE;
    this.orthoCam = new THREE.OrthographicCamera(-TRAMPLE_SIZE / 2, TRAMPLE_SIZE / 2, TRAMPLE_SIZE / 2, -TRAMPLE_SIZE / 2, -10, 10);
    this.orthoCam.up.set(0, 0, -1);
    this.orthoCam.lookAt(0, -1, 0); // looking down: x right, -z up on target
    this.stampScene = new THREE.Scene();
    this.stampMat = new THREE.ShaderMaterial({
      uniforms: { uDir: { value: new THREE.Vector2() }, uStrength: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec2 uDir; uniform float uStrength;
        void main(){
          vec2 c = vUv - 0.5; float r = length(c) * 2.0;
          float a = smoothstep(1.0, 0.35, r) * uStrength;
          vec2 radial = c / (length(c) + 1e-4);
          vec2 d = normalize(radial * 0.7 + uDir * 0.6 + 1e-4);
          gl_FragColor = vec4(1.0, d.x * 0.5 + 0.5, d.y * 0.5 + 0.5, a);
        }`,
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.stampPool = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.stampMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.stampScene.add(m);
      this.stampPool.push(m);
    }
    // fade (recovery) quad
    this.fadeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0.5, 0.5), transparent: true, opacity: 0.01, depthTest: false });
    this.fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(TRAMPLE_SIZE * 1.1, TRAMPLE_SIZE * 1.1), this.fadeMat);
    this.fadeQuad.rotation.x = -Math.PI / 2;
    this.fadeQuad.renderOrder = -1;
    this.stampScene.add(this.fadeQuad);
    // copy quad for recentering
    this.copyScene = new THREE.Scene();
    this.copyMat = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
    this.copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(TRAMPLE_SIZE, TRAMPLE_SIZE), this.copyMat);
    this.copyQuad.rotation.x = -Math.PI / 2;
    this.copyScene.add(this.copyQuad);
    this.cleared = false;

    this.material = this.makeMaterial();
    this.chunks = [];
    this.geo = bladeClumpGeometry();
    this.generate(STATE.q.grass);
    this.stamps = [];
  }

  makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, color: 0xffffff });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uTime: U.uTime, uWind: U.uWind, uTrample: U.uTrample, uTO: U.uTrampleOrigin, uTS: U.uTrampleSize,
        uCam: { value: new THREE.Vector3() }, uRange: { value: 90 },
      });
      this.shaderUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uWind, uTS, uRange; uniform vec2 uTO; uniform sampler2D uTrample; uniform vec3 uCam;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float t = clamp(position.y, 0.0, 1.0);
          // distance fade: shrink far clumps
          float dist = length(ip.xz - uCam.xz);
          float fade = 1.0 - smoothstep(uRange * 0.7, uRange, dist);
          transformed *= fade;
          // trample sample
          vec2 tuv = (ip.xz - uTO) / uTS + 0.5;
          tuv.y = 1.0 - tuv.y;
          vec4 tr = vec4(0.0, 0.5, 0.5, 0.0);
          if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) tr = texture2D(uTrample, tuv);
          float press = clamp(tr.r, 0.0, 1.0);
          vec2 pdir = tr.gb * 2.0 - 1.0;
          // wind
          float ph = uTime * (1.6 + uWind) + ip.x * 0.35 + ip.z * 0.27;
          float w = (sin(ph) * 0.5 + 0.5) * (0.25 + uWind * 0.9) + sin(ph * 2.7 + ip.x) * 0.08;
          vec2 wdir = normalize(vec2(1.0, 0.45));
          // convert world directions into instance-local space
          mat3 im = mat3(instanceMatrix);
          vec3 lw = normalize(transpose(im) * vec3(wdir.x, 0.0, wdir.y));
          vec3 lp = transpose(im) * vec3(pdir.x, 0.0, -pdir.y);
          lp = length(lp) > 1e-3 ? normalize(lp) : lw;
          float bendW = w * 0.55 * (1.0 - press);
          float bendP = press * 1.45;
          vec3 bd = normalize(lw * bendW + lp * bendP + vec3(1e-4, 0.0, 0.0));
          float ang = (bendW + bendP) * t;
          float hgt = transformed.y;
          transformed.y = hgt * cos(ang) * (1.0 - press * 0.35);
          transformed.xz += bd.xz * hgt * sin(ang);
        }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vec3(0.36, 0.55, 0.2);`);
    };
    return m;
  }

  generate(density) {
    for (const c of this.chunks) { this.scene.remove(c); c.dispose(); }
    this.chunks = [];
    const rng = new RNG(77);
    const CH = 16; // chunk size
    const perM2 = 5.5 * density;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const r of grassRects) {
      for (let x = r.x0; x < r.x1; x += CH) for (let z = r.z0; z < r.z1; z += CH) {
        const x1 = Math.min(r.x1, x + CH), z1 = Math.min(r.z1, z + CH);
        const area = (x1 - x) * (z1 - z);
        const n = Math.floor(area * perM2);
        if (n < 4) continue;
        const im = new THREE.InstancedMesh(this.geo, this.material, n);
        for (let i = 0; i < n; i++) {
          p.set(rng.range(x, x1), CURB_H + 0.01, rng.range(z, z1));
          q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
          const sc = rng.range(0.22, 0.42);
          s.set(sc * rng.range(0.9, 1.3), sc, sc * rng.range(0.9, 1.3));
          m4.compose(p, q, s);
          im.setMatrixAt(i, m4);
          col.setHSL(rng.range(0.2, 0.29), rng.range(0.35, 0.6), rng.range(0.32, 0.5));
          im.setColorAt(i, col);
        }
        im.receiveShadow = true;
        im.castShadow = false;
        im.computeBoundingSphere();
        im.boundingSphere.radius += 1;
        im.userData.center = new THREE.Vector2((x + x1) / 2, (z + z1) / 2);
        im.layers.set(LAYER_NO_REFLECT);
        this.scene.add(im);
        this.chunks.push(im);
      }
    }
  }

  // queue a stamp (world x,z, radius, travel dir)
  stamp(x, z, r, dx, dz, strength = 1) {
    if (this.stamps.length < this.stampPool.length) this.stamps.push({ x, z, r, dx, dz, strength });
  }

  update(dt, focus, camPos) {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    // initial clear
    if (!this.cleared) {
      r.setClearColor(new THREE.Color(0, 0.5, 0.5), 0);
      for (const rt of [this.rtA, this.rtB]) { r.setRenderTarget(rt); r.clear(true, false, false); }
      this.cleared = true;
      this.origin.set(focus.x, focus.z);
    }
    // recentre when focus drifts
    if (Math.abs(focus.x - this.origin.x) > TRAMPLE_SIZE * 0.25 || Math.abs(focus.z - this.origin.y) > TRAMPLE_SIZE * 0.25) {
      const nx = Math.round(focus.x), nz = Math.round(focus.z);
      r.setClearColor(new THREE.Color(0, 0.5, 0.5), 0);
      r.setRenderTarget(this.rtB); r.clear(true, false, false);
      this.copyMat.map = this.rtA.texture;
      this.copyQuad.position.set(this.origin.x, 0, this.origin.y);
      this.orthoCam.position.set(nx, 5, nz);
      this.orthoCam.updateMatrixWorld();
      r.render(this.copyScene, this.orthoCam);
      [this.rtA, this.rtB] = [this.rtB, this.rtA];
      this.origin.set(nx, nz);
    }
    this.orthoCam.position.set(this.origin.x, 5, this.origin.y);
    this.orthoCam.updateMatrixWorld();
    // stamps + recovery
    this.fadeQuad.position.set(this.origin.x, -1, this.origin.y);
    this.fadeMat.opacity = Math.min(1, dt * 0.12);
    this.stampPool.forEach((m, i) => {
      const s = this.stamps[i];
      if (!s) { m.visible = false; return; }
      m.visible = true;
      m.position.set(s.x, 0, s.z);
      m.scale.set(s.r * 2, s.r * 2, 1);
      const l = Math.hypot(s.dx, s.dz) || 1;
      m.material.uniforms.uDir.value.set(s.dx / l, -s.dz / l);
      m.material.uniforms.uStrength.value = s.strength;
    });
    r.setRenderTarget(this.rtA);
    r.autoClear = false;
    r.render(this.stampScene, this.orthoCam);
    r.autoClear = true;
    this.stamps.length = 0;
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);

    U.uTrample.value = this.rtA.texture;
    U.uTrampleOrigin.value.copy(this.origin);
    if (this.shaderUniforms) {
      this.shaderUniforms.uCam.value.copy(camPos);
      this.shaderUniforms.uRange.value = STATE.q.grassRange;
    }
    // distance culling of chunks
    const range = STATE.q.grassRange + 12;
    for (const c of this.chunks) {
      const d = Math.hypot(c.userData.center.x - camPos.x, c.userData.center.y - camPos.z);
      c.visible = d < range;
    }
  }
}
