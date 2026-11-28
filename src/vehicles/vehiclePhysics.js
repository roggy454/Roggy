// Real-time vehicle dynamics on top of cannon-es RaycastVehicle: spring/damper
// suspension per wheel, friction-circle tyres with surface grip, engine torque
// curve, automatic gearbox with shift times, clutch slip at launch, brakes with
// front bias, handbrake drift, aero drag + downforce and a light stability assist.
// Kept free of rendering code so it can be tested headlessly.
import * as CANNON from 'cannon-es';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export const SURFACE_GRIP = { road: 1.0, lot: 1.0, sidewalk: 0.95, grass: 0.58, sand: 0.48, water: 0.3 };

export function physicsSpec(spec) {
  const sporty = !!spec.sporty, heavy = spec.mass > 2000;
  const comY = spec.yBottom + (spec.roofY - spec.yBottom) * (sporty ? 0.26 : 0.3);
  return {
    mass: spec.mass,
    comY,
    restLen: sporty ? 0.26 : heavy ? 0.4 : 0.32,
    stiffness: sporty ? 58 : heavy ? 34 : 40,
    grip: sporty ? 1.25 : heavy ? 1.0 : 1.1,
    cdA: sporty ? 0.62 : heavy ? (spec.cargo ? 1.5 : 1.05) : 0.7,
    downforce: sporty ? 0.55 : 0.08,
    maxSteer: sporty ? 0.55 : 0.6,
    brakeG: sporty ? 1.25 : 1.0,
    roll: sporty ? 0.45 : heavy ? 0.6 : 0.55,
  };
}

export class VehiclePhysics {
  constructor(world, spec, materials) {
    this.world = world;
    this.spec = spec;
    this.P = physicsSpec(spec);
    this.mat = materials;
    this.rpm = 900;
    this.gear = 1;
    this.shiftT = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.handbrake = false;
    this.steerAngle = 0;
    this.speed = 0;
    this.load = 0;
    this.engineOn = true;
    this.surfaces = ['road', 'road', 'road', 'road'];
    this.slip = [0, 0, 0, 0];
    this.wetness = 0;
    this.inWater = 0;
    this.lastShift = 0;
    this.time = 0;
    this.build();
  }

  build() {
    const s = this.spec, P = this.P;
    const body = new CANNON.Body({ mass: P.mass, material: this.mat.car, allowSleep: true, sleepSpeedLimit: 0.05, sleepTimeLimit: 3 });
    body.angularDamping = 0.25;
    body.linearDamping = 0.01;
    // lower hull + cabin, positioned relative to the centre of mass
    const hullBot = s.yBottom + 0.12, hullTop = s.beltY;
    const hw = s.W / 2 * 0.95, hl = s.L / 2 * 0.97;
    body.addShape(new CANNON.Box(new CANNON.Vec3(hw, (hullTop - hullBot) / 2, hl)), new CANNON.Vec3(0, (hullTop + hullBot) / 2 - P.comY, 0));
    const cabZ0 = s.zRwBase, cabZ1 = s.zWsBase;
    body.addShape(new CANNON.Box(new CANNON.Vec3(hw * s.roofW * 1.05, (s.roofY - hullTop) / 2, (cabZ1 - cabZ0) / 2 * 0.92)), new CANNON.Vec3(0, (s.roofY + hullTop) / 2 - P.comY, (cabZ0 + cabZ1) / 2));
    // inertia: box-ish but a bit lower yaw inertia makes cars feel alive
    body.updateMassProperties();
    this.body = body;
    const rv = new CANNON.RaycastVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const equil = 9.81 / (4 * P.stiffness);
    const connY = s.wheelR + P.restLen - equil - P.comY;
    const crit = Math.sqrt(P.stiffness);
    const axF = s.wb / 2 + s.axleShift, axR = -s.wb / 2 + s.axleShift;
    this.wheelDefs = [];
    for (const [z, front] of [[axF, true], [axR, false]]) for (const side of [1, -1]) {
      rv.addWheel({
        radius: s.wheelR,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(side * s.track / 2, connY, z),
        suspensionStiffness: P.stiffness,
        suspensionRestLength: P.restLen,
        dampingRelaxation: crit * 0.62,
        dampingCompression: crit * 0.42,
        frictionSlip: P.grip,
        rollInfluence: P.roll,
        maxSuspensionForce: 1e7,
        maxSuspensionTravel: P.restLen * 0.8,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
      this.wheelDefs.push({ front, side, z, connY });
    }
    this.rv = rv;
    this.driven = s.drive === 'fwd' ? [0, 1] : s.drive === 'rwd' ? [2, 3] : [0, 1, 2, 3];
    this.connY = connY;
    // torque: peak torque from power (hp) assuming peak power at 85% redline
    const pw = s.power * 745.7;
    const wPk = s.maxRpm * 0.85 * 2 * Math.PI / 60;
    this.peakTorque = pw / wPk / 0.86;
    this._xAxis = new CANNON.Vec3(1, 0, 0); this._axle = new CANNON.Vec3(); this._cv = new CANNON.Vec3();
    this._f = new CANNON.Vec3(); this._v = new CANNON.Vec3(); this._fw = new CANNON.Vec3(); this._up = new CANNON.Vec3();
    this._pre = () => this.preStep(this.world.dt);
  }

  addTo(world) {
    this.rv.addToWorld(world);
    world.addEventListener('preStep', this._pre);
    this.added = true;
  }
  remove() {
    if (!this.added) return;
    this.world.removeEventListener('preStep', this._pre);
    this.rv.removeFromWorld(this.world);
    this.added = false;
  }
  place(x, y, z, yaw, vel = null) {
    const b = this.body;
    b.position.set(x, y + this.P.comY + 0.05, z);
    b.quaternion.setFromEuler(0, yaw, 0, 'YXZ');
    b.velocity.set(vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0);
    b.angularVelocity.set(0, 0, 0);
    b.wakeUp();
  }

  torqueAt(rpm) {
    const r = rpm / this.spec.maxRpm;
    // broad plateau with fall-off at both ends
    const t = r < 0.55 ? 0.62 + 0.38 * Math.sin((r / 0.55) * Math.PI / 2) : 1 - Math.pow((r - 0.55) / 0.45, 2) * 0.22;
    return this.peakTorque * t;
  }

  forwardSpeed() {
    const b = this.body;
    b.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), this._fw);
    return this._fw.dot(b.velocity);
  }

  // called every physics substep
  preStep(dt) {
    const s = this.spec, P = this.P, b = this.body, rv = this.rv;
    this.time += dt;
    const v = this.forwardSpeed();
    this.speed = v;
    const absV = Math.abs(v);
    const gears = s.gears;
    // ---- gearbox (automatic)
    if (this.shiftT > 0) this.shiftT -= dt;
    const wantReverse = this.brake > 0.1 && this.throttle < 0.05 && v < 0.8;
    if (wantReverse && this.gear > 0 && absV < 0.8) { this.gear = -1; }
    if (this.gear === -1 && this.throttle > 0.1 && v > -0.8) { this.gear = 1; }
    let throttle = this.throttle, brake = this.brake;
    if (this.gear === -1) { throttle = this.brake; brake = this.throttle; }
    const ratio = this.gear === -1 ? gears[0] * 1.1 : gears[this.gear - 1];
    const wheelRpm = absV / s.wheelR * 60 / (2 * Math.PI);
    let rpmWheels = wheelRpm * ratio * s.final;
    // clutch slip near standstill
    const idle = 850;
    const launch = lerp(idle, s.maxRpm * (s.sporty ? 0.5 : 0.38), throttle);
    const clutch = this.gear === 1 || this.gear === -1 ? clamp(absV / 7, 0, 1) : 1;
    let target = lerp(Math.max(launch, rpmWheels), rpmWheels, clutch);
    // driven wheel spin raises rpm
    let spin = 0;
    for (const i of this.driven) spin = Math.max(spin, rv.wheelInfos[i].sliding ? 1 : 0);
    if ((spin || this.wheelspin > 0.15) && throttle > 0.3) target = Math.max(target, rpmWheels * 1.25 + throttle * 1200);
    target = Math.max(idle + (this.engineOn ? 0 : -idle), target);
    if (this.shiftT > 0) target = Math.max(idle, rpmWheels);
    this.rpm = lerp(this.rpm, Math.min(target, s.maxRpm * 1.02), clamp(dt * 18, 0, 1));
    if (this.gear > 0 && this.shiftT <= 0 && this.time - this.lastShift > 0.6) {
      if (this.rpm > s.maxRpm * 0.93 && this.gear < gears.length && throttle > 0.2) { this.gear++; this.shiftT = s.sporty ? 0.12 : 0.25; this.lastShift = this.time; this.onShift?.(1); }
      else if (this.gear > 1) {
        const lower = rpmWheels / ratio * gears[this.gear - 2];
        const downAt = throttle > 0.85 ? 0.7 : 0.4;
        if (lower < s.maxRpm * downAt && this.rpm < s.maxRpm * 0.42) { this.gear--; this.shiftT = 0.18; this.lastShift = this.time; this.onShift?.(-1); }
      }
    }
    // ---- engine force
    let drive = 0;
    if (this.engineOn && this.shiftT <= 0 && this.rpm < s.maxRpm && this.inWater < 0.5) {
      const tq = this.torqueAt(Math.max(this.rpm, 1500)) * throttle;
      drive = tq * ratio * s.final * 0.88 / s.wheelR;
    }
    this.load = throttle;
    const dir = this.gear === -1 ? 1 : -1; // cannon: negative engine force = forward
    const per = drive / this.driven.length;
    // traction limit (cannon's forward friction is very forgiving): cap force by
    // the wheel's normal load * grip; excess becomes wheelspin
    this.wheelspin = 0;
    for (let i = 0; i < 4; i++) {
      if (!this.driven.includes(i)) { rv.applyEngineForce(0, i); continue; }
      const w = rv.wheelInfos[i];
      const maxF = Math.max(0, w.suspensionForce) * w.frictionSlip * 1.12;
      let f = per;
      if (f > maxF && w.isInContact) { this.wheelspin = Math.max(this.wheelspin, clamp((f - maxF) / (maxF + 1), 0, 1)); f = maxF * 1.04; }
      rv.applyEngineForce(dir * f, i);
    }
    // ---- brakes, rolling resistance, engine braking (impulses per step)
    const mg = P.mass * 9.81;
    const brakeF = brake * mg * P.brakeG;
    const roll = mg * 0.014 + (throttle < 0.05 && this.gear > 0 ? this.rpm / s.maxRpm * mg * 0.05 * (ratio / gears[0]) : 0);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      let f = brakeF * (front ? 0.33 : 0.17) + roll / 4;
      if (this.handbrake && !front) f = Math.max(f, mg * 0.32);
      rv.setBrake(f * dt, i);
    }
    // ---- steering (speed sensitive, rate limited)
    const maxSteer = P.maxSteer / (1 + Math.pow(absV / 11, 1.25));
    const steerTarget = -this.steer * maxSteer;
    const rate = (Math.abs(this.steer) > 0.05 ? 3.2 : 4.5) * dt;
    this.steerAngle += clamp(steerTarget - this.steerAngle, -rate, rate);
    // simple Ackermann
    const a = this.steerAngle;
    rv.setSteeringValue(a * (a > 0 ? 1.08 : 0.94), 0);
    rv.setSteeringValue(a * (a > 0 ? 0.94 : 1.08), 1);
    // ---- surface grip
    const wetK = 1 - this.wetness * 0.22;
    for (let i = 0; i < 4; i++) {
      const w = rv.wheelInfos[i];
      let g = P.grip * (SURFACE_GRIP[this.surfaces[i]] ?? 1);
      if (this.surfaces[i] === 'road' || this.surfaces[i] === 'lot') g *= wetK;
      if (this.handbrake && i >= 2) g *= 0.5;
      w.frictionSlip = g;
    }
    // ---- aero
    const vel = b.velocity;
    const sp2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
    if (sp2 > 0.01) {
      const sp = Math.sqrt(sp2);
      const k = 0.5 * 1.225 * P.cdA * sp;
      this._f.set(-vel.x * k, -vel.y * k, -vel.z * k);
      b.applyForce(this._f, CANNON.Vec3.ZERO);
      b.vectorToWorldFrame(new CANNON.Vec3(0, -1, 0), this._up);
      this._up.scale(P.downforce * sp2, this._f);
      if (rv.numWheelsOnGround > 2) b.applyForce(this._f, CANNON.Vec3.ZERO);
    }
    // ---- stability assist: damp excess yaw when grounded and not handbraking
    if (rv.numWheelsOnGround >= 3 && !this.handbrake) {
      const yawRate = b.angularVelocity.y;
      const desired = absV > 1 ? (v * Math.tan(this.steerAngle)) / s.wb : 0;
      const err = yawRate - desired;
      if (Math.abs(err) > 0.22) {
        const corr = clamp(-(err - Math.sign(err) * 0.22) * P.mass * 6.5, -P.mass * 16, P.mass * 16);
        b.torque.y += corr;
      }
    }
    // ---- water: drag + buoyancy
    if (this.inWater > 0) {
      const k = this.inWater;
      this._f.set(-vel.x * P.mass * 1.2 * k, -vel.y * P.mass * 0.8 * k + P.mass * 9.81 * 0.75 * k, -vel.z * P.mass * 1.2 * k);
      b.applyForce(this._f, CANNON.Vec3.ZERO);
    }
    // slip metrics for skid marks / screech / smoke: lateral slip speed at each
    // contact patch, locked rear wheels under handbrake, cannon's own sliding flag
    for (let i = 0; i < 4; i++) {
      const w = rv.wheelInfos[i];
      if (!w.isInContact) { this.slip[i] = 0; continue; }
      w.worldTransform.quaternion.vmult(this._xAxis, this._axle);
      b.getVelocityAtWorldPoint(w.raycastResult.hitPointWorld, this._cv);
      const lat = Math.abs(this._cv.dot(this._axle));
      let sl = clamp((lat - 1.2) / 4, 0, 1);
      if (this.handbrake && i >= 2 && absV > 3) sl = Math.max(sl, 0.75);
      if (brake > 0.85 && absV > 6 && i < 2) sl = Math.max(sl, 0.4);
      if (w.sliding) sl = Math.max(sl, clamp(1 - w.skidInfo, 0.2, 1));
      this.slip[i] = sl;
    }
  }

  flipUpright() {
    const b = this.body;
    const e = new CANNON.Vec3();
    b.quaternion.toEuler(e, 'YZX');
    b.position.y += 1.2;
    b.quaternion.setFromEuler(0, e.y, 0, 'YXZ');
    b.angularVelocity.set(0, 0, 0);
    b.velocity.set(0, 0, 0);
  }

  isUpsideDown() {
    this.body.vectorToWorldFrame(new CANNON.Vec3(0, 1, 0), this._up);
    return this._up.y < 0.2;
  }
}
