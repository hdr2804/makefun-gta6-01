// Central game state for SOLMAR: one plain object every system reads and
// writes, plus the phase machine (title -> playing -> paused -> results).
// No rendering here: hud.js and main.js observe this state each frame.
import { clamp } from './rng.js';

export const PHASES = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', RESULTS: 'results' };
export const SAVE_KEY = 'solmar-sunset-getaway-save-v1';

export function freshState() {
  return {
    phase: PHASES.TITLE,
    mode: 'free', // 'free' | 'mission'
    timeMinutes: 18 * 60 + 42, // golden hour, frozen at the start of a shot
    clockRunning: true,
    cash: 250,
    totalEarned: 0,
    wanted: 0,
    heat: 0, // 0..100, feeds wanted decay and police aggression
    playerHealth: 100,
    carHealth: 100,
    onFoot: true,
    speedMph: 0,
    gear: 'PARK',
    radioStation: 0,
    radioOn: true,
    missionIndex: -1,
    missionStage: 0,
    missionTimer: 0,
    missionElapsed: 0,
    completedMissions: [],
    collectedCars: [], // model ids parked in the safehouse garage
    nearMisses: 0,
    stunts: 0,
    carsStolen: 0,
    copsDodged: 0,
    distanceDriven: 0,
    distanceWalked: 0,
    pedestriansBumped: 0,
    propsSmashed: 0,
    shotsFired: 0,
    punchesThrown: 0,
    bestCombo: 0,
    combo: 0,
    comboTimer: 0,
    result: null, // 'win' | 'busted' | 'wrecked' | 'failed'
    resultTitle: '',
    resultSub: '',
    stats: null,
    pausedFrom: null,
    storyFlags: { metMarisol: false, rivalSpotted: false, heistDone: false, marinaUnlocked: false },
    upgrades: { engine: 0, armor: 0, brakes: 0, tires: 0 },
    garage: [],
    safehousePaidOff: false,
    muted: false,
  };
}

export class GameState {
  constructor() { this.s = freshState(); this.bus = null; }
  get phase() { return this.s.phase; }
  setPhase(p) { this.s.phase = p; if (this.bus) this.bus.emit('phase', p); }
  addCash(n) {
    this.s.cash += n;
    if (n > 0) this.s.totalEarned += n;
    if (this.bus) this.bus.emit('cash', this.s.cash);
  }
  addWanted(n, reason) {
    const before = this.s.wanted;
    this.s.wanted = clamp(this.s.wanted + n, 0, 5);
    this.s.heat = clamp(this.s.heat + n * 22, 0, 100);
    if (this.s.wanted !== before && this.bus) this.bus.emit('wanted', { level: this.s.wanted, reason: reason || '' });
  }
  setWanted(n) {
    this.s.wanted = clamp(Math.round(n), 0, 5);
    this.s.heat = this.s.wanted * 20;
    if (this.bus) this.bus.emit('wanted', { level: this.s.wanted, reason: 'set' });
  }
  decayWanted(dt, hidden) {
    if (this.s.wanted <= 0) return;
    this.s.heat = clamp(this.s.heat - dt * (hidden ? 9 : 3.5), 0, 100);
    if (this.s.heat <= 0) { this.s.wanted = Math.max(0, this.s.wanted - 1); this.s.heat = this.s.wanted > 0 ? 60 : 0; if (this.bus) this.bus.emit('wanted', { level: this.s.wanted, reason: 'cooled' }); }
  }
  bumpCombo(kind, amount) {
    this.s.combo += amount || 1;
    this.s.comboTimer = 6;
    this.s.bestCombo = Math.max(this.s.bestCombo, this.s.combo);
    if (this.bus) this.bus.emit('combo', { kind, combo: this.s.combo });
  }
  tickCombo(dt) {
    if (this.s.comboTimer > 0) { this.s.comboTimer -= dt; if (this.s.comboTimer <= 0) this.s.combo = 0; }
  }
  missionComplete(id) { if (!this.s.completedMissions.includes(id)) this.s.completedMissions.push(id); }
  missionDone(id) { return this.s.completedMissions.includes(id); }
  snapshotStats() {
    return {
      cash: this.s.cash, earned: this.s.totalEarned, missions: this.s.completedMissions.length,
      nearMisses: this.s.nearMisses, stunts: this.s.stunts, carsStolen: this.s.carsStolen,
      copsDodged: this.s.copsDodged, distanceDriven: Math.round(this.s.distanceDriven),
      distanceWalked: Math.round(this.s.distanceWalked), propsSmashed: this.s.propsSmashed,
      bestCombo: this.s.bestCombo, wantedPeak: this.s.wanted,
    };
  }
}

// The story: six chained jobs from fixer Marisol Vega. Each entry carries
// everything missions.js needs: briefing copy, target spots in the city,
// timers, payouts and the wanted level the job starts with.
export const MISSIONS = [
  {
    id: 'm1-pickup', name: 'FIRST FARE', short: 'Pickup', pay: 400, wantedStart: 0,
    briefing: 'Marisol: "Rookie run. A friend of mine is waiting outside the Coral Court hotel on Marina Row. Pick him up, bring him to the safehouse on Palm Court. No heat, no hurry — just don\'t keep him waiting."',
    objective: 'Pick up the client at Coral Court, then drop him at the safehouse.',
    stages: ['drive-to-pickup', 'pickup-wait', 'drive-to-dropoff', 'done'],
    pickup: { x: 96, z: -96 }, dropoff: { x: -96, z: 96 }, timeLimit: 240,
    intro: 'Marisol Vega — fixer. First job, first fare.',
  },
  {
    id: 'm2-delivery', name: 'HOT PACKAGE', short: 'Delivery', pay: 750, wantedStart: 0,
    briefing: 'Marisol: "A package needs to cross town before the courier vans do. Coral Court to the fish market on Dockside, eight minutes. The package is fragile. The traffic is not. Drive like the clock is a cop."',
    objective: 'Deliver the package to Dockside Market before the timer runs out.',
    stages: ['drive-to-dropoff', 'done'],
    pickup: { x: 96, z: -96 }, dropoff: { x: 160, z: 128 }, timeLimit: 200,
    intro: 'Timed delivery. The city is the deadline.',
  },
  {
    id: 'm3-tail', name: 'QUIET SHADOW', short: 'Tail', pay: 900, wantedStart: 0,
    briefing: 'Marisol: "Rico Dalmore thinks he can cut me out of the marina deal. Follow his sedan from the Sunset Plaza garage. Stay close enough to see him, far enough that he never sees you. If he spots you, the job is blown."',
    objective: 'Tail Rico\'s sedan without being spotted. Keep 25–70 m behind him.',
    stages: ['tail', 'done'],
    pickup: { x: -32, z: -96 }, dropoff: { x: 128, z: 32 }, timeLimit: 300,
    intro: 'A tail job. Patience is the weapon.',
  },
  {
    id: 'm4-heist', name: 'THE SUNSET JOB', short: 'Heist', pay: 1600, wantedStart: 2,
    briefing: 'Marisol: "Tonight we take the Sunset Plaza vault. You drive, we grab, the whole city wakes up. Two stars the second we leave the garage — maybe three. Get us to the safehouse and nobody remembers your face."',
    objective: 'Grab the crew at Sunset Plaza, then lose the police and reach the safehouse.',
    stages: ['drive-to-pickup', 'escape', 'lose-heat', 'drive-to-dropoff', 'done'],
    pickup: { x: -32, z: -96 }, dropoff: { x: -96, z: 96 }, timeLimit: 420,
    intro: 'The heist. Two stars before the engine warms up.',
  },
  {
    id: 'm5-ferry', name: 'THROUGH THE LINE', short: 'Ferry', pay: 1400, wantedStart: 3,
    briefing: 'Marisol: "A client with a price on his head needs to cross town while the whole department is awake. Three stars, roadblocks on the avenues. Thread the side streets, punch through the line, get him to the marina gate alive."',
    objective: 'Ferry the client across town through the roadblocks to the marina gate.',
    stages: ['drive-to-pickup', 'drive-to-dropoff', 'done'],
    pickup: { x: -96, z: -32 }, dropoff: { x: 160, z: -96 }, timeLimit: 360,
    intro: 'Three stars. One client. No detours.',
  },
  {
    id: 'm6-finale', name: 'LAST LIGHT', short: 'Finale', pay: 3000, wantedStart: 4,
    briefing: 'Marisol: "Last job, driver. Rico\'s crew, the department, the whole city — five stars, a helicopter, everything. Take the crew from the marina yard to the boat at the end of the pier. Do this and you are out. Do this and Solmar is yours."',
    objective: 'Cross the city at 5 stars and reach the marina boat. Do not get busted.',
    stages: ['drive-to-pickup', 'drive-to-dropoff', 'done'],
    pickup: { x: 160, z: -96 }, dropoff: { x: 208, z: 160 }, timeLimit: 480,
    intro: 'Five stars. One boat. The last light of Solmar.',
  },
];

export const RADIO_STATIONS = [
  { id: 'solmar-fm', name: 'SOLMAR FM', desc: 'Sunset pop — bright chords, driving bass', bpm: 112, root: 220, mode: 'major' },
  { id: 'neon-nights', name: 'NEON NIGHTS', desc: 'Late synthwave — minor pads, night pulse', bpm: 96, root: 196, mode: 'minor' },
  { id: 'harbor-blues', name: 'HARBOR BLUES', desc: 'Slow harbor blues — swung, warm, tired', bpm: 78, root: 174.6, mode: 'blues' },
  { id: 'palm-static', name: 'PALM STATIC', desc: 'Lo-fi static — dusty loops, vinyl crackle', bpm: 84, root: 207.6, mode: 'major' },
];

export const CAR_MODELS = [
  { id: 'comet', name: 'Comet GT', color: 0xff5a3c, topSpeed: 62, accel: 26, handling: 1.15, rare: false },
  { id: 'islander', name: 'Islander', color: 0x3fa7ff, topSpeed: 48, accel: 18, handling: 1.0, rare: false },
  { id: 'duchess', name: 'Duchess', color: 0xc9a0ff, topSpeed: 54, accel: 21, handling: 1.05, rare: false },
  { id: 'sunrunner', name: 'Sunrunner', color: 0xffd23d, topSpeed: 58, accel: 24, handling: 1.1, rare: true },
  { id: 'barracuda', name: 'Barracuda', color: 0x2ee6a8, topSpeed: 66, accel: 28, handling: 1.2, rare: true },
  { id: 'vagabond', name: 'Vagabond Van', color: 0xd8d3c8, topSpeed: 44, accel: 15, handling: 0.85, rare: false },
];
