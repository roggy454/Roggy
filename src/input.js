// Keyboard + mouse (pointer lock), gamepad and on-screen touch controls, unified into one state.
import { clamp } from './utils.js';

export class Input {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.locked = false;
    this.touch = { active: false, moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, buttons: new Set(), tapped: new Set() };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.sensitivity = 1;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      else if (this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    canvas.addEventListener('mousedown', () => {
      if (!this.locked && !this.isTouch && this.wantLock && this.lockAllowed?.()) this.requestLock();
      this.dragging = true; // drag-to-look fallback when pointer lock is unavailable
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });
    if (touchRoot) this.setupTouch(touchRoot);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* pointer lock unavailable: fall back to drag-to-look */ }
  }

  setupTouch(root) {
    const stick = root.querySelector('[data-stick]');
    const knob = root.querySelector('[data-knob]');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 56;
    root.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const btn = t.target.closest('[data-btn]');
        if (btn) {
          const b = btn.dataset.btn;
          this.touch.buttons.add(b); this.touch.tapped.add(b); btn.classList.add('on');
          btn.dataset.tid = t.identifier;
          continue;
        }
        if (t.clientX < innerWidth * 0.45 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = `${sx - 70}px`; stick.style.top = `${sy - 70}px`; stick.classList.add('on');
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.touch.moveX = dx / R; this.touch.moveY = -dy / R;
        } else if (t.identifier === lookId) {
          this.touch.lookDX += (t.clientX - lx) * 2.2; this.touch.lookDY += (t.clientY - ly) * 2.2;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null; this.touch.moveX = 0; this.touch.moveY = 0;
          knob.style.transform = 'translate(0,0)'; stick.classList.remove('on');
        } else if (t.identifier === lookId) lookId = null;
        root.querySelectorAll('[data-btn]').forEach((b) => {
          if (b.dataset.tid === String(t.identifier)) { this.touch.buttons.delete(b.dataset.btn); b.classList.remove('on'); delete b.dataset.tid; }
        });
      }
    };
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    this.gp = null;
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const prev = this.gpPrev || [];
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const tap = (i) => btn(i) && !prev[i];
    this.gp = {
      lx: dz(gp.axes[0] || 0), ly: dz(gp.axes[1] || 0), rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0),
      rt: gp.buttons[7]?.value || 0, lt: gp.buttons[6]?.value || 0,
      a: btn(0), b: btn(1), aTap: tap(0), yTap: tap(3), lbTap: tap(4), rbTap: tap(5), xTap: tap(2), backTap: tap(8), startTap: tap(9), lsTap: tap(10),
    };
    this.gpPrev = gp.buttons.map((b) => b.pressed);
  }

  down(code) { return this.keys.has(code); }
  tap(code) { return this.pressed.has(code); }

  // ---- unified queries ----
  get moveX() {
    let v = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    if (this.gp) v += this.gp.lx;
    v += this.touch.moveX;
    return clamp(v, -1, 1);
  }
  get moveY() {
    let v = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    if (this.gp) v -= this.gp.ly;
    v += this.touch.moveY;
    return clamp(v, -1, 1);
  }
  get sprint() { return this.down('ShiftLeft') || this.down('ShiftRight') || (this.gp && this.gp.a) || Math.hypot(this.touch.moveX, this.touch.moveY) > 0.95; }
  get walk() { return this.down('AltLeft') || this.down('ControlLeft'); }
  get jumpPressed() { return this.tap('Space') || (this.gp && this.gp.xTap) || this.touch.tapped.has('jump'); }
  // driving
  get throttle() {
    let v = this.down('KeyW') || this.down('ArrowUp') ? 1 : 0;
    if (this.gp) v = Math.max(v, this.gp.rt);
    if (this.touch.buttons.has('gas')) v = 1;
    v = Math.max(v, clamp(this.touch.moveY, 0, 1));
    return v;
  }
  get brake() {
    let v = this.down('KeyS') || this.down('ArrowDown') ? 1 : 0;
    if (this.gp) v = Math.max(v, this.gp.lt);
    if (this.touch.buttons.has('brake')) v = 1;
    v = Math.max(v, clamp(-this.touch.moveY, 0, 1));
    return v;
  }
  get steer() { return clamp(-this.moveX, -1, 1); } // positive = left
  get handbrake() { return this.down('Space') || (this.gp && this.gp.a) || this.touch.buttons.has('jump') ? 1 : 0; }
  get horn() { return this.down('KeyH') || (this.gp && this.gp.b) || this.touch.buttons.has('horn'); }
  get enterPressed() { return this.tap('KeyF') || this.tap('Enter') || (this.gp && this.gp.yTap) || this.touch.tapped.has('enter'); }
  get radioNext() { return this.tap('KeyE') || (this.gp && this.gp.rbTap) || this.touch.tapped.has('radio') || this.wheelStep > 0; }
  get radioPrev() { return this.tap('KeyQ') || (this.gp && this.gp.lbTap) || this.wheelStep < 0; }

  // camera look delta (pixels)
  look() {
    let dx = this.mouseDX + this.touch.lookDX, dy = this.mouseDY + this.touch.lookDY;
    if (this.gp) { dx += this.gp.rx * 14; dy += this.gp.ry * 10; }
    return { dx: dx * this.sensitivity, dy: dy * this.sensitivity, active: Math.abs(this.mouseDX) + Math.abs(this.touch.lookDX) > 0.5 || (this.gp && (Math.abs(this.gp.rx) + Math.abs(this.gp.ry)) > 0) };
  }

  beginFrame() {
    this.pollGamepad();
    this.wheelStep = this.wheel;
    this.wheel = 0;
  }
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0; this.mouseDY = 0;
    this.touch.lookDX = 0; this.touch.lookDY = 0;
    this.touch.tapped.clear();
  }
}
