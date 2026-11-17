// Solmar city builder: a deterministic coastal grid city at golden hour.
// One seeded pass lays out roads, blocks, buildings, palms, lamps, props and
// the landmarks the missions point at (Coral Court, Sunset Plaza, the marina
// pier, the safehouse on Palm Court). Everything is plain three.js boxes and
// cylinders with a warm sunset palette — no textures, no network.
import * as THREE from 'three';
import { range, rangeInt, pick, clamp } from './rng.js';

export const CITY = {
  half: 240, block: 64, road: 14, seed: 'solmar-city-v1',
  landmarks: {
    coralCourt: { x: 96, z: -96, name: 'Coral Court Hotel' },
    sunsetPlaza: { x: -32, z: -96, name: 'Sunset Plaza' },
    safehouse: { x: -96, z: 96, name: 'Safehouse · Palm Court' },
    dockside: { x: 160, z: 128, name: 'Dockside Market' },
    marinaGate: { x: 160, z: -96, name: 'Marina Gate' },
    marinaBoat: { x: 208, z: 160, name: 'Marina Boat' },
    tailStart: { x: -32, z: -96, name: 'Sunset Plaza Garage' },
    ferryPickup: { x: -96, z: -32, name: 'Harbor Steps' },
  },
};

const PALETTE = {
  asphalt: 0x2c2f3a, asphaltLine: 0xd8c86a, sidewalk: 0x9a8f7a, sand: 0xe8c98f,
  water: 0x1d5f7a, glass: 0x9fd8e8, glassWarm: 0xffc98a,
  walls: [0xf2e3c9, 0xe8b48a, 0xd98a6a, 0xf7f0e0, 0xc98a8a, 0x8ab8c9, 0xe8d27a, 0xb89ac9],
  neon: [0xff5e8a, 0x3de8ff, 0xffd23d, 0x8aff5e, 0xff7a3d],
  palm: 0x2e8a4a, trunk: 0x8a6a4a, lamp: 0xffe1a0,
};

function box(w, h, d, color, x, y, z, opts) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: opts?.rough ?? 0.9, metalness: opts?.metal ?? 0.05, emissive: opts?.emissive ?? 0x000000, emissiveIntensity: opts?.ei ?? 1 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts?.ry) m.rotation.y = opts.ry;
  m.castShadow = opts?.shadow !== false; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, color, x, y, z, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Street grid: avenues every 64 m, roads 14 m wide. A point is on a road when
// either coordinate is near a multiple of the block pitch.
export function isOnRoad(x, z) {
  const p = CITY.block, r = CITY.road / 2 + 3;
  const mx = ((x % p) + p) % p, mz = ((z % p) + p) % p;
  const nearX = mx < r || mx > p - r, nearZ = mz < r || mz > p - r;
  return nearX || nearZ;
}
export function nearestRoadPoint(x, z) {
  const p = CITY.block;
  const rx = Math.round(x / p) * p, rz = Math.round(z / p) * p;
  return Math.abs(x - rx) < Math.abs(z - rz) ? { x: rx, z } : { x, z: rz };
}
export function clampToCity(x, z) {
  const h = CITY.half - 6;
  return { x: clamp(x, -h, h), z: clamp(z, -h, h) };
}

export function buildCity(scene, rng) {
  const group = new THREE.Group(); group.name = 'solmar-city';
  const colliders = []; // {x, z, r} circles the car/player cannot pass through
  const buildings = [];
  const roadLines = [];
  const p = CITY.block, half = CITY.half;

  // --- sky, sun and fog -------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x3a2a55, 0.85); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb347, 2.1);
  sun.position.set(-140, 90, -180); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260; sun.shadow.camera.far = 700;
  scene.add(sun);
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
  sunBall.position.set(-320, 70, -420); scene.add(sunBall);
  scene.fog = new THREE.Fog(0xe8a06a, 180, 620);
  scene.background = new THREE.Color(0xf2a05e);

  // --- ground, beach, water ---------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 220, half * 2 + 220), new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 220, 70), new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 }));
  beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0.05, half + 18); beach.receiveShadow = true; group.add(beach);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 260, 260), new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.25, metalness: 0.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.4, half + 160); group.add(water);

  // --- road ribbons ------------------------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.95 });
  for (let i = -3; i <= 3; i++) {
    const c = i * p;
    const v = new THREE.Mesh(new THREE.PlaneGeometry(CITY.road, half * 2), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(c, 0.08, 0); v.receiveShadow = true; group.add(v);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, CITY.road), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.08, c); h.receiveShadow = true; group.add(h);
    for (let k = -half + 16; k < half; k += 16) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 6), new THREE.MeshBasicMaterial({ color: PALETTE.asphaltLine }));
      dash.rotation.x = -Math.PI / 2; dash.position.set(c, 0.12, k); group.add(dash);
      const dash2 = dash.clone(); dash2.position.set(k, 0.12, c); dash2.rotation.z = Math.PI / 2; group.add(dash2);
    }
  }

  // --- sidewalks + blocks + buildings ------------------------------------
  const blockCenters = [];
  for (let gx = -3; gx < 3; gx++) for (let gz = -3; gz < 3; gz++) {
    blockCenters.push({ x: gx * p + p / 2, z: gz * p + p / 2 });
  }
  const shuffled = blockCenters.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t; }
  // Reserve landmark blocks so missions always have their set pieces.
  const reserved = new Set(['96,-96', '-32,-96', '-96,96', '160,128', '160,-96']);
  let parkCount = 0;
  for (const bc of shuffled) {
    const key = bc.x + ',' + bc.z;
    const isLandmark = reserved.has(key);
    const isPark = !isLandmark && parkCount < 5 && rng() < 0.22;
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(p - CITY.road + 6, p - CITY.road + 6), new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 1 }));
    walk.rotation.x = -Math.PI / 2; walk.position.set(bc.x, 0.06, bc.z); walk.receiveShadow = true; group.add(walk);
    if (isPark) {
      parkCount++;
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(p - CITY.road - 4, p - CITY.road - 4), new THREE.MeshStandardMaterial({ color: 0x4a8a4a, roughness: 1 }));
      lawn.rotation.x = -Math.PI / 2; lawn.position.set(bc.x, 0.1, bc.z); group.add(lawn);
      for (let t = 0; t < 4; t++) group.add(makePalm(bc.x + range(rng, -16, 16), bc.z + range(rng, -16, 16), rng));
      colliders.push({ x: bc.x, z: bc.z, r: 12 });
      continue;
    }
    const nB = isLandmark ? 1 : rangeInt(rng, 1, 3);
    for (let b = 0; b < nB; b++) {
      const bw = range(rng, 12, 22), bd = range(rng, 12, 22);
      const bh = isLandmark ? range(rng, 26, 42) : range(rng, 8, 34);
      const ox = nB === 1 ? 0 : range(rng, -12, 12), oz = nB === 1 ? 0 : range(rng, -12, 12);
      const bx = bc.x + ox, bz = bc.z + oz;
      const color = pick(rng, PALETTE.walls);
      const bld = box(bw, bh, bd, color, bx, bh / 2, bz);
      group.add(bld);
      buildings.push({ x: bx, z: bz, w: bw, d: bd, h: bh });
      colliders.push({ x: bx, z: bz, r: Math.max(bw, bd) * 0.62 });
      // Lit windows: warm emissive panes on the sunset side.
      const winMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, emissive: rng() < 0.6 ? PALETTE.glassWarm : PALETTE.glass, emissiveIntensity: rng() < 0.6 ? 0.9 : 0.35, roughness: 0.3, metalness: 0.4 });
      const rows = Math.max(1, Math.floor(bh / 5));
      for (let r = 0; r < rows; r++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(bw * 0.7, 1.6), winMat);
        win.position.set(bx, 3 + r * 5, bz + bd / 2 + 0.06); group.add(win);
      }
      // Rooftop neon sign on tall buildings.
      if (bh > 24 && rng() < 0.7) {
        const sign = box(bw * 0.5, 1.4, 0.4, 0x111122, bx, bh + 1, bz + bd / 2 - 0.2, { emissive: pick(rng, PALETTE.neon), ei: 1.6, shadow: false });
        group.add(sign);
      }
    }
  }

  // --- palms and lamps along the avenues ---------------------------------
  for (let i = -3; i <= 3; i++) {
    for (let k = -half + 24; k < half; k += 48) {
      if (rng() < 0.75) group.add(makePalm(i * p + 11, k, rng));
      if (rng() < 0.5) group.add(makePalm(k, i * p - 11, rng));
      if (rng() < 0.6) group.add(makeLamp(i * p + 9, k + 24, rng() < 0.15));
    }
  }
  // Marina pier + boat + lighthouse.
  const pier = box(10, 1.2, 90, 0x8a6a4a, 208, 0.6, 205); group.add(pier);
  const boat = new THREE.Group();
  const hull = box(7, 2.5, 16, 0xf2f2f2, 0, 1.2, 0); boat.add(hull);
  boat.add(box(4, 2, 8, 0x2a4a6a, 0, 3.4, -1));
  boat.add(cyl(0.3, 0.3, 5, 0x888888, 0, 5, 3, 8));
  boat.position.set(208, 0.4, 248); boat.rotation.y = 0.3; group.add(boat);
  const light = new THREE.Group();
  light.add(cyl(3, 4, 26, 0xf2e8d8, 0, 13, 0, 12));
  light.add(cyl(2.2, 2.2, 4, 0x222233, 0, 28, 0, 12));
  light.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0 })));
  light.children[2].position.y = 31;
  light.position.set(-228, 0, 228); group.add(light);
  colliders.push({ x: -228, z: 228, r: 5 });

  // Safehouse: a low stucco house with a garage door and a palm court.
  const sh = CITY.landmarks.safehouse;
  group.add(box(16, 7, 12, 0xf2e3c9, sh.x, 3.5, sh.z));
  group.add(box(10, 4, 1, 0x3a6a8a, sh.x, 2, sh.z - 6.4, { emissive: 0x2a4a6a, ei: 0.4 }));
  group.add(makePalm(sh.x - 12, sh.z + 8, rng)); group.add(makePalm(sh.x + 12, sh.z + 8, rng));
  colliders.push({ x: sh.x, z: sh.z, r: 10 });

  // Coral Court hotel tower.
  const cc = CITY.landmarks.coralCourt;
  group.add(box(24, 46, 20, 0xe8b48a, cc.x, 23, cc.z));
  group.add(box(26, 2, 22, 0x2a2a3a, cc.x, 47, cc.z));
  const ccSign = box(14, 2.4, 0.5, 0x111122, cc.x, 44, cc.z + 10.4, { emissive: 0xff5e8a, ei: 1.8, shadow: false });
  group.add(ccSign);
  colliders.push({ x: cc.x, z: cc.z, r: 16 });

  scene.add(group);
  return { group, colliders, buildings, roadLines, sun, sunBall };
}

function makePalm(x, z, rng) {
  const g = new THREE.Group();
  const h = range(rng, 5, 8);
  const trunk = cyl(0.25, 0.45, h, PALETTE.trunk, 0, h / 2, 0, 8);
  trunk.rotation.z = range(rng, -0.08, 0.08); g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.4, 4), new THREE.MeshStandardMaterial({ color: PALETTE.palm, roughness: 1 }));
    leaf.position.set(Math.cos(i * 1.05) * 1.3, h + 0.4, Math.sin(i * 1.05) * 1.3);
    leaf.rotation.z = Math.cos(i * 1.05) * 1.1; leaf.rotation.x = -Math.sin(i * 1.05) * 1.1;
    leaf.castShadow = true; g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}
function makeLamp(x, z, withLight) {
  const g = new THREE.Group();
  g.add(cyl(0.12, 0.16, 6, 0x333344, 0, 3, 0, 8));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: PALETTE.lamp }));
  bulb.position.y = 6.2; g.add(bulb);
  if (withLight) { const glow = new THREE.PointLight(0xffd9a0, 6, 18); glow.position.y = 6; g.add(glow); }
  g.position.set(x, 0, z);
  return g;
}

// Destructible street props: hydrants, crates, cones, benches. Traffic and
// the player smash them for combo points; they respawn on mission restart.
export function buildProps(scene, rng, count) {
  const group = new THREE.Group(); group.name = 'solmar-props';
  const props = [];
  const kinds = ['hydrant', 'crate', 'cone', 'bench'];
  for (let i = 0; i < count; i++) {
    const kind = pick(rng, kinds);
    const p = CITY.block;
    const gx = rangeInt(rng, -3, 2) * p + p / 2 + range(rng, -18, 18);
    const gz = rangeInt(rng, -3, 2) * p + p / 2 + range(rng, -18, 18);
    let mesh;
    if (kind === 'hydrant') mesh = cyl(0.4, 0.5, 1.1, 0xd83a3a, gx, 0.55, gz, 8);
    else if (kind === 'crate') mesh = box(1.4, 1.4, 1.4, 0x9a7a4a, gx, 0.7, gz, { ry: rng() * Math.PI });
    else if (kind === 'cone') mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 10), new THREE.MeshStandardMaterial({ color: 0xff7a2d }));
    else mesh = box(2.4, 0.6, 0.8, 0x6a4a2a, gx, 0.5, gz, { ry: rng() * Math.PI });
    if (kind === 'cone') { mesh.position.set(gx, 0.6, gz); mesh.castShadow = true; }
    mesh.castShadow = true;
    group.add(mesh);
    props.push({ mesh, kind, x: gx, z: gz, alive: true, radius: kind === 'crate' ? 1.1 : 0.8 });
  }
  scene.add(group);
  return { group, props };
}
