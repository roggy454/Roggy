// Builds every texture + material the world uses, sized by the quality preset.
import * as THREE from 'three';
import * as T from './textures.js';

// Shared uniforms, updated each frame by the sky / time-of-day system.
export const globalUniforms = {
  uNight: { value: 0 },     // 0 = day, 1 = full night
  uLitFrac: { value: 0.5 }, // fraction of windows with lights on
  uTime: { value: 0 },
  uWarnBlink: { value: 0 },
};

// Hash-based window lighting: every window cell gets its own on/off state and colour, so a
// repeating facade texture never shows repeating lit patterns.
function windowLightShader(mat, cells) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = globalUniforms.uNight;
    sh.uniforms.uLitFrac = globalUniforms.uLitFrac;
    sh.uniforms.uCells = { value: new THREE.Vector2(cells[0], cells[1]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nflat varying float vSeed;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed = aSeed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uLitFrac; uniform vec2 uCells; flat varying float vSeed;
        float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <emissivemap_fragment>', `
        #ifdef USE_EMISSIVEMAP
          vec3 eMask = texture2D(emissiveMap, vEmissiveMapUv).rgb;
          vec2 cell = mod(floor(vEmissiveMapUv * uCells + 0.0001), 256.0);
          float h = wHash(cell * 0.0731 + vec2(vSeed * 0.113, vSeed * 0.071));
          float lit = step(1.0 - uLitFrac, h);
          float h2 = fract(h * 13.7 + vSeed);
          vec3 tint = h2 < 0.55 ? vec3(1.0, 0.72, 0.42) : h2 < 0.85 ? vec3(1.0, 0.88, 0.7) : vec3(0.75, 0.87, 1.0);
          float bright = 0.45 + 0.9 * fract(h * 7.31);
          totalEmissiveRadiance = eMask * tint * bright * lit * uNight * 1.15;
        #endif
      `);
  };
  mat.customProgramCacheKey = () => 'window-light';
}

export function buildMaterials(quality, maxAniso) {
  T.setMaxAnisotropy(maxAniso);
  const big = quality === 'high' ? 1024 : 512;
  const fac = quality === 'high' ? 1024 : 512;
  const tex = {
    asphalt: T.makeAsphaltTextures(big),
    road: T.makeRoadTextures(big),
    marking: T.makeMarkingTexture(),
    sidewalk: T.makeSidewalkTextures(big),
    pavers: T.makePaverTextures(512),
    grass: T.makeGrassGroundTextures(big),
    rock: T.makeRockTextures(512),
    dirt: T.makeDirtTextures(512),
    roof: T.makeRoofTextures(512),
    pool: T.makeLightPoolTexture(),
    leaf: T.makeLeafTexture(),
    bark: T.makeBarkTexture(),
    water: T.makeWaterNormal(512),
    plates: T.makePlateAtlas(),
    facade: {},
    shop: [T.makeShopTextures(fac, 300), T.makeShopTextures(fac, 911)],
  };
  let seed = 100;
  for (const k of Object.keys(T.FACADE_STYLES)) tex.facade[k] = T.makeFacadeTextures(k, fac, seed += 37);

  const pbr = (t, extra = {}) => new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normal, roughnessMap: t.orm, metalnessMap: t.orm,
    roughness: 1, metalness: 1, ...extra,
  });

  const m = {};
  m.road = pbr(tex.road, { normalScale: new THREE.Vector2(0.6, 0.6) });
  m.asphalt = pbr(tex.asphalt, { normalScale: new THREE.Vector2(0.6, 0.6) });
  m.decal = new THREE.MeshStandardMaterial({
    map: tex.marking, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.sidewalk = pbr(tex.sidewalk, { normalScale: new THREE.Vector2(0.8, 0.8) });
  m.pavers = pbr(tex.pavers, { normalScale: new THREE.Vector2(0.9, 0.9) });
  m.lawn = pbr(tex.grass, { metalness: 0 });
  m.roof = pbr(tex.roof);
  m.trim = new THREE.MeshStandardMaterial({ map: tex.sidewalk.map, normalMap: tex.sidewalk.normal, color: 0xc8c4bc, roughness: 0.85, metalness: 0 });
  m.props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  m.street = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
  m.lampHead = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
  m.lightPool = new THREE.MeshBasicMaterial({
    map: tex.pool, color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  m.signalLamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.warning = new THREE.MeshBasicMaterial({ color: 0xff2010 });
  m.fountainWater = new THREE.MeshStandardMaterial({
    color: 0x2c5560, roughness: 0.05, metalness: 0.2, normalMap: tex.water, normalScale: new THREE.Vector2(0.5, 0.5),
  });

  m.facade = {};
  for (const [k, t] of Object.entries(tex.facade)) {
    const mat = pbr(t, { emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1, normalScale: new THREE.Vector2(1, 1) });
    windowLightShader(mat, [t.cols, t.floors]);
    m.facade[k] = mat;
  }
  m.shop = tex.shop.map((t) => {
    const mat = pbr(t, { emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1 });
    windowLightShader(mat, [t.cols, 1]);
    return mat;
  });
  return { tex, mats: m };
}
