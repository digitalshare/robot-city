import * as THREE from 'three';
import { PALETTE, BUILDINGS } from './data.js';
import { facadeTexture, roofTexture, signTexture, stripeTexture, helipadTexture, ribTexture } from './textures.js';

export function reg(m) {
  m.userData.baseEmissive = m.emissive.getHex();
  m.userData.baseEmissiveIntensity = m.emissiveIntensity;
  return m;
}

export function M(color, opts = {}) {
  return reg(new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts }));
}

export const glass = () => reg(new THREE.MeshStandardMaterial({
  color: PALETTE.glass, transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.4,
}));
export const glow = (color, i = 1.2) => reg(new THREE.MeshStandardMaterial({
  color: 0x0b3350, emissive: color, emissiveIntensity: i,
}));

export function add(g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, s = 20) => new THREE.CylinderGeometry(rt, rb, h, s);
export const dome = (r) => new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };

// box with per-face facade/roof textures: [+x, -x, +y, -y, +z, -z]
function tBox(g, w, h, d, opts, x, y, z, ry = 0) {
  const o = { seed: Math.abs(Math.round(x * 31 + z * 17)) + 3, ...opts };
  const fw = reg(new THREE.MeshStandardMaterial({ map: facadeTexture(w, h, o), roughness: 0.9 }));
  const fd = reg(new THREE.MeshStandardMaterial({ map: facadeTexture(d, h, o), roughness: 0.9 }));
  const roof = reg(new THREE.MeshStandardMaterial({ map: roofTexture(w, d, o.roofColor), roughness: 1 }));
  const mesh = new THREE.Mesh(box(w, h, d), [fd, fd, roof, roof, fw, fw]);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

const parapet = (g, w, d, y, color = 0xe6ebef) => add(g, box(w, 0.3, d), M(color), 0, y, 0);

const BUILDERS = {
  cityHall(g) {
    add(g, box(17.5, 0.5, 12.5), M(PALETTE.stone), 0, 0.25, 0);
    const white = { wall: '#f7fafc', accent: '#2f8fe6' };
    tBox(g, 16, 5, 11, { ...white, floors: 2, door: true }, 0, 3, 0);
    tBox(g, 6, 4, 8, { ...white, floors: 1 }, -10, 2.5, 0);
    tBox(g, 6, 4, 8, { ...white, floors: 1 }, 10, 2.5, 0);
    parapet(g, 16.5, 11.5, 5.65);
    add(g, cyl(5, 5.6, 3, 32), M('#f7fafc'), 0, 7, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      add(g, box(0.5, 3, 0.5), M('#e2e8ec'), Math.sin(a) * 5.2, 7, Math.cos(a) * 5.2);
    }
    add(g, dome(5), glass(), 0, 8.5, 0);
    add(g, new THREE.SphereGeometry(0.5, 12, 10), M(0xe8c15a), 0, 13.7, 0);
    add(g, box(7, 0.25, 2.4), M('#dfe5ea'), 0, 0.13, 6.6);
    add(g, box(6, 0.25, 1.6), M('#cfd6dc'), 0, 0.38, 6.2);
  },

  university(g) {
    tBox(g, 14, 6, 9, { wall: '#c96f4a', floors: 2, door: true, accent: '#f0e6d2' }, 0, 3, 0);
    tBox(g, 8, 4, 8, { wall: '#f0e6d2', floors: 1 }, -10, 2, 0);
    tBox(g, 3, 13, 3, { wall: '#f0e6d2', floors: 3 }, 6, 6.5, 3);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      add(g, box(0.35, 2.4, 0.35), M('#f0e6d2'), 6 + dx, 14.2, 3 + dz);
    }
    add(g, box(3.4, 0.4, 3.4), M('#c96f4a'), 6, 15.6, 3);
    add(g, new THREE.ConeGeometry(2.1, 3.4, 4), M(PALETTE.leaf), 6, 17.5, 3, 0, Math.PI / 4);
    add(g, new THREE.CircleGeometry(1, 24), M('#ffffff'), 6, 11, 4.55);
    add(g, box(0.09, 0.75, 0.06), M(0x22303c), 6, 11.2, 4.6);
    add(g, box(0.55, 0.09, 0.06), M(0x22303c), 6.15, 11, 4.6);
    add(g, flat(new THREE.PlaneGeometry(10, 6)), M(PALETTE.leaf), -2, 0.07, 9);
    add(g, flat(new THREE.RingGeometry(0.4, 2.6, 20)), M('#ffffff'), -2, 0.09, 9);
  },

  hospital(g) {
    const rib = { style: 'ribbon', wall: '#fbfdfe' };
    tBox(g, 14, 7, 10, { ...rib, floors: 3 }, 0, 3.5, 0);
    tBox(g, 6, 5, 8, { ...rib, floors: 2 }, -9, 2.5, 1);
    parapet(g, 14.5, 10.5, 7.15);
    add(g, box(5, 5, 0.5), M('#ffffff'), 0, 4.6, 5.3);
    const red = M(PALETTE.red);
    add(g, box(1.1, 3.6, 0.3), red, 0, 4.6, 5.6);
    add(g, box(3.6, 1.1, 0.3), red, 0, 4.6, 5.6);
    add(g, cyl(3.6, 3.6, 0.3, 32), M(PALETTE.gray), 3, 7.3, -2);
    add(g, flat(new THREE.CircleGeometry(3.2, 32)), reg(new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 1 })), 3, 7.47, -2);
    add(g, box(2, 1.4, 2), M(PALETTE.grayDark), -4, 7.9, -3);
  },

  factory(g) {
    tBox(g, 12, 6, 10, { style: 'industrial', wall: '#8d979f', door: true }, 0, 3, 0);
    tBox(g, 8, 5, 8, { style: 'industrial', wall: '#a5adb4' }, 9, 2.5, 3);
    for (const [x, z] of [[-3, 1], [0, 2], [3, 1]]) add(g, box(1.4, 0.9, 1.4), M(PALETTE.grayDark), x, 6.4, z);
    const stack = M(PALETTE.gray);
    const band = M(PALETTE.orange);
    for (const [x, z, h] of [[-3, -2, 9], [0, -3, 11], [3, -2, 9]]) {
      add(g, cyl(1, 1.3, h, 16), stack, x, h / 2 + 4, z);
      add(g, cyl(1.08, 1.08, 1, 16), band, x, h + 3.4, z);
    }
    add(g, cyl(0.5, 0.5, 8, 10), M(PALETTE.grayDark), 4, 2, -5, 0, 0, Math.PI / 2);
  },

  warehouse(g) {
    tBox(g, 18, 5, 10, { style: 'industrial', wall: '#aeb6bd' }, 0, 2.5, 0);
    const roof = new THREE.CylinderGeometry(5, 5, 18, 24, 1, true, 0, Math.PI);
    roof.rotateZ(Math.PI / 2);
    add(g, roof, M(PALETTE.grayDark), 0, 5, 0);
    add(g, new THREE.PlaneGeometry(12, 1.6), reg(new THREE.MeshStandardMaterial({ map: signTexture('LOGISTICS', '#1d4ed8'), roughness: 0.8 })), 0, 3.6, 5.12);
    const door = M(PALETTE.orange);
    for (const x of [-5, 0, 5]) {
      add(g, new THREE.PlaneGeometry(3, 3), door, x, 1.6, 5.06);
      add(g, box(3.4, 0.3, 0.3), M(PALETTE.grayDark), x, 3.2, 5.1);
    }
    add(g, box(16, 0.3, 2.5), M(PALETTE.stone), 0, 0.15, 6.2);
  },

  research(g) {
    tBox(g, 12, 2.5, 10, { style: 'glass', floors: 1, wall: '#dfe7ec' }, 0, 1.25, 0);
    tBox(g, 7, 16, 7, { style: 'glass', wall: '#e8eef2', floors: 6 }, -2, 10.5, -1);
    for (const [dx, dz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
      add(g, box(0.6, 16.4, 0.6), M('#f7fafc'), -2 + dx, 10.5, -1 + dz);
    }
    add(g, box(7.8, 0.5, 7.8), M('#f7fafc'), -2, 18.7, -1);
    add(g, dome(5), glass(), 3.5, 2.5, 2.5);
    add(g, cyl(0.08, 0.08, 4, 6), M(PALETTE.gray), -2, 21, -1);
    add(g, new THREE.SphereGeometry(0.3, 10, 8), glow(PALETTE.glowCyan), -2, 23.1, -1);
  },

  residential(g) {
    const walls = ['#f6e8d4', '#f2c9a7', '#bfe3c0', '#bcd7ee'];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = Math.sin(a) * 8;
      const z = Math.cos(a) * 8;
      tBox(g, 4, 3, 4, { wall: walls[i % 4], floors: 1, door: true, seed: i * 11 + 5 }, x, 1.5, z, a);
      add(g, new THREE.ConeGeometry(3.3, 2.2, 4), M(PALETTE.leaf), x, 4.1, z, 0, a + Math.PI / 4);
      add(g, box(0.5, 1.2, 0.5), M(PALETTE.brick), x + 1.2, 4.4, z + 0.8, 0, a);
    }
  },

  mall(g) {
    tBox(g, 16, 5, 10, { style: 'glass', floors: 2, wall: '#f0e6d2' }, 0, 2.5, 0);
    parapet(g, 16.5, 10.5, 5.15, 0xf0e6d2);
    add(g, new THREE.PlaneGeometry(8, 1.8), reg(new THREE.MeshStandardMaterial({ map: signTexture('MALL', '#2f8fe6'), roughness: 0.8 })), -1, 4.2, 5.12);
    add(g, cyl(5, 5, 5.5, 32), glass(), 6, 2.75, 3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(g, box(0.4, 5.5, 0.4), M('#f7fafc'), 6 + Math.sin(a) * 5, 2.75, 3 + Math.cos(a) * 5);
    }
    add(g, box(6, 0.3, 2.6), M('#f7fafc'), -4, 3.2, 6);
  },

  cafe(g) {
    tBox(g, 6, 3.5, 5, { wall: '#f5e7d0', floors: 1, door: true, accent: '#f2a03d' }, 0, 1.75, 0);
    const awning = reg(new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.9 }));
    add(g, box(6.4, 0.28, 2.2), awning, 0, 2.9, 3.4);
    add(g, new THREE.PlaneGeometry(3, 1), reg(new THREE.MeshStandardMaterial({ map: signTexture('CAFE', '#8a4b2a'), roughness: 0.8 })), 0, 3.9, 2.56);
    const table = M('#ffffff');
    for (const [x, z] of [[-2, 4.6], [2, 4.6], [0, 5.4]]) {
      add(g, cyl(0.5, 0.5, 0.7, 12), table, x, 0.35, z);
      add(g, new THREE.ConeGeometry(1, 0.8, 12), M(PALETTE.orange), x, 1.5, z);
    }
  },

  ailab(g) {
    const side = reg(new THREE.MeshStandardMaterial({ map: facadeTexture(38, 5, { style: 'glass', floors: 2, wall: '#e8eef2' }), roughness: 0.4 }));
    const cap = M('#f7fafc');
    add(g, cyl(6, 6.5, 5, 32), [side, cap, cap], 0, 2.5, 0);
    const band = add(g, new THREE.TorusGeometry(6.1, 0.25, 10, 48), glow(PALETTE.glowCyan), 0, 5, 0);
    band.rotation.x = Math.PI / 2;
    add(g, dome(6), glass(), 0, 5, 0);
    tBox(g, 5, 3, 6, { style: 'glass', floors: 1, wall: '#dfe7ec' }, -7, 1.5, 2);
  },

  power(g) {
    add(g, cyl(5.5, 6.5, 2, 24), M(PALETTE.gray), 0, 1, 0);
    const col = M(PALETTE.stone);
    for (const [x, z] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) add(g, box(1, 8, 1), col, x, 4.5, z);
    add(g, new THREE.SphereGeometry(2.6, 24, 16), glow(PALETTE.glowBlue, 1.6), 0, 5, 0);
    add(g, cyl(3.6, 3.6, 7.5, 24, 1, true), glass(), 0, 4.8, 0);
    add(g, cyl(4.5, 4.5, 1, 24), M(PALETTE.gray), 0, 9, 0);
    add(g, box(2, 1.2, 2), M(PALETTE.grayDark), 5.5, 0.6, 4);
    const ring = add(g, new THREE.TorusGeometry(5.8, 0.3, 10, 48), glow(PALETTE.glowCyan, 0.8), 0, 0.6, 0);
    ring.rotation.x = Math.PI / 2;
  },

  sports(g) {
    const ribs = reg(new THREE.MeshStandardMaterial({ map: ribTexture(), roughness: 0.9 }));
    ribs.map.repeat.set(24, 1);
    add(g, new THREE.CylinderGeometry(12, 12.8, 4.5, 48, 1, true), ribs, 0, 2.25, 0);
    const seats = add(g, new THREE.TorusGeometry(10.5, 1.6, 10, 48), M(0x3f7fbf), 0, 3.6, 0);
    seats.rotation.x = Math.PI / 2;
    seats.scale.z = 0.5;
    add(g, flat(new THREE.CircleGeometry(9.8, 48)), M(PALETTE.leaf), 0, 0.1, 0);
    add(g, flat(new THREE.RingGeometry(2.6, 3, 32)), M('#ffffff'), 0, 0.14, 0);
    add(g, flat(new THREE.PlaneGeometry(0.4, 19)), M('#ffffff'), 0, 0.14, 0);
    add(g, flat(new THREE.RingGeometry(11.5, 14.5, 48)), M('#f2f5f8'), 0, 4.6, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      add(g, box(0.5, 4.6, 0.5), M('#e2e8ec'), Math.sin(a) * 12.4, 2.3, Math.cos(a) * 12.4);
    }
  },

  park(g) {
    add(g, flat(new THREE.CircleGeometry(7, 40)), M(PALETTE.water, { roughness: 0.25 }), -2, 0.08, 2);
    add(g, cyl(2, 2.2, 2.4, 6), M(PALETTE.cream), 6, 1.2, -5);
    add(g, new THREE.ConeGeometry(2.8, 2, 6), M(PALETTE.red), 6, 3.4, -5);
    add(g, new THREE.TorusGeometry(3, 0.35, 8, 20, Math.PI), M(PALETTE.stone), -2, 0.2, 2, 0, 0.6);
    for (const [x, z] of [[4, 4], [-8, -3], [7, 1]]) {
      add(g, cyl(0.15, 0.15, 1.4, 6), M(PALETTE.grayDark), x, 0.7, z);
      add(g, new THREE.SphereGeometry(0.4, 10, 8), glow(0xffe9a8, 0.9), x, 1.5, z);
    }
  },
};

// Build one building. `mesher` overrides BUILDERS lookup so custom (AI-generated)
// buildings can be constructed without buildings.js importing custom.js.
export function buildBuilding(scene, def, mesher) {
  const build = mesher || BUILDERS[def.type];
  if (!build) {
    console.warn(`No builder for building type "${def.type}"`);
    return null;
  }
  const g = new THREE.Group();
  build(g, def);
  g.position.set(def.pos[0], 0, def.pos[1]);
  g.rotation.y = def.rot;
  g.userData.buildingId = def.id;
  scene.add(g);
  return g;
}

export function buildBuildings(scene) {
  const groups = [];
  const byId = {};
  for (const def of BUILDINGS) {
    const g = buildBuilding(scene, def);
    groups.push(g);
    byId[def.id] = g;
  }
  return { groups, byId };
}
