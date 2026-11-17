// Effects for SOLMAR: pooled particle bursts (dust, sparks, smoke, cash
// confetti), fading skid-mark ribbons, camera shake and the chase camera
// itself — third person, lagging behind the car, widening its field of view
// with speed, swinging low and close on foot. All effects are cheap
// instanced meshes and plain sprites so the frame budget stays flat.
import * as THREE from 'three';
import { clamp, damp, lerp } from './rng.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.pool = [];
    this.skids = [];
    this.skidGroup = new THREE.Group(); this.skidGroup.name = 'solmar-skids';
    scene.add(this.skidGroup);
    this.shake = 0;
    this.trauma = 0;
    this.particleGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0xd8c8a8, transparent: true, opacity: 0.7 });
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.9 });
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0x555566, transparent: true, opacity: 0.5 });
    this.cashMat = new THREE.MeshBasicMaterial({ color: 0x9dff57, transparent: true, opacity: 0.95 });
  }
  burst(x, y, z, kind, count, spread) {
    const mat = kind === 'spark' ? this.sparkMat : kind === 'smoke' ? this.smokeMat : kind === 'cash' ? this.cashMat : this.dustMat;
    for (let i = 0; i < count; i++) {
      let m = this.pool.pop();
      if (!m) { m = new THREE.Mesh(this.particleGeo, mat); m.castShadow = false; this.scene.add(m); }
      m.material = mat; m.visible = true;
      m.position.set(x + (Math.random() - 0.5) * (spread || 1), y + Math.random() * 0.5, z + (Math.random() - 0.5) * (spread || 1));
      const life = 0.5 + Math.random() * 0.7;
      this.particles.push({ mesh: m, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4 + 1, vz: (Math.random() - 0.5) * 6, life, maxLife: life, kind });
    }
  }
  dust(x, z, speed) {
    if (Math.random() > 0.6) return;
    this.burst(x, 0.3, z, 'dust', 1, 0.6);
  }
  skidMark(x, z, heading, strength) {
    if (this.skids.length > 220) {
      const old = this.skids.shift();
      this.skidGroup.remove(old);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.6), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.55 * strength }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = -heading;
    m.position.set(x, 0.15, z);
    this.skidGroup.add(m);
    this.skids.push(m);
  }
  addShake(amount) { this.trauma = clamp(this.trauma + amount, 0, 1); }
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false; this.pool.push(p.mesh); this.particles.splice(i, 1); continue;
      }
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.vy -= 6 * dt;
      p.mesh.material.opacity = (p.life / p.maxLife) * 0.8;
      p.mesh.scale.setScalar(0.6 + (1 - p.life / p.maxLife) * 1.4);
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shake = this.trauma * this.trauma;
  }
  shakeOffset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * this.shake * 1.2, y: (Math.random() - 0.5) * this.shake * 0.9 };
  }
}

export class ChaseCamera {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders || [];
    this.pos = new THREE.Vector3(0, 14, 110);
    this.look = new THREE.Vector3(0, 1, 0);
    this.fov = 62;
  }
  update(dt, player, effects) {
    const cam = this.camera;
    const heading = player.heading;
    const speed = Math.abs(player.speed || 0);
    const inCar = player.inCar;
    const back = inCar ? 11.5 + speed * 0.14 : 8;
    const height = inCar ? 5.2 + speed * 0.02 : 3.6;
    const tx = player.pos.x - Math.sin(heading) * back;
    const tz = player.pos.z - Math.cos(heading) * back;
    const k = 1 - Math.exp(-(inCar ? 4.2 : 6) * dt);
    this.pos.x = lerp(this.pos.x, tx, k);
    this.pos.z = lerp(this.pos.z, tz, k);
    this.pos.y = damp(this.pos.y, height + player.y * 0.4, 5, dt);
    // Keep the camera out of buildings: push it horizontally out of any
    // collider circle it drifted into, so the view is never inside a wall.
    for (const c of this.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + 1.4;
      if (d < min && d > 0.001) { this.pos.x = c.x + (dx / d) * min; this.pos.z = c.z + (dz / d) * min; }
    }
    const lx = player.pos.x + Math.sin(heading) * 6;
    const lz = player.pos.z + Math.cos(heading) * 6;
    this.look.x = lerp(this.look.x, lx, 1 - Math.exp(-7 * dt));
    this.look.y = damp(this.look.y, 1.6 + player.y * 0.5, 6, dt);
    this.look.z = lerp(this.look.z, lz, 1 - Math.exp(-7 * dt));
    const off = effects.shakeOffset();
    cam.position.set(this.pos.x + off.x, this.pos.y + off.y, this.pos.z);
    cam.lookAt(this.look.x + off.x, this.look.y, this.look.z);
    const targetFov = inCar ? 62 + clamp(speed / 30, 0, 1) * 13 : 58;
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
  snapTo(player) {
    const heading = player.heading;
    const back = player.inCar ? 10.5 : 7.5;
    this.pos.set(player.pos.x - Math.sin(heading) * back, player.inCar ? 4.6 : 3.4, player.pos.z - Math.cos(heading) * back);
    this.look.set(player.pos.x, 1.6, player.pos.z);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
