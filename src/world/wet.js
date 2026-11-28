// Patches a MeshStandardMaterial so it gets darker, glossier and mirror-like
// (planar reflection + puddles + rain ripples) as the world gets wet.
import { U } from '../core/globals.js';

const RIPPLE = /* glsl */`
vec2 nc_ripples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 q = p * 1.7 + float(i) * 7.31;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float tt = fract(t * 1.3 + h);
    vec2 off = vec2(fract(h * 13.1), fract(h * 71.7)) - 0.5;
    vec2 d = f - off * 0.6;
    float r = length(d);
    float front = tt * 0.55;
    float ring = sin((r - front) * 42.0) * smoothstep(0.12, 0.0, abs(r - front)) * (1.0 - tt);
    acc += d / (r + 1e-3) * ring;
  }
  return acc;
}`;

export function makeWet(material, { puddles = 1, porous = 0.5 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, {
      uWet: U.uWet, uRain: U.uRain, uTime: U.uTime, uReflTex: U.uReflTex, uReflMat: U.uReflMat,
      uReflOn: U.uReflOn, uNoise: U.uNoise, uPuddleAmt: { value: puddles }, uPorous: { value: porous },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vWetPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWetPos;
        uniform float uWet, uRain, uTime, uReflOn, uPuddleAmt, uPorous;
        uniform sampler2D uReflTex, uNoise;
        uniform mat4 uReflMat;
        float nc_puddle; float nc_wetMask;
        ${RIPPLE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float pn = texture2D(uNoise, vWetPos.xz * 0.031).r;
          float pn2 = texture2D(uNoise, vWetPos.xz * 0.13).g;
          float pv = pn * 0.78 + pn2 * 0.22;
          nc_puddle = smoothstep(0.64 - uWet * 0.2, 0.67 - uWet * 0.17, pv) * uPuddleAmt * smoothstep(0.15, 0.6, uWet);
          nc_wetMask = clamp(max(uWet * 0.7, nc_puddle), 0.0, 1.0);
          diffuseColor.rgb *= mix(1.0, 1.0 - uPorous, uWet);
          diffuseColor.rgb *= mix(1.0, 0.65, nc_puddle);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.22, 0.03, nc_puddle), nc_wetMask);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), nc_puddle * 0.9));`)
      .replace('#include <opaque_fragment>', `
        if (uReflOn > 0.5 && nc_wetMask > 0.01) {
          vec4 rc = uReflMat * vec4(vWetPos, 1.0);
          vec2 ruv = rc.xy / rc.w;
          vec2 rip = nc_ripples(vWetPos.xz, uTime) * uRain;
          ruv += normal.xy * 0.03 * (1.0 - nc_puddle) + rip * 0.012;
          vec3 refl = texture2D(uReflTex, clamp(ruv, 0.001, 0.999)).rgb;
          vec3 Vd = normalize(vViewPosition);
          float NdV = clamp(dot(normalize(vNormal), Vd), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
          float amt = nc_wetMask * mix(0.18, 0.95, fres) * mix(0.55, 1.0, nc_puddle);
          outgoingLight = mix(outgoingLight, refl, clamp(amt, 0.0, 0.92));
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'wet' + puddles + porous;
  return material;
}
