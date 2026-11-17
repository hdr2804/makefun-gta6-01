// Side activities for SOLMAR: the things to do between Marisol's jobs.
// Sunset tokens — twelve glowing packages hidden around the city, each
// worth cash and a combo point. Checkpoint time trials — three short
// point-to-point races against the clock with cash prizes. And the garage
// ledger: every rare car the player steals and parks at the safehouse is
// recorded, and a full set pays a collector's bonus. All of it is optional,
// all of it pays, and none of it blocks the story.
import * as THREE from 'three';
import { makeRng, range, rangeInt, pick, clamp, dist2d } from './rng.js';
import { CITY } from './city.js';
import { CAR_MODELS } from './state.js';

export const TRIALS = [
  { id: 'trial-marina', name: 'Marina Sprint', from: { x: -96, z: 96 }, to: { x: 208, z: 160 }, timeLimit: 75, prize: 500 },
  { id: 'trial-downtown', name: 'Downtown Loop', from: { x: 0, z: 0 }, to: { x: 0, z: -192 }, timeLimit: 70, prize: 600 },
  { id: 'trial-coast', name: 'Coast Run', from: { x: -192, z: 192 }, to: { x: 192, z: 192 }, timeLimit: 80, prize: 700 },
];

const TOKEN_SPOTS = [
  { x: -192, z: -192 }, { x: 192, z: -192 }, { x: -192, z: 192 }, { x: 192, z: 160 },
  { x: 0, z: -192 }, { x: -64, z: 0 }, { x: 64, z: 128 }, { x: -128, z: -128 },
  { x: 128, z: -64 }, { x: 32, z: 96 }, { x: -32, z: 160 }, { x: 160, z: 0 },
];

export class Activities {
  constructor(scene, state, bus, player) {
    this.scene = scene; this.state = state; this.bus = bus; this.player = player;
    this.tokens = [];
    this.tokenGroup = new THREE.Group(); this.tokenGroup.name = 'solmar-tokens';
    scene.add(this.tokenGroup);
    this.trials = TRIALS.map(t => ({ ...t, active: false, timer: 0, best: null, done: false }));
    this.raceMarker = null;
    this.collectedTokens = 0;
    this.trialsWon = 0;
    this.garageBonusPaid = false;
    this.buildTokens();
    this.buildRaceMarker();
  }
  buildTokens() {
    const geo = new THREE.OctahedronGeometry(0.9);
    for (const spot of TOKEN_SPOTS) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd23d });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(spot.x, 1.6, spot.z);
      this.tokenGroup.add(mesh);
      this.tokens.push({ mesh, x: spot.x, z: spot.z, taken: false, spin: Math.random() * 6 });
    }
  }
  buildRaceMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.3, 10, 40), new THREE.MeshBasicMaterial({ color: 0x3de8ff }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 40, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x3de8ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 20; g.add(beam);
    g.visible = false;
    this.scene.add(g);
    this.raceMarker = g;
  }
  startTrial(id) {
    const trial = this.trials.find(t => t.id === id);
    if (!trial || trial.active) return false;
    if (!this.player.inCar) { this.bus.emit('toast', 'You need a car for a time trial.'); return false; }
    trial.active = true; trial.timer = trial.timeLimit;
    this.player.pos.set(trial.from.x, 0, trial.from.z);
    this.player.heading = Math.atan2(trial.to.x - trial.from.x, trial.to.z - trial.from.z);
    this.raceMarker.position.set(trial.to.x, 0, trial.to.z);
    this.raceMarker.visible = true;
    this.bus.emit('toast', trial.name + ' — ' + trial.timeLimit + ' seconds to the blue marker!');
    return true;
  }
  nearestTrialStart(maxD) {
    let best = null, bd = maxD;
    for (const t of this.trials) {
      if (t.active || t.done) continue;
      const d = dist2d(this.player.pos.x, this.player.pos.z, t.from.x, t.from.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  garageStatus() {
    const rare = CAR_MODELS.filter(m => m.rare).map(m => m.id);
    const owned = rare.filter(id => this.state.s.collectedCars.includes(id));
    return { owned: owned.length, total: rare.length, complete: owned.length === rare.length };
  }
  update(dt) {
    const s = this.state.s;
    if (s.phase !== 'playing') return;
    // Tokens spin and get collected.
    for (const tok of this.tokens) {
      if (tok.taken) continue;
      tok.spin += dt * 2;
      tok.mesh.rotation.y = tok.spin;
      tok.mesh.position.y = 1.6 + Math.sin(tok.spin * 1.4) * 0.35;
      if (dist2d(this.player.pos.x, this.player.pos.z, tok.x, tok.z) < 2.6) {
        tok.taken = true; tok.mesh.visible = false;
        this.collectedTokens++;
        const bonus = 150;
        this.state.addCash(bonus);
        this.state.bumpCombo('token', 1);
        this.bus.emit('toast', 'SUNSET TOKEN ' + this.collectedTokens + '/12 — +$' + bonus);
        if (this.collectedTokens === 12) {
          this.state.addCash(1000);
          this.bus.emit('toast', 'ALL 12 TOKENS — collector bonus +$1,000!');
        }
      }
    }
    // Garage set bonus.
    const g = this.garageStatus();
    if (g.complete && !this.garageBonusPaid) {
      this.garageBonusPaid = true;
      this.state.addCash(2000);
      this.bus.emit('toast', 'FULL RARE COLLECTION — Marisol pays a $2,000 finder bonus!');
    }
    // Active trial.
    for (const trial of this.trials) {
      if (!trial.active) continue;
      trial.timer -= dt;
      if (trial.timer <= 0) {
        trial.active = false; this.raceMarker.visible = false;
        this.bus.emit('toast', trial.name + ' — time up. Try again from the start line.');
        continue;
      }
      if (dist2d(this.player.pos.x, this.player.pos.z, trial.to.x, trial.to.z) < 7) {
        trial.active = false; trial.done = true; this.raceMarker.visible = false;
        const timeLeft = Math.round(trial.timer);
        const prize = trial.prize + timeLeft * 5;
        this.state.addCash(prize);
        this.trialsWon++;
        if (trial.best === null || timeLeft > trial.best) trial.best = timeLeft;
        this.bus.emit('toast', trial.name + ' WON — +$' + prize + ' (' + timeLeft + 's to spare)');
      }
    }
    // Hint when standing on a trial start line.
    const near = this.nearestTrialStart(8);
    if (near && this.player.inCar) {
      this.bus.emit('hint', 'Time trial here: ' + near.name + ' — press T to start');
    }
  }
  reset() {
    for (const tok of this.tokens) { tok.taken = false; tok.mesh.visible = true; }
    this.collectedTokens = 0; this.trialsWon = 0; this.garageBonusPaid = false;
    for (const t of this.trials) { t.active = false; t.done = false; t.best = null; }
    this.raceMarker.visible = false;
  }
  // Deterministic token layout check used by the playtest hooks.
  tokenCount() { return this.tokens.length; }
  tokensLeft() { return this.tokens.filter(t => !t.taken).length; }
}
