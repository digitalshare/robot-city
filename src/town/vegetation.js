import * as THREE from 'three';
import {
  PALETTE, BUILDINGS, SPOKE_ANGLES, spokeDir, RING_R, RING_W, ROUND_OUT,
  islandRadiusAt, sectorRadiusAt, rng,
} from './data.js';
import { world } from './world.js';

// What the frozen core sampler already accounted for. Anything the town gains later
// (a docked sector's roads, a confirmed AI building) still has to clear trees, but
// resampling would move every existing tree because a rejection consumes rng draws.
// So: sample once deterministically, then post-filter.
let baseline = null;
function captureBaseline() {
  if (baseline) return;
  baseline = {
    ids: new Set(BUILDINGS.map((b) => b.id)),
    circles: world.obstacles.circles.length,
    rings: world.obstacles.rings.length,
    segments: world.obstacles.segments.length,
  };
}

function distToSegment(px, pz, s) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.min(1, Math.max(0, ((px - s.ax) * dx + (pz - s.az) * dz) / l2)) : 0;
  return Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
}

function clearOf(x, z) {
  for (const b of world.buildings) {
    if (baseline.ids.has(b.id)) continue;
    const dx = x - b.pos[0];
    const dz = z - b.pos[1];
    const d2 = dx * dx + dz * dz;
    // park ponds stay clear, but the rest of a park keeps its blossoms
    const r = b.type === 'park' ? 7.5 : b.footprint + 2;
    if (d2 < r * r) return false;
  }
  for (let i = baseline.circles; i < world.obstacles.circles.length; i++) {
    const c = world.obstacles.circles[i];
    if (Math.hypot(x - c.x, z - c.z) < c.r + 1) return false;
  }
  for (let i = baseline.rings; i < world.obstacles.rings.length; i++) {
    const r = world.obstacles.rings[i];
    if (Math.abs(Math.hypot(x - r.x, z - r.z) - r.r) < r.halfW + 1) return false;
  }
  for (let i = baseline.segments; i < world.obstacles.segments.length; i++) {
    const s = world.obstacles.segments[i];
    if (distToSegment(x, z, s) < s.halfW + 1) return false;
  }
  return true;
}

// the core forest, byte-identical to the original hand-tuned layout
function sampleCoreSpots() {
  const rand = rng(1337);
  const park = BUILDINGS.find((b) => b.type === 'park');
  const spots = [];
  let guard = 0;

  while (spots.length < 420 && guard++ < 6000) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 96;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (r > islandRadiusAt(a) - 4) continue;

    const pdx = x - park.pos[0];
    const pdz = z - park.pos[1];
    const parkD2 = pdx * pdx + pdz * pdz;
    const inPark = parkD2 < park.footprint * park.footprint;
    if (inPark && parkD2 < 49) continue;

    if (!inPark) {
      if (r < 22) continue;
      if (Math.abs(r - RING_R) < RING_W / 2 + 3) continue;
      let bad = Math.abs(x) < 5 && z > 55;
      if (!bad) {
        for (const s of SPOKE_ANGLES) {
          const d = spokeDir(s);
          const proj = x * d.x + z * d.z;
          const perp = Math.abs(x * d.z - z * d.x);
          if (proj > ROUND_OUT - 2 && proj < RING_R + 2 && perp < 5) { bad = true; break; }
        }
      }
      if (!bad) {
        for (const b of BUILDINGS) {
          if (b.type === 'park') continue;
          const dx = x - b.pos[0];
          const dz = z - b.pos[1];
          const fp = b.footprint + 2;
          if (dx * dx + dz * dz < fp * fp) { bad = true; break; }
        }
      }
      if (bad) continue;
    }

    spots.push({ x, z, s: 0.8 + rand() * 0.7, pink: rand() < (inPark ? 0.35 : 0.12) });
  }
  return spots;
}

// a docked sector gets its own seeded sampler; its roads and buildings are cleared by
// the shared post-filter, which also covers the connector crossing the overlap
function sampleSectorSpots(sector, index) {
  const rand = rng(1337 + index * 97);
  const [ox, oz] = sector.offset;
  const spots = [];
  let guard = 0;

  while (spots.length < 120 && guard++ < 4000) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 62;
    if (r > sectorRadiusAt(a, sector) - 5) continue;
    const x = ox + Math.cos(a) * r;
    const z = oz + Math.sin(a) * r;
    spots.push({ x, z, s: 0.8 + rand() * 0.7, pink: rand() < 0.12 });
  }
  return spots;
}

function plant(group, spots) {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 6);
  trunkGeo.translate(0, 0.8, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(1.5, 1);
  canopyGeo.translate(0, 2.4, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 1 });
  const greenMat = new THREE.MeshStandardMaterial({ color: PALETTE.leaf, roughness: 1 });
  const pinkMat = new THREE.MeshStandardMaterial({ color: PALETTE.pink, roughness: 1 });

  const greens = spots.filter((s) => !s.pink);
  const pinks = spots.filter((s) => s.pink);

  const dummy = new THREE.Object3D();
  const fill = (mesh, list, yOff) => {
    list.forEach((s, i) => {
      dummy.position.set(s.x, yOff, s.z);
      dummy.rotation.set(0, (i * 1.7) % Math.PI, 0);
      dummy.scale.set(s.s, s.s * (0.85 + ((i * 7) % 10) / 22), s.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
  };

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  fill(trunks, spots, 0);
  const greenMesh = new THREE.InstancedMesh(canopyGeo, greenMat, greens.length);
  fill(greenMesh, greens, 0);
  const pinkMesh = new THREE.InstancedMesh(canopyGeo, pinkMat, pinks.length);
  fill(pinkMesh, pinks, 0);

  greenMesh.castShadow = true;
  pinkMesh.castShadow = true;
  group.add(trunks, greenMesh, pinkMesh);
}

export function buildVegetation(container) {
  captureBaseline();
  const group = new THREE.Group();
  group.name = 'vegetation';
  container.add(group);
  plant(group, sampleCoreSpots().filter((s) => clearOf(s.x, s.z)));
  return group;
}

export function buildSectorVegetation(container, sector, index) {
  captureBaseline();
  const group = new THREE.Group();
  group.name = `vegetation-${sector.id}`;
  container.add(group);
  plant(group, sampleSectorSpots(sector, index).filter((s) => clearOf(s.x, s.z)));
  return group;
}
