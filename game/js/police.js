// Police for SOLMAR: patrol cruisers, pursuit AI, roadblocks and the
// helicopter spotlight at 4–5 stars. Wanted 0 means cruisers just patrol.
// Wanted 1–2: the nearest cruisers pursue and ram. Wanted 3+: roadblocks
// form ahead of the player on the avenues. Wanted 4–5: a helicopter joins,
// circling overhead with a spotlight cone and calling in more units. Lose
// them by breaking line of sight and distance — the wanted level then
// decays, and the chase cools. Getting caught on foot at low speed, or
// with a wrecked car and a cruiser touching you, means BUSTED.
import * as THREE from 'three';
import { range, rangeInt, pick, clamp, dist2d, angleDiff } from './rng.js';
import { CITY } from './city.js';
import { buildCarMesh } from './vehicle.js';

function buildPoliceMesh() {
  const g = buildCarMesh({ id: 'cruiser', name: 'Cruiser', color: 0x1a1a22, topSpeed: 60, accel: 24, handling: 1.1 }, false);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  bar.position.set(0, 1.72, -0.3); g.add(bar);
  const bar2 = bar.clone(); bar2.material = new THREE.MeshBasicMaterial({ color: 0x2a6aff });
  bar2.position.x = 0; bar2.position.z = -0.3; bar2.position.y = 1.72;
  bar2.scale.x = 0.5; bar.position.x = -0.35; bar.scale.x = 0.5;
  g.add(bar2);
  g.userData.lightRed = bar; g.userData.lightBlue = bar2;
  return g;
}
function buildHeliMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 4.6), new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.5, metalness: 0.4 }));
  body.castShadow = true; g.add(body);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.4), new THREE.MeshStandardMaterial({ color: 0x9fd8e8, roughness: 0.2, metalness: 0.5 }));
  glass.position.set(0, 0.2, 1.8); g.add(glass);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x111122 }));
  rotor.position.y = 1.1; g.add(rotor);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x222233 }));
  tail.position.set(0, 0.3, -4); g.add(tail);
  const spot = new THREE.SpotLight(0xfff2c0, 400, 90, 0.32, 0.5, 1.2);
  spot.position.set(0, -0.8, 0); spot.target.position.set(0, -30, 0);
  g.add(spot); g.add(spot.target);
  g.userData = { rotor, spot };
  return g;
}

export class PoliceSystem {
  constructor(scene, rng, state, bus) {
    this.scene = scene; this.rng = rng; this.state = state; this.bus = bus;
    this.cruisers = [];
    this.group = new THREE.Group(); this.group.name = 'solmar-police';
    scene.add(this.group);
    this.heli = null; this.heliGroup = null;
    this.roadblocks = [];
    this.blockGroup = new THREE.Group(); this.blockGroup.name = 'solmar-roadblocks';
    scene.add(this.blockGroup);
    this.playerRef = null;
    this.spawnTimer = 0; this.blockTimer = 0;
    this.bustedTimer = 0; this.bustedGrace = 0;
    this.sirenPhase = 0;
    this.hiddenTimer = 0; // seconds since any unit saw the player
    this.lastSeenPos = null;
  }
  setPlayer(player) { this.playerRef = player; }
  wantedTarget() {
    const w = this.state.s.wanted;
    return w === 0 ? 3 : w === 1 ? 3 : w === 2 ? 4 : w === 3 ? 5 : w === 4 ? 6 : 7;
  }
  spawnCruiser(x, z, pursuing) {
    const mesh = buildPoliceMesh();
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    const c = {
      mesh, pos: new THREE.Vector3(x, 0, z), heading: this.rng() * Math.PI * 2,
      speed: 0, targetSpeed: range(this.rng, 10, 14), pursuing: !!pursuing,
      patrolTarget: null, stuckTimer: 0, ramCooldown: 0, siren: this.rng() * 10,
    };
    c.patrolTarget = this.pickPatrolTarget(c.pos);
    this.cruisers.push(c);
    return c;
  }
  pickPatrolTarget(from) {
    const p = CITY.block;
    return new THREE.Vector3(
      clamp(Math.round(from.x / p) * p + (this.rng() < 0.5 ? -1 : 1) * p * rangeInt(this.rng, 1, 2), -CITY.half + 8, CITY.half - 8),
      0,
      clamp(Math.round(from.z / p) * p + range(this.rng, -80, 80), -CITY.half + 8, CITY.half - 8));
  }
  seedInitial() {
    for (let i = 0; i < 3; i++) {
      const p = CITY.block;
      this.spawnCruiser(rangeInt(this.rng, -2, 2) * p, rangeInt(this.rng, -2, 2) * p, false);
    }
  }
  ensureHeli() {
    if (this.heli) return;
    const mesh = buildHeliMesh();
    this.scene.add(mesh);
    this.heli = { mesh, angle: 0, height: 55, orbitR: 26 };
    this.bus.emit('heli', { on: true });
  }
  removeHeli() {
    if (!this.heli) return;
    this.scene.remove(this.heli.mesh);
    this.heli = null;
    this.bus.emit('heli', { on: false });
  }
  makeRoadblock(x, z, heading) {
    const g = new THREE.Group();
    for (let i = -1; i <= 1; i++) {
      const car = buildPoliceMesh();
      car.position.set(i * 4.4, 0, 0);
      car.rotation.y = heading + Math.PI / 2;
      g.add(car);
    }
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 0.4), new THREE.MeshStandardMaterial({ color: 0xff7a2d, emissive: 0xff7a2d, emissiveIntensity: 0.5 }));
    barrier.position.set(0, 0.6, 3); g.add(barrier);
    g.position.set(x, 0, z);
    g.rotation.y = heading;
    this.blockGroup.add(g);
    const block = { group: g, x, z, heading, ttl: 45 };
    this.roadblocks.push(block);
    return block;
  }
  clearRoadblocks() {
    for (const b of this.roadblocks) this.blockGroup.remove(b.group);
    this.roadblocks = [];
  }
  anyUnitNearPlayer(maxD) {
    if (!this.playerRef) return false;
    for (const c of this.cruisers) if (dist2d(c.pos.x, c.pos.z, this.playerRef.pos.x, this.playerRef.pos.z) < maxD) return true;
    return false;
  }
  update(dt) {
    const s = this.state.s;
    if (s.phase !== 'playing') return;
    const w = s.wanted;
    const player = this.playerRef;
    // Keep the right number of units for the wanted level.
    this.spawnTimer -= dt;
    const target = this.wantedTarget();
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.0;
      if (this.cruisers.length < target && player) {
        const p = CITY.block;
        const gx = clamp(Math.round((player.pos.x + (this.rng() < 0.5 ? -1 : 1) * range(this.rng, 70, 130)) / p) * p, -CITY.half + 8, CITY.half - 8);
        const gz = clamp(player.pos.z + range(this.rng, -90, 90), -CITY.half + 8, CITY.half - 8);
        this.spawnCruiser(gx, gz, w >= 1);
      } else if (this.cruisers.length > target + 2) {
        const c = this.cruisers.pop();
        this.group.remove(c.mesh);
      }
    }
    // Helicopter at 4-5 stars.
    if (w >= 4) this.ensureHeli(); else this.removeHeli();
    // Roadblocks at 3+ stars, ahead of the player's heading.
    this.blockTimer -= dt;
    if (w >= 3 && this.blockTimer <= 0 && player && player.inCar) {
      this.blockTimer = 22;
      const ahead = 55;
      const bx = clamp(player.pos.x + Math.sin(player.heading) * ahead, -CITY.half + 10, CITY.half - 10);
      const bz = clamp(player.pos.z + Math.cos(player.heading) * ahead, -CITY.half + 10, CITY.half - 10);
      this.makeRoadblock(bx, bz, player.heading);
      this.bus.emit('roadblock', { x: bx, z: bz });
    }
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const b = this.roadblocks[i];
      b.ttl -= dt;
      if (b.ttl <= 0 || (player && dist2d(b.x, b.z, player.pos.x, player.pos.z) > 260)) {
        this.blockGroup.remove(b.group); this.roadblocks.splice(i, 1);
      }
    }
    // Line of sight: any cruiser within 55 m and roughly facing the player
    // counts as seen; the helicopter always sees.
    let seen = w >= 4 && !!this.heli;
    if (player) {
      for (const c of this.cruisers) {
        if (dist2d(c.pos.x, c.pos.z, player.pos.x, player.pos.z) < 55) { seen = true; break; }
      }
    }
    this.hiddenTimer = seen ? 0 : this.hiddenTimer + dt;
    if (this.lastSeenPos && player && seen) this.lastSeenPos.copy(player.pos);
    else if (!this.lastSeenPos && player) this.lastSeenPos = player.pos.clone();
    // Wanted decay only while hidden.
    this.state.decayWanted(dt, this.hiddenTimer > 4);
    // Cruiser behaviour.
    for (const c of this.cruisers) {
      c.siren += dt;
      const flash = Math.sin(c.siren * 9) > 0;
      c.mesh.userData.lightRed.visible = flash;
      c.mesh.userData.lightBlue.visible = !flash;
      c.ramCooldown = Math.max(0, c.ramCooldown - dt);
      const wantPursuit = w >= 1 && player;
      c.pursuing = wantPursuit;
      let tx, tz, desiredSpeed;
      if (wantPursuit) {
        const aim = this.hiddenTimer > 6 && this.lastSeenPos ? this.lastSeenPos : player.pos;
        tx = aim.x; tz = aim.z;
        desiredSpeed = player.inCar ? 26 + w * 1.5 : 12;
        if (dist2d(c.pos.x, c.pos.z, player.pos.x, player.pos.z) < 90) desiredSpeed += 4;
      } else {
        if (!c.patrolTarget || dist2d(c.pos.x, c.pos.z, c.patrolTarget.x, c.patrolTarget.z) < 6) c.patrolTarget = this.pickPatrolTarget(c.pos);
        tx = c.patrolTarget.x; tz = c.patrolTarget.z;
        desiredSpeed = c.targetSpeed;
      }
      const dx = tx - c.pos.x, dz = tz - c.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const wantHeading = Math.atan2(dx / dist, dz / dist);
      const diff = angleDiff(c.heading, wantHeading);
      c.heading += clamp(diff, -1.9 * dt, 1.9 * dt);
      c.speed += clamp(desiredSpeed - c.speed, -18 * dt, 9 * dt);
      // Ramming: if close and fast, push into the player.
      if (wantPursuit && player && dist < 5.5 && c.ramCooldown <= 0) {
        c.ramCooldown = 1.4;
        if (player.inCar) {
          player.damage(6 + w, 'ram');
          player.speed *= 0.6;
          this.bus.emit('rammed', { stars: w });
        } else {
          this.bustedTimer += dt;
        }
      }
      c.pos.x += Math.sin(c.heading) * c.speed * dt;
      c.pos.z += Math.cos(c.heading) * c.speed * dt;
      c.pos.x = clamp(c.pos.x, -CITY.half + 4, CITY.half - 4);
      c.pos.z = clamp(c.pos.z, -CITY.half + 4, CITY.half - 4);
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.y = c.heading;
      const spin = c.speed * dt * 2.2;
      for (const wh of c.mesh.userData.wheels) wh.rotation.x += spin;
      // Busted: on foot, slow, and a cruiser is touching the player.
      if (player && !player.inCar && w >= 1 && dist < 2.6 && Math.abs(player.walkSpeed) < 2) {
        this.bustedTimer += dt * 2;
      }
    }
    if (this.bustedTimer > 0) this.bustedTimer = Math.max(0, this.bustedTimer - dt * 0.4);
    if (this.bustedTimer >= 2.2) { this.bustedTimer = 0; this.bus.emit('busted', { reason: 'The Solmar PD boxed you in on foot.' }); }
    // Helicopter orbit + spotlight.
    if (this.heli && player) {
      const h = this.heli;
      h.angle += dt * 0.35;
      h.mesh.position.set(player.pos.x + Math.cos(h.angle) * h.orbitR, h.height, player.pos.z + Math.sin(h.angle) * h.orbitR);
      h.mesh.rotation.y = Math.atan2(player.pos.x - h.mesh.position.x, player.pos.z - h.mesh.position.z);
      h.mesh.userData.rotor.rotation.y += dt * 22;
      h.mesh.userData.spot.target.position.set(player.pos.x - h.mesh.position.x, -h.height, player.pos.z - h.mesh.position.z);
      h.mesh.userData.spot.target.updateMatrixWorld();
    }
  }
  reset(rng) {
    for (const c of this.cruisers) this.group.remove(c.mesh);
    this.cruisers = [];
    this.clearRoadblocks();
    this.removeHeli();
    this.rng = rng;
    this.bustedTimer = 0; this.hiddenTimer = 0;
    this.seedInitial();
  }
}
