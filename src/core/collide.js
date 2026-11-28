// Character/camera collision against static city geometry (2.5D: footprints with
// heights) using a uniform grid. Dynamic props & vehicles are handled separately.
const CELL = 16;

export class StaticCollision {
  constructor() {
    this.grid = new Map();
    this.boxes = [];
    this.circles = [];
  }
  key(cx, cz) { return cx * 92837111 ^ cz * 689287499; }
  insert(obj, x0, z0, x1, z1) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = this.key(cx, cz);
        let c = this.grid.get(k);
        if (!c) { c = []; this.grid.set(k, c); }
        c.push(obj);
      }
  }
  addBox(x0, z0, x1, z1, y0, y1) { const o = { t: 0, x0, z0, x1, z1, y0, y1 }; this.boxes.push(o); this.insert(o, x0, z0, x1, z1); }
  addCircle(x, z, r, y0, y1) { const o = { t: 1, x, z, r, y0, y1 }; this.circles.push(o); this.insert(o, x - r, z - r, x + r, z + r); }

  near(x, z) { return this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL))) || []; }

  // push point p (Vector3-like, at feet) with radius r out of obstacles
  resolve(p, r, h = 1.8) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const o of this.near(p.x, p.z)) {
        if (p.y > o.y1 - 0.05 || p.y + h < o.y0) continue;
        if (o.t === 0) {
          const cx = Math.max(o.x0, Math.min(p.x, o.x1)), cz = Math.max(o.z0, Math.min(p.z, o.z1));
          const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
            else { // inside: push to nearest side
              const l = p.x - o.x0, rr = o.x1 - p.x, t = p.z - o.z0, b = o.z1 - p.z;
              const m = Math.min(l, rr, t, b);
              if (m === l) p.x = o.x0 - r; else if (m === rr) p.x = o.x1 + r; else if (m === t) p.z = o.z0 - r; else p.z = o.z1 + r;
            }
            hit = true;
          }
        } else {
          const dx = p.x - o.x, dz = p.z - o.z, rr = r + o.r, d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = o.x + dx / d * rr; p.z = o.z + dz / d * rr; hit = true; }
        }
      }
    }
    return hit;
  }

  // segment a->b against boxes; returns fraction of first hit (1 = clear)
  segment(a, b, pad = 0.3) {
    let tMin = 1;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / CELL) + 1;
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      for (const o of this.near(x, z)) {
        if (o.t !== 0 || seen.has(o)) continue;
        seen.add(o);
        const hit = rayBox(a, b, o.x0 - pad, o.y0 - pad, o.z0 - pad, o.x1 + pad, o.y1 + pad, o.z1 + pad);
        if (hit !== null && hit < tMin) tMin = hit;
      }
    }
    return tMin;
  }
}

function rayBox(a, b, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = 1;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return null; continue; }
    let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
