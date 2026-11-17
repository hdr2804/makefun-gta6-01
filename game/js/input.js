// Keyboard + mouse input for SOLMAR. One normalized input object is read
// by the player controller each frame: up/down/left/right, handbrake,
// sprint, and edge-triggered actions (enter car, phone, pause, radio,
// shove, accept). Keys are also exposed as a set for the debug/test hooks.
// Mouse: click the phone job cards; the camera is fixed chase, so the mouse
// is for menus only — driving stays on the keyboard, as the bounty asks.
export class Input {
  constructor() {
    this.up = false; this.down = false; this.left = false; this.right = false;
    this.handbrake = false; this.sprint = false;
    this.pressed = new Set(); // edge-triggered keys, consumed once per frame
    this.keys = new Set();
    this.enabled = true;
    this.onKey = null; // (code) => void, set by main.js for menu keys
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (this.onKey) this.onKey(e.code);
      }
      this.keys.add(e.code);
      this.sync();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.sync(); });
    window.addEventListener('blur', () => { this.keys.clear(); this.sync(); });
  }
  sync() {
    const k = this.keys;
    this.up = k.has('KeyW') || k.has('ArrowUp');
    this.down = k.has('KeyS') || k.has('ArrowDown');
    this.left = k.has('KeyA') || k.has('ArrowLeft');
    this.right = k.has('KeyD') || k.has('ArrowRight');
    this.handbrake = k.has('Space');
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  }
  consume(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }
  endFrame() { this.pressed.clear(); }
  // Test/automation hook: pretend a key is held or tapped.
  inject(code, down) {
    if (down) { this.keys.add(code); if (!this.pressed.has(code)) this.pressed.add(code); }
    else this.keys.delete(code);
    this.sync();
  }
  releaseAll() { this.keys.clear(); this.pressed.clear(); this.sync(); }
}
