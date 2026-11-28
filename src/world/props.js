// Street furniture & beach props. Hundreds of instanced objects; those near the
// player get live cannon-es bodies so cars can knock them over, snap lamp posts,
// scatter cones and bins. Night lighting: pooled real lights + fake light pools.
import * as THREE from 'three';
import { CANNON } from '../core/physics.js';
import { U, STATE, LAYER_NO_REFLECT } from '../core/globals.js';
import { GeoBuilder } from '../core/geo.js';
import { RNG, lerp, smoothstep } from '../core/utils.js';
import { edges, nodes, signalState, HALF_ROAD, CURB_H, slabs, SIDEWALK_W, BEACH, groundHeight } from './map.js';

// ------------------------------------------------------------ prop models (merged, vertex-coloured)
function M() { return new THREE.Matrix4(); }
function cyl(r0, r1, h, seg = 10) { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(0, h / 2, 0); return g; }
function boxG(w, h, d) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; }

function model(build) {
  const b = new GeoBuilder({ color: true });
  build(b);
  return b.build();
}

const MODELS = {
  lamp: () => model((b) => {
    b.addGeometry(cyl(0.16, 0.1, 0.6, 10), M(), [0.18, 0.19, 0.2]);
    b.addGeometry(cyl(0.09, 0.065, 8.6, 10), M(), [0.3, 0.31, 0.33]);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6); arm.rotateZ(Math.PI / 2 - 0.12); arm.translate(-1.15, 8.75, 0);
    b.addGeometry(arm, M(), [0.3, 0.31, 0.33]);
    const head = new THREE.BoxGeometry(0.85, 0.16, 0.36); head.translate(-2.3, 8.92, 0);
    b.addGeometry(head, M(), [0.22, 0.23, 0.25]);
  }),
  lampLens: () => { const g = new THREE.BoxGeometry(0.7, 0.04, 0.26); g.translate(-2.3, 8.83, 0); return g; },
  signal: () => model((b) => {
    b.addGeometry(cyl(0.14, 0.12, 6.2, 10), M(), [0.85, 0.75, 0.25]);
    const arm = new THREE.CylinderGeometry(0.08, 0.08, 6.0, 6); arm.rotateZ(Math.PI / 2); arm.translate(-3.0, 6.0, 0);
    b.addGeometry(arm, M(), [0.85, 0.75, 0.25]);
    for (const x of [-2.2, -4.9]) {
      const h = new THREE.BoxGeometry(0.38, 1.1, 0.32); h.translate(x, 5.4, 0);
      b.addGeometry(h, M(), [0.12, 0.12, 0.12]);
      for (let k = 0; k < 3; k++) { const v = new THREE.BoxGeometry(0.36, 0.06, 0.12); v.translate(x, 5.73 - k * 0.33, 0.2); b.addGeometry(v, M(), [0.08, 0.08, 0.08]); }
    }
    const sign = new THREE.BoxGeometry(1.6, 0.35, 0.03); sign.translate(-1.0, 6.35, 0); b.addGeometry(sign, M(), [0.1, 0.42, 0.18]);
    // pedestrian signal
    const ped = new THREE.BoxGeometry(0.3, 0.32, 0.22); ped.translate(0, 2.6, 0.18); b.addGeometry(ped, M(), [0.15, 0.15, 0.15]);
    const btn = new THREE.BoxGeometry(0.1, 0.16, 0.08); btn.translate(0, 1.1, 0.15); b.addGeometry(btn, M(), [0.85, 0.75, 0.25]);
  }),
  hydrant: () => model((b) => {
    b.addGeometry(cyl(0.16, 0.14, 0.62, 10), M(), [0.8, 0.12, 0.08]);
    const cap = new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, 0.62, 0); b.addGeometry(cap, M(), [0.8, 0.12, 0.08]);
    const noz = new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8); noz.rotateZ(Math.PI / 2); noz.translate(0, 0.42, 0); b.addGeometry(noz, M(), [0.75, 0.7, 0.6]);
    b.addGeometry(cyl(0.2, 0.2, 0.06, 10), M(), [0.6, 0.1, 0.06]);
  }),
  bin: () => model((b) => {
    b.addGeometry(cyl(0.27, 0.3, 0.95, 14), M(), [0.12, 0.28, 0.18]);
    const lid = cyl(0.32, 0.3, 0.08, 14); lid.translate(0, 0.95, 0); b.addGeometry(lid, M(), [0.08, 0.09, 0.09]);
  }),
  bench: () => model((b) => {
    for (const x of [-0.75, 0.75]) { const l = boxG(0.08, 0.45, 0.5); l.translate(x, 0, 0); b.addGeometry(l, M(), [0.15, 0.15, 0.16]); }
    for (let k = 0; k < 3; k++) { const s = boxG(1.8, 0.05, 0.12); s.translate(0, 0.45, -0.18 + k * 0.15); b.addGeometry(s, M(), [0.52, 0.34, 0.2]); }
    for (let k = 0; k < 2; k++) { const s = boxG(1.8, 0.1, 0.04); s.translate(0, 0.62 + k * 0.17, -0.27); b.addGeometry(s, M(), [0.52, 0.34, 0.2]); }
  }),
  cone: () => model((b) => {
    b.addGeometry(boxG(0.42, 0.04, 0.42), M(), [0.1, 0.1, 0.1]);
    const c = cyl(0.17, 0.035, 0.7, 12); c.translate(0, 0.04, 0); b.addGeometry(c, M(), [1.0, 0.35, 0.05]);
    const s = cyl(0.115, 0.09, 0.12, 12); s.translate(0, 0.38, 0); b.addGeometry(s, M(), [0.95, 0.95, 0.95]);
  }),
  barrel: () => model((b) => {
    for (let k = 0; k < 4; k++) { const c = cyl(0.29, 0.29, 0.25, 14); c.translate(0, k * 0.25, 0); b.addGeometry(c, M(), k % 2 ? [0.95, 0.95, 0.95] : [1.0, 0.4, 0.05]); }
  }),
  newsbox: () => model((b) => {
    b.addGeometry(boxG(0.5, 1.0, 0.45), M(), [0.15, 0.3, 0.65]);
    const w = boxG(0.4, 0.25, 0.02); w.translate(0, 0.65, 0.23); b.addGeometry(w, M(), [0.8, 0.85, 0.9]);
  }),
  meter: () => model((b) => {
    b.addGeometry(cyl(0.04, 0.04, 1.15, 6), M(), [0.35, 0.35, 0.37]);
    const h = boxG(0.2, 0.32, 0.16); h.translate(0, 1.15, 0); b.addGeometry(h, M(), [0.55, 0.57, 0.6]);
  }),
  busstop: () => model((b) => {
    for (const x of [-1.9, 1.9]) { const p = boxG(0.08, 2.6, 0.08); p.translate(x, 0, -0.6); b.addGeometry(p, M(), [0.6, 0.62, 0.65]); }
    const roof = boxG(4.2, 0.1, 1.6); roof.translate(0, 2.6, 0); b.addGeometry(roof, M(), [0.65, 0.67, 0.7]);
    const back = boxG(3.8, 2.0, 0.04); back.translate(0, 0.4, -0.62); b.addGeometry(back, M(), [0.5, 0.65, 0.7]);
    const seat = boxG(2.4, 0.06, 0.4); seat.translate(-0.5, 0.48, -0.35); b.addGeometry(seat, M(), [0.4, 0.42, 0.45]);
    const ad = boxG(1.3, 1.9, 0.08); ad.translate(1.6, 0.45, -0.6); b.addGeometry(ad, M(), [0.25, 0.25, 0.28]);
  }),
  adPanel: () => { const g = new THREE.PlaneGeometry(1.2, 1.75); g.translate(1.6, 1.4, -0.55); return g; },
  lifeguard: () => model((b) => {
    for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) { const l = boxG(0.15, 2.2, 0.15); l.translate(x, 0, z); b.addGeometry(l, M(), [0.92, 0.9, 0.85]); }
    const deck = boxG(3.0, 0.15, 3.0); deck.translate(0, 2.2, 0); b.addGeometry(deck, M(), [0.92, 0.9, 0.85]);
    const hut = boxG(2.4, 2.0, 2.4); hut.translate(0, 2.35, 0); b.addGeometry(hut, M(), [1, 1, 1]);
    const roof = new THREE.ConeGeometry(2.0, 0.9, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 4.8, 0); b.addGeometry(roof, M(), [1, 1, 1]);
    const win = boxG(1.6, 0.7, 0.02); win.translate(0, 3.3, 1.21); b.addGeometry(win, M(), [0.1, 0.15, 0.2]);
    const ramp = boxG(0.9, 0.08, 3.2); ramp.rotateX(-0.6); ramp.translate(0, 1.05, 2.6); b.addGeometry(ramp, M(), [0.92, 0.9, 0.85]);
  }),
  umbrella: () => model((b) => {
    b.addGeometry(cyl(0.025, 0.025, 2.3, 6), M(), [0.9, 0.9, 0.9]);
    const top = new THREE.ConeGeometry(1.25, 0.45, 12, 1, true); top.translate(0, 2.3, 0);
    b.addGeometry(top, M(), [1, 1, 1]);
  }),
  lounger: () => model((b) => {
    const base = boxG(0.65, 0.06, 1.9); base.translate(0, 0.3, 0); b.addGeometry(base, M(), [0.95, 0.95, 0.95]);
    const back = boxG(0.65, 0.06, 0.7); back.rotateX(0.9); back.translate(0, 0.45, -0.8); b.addGeometry(back, M(), [0.95, 0.95, 0.95]);
    for (const [x, z] of [[-0.28, -0.8], [0.28, -0.8], [-0.28, 0.8], [0.28, 0.8]]) { const l = boxG(0.04, 0.3, 0.04); l.translate(x, 0, z); b.addGeometry(l, M(), [0.8, 0.8, 0.8]); }
    const towel = boxG(0.55, 0.02, 1.3); towel.translate(0, 0.335, 0.2); b.addGeometry(towel, M(), [1, 1, 1]);
  }),
  table: () => model((b) => {
    b.addGeometry(cyl(0.04, 0.04, 0.72, 6), M(), [0.2, 0.2, 0.2]);
    const top = cyl(0.42, 0.42, 0.04, 14); top.translate(0, 0.72, 0); b.addGeometry(top, M(), [0.95, 0.95, 0.93]);
    for (const a of [0, Math.PI * 0.66, Math.PI * 1.33]) { const c = boxG(0.4, 0.45, 0.4); c.translate(Math.cos(a) * 0.65, 0, Math.sin(a) * 0.65); b.addGeometry(c, M(), [0.25, 0.25, 0.27]); }
  }),
  planter: () => model((b) => {
    b.addGeometry(boxG(1.4, 0.55, 1.4), M(), [0.78, 0.75, 0.7]);
    const soil = boxG(1.25, 0.02, 1.25); soil.translate(0, 0.55, 0); b.addGeometry(soil, M(), [0.25, 0.18, 0.12]);
  }),
  net: () => model((b) => {
    for (const x of [-4.5, 4.5]) { const p = cyl(0.05, 0.05, 2.5, 6); p.translate(x, 0, 0); b.addGeometry(p, M(), [0.9, 0.9, 0.9]); }
    const n = boxG(9, 0.9, 0.02); n.translate(0, 1.55, 0); b.addGeometry(n, M(), [0.15, 0.15, 0.15]);
  }),
};

// prop kinds: physics params (half extents of box / or cylinder), mass, breakable
const KINDS = {
  lamp:      { shape: 'cyl', r: 0.12, h: 9.0, mass: 180, dyn: true, breakSpeed: 3.5, comY: 3.2 },
  signal:    { shape: 'cyl', r: 0.15, h: 6.2, mass: 260, dyn: true, breakSpeed: 5, comY: 2.4 },
  hydrant:   { shape: 'cyl', r: 0.17, h: 0.65, mass: 90, dyn: true, breakSpeed: 2 },
  bin:       { shape: 'cyl', r: 0.3, h: 1.0, mass: 18, dyn: true },
  bench:     { shape: 'box', hx: 0.9, hy: 0.42, hz: 0.3, mass: 45, dyn: true },
  cone:      { shape: 'cyl', r: 0.17, h: 0.75, mass: 3, dyn: true },
  barrel:    { shape: 'cyl', r: 0.3, h: 1.0, mass: 14, dyn: true },
  newsbox:   { shape: 'box', hx: 0.25, hy: 0.5, hz: 0.23, mass: 30, dyn: true },
  meter:     { shape: 'cyl', r: 0.08, h: 1.4, mass: 20, dyn: true, breakSpeed: 1.5 },
  busstop:   { shape: 'box', hx: 2.1, hy: 1.35, hz: 0.8, mass: 0, dyn: false },
  lifeguard: { shape: 'box', hx: 1.6, hy: 2.6, hz: 1.6, mass: 0, dyn: false },
  umbrella:  { shape: 'cyl', r: 0.1, h: 2.4, mass: 6, dyn: true },
  lounger:   { shape: 'box', hx: 0.33, hy: 0.25, hz: 0.95, mass: 12, dyn: true },
  table:     { shape: 'cyl', r: 0.45, h: 0.76, mass: 15, dyn: true },
  planter:   { shape: 'box', hx: 0.7, hy: 0.28, hz: 0.7, mass: 0, dyn: false },
  net:       { shape: 'box', hx: 4.6, hy: 1.25, hz: 0.1, mass: 0, dyn: false },
};

export class Props {
  constructor(scene, physics, T) {
    this.scene = scene;
    this.physics = physics;
    this.T = T;
    this.items = []; // {kind, x,y,z, rot, pos:Vec3, quat, body, moved, broken}
    this.byKind = {};
    for (const k of Object.keys(KINDS)) this.byKind[k] = [];
    this.lamps = [];
    this.signals = [];
    this.rng = new RNG(1212);
    this.umbrellaColors = [[0.95, 0.25, 0.3], [0.1, 0.55, 0.9], [1.0, 0.78, 0.1], [0.1, 0.75, 0.6], [0.95, 0.5, 0.75], [1, 1, 1]];
  }

  add(kind, x, z, rot = 0, y = null, extra = {}) {
    const gy = y ?? groundHeight(x, z);
    const it = { kind, x, y: gy, z, rot, pos: new THREE.Vector3(x, gy, z), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), body: null, moved: false, idx: this.byKind[kind].length, ...extra };
    this.items.push(it);
    this.byKind[kind].push(it);
    return it;
  }

  build() {
    const s = new THREE.Vector3(1, 1, 1);
    const m4 = new THREE.Matrix4();
    this.meshes = {};
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 });
    this.propMat = mat;
    for (const k of Object.keys(KINDS)) {
      const list = this.byKind[k];
      if (!list.length) continue;
      const geo = MODELS[k]();
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((it, i) => { m4.compose(it.pos, it.quat, s); im.setMatrixAt(i, m4); });
      if (k === 'umbrella') list.forEach((it, i) => im.setColorAt(i, new THREE.Color(...this.rng.pick(this.umbrellaColors))));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      this.meshes[k] = im;
    }
    // static colliders for non-dynamic props
    for (const it of this.items) {
      const K = KINDS[it.kind];
      if (!K.dyn) {
        const b = this.physics.addStaticBox(it.x, it.y + K.hy, it.z, K.hx, K.hy, K.hz, this.physics.mat.wall, it.rot);
        it.body = b; it.static = true;
      }
    }
    this.buildLights();
    this.buildSignals();
  }

  // ---------------------------------------------------------- lights
  buildLights() {
    const lamps = this.byKind.lamp;
    // emissive lens instanced
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6) });
    this.lens = new THREE.InstancedMesh(MODELS.lampLens(), this.lensMat, lamps.length);
    this.lens.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((it, i) => { m4.compose(it.pos, it.quat, one); this.lens.setMatrixAt(i, m4); });
    this.scene.add(this.lens);
    // fake light pools on the ground (additive decals)
    this.poolMat = new THREE.MeshBasicMaterial({ map: this.T.lightPool, color: new THREE.Color(1, 0.75, 0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 });
    const pg = new THREE.PlaneGeometry(13, 13); pg.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(pg, this.poolMat, lamps.length);
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    lamps.forEach((it, i) => {
      const hx = it.x + Math.cos(it.rot) * -2.3, hz = it.z - Math.sin(it.rot) * -2.3;
      it.headPos = new THREE.Vector3(hx, it.y + 8.8, hz);
      m4.makeTranslation(hx, groundHeight(hx, hz) + 0.03, hz);
      this.pools.setMatrixAt(i, m4);
    });
    this.pools.layers.set(LAYER_NO_REFLECT);
    this.pools.frustumCulled = false;
    this.scene.add(this.pools);
    // glow sprites around lamp heads (for bloom-y halos in rain/fog)
    this.haloMat = new THREE.MeshBasicMaterial({ map: this.T.glow, color: new THREE.Color(1, 0.8, 0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 3.2), this.haloMat, lamps.length);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halos.frustumCulled = false;
    this.scene.add(this.halos);
    // pooled real point lights near the camera
    this.lightPool = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffc890, 0, 26, 1.6);
      this.scene.add(l);
      this.lightPool.push(l);
    }
    this.lightTimer = 0;
  }

  buildSignals() {
    // traffic light lenses per signal pole: red/yellow/green instanced spheres
    const g = new THREE.CircleGeometry(0.13, 12);
    this.sigMats = { red: new THREE.MeshBasicMaterial({ color: 0xffffff }), yellow: new THREE.MeshBasicMaterial({ color: 0xffffff }), green: new THREE.MeshBasicMaterial({ color: 0xffffff }) };
    const n = this.byKind.signal.length * 2;
    this.sigLens = {};
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const [ci, c] of ['red', 'yellow', 'green'].entries()) {
      const im = new THREE.InstancedMesh(g, this.sigMats[c], n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      this.sigLens[c] = im;
      this.scene.add(im);
    }
    this.updateSignalMatrices();
  }

  updateSignalMatrices() {
    const m4 = new THREE.Matrix4(), lm = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    const sig = this.byKind.signal;
    sig.forEach((it, i) => {
      for (const [hi, hx] of [-2.2, -4.9].entries()) {
        for (const [ci, c] of ['red', 'yellow', 'green'].entries()) {
          m4.compose(it.pos, it.quat, one);
          lm.makeTranslation(hx, 5.73 - ci * 0.33, 0.17);
          m4.multiply(lm);
          this.sigLens[c].setMatrixAt(i * 2 + hi, m4);
        }
      }
    });
    for (const c of ['red', 'yellow', 'green']) this.sigLens[c].instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------- physics activation
  activate(it) {
    const K = KINDS[it.kind];
    const P = this.physics;
    const b = new CANNON.Body({ mass: K.mass, material: P.mat.prop, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.6, linearDamping: 0.05, angularDamping: 0.15 });
    const comY = K.comY ?? (K.shape === 'box' ? K.hy : K.h / 2);
    if (K.shape === 'cyl') b.addShape(new CANNON.Cylinder(K.r, K.r, K.h, 8), new CANNON.Vec3(0, K.h / 2 - comY, 0));
    else b.addShape(new CANNON.Box(new CANNON.Vec3(K.hx, K.hy, K.hz)), new CANNON.Vec3(0, K.hy - comY, 0));
    b.position.set(it.pos.x, it.pos.y + comY, it.pos.z);
    b.quaternion.set(it.quat.x, it.quat.y, it.quat.z, it.quat.w);
    b.comY = comY;
    b.sleep();
    if (K.breakSpeed) {
      // anchored until hit hard enough
      b.type = CANNON.Body.STATIC; b.mass = 0; b.updateMassProperties();
      b.anchored = true;
      b.addEventListener('collide', (e) => {
        if (!b.anchored) return;
        const v = e.contact.getImpactVelocityAlongNormal();
        if (Math.abs(v) > K.breakSpeed) this.breakLoose(it, b, K);
      });
    }
    P.world.addBody(b);
    it.body = b;
  }
  breakLoose(it, b, K) {
    // switch to dynamic on next tick (cannot mutate during collision dispatch)
    this.pendingBreak = this.pendingBreak || [];
    this.pendingBreak.push(() => {
      b.anchored = false;
      b.type = CANNON.Body.DYNAMIC; b.mass = K.mass; b.updateMassProperties();
      b.wakeUp();
      it.broken = true;
      if (it.kind === 'hydrant') this.onHydrant?.(it);
      this.onBreak?.(it);
    });
  }
  deactivate(it) {
    if (!it.body || it.static) return;
    this.physics.world.removeBody(it.body);
    it.body = null;
  }

  update(dt, focus, camera, night, time) {
    if (this.pendingBreak?.length) { for (const f of this.pendingBreak) f(); this.pendingBreak.length = 0; }
    // activation sweep (staggered)
    const R_ON = 70, R_OFF = 90;
    const n = this.items.length;
    const per = Math.ceil(n / 20);
    this.sweep = ((this.sweep || 0) + per) % Math.max(1, n);
    for (let k = 0; k < per; k++) {
      const it = this.items[(this.sweep + k) % n];
      if (it.static) continue;
      const d2 = (it.pos.x - focus.x) ** 2 + (it.pos.z - focus.z) ** 2;
      if (!it.body && d2 < R_ON * R_ON && KINDS[it.kind].dyn) this.activate(it);
      else if (it.body && d2 > R_OFF * R_OFF && (it.body.sleepState === CANNON.Body.SLEEPING || it.body.type === CANNON.Body.STATIC)) this.deactivate(it);
    }
    // sync moved bodies to instances
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), off = new THREE.Vector3();
    const dirty = {};
    for (const it of this.items) {
      const b = it.body;
      if (!b || it.static || b.type === CANNON.Body.STATIC || b.sleepState === CANNON.Body.SLEEPING) continue;
      it.quat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      off.set(0, -b.comY, 0).applyQuaternion(it.quat);
      it.pos.set(b.position.x + off.x, b.position.y + off.y, b.position.z + off.z);
      it.moved = true;
      m4.compose(it.pos, it.quat, one);
      this.meshes[it.kind].setMatrixAt(it.idx, m4);
      dirty[it.kind] = true;
      if (it.kind === 'lamp') { this.lens.setMatrixAt(it.idx, m4); dirty._lens = true; }
      if (it.kind === 'signal') dirty._sig = true;
      if (it.pos.y < -20) { this.deactivate(it); }
    }
    for (const k of Object.keys(dirty)) if (this.meshes[k]) this.meshes[k].instanceMatrix.needsUpdate = true;
    if (dirty._lens) this.lens.instanceMatrix.needsUpdate = true;
    if (dirty._sig) this.updateSignalMatrices();

    // lights
    const on = smoothstep(0.25, 0.6, night);
    this.lensMat.color.setRGB(lerp(0.6, 6, on), lerp(0.55, 4.6, on), lerp(0.45, 2.8, on));
    this.poolMat.opacity = on * 0.42;
    this.haloMat.opacity = on * (0.35 + U.uRain.value * 0.4);
    const camQ = camera.quaternion;
    const lamps = this.byKind.lamp;
    lamps.forEach((it, i) => {
      if (it.broken) { m4.makeScale(0, 0, 0); this.pools.setMatrixAt(i, m4); this.halos.setMatrixAt(i, m4); return; }
      const hp = it.headPos;
      m4.compose(hp, camQ, one);
      this.halos.setMatrixAt(i, m4);
    });
    this.halos.instanceMatrix.needsUpdate = true;
    if (this._brokenDirty) { this.pools.instanceMatrix.needsUpdate = true; }
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.3;
      const cp = camera.position;
      const near = [];
      for (const it of lamps) {
        if (it.broken) continue;
        const d = (it.headPos.x - cp.x) ** 2 + (it.headPos.z - cp.z) ** 2;
        if (d < 120 * 120) near.push([d, it]);
      }
      near.sort((a, b) => a[0] - b[0]);
      this.nearLamps = near.slice(0, this.lightPool.length).map((e) => e[1]);
      this.pools.instanceMatrix.needsUpdate = true;
    }
    this.lightPool.forEach((l, i) => {
      const it = this.nearLamps?.[i];
      if (!it || on < 0.01) { l.intensity = 0; return; }
      l.position.set(it.headPos.x, it.headPos.y - 0.4, it.headPos.z);
      l.intensity = on * 42;
    });

    // traffic signals
    const sig = this.byKind.signal;
    const col = new THREE.Color();
    const dim = [0.06, 0.06, 0.06];
    sig.forEach((it, i) => {
      const st = it.broken ? 'off' : signalState(it.node, it.axis, time);
      for (let hi = 0; hi < 2; hi++) {
        this.sigLens.red.setColorAt(i * 2 + hi, st === 'red' ? col.setRGB(6, 0.15, 0.1) : col.setRGB(0.12, 0.02, 0.02));
        this.sigLens.yellow.setColorAt(i * 2 + hi, st === 'yellow' ? col.setRGB(6, 3.2, 0.2) : col.setRGB(0.12, 0.08, 0.01));
        this.sigLens.green.setColorAt(i * 2 + hi, st === 'green' ? col.setRGB(0.2, 6, 2.5) : col.setRGB(0.01, 0.1, 0.05));
      }
    });
    for (const c of ['red', 'yellow', 'green']) this.sigLens[c].instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------ placement of props & vegetation
export function populate(props, veg, buildings) {
  const rng = new RNG(31337);
  const occupied = [];
  const blocked = (x, z, r) => {
    for (const c of buildings.colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
    return false;
  };
  // streets: lamps both sides staggered, trees/palms, furniture along the curb line
  for (const e of edges) {
    const rx = -e.dz, rz = e.dx;
    const causeway = e.len > 200;
    const boulevard = e.a.x === -180 && e.b.x === -180 || e.a.x === 520 && e.b.x === 520;
    for (const side of [-1, 1]) {
      const off = HALF_ROAD + 0.75;
      const start = 16, end = e.len - 16;
      const spacing = causeway ? 30 : 34;
      const phase = side > 0 ? 0 : spacing / 2;
      for (let t = start + phase; t < end; t += spacing) {
        const x = e.a.x + e.dx * t + rx * off * side, z = e.a.z + e.dz * t + rz * off * side;
        // lamp arm points over the road
        const rot = Math.atan2(-(rz * side), (rx * side));
        props.lamps.push(props.add('lamp', x, z, rot));
      }
      // street trees / palms between lamps
      const treeSp = causeway ? 30 : boulevard ? 17 : 34;
      for (let t = start + 8 + (side > 0 ? 0 : 6); t < end - 4; t += treeSp) {
        const x = e.a.x + e.dx * t + rx * (HALF_ROAD + 1.4) * side, z = e.a.z + e.dz * t + rz * (HALF_ROAD + 1.4) * side;
        if (causeway) veg.addPalm(x, groundHeight(x, z), z, rng.range(0.9, 1.3), rng.range(0, 6.28));
        else if (boulevard || e.b.x >= 330) veg.addPalm(x, groundHeight(x, z), z, rng.range(0.75, 1.15), rng.range(0, 6.28));
        else if (rng.chance(0.45)) veg.addTree(x, groundHeight(x, z), z, rng.range(0.6, 0.85), rng.range(0, 6.28));
      }
      // furniture
      if (!causeway) {
        for (let t = 22; t < e.len - 22; t += rng.range(9, 16)) {
          const x = e.a.x + e.dx * t + rx * (HALF_ROAD + 0.55) * side, z = e.a.z + e.dz * t + rz * (HALF_ROAD + 0.55) * side;
          const r = rng.next();
          const faceRot = Math.atan2(rx * side, rz * side);
          if (r < 0.12) props.add('hydrant', x, z, rng.range(0, 6));
          else if (r < 0.26) props.add('bin', x + rx * side * 1.2, z + rz * side * 1.2, 0);
          else if (r < 0.36) props.add('bench', x + rx * side * 2.6, z + rz * side * 2.6, faceRot + Math.PI);
          else if (r < 0.42) props.add('newsbox', x + rx * side * 0.4, z + rz * side * 0.4, faceRot + Math.PI);
          else if (r < 0.58) props.add('meter', x, z, faceRot);
          else if (r < 0.6) props.add('busstop', x + rx * side * 2.3, z + rz * side * 2.3, faceRot + Math.PI);
        }
      }
    }
  }
  // traffic signals at signalised nodes: two poles at opposite corners facing approaching traffic
  for (const n of nodes) {
    if (!n.signal) continue;
    const c = HALF_ROAD + 1.0;
    // pole serving northbound traffic (axis z) on the SE corner, arm over the road toward west
    const defs = [
      { x: n.x + c, z: n.z + c, rot: 0, axis: 'z' },
      { x: n.x - c, z: n.z - c, rot: Math.PI, axis: 'z' },
      { x: n.x - c, z: n.z + c, rot: -Math.PI / 2, axis: 'x' },
      { x: n.x + c, z: n.z - c, rot: Math.PI / 2, axis: 'x' },
    ];
    for (const d of defs) {
      if (groundHeight(d.x, d.z) < 0.1) continue;
      const it = props.add('signal', d.x, d.z, d.rot, null, { node: n, axis: d.axis });
      props.signals.push(it);
    }
  }
  // parks
  for (const s of slabs) {
    if (s.kind === 'park') {
      const x0 = s.x0 + SIDEWALK_W + 3, x1 = s.x1 - SIDEWALK_W - 3, z0 = s.z0 + SIDEWALK_W + 3, z1 = s.z1 - SIDEWALK_W - 3;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      for (let i = 0; i < 14; i++) {
        const x = rng.range(x0, x1), z = rng.range(z0, z1);
        if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
        if (rng.chance(0.55)) veg.addTree(x, CURB_H, z, rng.range(0.8, 1.2), rng.range(0, 6.28));
        else veg.addPalm(x, CURB_H, z, rng.range(0.8, 1.2), rng.range(0, 6.28));
      }
      for (let i = 0; i < 26; i++) {
        const x = rng.range(x0, x1), z = rng.range(z0, z1);
        if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
        veg.addBush(x, CURB_H, z, rng.range(0.8, 1.6), rng.range(0.7, 1.2), rng.range(0.8, 1.6), rng.range(0, 6), rng.chance(0.3));
      }
      for (const [dx, dz, r] of [[3, 12, 0], [-3, -12, Math.PI], [12, -3, Math.PI / 2], [-12, 3, -Math.PI / 2]]) props.add('bench', cx + dx, cz + dz, r);
      for (const [dx, dz] of [[3, 20], [-3, -20], [20, 3], [-20, -3]]) props.add('bin', cx + dx, cz + dz, 0);
      for (let i = 0; i < 4; i++) props.add('table', rng.range(x0, x1), rng.range(z0, z1), rng.range(0, 6));
      // park lamps
      for (const [dx, dz] of [[2.5, 25], [-2.5, -25], [25, -2.5], [-25, 2.5]]) props.lamps.push(props.add('lamp', cx + dx, cz + dz, Math.atan2(dz, dx)));
    }
    if (s.kind === 'bayfront' || s.kind === 'baywalk') {
      const xs = s.kind === 'bayfront' ? [s.x0 + 3.5, s.x1 - 5] : [s.x1 - 3.5];
      for (const px of xs) for (let z = s.z0 + 6; z < s.z1 - 4; z += 15) veg.addPalm(px + rng.range(-0.8, 0.8), CURB_H, z + rng.range(-2, 2), rng.range(0.85, 1.35), rng.range(0, 6.28));
      for (let z = s.z0 + 10; z < s.z1 - 6; z += 28) props.add('bench', s.x1 - 2.2, z, -Math.PI / 2);
      for (let z = s.z0 + 14; z < s.z1 - 6; z += 40) props.lamps.push(props.add('lamp', s.x1 - 1.2, z, 0));
      for (let i = 0; i < (s.z1 - s.z0) / 9; i++) veg.addBush(rng.range(s.x0 + 6, s.x1 - 9), CURB_H, rng.range(s.z0 + 4, s.z1 - 4), rng.range(0.7, 1.5), rng.range(0.6, 1.1), rng.range(0.7, 1.5), rng.range(0, 6), rng.chance(0.4));
    }
    if (s.kind === 'oceanpark') {
      for (const px of [s.x0 + 2.5, s.x1 - 3]) for (let z = s.z0 + 4; z < s.z1 - 2; z += 12) veg.addPalm(px + rng.range(-0.6, 0.6), CURB_H, z + rng.range(-1.5, 1.5), rng.range(0.9, 1.45), rng.range(0, 6.28));
      for (let z = s.z0 + 8; z < s.z1 - 4; z += 22) props.add('bench', s.x0 + 1.4, z, Math.PI / 2);
      for (let z = s.z0 + 18; z < s.z1 - 6; z += 36) props.add('bin', s.x0 + 1.2, z + 2, 0);
      for (let i = 0; i < 160; i++) veg.addBush(rng.range(s.x0 + 5, s.x1 - 6), CURB_H, rng.range(s.z0 + 3, s.z1 - 3), rng.range(0.6, 1.3), rng.range(0.5, 1.0), rng.range(0.6, 1.3), rng.range(0, 6), rng.chance(0.45));
    }
    if (s.kind === 'causewalk') {
      for (let x = s.x0 + 8; x < s.x1 - 4; x += 20) props.add('planter', x, (s.z0 + s.z1) / 2, 0);
    }
  }
  // hotel café tables + planters in front of art-deco hotels (on the Ocean Drive sidewalk)
  for (const h of buildings.hotelFronts) {
    for (let z = h.z0 + 1; z < h.z1; z += 3.2) props.add('table', h.x + rng.range(-0.2, 0.2), z, rng.range(0, 6));
    props.add('planter', h.x + 2.6, h.z0 - 0.5, 0);
    veg.addBush(h.x + 2.6, CURB_H + 0.55, h.z0 - 0.5, 0.6, 0.6, 0.6, rng.range(0, 6), true);
  }
  // beach
  for (let z = BEACH.z0 + 40; z < BEACH.z1 - 30; z += 150) props.add('lifeguard', 588, z, -Math.PI / 2);
  for (let i = 0; i < 90; i++) {
    const x = rng.range(568, 600), z = rng.range(BEACH.z0 + 15, BEACH.z1 - 15);
    props.add('umbrella', x, z, rng.range(0, 6));
    props.add('lounger', x + rng.range(-1.6, 1.6), z + rng.range(0.6, 1.5), rng.range(-0.3, 0.3) + Math.PI / 2);
    if (rng.chance(0.5)) props.add('lounger', x + rng.range(-1.6, 1.6), z - rng.range(0.6, 1.5), rng.range(-0.3, 0.3) + Math.PI / 2);
  }
  props.add('net', 585, -140, 0); props.add('net', 585, 210, 0);
  for (let z = BEACH.z0 + 10; z < BEACH.z1 - 10; z += rng.range(16, 30)) veg.addPalm(rng.range(557, 566), 0, z, rng.range(0.8, 1.4), rng.range(0, 6.28));
  // construction zones: cones & barrels on a few lanes
  for (const [cx, cz, dir] of [[-430, -150, 'z'], [-230, 250, 'x'], [440, -260, 'z'], [-330, 450, 'x']]) {
    for (let k = 0; k < 9; k++) {
      const o = k * 3 - 12;
      const x = dir === 'z' ? cx - 5.25 + 2 : cx + o, z = dir === 'z' ? cz + o : cz - 5.25 + 2;
      props.add(k % 3 === 0 ? 'barrel' : 'cone', x, z, rng.range(0, 6));
    }
  }
  // parking lot lamps
  for (const s of slabs) if (s.kind === 'parking') {
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    for (const dx of [-20, 20]) props.lamps.push(props.add('lamp', cx + dx, cz, 0));
  }
  return { count: props.items.length };
}
