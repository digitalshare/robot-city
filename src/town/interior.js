import * as THREE from 'three';
import { M, glow, glass, box, add } from './buildings.js';
import { buildParts } from './custom.js';
import { disposeGroup } from './world.js';
import { MAX_ROBOTS } from './spaces.js';
import { objectRadius, resolveParts } from './objects.js';
import { robotKey, robotParts, robotRadius, robotTypeById } from './robots.js';

const ROBOT_R = 0.3;

// One material per colour-and-finish for the whole room: a furnished interior is a few hundred
// meshes over a dozen surfaces, and a /space redesign disposes them all at once.
function makeKit(spec) {
  const std = new Map();
  const lit = new Map();
  const mat = (color, opts = {}) => {
    const key = `${color}|${opts.roughness ?? ''}|${opts.metalness ?? ''}`;
    let m = std.get(key);
    if (!m) {
      m = M(color, opts);
      std.set(key, m);
    }
    return m;
  };
  const light = (color, i = 1.4) => {
    const key = `${color}|${i}`;
    let m = lit.get(key);
    if (!m) {
      m = glow(color, i);
      lit.set(key, m);
    }
    return m;
  };
  const p = spec.palette || {};
  const accent = p.accent || '#2f8fe6';
  return {
    mat,
    light,
    accent,
    floor: mat(p.floor || '#c9d2da', { roughness: 0.95 }),
    wall: mat(p.wall || '#eef2f6', { roughness: 0.95 }),
    ceiling: mat('#dfe5ea', { roughness: 1 }),
    trim: mat(accent, { roughness: 0.7 }),
  };
}

// ---- robots ----
//
// A robot in here is one record from the town roster (town/robots.js), not a room decoration: the
// same record walks the streets when its building is not mounted. Meshing one gives it a wanderer;
// editing one re-meshes only its own group, so the room, its furniture and the camera never move.

function extraFor(radius) {
  return Math.max(0, radius - ROBOT_R);
}

function robotGroup(rec) {
  const g = new THREE.Group();
  g.name = `robot:${rec.id}`;
  g.userData.robotId = rec.id;
  buildParts(g, robotParts(robotTypeById(rec.modelId), rec.color));
  g.scale.setScalar(rec.scale ?? 1);
  return g;
}

export function addRobotMesh(built, rec, at = null) {
  const extra = extraFor(robotRadius(rec));
  const start = at || freeSpot(built.room, built.blockers, extra);
  const next = freeSpot(built.room, built.blockers, extra, start);
  const robot = {
    id: rec.id,
    key: robotKey(rec),
    mesh: robotGroup(rec),
    x: start.x,
    z: start.z,
    tx: next.x,
    tz: next.z,
    speed: rec.speed ?? 1.5,
    scale: rec.scale ?? 1,
    radius: robotRadius(rec),
    phase: Math.random() * Math.PI * 2,
  };
  built.scene.add(robot.mesh);
  built.robots.push(robot);
  return robot;
}

export function removeRobotMesh(built, id) {
  const i = built.robots.findIndex((r) => r.id === id);
  if (i < 0) return false;
  const [robot] = built.robots.splice(i, 1);
  built.scene.remove(robot.mesh);
  disposeGroup(robot.mesh);
  return true;
}

export function replaceRobotMesh(built, rec) {
  const i = built.robots.findIndex((r) => r.id === rec.id);
  const at = i < 0 ? null : { x: built.robots[i].x, z: built.robots[i].z };
  removeRobotMesh(built, rec.id);
  const robot = addRobotMesh(built, rec, at);
  // addRobotMesh appends; putting the walker back where it was keeps a re-mesh from reordering
  // the room's robots
  if (i >= 0 && robot) {
    built.robots.splice(built.robots.indexOf(robot), 1);
    built.robots.splice(i, 0, robot);
  }
  return robot;
}

// extra is the walker's own footprint beyond the standard robot radius, so a hauler keeps further
// from the walls and the furniture than a courier does
function blocked(x, z, room, blockers, extra = 0) {
  if (Math.abs(x) > room.hw - 0.45 - extra || Math.abs(z) > room.hd - 0.45 - extra) return true;
  for (const b of blockers) {
    const dx = x - b.x;
    const dz = z - b.z;
    const r = b.r + extra;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function freeSpot(room, blockers, extra = 0, fallback = null) {
  const bx = room.hw - 0.7 - extra;
  const bz = room.hd - 0.7 - extra;
  if (bx > 0 && bz > 0) {
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() * 2 - 1) * bx;
      const z = (Math.random() * 2 - 1) * bz;
      if (!blocked(x, z, room, blockers, extra)) return { x, z };
    }
  }
  // a robot too big for the gaps left holds where it is rather than snapping to the room centre
  return fallback ? { x: fallback.x, z: fallback.z } : { x: 0, z: 0 };
}

// Build a building's interior as its own scene, lit locally so it never has to share the town's
// shadow frustum. The town scene stays mounted in memory; main.js just renders this one instead.
export function buildInterior(def, spec, objects = [], crew = []) {
  const [w, d] = spec.floor;
  const hw = w / 2;
  const hd = d / 2;
  const wallH = spec.wallHeight;
  const k = makeKit(spec);

  const scene = new THREE.Scene();
  scene.name = `interior:${def.id}`;
  scene.background = new THREE.Color(0x101c28);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a88, 0.65));

  add(scene, box(w, 0.2, d), k.floor, 0, -0.1, 0);

  // Single-sided planes facing inward: orbiting outside the shell culls the near surfaces, so the
  // room reads as a dollhouse rather than a sealed box the camera cannot get into.
  const ceil = new THREE.PlaneGeometry(w, d);
  ceil.rotateX(Math.PI / 2);
  add(scene, ceil, k.ceiling, 0, wallH, 0);
  add(scene, new THREE.PlaneGeometry(w, wallH), k.wall, 0, wallH / 2, -hd);
  add(scene, new THREE.PlaneGeometry(d, wallH), k.wall, -hw, wallH / 2, 0, 0, Math.PI / 2, 0);
  add(scene, new THREE.PlaneGeometry(d, wallH), k.wall, hw, wallH / 2, 0, 0, -Math.PI / 2, 0);

  const doorW = Math.min(3, w * 0.3);
  const doorH = Math.min(2.2, wallH * 0.62);
  const sideW = (w - doorW) / 2;
  const front = (geo, x, y) => add(scene, geo, k.wall, x, y, hd, 0, Math.PI, 0);
  front(new THREE.PlaneGeometry(sideW, wallH), -(doorW + sideW) / 2, wallH / 2);
  front(new THREE.PlaneGeometry(sideW, wallH), (doorW + sideW) / 2, wallH / 2);
  front(new THREE.PlaneGeometry(doorW, wallH - doorH), 0, doorH + (wallH - doorH) / 2);
  const pane = glass();
  pane.side = THREE.DoubleSide;
  add(scene, new THREE.PlaneGeometry(doorW, doorH), pane, 0, doorH / 2, hd, 0, Math.PI, 0);

  add(scene, box(w, 0.12, 0.06), k.trim, 0, 0.06, -hd + 0.03);
  add(scene, box(0.06, 0.12, d), k.trim, -hw + 0.03, 0.06, 0);
  add(scene, box(0.06, 0.12, d), k.trim, hw - 0.03, 0.06, 0);

  const strips = Math.max(2, Math.min(4, Math.round(d / 7)));
  for (let i = 0; i < strips; i++) {
    const z = -hd + (d * (i + 0.5)) / strips;
    add(scene, box(Math.min(w * 0.7, 8), 0.08, 0.35), k.light('#eaf6ff', 1.5), 0, wallH - 0.06, z);
  }

  const room = { w, d, hw, hd, wallH };
  const built = { scene, robots: [], blockers: [], room, spec, objectGroups: [] };

  // Everything standing on the floor is an object instance, meshed before the robots spawn so
  // their wander targets already steer around the furniture.
  for (const inst of objects) addObject(built, inst);

  // crew is already the resolved on-duty list, so it is only capped here, never filtered
  for (const rec of crew.slice(0, MAX_ROBOTS)) addRobotMesh(built, rec);

  return built;
}

// ---- indoor objects ----
//
// Objects are added to a live room: meshing one group never rebuilds the shell and never resets
// the robots. Each instance also owns one blocker circle, so wanderers steer around what the user
// placed exactly as they do around furniture.

function placeGroup(g, inst) {
  g.position.set(inst.pos[0], 0, inst.pos[1]);
  g.rotation.y = inst.rot || 0;
  g.scale.setScalar(inst.scale ?? 1);
}

function blockerOf(inst) {
  return { x: inst.pos[0], z: inst.pos[1], r: objectRadius(inst) + ROBOT_R, id: inst.id };
}

export function addObject(built, inst) {
  const g = new THREE.Group();
  g.name = `object:${inst.id}`;
  g.userData.objectId = inst.id;
  buildParts(g, resolveParts(inst));
  placeGroup(g, inst);
  built.scene.add(g);
  built.objectGroups.push(g);
  built.blockers.push(blockerOf(inst));
  return g;
}

export function removeObject(built, id) {
  const i = built.objectGroups.findIndex((g) => g.userData.objectId === id);
  if (i < 0) return false;
  const g = built.objectGroups[i];
  built.objectGroups.splice(i, 1);
  built.scene.remove(g);
  disposeGroup(g);
  const bi = built.blockers.findIndex((b) => b.id === id);
  if (bi >= 0) built.blockers.splice(bi, 1);
  return true;
}

// adjustments change geometry, so they re-mesh the one group rather than patching materials
export function replaceObject(built, inst) {
  removeObject(built, inst.id);
  return addObject(built, inst);
}

// the drag path: only the group and its blocker move
export function moveObject(built, id, x, z) {
  const g = built.objectGroups.find((o) => o.userData.objectId === id);
  if (!g) return false;
  g.position.set(x, 0, z);
  const b = built.blockers.find((o) => o.id === id);
  if (b) {
    b.x = x;
    b.z = z;
  }
  return true;
}

export function objectGroup(built, id) {
  return built.objectGroups.find((g) => g.userData.objectId === id) || null;
}

// Where a new object of this radius can stand: clear of every blocker and of the walls. The room
// centre is the fallback, matching freeSpot()'s behaviour for robots.
export function freeSpotFor(built, radius) {
  const { room, blockers } = built;
  const bx = room.hw - radius - 0.4;
  const bz = room.hd - radius - 0.4;
  if (bx <= 0 || bz <= 0) return { x: 0, z: 0 };
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * 2 - 1) * bx;
    const z = (Math.random() * 2 - 1) * bz;
    let clear = true;
    for (const b of blockers) {
      if (Math.hypot(x - b.x, z - b.z) < b.r + radius + 0.3) {
        clear = false;
        break;
      }
    }
    if (clear) return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  }
  return { x: 0, z: 0 };
}

// Wander agents: walk to a target, pick a new one on arrival, and refuse both targets and steps
// that would end up inside a piece of furniture.
export function updateRobots(built, dt, now) {
  const { robots, blockers, room } = built;
  for (const r of robots) {
    const extra = extraFor(r.radius);
    let dx = r.tx - r.x;
    let dz = r.tz - r.z;
    let dist = Math.hypot(dx, dz);
    if (dist < 0.3) {
      const next = freeSpot(room, blockers, extra, r);
      r.tx = next.x;
      r.tz = next.z;
      dx = r.tx - r.x;
      dz = r.tz - r.z;
      dist = Math.hypot(dx, dz) || 1;
    }
    const step = Math.min(dist, r.speed * dt);
    const nx = r.x + (dx / dist) * step;
    const nz = r.z + (dz / dist) * step;
    if (blocked(nx, nz, room, blockers, extra)) {
      const next = freeSpot(room, blockers, extra, r);
      r.tx = next.x;
      r.tz = next.z;
    } else {
      r.x = nx;
      r.z = nz;
    }
    r.mesh.position.set(r.x, 0.03 + Math.sin(now * 0.006 + r.phase) * 0.05 * r.scale, r.z);
    r.mesh.rotation.y = Math.atan2(dx, dz);
  }
}

export function disposeInterior(built) {
  if (!built) return;
  disposeGroup(built.scene);
  built.scene.clear();
  built.robots.length = 0;
  built.blockers.length = 0;
  built.objectGroups.length = 0;
}
