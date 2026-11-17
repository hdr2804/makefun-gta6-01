// Seeded random numbers and small math helpers for SOLMAR.
// Every deterministic system in the game (city layout, traffic spawns,
// pedestrian routes, mission markers) draws from these so a fixed seed
// always builds the same Solmar. Nothing here touches the DOM or three.js.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function makeRng(seedText) { return mulberry32(hashSeed(seedText)); }
export function range(rng, lo, hi) { return lo + rng() * (hi - lo); }
export function rangeInt(rng, lo, hi) { return Math.floor(range(rng, lo, hi + 1)); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function pickWeighted(rng, pairs) {
  let total = 0; for (const p of pairs) total += p[1];
  let roll = rng() * total;
  for (const p of pairs) { roll -= p[1]; if (roll <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(current, target, lambda, dt) { return lerp(current, target, 1 - Math.exp(-lambda * dt)); }
export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dist2d(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
export function formatCash(n) {
  const v = Math.max(0, Math.round(n));
  return '$' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return m + ':' + String(s).padStart(2, '0');
}
export function formatClock(minutes) {
  const h = Math.floor(minutes / 60) % 24, m = Math.floor(minutes % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
  return out;
}
// A tiny event bus so modules talk without importing each other in circles.
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
  emit(name, payload) { const list = this.handlers.get(name); if (list) for (const fn of list) { try { fn(payload); } catch (e) { console.error('bus', name, e); } } }
}
