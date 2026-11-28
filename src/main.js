// NEON COAST — an original open-world city sandbox in the browser.
// Entry point: builds the world, runs the fixed-step physics + render loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { U, STATE, QUALITY, LAYER_NO_REFLECT } from './core/globals.js';
import { buildTextures } from './core/textures.js';
import { Physics } from './core/physics.js';
import { Input } from './core/input.js';
import { CameraRig } from './core/camera.js';
import { StaticCollision } from './core/collide.js';
import { lerp, clamp, smoothstep, sleep0, RNG } from './core/utils.js';
import { Sky } from './world/sky.js';
import { Weather, WEATHERS } from './world/weather.js';
import { PlanarReflection } from './world/reflection.js';
import { buildCity } from './world/city.js';
import { Buildings } from './world/buildings.js';
import { Water } from './world/water.js';
import { Vegetation } from './world/vegetation.js';
import { Props, populate } from './world/props.js';
import { Grass } from './world/grass.js';
import { FX, SkidMarks } from './world/fx.js';
import { Traffic } from './vehicles/traffic.js';
import { Player } from './characters/player.js';
import { Pedestrians } from './characters/pedestrians.js';
import { Audio } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { SPAWN, groundHeight } from './world/map.js';
import { updateFarLights } from './vehicles/carModel.js';
import { parseGLB, loadGLB, isCharacter, fitCarModel, specForModel } from './core/models.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uSat: { value: 1.08 }, uFlash: { value: 0 }, uWet: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSat, uFlash, uWet; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float ca = 0.0012 * dot(c, c) * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      float vig = smoothstep(0.85, 0.2, length(c * vec2(1.0, 0.85)));
      col *= mix(1.0 - uVignette, 1.0, vig);
      col += (h(uv * 731.0) - 0.5) * 0.018;
      col += vec3(0.04, 0.045, 0.06) * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.time = 0;
    this.realTime = 0;
    this.ready = false;
    this.running = false;
    this.menuOpen = false;
  }

  progress(label, frac) {
    const bar = document.getElementById('load-bar');
    const txt = document.getElementById('load-text');
    if (frac !== undefined) bar.style.width = `${Math.round(frac * 100)}%`;
    txt.textContent = label;
  }

  detectQuality() {
    const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    STATE.mobile = mobile;
    const saved = (() => { try { return localStorage.getItem('nc-quality'); } catch (e) { return null; } })();
    STATE.quality = saved && QUALITY[saved] ? saved : mobile ? 'low' : 'high';
    STATE.q = QUALITY[STATE.quality];
  }

  async init() {
    this.detectQuality();
    const steps = 16;
    let k = 0;
    const tick = async (label) => { this.progress(label, ++k / steps); await sleep0(); };
    await tick('Starting renderer');
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.12, STATE.q.far);
    this.camera.layers.enable(LAYER_NO_REFLECT);
    this.scene.add(this.camera);

    const T = await buildTextures((l) => this.progress(l, (++k) / steps));
    this.T = T;
    U.uNoise.value = T.noise;
    await tick('Spinning up physics');
    this.physics = new Physics();
    this.audio = new Audio();
    await tick('Painting the sky');
    this.sky = new Sky(this.scene, r, T);
    this.weather = new Weather(this.scene, this.audio);
    this.sky.setShadows(STATE.q.shadows);
    r.shadowMap.enabled = !!STATE.q.shadows;
    this.reflection = new PlanarReflection(r, this.scene, STATE.q.reflScale);
    await tick('Paving roads & sidewalks');
    this.city = buildCity(this.scene, T, this.physics);
    await tick('Raising the skyline');
    this.buildings = new Buildings(this.scene, T, this.physics);
    await tick('Filling the bay & ocean');
    this.water = new Water(this.scene, T);
    this.water.addBoats(this.scene, new RNG(3));
    await tick('Planting palms & placing street furniture');
    this.veg = new Vegetation(this.scene, T);
    this.props = new Props(this.scene, this.physics, T);
    const pop = populate(this.props, this.veg, this.buildings);
    this.veg.build();
    this.props.build();
    this.props.onHydrant = (it) => this.fx.addGeyser(it.pos);
    await tick('Growing interactive grass');
    this.grass = new Grass(this.scene, r);
    this.fx = new FX(this.scene, T, r);
    this.skids = new SkidMarks(this.scene);
    // character collision world
    const C = new StaticCollision();
    for (const b of this.buildings.colliders) C.addBox(b.x0, b.z0, b.x1, b.z1, -1, b.h);
    for (const p of this.veg.palms) C.addCircle(p.x, p.z, 0.3 * p.scale, p.y, p.y + 8);
    for (const t of this.veg.trees) C.addCircle(t.x, t.z, 0.35 * t.scale, t.y, t.y + 5);
    for (const it of this.props.items) {
      if (it.kind === 'lamp' || it.kind === 'signal') C.addCircle(it.x, it.z, 0.18, it.y, it.y + 6);
      if (it.static) C.addBox(it.x - 1.2, it.z - 1.2, it.x + 1.2, it.z + 1.2, it.y, it.y + (it.kind === 'busstop' ? 0.3 : 2.5));
    }
    this.collide = C;
    await tick('Assembling cars from scratch');
    this.traffic = new Traffic(this);
    // three cars parked side by side facing the street, right next to the spawn point
    this.showcase = [
      this.traffic.spawnShowcase(-97.5, 22, Math.PI / 2, 'supercar', [0.75, 0.02, 0.02]),
      this.traffic.spawnShowcase(-97.5, 27, Math.PI / 2, 'truck', [0.18, 0.2, 0.22]),
      this.traffic.spawnShowcase(-97.5, 17, Math.PI / 2, 'muscle', [0.85, 0.35, 0.02]),
      this.traffic.spawnShowcase(-97.5, 12, Math.PI / 2, 'suv', [0.05, 0.05, 0.06]),
    ];
    for (const v of this.showcase) v.ensureDetail();
    this.buildQueue = new Set();
    this.traffic.spawnParked();
    // drop random parked cars that overlap the showcase
    this.traffic.parked = this.traffic.parked.filter((v) => {
      if (this.showcase.includes(v)) return true;
      const clash = this.showcase.some((s) => s.pos.distanceTo(v.pos) < 6);
      if (clash) v.dispose();
      return !clash;
    });
    await tick('Populating the streets');
    this.player = new Player(this);
    this.peds = new Pedestrians(this);
    this.peds.spawnSunbathers(this.props);
    this.input = new Input(this.canvas);
    this.cameraRig = new CameraRig(this.camera, this.collide);
    this.cameraRig.yaw = SPAWN.heading;
    this.hud = new HUD(this);
    const touch = this.input.setupTouch(document.getElementById('ui'));
    // headlights for the player's car
    this.headL = new THREE.SpotLight(0xfff2e0, 0, 70, 0.5, 0.45, 1.4);
    this.headR = this.headL.clone();
    this.headTargets = [new THREE.Object3D(), new THREE.Object3D()];
    await tick('Post-processing');
    this.setupComposer();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.bindUI();
    // pre-warm: populate traffic around spawn & compile shaders
    for (let i = 0; i < STATE.q.traffic; i++) this.traffic.spawn(this.player.pos, 40, 320);
    for (let i = 0; i < 60; i++) this.peds.spawn(this.player.pos);
    this.update(0.016);
    await tick('Compiling shaders');
    try { r.compile(this.scene, this.camera); } catch (e) { /* ignore */ }
    this.progress(`Ready — ${pop.count + this.veg.palms.length + this.veg.trees.length + this.veg.bushes.length} objects placed`, 1);
    this.ready = true;
    document.getElementById('start').disabled = false;
    document.getElementById('start').textContent = touch ? 'Tap to play' : 'Click to play';
    this.loadManifest();
    this.loop = this.loop.bind(this);
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  setupComposer() {
    const r = this.renderer;
    const q = STATE.q;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (!q.msaa) { this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa); } else this.fxaa = null;
  }

  applyQuality(name) {
    STATE.quality = name; STATE.q = QUALITY[name];
    try { localStorage.setItem('nc-quality', name); } catch (e) { /* */ }
    this.sky.setShadows(STATE.q.shadows);
    this.renderer.shadowMap.enabled = !!STATE.q.shadows;
    this.camera.far = STATE.q.far;
    this.grass.generate(STATE.q.grass);
    this.composer.dispose?.();
    this.setupComposer();
    this.onResize();
    this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => (m.needsUpdate = true)); } });
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, STATE.q.pixelRatio) * (this.dynScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.bloom.resolution.set(size.x / 2, size.y / 2);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
    this.reflection.setScale(STATE.q.reflScale, size.x, size.y);
    this.fx?.setScale(size.y);
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    $('start').addEventListener('click', () => this.start());
    const qs = $('opt-quality');
    qs.value = STATE.quality;
    qs.addEventListener('change', () => this.applyQuality(qs.value));
    const ws = $('opt-weather');
    ws.addEventListener('change', () => { this.weather.set(ws.value); this.hud.notify(`Weather: ${WEATHERS[ws.value].label}`); });
    $('opt-auto').addEventListener('change', (e) => (this.weather.auto = e.target.checked));
    const tod = $('opt-time');
    tod.addEventListener('input', () => { STATE.hour = parseFloat(tod.value); });
    $('opt-speed').addEventListener('change', (e) => (STATE.timeScale = parseFloat(e.target.value)));
    $('opt-volume').addEventListener('input', (e) => { if (this.audio.ok) this.audio.master.gain.value = parseFloat(e.target.value); });
    $('resume').addEventListener('click', () => this.toggleMenu(false));
    const drop = $('dropzone');
    window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('show'); });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('show'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('show');
      for (const f of e.dataTransfer.files) if (/\.(glb|gltf)$/i.test(f.name)) this.importFile(f);
    });
    $('opt-import').addEventListener('change', (e) => { for (const f of e.target.files) this.importFile(f); e.target.value = ''; });
    $('opt-reset-player').addEventListener('click', () => { this.player.resetModel(); this.hud.notify('Back to the default character'); });
    $('menu-btn').addEventListener('click', () => this.toggleMenu(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.audio.ctx?.suspend?.(); else if (this.running) this.audio.resume(); });
  }

  // ---------------------------------------------------------- real 3D models
  async importFile(file) {
    const name = file.name.replace(/\.(glb|gltf)$/i, '');
    this.hud.notify(`Loading ${file.name}…`, 3);
    try {
      const data = await file.arrayBuffer();
      const gltf = await parseGLB(data, '');
      this.applyImported(gltf, name, { data });
    } catch (e) {
      console.error(e);
      this.hud.notify(`Could not load ${file.name}: ${e.message || e}`, 5);
    }
  }
  applyImported(gltf, name, src = {}) {
    if (isCharacter(gltf)) {
      const r = this.player.useModel(gltf, { flip: !!src.flip });
      this.hud.notify(r.ok ? `You are now playing as ${name}` : `${name}: couldn't match bones (${r.missing.join(', ')})`, 5);
      return;
    }
    const yaw = this.player.heading;
    const { x, z } = this.freeSpot(this.player.pos, yaw);
    const v = this.importCar(gltf, name, x, z, yaw + Math.PI / 2, src);
    this.hud.notify(`${name} spawned — press F to drive (B while driving flips it if it's backwards)`, 6);
    return v;
  }
  // a clear patch of ground near `p` (no buildings, cars or water within a few metres)
  freeSpot(p, yaw = 0) {
    const vehicles = [...this.traffic.all()];
    for (let ring = 0; ring < 6; ring++) for (let k = 0; k < 12; k++) {
      const a = yaw + (k / 12) * Math.PI * 2, d = 7 + ring * 4;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (groundHeight(x, z) < 0) continue;
      const probe = new THREE.Vector3(x, groundHeight(x, z), z);
      if (this.collide.resolve(probe.clone(), 3.2)) continue;
      if (vehicles.some((v) => (v.pos.x - x) ** 2 + (v.pos.z - z) ** 2 < 36)) continue;
      return { x, z };
    }
    return { x: p.x + 8, z: p.z };
  }
  importCar(gltf, name, x, z, yaw, src = {}) {
    const fit = fitCarModel(gltf.scene, { flip: !!src.flip });
    const spec = specForModel(fit.size, fit.wheels, name);
    const v = this.traffic.newVehicle(spec.roofY > 1.7 ? 'suv' : 'sedan');
    const car = v.car;
    const lod = car.root.userData.lod;
    car.root.remove(lod);
    lod.traverse((o) => o.geometry?.dispose());
    car.root.add(fit.root);
    car.spec = spec; v.spec = spec; v.name = name;
    v.halfL = spec.L / 2; v.halfW = spec.W / 2;
    car.built = true; car.wheels = fit.wheels.length === 4 ? fit.wheels : null;
    car.root.userData.seat = new THREE.Vector3(spec.W * 0.2, spec.yBottom + 0.28, spec.zWsTop - 0.15);
    car.root.userData.lod = null;
    v.importSource = { gltfData: src.data || null, url: src.url || null, name, flip: !!src.flip };
    v.setPose(x, groundHeight(x, z), z, yaw);
    v.mode = 'parked';
    this.traffic.parked.push(v);
    return v;
  }
  async reimportFlipped(v) {
    const s = v.importSource;
    const pos = v.pos.clone(), yaw = v.yaw;
    const i = this.traffic.parked.indexOf(v); if (i >= 0) this.traffic.parked.splice(i, 1);
    v.dispose();
    const gltf = s.gltfData ? await parseGLB(s.gltfData, '') : await loadGLB(s.url);
    this.importCar(gltf, s.name, pos.x, pos.z, yaw, { data: s.gltfData, url: s.url, flip: !s.flip });
    this.hud.notify(`${s.name} flipped`, 2);
  }
  async loadManifest() {
    try {
      const res = await fetch('models/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const m = await res.json();
      let k = 0;
      for (const c of m.cars || []) {
        const gltf = await loadGLB('models/' + c.file);
        const { x, z } = this.freeSpot(this.player.pos, Math.PI);
        this.importCar(gltf, c.name || c.file, x, z, Math.PI / 2, { url: 'models/' + c.file, flip: !!c.flip });
        k++;
      }
      if (m.player) {
        const gltf = await loadGLB('models/' + (m.player.file || m.player));
        this.player.useModel(gltf, { flip: !!m.player.flip });
      }
      if (k || m.player) this.hud.notify('Custom models loaded', 3);
    } catch (e) { console.warn('model manifest:', e); }
  }

  toggleMenu(open) {
    this.menuOpen = open ?? !this.menuOpen;
    document.getElementById('menu').classList.toggle('show', this.menuOpen);
    document.getElementById('opt-time').value = STATE.hour.toFixed(2);
    document.getElementById('opt-weather').value = this.weather.current;
    if (!this.menuOpen && !this.input.touch.active) this.input.lock();
    if (this.menuOpen && document.pointerLockElement) document.exitPointerLock();
  }

  start() {
    if (!this.ready) return;
    this.audio.init();
    this.audio.resume();
    document.getElementById('loading').classList.add('done');
    setTimeout(() => (document.getElementById('loading').style.display = 'none'), 900);
    document.getElementById('ui').classList.add('live');
    this.running = true;
    if (!this.input.touch.active) this.input.lock();
    this.hud.banner('NEON COAST', 'Downtown · Bayfront Park');
  }

  handleGlobalKeys() {
    const I = this.input;
    if (I.hit('Escape') || I.hit('KeyP')) this.toggleMenu();
    if (I.hit('KeyY')) this.hud.notify(`Weather: ${this.weather.cycle()}`);
    if (I.hit('KeyI') || I.hit('F1')) this.hud.toggleHelp();
    if (I.hit('KeyQ') || I.touch.buttonsHit?.has('radio')) {
      if (this.player.vehicle) { const s = this.audio.nextStation(); this.hud.banner(s ? s.name : 'Radio Off', s ? s.genre : ''); }
    }
    if (I.hit('KeyM') && this.audio.ok) { this.audio.master.gain.value = this.audio.master.gain.value > 0 ? 0 : 0.85; this.hud.notify(this.audio.master.gain.value ? 'Sound on' : 'Muted'); }
    if (I.hit('KeyN')) { STATE.hour = (Math.floor(STATE.hour) + 3) % 24; this.hud.notify(`Time skipped to ${Math.floor(STATE.hour)}:00`); }
  }

  update(dt) {
    const I = this.input;
    this.time += dt;
    U.uTime.value = this.time;
    const fast = I.down('KeyT') ? 40 : 1;
    STATE.hour = (STATE.hour + dt * STATE.timeScale * fast / 3600) % 24;
    if (this.running) this.handleGlobalKeys();
    const p = this.player;
    const camYaw = this.cameraRig.yaw;
    if (this.running && !this.menuOpen) p.update(dt, I, camYaw);
    const focus = p.pos;
    this.weather.update(dt, this.camera.position);
    const pv = p.vehicle;
    this.traffic.update(dt, focus, pv, this.peds.all(), pv ? null : p.pos);
    // physics
    this.physics.world.step(1 / 60, Math.min(dt, 0.1), 5);
    // vehicles visuals
    const night = this.sky.info.night;
    this.traffic.updateVisuals(dt, night);
    if (pv) pv.update(dt, night);
    this.props.update(dt, focus, this.camera, night, this.time);
    const allVeh = pv ? [...this.traffic.cars, ...this.traffic.parked, ...this.traffic.wrecks, pv] : [...this.traffic.cars, ...this.traffic.parked, ...this.traffic.wrecks];
    this.peds.update(dt, focus, allVeh);
    this.cameraRig.update(dt, p, I);
    this.sky.update(dt, this.camera, this.weather, focus, this.time);
    this.water.update(dt, this.camera, this.sky, this.weather);
    this.buildings.update(dt, night, this.time);
    this.grass.update(dt, focus, this.camera.position);
    this.fx.update(dt, 0.12 + this.sky.info.dayK * 0.88);
    this.updateHeadlights(pv, night);
    updateFarLights(night);
    this.audio.update(dt, this);
    this.hud.update(dt);
    // build at most one high-detail car per frame (closest first) to avoid hitches
    if (this.buildQueue.size) {
      let best = null, bd = Infinity;
      const c = this.camera.position;
      for (const v of this.buildQueue) { const d = (v.pos.x - c.x) ** 2 + (v.pos.z - c.z) ** 2; if (d < bd) { bd = d; best = v; } }
      this.buildQueue.delete(best);
      best.ensureDetail();
    }
    // exposure: eyes adapt at night
    const target = lerp(1.0, 1.45, night) * (1 + this.weather.storm * 0.12);
    this.renderer.toneMappingExposure = lerp(this.renderer.toneMappingExposure, target, Math.min(1, dt * 0.8));
    this.grade.uniforms.uTime.value = this.time % 100;
    this.grade.uniforms.uFlash.value = U.uFlash.value;
    this.bloom.strength = lerp(0.42, 0.75, night) + this.weather.rain * 0.15;
  }

  updateHeadlights(v, night) {
    const on = v && v.headOn;
    for (const [i, l] of [this.headL, this.headR].entries()) {
      if (on) {
        if (l.parent !== v.root) {
          v.root.add(l); v.root.add(this.headTargets[i]);
          const s = v.spec;
          l.position.set((i ? -1 : 1) * s.W * 0.33, s.noseY - 0.05, s.L / 2 - 0.1);
          this.headTargets[i].position.set((i ? -1 : 1) * s.W * 0.4, -0.6, s.L / 2 + 22);
          l.target = this.headTargets[i];
        }
        l.intensity = 260;
      } else l.intensity = 0;
    }
    if (!this.headL.parent) { this.scene.add(this.headL); this.scene.add(this.headR); }
  }

  // debug/automation hooks: step the simulation and render deterministically
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { this.input.pollPad?.(); this.update(dt); this.input.endFrame(); } }
  renderOnce() { this.reflection.update(this.camera); this.renderer.shadowMap.needsUpdate = true; this.composer.render(); }

  loop(now) {
    if (this.manual) return;
    requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.1);
    this.realTime += dt;
    this.input.pollPad();
    if (!this.menuOpen) this.update(dt);
    else { this.sky.update(0, this.camera, this.weather, this.player.pos, this.time); }
    this.input.endFrame();
    this.reflection.update(this.camera);
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
    // dynamic resolution safety net
    this.perfAcc = (this.perfAcc || 0) + dt; this.perfN = (this.perfN || 0) + 1;
    if (this.perfAcc > 4) {
      const fps = this.perfN / this.perfAcc;
      const ds = this.dynScale || 1;
      if (fps < 28 && ds > 0.6) { this.dynScale = ds - 0.1; this.onResize(); }
      else if (fps > 55 && ds < 1) { this.dynScale = Math.min(1, ds + 0.05); this.onResize(); }
      this.perfAcc = 0; this.perfN = 0;
    }
  }
}

const game = new Game();
window.__game = game;
window.__STATE = STATE;
window.__U = U;
window.__THREE = THREE;
game.sky = null;
game.init().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'Failed to start: ' + (e && e.message ? e.message : e);
});
