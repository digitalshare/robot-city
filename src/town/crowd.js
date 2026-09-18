import * as THREE from 'three';
import { ROAD_GRAPH, graphNode, graphNeighbors, nearestGraphNode } from './data.js';
import { sharedPart } from './custom.js';
import { world } from './world.js';
import { robotParts, robotTypeById } from './robots.js';

// The street crowd: every robot on the roster that is not standing inside a room walks the road
// graph. All of them simulate — cheap arithmetic, and it keeps their positions continuous across
// entering and leaving a building — but only the CROWD_MAX nearest the camera are meshed, out of
// one pool of groups over shared geometry and materials.
export const CROWD_MAX = 24;

// roads sit at 0.06 and walkways at 0.045
const STAND_Y = 0.07;

let group = null;
let walkers = new Map();
const pool = [];
const order = [];
let camX = 0;
let camZ = 0;

const dist2 = (w) => (w.x - camX) ** 2 + (w.z - camZ) ** 2;

const keyOf = (rec) => `${rec.modelId}|${rec.color}|${rec.scale ?? 1}`;

function place(w) {
  w.x = w.a.x + (w.b.x - w.a.x) * w.t;
  w.z = w.a.z + (w.b.z - w.a.z) * w.t;
  w.rot = Math.atan2(w.b.x - w.a.x, w.b.z - w.a.z);
}

// walk on to the next edge, never straight back the way it came unless the node is a dead end
function nextEdge(w) {
  const ahead = graphNeighbors(w.b.id);
  const opts = ahead.filter((id) => id !== w.a.id);
  const list = opts.length ? opts : ahead;
  if (!list.length) return false;
  const node = graphNode(list[Math.floor(Math.random() * list.length)]);
  if (!node) return false;
  w.a = w.b;
  w.b = node;
  w.len = Math.max(0.001, Math.hypot(node.x - w.a.x, node.z - w.a.z));
  return true;
}

function makeWalker(rec) {
  const home = world.buildings.find((b) => b.id === rec.home);
  const node = (home && nearestGraphNode(home.pos[0], home.pos[1], (n) => !n.id.startsWith('b:')))
    || ROAD_GRAPH.nodes[0];
  const w = {
    id: rec.id,
    key: keyOf(rec),
    a: node,
    b: node,
    t: 0,
    len: 1,
    x: node.x,
    z: node.z,
    rot: 0,
    speed: rec.speed || 1.5,
    phase: Math.random() * Math.PI * 2,
    mesh: null,
  };
  nextEdge(w);
  // spread the crowd along their first edges instead of clustering at the nearest node
  w.t = Math.random();
  place(w);
  return w;
}

function step(w, dt) {
  w.t += (w.speed * dt) / w.len;
  let guard = 0;
  while (w.t >= 1 && guard++ < 4) {
    w.t -= 1;
    if (!nextEdge(w)) {
      w.t = 0;
      break;
    }
  }
  place(w);
}

// Re-mesh a pooled group only when the robot wearing it changed model, colour or size. Shared
// geometry and materials mean clearing the group frees nothing and costs nothing.
function meshInto(g, key) {
  const [modelId, color, scaleText] = key.split('|');
  const parts = robotParts(robotTypeById(modelId), color);
  g.clear();
  for (const part of parts) {
    const built = sharedPart(part);
    if (!built) continue;
    const mesh = new THREE.Mesh(built.geo, built.mat);
    mesh.position.set(part.pos[0], part.pos[1] + built.lift, part.pos[2]);
    mesh.rotation.y = part.rot ?? 0;
    g.add(mesh);
  }
  g.scale.setScalar(Number(scaleText) || 1);
  g.userData.key = key;
}

// Roster changes come through here: existing walkers keep their position and pick up the new
// model/colour/size/speed, new records get a walker, removed ones give theirs back.
export function syncCrowd() {
  if (!group) return;
  const next = new Map();
  for (const rec of world.robots) {
    const prev = walkers.get(rec.id);
    if (prev) {
      prev.key = keyOf(rec);
      prev.speed = rec.speed || 1.5;
      next.set(rec.id, prev);
    } else {
      const w = makeWalker(rec);
      next.set(w.id, w);
    }
  }
  for (const w of walkers.values()) {
    if (next.has(w.id) || !w.mesh) continue;
    w.mesh.visible = false;
    w.mesh.userData.robotId = null;
    w.mesh = null;
  }
  walkers = next;
}

function assignMeshes(cam, now) {
  for (const g of pool) g.visible = false;
  order.length = 0;
  for (const w of walkers.values()) {
    w.mesh = null;
    order.push(w);
  }
  camX = cam.position.x;
  camZ = cam.position.z;
  order.sort((p, q) => dist2(p) - dist2(q));

  let visible = 0;
  const n = Math.min(CROWD_MAX, order.length);
  for (let i = 0; i < n; i++) {
    const w = order[i];
    const g = pool[i];
    if (g.userData.key !== w.key) meshInto(g, w.key);
    g.userData.robotId = w.id;
    g.position.set(w.x, STAND_Y + Math.sin(now * 0.006 + w.phase) * 0.06, w.z);
    g.rotation.y = w.rot;
    g.visible = true;
    w.mesh = g;
    visible++;
  }
  return visible;
}

// Added straight to the scene and never to world.groups: a robot must not be pickable as a
// building, or clicking one on the street would walk the camera into its home.
export function initCrowd(scene) {
  group = new THREE.Group();
  group.name = 'crowd';
  for (let i = 0; i < CROWD_MAX; i++) {
    const g = new THREE.Group();
    g.visible = false;
    group.add(g);
    pool.push(g);
  }
  scene.add(group);
  syncCrowd();
  return group;
}

export function updateCrowd(dt, now, cam) {
  if (!group) return;
  for (const w of walkers.values()) step(w, dt);
  assignMeshes(cam, now);
}

// where a robot that is not standing inside a room currently is, for the UI's live readout
export function crowdRobotPos(id) {
  const w = walkers.get(id);
  return w ? { x: w.x, z: w.z } : null;
}

export function crowdStats() {
  const sample = [];
  let i = 0;
  for (const w of walkers.values()) {
    if (i++ >= 4) break;
    sample.push([Math.round(w.x * 100) / 100, Math.round(w.z * 100) / 100]);
  }
  return {
    total: walkers.size,
    visible: pool.reduce((n, g) => n + (g.visible ? 1 : 0), 0),
    meshes: pool.length,
    inWorldGroups: group ? world.groups.includes(group) : null,
    sample,
  };
}

export function pickCrowdRobot(raycaster) {
  if (!group) return null;
  const targets = pool.filter((g) => g.visible);
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.robotId) o = o.parent;
  return o ? o.userData.robotId : null;
}
