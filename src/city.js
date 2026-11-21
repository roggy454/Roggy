// City generator: road grid, sidewalks, parks, parking lots, buildings, street furniture,
// traffic signals and the collision world.
import * as THREE from 'three';
import {
  GRID, NB, LINES, CITY_HALF, ROAD_HALF, SIDEWALK, CURB_H, CITY_EDGE, STOP_DIST,
  CROSS_NEAR, CROSS_FAR, LANE_W, lineCoord,
} from './config.js';
import { RNG, clamp } from './utils.js';
import { GeoBuilder, PrimMerger, mtx } from './geo.js';
import { FACADE_STYLES } from './textures.js';

// ---------- collision world ----------
export class CollisionWorld {
  constructor(cell = 25) {
    this.cell = cell;
    this.boxes = [];   // {minX,minZ,maxX,maxZ,h}
    this.circles = []; // {x,z,r,h}
    this.boxGrid = new Map();
    this.circGrid = new Map();
    this.stampB = []; this.stampC = []; this.stamp = 1;
  }
  key(ix, iz) { return ix * 100003 + iz; }
  addBox(b) {
    const id = this.boxes.length; this.boxes.push(b); this.stampB.push(0);
    const c = this.cell;
    for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++) {
      for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.boxGrid.has(k)) this.boxGrid.set(k, []);
        this.boxGrid.get(k).push(id);
      }
    }
  }
  addCircle(ci) {
    const id = this.circles.length; this.circles.push(ci); this.stampC.push(0);
    const k = this.key(Math.floor(ci.x / this.cell), Math.floor(ci.z / this.cell));
    if (!this.circGrid.has(k)) this.circGrid.set(k, []);
    this.circGrid.get(k).push(id);
  }
  queryBoxes(minX, minZ, maxX, maxZ, out) {
    out.length = 0; const c = this.cell; const s = ++this.stamp;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const arr = this.boxGrid.get(this.key(ix, iz));
        if (!arr) continue;
        for (const id of arr) {
          if (this.stampB[id] === s) continue; this.stampB[id] = s;
          const b = this.boxes[id];
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }
  queryCircles(minX, minZ, maxX, maxZ, out) {
    out.length = 0; const c = this.cell;
    for (let ix = Math.floor((minX - 2) / c); ix <= Math.floor((maxX + 2) / c); ix++) {
      for (let iz = Math.floor((minZ - 2) / c); iz <= Math.floor((maxZ + 2) / c); iz++) {
        const arr = this.circGrid.get(this.key(ix, iz));
        if (!arr) continue;
        for (const id of arr) {
          const ci = this.circles[id];
          if (ci.x + ci.r < minX || ci.x - ci.r > maxX || ci.z + ci.r < minZ || ci.z - ci.r > maxZ) continue;
          out.push(ci);
        }
      }
    }
    return out;
  }
  // Segment test (xz) against building boxes, returns the hit fraction 0..1 (1 = clear).
  raycastBoxes(ax, az, bx, bz, minY, out = []) {
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    this.queryBoxes(minX - 1, minZ - 1, maxX + 1, maxZ + 1, out);
    let best = 1;
    const dx = bx - ax, dz = bz - az;
    for (const b of out) {
      if (b.h < minY) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (ax < b.minX || ax > b.maxX) continue; }
      else {
        let ta = (b.minX - ax) / dx, tb = (b.maxX - ax) / dx;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (Math.abs(dz) < 1e-9) { if (az < b.minZ || az > b.maxZ) continue; }
      else {
        let ta = (b.minZ - az) / dz, tb = (b.maxZ - az) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 < best) best = t0;
    }
    return best;
  }
}

// ---------- traffic signals ----------
export const SIGNAL_CYCLE = 34;
// Returns 'G', 'Y' or 'R' for traffic travelling along `axis` ('x' or 'z') at a node.
export function signalState(node, axis, t) {
  const p = ((t + node.phase) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  if (axis === 'x') return p < 13 ? 'G' : p < 16 ? 'Y' : 'R';
  return p >= 17 && p < 30 ? 'G' : p >= 30 && p < 33 ? 'Y' : 'R';
}
// Seconds of green left for an axis (0 if not green)
export function greenLeft(node, axis, t) {
  const p = ((t + node.phase) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  if (axis === 'x') return p < 13 ? 13 - p : 0;
  return p >= 17 && p < 30 ? 30 - p : 0;
}

const right = (d) => ({ x: -d.z, z: d.x });

export class City {
  constructor(tex, quality) {
    this.tex = tex;
    this.quality = quality;
    this.rng = new RNG(20261121);
    this.col = new CollisionWorld(25);
    this.nodes = [];
    this.edges = [];
    this.blocks = [];
    this.buildings = [];
    this.parks = [];
    this.lots = [];
    this.lampPositions = [];
    this.treeSpots = [];   // {x,z,s,kind}
    this.parkingSpots = []; // {x,z,yaw}
    this.signalHeads = [];  // {node, axis, base index in lamp instanced mesh}
    this.warningLights = [];
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.buildGraph();
    this.planBlocks();
  }

  // ---------- road graph ----------
  buildGraph() {
    for (let j = 0; j < LINES; j++) {
      for (let i = 0; i < LINES; i++) {
        this.nodes.push({ id: j * LINES + i, i, j, x: lineCoord(i), z: lineCoord(j), in: [], out: [], phase: ((i * 5 + j * 11) % SIGNAL_CYCLE) });
      }
    }
    const node = (i, j) => this.nodes[j * LINES + i];
    const addEdge = (a, b) => {
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      const dir = { x: dx / len, z: dz / len };
      const e = { id: this.edges.length, from: a, to: b, dir, right: right(dir), axis: Math.abs(dx) > 0 ? 'x' : 'z', len };
      this.edges.push(e); a.out.push(e); b.in.push(e);
    };
    for (let j = 0; j < LINES; j++) {
      for (let i = 0; i < LINES; i++) {
        if (i < LINES - 1) { addEdge(node(i, j), node(i + 1, j)); addEdge(node(i + 1, j), node(i, j)); }
        if (j < LINES - 1) { addEdge(node(i, j), node(i, j + 1)); addEdge(node(i, j + 1), node(i, j)); }
      }
    }
    this.nodeAt = node;
  }

  // Lane centre line for edge e, lane k (0 = curb lane, 1 = inner lane)
  laneOffset(k) { return k === 0 ? LANE_W * 1.5 : LANE_W * 0.5; }

  // ---------- blocks ----------
  planBlocks() {
    const rng = this.rng;
    const special = {
      '3,4': 'park', '6,6': 'park', '1,2': 'park',
      '2,5': 'parking', '5,1': 'parking',
    };
    for (let bj = 0; bj < NB; bj++) {
      for (let bi = 0; bi < NB; bi++) {
        const x0 = lineCoord(bi), x1 = lineCoord(bi + 1), z0 = lineCoord(bj), z1 = lineCoord(bj + 1);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const d = Math.max(Math.abs(cx), Math.abs(cz));
        let type = special[`${bi},${bj}`];
        if (!type) type = d <= 50 ? 'downtown' : d <= 150 ? 'midtown' : d <= 250 ? 'residential' : 'outer';
        const inner = { minX: x0 + ROAD_HALF + SIDEWALK, maxX: x1 - ROAD_HALF - SIDEWALK, minZ: z0 + ROAD_HALF + SIDEWALK, maxZ: z1 - ROAD_HALF - SIDEWALK };
        const blk = { bi, bj, x0, x1, z0, z1, cx, cz, type, inner };
        this.blocks.push(blk);
        if (type === 'park') this.parks.push(inner);
        else if (type === 'parking') this.planParking(blk);
        else this.planBuildings(blk, rng);
      }
    }
  }

  planBuildings(blk, rng) {
    const { inner, type } = blk;
    const n = type === 'downtown' ? 2 : type === 'midtown' ? (rng.chance(0.5) ? 2 : 3) : 3;
    const gap = type === 'downtown' ? 4 : 3;
    const size = (inner.maxX - inner.minX - (n - 1) * gap) / n;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        // centre lot of 3x3 blocks is enclosed by others: use it as a courtyard/greenery
        if (n === 3 && a === 1 && b === 1) {
          this.lots.push({ kind: 'yard', minX: inner.minX + a * (size + gap), minZ: inner.minZ + b * (size + gap), size });
          continue;
        }
        const minX = inner.minX + a * (size + gap), minZ = inner.minZ + b * (size + gap);
        const maxX = minX + size, maxZ = minZ + size;
        if (type === 'outer' && rng.chance(0.12)) {
          this.lots.push({ kind: 'yard', minX, minZ, size });
          continue;
        }
        let h, style, shops = false;
        if (type === 'downtown') {
          h = rng.float(85, 205);
          style = rng.pick(['glassBlue', 'glassTeal', 'glassBlue', 'office']);
        } else if (type === 'midtown') {
          h = rng.float(26, 85);
          style = rng.pick(['office', 'glassBlue', 'glassTeal', 'plaster', 'office']);
          shops = style !== 'glassBlue' && style !== 'glassTeal' && rng.chance(0.6);
        } else if (type === 'residential') {
          h = rng.float(13, 38);
          style = rng.pick(['brickRed', 'brickTan', 'plaster', 'brickRed', 'office']);
          shops = rng.chance(0.65);
        } else {
          h = rng.float(8, 24);
          style = rng.pick(['brickRed', 'brickTan', 'plaster', 'brickTan']);
          shops = rng.chance(0.4);
        }
        // shrink lot a bit so buildings don't all share the same footprint
        const inset = type === 'downtown' ? rng.float(0, 2) : rng.float(0, 1.5);
        const bld = {
          minX: minX + (a === 0 ? 0 : inset), maxX: maxX - (a === n - 1 ? 0 : inset),
          minZ: minZ + (b === 0 ? 0 : inset), maxZ: maxZ - (b === n - 1 ? 0 : inset),
          h, style, shops, block: blk, tiers: [],
        };
        this.buildings.push(bld);
      }
    }
  }

  planParking(blk) {
    const { inner } = blk;
    this.lots.push({ kind: 'parking', ...inner });
    // stalls: rows facing each other
    const rows = [inner.minZ + 6, inner.minZ + 22, inner.maxZ - 22, inner.maxZ - 6];
    for (let r = 0; r < rows.length; r++) {
      const yaw = r % 2 === 0 ? 0 : Math.PI;
      for (let x = inner.minX + 4; x < inner.maxX - 3; x += 3.0) {
        this.parkingSpots.push({ x: x + 1.5, z: rows[r], yaw: yaw, blk });
      }
    }
  }

  // ---------- meshes ----------
  build(materials) {
    this.mats = materials;
    this.buildRoads();
    this.buildBlocksGround();
    this.buildAllBuildings();
    this.buildStreetFurniture();
    return this.group;
  }

  buildRoads() {
    const roadB = new GeoBuilder();
    const interB = new GeoBuilder();
    const decalB = new GeoBuilder();
    // intersections
    for (const n of this.nodes) {
      interB.top(n.x - ROAD_HALF, n.z - ROAD_HALF, n.x + ROAD_HALF, n.z + ROAD_HALF, 0, 8);
    }
    // segments (undirected): only from edges going +x / +z
    for (const e of this.edges) {
      if (e.dir.x < 0 || e.dir.z < 0) continue;
      const a = e.from, b = e.to;
      const L = e.len - ROAD_HALF * 2;
      const vLen = L / 9;
      if (e.axis === 'x') {
        const x0 = a.x + ROAD_HALF, x1 = b.x - ROAD_HALF, z0 = a.z - ROAD_HALF, z1 = a.z + ROAD_HALF;
        // u across (z), v along (x)
        roadB.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], [[1, 0], [0, 0], [0, vLen], [1, vLen]]);
      } else {
        const z0 = a.z + ROAD_HALF, z1 = b.z - ROAD_HALF, x0 = a.x - ROAD_HALF, x1 = a.x + ROAD_HALF;
        roadB.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], [[0, 0], [0, vLen], [1, vLen], [1, 0]]);
      }
    }
    // crosswalks at every segment end + stop lines for each approach
    const yD = 0.012;
    for (const e of this.edges) {
      const n = e.to, d = e.dir, r = e.right;
      // crosswalk band across the full road, between CROSS_NEAR..CROSS_FAR before the node
      const c0 = { x: n.x - d.x * CROSS_FAR, z: n.z - d.z * CROSS_FAR };
      const c1 = { x: n.x - d.x * CROSS_NEAR, z: n.z - d.z * CROSS_NEAR };
      // Only once per road end: use the incoming edge (each end of each segment has exactly one incoming edge)
      const L = (p, o) => [p.x + r.x * o, yD, p.z + r.z * o];
      decalB.quad(L(c0, ROAD_HALF), L(c1, ROAD_HALF), L(c1, -ROAD_HALF), L(c0, -ROAD_HALF), [0, 1, 0],
        [[1, 0.25], [1, 1], [0, 1], [0, 0.25]]);
      // stop line on the approach half (right side of travel)
      const s0 = { x: n.x - d.x * (STOP_DIST + 0.45), z: n.z - d.z * (STOP_DIST + 0.45) };
      const s1 = { x: n.x - d.x * (STOP_DIST), z: n.z - d.z * (STOP_DIST) };
      decalB.quad(L(s0, ROAD_HALF - 0.4), L(s1, ROAD_HALF - 0.4), L(s1, 0.3), L(s0, 0.3), [0, 1, 0],
        [[0.9, 0.0], [0.9, 0.25], [0.1, 0.25], [0.1, 0.0]]);
    }
    const m = this.mats;
    const roads = new THREE.Mesh(roadB.toGeometry(), m.road); roads.receiveShadow = true;
    const inter = new THREE.Mesh(interB.toGeometry(), m.asphalt); inter.receiveShadow = true;
    const decals = new THREE.Mesh(decalB.toGeometry(), m.decal); decals.receiveShadow = true; decals.renderOrder = 1;
    this.group.add(roads, inter, decals);
  }

  buildBlocksGround() {
    const side = new GeoBuilder(); // sidewalks + curbs
    const lawn = new GeoBuilder();
    const pav = new GeoBuilder();
    const lot = new GeoBuilder();
    const decal = new GeoBuilder();
    const H = CURB_H;
    for (const b of this.blocks) {
      const x0 = b.x0 + ROAD_HALF, x1 = b.x1 - ROAD_HALF, z0 = b.z0 + ROAD_HALF, z1 = b.z1 - ROAD_HALF;
      side.top(x0, z0, x1, z1, H, 4);
      // curb faces
      side.wall(x0, z1, x1, z1, 0, H, x0 / 4, x1 / 4, 0, H / 4);
      side.wall(x1, z1, x1, z0, 0, H, -z1 / 4, -z0 / 4, 0, H / 4);
      side.wall(x1, z0, x0, z0, 0, H, -x1 / 4, -x0 / 4, 0, H / 4);
      side.wall(x0, z0, x0, z1, 0, H, z0 / 4, z1 / 4, 0, H / 4);
      const I = b.inner;
      if (b.type === 'park') {
        // lawn quadrants separated by paved cross paths, plaza in the middle
        const cx = (I.minX + I.maxX) / 2, cz = (I.minZ + I.maxZ) / 2, pw = 2.2;
        const quads = [[I.minX, I.minZ, cx - pw, cz - pw], [cx + pw, I.minZ, I.maxX, cz - pw], [I.minX, cz + pw, cx - pw, I.maxZ], [cx + pw, cz + pw, I.maxX, I.maxZ]];
        for (const q of quads) lawn.top(q[0], q[1], q[2], q[3], H + 0.01, 7);
        pav.top(cx - pw, I.minZ, cx + pw, I.maxZ, H + 0.012, 3);
        pav.top(I.minX, cz - pw, cx - pw, cz + pw, H + 0.012, 3);
        pav.top(cx + pw, cz - pw, I.maxX, cz + pw, H + 0.012, 3);
        // fountain
        this.fountain = { x: cx, z: cz };
        this.col.addCircle({ x: cx, z: cz, r: 4.6, h: 1 });
        // park trees
        const rng = new RNG(b.bi * 31 + b.bj * 7);
        for (let k = 0; k < 55; k++) {
          const x = rng.float(I.minX + 3, I.maxX - 3), z = rng.float(I.minZ + 3, I.maxZ - 3);
          if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue;
          this.treeSpots.push({ x, z, s: rng.float(0.85, 1.35), kind: 'broad', y: H });
          this.col.addCircle({ x, z, r: 0.35, h: 6 });
        }
        // benches along paths
        for (let k = -3; k <= 3; k++) {
          if (k === 0) continue;
          this.benchSpots = this.benchSpots || [];
          this.benchSpots.push({ x: cx + pw + 0.9, z: cz + k * 9, yaw: -Math.PI / 2 });
          this.benchSpots.push({ x: cx - pw - 0.9, z: cz + k * 9, yaw: Math.PI / 2 });
        }
      } else if (b.type === 'parking') {
        lot.top(I.minX, I.minZ, I.maxX, I.maxZ, H + 0.01, 8);
        // stall lines
        const rows = [I.minZ + 6, I.minZ + 22, I.maxZ - 22, I.maxZ - 6];
        for (const rz of rows) {
          for (let x = I.minX + 4; x <= I.maxX - 3; x += 3.0) {
            decal.quad([x - 0.06, H + 0.02, rz - 2.6], [x - 0.06, H + 0.02, rz + 2.6], [x + 0.06, H + 0.02, rz + 2.6], [x + 0.06, H + 0.02, rz - 2.6], [0, 1, 0],
              [[0.45, 0.05], [0.45, 0.2], [0.55, 0.2], [0.55, 0.05]]);
          }
        }
        for (let k = 0; k < 6; k++) {
          const x = I.minX + 2 + k * (I.maxX - I.minX - 4) / 5;
          this.treeSpots.push({ x, z: (I.minZ + I.maxZ) / 2, s: 0.9, kind: 'broad', y: H });
          this.col.addCircle({ x, z: (I.minZ + I.maxZ) / 2, r: 0.35, h: 6 });
        }
      }
    }
    // outer sidewalk ring beyond the outermost roads
    const a = CITY_HALF + ROAD_HALF, e = CITY_EDGE;
    side.top(-e, -e, e, -a, H, 4); side.top(-e, a, e, e, H, 4);
    side.top(-e, -a, -a, a, H, 4); side.top(a, -a, e, a, H, 4);
    // inner curb faces of the ring
    side.wall(-a, -a, a, -a, 0, H, 0, 1, 0, 0.04); // faces +z... (inner side of north strip)
    side.wall(a, a, -a, a, 0, H, 0, 1, 0, 0.04);
    side.wall(a, -a, a, a, 0, H, 0, 1, 0, 0.04);
    side.wall(-a, a, -a, -a, 0, H, 0, 1, 0, 0.04);
    // outer faces down into the terrain
    side.wall(-e, e, e, e, -1, H, 0, 50, 0, 0.3); side.wall(e, e, e, -e, -1, H, 0, 50, 0, 0.3);
    side.wall(e, -e, -e, -e, -1, H, 0, 50, 0, 0.3); side.wall(-e, -e, -e, e, -1, H, 0, 50, 0, 0.3);

    for (const l of this.lots) {
      if (l.kind !== 'yard') continue;
      lawn.top(l.minX, l.minZ, l.minX + l.size, l.minZ + l.size, H + 0.01, 7);
      this.parks.push({ minX: l.minX, minZ: l.minZ, maxX: l.minX + l.size, maxZ: l.minZ + l.size, yard: true });
      const rng = new RNG(Math.floor(l.minX * 13 + l.minZ * 7));
      for (let k = 0; k < 4; k++) {
        const x = l.minX + rng.float(3, l.size - 3), z = l.minZ + rng.float(3, l.size - 3);
        this.treeSpots.push({ x, z, s: rng.float(0.8, 1.2), kind: 'broad', y: H });
        this.col.addCircle({ x, z, r: 0.35, h: 6 });
      }
    }
    const m = this.mats;
    const add = (geo, mat) => { const me = new THREE.Mesh(geo, mat); me.receiveShadow = true; this.group.add(me); return me; };
    add(side.toGeometry(), m.sidewalk);
    add(lawn.toGeometry(), m.lawn);
    add(pav.toGeometry(), m.pavers);
    add(lot.toGeometry(), m.asphalt);
    const d = add(decal.toGeometry(), m.decal); d.renderOrder = 1;
  }

  buildAllBuildings() {
    const rng = new RNG(777);
    const facadeB = {};
    for (const k of Object.keys(FACADE_STYLES)) facadeB[k] = new GeoBuilder({ seed: true });
    const shopB = [new GeoBuilder({ seed: true }), new GeoBuilder({ seed: true })];
    const roofB = new GeoBuilder();
    const trimB = new GeoBuilder();
    const props = new PrimMerger();
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
    const H0 = CURB_H;
    const warn = [];

    for (const b of this.buildings) {
      const st = FACADE_STYLES[b.style];
      const tileW = st.cols * st.colW, tileH = st.floors * st.floorH;
      const shopH = 4.6;
      const yFac = b.shops ? H0 + shopH : H0;
      const floors = Math.max(2, Math.round((b.h - (yFac - H0)) / st.floorH));
      const top = yFac + floors * st.floorH;
      b.top = top;
      // tiers
      const tiers = [];
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      if (top > 55 && rng.chance(0.65)) {
        const f1 = Math.round(floors * rng.float(0.5, 0.7));
        const f2 = Math.round(floors * rng.float(0.8, 0.9));
        const i1 = Math.min(w, d) * rng.float(0.08, 0.14), i2 = i1 + Math.min(w, d) * rng.float(0.08, 0.12);
        tiers.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, y0: H0, y1: yFac + f1 * st.floorH, shops: b.shops });
        tiers.push({ minX: b.minX + i1, maxX: b.maxX - i1, minZ: b.minZ + i1, maxZ: b.maxZ - i1, y0: yFac + f1 * st.floorH, y1: yFac + f2 * st.floorH });
        tiers.push({ minX: b.minX + i2, maxX: b.maxX - i2, minZ: b.minZ + i2, maxZ: b.maxZ - i2, y0: yFac + f2 * st.floorH, y1: top });
      } else {
        tiers.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, y0: H0, y1: top, shops: b.shops });
      }
      b.tiers = tiers;
      this.col.addBox({ minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ, h: top });
      const inner = b.block.inner;
      const shopIdx = rng.int(0, 1);
      for (const t of tiers) {
        const faces = [
          [t.minX, t.maxZ, t.maxX, t.maxZ, Math.abs(t.maxZ - inner.maxZ) < 0.5],
          [t.maxX, t.maxZ, t.maxX, t.minZ, Math.abs(t.maxX - inner.maxX) < 0.5],
          [t.maxX, t.minZ, t.minX, t.minZ, Math.abs(t.minZ - inner.minZ) < 0.5],
          [t.minX, t.minZ, t.minX, t.maxZ, Math.abs(t.minX - inner.minX) < 0.5],
        ];
        for (const [ax, az, bx, bz, street] of faces) {
          const len = Math.hypot(bx - ax, bz - az);
          const nc = Math.max(1, Math.round(len / st.colW));
          const uSpan = nc / st.cols;
          const uOff = rng.int(0, st.cols - 1) / st.cols;
          const seed = rng.int(0, 255);
          let yStart = t.y0;
          if (t.shops && street) {
            const ns = Math.max(1, Math.round(len / 6));
            const so = rng.int(0, 3) / 4;
            shopB[shopIdx].wall(ax, az, bx, bz, t.y0, t.y0 + shopH, so, so + ns / 4, 0, 1, null, seed);
            yStart = t.y0 + shopH;
          } else if (t.shops) {
            // non-street ground floor uses the facade continuing down
          }
          const v0 = (yStart - yFac) / tileH, v1 = (t.y1 - yFac) / tileH;
          facadeB[b.style].wall(ax, az, bx, bz, yStart, t.y1, uOff, uOff + uSpan, v0, v1, null, seed);
        }
        // roof
        roofB.top(t.minX, t.minZ, t.maxX, t.maxZ, t.y1 + 0.02, 10);
        // parapet
        const p = 0.35, ph = 1.0, y = t.y1;
        trimB.box(t.minX - 0.05, y, t.minZ - 0.05, t.maxX + 0.05, y + ph, t.minZ + p, 2);
        trimB.box(t.minX - 0.05, y, t.maxZ - p, t.maxX + 0.05, y + ph, t.maxZ + 0.05, 2);
        trimB.box(t.minX - 0.05, y, t.minZ + p, t.minX + p, y + ph, t.maxZ - p, 2);
        trimB.box(t.maxX - p, y, t.minZ + p, t.maxX + 0.05, y + ph, t.maxZ - p, 2);
      }
      // rooftop equipment on the top tier
      const tt = tiers[tiers.length - 1];
      const tw = tt.maxX - tt.minX, td = tt.maxZ - tt.minZ;
      const nAC = rng.int(1, 4);
      for (let k = 0; k < nAC; k++) {
        const x = rng.float(tt.minX + 2.5, tt.maxX - 2.5), z = rng.float(tt.minZ + 2.5, tt.maxZ - 2.5);
        props.add(boxGeo, mtx(x, tt.y1 + 0.75, z, 0, rng.float(0, 3), 0, 2.2, 1.5, 1.6), new THREE.Color(0.62, 0.63, 0.62));
        props.add(cylGeo, mtx(x, tt.y1 + 1.55, z, 0, 0, 0, 0.55, 0.1, 0.55), new THREE.Color(0.25, 0.25, 0.26));
      }
      if (tw > 10 && td > 10) {
        const x = tt.minX + tw * rng.float(0.25, 0.75), z = tt.minZ + td * rng.float(0.25, 0.75);
        props.add(boxGeo, mtx(x, tt.y1 + 1.6, z, 0, 0, 0, 4, 3.2, 5), new THREE.Color(0.55, 0.54, 0.52));
      }
      if (b.style.startsWith('brick') && rng.chance(0.45)) {
        const x = rng.float(tt.minX + 3, tt.maxX - 3), z = rng.float(tt.minZ + 3, tt.maxZ - 3);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          props.add(boxGeo, mtx(x + lx * 1.2, tt.y1 + 1.5, z + lz * 1.2, 0, 0, 0, 0.15, 3, 0.15), new THREE.Color(0.2, 0.18, 0.16));
        }
        props.add(cylGeo, mtx(x, tt.y1 + 4.4, z, 0, 0, 0, 1.8, 3.0, 1.8), new THREE.Color(0.42, 0.3, 0.2));
        props.add(new THREE.ConeGeometry(1.95, 1.0, 14), mtx(x, tt.y1 + 6.4, z), new THREE.Color(0.3, 0.22, 0.16));
      }
      if (top > 120) {
        const x = (tt.minX + tt.maxX) / 2, z = (tt.minZ + tt.maxZ) / 2;
        const ah = rng.float(10, 24);
        props.add(cylGeo, mtx(x, tt.y1 + ah / 2, z, 0, 0, 0, 0.25, ah, 0.25), new THREE.Color(0.7, 0.7, 0.72));
        warn.push(new THREE.Vector3(x, tt.y1 + ah + 0.3, z));
      }
      if (top > 60) {
        for (const [cx, cz] of [[tt.minX, tt.minZ], [tt.maxX, tt.minZ], [tt.minX, tt.maxZ], [tt.maxX, tt.maxZ]]) {
          warn.push(new THREE.Vector3(cx + Math.sign((tt.minX + tt.maxX) / 2 - cx) * 0.4, tt.y1 + 1.2, cz + Math.sign((tt.minZ + tt.maxZ) / 2 - cz) * 0.4));
        }
      }
    }
    const m = this.mats;
    const add = (geo, mat, cast = true) => {
      const me = new THREE.Mesh(geo, mat); me.castShadow = cast; me.receiveShadow = true; this.group.add(me); return me;
    };
    for (const [k, gb] of Object.entries(facadeB)) if (gb.n) add(gb.toGeometry(), m.facade[k]);
    shopB.forEach((gb, i) => { if (gb.n) add(gb.toGeometry(), m.shop[i]); });
    add(roofB.toGeometry(), m.roof, false);
    add(trimB.toGeometry(), m.trim);
    add(props.merge(), m.props);
    // aircraft warning lights
    const wl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), m.warning, warn.length);
    warn.forEach((p, i) => wl.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    wl.instanceMatrix.needsUpdate = true;
    wl.computeBoundingSphere();
    this.group.add(wl);
    this.warningMesh = wl;
  }

  buildStreetFurniture() {
    const metal = new PrimMerger();
    const heads = new PrimMerger();
    const pools = new GeoBuilder();
    const lampPole = new THREE.CylinderGeometry(0.09, 0.14, 1, 8);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    const headGeo = new THREE.BoxGeometry(0.36, 0.16, 0.85);
    const lens = new THREE.BoxGeometry(0.28, 0.05, 0.62);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const poleC = new THREE.Color(0.32, 0.33, 0.34);
    const darkC = new THREE.Color(0.06, 0.06, 0.065);
    const rng = new RNG(4321);

    // street lamps along every segment, both sides
    for (const e of this.edges) {
      const a = e.from, d = e.dir, r = e.right;
      for (const s of [28, 72]) {
        const px = a.x + d.x * s + r.x * (ROAD_HALF + 0.55), pz = a.z + d.z * s + r.z * (ROAD_HALF + 0.55);
        // Each undirected segment side appears once: right side of each directed edge.
        const yaw = Math.atan2(-r.x, -r.z); // arm points toward the road centre
        metal.add(lampPole, mtx(px, CURB_H + 4.25, pz, 0, 0, 0, 1, 8.5, 1), poleC);
        const ax = px - r.x * 1.1, az = pz - r.z * 1.1;
        metal.add(arm, mtx(ax, CURB_H + 8.45, az, Math.PI / 2, yaw, 0, 1, 2.2, 1), poleC);
        const hx = px - r.x * 2.1, hz = pz - r.z * 2.1;
        metal.add(headGeo, mtx(hx, CURB_H + 8.45, hz, 0, yaw, 0), poleC);
        heads.add(lens, mtx(hx, CURB_H + 8.35, hz, 0, yaw, 0), new THREE.Color(1, 0.86, 0.62));
        this.lampPositions.push(new THREE.Vector3(hx, CURB_H + 8.2, hz));
        this.col.addCircle({ x: px, z: pz, r: 0.18, h: 8 });
        // light pool on the road + sidewalk
        const cx = px - r.x * 2.6, cz = pz - r.z * 2.6, R = 9;
        pools.quad([cx - R, 0.03, cz - R], [cx - R, 0.03, cz + R], [cx + R, 0.03, cz + R], [cx + R, 0.03, cz - R], [0, 1, 0], [[0, 1], [0, 0], [1, 0], [1, 1]]);
      }
      // sidewalk trees between lamps, building side of the sidewalk
      const blkType = this.blockTypeAt(a.x + d.x * 50 + r.x * 30, a.z + d.z * 50 + r.z * 30);
      if (blkType !== 'downtown' && blkType !== 'park') {
        for (const s of [18, 50, 82]) {
          if (rng.chance(0.25)) continue;
          const tx = a.x + d.x * s + r.x * (ROAD_HALF + 1.0), tz = a.z + d.z * s + r.z * (ROAD_HALF + 1.0);
          if (Math.abs(tx) > CITY_EDGE - 1 || Math.abs(tz) > CITY_EDGE - 1) continue;
          this.treeSpots.push({ x: tx, z: tz, s: rng.float(0.75, 1.0), kind: 'street', y: CURB_H });
          this.col.addCircle({ x: tx, z: tz, r: 0.3, h: 6 });
        }
      }
      // hydrant / trash can
      if (rng.chance(0.5)) {
        const s = 40 + rng.float(-6, 6);
        const hx = a.x + d.x * s + r.x * (ROAD_HALF + 0.8), hz = a.z + d.z * s + r.z * (ROAD_HALF + 0.8);
        if (rng.chance(0.5)) {
          metal.add(new THREE.CylinderGeometry(0.16, 0.18, 0.75, 10), mtx(hx, CURB_H + 0.37, hz), new THREE.Color(0.65, 0.08, 0.06));
          metal.add(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mtx(hx, CURB_H + 0.74, hz), new THREE.Color(0.65, 0.08, 0.06));
          this.col.addCircle({ x: hx, z: hz, r: 0.22, h: 1 });
        } else {
          metal.add(new THREE.CylinderGeometry(0.3, 0.27, 0.95, 12), mtx(hx, CURB_H + 0.47, hz), new THREE.Color(0.14, 0.2, 0.16));
          this.col.addCircle({ x: hx, z: hz, r: 0.32, h: 1 });
        }
      }
    }

    // traffic signals: one mast per approach on the right-hand corner, head hanging over the lanes
    const lampSlots = [];
    for (const n of this.nodes) {
      for (const e of n.in) {
        const d = e.dir, r = e.right;
        const back = STOP_DIST - 1.2;
        const px = n.x - d.x * back + r.x * (ROAD_HALF + 0.7), pz = n.z - d.z * back + r.z * (ROAD_HALF + 0.7);
        const yaw = Math.atan2(-d.x, -d.z); // face oncoming traffic
        metal.add(new THREE.CylinderGeometry(0.12, 0.16, 1, 10), mtx(px, CURB_H + 3.3, pz, 0, 0, 0, 1, 6.6, 1), darkC);
        const armLen = ROAD_HALF + 0.7 - 2.2;
        const ax = px - r.x * armLen / 2, az = pz - r.z * armLen / 2;
        metal.add(arm, mtx(ax, CURB_H + 6.3, az, Math.PI / 2, Math.atan2(-r.x, -r.z), 0, 1.6, armLen, 1.6), darkC);
        const heads2 = [
          { x: px - r.x * armLen, z: pz - r.z * armLen, y: CURB_H + 5.55 },
          { x: px - d.x * 0.05, z: pz - d.z * 0.05, y: CURB_H + 2.9 },
        ];
        for (const h of heads2) {
          metal.add(box, mtx(h.x, h.y, h.z, 0, yaw, 0, 0.38, 1.12, 0.3), darkC);
          // backplate
          metal.add(box, mtx(h.x + d.x * 0.17, h.y, h.z + d.z * 0.17, 0, yaw, 0, 0.62, 1.35, 0.03), darkC);
          const slot = { node: n, axis: e.axis, idx: lampSlots.length };
          for (let k = 0; k < 3; k++) {
            const y = h.y + 0.34 - k * 0.34;
            lampSlots.push({ x: h.x - d.x * 0.16, y, z: h.z - d.z * 0.16, k, yaw });
            // visor
            metal.add(box, mtx(h.x - d.x * 0.25, y + 0.13, h.z - d.z * 0.25, 0, yaw, 0, 0.3, 0.03, 0.2), darkC);
          }
          this.signalHeads.push(slot);
        }
        this.col.addCircle({ x: px, z: pz, r: 0.2, h: 6 });
      }
    }

    // benches in parks
    for (const bs of this.benchSpots || []) {
      metal.add(box, mtx(bs.x, CURB_H + 0.45, bs.z, 0, bs.yaw, 0, 1.8, 0.06, 0.45), new THREE.Color(0.42, 0.28, 0.16));
      metal.add(box, mtx(bs.x + Math.sin(bs.yaw) * -0.22, CURB_H + 0.75, bs.z + Math.cos(bs.yaw) * -0.22, -0.2, bs.yaw, 0, 1.8, 0.45, 0.05), new THREE.Color(0.42, 0.28, 0.16));
      for (const s of [-0.75, 0.75]) {
        const ox = Math.cos(bs.yaw) * s, oz = -Math.sin(bs.yaw) * s;
        metal.add(box, mtx(bs.x + ox, CURB_H + 0.22, bs.z + oz, 0, bs.yaw, 0, 0.06, 0.45, 0.45), darkC);
      }
    }
    // fountain
    if (this.fountain) {
      const f = this.fountain;
      metal.add(new THREE.CylinderGeometry(4.5, 4.7, 0.7, 40, 1, true), mtx(f.x, CURB_H + 0.35, f.z), new THREE.Color(0.6, 0.58, 0.55));
      metal.add(new THREE.TorusGeometry(4.6, 0.18, 6, 40), mtx(f.x, CURB_H + 0.7, f.z, Math.PI / 2, 0, 0), new THREE.Color(0.66, 0.64, 0.6));
      metal.add(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 16), mtx(f.x, CURB_H + 1.1, f.z), new THREE.Color(0.6, 0.58, 0.55));
      metal.add(new THREE.CylinderGeometry(1.6, 0.3, 0.4, 24), mtx(f.x, CURB_H + 2.3, f.z), new THREE.Color(0.6, 0.58, 0.55));
      const water = new THREE.Mesh(new THREE.CircleGeometry(4.45, 40), this.mats.fountainWater);
      water.rotation.x = -Math.PI / 2; water.position.set(f.x, CURB_H + 0.5, f.z);
      water.receiveShadow = true;
      this.group.add(water);
    }

    const m = this.mats;
    const furn = new THREE.Mesh(metal.merge(), m.street);
    furn.castShadow = true; furn.receiveShadow = true;
    this.group.add(furn);
    const lampHeads = new THREE.Mesh(heads.merge(), m.lampHead);
    this.group.add(lampHeads);
    const poolMesh = new THREE.Mesh(pools.toGeometry(), m.lightPool);
    poolMesh.renderOrder = 2;
    this.group.add(poolMesh);
    this.poolMesh = poolMesh;

    // signal lamps (instanced; colours updated as phases change)
    const lampGeo = new THREE.SphereGeometry(0.12, 10, 8);
    lampGeo.scale(1, 1, 0.5);
    const lamps = new THREE.InstancedMesh(lampGeo, m.signalLamp, lampSlots.length);
    const mm = new THREE.Matrix4();
    lampSlots.forEach((s, i) => {
      mm.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, 0)), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(i, mm);
      lamps.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    lamps.instanceMatrix.needsUpdate = true;
    lamps.computeBoundingSphere();
    this.group.add(lamps);
    this.signalLamps = lamps;
    this.lastSignalKey = '';
  }

  blockTypeAt(x, z) {
    const bi = Math.floor((x + CITY_HALF) / GRID), bj = Math.floor((z + CITY_HALF) / GRID);
    if (bi < 0 || bj < 0 || bi >= NB || bj >= NB) return 'none';
    return this.blocks[bj * NB + bi].type;
  }

  updateSignals(t) {
    const lamps = this.signalLamps;
    if (!lamps) return;
    const key = Math.floor(t * 2);
    if (key === this.lastSignalKey) return;
    this.lastSignalKey = key;
    const on = [new THREE.Color(4.0, 0.12, 0.06), new THREE.Color(4.0, 1.9, 0.1), new THREE.Color(0.15, 3.4, 1.4)];
    const off = [new THREE.Color(0.08, 0.01, 0.01), new THREE.Color(0.08, 0.05, 0.0), new THREE.Color(0.0, 0.06, 0.03)];
    for (const h of this.signalHeads) {
      const s = signalState(h.node, h.axis, t);
      const lit = s === 'R' ? 0 : s === 'Y' ? 1 : 2;
      for (let k = 0; k < 3; k++) lamps.setColorAt(h.idx + k, k === lit ? on[k] : off[k]);
    }
    lamps.instanceColor.needsUpdate = true;
  }
}
