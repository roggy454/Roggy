// Shared uniforms & runtime state referenced by many shaders/systems.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uWet: { value: 0 },          // 0 dry .. 1 soaked
  uRain: { value: 0 },         // rain intensity 0..1
  uWind: { value: 0.3 },
  uNight: { value: 0 },        // 0 day .. 1 night
  uReflTex: { value: null },
  uReflMat: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uNoise: { value: null },
  uTrample: { value: null },
  uTrampleOrigin: { value: new THREE.Vector2() },
  uTrampleSize: { value: 128 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uFlash: { value: 0 },
};

// Layers: 0 = normal (reflected), 1 = main camera only (not in mirror)
export const LAYER_NO_REFLECT = 1;

export function noReflect(obj) {
  obj.traverse((o) => o.layers.set(LAYER_NO_REFLECT));
  return obj;
}

export const QUALITY = {
  low:    { name: 'Low',    pixelRatio: 0.7, shadows: 0,    reflScale: 0,    grass: 0.35, grassRange: 45,  traffic: 14, peds: 12, bloom: true,  msaa: 0, far: 1400 },
  medium: { name: 'Medium', pixelRatio: 1.0, shadows: 1024, reflScale: 0.35, grass: 0.6,  grassRange: 70,  traffic: 22, peds: 20, bloom: true,  msaa: 0, far: 2200 },
  high:   { name: 'High',   pixelRatio: 1.25, shadows: 2048, reflScale: 0.5, grass: 1.0,  grassRange: 95,  traffic: 30, peds: 30, bloom: true,  msaa: 4, far: 3000 },
  ultra:  { name: 'Ultra',  pixelRatio: 2.0, shadows: 4096, reflScale: 0.75, grass: 1.5,  grassRange: 130, traffic: 40, peds: 42, bloom: true,  msaa: 4, far: 3500 },
};

export const STATE = {
  quality: 'high',
  q: QUALITY.high,
  hour: 17.6,
  timeScale: 60,      // game seconds per real second (1 game minute / s)
  paused: false,
  mobile: false,
};
