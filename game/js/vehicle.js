// Player vehicle and on-foot movement for SOLMAR.
// Arcade driving: acceleration, braking, steering that scales with speed,
// handbrake drifts, damage on hard impacts, jump pads for stunt airtime.
// On foot the player is a capsule that walks, sprints and shoves. Entering
// or exiting a car is one key (E) and stealing a parked car in sight of a
// police unit raises the wanted level.
import * as THREE from 'three';
import { clamp, damp, angleLerp, angleDiff, dist2d, range } from './rng.js';
import { isOnRoad, clampToCity } from './city.js';
import { CAR_MODELS } from './state.js';

export const JUMP_PADS = [
  { x: 0, z: -96, dir: 0 }, { x: 64, z: 32, dir: Math.PI / 2 }, { x: -64, z: 96, dir: 0 },
  { x: 128, z: -32, dir: Math.PI / 2 }, { x: -128, z: 64, dir: 0 }, { x: 32, z: 160, dir: Math.PI / 2 },
];

export function buildCarMesh(model, isPlayer) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: model.color, roughness: 0.35, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8e8, roughness: 0.15, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.75, 4.4), paint);
  body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, 2.2), glass);
  cabin.position.set(0, 1.3, -0.3); cabin.castShadow = true; g.add(cabin);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.4), dark);
  spoiler.position.set(0, 1.05, -2.1); g.add(spoiler);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(wx, 0.42, wz); w.castShadow = true; g.add(w); wheels.push(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
  for (const lx of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.1), lightMat);
    l.position.set(lx, 0.7, 2.22); g.add(l);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const lx of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.1), tailMat);
    l.position.set(lx, 0.7, -2.22); g.add(l);
  }
  if (isPlayer) {
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), new THREE.MeshBasicMaterial({ color: 0xffd23d }));
    beacon.position.set(0, 1.68, -0.3); g.add(beacon);
  }
  g.userData.wheels = wheels;
  g.userData.model = model;
  return g;
}

export function buildPedestrianMesh(shirt, pants) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a06a, roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.32), shirtMat);
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin);
  head.position.y = 1.75; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, 1.4), new THREE.MeshStandardMaterial({ color: 0x2a1a12 }));
  hair.position.y = 1.82; g.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.22), pantsMat);
  legL.position.set(-0.15, 0.4, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.15; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), shirtMat);
  armL.position.set(-0.38, 1.15, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.38; g.add(armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export class PlayerController {
  constructor(scene, state, bus, colliders, onEvent) {
    this.scene = scene; this.state = state; this.bus = bus; this.onEvent = onEvent || (() => {});
    this.colliders = colliders;
    this.model = CAR_MODELS[0];
    this.mesh = buildCarMesh(this.model, true);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.foot = buildPedestrianMesh(0xff5a3c, 0x2a3a5a);
    this.foot.position.set(0, 0, 0);
    scene.add(this.foot);
    this.pos = new THREE.Vector3(0, 0, 96);
    this.heading = Math.PI; // facing down the avenue toward the safehouse
    this.speed = 0; // m/s, signed
    this.steer = 0;
    this.vy = 0; this.y = 0; this.airborne = false; this.airTime = 0;
    this.damageFlash = 0;
    this.inCar = false;
    this.currentCar = null;
    this.walkSpeed = 0;
    this.drift = 0;
    this.engineNote = 0;
    this.footstep = 0;
    this.parkedCars = [];
    this.nearMissCooldown = 0;
  }
  reset(x, z, heading) {
    this.pos.set(x, 0, z); this.heading = heading ?? Math.PI;
    this.speed = 0; this.vy = 0; this.y = 0; this.airborne = false;
    this.state.s.carHealth = 100; this.state.s.playerHealth = 100;
    this.setInCar(false);
  }
  setInCar(v, car) {
    this.inCar = v;
    this.currentCar = car || null;
    this.mesh.visible = v;
    this.foot.visible = !v;
    this.state.s.onFoot = !v;
    this.state.s.gear = v ? 'DRIVE' : 'ON FOOT';
    if (v && car) { this.model = car.model; this.repaint(car.model); }
  }
  repaint(model) {
    const paint = new THREE.MeshStandardMaterial({ color: model.color, roughness: 0.35, metalness: 0.55 });
    this.mesh.children[0].material = paint;
  }
  enterCar(car) {
    if (!car) return false;
    const seen = this.onEvent('steal-check', car);
    this.pos.copy(car.pos); this.heading = car.heading;
    this.speed = 0;
    this.setInCar(true, car);
    car.taken = true;
    if (car.mesh) car.mesh.visible = false;
    this.bus.emit('enter-car', { model: car.model.name });
    return true;
  }
  exitCar() {
    if (!this.inCar) return false;
    const side = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.pos.addScaledVector(side, 2.5);
    this.setInCar(false);
    if (this.currentCar) { this.currentCar.taken = false; this.currentCar.pos.copy(this.pos); this.currentCar.heading = this.heading; if (this.currentCar.mesh) { this.currentCar.mesh.visible = true; this.currentCar.mesh.position.copy(this.pos); this.currentCar.mesh.rotation.y = this.heading; } }
    this.currentCar = null;
    this.bus.emit('exit-car', {});
    return true;
  }
  nearestCar(maxDist) {
    let best = null, bestD = maxDist;
    for (const c of this.parkedCars) {
      if (c.taken) continue;
      const d = dist2d(this.pos.x, this.pos.z, c.pos.x, c.pos.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  collide(dt) {
    // Circle colliders (buildings, palms, lighthouse, safehouse).
    for (const c of this.colliders) {
      const d = dist2d(this.pos.x, this.pos.z, c.x, c.z);
      const min = c.r + (this.inCar ? 1.6 : 0.5);
      if (d < min && d > 0.001) {
        const push = (min - d);
        const nx = (this.pos.x - c.x) / d, nz = (this.pos.z - c.z) / d;
        this.pos.x += nx * push; this.pos.z += nz * push;
        const impact = Math.abs(this.speed);
        if (this.inCar && impact > 6) {
          this.damage(impact * 0.55, 'building');
          this.speed *= -0.25;
          this.onEvent('crash', { speed: impact });
        } else if (this.inCar) { this.speed *= 0.4; }
      }
    }
    const c = clampToCity(this.pos.x, this.pos.z);
    if (c.x !== this.pos.x || c.z !== this.pos.z) { this.pos.x = c.x; this.pos.z = c.z; if (this.inCar) this.speed *= 0.5; }
  }
  damage(amount, kind) {
    const s = this.state.s;
    const armor = 1 - s.upgrades.armor * 0.12;
    if (this.inCar) s.carHealth = clamp(s.carHealth - amount * armor, 0, 100);
    else s.playerHealth = clamp(s.playerHealth - amount, 0, 100);
    this.damageFlash = 1;
    this.bus.emit('damage', { amount, kind, carHealth: s.carHealth, playerHealth: s.playerHealth });
    if (s.carHealth <= 0) this.bus.emit('wrecked', {});
    if (s.playerHealth <= 0) this.bus.emit('busted', { reason: 'You were beaten down on the street.' });
  }
  update(dt, input) {
    const s = this.state.s;
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2);
    if (this.inCar) this.updateCar(dt, input);
    else this.updateFoot(dt, input);
    // Jump pads: crossing one at speed launches the car.
    if (this.inCar && !this.airborne) {
      for (const pad of JUMP_PADS) {
        if (dist2d(this.pos.x, this.pos.z, pad.x, pad.z) < 3.2 && Math.abs(this.speed) > 14) {
          this.vy = 7 + Math.abs(this.speed) * 0.12; this.airborne = true; this.airTime = 0;
          this.bus.emit('stunt-start', { speed: this.speed });
          break;
        }
      }
    }
    if (this.airborne) {
      this.airTime += dt; this.vy -= 22 * dt; this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.airborne = false;
        if (this.airTime > 0.55) {
          const bonus = Math.round(50 + this.airTime * 120);
          s.stunts++; this.state.addCash(bonus); this.state.bumpCombo('stunt', 2);
          this.bus.emit('stunt', { airTime: this.airTime, bonus });
        }
      }
    }
    // Mesh sync.
    this.mesh.position.set(this.pos.x, this.y, this.pos.z);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.z = this.inCar ? -this.steer * 0.06 : 0;
    this.foot.position.set(this.pos.x, 0, this.pos.z);
    this.foot.rotation.y = this.heading;
    const wheelSpin = this.speed * dt * 2.2;
    for (const w of this.mesh.userData.wheels) w.rotation.x += wheelSpin;
    this.mesh.userData.wheels[0].rotation.y = this.steer * 0.4;
    this.mesh.userData.wheels[1].rotation.y = this.steer * 0.4;
    s.speedMph = Math.abs(this.speed) * 2.237;
    s.gear = !this.inCar ? 'ON FOOT' : this.speed > 0.5 ? 'DRIVE' : this.speed < -0.5 ? 'REVERSE' : 'PARK';
    this.engineNote = this.inCar ? clamp(Math.abs(this.speed) / (this.model.topSpeed * 0.45), 0, 1.6) : 0;
  }
  updateCar(dt, input) {
    const s = this.state.s;
    const top = this.model.topSpeed * 0.45 * (1 + s.upgrades.engine * 0.09);
    const accel = this.model.accel * (1 + s.upgrades.engine * 0.08);
    const fwd = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    if (fwd > 0) this.speed += accel * dt;
    else if (fwd < 0) this.speed -= (this.speed > 1 ? accel * 1.4 : accel * 0.7) * dt;
    else this.speed = damp(this.speed, 0, 1.2, dt);
    if (input.handbrake) { this.speed = damp(this.speed, 0, 4, dt); this.drift = clamp(this.drift + dt, 0, 1); }
    else this.drift = damp(this.drift, 0, 3, dt);
    const maxSpd = top;
    this.speed = clamp(this.speed, -maxSpd * 0.45, maxSpd);
    const steerTarget = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * (0.55 + this.drift * 0.5);
    this.steer = damp(this.steer, steerTarget, 8, dt);
    const dir = this.speed >= 0 ? 1 : -1;
    const turnRate = this.steer * (0.9 + Math.abs(this.speed) * 0.028) * (1 + (s.upgrades.tires * 0.06)) * this.model.handling;
    this.heading += turnRate * dir * dt * clamp(Math.abs(this.speed) / 6, 0, 1);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;
    s.distanceDriven += Math.abs(this.speed) * dt;
    if (Math.abs(this.speed) > 18 && this.drift > 0.4) {
      s.stunts += 0; // drift itself pays only on the combo pop below
      if (Math.random() < dt * 2) this.bus.emit('drift', { speed: this.speed });
    }
    this.collide(dt);
  }
  updateFoot(dt, input) {
    const s = this.state.s;
    const sprint = input.sprint ? 1.7 : 1;
    const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const mz = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const len = Math.hypot(mx, mz) || 1;
    const target = (mx !== 0 || mz !== 0) ? 5.2 * sprint : 0;
    this.walkSpeed = damp(this.walkSpeed, target, 10, dt);
    if (this.walkSpeed > 0.2) {
      const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      const right = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
      const move = new THREE.Vector3().addScaledVector(fwd, mz / len).addScaledVector(right, mx / len).normalize();
      this.pos.addScaledVector(move, this.walkSpeed * dt);
      const targetHeading = Math.atan2(move.x, move.z);
      this.heading = angleLerp(this.heading, targetHeading, 1 - Math.exp(-10 * dt));
      s.distanceWalked += this.walkSpeed * dt;
      this.footstep += this.walkSpeed * dt;
      const swing = Math.sin(this.footstep * 2.4) * 0.5;
      this.foot.userData.legL.rotation.x = swing; this.foot.userData.legR.rotation.x = -swing;
      this.foot.userData.armL.rotation.x = -swing; this.foot.userData.armR.rotation.x = swing;
    }
    this.collide(dt);
  }
}
