// Ground level of the city: asphalt roads with markings, crosswalks, raised
// sidewalks with curbs, parks, parking lots, sandy beach + physics ground.
import * as THREE from 'three';
import { GeoBuilder } from '../core/geo.js';
import { makeWet } from './wet.js';
import {
  edges, nodes, slabs, grassRects, LAND, BEACH, HALF_ROAD, CURB_H, SIDEWALK_W, groundHeight, WATER_LEVEL, SEAFLOOR,
} from './map.js';

export function buildCity(scene, T, physics) {
  const roadB = new GeoBuilder({ uv1: true });
  const crossB = new GeoBuilder({ uv1: true });
  const interB = new GeoBuilder({ uv1: true });
  const walkB = new GeoBuilder();
  const grassB = new GeoBuilder();
  const lotB = new GeoBuilder({ uv1: true });
  const lineB = new GeoBuilder();

  const ROAD_Y = 0.0;
  // ---- roads
  for (const e of edges) {
    const dx = e.dx, dz = e.dz;
    const rx = -dz, rz = dx; // right of direction
    const sx = e.a.x + dx * HALF_ROAD, sz = e.a.z + dz * HALF_ROAD;
    const ex = e.b.x - dx * HALF_ROAD, ez = e.b.z - dz * HALF_ROAD;
    const L = e.len - 2 * HALF_ROAD;
    const W = HALF_ROAD;
    const P = (x, z) => [x, ROAD_Y, z];
    const world1 = (p) => [p[0] / 4, -p[2] / 4];
    const piece = (b, ax, az, bx, bz, uvs) => {
      // corners: a-left, a-right, b-right, b-left (CCW from above?)
      const aL = P(ax - rx * W, az - rz * W), aR = P(ax + rx * W, az + rz * W);
      const bR = P(bx + rx * W, bz + rz * W), bL = P(bx - rx * W, bz - rz * W);
      const pts = [aL, aR, bR, bL];
      // ensure CCW from above: compute signed area
      const area = (aR[0] - aL[0]) * (bR[2] - aL[2]) - (aR[2] - aL[2]) * (bR[0] - aL[0]);
      const u1 = pts.flatMap(world1);
      if (area < 0) b.quad(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], uvs, u1);
      else b.quad(pts[3], pts[2], pts[1], pts[0], [0, 1, 0], [uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3], uvs[0], uvs[1]], [u1[6], u1[7], u1[4], u1[5], u1[2], u1[3], u1[0], u1[1]]);
    };
    const C = 5;
    // middle
    const m0x = sx + dx * C, m0z = sz + dz * C, m1x = ex - dx * C, m1z = ez - dz * C;
    const vlen = (L - 2 * C) / 28;
    piece(roadB, m0x, m0z, m1x, m1z, [0, 0, 1, 0, 1, vlen, 0, vlen]);
    // crosswalk at b end: v=1 at intersection edge, u>0.5 on the right of a->b
    piece(crossB, m1x, m1z, ex, ez, [0, 0, 1, 0, 1, 1, 0, 1]);
    // crosswalk at a end: v=1 at a's edge, u>0.5 on the right of b->a (= left of a->b)
    piece(crossB, sx, sz, m0x, m0z, [1, 1, 0, 1, 0, 0, 1, 0]);
  }
  for (const n of nodes) {
    const x0 = n.x - HALF_ROAD, x1 = n.x + HALF_ROAD, z0 = n.z - HALF_ROAD, z1 = n.z + HALF_ROAD;
    interB.quad([x0, ROAD_Y, z1], [x1, ROAD_Y, z1], [x1, ROAD_Y, z0], [x0, ROAD_Y, z0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1],
      [x0 / 4, -z1 / 4, x1 / 4, -z1 / 4, x1 / 4, -z0 / 4, x0 / 4, -z0 / 4]);
  }

  // ---- slabs: sidewalk tops + curb sides (down to seafloor so waterfront edges read as seawalls)
  for (const s of slabs) {
    walkB.hRect(s.x0, s.z0, s.x1, s.z1, CURB_H, 3);
    walkB.box(s.x0, SEAFLOOR, s.z0, s.x1, CURB_H, s.z1, 3, 3, { top: false, px: true, nx: true, pz: true, nz: true });
    if (s.kind === 'parking') {
      const lx0 = s.x0 + SIDEWALK_W, lx1 = s.x1 - SIDEWALK_W, lz0 = s.z0 + SIDEWALK_W, lz1 = s.z1 - SIDEWALK_W;
      lotB.quad([lx0, CURB_H + 0.012, lz1], [lx1, CURB_H + 0.012, lz1], [lx1, CURB_H + 0.012, lz0], [lx0, CURB_H + 0.012, lz0], [0, 1, 0],
        [lx0 / 14, -lz1 / 14, lx1 / 14, -lz1 / 14, lx1 / 14, -lz0 / 14, lx0 / 14, -lz0 / 14],
        [lx0 / 4, -lz1 / 4, lx1 / 4, -lz1 / 4, lx1 / 4, -lz0 / 4, lx0 / 4, -lz0 / 4]);
      // bay lines: rows of stalls along x, 2.7m wide, 5.5m deep
      const rows = [lz0 + 5.5, lz0 + 5.5 + 7 + 5.5, lz1 - 5.5 - 7 - 5.5, lz1 - 5.5];
      s.stalls = [];
      for (const rz of rows) {
        for (let x = lx0 + 2; x + 2.7 < lx1 - 2; x += 2.7) {
          lineB.box(x - 0.06, CURB_H + 0.013, rz - 5.5, x + 0.06, CURB_H + 0.016, rz, 1, 1, { top: true });
          s.stalls.push({ x: x + 1.35, z: rz - 2.75 });
        }
      }
    }
  }
  for (const g of grassRects) {
    grassB.hRect(g.x0, g.z0, g.x1, g.z1, CURB_H + 0.01, 4);
    // paths across parks
    if (g.park) {
      const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2;
      walkB.hRect(cx - 1.5, g.z0, cx + 1.5, g.z1, CURB_H + 0.02, 3);
      walkB.hRect(g.x0, cz - 1.5, g.x1, cz + 1.5, CURB_H + 0.02, 3);
    }
  }

  // ---- materials
  const roadMat = makeWet(new THREE.MeshStandardMaterial({
    map: T.road.map, roughnessMap: T.road.rough, normalMap: T.asphaltNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1,
  }), { puddles: 1, porous: 0.5 });
  const crossMat = makeWet(new THREE.MeshStandardMaterial({
    map: T.roadCross.map, roughnessMap: T.roadCross.rough, normalMap: T.asphaltNormal, normalScale: new THREE.Vector2(0.9, 0.9),
  }), { puddles: 1, porous: 0.5 });
  const interMat = makeWet(new THREE.MeshStandardMaterial({
    map: T.roadInter.map, roughnessMap: T.roadInter.rough, normalMap: T.asphaltNormal, normalScale: new THREE.Vector2(0.9, 0.9),
  }), { puddles: 1, porous: 0.5 });
  T.road.map.wrapS = T.roadCross.map.wrapS = THREE.ClampToEdgeWrapping;
  const walkMat = makeWet(new THREE.MeshStandardMaterial({
    map: T.sidewalk.map, normalMap: T.sidewalk.normal, roughnessMap: T.sidewalk.rough, normalScale: new THREE.Vector2(1, 1),
  }), { puddles: 0.45, porous: 0.38 });
  const grassMat = makeWet(new THREE.MeshStandardMaterial({
    map: T.grass.map, normalMap: T.grass.normal, roughness: 0.95,
  }), { puddles: 0, porous: 0.35 });
  const lotMat = makeWet(new THREE.MeshStandardMaterial({
    map: T.roadInter.map, roughnessMap: T.roadInter.rough, normalMap: T.asphaltNormal,
  }), { puddles: 1, porous: 0.5 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.6 });

  const add = (b, mat, name, receive = true) => {
    const m = new THREE.Mesh(b.build(), mat);
    m.name = name; m.receiveShadow = receive;
    m.matrixAutoUpdate = false; m.updateMatrix();
    scene.add(m);
    return m;
  };
  add(roadB, roadMat, 'roads');
  add(crossB, crossMat, 'crosswalks');
  add(interB, interMat, 'intersections');
  add(walkB, walkMat, 'sidewalks');
  add(grassB, grassMat, 'lawns');
  add(lotB, lotMat, 'parking');
  add(lineB, lineMat, 'parkingLines');

  // ---- beach
  const bx0 = BEACH.x0, bx1 = BEACH.x1, bz0 = BEACH.z0, bz1 = BEACH.z1;
  const nx = 90, nz = 160;
  const bpos = [], buv = [], bcol = [], bidx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = bx0 + (bx1 - bx0) * Math.pow(i / nx, 1.0), z = bz0 + (bz1 - bz0) * (j / nz);
    const y = groundHeight(x + 0.01, z);
    bpos.push(x, y, z); buv.push(x / 6, -z / 6);
    const wetK = Math.max(0, Math.min(1, (0.35 - (y - WATER_LEVEL)) / 0.5));
    const k = 1 - wetK * 0.42;
    bcol.push(k, k * 0.97, k * 0.92);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    bidx.push(a, c, b, b, c, d);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
  bg.setIndex(bidx); bg.computeVertexNormals();
  const sandMat = makeWet(new THREE.MeshStandardMaterial({ map: T.sand.map, normalMap: T.sand.normal, vertexColors: true, roughness: 0.95 }), { puddles: 0, porous: 0.3 });
  const beach = new THREE.Mesh(bg, sandMat);
  beach.receiveShadow = true;
  scene.add(beach);
  // beach end walls
  const wallB = new GeoBuilder();
  wallB.box(bx0, SEAFLOOR, bz0 - 0.01, BEACH.xFlat, 0, bz0, 3, 3, { nz: true });
  wallB.box(bx0, SEAFLOOR, bz1, BEACH.xFlat, 0, bz1 + 0.01, 3, 3, { pz: true });
  add(wallB, walkMat, 'beachWalls');

  // ---- physics ground
  const P = physics;
  for (const l of LAND) P.addStaticBox((l.x0 + l.x1) / 2, -3, (l.z0 + l.z1) / 2, (l.x1 - l.x0) / 2, 3, (l.z1 - l.z0) / 2);
  for (const s of slabs) P.addStaticBox((s.x0 + s.x1) / 2, CURB_H / 2 - 0.5, (s.z0 + s.z1) / 2, (s.x1 - s.x0) / 2, CURB_H / 2 + 0.5, (s.z1 - s.z0) / 2);
  // beach slope: inclined box
  const slopeLen = (bx1 - BEACH.xFlat) / Math.cos(Math.atan(BEACH.slope));
  const ang = Math.atan(BEACH.slope);
  const midX = (BEACH.xFlat + bx1) / 2, midY = -(bx1 - BEACH.xFlat) * BEACH.slope / 2;
  const th = 2;
  P.addStaticBox(midX - Math.sin(ang) * th, midY - Math.cos(ang) * th, (bz0 + bz1) / 2, slopeLen / 2, th, (bz1 - bz0) / 2, P.mat.ground, 0, -ang);
  // seafloor
  P.addStaticBox(0, SEAFLOOR - 1, 0, 3000, 1, 3000);
  return { roadMat, walkMat, grassMat };
}
