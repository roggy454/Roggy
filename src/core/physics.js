// cannon-es world setup: materials, broadphase and helpers for static geometry.
import * as CANNON from 'cannon-es';

export class Physics {
  constructor() {
    const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 10;
    w.defaultContactMaterial.friction = 0.35;
    w.defaultContactMaterial.restitution = 0.05;
    this.world = w;
    this.mat = {
      ground: new CANNON.Material('ground'),
      car: new CANNON.Material('car'),
      prop: new CANNON.Material('prop'),
      wall: new CANNON.Material('wall'),
    };
    const cm = (a, b, friction, restitution) => w.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
    cm(this.mat.ground, this.mat.car, 0.25, 0.02);
    cm(this.mat.wall, this.mat.car, 0.12, 0.08);
    cm(this.mat.car, this.mat.car, 0.25, 0.12);
    cm(this.mat.prop, this.mat.ground, 0.6, 0.12);
    cm(this.mat.prop, this.mat.car, 0.3, 0.2);
    cm(this.mat.prop, this.mat.prop, 0.4, 0.15);
    cm(this.mat.prop, this.mat.wall, 0.4, 0.1);
    this.static = [];
  }
  addStaticBox(cx, cy, cz, hx, hy, hz, material = this.mat.ground, yaw = 0, roll = 0) {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    b.position.set(cx, cy, cz);
    if (yaw || roll) b.quaternion.setFromEuler(0, yaw, roll, 'YXZ');
    this.world.addBody(b);
    this.static.push(b);
    return b;
  }
  addStaticCylinder(x, y0, z, r, h, material = this.mat.wall) {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material });
    b.addShape(new CANNON.Cylinder(r, r, h, 8));
    b.position.set(x, y0 + h / 2, z);
    this.world.addBody(b);
    return b;
  }
}
export { CANNON };
