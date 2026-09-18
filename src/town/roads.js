import * as THREE from 'three';
import {
  PALETTE, SPOKE_ANGLES, spokeDir, RING_R, RING_W, ROUND_OUT,
  SECTOR_SPOKE_NODES, sectorPointAt, sectorNodeBearing, sectorBuildingDef,
  graphNode, graphAddNode, graphAddEdge, connectToGraph,
} from './data.js';
import { world } from './world.js';

const WALK_Y = 0.045;
const ROAD_Y = 0.06;
const DASH_Y = 0.12;

let mats = null;
function materials() {
  if (!mats) {
    mats = {
      road: new THREE.MeshStandardMaterial({ color: PALETTE.road, roughness: 1 }),
      walk: new THREE.MeshStandardMaterial({ color: 0xbfc7ce, roughness: 1 }),
      dash: new THREE.MeshStandardMaterial({
        color: PALETTE.dash,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    };
  }
  return mats;
}

function flat(container, geo, mat, y, x = 0, z = 0) {
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  container.add(m);
  return m;
}

// A straight road between any two world points — the core spoke loop generalised.
// Pass `dashInto` to collect centre-line dash transforms into one shared InstancedMesh.
export function roadSegment(container, ax, az, bx, bz, { width = RING_W, walkway = true, dashInto = null } = {}) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return null;
  const { road, walk } = materials();
  const rot = Math.atan2(dx, dz);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;

  if (walkway) {
    const w = flat(container, new THREE.PlaneGeometry(width + 3, len + 2), walk, WALK_Y, mx, mz);
    w.rotation.y = rot;
  }
  const r = flat(container, new THREE.PlaneGeometry(width, len + 2), road, ROAD_Y, mx, mz);
  r.rotation.y = rot;

  if (dashInto) {
    const ux = dx / len;
    const uz = dz / len;
    for (let t = 4; t < len - 3; t += 5) {
      dashInto.push({ x: ax + ux * t, z: az + uz * t, rot });
    }
  }
  return r;
}

export function addDashes(container, transforms) {
  if (!transforms.length) return null;
  const geo = new THREE.PlaneGeometry(0.5, 1.8);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, materials().dash, transforms.length);
  const dummy = new THREE.Object3D();
  transforms.forEach((t, i) => {
    dummy.position.set(t.x, DASH_Y, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  container.add(mesh);
  return mesh;
}

function ringRoad(container, cx, cz, r, dashInto) {
  const inner = r - RING_W / 2;
  flat(container, new THREE.RingGeometry(r - RING_W, r + RING_W, 96), materials().walk, WALK_Y, cx, cz);
  flat(container, new THREE.RingGeometry(inner, r + RING_W / 2, 96), materials().road, ROAD_Y, cx, cz);
  if (dashInto) {
    const count = Math.max(16, Math.round((2 * Math.PI * r) / 9.4));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      dashInto.push({
        x: cx + Math.sin(a) * r,
        z: cz + Math.cos(a) * r,
        rot: Math.atan2(Math.cos(a), -Math.sin(a)),
      });
    }
  }
}

function roundabout(container, cx, cz, outer) {
  flat(container, new THREE.RingGeometry(outer - RING_W - 0.5, outer + 2.5, 64), materials().walk, WALK_Y, cx, cz);
  flat(container, new THREE.RingGeometry(outer - RING_W, outer, 64), materials().road, ROAD_Y, cx, cz);
}

export function buildRoads(container) {
  const group = new THREE.Group();
  group.name = 'roads';
  container.add(group);
  world.roads = group;

  roundabout(group, 0, 0, ROUND_OUT);
  ringRoad(group, 0, 0, RING_R, null);

  // core dash layout is bespoke and predates roadSegment: spokes, 40 around the
  // ring, then a fixed run down the bridge
  const dashes = [];
  for (const a of SPOKE_ANGLES) {
    const d = spokeDir(a);
    roadSegment(group, d.x * ROUND_OUT, d.z * ROUND_OUT, d.x * (RING_R - RING_W / 2), d.z * (RING_R - RING_W / 2));
    world.obstacles.segments.push({
      ax: d.x * ROUND_OUT, az: d.z * ROUND_OUT,
      bx: d.x * (RING_R - RING_W / 2), bz: d.z * (RING_R - RING_W / 2),
      halfW: RING_W / 2 + 3,
    });
    const rot = Math.atan2(d.x, d.z);
    for (let t = ROUND_OUT + 4; t < RING_R - 4; t += 5) dashes.push({ x: d.x * t, z: d.z * t, rot });
  }

  // south extension out to the bridge deck
  roadSegment(group, 0, 58, 0, 140);
  world.obstacles.segments.push({ ax: 0, az: 58, bx: 0, bz: 140, halfW: RING_W / 2 + 3 });
  for (let z = 66; z <= 138; z += 5) dashes.push({ x: 0, z, rot: 0 });

  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    dashes.push({ x: Math.sin(a) * RING_R, z: Math.cos(a) * RING_R, rot: Math.atan2(Math.cos(a), -Math.sin(a)) });
  }
  addDashes(group, dashes);

  world.obstacles.circles.push({ x: 0, z: 0, r: ROUND_OUT + 3 });
  world.obstacles.rings.push({ x: 0, z: 0, r: RING_R, halfW: RING_W / 2 + 3 });

  buildStatue(group);
  return group;
}

// Roads for one docked sector: ring, roundabout, radial spokes, the connector back to
// the core graph anchor, and a driveway per sector building. Also stitches the new
// nodes and edges into ROAD_GRAPH so connectivity is queryable, not just visual.
export function buildSectorRoads(sector) {
  const group = world.roads;
  const [ox, oz] = sector.offset;
  const dashes = [];

  roundabout(group, ox, oz, sector.round);
  ringRoad(group, ox, oz, sector.ring, dashes);

  for (const k of SECTOR_SPOKE_NODES) {
    const d = spokeDir(sectorNodeBearing(sector, k));
    const ax = ox + d.x * sector.round;
    const az = oz + d.z * sector.round;
    const bx = ox + d.x * (sector.ring - RING_W / 2);
    const bz = oz + d.z * (sector.ring - RING_W / 2);
    roadSegment(group, ax, az, bx, bz, { dashInto: dashes });
    world.obstacles.segments.push({ ax, az, bx, bz, halfW: RING_W / 2 + 3 });
  }

  // connector: core anchor node -> the ring node the connector arrives at
  const anchor = graphNode(sector.anchor);
  const entry = sectorPointAt(sector, 0, sector.ring);
  const entryId = `s:${sector.id}:in`;
  graphAddNode(entryId, entry.x, entry.z);
  if (anchor) {
    roadSegment(group, anchor.x, anchor.z, entry.x, entry.z, { dashInto: dashes });
    world.obstacles.segments.push({ ax: anchor.x, az: anchor.z, bx: entry.x, bz: entry.z, halfW: RING_W / 2 + 3 });
    graphAddEdge(sector.anchor, entryId);
  }

  // ring nodes chained into a loop; node 0 is the entry the connector lands on
  const ringIds = [entryId];
  for (let k = 1; k < 8; k++) {
    const id = `s:${sector.id}:r${k}`;
    const p = sectorPointAt(sector, k, sector.ring);
    graphAddNode(id, p.x, p.z);
    ringIds.push(id);
  }
  for (let k = 0; k < 8; k++) graphAddEdge(ringIds[k], ringIds[(k + 1) % 8]);

  // roundabout at the sector centre, joined to the ring by the radial spokes
  const centreId = `s:${sector.id}:c`;
  graphAddNode(centreId, ox, oz);
  for (const k of SECTOR_SPOKE_NODES) graphAddEdge(centreId, ringIds[k]);

  // driveways out to each sector building, which also become graph leaves
  for (const b of sector.buildings) {
    const def = sectorBuildingDef(sector, b);
    const near = sectorPointAt(sector, b.k, sector.ring);
    const far = sectorPointAt(sector, b.k, b.lr - 4);
    roadSegment(group, near.x, near.z, far.x, far.z, { width: 4 });
    world.obstacles.segments.push({ ax: near.x, az: near.z, bx: far.x, bz: far.z, halfW: 5 });
    connectToGraph(`b:${def.id}`, def.pos[0], def.pos[1]);
  }

  addDashes(group, dashes);

  world.obstacles.circles.push({ x: ox, z: oz, r: sector.round + 2.5 });
  world.obstacles.rings.push({ x: ox, z: oz, r: sector.ring, halfW: RING_W / 2 + 3 });
}

function buildStatue(scene) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 1 });
  const white = new THREE.MeshStandardMaterial({ color: PALETTE.white, roughness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x0b3350,
    emissive: PALETTE.glowCyan,
    emissiveIntensity: 1.4,
  });

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 1.1, 32), stone);
  basin.position.y = 0.55;
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 32),
    new THREE.MeshStandardMaterial({ color: PALETTE.glowBlue, roughness: 0.2 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 1.12;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 1.8, 4, 14), white);
  body.position.y = 3.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 14), white);
  head.position.y = 5.7;
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 10), white);
  earL.position.set(-1.4, 5.7, 0);
  earL.rotation.z = Math.PI / 2;
  const earR = earL.clone();
  earR.position.x = 1.4;
  earR.rotation.z = -Math.PI / 2;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), glow);
  eyeL.position.set(-0.45, 5.85, 1.15);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.45;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), white);
  antenna.position.y = 7.3;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), glow);
  tip.position.y = 7.75;

  for (const m of [basin, body, head, earL, earR]) m.castShadow = true;
  g.add(basin, pool, body, head, earL, earR, eyeL, eyeR, antenna, tip);
  scene.add(g);
}
