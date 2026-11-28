// City layout for "Neon Coast": a Miami-inspired downtown on the mainland, a bay
// crossed by two causeways, and a beach island with an art-deco strip.
// 1 unit = 1 metre. +x = east, -z = north, y = up.
import { RNG, clamp } from '../core/utils.js';

export const ROAD_W = 14;
export const HALF_ROAD = 7;
export const SIDEWALK_W = 4;
export const CURB_H = 0.15;
export const WATER_LEVEL = -0.35;
export const SEAFLOOR = -6;
export const LANE_OFFSETS = [1.75, 5.25];

export const ZS = [];
for (let z = -600; z <= 600; z += 100) ZS.push(z);
export const DT_XS = [-680, -580, -480, -380, -280, -180, -80];
export const IS_XS = [360, 440, 520];
export const CAUSEWAY_ZS = [0, -400];

export const LAND = [
  { x0: -700, x1: -20, z0: -620, z1: 620, name: 'downtown' },
  { x0: 330, x1: 600, z0: -620, z1: 620, name: 'island' },
  ...CAUSEWAY_ZS.map((cz) => ({ x0: -20, x1: 330, z0: cz - 12, z1: cz + 12, name: 'causeway' })),
];
export const BEACH = { x0: 555, xFlat: 600, x1: 770, z0: -620, z1: 620, slope: 0.04 };

export const STREET_NAMES = {
  x: { '-680': 'Everglade Ave', '-580': 'Royal Palm Ave', '-480': 'Coral Way', '-380': 'Hibiscus Ave', '-280': 'Brickstone Ave', '-180': 'Biscay Blvd', '-80': 'Bayshore Dr', '360': 'Westbay Ave', '440': 'Collins Pkwy', '520': 'Ocean Drive' },
};

// ------------------------------------------------------------------ graph
export const nodes = [];
export const edges = [];
const nodeMap = new Map();
function node(x, z) {
  const k = `${x},${z}`;
  let n = nodeMap.get(k);
  if (!n) { n = { id: nodes.length, x, z, edges: [], signal: false, phase: 0 }; nodes.push(n); nodeMap.set(k, n); }
  return n;
}
export function getNode(x, z) { return nodeMap.get(`${x},${z}`); }

function edge(a, b, speed) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  const e = { id: edges.length, a, b, len, dx: dx / len, dz: dz / len, axis: Math.abs(dx) > Math.abs(dz) ? 'x' : 'z', speed };
  edges.push(e);
  a.edges.push(e); b.edges.push(e);
  return e;
}

function buildGrid(xs, zs, speed) {
  for (const x of xs) for (const z of zs) node(x, z);
  for (const z of zs) for (let i = 0; i < xs.length - 1; i++) edge(node(xs[i], z), node(xs[i + 1], z), speed);
  for (const x of xs) for (let j = 0; j < zs.length - 1; j++) edge(node(x, zs[j]), node(x, zs[j + 1]), speed);
}
buildGrid(DT_XS, ZS, 14);
buildGrid(IS_XS, ZS, 13);
for (const cz of CAUSEWAY_ZS) edge(node(-80, cz), node(360, cz), 20);
for (const n of nodes) {
  n.signal = n.edges.length >= 3;
  n.phase = ((n.x * 0.031 + n.z * 0.017) % 1 + 1) % 1;
}

// signal state for a node and an approach axis -> 'green' | 'yellow' | 'red'
const CYCLE = { green: 14, yellow: 3, allRed: 1.5 };
const HALF = CYCLE.green + CYCLE.yellow + CYCLE.allRed;
export function signalState(n, axis, time) {
  if (!n.signal) return 'green';
  let t = (time + n.phase * HALF * 2) % (HALF * 2);
  // first half: z axis moves; second half: x axis moves
  const active = t < HALF ? 'z' : 'x';
  if (t >= HALF) t -= HALF;
  if (axis !== active) return 'red';
  if (t < CYCLE.green) return 'green';
  if (t < CYCLE.green + CYCLE.yellow) return 'yellow';
  return 'red';
}

// ------------------------------------------------------------------ slabs (raised sidewalk blocks, parks, strips)
export const slabs = []; // {x0,x1,z0,z1, kind, ring (bool sidewalk ring), lot, block}
export const blocks = [];
const rng = new RNG(2024);

function addSlab(x0, x1, z0, z1, kind, extra = {}) {
  const s = { x0, x1, z0, z1, kind, ...extra };
  slabs.push(s);
  return s;
}

// downtown blocks
const core = { x: -240, z: 160 };
for (let i = 0; i < DT_XS.length - 1; i++) {
  for (let j = 0; j < ZS.length - 1; j++) {
    const x0 = DT_XS[i] + HALF_ROAD, x1 = DT_XS[i + 1] - HALF_ROAD;
    const z0 = ZS[j] + HALF_ROAD, z1 = ZS[j + 1] - HALF_ROAD;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dCore = Math.hypot(cx - core.x, (cz - core.z) * 0.8);
    let type;
    if (i === 5 && j === 6) type = 'parking';
    else if ((i === 2 && j === 5) || (i === 4 && j === 9) || (i === 1 && j === 2) || (i === 0 && j === 8) || (i === 3 && j === 1)) type = 'park';
    else if (i === 3 && j === 7) type = 'parking';
    else if (dCore < 210) type = 'tower';
    else if (dCore < 380) type = rng.chance(0.75) ? 'midrise' : 'tower';
    else type = rng.chance(0.6) ? 'lowrise' : 'midrise';
    const b = { i, j, x0, x1, z0, z1, cx, cz, type, district: 'downtown', dCore };
    blocks.push(b);
    addSlab(x0, x1, z0, z1, type === 'park' ? 'park' : type === 'parking' ? 'parking' : 'block', { ring: true, block: b });
  }
}
// island blocks
for (let i = 0; i < IS_XS.length - 1; i++) {
  for (let j = 0; j < ZS.length - 1; j++) {
    const x0 = IS_XS[i] + HALF_ROAD, x1 = IS_XS[i + 1] - HALF_ROAD;
    const z0 = ZS[j] + HALF_ROAD, z1 = ZS[j + 1] - HALF_ROAD;
    let type = i === 1 ? 'deco' : 'lowrise';
    if (i === 0 && (j === 3 || j === 8)) type = 'park';
    if (i === 0 && j === 6) type = 'parking';
    const b = { i, j, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, type, district: 'island', dCore: 999 };
    blocks.push(b);
    addSlab(x0, x1, z0, z1, type === 'park' ? 'park' : type === 'parking' ? 'parking' : 'block', { ring: true, block: b });
  }
}
// strips
function splitAtCauseways(z0, z1) {
  const out = [];
  let cur = z0;
  for (const cz of [...CAUSEWAY_ZS].sort((a, b) => a - b)) {
    if (cz - HALF_ROAD > cur && cz < z1) { out.push([cur, cz - HALF_ROAD]); cur = cz + HALF_ROAD; }
  }
  out.push([cur, z1]);
  return out;
}
addSlab(-700, DT_XS[0] - HALF_ROAD, -620, 620, 'strip');
addSlab(DT_XS[0] - HALF_ROAD, -80 - HALF_ROAD, -620, -600 - HALF_ROAD, 'strip');
addSlab(DT_XS[0] - HALF_ROAD, -80 - HALF_ROAD, 600 + HALF_ROAD, 620, 'strip');
for (const [a, b] of splitAtCauseways(-620, 620)) addSlab(-80 + HALF_ROAD, -20, a, b, 'bayfront');
for (const [a, b] of splitAtCauseways(-620, 620)) addSlab(330, 360 - HALF_ROAD, a, b, 'baywalk');
addSlab(360 - HALF_ROAD, 520 + HALF_ROAD, -620, -600 - HALF_ROAD, 'strip');
addSlab(360 - HALF_ROAD, 520 + HALF_ROAD, 600 + HALF_ROAD, 620, 'strip');
addSlab(520 + HALF_ROAD, BEACH.x0, -620, 620, 'oceanpark');
for (const cz of CAUSEWAY_ZS) {
  addSlab(-20, 330, cz - 12, cz - HALF_ROAD, 'causewalk');
  addSlab(-20, 330, cz + HALF_ROAD, cz + 12, 'causewalk');
}

// grass areas (surface queries + grass blades)
export const grassRects = [];
for (const s of slabs) {
  if (s.kind === 'park') grassRects.push({ x0: s.x0 + SIDEWALK_W, x1: s.x1 - SIDEWALK_W, z0: s.z0 + SIDEWALK_W, z1: s.z1 - SIDEWALK_W, park: true });
  if (s.kind === 'bayfront') grassRects.push({ x0: s.x0 + 6, x1: s.x1 - 9, z0: s.z0 + 3, z1: s.z1 - 3 });
  if (s.kind === 'oceanpark') grassRects.push({ x0: s.x0 + 4, x1: s.x1 - 5, z0: s.z0 + 2, z1: s.z1 - 2 });
  if (s.kind === 'baywalk') grassRects.push({ x0: s.x0 + 2, x1: s.x1 - 8, z0: s.z0 + 3, z1: s.z1 - 3 });
}

// ------------------------------------------------------------------ spatial index
const CELL = 25;
const index = new Map();
function cellKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
function indexRect(r, list) {
  for (let cx = Math.floor(r.x0 / CELL); cx <= Math.floor(r.x1 / CELL); cx++)
    for (let cz = Math.floor(r.z0 / CELL); cz <= Math.floor(r.z1 / CELL); cz++) {
      const k = cellKey(cx, cz);
      let e = index.get(k);
      if (!e) { e = { slabs: [], grass: [], land: [] }; index.set(k, e); }
      e[list].push(r);
    }
}
for (const s of slabs) indexRect(s, 'slabs');
for (const g of grassRects) indexRect(g, 'grass');
for (const l of LAND) indexRect(l, 'land');
const EMPTY = { slabs: [], grass: [], land: [] };
function cellAt(x, z) { return index.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY; }
const inR = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function slabAt(x, z) {
  for (const s of cellAt(x, z).slabs) if (inR(s, x, z)) return s;
  return null;
}
export function onLand(x, z) {
  for (const l of cellAt(x, z).land) if (inR(l, x, z)) return true;
  return false;
}
export function inGrass(x, z) {
  for (const g of cellAt(x, z).grass) if (inR(g, x, z)) return true;
  return false;
}

export function groundHeight(x, z) {
  if (x >= BEACH.x0 && z >= BEACH.z0 && z <= BEACH.z1) {
    if (x <= BEACH.xFlat) return 0;
    return Math.max(SEAFLOOR, -(x - BEACH.xFlat) * BEACH.slope);
  }
  if (slabAt(x, z)) return CURB_H;
  if (onLand(x, z)) return 0;
  return SEAFLOOR;
}

// 'road' | 'sidewalk' | 'grass' | 'sand' | 'water' | 'lot'
export function surfaceAt(x, z) {
  if (x >= BEACH.x0 && z >= BEACH.z0 && z <= BEACH.z1) {
    return groundHeight(x, z) < WATER_LEVEL - 0.05 ? 'water' : 'sand';
  }
  const s = slabAt(x, z);
  if (s) {
    if (inGrass(x, z)) return 'grass';
    if (s.kind === 'parking') {
      if (x > s.x0 + SIDEWALK_W && x < s.x1 - SIDEWALK_W && z > s.z0 + SIDEWALK_W && z < s.z1 - SIDEWALK_W) return 'lot';
    }
    return 'sidewalk';
  }
  if (onLand(x, z)) return 'road';
  return 'water';
}

export function isWater(x, z) { return groundHeight(x, z) < WATER_LEVEL; }

// nearest point on any road centreline (for respawn / traffic placement)
export function nearestRoad(x, z) {
  let best = null, bd = Infinity;
  for (const e of edges) {
    const t = clamp(((x - e.a.x) * e.dx + (z - e.a.z) * e.dz), 0, e.len);
    const px = e.a.x + e.dx * t, pz = e.a.z + e.dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; best = { x: px, z: pz, edge: e, t, dist: Math.sqrt(d) }; }
  }
  return best;
}

export function districtName(x, z) {
  if (x < -20) {
    const d = Math.hypot(x - core.x, (z - core.z) * 0.8);
    if (x > -80) return 'Bayfront Park';
    if (d < 210) return 'Brickstone Financial District';
    if (z < -300) return 'Little Havana Heights';
    if (z > 380) return 'Coconut Row';
    return 'Downtown Neon Coast';
  }
  if (x < 330) return Math.abs(z) < 30 ? 'MacKenna Causeway' : Math.abs(z + 400) < 30 ? 'Venetian Causeway' : 'Biscay Bay';
  if (x < 527) return x > 440 ? 'Art Deco District' : 'South Shore';
  if (x < BEACH.x0) return 'Ocean Park';
  if (!isWater(x, z)) return 'Sunrise Beach';
  return 'Atlantic Ocean';
}

export const SPAWN = { x: -91.5, z: 22, heading: -Math.PI / 2 };
