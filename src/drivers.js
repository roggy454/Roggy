// Drivers and steering wheels.
// - Every car gets a steering wheel (one instanced mesh) that turns with the front wheels.
// - The player sits in their car; a pool of NPC drivers is handed to the nearest traffic cars.
// - Drivers sit in the seat, and two-bone IK keeps both hands on the rim as it turns.
import * as THREE from 'three';
import { createHuman, HumanAnimator, randomAppearance } from './human.js';
import { buildSteeringWheelGeometry } from './carModel.js';
import { RNG, clamp } from './utils.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const _m = new THREE.Matrix4(), _basis = new THREE.Matrix4(), _rot = new THREE.Matrix4(), _wm = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _d = new THREE.Vector3();
const _pole = new THREE.Vector3(), _tmp = new THREE.Vector3(), _grip = new THREE.Vector3();

// Visual steering-wheel angle from the road-wheel angle (positive = turning left).
const wheelAngleOf = (vis) => clamp((vis.wheelSteer || 0) * 6.5, -3.2, 3.2);

function wheelLocalMatrix(cab, angle, out) {
  const w = cab.wheel, t = w.tilt;
  // columns: rim right (car -X), rim up (tilted towards the dash), normal (towards the driver)
  _basis.makeBasis(_tmp.set(-1, 0, 0), _d.set(0, Math.cos(t), Math.sin(t)), _pole.set(0, Math.sin(t), -Math.cos(t)));
  _basis.setPosition(w.x, w.y, w.z);
  _rot.makeRotationZ(angle);
  return out.multiplyMatrices(_basis, _rot);
}

export class DriverSystem {
  constructor(scene, poolSize, maxCars) {
    this.scene = scene;
    const rng = new RNG(4711);
    this.pool = [];
    for (let i = 0; i < poolSize; i++) {
      const look = randomAppearance(rng);
      if (look.hairStyle === 'cap') look.hairStyle = 'short';
      const h = createHuman(look, 8);
      h.group.visible = false;
      scene.add(h.group);
      this.pool.push({ h, anim: new HumanAnimator(h), car: null });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    this.wheels = new THREE.InstancedMesh(buildSteeringWheelGeometry(), mat, maxCars);
    this.wheels.frustumCulled = false;
    this.wheels.castShadow = false; this.wheels.receiveShadow = true;
    this.wheels.count = 0;
    scene.add(this.wheels);
    this.maxCars = maxCars;
  }

  // cars: [{ visual, driver: bool, dist }]; player: { h, anim, visual } or null
  update(dt, cars, player, cockpit) {
    // steering wheels
    let n = 0;
    for (const c of cars) {
      if (c.dist > 140 || n >= this.maxCars || !c.visual.group.visible) continue;
      const cab = c.visual.model.cabin;
      wheelLocalMatrix(cab, wheelAngleOf(c.visual), _m);
      _wm.multiplyMatrices(c.visual.group.matrixWorld, _m);
      this.wheels.setMatrixAt(n++, _wm);
    }
    this.wheels.count = n;
    this.wheels.instanceMatrix.needsUpdate = true;

    // NPC drivers for the nearest occupied cars
    const want = cars.filter((c) => c.driver && c.dist < 80 && c.visual.group.visible).sort((a, b) => a.dist - b.dist).slice(0, this.pool.length);
    const wanted = new Set(want.map((c) => c.visual));
    for (const p of this.pool) {
      if (p.car && !wanted.has(p.car)) this.release(p);
    }
    for (const c of want) {
      if (this.pool.some((p) => p.car === c.visual)) continue;
      const free = this.pool.find((p) => !p.car);
      if (!free) break;
      free.car = c.visual;
      free.anim.sitW = 1;
      c.visual.group.add(free.h.group);
    }
    for (const p of this.pool) if (p.car) this.seat(p.h, p.anim, p.car, dt, false);
    if (player) this.seat(player.h, player.anim, player.visual, dt, cockpit);
  }

  release(p) {
    if (p.car) this.scene.add(p.h.group);
    p.car = null;
    p.h.group.visible = false;
  }

  // Put a person in the driver's seat of a car and drive the steering animation.
  seat(h, anim, vis, dt, hideHead) {
    const cab = vis.model.cabin;
    if (h.group.parent !== vis.group) vis.group.add(h.group);
    const s = Math.min(h.height / 1.8, cab.maxScale);
    h.mesh.scale.setScalar(s);
    // hips sit 0.56 model units above the root when the sitting pose is fully on
    h.group.position.set(cab.driverX, cab.seatH + 0.085 - 0.56 * s, cab.hipZ);
    h.group.rotation.set(0, 0, 0);
    h.group.visible = true;
    anim.sitW = 1;
    anim.update(dt, 0, { sit: true });
    const B = h.bones;
    B.spine.rotation.x -= 0.1; // lean back into the seat
    B.head.rotation.y *= 0.35; B.head.rotation.x = 0.06;
    const ang = wheelAngleOf(vis);
    B.head.rotation.y += clamp(ang * 0.05, -0.15, 0.15); // look into the turn
    B.head.scale.setScalar(hideHead ? 0.01 : 1);
    // hands on the rim at ten-to-two; they follow the rim up to a quarter turn, then slide
    vis.group.updateMatrixWorld(true);
    const handAng = clamp(ang, -1.3, 1.3);
    wheelLocalMatrix(cab, handAng, _m);
    _wm.multiplyMatrices(vis.group.matrixWorld, _m);
    const r = cab.wheel.r;
    _q.setFromRotationMatrix(vis.group.matrixWorld);
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1; // the driver's left hand is on the rim's -X side
      _grip.set(sx * Math.sin(Math.PI / 3) * r, Math.cos(Math.PI / 3) * r, 0.01).applyMatrix4(_wm);
      // elbows point down and out
      _pole.set(side === 'L' ? 0.7 : -0.7, -1, -0.25).applyQuaternion(_q);
      this.solveArm(h, side, _grip, _pole, s);
    }
  }

  // Analytic two-bone IK in world space for one arm.
  solveArm(h, side, target, pole, s) {
    const ua = h.bones['upperArm' + side], fa = h.bones['foreArm' + side], hand = h.bones['hand' + side];
    ua.getWorldPosition(_S);
    const a = 0.29 * s, b = (0.255 + 0.075) * s;
    _d.copy(target).sub(_S);
    let dist = _d.length();
    _d.normalize();
    dist = clamp(dist, Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const x = (a * a - b * b + dist * dist) / (2 * dist);
    const hh = Math.sqrt(Math.max(0, a * a - x * x));
    _pole.addScaledVector(_d, -_pole.dot(_d)).normalize();
    _E.copy(_S).addScaledVector(_d, x).addScaledVector(_pole, hh);
    _T.copy(_S).addScaledVector(_d, dist);
    this.aimBone(ua, _tmp.copy(_E).sub(_S).normalize());
    this.aimBone(fa, _tmp.copy(_T).sub(_E).normalize());
    hand.quaternion.identity();
    hand.rotation.z = side === 'L' ? 0.25 : -0.25;
  }

  // Rotate a bone so its child direction (local -Y) points along a world direction.
  aimBone(bone, worldDir) {
    bone.parent.getWorldQuaternion(_q2).invert();
    worldDir.applyQuaternion(_q2);
    bone.quaternion.setFromUnitVectors(DOWN, worldDir);
  }
}
