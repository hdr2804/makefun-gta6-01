// Dynamic sky for SOLMAR: the golden hour never quite ends, but it moves.
// A slow sun arc, drifting cloud banks, a warm haze band on the horizon
// and a subtle color grade that deepens as the in-game clock creeps toward
// dusk. The clock in the HUD is fed by the same time value, so the sky and
// the read-out never disagree. Clouds are flat shaded blobs — cheap, and
// they read beautifully against the sunset gradient at screenshot scale.
import * as THREE from 'three';
import { makeRng, range, clamp, lerp } from './rng.js';

export class SkySystem {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.clouds = [];
    this.group = new THREE.Group();
    this.group.name = 'solmar-sky';
    scene.add(this.group);
    this.sunSprite = null;
    this.haze = null;
    this.buildClouds();
    this.buildHaze();
    this.timeOfDay = 18.7; // hours, golden hour
  }
  buildClouds() {
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffd9b0, transparent: true, opacity: 0.55, fog: false });
    const pinkMat = new THREE.MeshBasicMaterial({ color: 0xff9a8a, transparent: true, opacity: 0.45, fog: false });
    for (let i = 0; i < 16; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(this.rng() * 4);
      for (let j = 0; j < puffs; j++) {
        const r = range(this.rng, 8, 20);
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), this.rng() < 0.5 ? cloudMat : pinkMat);
        puff.position.set(j * range(this.rng, 10, 18) - puffs * 7, range(this.rng, -2, 3), range(this.rng, -6, 6));
        puff.scale.y = 0.45;
        cloud.add(puff);
      }
      cloud.position.set(range(this.rng, -420, 420), range(this.rng, 90, 170), range(this.rng, -420, 300));
      cloud.userData.speed = range(this.rng, 0.6, 1.8);
      this.group.add(cloud);
      this.clouds.push(cloud);
    }
  }
  buildHaze() {
    // A wide, low band of warm haze hugging the horizon on the sunset side.
    const geo = new THREE.PlaneGeometry(900, 90);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.35, fog: false, side: THREE.DoubleSide, depthWrite: false });
    this.haze = new THREE.Mesh(geo, mat);
    this.haze.position.set(-260, 34, -380);
    this.haze.rotation.y = 0.6;
    this.group.add(this.haze);
  }
  // Map the in-game clock (minutes) onto sky colors: golden hour stays
  // golden until 19:30, then deepens toward dusk purple by 21:00.
  skyColors(minutes) {
    const hour = minutes / 60;
    if (hour < 19.5) return { top: new THREE.Color(0xf2a05e), fog: new THREE.Color(0xe8a06a), sun: new THREE.Color(0xffb347), hemi: 0.85 };
    const t = clamp((hour - 19.5) / 1.5, 0, 1);
    return {
      top: new THREE.Color(0xf2a05e).lerp(new THREE.Color(0x5a3a7a), t),
      fog: new THREE.Color(0xe8a06a).lerp(new THREE.Color(0x7a4a6a), t),
      sun: new THREE.Color(0xffb347).lerp(new THREE.Color(0xff6a5a), t),
      hemi: lerp(0.85, 0.5, t),
    };
  }
  update(dt, timeMinutes, sunLight) {
    this.timeOfDay = timeMinutes / 60;
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 460) cloud.position.x = -460;
    }
    if (this.haze) this.haze.material.opacity = 0.3 + Math.sin(performance.now() / 4000) * 0.06;
    const colors = this.skyColors(timeMinutes);
    if (this.scene.background && this.scene.background.isColor) this.scene.background.copy(colors.top);
    if (this.scene.fog) this.scene.fog.color.copy(colors.fog);
    if (sunLight) {
      sunLight.color.copy(colors.sun);
      // The sun sinks as the hour advances: lower angle, longer shadows.
      const sink = clamp((this.timeOfDay - 18.7) / 2.3, 0, 1);
      sunLight.position.set(-140, 90 - sink * 45, -180);
      sunLight.intensity = 2.1 - sink * 0.7;
    }
  }
  // Snapshot helper for the playtest hooks: which sky phase are we in?
  phase() {
    if (this.timeOfDay < 19.5) return 'golden-hour';
    if (this.timeOfDay < 20.5) return 'dusk';
    return 'night';
  }
}
