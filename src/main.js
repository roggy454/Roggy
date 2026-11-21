// Roggy City — bootstraps the renderer and world, runs the game loop, camera, driving,
// carjacking, lighting, audio and HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY, CITY_EDGE, CURB_H } from './config.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, RNG } from './utils.js';
import { buildMaterials, globalUniforms } from './materials.js';
import { Terrain, onRoad } from './terrain.js';
import { City } from './city.js';
import { SkySystem } from './sky.js';
import { Grass } from './grass.js';
import { Trees } from './trees.js';
import { CarVisual, WheelRenderer, PAINTS, CAR_TYPES } from './carModel.js';
import { Vehicle, SkidMarks, TireSmoke, obbVsObb } from './vehicle.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Player } from './player.js';
import { DriverSystem } from './drivers.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { AudioSystem } from './audio.js';

const $ = (id) => document.getElementById(id);
const pause = () => new Promise((r) => setTimeout(r, 0));
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

const CONTROLS = {
  foot: [['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['F', 'Enter / steal a car'], ['Mouse', 'Look around'], ['Wheel', 'Zoom']],
  car: [['W / S', 'Throttle / brake & reverse'], ['A / D', 'Steer'], ['Space', 'Handbrake'], ['H', 'Horn'], ['Q / E or wheel', 'Radio station'], ['F', 'Get out'], ['V', 'Camera: chase, far, cockpit'], ['L', 'Headlights'], ['R', 'Flip car upright']],
  world: [['T (hold)', 'Fast-forward time'], ['M', 'Mute'], ['Tab (hold)', 'Show controls'], ['Esc', 'Pause menu']],
};
function renderKeys(el) {
  const sec = (title, rows) => `<h3>${title}</h3>` + rows.map(([k, d]) => `<div><kbd>${k}</kbd> ${d}</div>`).join('');
  el.innerHTML = isTouch
    ? '<h3>Touch controls</h3><div>Left side: drag to move / steer &amp; drive</div><div>Right side: drag to look</div><div><b>ENTER</b> get in or out of cars</div><div><b>JUMP</b> jump / handbrake</div><div><b>RADIO</b> next station · <b>HORN</b> · <b>CAM</b> view</div>'
    : sec('On foot', CONTROLS.foot) + sec('Driving', CONTROLS.car) + sec('World', CONTROLS.world);
}

function readQuality() {
  let q = null;
  try { q = localStorage.getItem('roggy.quality'); } catch (e) { /* storage unavailable */ }
  if (!q || !QUALITY[q]) q = isTouch ? 'low' : 'medium';
  return q;
}
function saveQuality(q) { try { localStorage.setItem('roggy.quality', q); } catch (e) { /* ignore */ } }

class Game {
  async init(restore = {}) {
    this.qName = readQuality();
    this.Q = QUALITY[this.qName];
    const Q = this.Q;
    const setLoad = async (f, text) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; $('load-text').textContent = text; await pause(); };

    await setLoad(0.03, 'Starting renderer…');
    const canvas = $('game');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.bloom, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = Q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.25, 6000);
    this.camera = camera;

    await setLoad(0.08, 'Painting asphalt, brick and glass…');
    const { tex, mats } = buildMaterials(this.qName, renderer.capabilities.getMaxAnisotropy());
    this.tex = tex; this.mats = mats;

    await setLoad(0.35, 'Raising hills and digging lakes…');
    const terrain = new Terrain(this.qName);
    this.terrain = terrain;
    scene.add(terrain.buildMesh(tex));
    scene.add(terrain.buildWater(tex.water));

    await setLoad(0.5, 'Laying roads and building the skyline…');
    const city = new City(tex, Q);
    this.city = city;
    scene.add(city.build(mats));

    await setLoad(0.62, 'Lighting the sky…');
    this.sky = new SkySystem(renderer, scene, Q);
    if (typeof restore.time === 'number') this.sky.time = restore.time;

    await setLoad(0.68, 'Growing grass and trees…');
    this.grass = new Grass(scene, terrain, city.parks, Q.grass);
    this.trees = new Trees(scene, terrain, city, tex, Q.trees, city.col);

    await setLoad(0.78, 'Fuelling the traffic…');
    this.world = {
      terrain, collision: city.col,
      surfaceAt: (x, z) => {
        if (Math.abs(x) < CITY_EDGE && Math.abs(z) < CITY_EDGE) {
          if (onRoad(x, z)) return 'asphalt';
          for (const p of city.parks) if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return 'grass';
          return 'sidewalk';
        }
        return 'grass';
      },
    };
    this.wheels = new WheelRenderer(scene, Q.cars + 50);
    this.drivers = new DriverSystem(scene, Q.drivers, Q.cars + 90);
    mats.plate = new THREE.MeshStandardMaterial({ map: tex.plates, roughness: 0.45, metalness: 0.1, emissiveMap: tex.plates, emissive: 0xffffff, emissiveIntensity: 0 });
    mats.beam = new THREE.MeshBasicMaterial({ map: tex.pool, color: 0xfff1d6, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.traffic = new Traffic(scene, city, terrain, this.wheels, mats, Q);
    this.skids = new SkidMarks(scene);
    this.smoke = new TireSmoke(scene);

    await setLoad(0.86, 'Waking up the pedestrians…');
    this.peds = new Pedestrians(scene, city, terrain, Q);
    this.player = new Player(scene, terrain, city.col);

    // vehicles with physics: parked cars + the ones you drive
    this.vehicles = [];
    const rng = new RNG(555);
    const startBlock = city.blocks.find((b) => b.bi === 2 && b.bj === 5);
    const I = startBlock.inner;
    const startSpot = city.parkingSpots.filter((s) => s.blk === startBlock).reduce((best, s) => (Math.abs(s.x + 150.5) + Math.abs(s.z - (I.minZ + 6)) < Math.abs(best.x + 150.5) + Math.abs(best.z - (I.minZ + 6)) ? s : best));
    for (const s of city.parkingSpots) {
      if (s === startSpot) continue;
      if (rng.next() > 0.2) continue;
      const types = ['sedan', 'hatch', 'suv', 'pickup', 'van', 'sports', 'sedan', 'hatch', 'suv'];
      this.spawnParked(types[rng.int(0, types.length - 1)], PAINTS[rng.int(0, PAINTS.length - 1)], s.x, s.z, s.yaw + rng.float(-0.04, 0.04));
    }
    this.startCar = this.spawnParked('sports', 0xb01818, startSpot.x, startSpot.z, startSpot.yaw);
    this.player.place(startSpot.x + 0.6, startSpot.z + 3.7, Math.PI);

    // lights near the player at night (fixed count, so shaders never recompile)
    this.lampLights = [];
    for (let i = 0; i < Q.pointLights; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 30, 1.6);
      scene.add(l); this.lampLights.push(l);
    }
    this.headlight = new THREE.SpotLight(0xfff1dd, 0, 70, 0.55, 0.45, 1.3);
    this.headlight.position.set(0, 0.8, 2.2);
    this.headlight.target.position.set(0, 0, 18);
    scene.add(this.headlight); scene.add(this.headlight.target);

    // what the reflection probe sees: sky, terrain, water, roads, sidewalks, buildings, street furniture
    const reflect = (o) => o.traverse((c) => c.layers.enable(1));
    reflect(city.group);
    scene.children.filter((c) => c.name === 'terrain' || c.name === 'water').forEach(reflect);
    if (this.qName === 'high') reflect(this.trees.group);
    for (const l of this.lampLights) l.layers.enable(1);

    await setLoad(0.92, 'Spawning traffic…');
    this.traffic.populate(this.player.pos, true);
    this.peds.populate(this.player.pos, true);

    // post-processing
    if (Q.bloom) {
      const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
      const composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.addPass(new RenderPass(scene, camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.35, 0.55, 0.92);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    }

    // HUD / input / audio
    this.hud = new HUD(city, terrain);
    this.input = new Input(canvas, $('touch'));
    this.input.wantLock = !isTouch;
    this.input.lockAllowed = () => this.started && !this.paused;
    this.audio = new AudioSystem();
    this.peds.onHit = (p, sp) => { this.audio.thud(clamp(sp / 20, 0.1, 1)); };
    this.player.onStep = (s) => this.audio.footstep(this.world.surfaceAt(this.player.pos.x, this.player.pos.z), s > 5 ? 1.3 : 1);
    this.player.onKnocked = (s) => { this.audio.thud(clamp(s / 15, 0.2, 1)); this.shake = 0.5; };
    this.player.onLand = () => this.audio.footstep('asphalt', 1.6);

    this.mode = 'foot';
    this.current = null;
    this.cam = { yaw: Math.PI, pitch: 0.2, dist: 4.2, idle: 0, mode: 0, footZoom: 4.2 };
    this.camTarget = new THREE.Vector3().copy(this.player.pos).add(new THREE.Vector3(0, 1.6, 0));
    this.shake = 0;
    this.paused = true;
    this.started = false;
    this.fps = 60; this.lowFpsT = 0;
    this.lampTimer = 0;
    this.carFootprints = [];

    addEventListener('resize', () => this.resize());
    this.setupUI();
    renderKeys($('keys-start')); renderKeys($('keys-pause')); renderKeys($('keys-tab'));
    await setLoad(1, 'Ready');

    // warm up shaders with one frame
    this.updateCamera(0.016);
    this.sky.update(0, this.player.pos, this.camera);
    this.sky.updateProbe(0, this.player.pos, true);
    this.render();
    $('loading').hidden = true;
    $('start').hidden = false;
    this.last = performance.now();
    this.loopBound = (t) => this.loop(t);
    requestAnimationFrame(this.loopBound);
  }

  spawnParked(type, paint, x, z, yaw) {
    const vis = new CarVisual(type, type === 'taxi' ? 0xf0b81c : paint, this.mats.plate, this.mats.beam);
    this.scene.add(vis.group);
    const v = new Vehicle(vis, type, this.world);
    v.place(x, z, yaw);
    v.onShift = () => { if (v === this.current) this.audio.shift(); };
    v.onDrowned = () => { if (v === this.current) this.rescueFromWater(); };
    this.vehicles.push(v);
    return v;
  }

  setupUI() {
    const sel = $('quality-sel'), sel2 = $('quality-sel2');
    sel.value = this.qName; sel2.value = this.qName;
    $('quality-note').textContent = isTouch ? 'Low is best on phones' : '';
    const change = (v) => { saveQuality(v); location.reload(); };
    sel.addEventListener('change', () => change(sel.value));
    sel2.addEventListener('change', () => change(sel2.value));
    $('play-btn').addEventListener('click', () => this.start());
    $('resume-btn').addEventListener('click', () => this.resume());
    for (const k of ['master', 'radio', 'sfx']) {
      $(`vol-${k}`).addEventListener('input', (e) => this.audio.setVolume(k, parseFloat(e.target.value)));
    }
    $('sens').addEventListener('input', (e) => { this.input.sensitivity = parseFloat(e.target.value); });
    $('dj-voice').addEventListener('change', (e) => { if (this.audio.radio) { this.audio.radio.voice = e.target.checked; if (!e.target.checked) this.audio.radio.stopSpeech(); } });
    this.input.onLockChange = (locked) => { if (!locked && this.started && !this.paused && !isTouch) this.pauseGame(); };
  }

  start() {
    this.audio.init();
    this.audio.resume();
    if (this.audio.radio) this.audio.radio.onChange((st, song) => { if (this.mode === 'car') this.hud.showRadio(st, song); });
    $('start').hidden = true;
    $('hud').hidden = false;
    document.body.classList.add('playing');
    this.started = true; this.paused = false;
    if (!isTouch) this.input.requestLock();
    this.hud.toast('Find a car. Press F to get in.', 4);
    if (isTouch) this.hud.toast('Tap ENTER near a car', 4);
  }
  pauseGame() {
    this.paused = true;
    $('pause').hidden = false;
    if (this.audio.ready) this.audio.ctx.suspend();
  }
  resume() {
    $('pause').hidden = true;
    this.paused = false;
    if (this.audio.ready) this.audio.resume();
    if (!isTouch) this.input.requestLock();
    this.last = performance.now();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setSize(w, h); this.bloom.setSize(w / 2, h / 2); }
  }

  render() {
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  // ---------- main loop ----------
  loop(now) {
    requestAnimationFrame(this.loopBound);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-3), 0.05);
    if (!this.started || this.paused) {
      // idle camera drift behind the title screen
      if (!this.started) {
        this.cam.yaw += dt * 0.05;
        this.sky.update(dt * 0.3, this.player.pos, this.camera);
        this.updateCamera(dt);
        this.grass.update(this.camera.position);
        globalUniforms.uTime.value += dt;
        this.render();
      }
      return;
    }
    this.step(dt);
    this.render();
    this.autoQuality(dt);
  }

  autoQuality(dt) {
    if (this.fps < 26) this.lowFpsT += dt; else this.lowFpsT = Math.max(0, this.lowFpsT - dt);
    if (this.lowFpsT > 5) {
      this.lowFpsT = 0;
      const pr = this.renderer.getPixelRatio();
      if (pr > 0.55) {
        this.renderer.setPixelRatio(pr * 0.85);
        if (this.composer) this.composer.setPixelRatio(pr * 0.85);
        this.resize();
      }
    }
  }

  step(dt) {
    const input = this.input;
    input.beginFrame();
    // ---- global keys ----
    if (input.tap('Escape')) { this.pauseGame(); input.endFrame(); return; }
    if (input.touch.tapped.has('menu')) { this.pauseGame(); input.endFrame(); return; }
    $('keys-overlay').hidden = !input.down('Tab');
    if (input.tap('KeyM')) { this.audio.setMuted(!this.audio.muted); this.hud.toast(this.audio.muted ? 'Sound off' : 'Sound on', 1.2); }
    this.sky.fast = input.down('KeyT');
    if (input.tap('KeyV') || input.touch.tapped.has('cam')) {
      this.cam.mode = (this.cam.mode + 1) % (this.mode === 'car' ? 3 : 2);
    }

    globalUniforms.uTime.value += dt;
    this.wheels.begin();

    // ---- player / vehicle control ----
    const focus = this.mode === 'car' ? this.current.pos : this.player.pos;
    if (this.mode === 'foot') this.stepFoot(dt);
    else this.stepCar(dt);
    this.stepPhysics(dt);

    // ---- AI ----
    const obstacles = [];
    for (const v of this.vehicles) {
      if (v.pos.distanceToSquared(focus) > 160 * 160) continue;
      const f = v.forward(new THREE.Vector3());
      obstacles.push({ x: v.pos.x, z: v.pos.z, vx: v.vel.x, vz: v.vel.z, r: v.T.W / 2, half: v.T.L / 2, kind: v === this.current ? 'playerCar' : 'car', static: v !== this.current && v.speed < 0.5, fx: f.x, fz: f.z });
    }
    if (this.mode === 'foot') obstacles.push({ x: this.player.pos.x, z: this.player.pos.z, vx: this.player.vel.x, vz: this.player.vel.z, r: 0.45, half: 0.3, kind: 'player' });
    const pedObs = this.peds.obstacles([]);
    this.traffic.update(dt, { focus, obstacles, peds: pedObs, night: this.sky.night, camera: this.camera, collision: this.city.col });
    for (const ev of this.traffic.events) {
      if (ev.type === 'honk') {
        const dx = ev.x - this.camera.position.x, dz = ev.z - this.camera.position.z;
        if (ev.delay) setTimeout(() => this.audio.honkAt(dx, dz, this.cam.yaw, Math.hypot(dx, dz)), ev.delay * 1000);
        else this.audio.honkAt(dx, dz, this.cam.yaw, Math.hypot(dx, dz));
      }
    }
    this.traffic.events.length = 0;
    // cars that can knock pedestrians down
    const dangerCars = [];
    for (const v of this.vehicles) {
      if (v.speed < 2 || v.pos.distanceToSquared(focus) > 120 * 120) continue;
      const fp = v.footprint();
      dangerCars.push({ x: fp.cx, z: fp.cz, y: v.pos.y - v.comH, vx: v.vel.x, vz: v.vel.z, fx: fp.fx, fz: fp.fz, hw: fp.hw, hl: fp.hl, player: v === this.current });
    }
    for (const a of this.traffic.agents) if (a.state === 'physics' && a.v > 2) dangerCars.push({ x: a.x, z: a.z, y: 0, vx: a.phys.vx, vz: a.phys.vz, fx: a.dx, fz: a.dz, hw: a.halfW, hl: a.halfL });
    this.peds.update(dt, { focus, cars: dangerCars, camera: this.camera, collision: this.city.col });
    if (this.mode === 'foot') this.peds.separateFrom(this.player.pos.x, this.player.pos.z, this.player.radius);

    // ---- visuals ----
    for (const v of this.vehicles) {
      const d2 = v.pos.distanceToSquared(this.camera.position);
      v.visual.group.visible = d2 < 380 * 380;
      if (!v.sleeping || v === this.current) v.syncVisual(dt);
      if (d2 < 200 * 200) { v.visual.group.updateMatrixWorld(true); v.visual.pushWheels(this.wheels, v.visual.group.matrixWorld); }
    }
    this.wheels.end();
    // drivers + steering wheels (after every car's matrix is current)
    const cars = this._carList || (this._carList = []);
    cars.length = 0;
    const cpos = this.camera.position;
    for (const a of this.traffic.agents) cars.push({ visual: a.visual, driver: a.state !== 'abandoned', dist: Math.hypot(a.x - cpos.x, a.z - cpos.z) });
    for (const v of this.vehicles) cars.push({ visual: v.visual, driver: false, dist: Math.hypot(v.pos.x - cpos.x, v.pos.z - cpos.z) });
    const seated = this.mode === 'car' ? { h: this.player.h, anim: this.player.anim, visual: this.current.visual } : null;
    this.drivers.update(dt, cars, seated, this.mode === 'car' && this.cam.mode === 2);
    this.city.updateSignals(this.traffic.time);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.sky.update(dt, focus, this.camera);
    this.updateLights(dt);
    this.sky.updateProbe(dt, focus);
    this.grass.update(this.camera.position);
    this.terrain.waterNormal.offset.set(globalUniforms.uTime.value * 0.004, globalUniforms.uTime.value * 0.0025);

    // ---- audio + HUD ----
    const car = this.current;
    let traffic = 0;
    for (const a of this.traffic.agents) {
      const d = Math.hypot(a.x - focus.x, a.z - focus.z);
      if (d < 60) traffic += (a.v / 14) * (1 - d / 60);
    }
    this.audio.update({
      inCar: this.mode === 'car', rpm: car ? car.rpm : 0, throttle: car ? car.throttle : 0,
      speed: car ? car.speed : this.player.speed, skid: car ? car.skidAmount : 0, night: this.sky.night > 0.5,
      traffic: traffic * 0.4, cylinders: car ? (car.type === 'sports' ? 8 : car.type === 'pickup' || car.type === 'suv' ? 6 : 4) : 4,
      offroad: car ? car.wheels.some((w) => w.contact && w.surface === 'grass') : false,
    });
    this.audio.horn(this.mode === 'car' && input.horn);
    this.updateHUD(dt);
    input.endFrame();
  }

  stepFoot(dt) {
    const input = this.input;
    if (input.wheelStep) this.cam.footZoom = clamp(this.cam.footZoom + input.wheelStep * 0.5, 2.2, 9);
    this.player.update(dt, input, this.cam.yaw, { carFootprints: this.buildFootprints() });
    // nearby enterable car?
    const cand = this.findEnterable();
    if (cand) {
      const label = cand.agent ? `steal the ${cand.agent.type}` : 'get in';
      this.hud.setPrompt(isTouch ? `Tap <b>ENTER</b> to ${label}` : `Press <kbd>F</kbd> to ${label}`);
      if (input.enterPressed) this.enter(cand);
    } else this.hud.setPrompt('');
  }

  buildFootprints() {
    const out = this.carFootprints; out.length = 0;
    const p = this.player.pos;
    for (const v of this.vehicles) {
      if (Math.abs(v.pos.x - p.x) > 8 || Math.abs(v.pos.z - p.z) > 8) continue;
      const fp = v.footprint();
      fp.y = v.pos.y - v.comH; fp.top = v.T.gh.roof; fp.vx = v.vel.x; fp.vz = v.vel.z; fp.speed = v.speed;
      out.push(fp);
    }
    for (const a of this.traffic.agents) {
      if (Math.abs(a.x - p.x) > 8 || Math.abs(a.z - p.z) > 8) continue;
      const fp = this.traffic.footprint(a);
      const vx = a.state === 'physics' ? a.phys.vx : a.dx * a.v, vz = a.state === 'physics' ? a.phys.vz : a.dz * a.v;
      fp.y = 0; fp.top = a.T.gh.roof; fp.vx = vx; fp.vz = vz; fp.speed = Math.hypot(vx, vz);
      out.push(fp);
    }
    return out;
  }

  findEnterable() {
    const p = this.player.pos;
    let best = null, bd = 1e9;
    // distance from the player to the closest point of a car's footprint
    const distTo = (fp) => {
      const dx = p.x - fp.cx, dz = p.z - fp.cz;
      const lf = dx * fp.fx + dz * fp.fz, lr = dx * -fp.fz + dz * fp.fx;
      const ef = Math.max(0, Math.abs(lf) - fp.hl), er = Math.max(0, Math.abs(lr) - fp.hw);
      return Math.hypot(ef, er);
    };
    for (const v of this.vehicles) {
      if (Math.abs(v.pos.x - p.x) > 9 || Math.abs(v.pos.z - p.z) > 9) continue;
      const d = distTo(v.footprint());
      if (d < 1.8 && d < bd && v.speed < 6) { bd = d; best = { vehicle: v }; }
    }
    for (const a of this.traffic.agents) {
      if (Math.abs(a.x - p.x) > 9 || Math.abs(a.z - p.z) > 9) continue;
      const d = distTo(this.traffic.footprint(a));
      if (d < 1.8 && d < bd && a.v < 7) { bd = d; best = { agent: a }; }
    }
    return best;
  }

  enter(cand) {
    let v = cand.vehicle;
    if (cand.agent) {
      const a = cand.agent;
      this.traffic.remove(a);
      v = new Vehicle(a.visual, a.type, this.world);
      v.place(a.x, a.z, a.yaw);
      v.onShift = () => { if (v === this.current) this.audio.shift(); };
      v.onDrowned = () => { if (v === this.current) this.rescueFromWater(); };
      this.vehicles.push(v);
      // the driver bails out of the driver's door and runs
      const f = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
      const left = new THREE.Vector3(f.z, 0, -f.x); // car's left
      const dx = a.x + left.x * (a.halfW + 0.6), dz = a.z + left.z * (a.halfW + 0.6);
      this.peds.spawnFleeing(dx, dz, left.x * 0.7 - f.x * 0.7, left.z * 0.7 - f.z * 0.7);
      this.hud.toast(`${a.type.toUpperCase()} STOLEN`, 2.2);
    }
    this.current = v;
    v.driven = true; v.wake();
    v.vel.multiplyScalar(0.2);
    this.player.anim.sitW = 1; // the player now sits in the driver's seat (see DriverSystem)
    this.mode = 'car';
    this.cam.mode = 0;
    this.cam.yaw = v.yaw;
    this.hud.setPrompt('');
    this.audio.door();
    if (this.audio.radio) { const st = this.audio.radio.station; this.hud.showRadio(st, this.audio.radio.song); }
    this.headlightsManual = null;
  }

  exitCar() {
    const v = this.current;
    if (v.speed > 9) { this.hud.toast('Slow down first', 1.2); return; }
    const f = v.forward(new THREE.Vector3());
    const left = new THREE.Vector3(f.z, 0, -f.x).normalize();
    let side = 1;
    const tryPos = (s) => {
      const x = v.pos.x + left.x * s * (v.T.W / 2 + 0.7), z = v.pos.z + left.z * s * (v.T.W / 2 + 0.7);
      const boxes = this.city.col.queryBoxes(x - 0.4, z - 0.4, x + 0.4, z + 0.4, []);
      return { x, z, ok: boxes.length === 0 };
    };
    let p = tryPos(1);
    if (!p.ok) { p = tryPos(-1); side = -1; }
    // stand the player back up outside the driver's door
    const ph = this.player.h;
    this.scene.add(ph.group);
    ph.mesh.scale.setScalar(ph.height / 1.8);
    ph.bones.head.scale.setScalar(1);
    this.player.anim.sitW = 0;
    this.player.place(p.x + f.x * 0.3, p.z + f.z * 0.3, Math.atan2(left.x * side, left.z * side));
    this.player.setVisible(true);
    v.driven = false;
    v.setInput(0, 0, 0, 0);
    this.mode = 'foot';
    this.current = null;
    this.cam.mode = 0;
    this.headlight.intensity = 0;
    this.audio.door();
    v.visual.lights.set(0, 0, 0, 0); v.visual.ind.set(0, 0, 0);
    this.skids.last.clear();
    // keep the number of loose vehicles bounded
    if (this.vehicles.length > 46) {
      const far = this.vehicles.filter((o) => o !== v && o.pos.distanceTo(v.pos) > 150);
      if (far.length) this.removeVehicle(far[0]);
    }
  }

  removeVehicle(v) {
    this.vehicles.splice(this.vehicles.indexOf(v), 1);
    this.scene.remove(v.visual.group);
    v.visual.dispose();
  }

  rescueFromWater() {
    // tow the car back to the nearest road at the city edge
    const v = this.current;
    const x = clamp(v.pos.x, -395, 395), z = clamp(v.pos.z, -395, 395);
    const sx = Math.abs(x) > Math.abs(z) ? Math.sign(x) * 400 : x, sz = Math.abs(x) > Math.abs(z) ? z : Math.sign(z) * 400;
    v.place(sx, sz, v.yaw);
    this.hud.toast('Towed back to the city', 2.5);
  }

  stepCar(dt) {
    const input = this.input, v = this.current;
    v.setInput(input.throttle, input.brake, input.steer, input.handbrake);
    if (input.tap('KeyR')) { v.resetUpright(); this.hud.toast('Flipped', 1); }
    if (input.tap('KeyL')) { this.headlightsManual = !(this.headlightsManual ?? this.sky.night > 0.3); }
    if (this.audio.radio) {
      if (input.radioNext) { const st = this.audio.radio.next(1); this.hud.showRadio(st, this.audio.radio.song); }
      if (input.radioPrev) { const st = this.audio.radio.next(-1); this.hud.showRadio(st, this.audio.radio.song); }
    }
    if (input.enterPressed) this.exitCar();
    this.hud.setPrompt('');
  }

  stepPhysics(dt) {
    const h = 1 / 120;
    this.acc = (this.acc || 0) + dt;
    let n = 0;
    const awake = this.vehicles.filter((v) => !v.sleeping || v === this.current);
    while (this.acc >= h && n < 7) {
      for (const v of awake) v.step(h);
      if (this.current) this.vehicleContacts(this.current);
      this.acc -= h; n++;
    }
    if (n >= 7) this.acc = 0;
    // impacts -> sound / shake
    for (const v of awake) {
      if (v.impact > 0.6 && v === this.current) {
        this.audio.crash(clamp(v.impact / 9, 0.08, 1));
        this.shake = Math.max(this.shake, clamp(v.impact / 12, 0.05, 0.6));
      }
      v.impact = 0;
    }
  }

  vehicleContacts(v) {
    const A = v.footprint();
    // other physics vehicles
    for (const o of this.vehicles) {
      if (o === v) continue;
      if (Math.abs(o.pos.x - v.pos.x) > 8 || Math.abs(o.pos.z - v.pos.z) > 8) continue;
      const B = o.footprint();
      const hit = obbVsObb(A, B);
      if (!hit) continue;
      const n = _n.set(hit.nx, 0, hit.nz);
      v.pos.x += n.x * hit.depth * 0.5; v.pos.z += n.z * hit.depth * 0.5;
      o.pos.x -= n.x * hit.depth * 0.5; o.pos.z -= n.z * hit.depth * 0.5;
      const cp = _cp.set(hit.px, v.pos.y, hit.pz);
      const rA = _rA.copy(cp).sub(v.pos); rA.y = 0;
      const rB = _rB.copy(cp).sub(o.pos); rB.y = 0;
      const vA = _vA.crossVectors(v.angVel, rA).add(v.vel);
      const vB = _vB.crossVectors(o.angVel, rB).add(o.vel);
      const vn = vA.sub(vB).dot(n);
      if (vn >= 0) continue;
      const j = -(1 + 0.2) * vn / (v.invMassAt(rA, n) + o.invMassAt(rB, n));
      v.applyImpulse(_J.copy(n).multiplyScalar(j), cp);
      o.applyImpulse(_J.copy(n).multiplyScalar(-j), cp);
      v.impact = Math.max(v.impact, j / v.mass);
    }
    // NPC traffic (kinematic until hit)
    for (const a of this.traffic.agents) {
      if (Math.abs(a.x - v.pos.x) > 8 || Math.abs(a.z - v.pos.z) > 8) continue;
      const B = this.traffic.footprint(a);
      const hit = obbVsObb(A, B);
      if (!hit) continue;
      const n = _n.set(hit.nx, 0, hit.nz);
      const mB = a.T.mass, IB = mB * (a.T.L * a.T.L + a.T.W * a.T.W) / 12;
      v.pos.x += n.x * hit.depth * 0.6; v.pos.z += n.z * hit.depth * 0.6;
      if (a.state !== 'drive') { a.x -= n.x * hit.depth * 0.4; a.z -= n.z * hit.depth * 0.4; }
      const cp = _cp.set(hit.px, v.pos.y, hit.pz);
      const rA = _rA.copy(cp).sub(v.pos); rA.y = 0;
      const vA = _vA.crossVectors(v.angVel, rA).add(v.vel);
      const bvx = a.state === 'physics' ? a.phys.vx : a.dx * a.v, bvz = a.state === 'physics' ? a.phys.vz : a.dz * a.v;
      const vn = (vA.x - bvx) * n.x + (vA.z - bvz) * n.z;
      if (vn >= 0) { if (a.state === 'drive') { a.v = 0; } continue; }
      const rbx = hit.px - a.x, rbz = hit.pz - a.z;
      const rxn = rbz * n.x - rbx * n.z;
      const j = -(1 + 0.25) * vn / (v.invMassAt(rA, n) + 1 / mB + rxn * rxn / IB);
      v.applyImpulse(_J.copy(n).multiplyScalar(j), cp);
      // the NPC receives the opposite impulse
      const torque = -j * (rbz * n.x - rbx * n.z);
      this.traffic.hit(a, -n.x * j / mB, -n.z * j / mB, torque / IB);
      v.impact = Math.max(v.impact, j / v.mass);
    }
  }

  updateEffects(dt) {
    const v = this.current;
    if (v) {
      v.wheels.forEach((w, i) => {
        const key = i;
        if (w.contact && w.skid > 0.35 && w.surface !== 'grass') {
          const f = v.forward(_tmp);
          this.skids.add(key, w.cp, f.x, f.z, v.T.tw * 0.9, clamp(w.skid, 0, 1), this.terrain.heightAt(w.cp.x, w.cp.z));
          if (w.skid > 1.1 && v.speed > 2.5 && Math.random() < 0.3) this.smoke.emit(w.cp.x, w.cp.y, w.cp.z, v.vel.x, v.vel.z, w.skid);
        } else this.skids.cut(key);
      });
    }
    this.skids.update();
    this.smoke.update(dt, this.sky.night);
  }

  updateLights(dt) {
    const n = this.sky.night;
    const m = this.mats;
    m.lampHead.emissiveIntensity = n * 3.5;
    m.lightPool.opacity = n * 0.42;
    m.plate.emissiveIntensity = n * 0.35;
    m.beam.opacity = n * 0.3;
    const blink = (globalUniforms.uTime.value % 1.6) < 0.5;
    m.warning.color.setRGB(blink ? 3 : 0.25, blink ? 0.08 : 0.01, blink ? 0.04 : 0.0);
    if (this.bloom) { this.bloom.strength = lerp(0.18, 0.42, n); this.bloom.threshold = lerp(0.95, 0.82, n); }
    // nearest street lamps get real lights
    this.lampTimer -= dt;
    if (this.lampTimer <= 0 && this.lampLights.length) {
      this.lampTimer = 0.4;
      const c = this.camera.position;
      const sorted = this.city.lampPositions
        .map((p) => [p, (p.x - c.x) ** 2 + (p.z - c.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, this.lampLights.length);
      sorted.forEach(([p], i) => this.lampLights[i].position.copy(p));
    }
    for (const l of this.lampLights) l.intensity = n * 60;
    // player car lights
    const v = this.current;
    if (v) {
      const head = this.headlightsManual ?? n > 0.3;
      const reversing = v.gear === -1 && v.forwardSpeed < -0.3;
      v.visual.lights.set(head ? 1 : 0, head || n > 0.3 ? 1 : 0, v.brake > 0.1 && v.gear >= 1 ? 1 : v.gear === -1 && v.throttle < 0.1 && v.brake > 0 ? 1 : 0, reversing ? 1 : 0);
      v.visual.ind.set(0, 0, 1);
      if (v.visual.beam) v.visual.beam.visible = head;
      this.headlight.intensity = head ? 900 : 0;
      const g = v.visual.group;
      this.headlight.position.set(0, 0.75, v.T.L / 2 + 0.1).applyMatrix4(g.matrixWorld);
      this.headlight.target.position.set(0, -0.6, v.T.L / 2 + 22).applyMatrix4(g.matrixWorld);
      this.headlight.target.updateMatrixWorld();
    }
    for (const o of this.vehicles) if (o !== this.current && o.visual.beam) o.visual.beam.visible = false;
  }

  updateCamera(dt) {
    const cam = this.cam, camera = this.camera, input = this.input;
    const look = input ? input.look() : { dx: 0, dy: 0, active: false };
    const inCar = this.mode === 'car';
    cam.yaw -= look.dx * 0.0024;
    cam.pitch = clamp(cam.pitch + look.dy * 0.002, -0.45, 1.25);
    cam.idle = look.active ? 0 : cam.idle + dt;
    const target = _tgt;
    let dist, fov = 60;
    if (inCar) {
      const v = this.current;
      const up = v.up(_up);
      target.copy(v.pos).addScaledVector(up, 0.9);
      target.y += 0.35;
      const speed = v.speed;
      const back = v.forwardSpeed < -4 && cam.idle > 0.5;
      if (cam.idle > 1.1 && speed > 1.5) {
        cam.yaw = dampAngle(cam.yaw, v.yaw + (back ? Math.PI : 0), 3.2, dt);
        cam.pitch = damp(cam.pitch, cam.mode === 1 ? 0.26 : 0.16, 2, dt);
      }
      const base = v.T.L * 1.15 + 1.9 + (v.T.gh.roof - 1.4) * 1.5;
      dist = (cam.mode === 1 ? base * 1.6 : base) + clamp(speed * 0.035, 0, 2.2);
      fov = 58 + clamp((speed - 8) * 0.4, 0, 20);
    } else {
      target.copy(this.player.pos); target.y += 1.62;
      const pf = this.player.speed;
      if (cam.idle > 2.5 && pf > 2) cam.yaw = dampAngle(cam.yaw, this.player.yaw, 0.8, dt);
      dist = cam.mode === 1 ? cam.footZoom * 1.8 : cam.footZoom;
      fov = 60;
    }
    if (!this.started) { target.y += 1.5; dist = 7; }
    // smoothed follow point
    if (!this.camInit) { this.camTarget.copy(target); this.camInit = true; }
    const lam = inCar ? 14 : 20;
    this.camTarget.x = damp(this.camTarget.x, target.x, lam, dt);
    this.camTarget.y = damp(this.camTarget.y, target.y, inCar ? 9 : 14, dt);
    this.camTarget.z = damp(this.camTarget.z, target.z, lam, dt);
    const T = this.camTarget;
    if (inCar && cam.mode === 2) {
      // cockpit view from the driver's eyes: dashboard, gauges, the turning wheel and your hands
      const v = this.current;
      const g = v.visual.group;
      const cab = v.visual.model.cabin;
      const sc = Math.min(this.player.h.height / 1.8, cab.maxScale);
      _tmp.set(cab.driverX, cab.seatH + 0.085 + 0.7 * sc, cab.hipZ + 0.12).applyMatrix4(g.matrixWorld);
      camera.position.copy(_tmp);
      const look = clamp(wrapAngle(cam.yaw - v.yaw), -1.6, 1.6);
      const q = _q.copy(v.quat).multiply(_q2.setFromEuler(_e.set(-0.24 - (cam.pitch - 0.2) * 0.3, Math.PI + look, 0, 'YXZ')));
      camera.quaternion.copy(q);
      fov = 68;
    } else {
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const px = T.x - Math.sin(cam.yaw) * cp * dist, py = T.y + sp * dist, pz = T.z - Math.cos(cam.yaw) * cp * dist;
      // pull in when a building is in the way
      const t = this.city.col.raycastBoxes(T.x, T.z, px, pz, Math.min(T.y, py) + 0.5, _boxes);
      const k = t < 1 ? Math.max(0.1, t - 0.06) : 1;
      camera.position.set(T.x + (px - T.x) * k, T.y + (py - T.y) * k, T.z + (pz - T.z) * k);
      const gy = this.terrain.heightAt(camera.position.x, camera.position.z) + 0.35;
      if (camera.position.y < gy) camera.position.y = gy;
      if (this.shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
        camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
        this.shake *= Math.exp(-6 * dt);
      }
      camera.lookAt(T);
    }
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 4, dt); camera.updateProjectionMatrix(); }
  }

  updateHUD(dt) {
    const v = this.current;
    const focus = v ? v.pos : this.player.pos;
    const cars = [];
    for (const a of this.traffic.agents) if (Math.abs(a.x - focus.x) < 160 && Math.abs(a.z - focus.z) < 160) cars.push(a);
    const maxKmh = v ? (v.type === 'sports' ? 320 : v.type === 'van' ? 180 : 240) : 240;
    this.hud.update(dt, {
      clock: this.sky.clockString(), inCar: !!v,
      kmh: v ? Math.abs(v.forwardSpeed) * 3.6 : 0, rpm: v ? v.rpm : 0, redline: v ? v.E.redline : 7000, gear: v ? v.gear : 1, maxKmh,
      px: focus.x, pz: focus.z, camYaw: this.cam.yaw, heading: v ? v.yaw : this.player.yaw, cars,
      zoom: v ? lerp(1.1, 0.55, clamp(v.speed / 40, 0, 1)) : 1.4, fps: this.fps,
    });
  }
}

const _n = new THREE.Vector3(), _cp = new THREE.Vector3(), _rA = new THREE.Vector3(), _rB = new THREE.Vector3();
const _vA = new THREE.Vector3(), _vB = new THREE.Vector3(), _J = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _tgt = new THREE.Vector3(), _up = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _boxes = [];
void CURB_H; void CAR_TYPES;

const game = new Game();
window.__game = game;
// Keep the time of day when the hosted page hot-reloads.
const hot = window.claude?.hot;
hot?.snapshot?.(() => (game.sky ? { time: game.sky.time } : {}));
const boot = (data) => game.init(data || {}).catch((err) => {
  console.error(err);
  const box = document.createElement('div');
  box.id = 'err';
  box.textContent = `Roggy City could not start: ${err && err.message ? err.message : err}. Try the Low graphics setting or a browser with WebGL 2.`;
  document.body.appendChild(box);
  try { localStorage.setItem('roggy.quality', 'low'); } catch (e) { /* ignore */ }
});
if (hot?.ready) hot.ready(boot); else boot(hot?.data ?? {});
