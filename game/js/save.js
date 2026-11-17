// Save / load for SOLMAR: one localStorage slot holding cash, completed
// jobs, the garage collection, upgrades and the player's last spot. Saves
// are written on mission complete, on entering the safehouse zone, and on
// quit-to-title. A corrupt or missing slot simply starts a fresh game —
// the title screen shows CONTINUE only when a valid save exists.
import { SAVE_KEY } from './state.js';

export function serializeSave(state) {
  const s = state.s;
  return {
    version: 1,
    savedAt: Date.now(),
    cash: s.cash,
    totalEarned: s.totalEarned,
    completedMissions: s.completedMissions.slice(),
    collectedCars: s.collectedCars.slice(),
    upgrades: { ...s.upgrades },
    garage: s.garage.slice(),
    safehousePaidOff: s.safehousePaidOff,
    storyFlags: { ...s.storyFlags },
    stats: state.snapshotStats(),
  };
}

export function writeSave(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeSave(state)));
    return true;
  } catch (e) { console.warn('save failed', e); return false; }
}

export function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || typeof data.cash !== 'number') return null;
    return data;
  } catch (e) { console.warn('save unreadable', e); return null; }
}

export function applySave(state, data) {
  const s = state.s;
  s.cash = data.cash;
  s.totalEarned = data.totalEarned || 0;
  s.completedMissions = Array.isArray(data.completedMissions) ? data.completedMissions.slice() : [];
  s.collectedCars = Array.isArray(data.collectedCars) ? data.collectedCars.slice() : [];
  s.upgrades = { engine: 0, armor: 0, brakes: 0, tires: 0, ...(data.upgrades || {}) };
  s.garage = Array.isArray(data.garage) ? data.garage.slice() : [];
  s.safehousePaidOff = !!data.safehousePaidOff;
  s.storyFlags = { metMarisol: false, rivalSpotted: false, heistDone: false, marinaUnlocked: false, ...(data.storyFlags || {}) };
  if (data.stats) {
    s.nearMisses = data.stats.nearMisses || 0;
    s.stunts = data.stats.stunts || 0;
    s.carsStolen = data.stats.carsStolen || 0;
    s.copsDodged = data.stats.copsDodged || 0;
    s.distanceDriven = data.stats.distanceDriven || 0;
    s.distanceWalked = data.stats.distanceWalked || 0;
    s.propsSmashed = data.stats.propsSmashed || 0;
    s.bestCombo = data.stats.bestCombo || 0;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
}

export function hasSave() { return readSave() !== null; }

// The safehouse shop: spend earnings on car upgrades and the garage.
// Buying is a pure state change; the HUD toast confirms it.
export const SHOP = [
  { id: 'engine', name: 'Engine tune +9% top speed', cost: 600, max: 3 },
  { id: 'armor', name: 'Armor plating −12% damage', cost: 500, max: 3 },
  { id: 'brakes', name: 'Race brakes', cost: 350, max: 2 },
  { id: 'tires', name: 'Grip tires +6% handling', cost: 400, max: 3 },
  { id: 'safehouse', name: 'Pay off the safehouse', cost: 1500, max: 1 },
];

export function buyUpgrade(state, id) {
  const item = SHOP.find(x => x.id === id);
  if (!item) return { ok: false, reason: 'No such upgrade.' };
  const s = state.s;
  if (id === 'safehouse') {
    if (s.safehousePaidOff) return { ok: false, reason: 'The safehouse is already yours.' };
    if (s.cash < item.cost) return { ok: false, reason: 'Not enough cash — ' + item.cost + ' needed.' };
    s.cash -= item.cost; s.safehousePaidOff = true;
    writeSave(state);
    return { ok: true, reason: 'Safehouse paid off. The cops cannot touch you here.' };
  }
  const level = s.upgrades[id] || 0;
  if (level >= item.max) return { ok: false, reason: item.name + ' is maxed out.' };
  const cost = item.cost * (level + 1);
  if (s.cash < cost) return { ok: false, reason: 'Not enough cash — ' + cost + ' needed.' };
  s.cash -= cost; s.upgrades[id] = level + 1;
  writeSave(state);
  return { ok: true, reason: item.name + ' installed (level ' + (level + 1) + ').' };
}
