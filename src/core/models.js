// Loading real 3D models (.glb / .gltf): cars become drivable vehicles, rigged
// humans replace the player model (animated by the procedural animator through
// skeleton retargeting). Supports Draco / Meshopt compressed files.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CAR_TYPES } from '../vehicles/carModel.js';

let loader = null;
function getLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function parseGLB(data, path = '') {
  return new Promise((resolve, reject) => getLoader().parse(data, path, resolve, reject));
}
export function loadGLB(url) {
  return new Promise((resolve, reject) => getLoader().load(url, resolve, undefined, reject));
}

export function isCharacter(gltf) {
  let bones = 0, skinned = false;
  gltf.scene.traverse((o) => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned = true; });
  return skinned && bones >= 10;
}

// ------------------------------------------------------------------ cars
const WHEEL_RE = /(wheel|tire|tyre|rim|felge|rueda|roue)/i;
const NOT_WHEEL_RE = /(steer|spare|interior|cockpit|dash)/i;

// Fit an arbitrary car model: length along +z, wheels on the ground, metres.
export function fitCarModel(scene, { flip = false } = {}) {
  const root = new THREE.Group();
  root.add(scene);
  scene.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(scene);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z * 1.15) { scene.rotation.y = Math.PI / 2; }
  if (flip) scene.rotation.y += Math.PI;
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);
  size = box.getSize(new THREE.Vector3());
  const len = size.z;
  const scale = len > 2.8 && len < 8 ? 1 : 4.7 / Math.max(1e-3, len);
  scene.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.x -= c.x; scene.position.z -= c.z; scene.position.y -= box.min.y;
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);
  size = box.getSize(new THREE.Vector3());
  // wheels: named meshes clustered into the four corners
  const corners = { FL: [], FR: [], RL: [], RR: [] };
  scene.traverse((o) => {
    if (!o.isMesh || !WHEEL_RE.test(o.name + ' ' + (o.parent?.name || '')) || NOT_WHEEL_RE.test(o.name)) return;
    const b = new THREE.Box3().setFromObject(o), cc = b.getCenter(new THREE.Vector3());
    if (cc.y > size.y * 0.55) return;
    const key = (cc.z > 0 ? 'F' : 'R') + (cc.x > 0 ? 'L' : 'R');
    corners[key].push(o);
  });
  const wheels = [];
  const found = Object.values(corners).every((l) => l.length);
  if (found) {
    for (const [key, list] of Object.entries(corners)) {
      const b = new THREE.Box3();
      for (const o of list) b.union(new THREE.Box3().setFromObject(o));
      const cc = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
      const pivot = new THREE.Group(); pivot.position.copy(cc);
      const spin = new THREE.Group(); pivot.add(spin);
      root.add(pivot);
      for (const o of list) spin.attach(o); // keeps world transform
      wheels.push({ pivot, spin, side: key[1] === 'L' ? 1 : -1, front: key[0] === 'F', z: cc.z, x: cc.x, r: Math.max(sz.y, sz.z) / 2 });
    }
  }
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && 'envMapIntensity' in m) m.envMapIntensity = 1.2;
  });
  return { root, size, wheels };
}

// physics spec derived from the model's real dimensions
export function specForModel(size, wheels, name) {
  const h = size.y, L = size.z, W = size.x;
  const baseKey = h < 1.3 ? (L > 4.4 ? 'supercar' : 'coupe') : h > 1.7 ? (L > 5.3 ? 'truck' : 'suv') : 'sedan';
  const base = CAR_TYPES[baseKey];
  const s = { ...base, model: name || 'Imported', brand: '', imported: true, bed: null };
  const kL = L / base.L;
  for (const k of ['zWsBase', 'zWsTop', 'zRoofRear', 'zRwBase']) s[k] = base[k] * kL;
  s.L = L; s.W = W; s.roofY = h; s.beltY = h * 0.62; s.noseY = h * 0.45; s.tailY = h * 0.55;
  if (wheels.length === 4) {
    const f = wheels.filter((w) => w.front), r = wheels.filter((w) => !w.front);
    const zf = (f[0].z + f[1].z) / 2, zr = (r[0].z + r[1].z) / 2;
    s.wb = zf - zr; s.axleShift = (zf + zr) / 2;
    s.track = Math.abs(f[0].x - f[1].x);
    s.wheelR = wheels.reduce((a, w) => a + w.r, 0) / 4;
  } else {
    s.wb = L * 0.6; s.axleShift = 0; s.track = W * 0.86; s.wheelR = Math.max(0.3, h * 0.24);
  }
  s.yBottom = Math.max(0.1, s.wheelR * 0.45);
  return s;
}

// ------------------------------------------------------------------ characters
export function fitCharacterModel(scene, height = 1.8, { flip = false } = {}) {
  const root = new THREE.Group();
  root.add(scene);
  if (flip) scene.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  scene.scale.multiplyScalar(height / Math.max(1e-3, size.y));
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  scene.position.x -= c.x; scene.position.z -= c.z; scene.position.y -= box.min.y;
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  root.updateMatrixWorld(true);
  return root;
}
