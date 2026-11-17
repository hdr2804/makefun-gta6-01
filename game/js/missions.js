// Missions for SOLMAR: six chained jobs from fixer Marisol Vega, driven by
// the MISSIONS table in state.js. Each mission is a small stage machine with
// a briefing card, a glowing objective marker in the world, a HUD objective
// line with live distance, timers, a tail target car for the shadow job, and
// success / fail screens with payout. The final job pays out and ends the
// game on the results screen; failing any job returns the player to free
// roam so the story can be retried from the phone.
import * as THREE from 'three';
import { clamp, dist2d } from './rng.js';
import { CITY, nearestRoadPoint } from './city.js';
import { MISSIONS } from './state.js';
import { buildCarMesh } from './vehicle.js';

export class MissionSystem {
  constructor(scene, state, bus, playerRef, trafficRef, pedsRef) {
    this.scene = scene; this.state = state; this.bus = bus;
    this.player = playerRef; this.traffic = trafficRef; this.peds = pedsRef;
    this.current = null; // {def, stage, timer, target, tailCar, clientMesh, pickedUp}
    this.marker = null; this.beacon = null; this.arrow = null;
    this.clientMesh = null;
    this.tailCar = null;
    this.buildMarker();
  }
  buildMarker() {
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.28, 10, 40), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; this.marker.add(ring);
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 42, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    this.beacon.position.y = 21; this.marker.add(this.beacon);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.8, 12), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
    cone.rotation.x = Math.PI; cone.position.y = 4.4; this.marker.add(cone);
    this.marker.visible = false;
    this.scene.add(this.marker);
    // Floating arrow that always points at the objective from the player.
    this.arrow = new THREE.Group();
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 4), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
    head.rotation.x = Math.PI / 2; this.arrow.add(head);
    this.arrow.visible = false;
    this.scene.add(this.arrow);
  }
  availableMissions() {
    const done = this.state.s.completedMissions;
    return MISSIONS.map((m, i) => ({
      def: m, index: i,
      done: done.includes(m.id),
      locked: i > 0 && !done.includes(MISSIONS[i - 1].id),
    }));
  }
  startMission(index) {
    const def = MISSIONS[index];
    if (!def) return false;
    if (index > 0 && !this.state.missionDone(MISSIONS[index - 1].id)) return false;
    if (this.current) this.abortMission(true);
    const s = this.state.s;
    s.mode = 'mission'; s.missionIndex = index; s.missionStage = 0;
    s.missionTimer = def.timeLimit; s.missionElapsed = 0;
    this.state.setWanted(def.wantedStart);
    this.current = { def, stage: 0, timer: def.timeLimit, pickedUp: false, tailSpotted: 0, tailDistance: 0 };
    this.showBriefing(def);
    this.bus.emit('mission-start', { id: def.id, name: def.name });
    this.moveMarkerTo(this.stageTarget());
    return true;
  }
  showBriefing(def) {
    const b = document.getElementById('briefing');
    document.getElementById('briefing-title').textContent = def.name + ' — ' + def.pay + ' CASH';
    document.getElementById('briefing-text').textContent = def.briefing;
    b.classList.remove('hidden');
    this.bus.emit('briefing', { id: def.id });
  }
  hideBriefing() { document.getElementById('briefing').classList.add('hidden'); }
  stageName() {
    if (!this.current) return '';
    return this.current.def.stages[this.current.stage] || 'done';
  }
  stageTarget() {
    if (!this.current) return null;
    const def = this.current.def, stage = this.stageName();
    // Pickups and drop-offs sit at landmarks inside blocks; the marker and
    // the completion check live on the nearest road (the curb), where a car
    // can actually stop — the building's own collider keeps cars 17 m out.
    if (stage === 'drive-to-pickup' || stage === 'pickup-wait') return nearestRoadPoint(def.pickup.x, def.pickup.z);
    if (stage === 'drive-to-dropoff') return nearestRoadPoint(def.dropoff.x, def.dropoff.z);
    if (stage === 'tail') return this.tailCar ? { x: this.tailCar.pos.x, z: this.tailCar.pos.z } : def.dropoff;
    if (stage === 'escape' || stage === 'lose-heat') return nearestRoadPoint(def.dropoff.x, def.dropoff.z);
    return nearestRoadPoint(def.dropoff.x, def.dropoff.z);
  }
  moveMarkerTo(target) {
    if (!target) { this.marker.visible = false; this.arrow.visible = false; return; }
    this.marker.position.set(target.x, 0, target.z);
    this.marker.visible = true; this.arrow.visible = true;
  }
  spawnClient(x, z, shirt) {
    this.clearClient();
    const { buildPedestrianMesh } = { buildPedestrianMesh: null };
    // Client is a pedestrian mesh built inline to avoid a circular import.
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), new THREE.MeshStandardMaterial({ color: shirt ?? 0xffe1a0 }));
    torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9a06a }));
    head.position.y = 1.75; g.add(head);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a2a3a }));
    legL.position.set(-0.15, 0.4, 0); g.add(legL);
    const legR = legL.clone(); legR.position.x = 0.15; g.add(legR);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.clientMesh = g;
    return g;
  }
  clearClient() { if (this.clientMesh) { this.scene.remove(this.clientMesh); this.clientMesh = null; } }
  spawnTailCar() {
    if (this.tailCar) return this.tailCar;
    const mesh = buildCarMesh({ id: 'rival', name: 'Rival Sedan', color: 0x8a2a3a, topSpeed: 55, accel: 20, handling: 1.0 }, false);
    const def = this.current.def;
    mesh.position.set(def.pickup.x, 0, def.pickup.z);
    this.scene.add(mesh);
    this.tailCar = {
      mesh, model: { id: 'rival', name: 'Rival Sedan', color: 0x8a2a3a },
      pos: new THREE.Vector3(def.pickup.x, 0, def.pickup.z), heading: 0,
      speed: 0, targetSpeed: 11, moving: true, taken: false,
      route: this.tailRoute(), routeIndex: 0,
    };
    return this.tailCar;
  }
  tailRoute() {
    // Rico drives a lazy loop across town: plaza -> docks -> marina gate.
    return [
      { x: -32, z: -32 }, { x: 32, z: -32 }, { x: 64, z: 32 }, { x: 128, z: 32 },
      { x: 128, z: 96 }, { x: 64, z: 128 }, { x: 32, z: 64 }, { x: 128, z: 32 },
    ];
  }
  clearTailCar() {
    if (this.tailCar) { this.scene.remove(this.tailCar.mesh); this.tailCar = null; }
  }
  advanceStage() {
    const c = this.current; if (!c) return;
    c.stage++;
    this.state.s.missionStage = c.stage;
    const stage = this.stageName();
    if (stage === 'pickup-wait') {
      const curb = this.stageTarget();
      this.spawnClient(curb.x + 2, curb.z + 2, 0xffe1a0);
      this.bus.emit('toast', 'Client is waiting — stop near the marker');
    } else if (stage === 'tail') {
      this.spawnTailCar();
      this.bus.emit('toast', 'Tail Rico. Stay 25–70 m back. Do not be seen.');
    } else if (stage === 'escape') {
      this.state.addWanted(2, 'heist');
      this.bus.emit('toast', 'GO GO GO — lose the police!');
    } else if (stage === 'lose-heat') {
      this.bus.emit('toast', 'Break line of sight — let the heat cool');
    } else if (stage === 'done') {
      this.completeMission();
      return;
    }
    this.moveMarkerTo(this.stageTarget());
  }
  completeMission() {
    const c = this.current; if (!c) return;
    const def = c.def;
    const s = this.state.s;
    const timeBonus = Math.max(0, Math.round(c.timer)) * 2;
    const payout = def.pay + timeBonus;
    this.state.addCash(payout);
    this.state.missionComplete(def.id);
    if (def.id === 'm4-heist') s.storyFlags.heistDone = true;
    if (def.id === 'm3-tail') s.storyFlags.rivalSpotted = true;
    if (def.id === 'm6-finale') s.storyFlags.marinaUnlocked = true;
    const isFinal = def.id === 'm6-finale';
    this.clearClient(); this.clearTailCar();
    this.marker.visible = false; this.arrow.visible = false;
    this.current = null;
    s.mode = 'free'; s.missionIndex = -1; s.missionStage = 0;
    this.bus.emit('mission-complete', { id: def.id, payout, timeBonus, isFinal });
    if (isFinal) {
      this.bus.emit('game-win', { payout });
    }
  }
  failMission(reason) {
    if (!this.current) return;
    const id = this.current.def.id;
    this.clearClient(); this.clearTailCar();
    this.marker.visible = false; this.arrow.visible = false;
    this.current = null;
    const s = this.state.s;
    s.mode = 'free'; s.missionIndex = -1; s.missionStage = 0;
    this.bus.emit('mission-failed', { id, reason });
  }
  abortMission(silent) {
    if (!this.current) return;
    const id = this.current.def.id;
    this.clearClient(); this.clearTailCar();
    this.marker.visible = false; this.arrow.visible = false;
    this.current = null;
    const s = this.state.s;
    s.mode = 'free'; s.missionIndex = -1; s.missionStage = 0;
    if (!silent) this.bus.emit('mission-failed', { id, reason: 'Job abandoned.' });
  }
  update(dt) {
    const s = this.state.s;
    if (s.phase !== 'playing' || !this.current) return;
    const c = this.current;
    c.timer -= dt;
    s.missionTimer = c.timer; s.missionElapsed += dt;
    if (c.timer <= 0) { this.failMission('Out of time — Marisol gave the job to someone else.'); return; }
    const player = this.player;
    const target = this.stageTarget();
    const stage = this.stageName();
    // Marker pulse.
    this.marker.rotation.y += dt * 0.8;
    this.marker.children[2].position.y = 4.4 + Math.sin(performance.now() / 300) * 0.6;
    // Arrow above the player pointing at the objective.
    if (target && player) {
      this.arrow.position.set(player.pos.x, 4.6, player.pos.z);
      this.arrow.rotation.y = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);
      this.arrow.visible = true;
    }
    if (stage === 'tail' && this.tailCar) {
      const tc = this.tailCar;
      // Rico follows his route at a steady cruise.
      const wp = tc.route[tc.routeIndex];
      const dx = wp.x - tc.pos.x, dz = wp.z - tc.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 4) { tc.routeIndex = (tc.routeIndex + 1) % tc.route.length; }
      else {
        const want = Math.atan2(dx / d, dz / d);
        let diff = want - tc.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        tc.heading += clamp(diff, -1.4 * dt, 1.4 * dt);
        tc.speed += clamp(tc.targetSpeed - tc.speed, -8 * dt, 6 * dt);
        tc.pos.x += Math.sin(tc.heading) * tc.speed * dt;
        tc.pos.z += Math.cos(tc.heading) * tc.speed * dt;
        tc.mesh.position.copy(tc.pos);
        tc.mesh.rotation.y = tc.heading;
      }
      const pd = dist2d(player.pos.x, player.pos.z, tc.pos.x, tc.pos.z);
      c.tailDistance = pd;
      if (pd < 22) {
        c.tailSpotted += dt;
        if (c.tailSpotted > 2.5) { this.failMission('Rico spotted you in his mirror. The tail is blown.'); return; }
      } else c.tailSpotted = Math.max(0, c.tailSpotted - dt * 2);
      if (pd > 110) { this.failMission('You lost Rico in the traffic. The tail is cold.'); return; }
      if (tc.routeIndex >= tc.route.length - 1 && dist2d(tc.pos.x, tc.pos.z, c.def.dropoff.x, c.def.dropoff.z) < 12) {
        this.advanceStage();
        return;
      }
      // Tail completes when Rico reaches the end of his loop twice over.
      if (s.missionElapsed > 150 && tc.routeIndex === 0) { this.advanceStage(); return; }
      this.moveMarkerTo({ x: tc.pos.x, z: tc.pos.z });
      return;
    }
    if (!target) return;
    const d = dist2d(player.pos.x, player.pos.z, target.x, target.z);
    if (stage === 'drive-to-pickup' && d < 8) {
      if (c.def.id === 'm3-tail') { this.advanceStage(); return; }
      this.advanceStage();
      return;
    }
    if (stage === 'pickup-wait') {
      // The client walks to the car when the player stops nearby in a car.
      if (player.inCar && d < 8 && Math.abs(player.speed) < 2) {
        this.clearClient();
        c.pickedUp = true;
        this.bus.emit('toast', 'Client is in — drive to the marker');
        this.advanceStage();
        return;
      }
      if (!player.inCar && d < 3) {
        this.bus.emit('hint', 'Get in a car — the client will not walk');
      }
      return;
    }
    if (stage === 'escape' && s.wanted >= 2) {
      // Once the crew is in, the escape stage just needs the player moving.
      if (d < 90) { /* still running */ }
      if (s.missionElapsed > 25) { this.advanceStage(); return; }
      return;
    }
    if (stage === 'lose-heat') {
      if (s.wanted === 0) { this.advanceStage(); return; }
      return;
    }
    if (stage === 'drive-to-dropoff' && d < 8) {
      if (c.def.id === 'm4-heist' || c.def.id === 'm5-ferry' || c.def.id === 'm6-finale') {
        if (!player.inCar) { this.bus.emit('hint', 'You need to be in the car to finish the drop'); return; }
      }
      this.advanceStage();
      return;
    }
  }
  reset() {
    this.abortMission(true);
    this.marker.visible = false; this.arrow.visible = false;
  }
}
