// Shared planar reflection about the ground plane (y = 0). Wet roads, puddles and
// the sea all sample the same mirrored render, so one extra pass serves all.
import * as THREE from 'three';
import { U, LAYER_NO_REFLECT } from '../core/globals.js';

export class PlanarReflection {
  constructor(renderer, scene, scale = 0.5, planeY = -0.12) {
    this.renderer = renderer;
    this.scene = scene;
    this.scale = scale;
    this.planeY = planeY;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.layers.set(0);
    this.cam.matrixAutoUpdate = true;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    U.uReflTex.value = this.rt.texture;
    this.textureMatrix = U.uReflMat.value;
    this.enabled = scale > 0;
    this._n = new THREE.Vector3(0, 1, 0);
    this._rp = new THREE.Vector3();
    this._cp = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._look = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }
  setSize(w, h) {
    if (!this.enabled) return;
    this.rt.setSize(Math.max(16, Math.floor(w * this.scale)), Math.max(16, Math.floor(h * this.scale)));
  }
  setScale(s, w, h) { this.scale = s; this.enabled = s > 0; this.setSize(w, h); }

  update(camera) {
    if (!this.enabled) { U.uReflOn.value = 0; return; }
    const { _n: normal, _rp: rp, _cp: cp, _rot: rot, _look: look, _view: view, _target: target } = this;
    rp.set(0, this.planeY, 0);
    cp.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(rp, cp);
    if (view.dot(normal) > 0) { U.uReflOn.value = 0; return; } // camera below plane
    U.uReflOn.value = 1;
    // mirror camera position
    view.set(cp.x, 2 * this.planeY - cp.y, cp.z);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(cp);
    target.set(look.x, 2 * this.planeY - look.y, look.z);
    const vc = this.cam;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far; vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix maps world pos -> reflection uv
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);
    // oblique near plane clipping (cull everything below the mirror)
    this._plane.setFromNormalAndCoplanarPoint(normal, rp);
    this._plane.applyMatrix4(vc.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = this._q;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1.0;
    q.w = (1.0 + pm[10]) / pm[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1.0 - 0.003; pm[14] = clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, vc);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = prevShadow;
  }
}
