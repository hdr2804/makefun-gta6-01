// Traffic for SOLMAR: civilian cars that cruise the avenue grid on seeded
// loops, stop for nothing, honk at nothing, and make the city feel driven.
// They follow the road lattice, turn at intersections, keep a simple gap to
// the car ahead, and can be stolen when parked. Near-misses against the
// player pay a combo bonus; a hard hit damages both cars.
import * as THREE from 'three';
import { range, rangeInt, pick, clamp, dist2d } from './rng.js';
import { CITY, isOnRoad, nearestRoadPoint } from './city.js';
import { buildCarMesh } from './vehicle.js';
import { CAR_MODELS } from './state.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class TrafficSystem {
  constructor(scene, rng, state, bus) {
    this.scene = scene; this.rng = rng; this.state = state; this.bus = bus;
    this.cars = [];
    this.group = new THREE.Group(); this.group.name = 'solmar-traffic';
    scene.add(this.group);
    this.spawnTimer = 0;
    this.playerRef = null;
  }
  setPlayer(player) { this.playerRef = player; }
  spawnCar(x, z, moving) {
    const model = pick(this.rng, CAR_MODELS);
    const mesh = buildCarMesh(model, false);
    const p = CITY.block;
    const onVertical = this.rng() < 0.5;
    const heading = onVertical ? (this.rng() < 0.5 ? 0 : Math.PI) : (this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    mesh.position.set(x, 0, z); mesh.rotation.y = heading;
    this.group.add(mesh);
    const car = {
      mesh, model, pos: new THREE.Vector3(x, 0, z), heading,
      speed: moving ? range(this.rng, 8, 15) : 0,
      targetSpeed: range(this.rng, 9, 16),
      moving, taken: false, honked: false, laneOffset: this.rng() < 0.5 ? 2.2 : -2.2,
      turnCooldown: 0, brakeLight: 0, parked: !moving,
    };
    this.cars.push(car);
    return car;
  }
  seedInitial(parkedCount, movingCount) {
    const p = CITY.block;
    for (let i = 0; i < parkedCount; i++) {
      const gx = rangeInt(this.rng, -3, 3) * p + (this.rng() < 0.5 ? 9 : -9);
      const gz = rangeInt(this.rng, -3, 3) * p + range(this.rng, -30, 30);
      const car = this.spawnCar(gx, gz, false);
      car.mesh.rotation.y = (this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (this.rng() - 0.5) * 0.2;
      car.heading = car.mesh.rotation.y;
    }
    for (let i = 0; i < movingCount; i++) {
      const gx = rangeInt(this.rng, -3, 3) * p;
      const gz = rangeInt(this.rng, -3, 3) * p + range(this.rng, -100, 100);
      this.spawnCar(gx, gz, true);
    }
  }
  nearestParked(x, z, maxD) {
    let best = null, bd = maxD;
    for (const c of this.cars) {
      if (c.moving || c.taken) continue;
      const d = dist2d(x, z, c.pos.x, c.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  countMoving() { return this.cars.filter(c => c.moving && !c.taken).length; }
  update(dt) {
    const s = this.state.s;
    if (s.phase !== 'playing') return;
    const p = CITY.block;
    // Keep the streets populated near the player without teleporting cars
    // into view: spawn just outside the camera's far edge.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.countMoving() < 14) {
      this.spawnTimer = 1.2;
      const px = this.playerRef ? this.playerRef.pos.x : 0;
      const pz = this.playerRef ? this.playerRef.pos.z : 0;
      const gx = clamp(Math.round((px + (this.rng() < 0.5 ? -1 : 1) * range(this.rng, 90, 160)) / p) * p, -p * 3, p * 3);
      const gz = clamp(pz + range(this.rng, -120, 120), -p * 3, p * 3);
      this.spawnCar(gx, gz, true);
    }
    for (const car of this.cars) {
      if (car.taken) continue;
      if (!car.moving) continue;
      // Gap keeping: slow down for the car ahead on the same lane.
      let ahead = null, aheadD = 999;
      for (const o of this.cars) {
        if (o === car || o.taken || !o.moving) continue;
        const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
        const fwd = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
        const lat = Math.abs(Math.cos(car.heading) * dx - Math.sin(car.heading) * dz);
        if (fwd > 0 && fwd < 22 && lat < 3 && fwd < aheadD) { aheadD = fwd; ahead = o; }
      }
      const want = ahead ? clamp((aheadD - 7) * 0.8, 0, car.targetSpeed) : car.targetSpeed;
      car.speed += clamp(want - car.speed, -14 * dt, 7 * dt);
      car.turnCooldown -= dt;
      // At an intersection, sometimes turn onto the cross street.
      const mx = ((car.pos.x % p) + p) % p, mz = ((car.pos.z % p) + p) % p;
      const nearX = Math.min(mx, p - mx) < 2.5, nearZ = Math.min(mz, p - mz) < 2.5;
      if (nearX && nearZ && car.turnCooldown <= 0 && this.rng() < dt * 1.4) {
        const options = DIRS.filter(d => !(d[0] === -Math.round(Math.sin(car.heading)) && d[1] === -Math.round(Math.cos(car.heading))));
        const turn = pick(this.rng, options);
        car.heading = Math.atan2(turn[0], turn[1]);
        car.turnCooldown = 4;
      }
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      // Lane offset: drive on the right side of the road.
      const lx = Math.cos(car.heading) * car.laneOffset, lz = -Math.sin(car.heading) * car.laneOffset;
      car.pos.x += fx * car.speed * dt; car.pos.z += fz * car.speed * dt;
      const nx = clamp(car.pos.x, -CITY.half + 4, CITY.half - 4);
      const nz = clamp(car.pos.z, -CITY.half + 4, CITY.half - 4);
      if (nx !== car.pos.x || nz !== car.pos.z) { car.heading += Math.PI; car.pos.x = nx; car.pos.z = nz; }
      car.mesh.position.set(car.pos.x + lx * 0.35, 0, car.pos.z + lz * 0.35);
      car.mesh.rotation.y = car.heading;
      // Player interaction: near-miss bonus and collisions.
      if (this.playerRef && this.playerRef.inCar) {
        const d = dist2d(car.pos.x, car.pos.z, this.playerRef.pos.x, this.playerRef.pos.z);
        const relSpeed = Math.abs(this.playerRef.speed - car.speed);
        if (d < 3.4 && relSpeed > 4) {
          this.playerRef.damage(relSpeed * 0.5, 'traffic');
          car.speed *= 0.4;
          this.bus.emit('crash', { with: 'traffic', speed: relSpeed });
          this.state.addWanted(0, 'crash');
          car.moving = false; car.parked = true;
          car.mesh.rotation.y += (this.rng() - 0.5) * 0.6;
        } else if (d < 6 && d >= 3.4 && relSpeed > 12 && this.playerRef.nearMissCooldown <= 0) {
          this.playerRef.nearMissCooldown = 1.5;
          s.nearMisses++;
          const bonus = 25 + Math.round(relSpeed);
          this.state.addCash(bonus); this.state.bumpCombo('near-miss', 1);
          this.bus.emit('near-miss', { bonus });
        }
      }
    }
    // Cull far-away movers so the scene stays light.
    if (this.playerRef) {
      for (let i = this.cars.length - 1; i >= 0; i--) {
        const c = this.cars[i];
        if (c.moving && !c.taken && dist2d(c.pos.x, c.pos.z, this.playerRef.pos.x, this.playerRef.pos.z) > 320) {
          this.group.remove(c.mesh); this.cars.splice(i, 1);
        }
      }
    }
  }
  reset(rng) {
    for (const c of this.cars) this.group.remove(c.mesh);
    this.cars = [];
    this.rng = rng;
    this.seedInitial(16, 12);
  }
}
