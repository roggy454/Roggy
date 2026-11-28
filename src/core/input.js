// Keyboard + mouse (pointer lock) + gamepad + on-screen touch controls.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: new Set(), active: false };
    this.pad = null;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } }, { capture: true });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    canvas.addEventListener('click', () => { if (!this.locked && !this.touch.active) this.lock(); });
  }
  lock() { try { const p = this.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
  down(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.touch.look.x = 0; this.touch.look.y = 0; this.touch.buttonsHit?.clear(); }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (!this.pad) return;
    const p = this.pad;
    const prev = this._padPrev || [];
    const btn = (i) => p.buttons[i] && p.buttons[i].pressed;
    const map = { 3: 'KeyF', 0: 'Space', 1: 'KeyC', 2: 'KeyE', 9: 'Escape', 12: 'KeyQ', 13: 'KeyL', 8: 'KeyV', 5: 'KeyH' };
    for (const [i, code] of Object.entries(map)) {
      if (btn(+i) && !prev[i]) this.pressed.add(code);
    }
    this._padPrev = p.buttons.map((b) => b.pressed);
  }

  // unified axes
  axes() {
    let mx = 0, my = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) my += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) my -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) mx += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) mx -= 1;
    mx += this.touch.move.x; my += this.touch.move.y;
    let lx = this.mouseDX * 0.0025 + this.touch.look.x * 0.006, ly = this.mouseDY * 0.0025 + this.touch.look.y * 0.006;
    let throttle = 0, brake = 0;
    if (this.pad) {
      const a = this.pad.axes;
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      mx += dz(a[0]); my -= dz(a[1]);
      lx += dz(a[2]) * 0.05; ly += dz(a[3]) * 0.05;
      throttle = this.pad.buttons[7]?.value || 0;
      brake = this.pad.buttons[6]?.value || 0;
    }
    const sprint = this.down('ShiftLeft') || this.down('ShiftRight') || this.touch.buttons.has('sprint') || (this.pad?.buttons[10]?.pressed);
    const walk = this.down('ControlLeft') || this.down('AltLeft');
    const jump = this.hit('Space') || this.touch.buttonsHit?.has('jump');
    const handbrake = this.down('Space') || this.touch.buttons.has('brake') || (this.pad?.buttons[0]?.pressed);
    return { mx: Math.max(-1, Math.min(1, mx)), my: Math.max(-1, Math.min(1, my)), lx, ly, sprint, walk, jump, handbrake, throttle, brake };
  }

  setupTouch(root) {
    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (!isTouch) return false;
    this.touch.active = true;
    this.touch.buttonsHit = new Set();
    root.classList.add('touch');
    const stick = root.querySelector('#stick'), knob = root.querySelector('#knob');
    let stickId = null, lookId = null, sx = 0, sy = 0, lxp = 0, lyp = 0;
    const R = 55;
    stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; stickId = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.touch.move.x = dx / R; this.touch.move.y = -dy / R;
        } else if (t.identifier === lookId) {
          this.touch.look.x += t.clientX - lxp; this.touch.look.y += t.clientY - lyp;
          lxp = t.clientX; lyp = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.touch.move.x = 0; this.touch.move.y = 0; knob.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
    this.canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (lookId === null) { lookId = t.identifier; lxp = t.clientX; lyp = t.clientY; } }, { passive: true });
    for (const btn of root.querySelectorAll('[data-btn]')) {
      const name = btn.dataset.btn;
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.touch.buttons.add(name); this.touch.buttonsHit.add(name); if (btn.dataset.key) this.pressed.add(btn.dataset.key); }, { passive: false });
      btn.addEventListener('touchend', (e) => { e.preventDefault(); this.touch.buttons.delete(name); }, { passive: false });
    }
    return true;
  }
}
