// One input abstraction for the run. Whatever drives it (pose, keyboard, touch or
// the automated test hook), the simulation only reads: target lane, crouch level,
// and a one-shot jump trigger.
export class Input {
  constructor() {
    this.source = 'none';          // 'pose' | 'keys' | 'touch' | 'test'
    this.lane = 0;                 // -1 left · 0 centre · 1 right
    this.crouch = 0;               // 0 standing … 1 deep squat
    this._jump = false;
    this.tracking = { ok: true, reason: '' };
    this._keys = new Set();
    this._crouchTimer = 0;
    this._bound = false;
    this.enabled = false;
  }
  triggerJump() { if (this.enabled) this._jump = true; }
  consumeJump() { const j = this._jump; this._jump = false; return j; }
  setLane(l) { this.lane = Math.max(-1, Math.min(1, l | 0)); }
  setCrouch(v) { this.crouch = Math.max(0, Math.min(1, v)); }
  reset() { this.lane = 0; this.crouch = 0; this._jump = false; this._keys.clear(); this._crouchTimer = 0; }

  // Keyboard: ↑ / Space / W jump · ↓ / S / Shift crouch (hold) · ← → / A D lean (hold)
  attachKeyboard() {
    if (this._bound) return;
    this._bound = true;
    this._onDown = (e) => {
      if (!this.enabled || e.metaKey || e.ctrlKey) return;
      const k = e.key;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (k === 'ArrowUp' || k === ' ' || k === 'w' || k === 'W') { if (!e.repeat) this.triggerJump(); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'Shift') { this._keys.add('down'); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { this._keys.delete('right'); this._keys.add('left'); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { this._keys.delete('left'); this._keys.add('right'); e.preventDefault(); }
      else return;
      if (this.source !== 'pose') this.source = 'keys';
      this._applyKeys();
    };
    this._onUp = (e) => {
      const k = e.key;
      if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'Shift') this._keys.delete('down');
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') this._keys.delete('left');
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this._keys.delete('right');
      else return;
      this._applyKeys();
    };
    addEventListener('keydown', this._onDown);
    addEventListener('keyup', this._onUp);
    addEventListener('blur', () => { this._keys.clear(); this._applyKeys(); });
  }
  _applyKeys() {
    if (this.source === 'pose') return; // keys only nudge when pose isn't driving
    this.crouch = this._keys.has('down') ? 1 : (this._crouchTimer > 0 ? 1 : 0);
    this.lane = this._keys.has('left') ? -1 : this._keys.has('right') ? 1 : (this._touchLane || 0);
  }

  // Touch: swipe up jump · swipe down crouch · swipe left/right change lane (lanes persist).
  attachTouch(el) {
    let sx = 0, sy = 0, active = false, id = null;
    this._touchLane = 0;
    el.addEventListener('pointerdown', (e) => { if (!this.enabled) return; active = true; id = e.pointerId; sx = e.clientX; sy = e.clientY; }, { passive: true });
    const end = (e) => {
      if (!active || e.pointerId !== id) return;
      active = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.hypot(dx, dy) < 24) return;
      if (this.source !== 'pose') this.source = 'touch';
      if (Math.abs(dx) > Math.abs(dy)) { this._touchLane = Math.max(-1, Math.min(1, (this._touchLane || 0) + (dx > 0 ? 1 : -1))); }
      else if (dy < 0) this.triggerJump();
      else this._crouchTimer = 0.9;
      this._applyKeys();
    };
    el.addEventListener('pointerup', end, { passive: true });
    el.addEventListener('pointercancel', () => { active = false; }, { passive: true });
  }

  tick(dt) {
    if (this._crouchTimer > 0) { this._crouchTimer -= dt; if (this._crouchTimer <= 0) { this._crouchTimer = 0; this._applyKeys(); } }
  }
}
