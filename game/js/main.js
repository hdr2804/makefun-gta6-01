// SOLMAR: Sunset Getaway — main loop and wiring.
// Boots three.js, builds the city, traffic, pedestrians, police, missions,
// HUD and audio, then runs the frame loop: input -> player -> world ->
// police -> missions -> HUD -> render. Also owns the ?shot= scene composer
// (deterministic staged screenshots) and the window.__solmar test hooks the
// maker uses to playtest the full loop headlessly.
import * as THREE from 'three';
import { EventBus, makeRng, clamp, dist2d } from './rng.js';
import { GameState, PHASES, MISSIONS, CAR_MODELS } from './state.js';
import { buildCity, buildProps, CITY } from './city.js';
import { PlayerController, JUMP_PADS } from './vehicle.js';
import { TrafficSystem } from './traffic.js';
import { PedestrianSystem } from './pedestrians.js';
import { PoliceSystem } from './police.js';
import { MissionSystem } from './missions.js';
import { Activities } from './activities.js';
import { SkySystem } from './sky.js';
import { GaragePanel } from './garage.js';
import { Hud } from './hud.js';
import { AudioEngine } from './audio.js';
import { Effects, ChaseCamera } from './effects.js';
import { Input } from './input.js';
import { writeSave, readSave, applySave, hasSave, buyUpgrade, SHOP } from './save.js';

const SEED = 'solmar-city-v1';
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';

export const bus = new EventBus();
export const state = new GameState();
state.bus = bus;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);

let rng = makeRng(SEED);
const city = buildCity(scene, rng);
const props = buildProps(scene, rng, 46);
// Jump pads: low ramps the car can launch off for stunt airtime.
for (const pad of JUMP_PADS) {
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0xffd23d, emissive: 0xffd23d, emissiveIntensity: 0.35 }));
  ramp.position.set(pad.x, 0.25, pad.z); ramp.rotation.y = pad.dir; ramp.rotation.x = -0.18;
  ramp.castShadow = true; scene.add(ramp);
}

const player = new PlayerController(scene, state, bus, city.colliders, (kind, data) => {
  if (kind === 'steal-check') return stealCheck(data);
  return null;
});
const traffic = new TrafficSystem(scene, rng, state, bus);
const peds = new PedestrianSystem(scene, rng, state, bus);
const police = new PoliceSystem(scene, rng, state, bus);
const missions = new MissionSystem(scene, state, bus, player, traffic, peds);
const activities = new Activities(scene, state, bus, player);
const sky = new SkySystem(scene, rng);
const garage = new GaragePanel(state, bus, (t) => hud.toast(t));
const hud = new Hud(state, bus);
const audio = new AudioEngine(state, bus);
const effects = new Effects(scene);
const chaseCam = new ChaseCamera(camera, city.colliders);
const input = new Input();

traffic.setPlayer(player); peds.setPlayer(player); police.setPlayer(player);
player.parkedCars = traffic.cars;
hud.setWorld({ player, traffic, police, missions, city });
hud.update(missions);

traffic.seedInitial(16, 12);
peds.seedInitial(26);
police.seedInitial();

// Player starts on foot near the safehouse in free roam.
player.reset(-112, 112, Math.PI * 0.75);
player.setInCar(false);
chaseCam.snapTo(player);

let lastTime = performance.now();
let fpsAccum = 0, fpsCount = 0;
let pageErrors = 0;
window.addEventListener('error', () => { pageErrors++; });
window.addEventListener('unhandledrejection', () => { pageErrors++; });

// --- stealing: wanted +1 star when a police unit can see the theft -------
function stealCheck(car) {
  const s = state.s;
  const seen = police.anyUnitNearPlayer(45) || (police.heli ? true : false);
  if (seen) {
    state.addWanted(1, 'stolen in sight of police');
    hud.toast('STOLEN — the cops saw that!');
  } else if (s.wanted === 0) {
    hud.toast(car.model.name + ' — yours now. Keep it clean.');
  }
  s.carsStolen++;
  if (car.model.rare && !s.collectedCars.includes(car.model.id)) {
    s.collectedCars.push(car.model.id);
    hud.toast('RARE CAR: ' + car.model.name + ' added to your collection!');
  }
  return seen;
}

// --- phase transitions ----------------------------------------------------
function newGame() {
  const s = state.s;
  Object.assign(s, { cash: 250, totalEarned: 0, wanted: 0, heat: 0, missionIndex: -1, missionStage: 0, completedMissions: [], collectedCars: [], nearMisses: 0, stunts: 0, carsStolen: 0, copsDodged: 0, distanceDriven: 0, distanceWalked: 0, pedestriansBumped: 0, propsSmashed: 0, bestCombo: 0, combo: 0, result: null, upgrades: { engine: 0, armor: 0, brakes: 0, tires: 0 }, safehousePaidOff: false });
  missions.reset(); police.reset(makeRng(SEED + '-police')); traffic.reset(makeRng(SEED + '-traffic')); peds.reset(makeRng(SEED + '-peds'));
  activities.reset();
  player.parkedCars = traffic.cars;
  player.reset(-112, 112, Math.PI * 0.75);
  state.setPhase(PHASES.PLAYING);
  hud.hideTitle(); hud.hideResults(); hud.hidePause(); hud.showHud(true);
  hud.toast('Welcome to Solmar. Marisol is waiting — press M.');
  audio.ensure(); audio.resume();
  chaseCam.snapTo(player);
}
function continueGame() {
  const save = readSave();
  if (save) applySave(state, save);
  missions.reset();
  player.reset(-112, 112, Math.PI * 0.75);
  state.setPhase(PHASES.PLAYING);
  hud.hideTitle(); hud.hideResults(); hud.showHud(true);
  hud.toast('Back in Solmar. ' + state.s.completedMissions.length + '/6 jobs done.');
  audio.ensure(); audio.resume();
  chaseCam.snapTo(player);
}
function quitToTitle() {
  writeSave(state);
  missions.abortMission(true);
  state.setPhase(PHASES.TITLE);
  hud.hideResults(); hud.hidePause(); hud.hidePhone?.();
  hud.openPhone(false);
  hud.showHud(false);
  hud.showTitle(hasSave());
  player.reset(-112, 112, Math.PI * 0.75);
  chaseCam.snapTo(player);
}
function showResults(result, title, sub) {
  const s = state.s;
  s.result = result; s.resultTitle = title; s.resultSub = sub;
  s.stats = state.snapshotStats();
  state.setPhase(PHASES.RESULTS);
  writeSave(state);
  hud.showResults(result, s.stats, title, sub);
  audio.chime(result === 'win' ? [523, 659, 784, 1046, 1318] : [392, 330, 262, 196]);
}
function pauseGame() {
  if (state.phase !== PHASES.PLAYING) return;
  state.s.pausedFrom = 'playing';
  state.setPhase(PHASES.PAUSED);
  garage.render();
  hud.showPause(state.snapshotStats());
}
function resumeGame() {
  if (state.phase !== PHASES.PAUSED) return;
  state.setPhase(PHASES.PLAYING);
  hud.hidePause();
  audio.resume();
}

// --- bus reactions ---------------------------------------------------------
bus.on('game-win', () => {
  showResults('win', 'SOLMAR IS YOURS', 'The last job is done. Five stars, one boat, zero regrets. Marisol wires the final payout and the city goes quiet — for tonight.');
});
bus.on('busted', (info) => {
  if (state.phase !== PHASES.PLAYING) return;
  missions.abortMission(true);
  showResults('busted', 'BUSTED', (info && info.reason) || 'The Solmar PD took you in. Marisol posts bail — the jobs are still waiting.');
});
bus.on('wrecked', () => {
  if (state.phase !== PHASES.PLAYING) return;
  missions.abortMission(true);
  showResults('wrecked', 'WRECKED', 'Your car is scrap metal on Marina Row. Marisol sends a tow truck and a bill — the jobs are still waiting.');
});
bus.on('mission-complete', (m) => {
  hud.toast('JOB DONE — ' + m.payout + ' CASH' + (m.timeBonus ? ' (incl. $' + m.timeBonus + ' speed bonus)' : ''));
  effects.burst(player.pos.x, 2, player.pos.z, 'cash', 26, 2);
  writeSave(state);
});
bus.on('mission-failed', (m) => {
  hud.toast('JOB FAILED — ' + m.reason);
});
bus.on('crash', () => { effects.addShake(0.45); effects.burst(player.pos.x, 1, player.pos.z, 'spark', 10, 1.5); });
bus.on('rammed', () => { effects.addShake(0.6); });
bus.on('ped-hit', () => { effects.addShake(0.3); });
bus.on('drift', () => { effects.skidMark(player.pos.x, player.pos.z, player.heading, 0.8); });
bus.on('stunt', (n) => { effects.burst(player.pos.x, 2, player.pos.z, 'cash', 12, 2); });

// --- menu keys -------------------------------------------------------------
input.onKey = (code) => {
  audio.ensure();
  if (code === 'KeyM') {
    if (state.phase === PHASES.PLAYING) {
      const open = !hud.phoneOpen();
      if (open) hud.renderPhone(missions, (i) => { if (missions.startMission(i)) { hud.openPhone(false); } });
      hud.openPhone(open);
    }
  } else if (code === 'KeyP' || code === 'Escape') {
    if (state.phase === PHASES.PLAYING) pauseGame();
    else if (state.phase === PHASES.PAUSED) resumeGame();
  } else if (code === 'KeyE') {
    if (state.phase === PHASES.PLAYING) {
      if (player.inCar) player.exitCar();
      else {
        const car = traffic.nearestParked(player.pos.x, player.pos.z, 4.5);
        if (car) player.enterCar(car);
        else hud.setHint('No car close enough — walk to a parked car and press E.');
      }
    }
  } else if (code === 'KeyF') {
    if (state.phase === PHASES.PLAYING && !player.inCar) {
      state.s.punchesThrown++;
      const hit = peds.shoveAt(player.pos.x + Math.sin(player.heading) * 1.6, player.pos.z + Math.cos(player.heading) * 1.6, 2.2);
      if (hit > 0) { hud.toast('Shove! The street clears a path.'); state.addWanted(0, 'shove'); }
      effects.burst(player.pos.x + Math.sin(player.heading) * 1.6, 1.2, player.pos.z + Math.cos(player.heading) * 1.6, 'dust', 4, 0.5);
    }
  } else if (code === 'KeyR') {
    if (state.phase === PHASES.PLAYING) audio.cycleStation();
  } else if (code === 'KeyT') {
    if (state.phase === PHASES.PLAYING) {
      const near = activities.nearestTrialStart(8);
      if (near) activities.startTrial(near.id);
    }
  } else if (code === 'Enter') {
    if (state.phase === PHASES.PLAYING && !document.getElementById('briefing').classList.contains('hidden')) {
      missions.hideBriefing();
      hud.toast('Drive to the gold marker.');
    }
  } else if (code === 'KeyB') {
    // Safehouse shop: press B near the safehouse to buy the next upgrade.
    if (state.phase === PHASES.PLAYING && dist2d(player.pos.x, player.pos.z, CITY.landmarks.safehouse.x, CITY.landmarks.safehouse.z) < 18) {
      const next = SHOP.find(x => x.id !== 'safehouse' && (state.s.upgrades[x.id] || 0) < x.max) || SHOP[4];
      const res = buyUpgrade(state, next.id);
      hud.toast(res.reason);
    }
  }
};

document.getElementById('btn-new').addEventListener('click', () => { audio.ensure(); newGame(); });
document.getElementById('btn-continue').addEventListener('click', () => { audio.ensure(); continueGame(); });
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-quit-title').addEventListener('click', quitToTitle);
document.getElementById('btn-restart').addEventListener('click', () => { hud.hideResults(); newGame(); });
document.getElementById('btn-results-title').addEventListener('click', () => { hud.hideResults(); quitToTitle(); });

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- per-frame world update -------------------------------------------------
function updateWorld(dt) {
  const s = state.s;
  if (s.clockRunning) s.timeMinutes = (s.timeMinutes + dt * 0.35) % (24 * 60);
  player.update(dt, input);
  traffic.update(dt);
  peds.update(dt);
  police.update(dt);
  missions.update(dt);
  activities.update(dt);
  sky.update(dt, s.timeMinutes, city.sun);
  effects.update(dt);
  audio.update(dt, player);
  state.tickCombo(dt);
  // Prop smashing: driving through a live prop breaks it for combo points.
  if (player.inCar && Math.abs(player.speed) > 5) {
    for (const prop of props.props) {
      if (!prop.alive) continue;
      if (dist2d(player.pos.x, player.pos.z, prop.x, prop.z) < 1.8) {
        prop.alive = false; prop.mesh.visible = false;
        s.propsSmashed++;
        state.bumpCombo('smash', 1);
        effects.burst(prop.x, 1, prop.z, 'dust', 8, 1);
        if (Math.abs(player.speed) > 20) { player.damage(1, 'prop'); effects.addShake(0.15); }
      }
    }
  }
  // Safehouse zone: heat cools faster, and the car slowly repairs.
  if (dist2d(player.pos.x, player.pos.z, CITY.landmarks.safehouse.x, CITY.landmarks.safehouse.z) < 16) {
    s.heat = Math.max(0, s.heat - dt * 12);
    if (s.wanted === 0) s.carHealth = clamp(s.carHealth + dt * 4, 0, 100);
  }
  // Drifting skid marks.
  if (player.inCar && player.drift > 0.4 && Math.abs(player.speed) > 14) {
    effects.skidMark(player.pos.x, player.pos.z, player.heading, 0.7);
    effects.dust(player.pos.x, player.pos.z, player.speed);
  }
  hud.update(missions);
  chaseCam.update(dt, player, effects);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - lastTime) / 1000, 0.001, 0.05);
  lastTime = now;
  fpsAccum += dt; fpsCount++;
  if (state.phase === PHASES.PLAYING) updateWorld(dt);
  else if (state.phase === PHASES.TITLE) {
    // Slow cinematic orbit over the city behind the title screen.
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.05) * 150, 55 + Math.sin(t * 0.03) * 10, Math.cos(t * 0.05) * 150);
    camera.lookAt(0, 8, 0);
    traffic.update(0); // keep the streets alive behind the menu
  } else if (state.phase === PHASES.RESULTS || state.phase === PHASES.PAUSED) {
    chaseCam.update(dt, player, effects);
  }
  renderer.render(scene, camera);
  input.endFrame();
}

// --- ?shot= staged scenes for the screenshots ------------------------------
function applyShot() {
  if (!SHOT) return;
  hud.hideTitle();
  document.getElementById('loading').style.display = 'none';
  state.setPhase(PHASES.PLAYING);
  hud.showHud(true);
  if (SHOT === 'title') {
    state.setPhase(PHASES.TITLE);
    hud.showHud(false);
    hud.showTitle(false);
    document.getElementById('btn-continue').style.display = 'none';
    player.reset(64, 64, Math.PI * 0.9);
    player.setInCar(true, null);
    player.model = CAR_MODELS[4];
    player.repaint(CAR_MODELS[4]);
    player.pos.set(64, 0, 64);
    chaseCam.snapTo(player);
  } else if (SHOT === 'chase') {
    player.reset(0, 0, 0);
    const car = traffic.nearestParked(0, 0, 400) || traffic.cars[0];
    player.enterCar(car);
    player.speed = 24;
    state.missionComplete('m1-pickup'); state.missionComplete('m2-delivery'); state.missionComplete('m3-tail');
    missions.startMission(3);
    missions.hideBriefing();
    state.setWanted(3);
    missions.current.stage = 2; // escape stage: police already on the tail
    state.s.missionStage = 2;
    missions.moveMarkerTo(missions.stageTarget());
    player.pos.set(0, 0, 0);
    chaseCam.snapTo(player);
  } else if (SHOT === 'foot') {
    player.reset(92, -58, Math.PI);
    player.setInCar(false);
    missions.startMission(0);
    missions.hideBriefing();
    missions.spawnClient(98, -62, 0xffe1a0);
    missions.current.stage = 1; // pickup-wait: client standing by
    state.s.missionStage = 1;
    missions.moveMarkerTo(missions.stageTarget());
    player.pos.set(92, 0, -58);
    chaseCam.snapTo(player);
  } else if (SHOT === 'results') {
    state.s.cash = 6850; state.s.totalEarned = 6600;
    state.s.completedMissions = ['m1-pickup', 'm2-delivery', 'm3-tail', 'm4-heist', 'm5-ferry', 'm6-finale'];
    state.s.nearMisses = 23; state.s.stunts = 9; state.s.carsStolen = 14; state.s.bestCombo = 12;
    state.s.distanceDriven = 18420;
    showResults('win', 'SOLMAR IS YOURS', 'The last job is done. Five stars, one boat, zero regrets. Marisol wires the final payout and the city goes quiet — for tonight.');
    player.reset(96, 128, Math.PI * 0.9);
    chaseCam.snapTo(player);
  }
  // Let the staged scene settle for a beat before a screenshot is taken.
  const settleUntil = performance.now() + 900;
  const settle = (now) => {
    if (now < settleUntil) { updateWorld(0.016); renderer.render(scene, camera); requestAnimationFrame(settle); }
    else window.__solmarReady = true;
  };
  requestAnimationFrame(settle);
}

// --- test hooks --------------------------------------------------------------
window.__solmar = {
  state, bus, player, traffic, peds, police, missions, hud, input, activities, sky,
  version: 'solmar-1.0.0',
  getState: () => ({ phase: state.phase, cash: state.s.cash, wanted: state.s.wanted, missionsDone: state.s.completedMissions.slice(), mode: state.s.mode, onFoot: state.s.onFoot, speedMph: state.s.speedMph, carHealth: state.s.carHealth, result: state.s.result, pageErrors }),
  newGame, continueGame, quitToTitle, pauseGame, resumeGame,
  startMission: (i) => missions.startMission(i),
  setWanted: (n) => state.setWanted(n),
  teleport: (x, z) => { player.pos.set(x, 0, z); chaseCam.snapTo(player); },
  winMission: () => { if (missions.current) missions.completeMission(); },
  failMission: (r) => missions.failMission(r || 'test'),
  completeAllButFinal: () => { for (const m of MISSIONS.slice(0, 5)) state.missionComplete(m.id); },
  step: (secs) => { const n = Math.max(1, Math.round(secs * 60)); for (let i = 0; i < n; i++) updateWorld(1 / 60); return n; },
  pageErrors: () => pageErrors,
  fps: () => (fpsCount ? (fpsCount / fpsAccum).toFixed(1) : '0'),
};

document.getElementById('loading').style.display = 'none';
hud.showTitle(hasSave());
applyShot();
requestAnimationFrame(frame);
