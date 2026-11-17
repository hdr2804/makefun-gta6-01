// Pedestrians for SOLMAR: sidewalk walkers with seeded routes, moods and
// reactions. They stroll the blocks, wait at corners, cross at crosswalks,
// and scatter when a car screeches past or a punch lands. Bumping one on
// foot is a shove; hitting one in a car raises heat and wanted — the city
// notices. A few named walkers linger near mission spots so the pickup
// scenes read as lived-in at screenshot scale.
import * as THREE from 'three';
import { range, rangeInt, pick, clamp, dist2d } from './rng.js';
import { CITY } from './city.js';
import { buildPedestrianMesh } from './vehicle.js';

const SHIRTS = [0xff8a5e, 0x5eff8a, 0x5ea8ff, 0xffd23d, 0xff5e8a, 0x8a5eff, 0xf2f2f2, 0x3de8ff, 0xff9a3d, 0x9dff5e];
const PANTS = [0x2a3a5a, 0x3a2a2a, 0x5a5a6a, 0x2a5a3a, 0x6a2a4a, 0x1a1a22];
const NAMES = ['Lena', 'Marco', 'Priya', 'Jonas', 'Tessa', 'Omar', 'Rosa', 'Felix', 'Ana', 'Kai', 'Milo', 'Sofia', 'Dante', 'Ivy', 'Ruben', 'Nadia'];
const CHATTER = [
  'The sunset here never gets old.', 'Marisol runs this town, you know.',
  'Did you see the Barracuda on Marina Row?', 'Traffic is worse every summer.',
  'I heard the vault job is tonight.', 'Best fish tacos are at Dockside.',
  'My cousin drives for the fixer now.', 'Five stars and he still got away.',
  'The marina at golden hour — nothing like it.', 'Careful, the cops are jumpy.',
];

export class PedestrianSystem {
  constructor(scene, rng, state, bus) {
    this.scene = scene; this.rng = rng; this.state = state; this.bus = bus;
    this.peds = [];
    this.group = new THREE.Group(); this.group.name = 'solmar-pedestrians';
    scene.add(this.group);
    this.playerRef = null;
    this.spawnTimer = 0;
  }
  setPlayer(player) { this.playerRef = player; }
  spawnPed(x, z, named) {
    const shirt = pick(this.rng, SHIRTS), pants = pick(this.rng, PANTS);
    const mesh = buildPedestrianMesh(shirt, pants);
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    const ped = {
      mesh, name: named || pick(this.rng, NAMES),
      pos: new THREE.Vector3(x, 0, z),
      heading: this.rng() * Math.PI * 2,
      speed: range(this.rng, 1.1, 2.2),
      target: null, wait: 0, panic: 0, mood: pick(this.rng, ['calm', 'calm', 'calm', 'hurry', 'idle']),
      chatter: pick(this.rng, CHATTER), chatterTimer: range(this.rng, 4, 14),
      step: this.rng() * 10, phone: this.rng() < 0.2,
    };
    ped.target = this.pickTarget(ped.pos);
    this.peds.push(ped);
    return ped;
  }
  pickTarget(from) {
    const p = CITY.block;
    // Walk to a nearby sidewalk corner: offset from the road lattice.
    const gx = Math.round(from.x / p) * p + (this.rng() < 0.5 ? 10 : -10);
    const gz = Math.round(from.z / p) * p + range(this.rng, -40, 40);
    return new THREE.Vector3(clamp(gx, -CITY.half + 8, CITY.half - 8), 0, clamp(gz, -CITY.half + 8, CITY.half - 8));
  }
  seedInitial(count) {
    const p = CITY.block;
    for (let i = 0; i < count; i++) {
      const x = rangeInt(this.rng, -3, 2) * p + p / 2 + range(this.rng, -20, 20);
      const z = rangeInt(this.rng, -3, 2) * p + p / 2 + range(this.rng, -20, 20);
      this.spawnPed(x, z);
    }
    // Named lingerers at the mission set pieces.
    this.spawnPed(92, -102, 'Rico\'s lookout');
    this.spawnPed(-92, 92, 'Safehouse regular');
    this.spawnPed(156, 124, 'Fish seller');
    this.spawnPed(156, -92, 'Dock guard');
  }
  nearest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const ped of this.peds) {
      const d = dist2d(x, z, ped.pos.x, ped.pos.z);
      if (d < bd) { bd = d; best = ped; }
    }
    return best;
  }
  shoveAt(x, z, radius) {
    let hit = 0;
    for (const ped of this.peds) {
      const d = dist2d(x, z, ped.pos.x, ped.pos.z);
      if (d < radius) {
        ped.panic = 2.5; hit++;
        const away = Math.atan2(ped.pos.x - x, ped.pos.z - z);
        ped.target = new THREE.Vector3(ped.pos.x + Math.sin(away) * 18, 0, ped.pos.z + Math.cos(away) * 18);
      }
    }
    return hit;
  }
  update(dt) {
    const s = this.state.s;
    if (s.phase !== 'playing') return;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.peds.length < 34 && this.playerRef) {
      this.spawnTimer = 1.5;
      const px = this.playerRef.pos.x, pz = this.playerRef.pos.z;
      const x = clamp(px + (this.rng() < 0.5 ? -1 : 1) * range(this.rng, 40, 90), -CITY.half + 8, CITY.half - 8);
      const z = clamp(pz + range(this.rng, -70, 70), -CITY.half + 8, CITY.half - 8);
      this.spawnPed(x, z);
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      // Cull far walkers.
      if (this.playerRef && dist2d(ped.pos.x, ped.pos.z, this.playerRef.pos.x, this.playerRef.pos.z) > 240) {
        this.group.remove(ped.mesh); this.peds.splice(i, 1); continue;
      }
      ped.chatterTimer -= dt;
      if (ped.wait > 0) { ped.wait -= dt; }
      else {
        const to = ped.target;
        const dx = to.x - ped.pos.x, dz = to.z - ped.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          ped.target = this.pickTarget(ped.pos);
          ped.wait = ped.mood === 'idle' ? range(this.rng, 3, 8) : range(this.rng, 0.2, 1.5);
        } else {
          const speed = ped.panic > 0 ? 6.5 : ped.mood === 'hurry' ? ped.speed * 1.8 : ped.speed;
          ped.heading = Math.atan2(dx / d, dz / d);
          ped.pos.x += Math.sin(ped.heading) * speed * dt;
          ped.pos.z += Math.cos(ped.heading) * speed * dt;
          ped.step += speed * dt * 2.6;
        }
      }
      ped.panic = Math.max(0, ped.panic - dt);
      ped.mesh.position.copy(ped.pos);
      ped.mesh.rotation.y = ped.heading;
      const swing = Math.sin(ped.step) * 0.45;
      ped.mesh.userData.legL.rotation.x = swing; ped.mesh.userData.legR.rotation.x = -swing;
      ped.mesh.userData.armL.rotation.x = -swing * 0.8; ped.mesh.userData.armR.rotation.x = swing * 0.8;
      if (ped.panic > 0) { ped.mesh.userData.armL.rotation.x = -2.4; ped.mesh.userData.armR.rotation.x = -2.4; }
      // Player contact.
      if (this.playerRef) {
        const d = dist2d(ped.pos.x, ped.pos.z, this.playerRef.pos.x, this.playerRef.pos.z);
        if (this.playerRef.inCar && d < 1.6 && Math.abs(this.playerRef.speed) > 3) {
          s.pedestriansBumped++;
          this.state.addWanted(1, 'hit pedestrian');
          this.bus.emit('ped-hit', { name: ped.name });
          ped.panic = 3;
          ped.target = new THREE.Vector3(ped.pos.x + range(this.rng, -20, 20), 0, ped.pos.z + range(this.rng, -20, 20));
          this.playerRef.speed *= 0.85;
          this.playerRef.damage(2, 'pedestrian');
        } else if (!this.playerRef.inCar && d < 1.2) {
          // Gentle on-foot bump: they sidestep, no heat.
          ped.target = this.pickTarget(ped.pos);
        } else if (this.playerRef.inCar && d < 8 && Math.abs(this.playerRef.speed) > 16) {
          ped.panic = Math.max(ped.panic, 1.2);
        }
      }
    }
  }
  reset(rng) {
    for (const ped of this.peds) this.group.remove(ped.mesh);
    this.peds = []; this.rng = rng;
    this.seedInitial(26);
  }
}
