// Drives an imported rigged humanoid (Mixamo, MakeHuman, VRoid, Unreal/Unity-style
// rigs...) from the game's procedural skeleton. Bones are matched by name keywords
// and left/right by position; rotations are transferred in the character's local
// frame with a per-bone rest alignment so T-pose and A-pose rigs both work.
import * as THREE from 'three';

const clean = (n) => n.toLowerCase().replace(/mixamorig\d*[:_]?|j_bip_[clr]_|^bip0?\d*[ _]?|def[-_]|^cc_base_|^rig[:_]/g, '').replace(/[^a-z0-9]/g, '');
const FINGER = /(thumb|index|middle|ring|pinky|little|finger|toe|twist|roll|end$|nub|ik(l|r)?$|pole|target|jaw|eye|tongue|breast|hair)/;

function role(n) {
  const s = clean(n);
  if (FINGER.test(s)) return null;
  if (/(^|left|right|^l|^r)ears?(l|r)?$/.test(s)) return null;
  if (/^(hips?|pelvis)$/.test(s) || /hips$/.test(s)) return 'hips';
  if (/neck/.test(s)) return 'neck';
  if (/head/.test(s) && !/top/.test(s)) return 'head';
  if (/(upleg|thigh|upperleg|uleg|leg01|upperleg01)/.test(s)) return 'thigh';
  if (/(calf|shin|lowerleg|knee|leg02|lowerleg01)/.test(s) || /^(left|right|l|r)?leg(l|r)?$/.test(s)) return 'shin';
  if (/(foot|ankle)/.test(s)) return 'foot';
  if (/(forearm|lowerarm|elbow|arm02|lowerarm01)/.test(s)) return 'forearm';
  if (/(hand|wrist)/.test(s)) return 'hand';
  if (/(shoulder|clavicle)/.test(s)) return 'shoulder';
  if (/(upperarm|arm01|upperarm01)/.test(s) || /^(left|right|l|r)?arm(l|r)?$/.test(s)) return 'upperArm';
  if (/(spine|chest|torso|abdomen|back)/.test(s)) return 'spine*';
  return null;
}

export class Retarget {
  constructor(human, modelRoot, charRoot) {
    this.human = human;
    this.model = modelRoot;
    this.charRoot = charRoot; // object both skeletons live under (player root)
    this.ok = false;
    const bones = [];
    modelRoot.traverse((o) => { if (o.isBone) bones.push(o); });
    if (bones.length < 10) return;
    // reset our skeleton to rest for binding
    for (const b of Object.values(human.bones)) b.quaternion.identity();
    human.bones.hips.position.set(0, 0.95, 0);
    charRoot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(charRoot.matrixWorld).invert();
    const local = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    const depth = (o) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
    // candidates by role
    const cand = {};
    for (const b of bones) { const r = role(b.name); if (r) (cand[r] ||= []).push(b); }
    const pick = (r, side) => {
      let list = cand[r] || [];
      if (side) list = list.filter((b) => Math.sign(local(b).x) === side);
      list.sort((a, b) => depth(a) - depth(b));
      return list[0] || null;
    };
    const map = {};
    map.hips = pick('hips') || bones.slice().sort((a, b) => depth(a) - depth(b))[0];
    const spines = (cand['spine*'] || []).filter((b) => local(b).y > local(map.hips).y - 0.01).sort((a, b) => depth(a) - depth(b));
    map.spine = spines[0] || null;
    map.chest = spines.length > 1 ? spines[spines.length - 1] : null;
    map.neck = pick('neck'); map.head = pick('head');
    for (const [side, sfx] of [[1, 'L'], [-1, 'R']]) {
      map['upperArm' + sfx] = pick('upperArm', side);
      map['forearm' + sfx] = pick('forearm', side);
      map['hand' + sfx] = pick('hand', side);
      map['thigh' + sfx] = pick('thigh', side);
      map['shin' + sfx] = pick('shin', side);
      map['foot' + sfx] = pick('foot', side);
    }
    const need = ['hips', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'thighL', 'thighR', 'shinL', 'shinR'];
    this.missing = need.filter((k) => !map[k]);
    if (this.missing.length) return;
    // chains for rest direction alignment
    const next = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', upperArmL: 'forearmL', forearmL: 'handL', upperArmR: 'forearmR', forearmR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR' };
    const qInv = new THREE.Quaternion().setFromRotationMatrix(inv);
    const rootQ = (o) => o.getWorldQuaternion(new THREE.Quaternion()).premultiply(qInv);
    this.items = [];
    const order = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
    for (const r of order) {
      const t = map[r], src = human.bones[r];
      if (!t || !src) continue;
      const srcRest = rootQ(src), tgtRest = rootQ(t);
      let align = new THREE.Quaternion();
      const n = next[r];
      if (n && map[n] && human.bones[n]) {
        const sd = local(human.bones[n]).sub(local(src)).normalize();
        const td = local(map[n]).sub(local(t)).normalize();
        align.setFromUnitVectors(td, sd);
      }
      this.items.push({ r, t, src, srcRestInv: srcRest.clone().invert(), tgtRest, align });
    }
    this.hipsT = map.hips;
    this.hipsRestChar = local(map.hips);
    const legT = local(map.thighL).distanceTo(local(map.shinL)) + local(map.shinL).distanceTo(local(map.footL || map.shinL));
    this.legRatio = legT / 0.83;
    this.qInv = qInv;
    this.ok = true;
    this._q = new THREE.Quaternion(); this._p = new THREE.Quaternion();
  }

  update() {
    if (!this.ok) return;
    const root = this.charRoot;
    root.updateMatrixWorld(true);
    const qInv = this._p.setFromRotationMatrix(new THREE.Matrix4().copy(root.matrixWorld).invert());
    for (const it of this.items) {
      // our bone's rotation relative to rest, in the character frame
      const srcNow = it.src.getWorldQuaternion(new THREE.Quaternion()).premultiply(qInv);
      const delta = srcNow.multiply(it.srcRestInv);
      const want = delta.multiply(it.align).multiply(it.tgtRest);
      const parentQ = it.t.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(qInv);
      it.t.quaternion.copy(parentQ.invert().multiply(want));
      it.t.updateMatrixWorld(true);
    }
    // hips height/offset follows the source (scaled by leg length)
    const hp = this.human.bones.hips.position;
    const p = this.hipsRestChar.clone().add(new THREE.Vector3(0, (hp.y - 0.95) * this.legRatio, hp.z * this.legRatio));
    root.localToWorld(p);
    this.hipsT.position.copy(this.hipsT.parent.worldToLocal(p));
  }
}
