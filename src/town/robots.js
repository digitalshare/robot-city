import { rng } from './data.js';
import { hashId, MAX_ROBOTS } from './spaces.js';
import { objectMetrics, OBJ_SCALE_MIN, OBJ_SCALE_MAX } from './objects.js';
import { world } from './world.js';

// The robot model library. Every model is one parts-DSL array — the same shape language custom
// buildings and indoor objects use — so an imported robot is just another entry here. Parts carry
// `tint: true` where an individual's own colour shows through.
//
// pos.y is the height of the part's BASE above the ground, sizes are [w, h, d] for a box,
// [radius, height] for a cylinder or cone and [radius] for a sphere or dome.

const DARK = '#5b6670';
const METAL = '#9aa3ad';
const SHELL = '#e8eef2';
const VISOR = '#59e3ff';

export const ROBOT_TYPES = [
  {
    id: 'citizen', name: 'Citizen', color: '#37b6ff', speed: 1.5, radius: 0.3,
    desc: 'The everyday town robot: treads, a bright torso and a visor under one antenna.',
    tags: 'citizen default basic walker town robot',
    parts: [
      { shape: 'box', size: [0.5, 0.08, 0.36], pos: [0, 0.12, 0], material: 'stone', color: DARK },
      { shape: 'box', size: [0.42, 0.5, 0.3], pos: [0, 0.19, 0], material: 'wall', color: '#37b6ff', tint: true },
      { shape: 'box', size: [0.3, 0.24, 0.26], pos: [0, 0.69, 0], material: 'wall', color: SHELL },
      { shape: 'box', size: [0.2, 0.07, 0.03], pos: [0, 0.785, 0.135], material: 'glow', color: VISOR },
      { shape: 'cylinder', size: [0.018, 0.2], pos: [0, 0.92, 0], material: 'metal', color: METAL },
      { shape: 'sphere', size: [0.045], pos: [0, 1.095, 0], material: 'glow', color: '#37b6ff', tint: true },
    ],
  },
  {
    id: 'courier', name: 'Courier', color: '#f2a03d', speed: 2.2, radius: 0.28,
    desc: 'Slim and fast, with a locked cargo box on its back and a single sensor eye.',
    tags: 'courier delivery fast parcel cargo runner',
    parts: [
      { shape: 'box', size: [0.34, 0.1, 0.3], pos: [0, 0.08, 0], material: 'stone', color: DARK },
      { shape: 'box', size: [0.26, 0.46, 0.24], pos: [0, 0.18, 0], material: 'wall', color: '#f2a03d', tint: true },
      { shape: 'box', size: [0.28, 0.3, 0.16], pos: [0, 0.26, -0.2], material: 'metal', color: METAL },
      { shape: 'box', size: [0.22, 0.2, 0.22], pos: [0, 0.64, 0], material: 'wall', color: SHELL },
      { shape: 'sphere', size: [0.05], pos: [0, 0.7, 0.12], material: 'glow', color: VISOR },
      { shape: 'cylinder', size: [0.014, 0.26], pos: [0, 0.84, 0], material: 'metal', color: METAL },
    ],
  },
  {
    id: 'medic', name: 'Medic', color: '#ff8080', speed: 1.6, radius: 0.32,
    desc: 'Round white shell with a red cross and a status band that lights up on a call-out.',
    tags: 'medic medical hospital nurse rescue ambulance',
    parts: [
      { shape: 'cylinder', size: [0.22, 0.1], pos: [0, 0.06, 0], material: 'stone', color: DARK },
      { shape: 'cylinder', size: [0.3, 0.5], pos: [0, 0.16, 0], material: 'wall', color: '#f7fafc' },
      { shape: 'box', size: [0.07, 0.22, 0.03], pos: [0, 0.3, 0.3], material: 'wall', color: '#d94141' },
      { shape: 'box', size: [0.22, 0.07, 0.03], pos: [0, 0.375, 0.3], material: 'wall', color: '#d94141' },
      { shape: 'cylinder', size: [0.31, 0.08], pos: [0, 0.62, 0], material: 'glow', color: '#ff8080', tint: true },
      { shape: 'sphere', size: [0.2], pos: [0, 0.7, 0], material: 'wall', color: SHELL },
      { shape: 'box', size: [0.18, 0.06, 0.03], pos: [0, 0.86, 0.17], material: 'glow', color: VISOR },
    ],
  },
  {
    id: 'hauler', name: 'Hauler', color: '#ffd479', speed: 0.9, radius: 0.6,
    desc: 'Wide low chassis, shoulder pylons and two lift buckets. Slow, strong, unbothered.',
    tags: 'hauler heavy lift warehouse factory cargo strong',
    parts: [
      { shape: 'box', size: [0.9, 0.22, 0.6], pos: [0, 0.1, 0], material: 'stone', color: DARK },
      { shape: 'box', size: [0.6, 0.34, 0.44], pos: [0, 0.32, 0], material: 'wall', color: '#ffd479', tint: true },
      { shape: 'box', size: [0.12, 0.34, 0.12], pos: [-0.36, 0.66, 0], material: 'metal', color: METAL },
      { shape: 'box', size: [0.12, 0.34, 0.12], pos: [0.36, 0.66, 0], material: 'metal', color: METAL },
      { shape: 'box', size: [0.3, 0.2, 0.26], pos: [0, 0.66, 0.06], material: 'wall', color: SHELL },
      { shape: 'box', size: [0.22, 0.06, 0.03], pos: [0, 0.74, 0.2], material: 'glow', color: VISOR },
      { shape: 'box', size: [0.16, 0.3, 0.16], pos: [-0.52, 0.16, 0], material: 'metal', color: '#8d979f' },
      { shape: 'box', size: [0.16, 0.3, 0.16], pos: [0.52, 0.16, 0], material: 'metal', color: '#8d979f' },
    ],
  },
  {
    id: 'sentinel', name: 'Sentinel', color: '#b388ff', speed: 1.2, radius: 0.35,
    desc: 'Tall tripod legs under a domed head. Stands watch and sees the whole street.',
    tags: 'sentinel guard watch security patrol tall dome',
    parts: [
      { shape: 'cylinder', size: [0.05, 0.7], pos: [0, 0.05, 0.14], material: 'metal', color: METAL },
      { shape: 'cylinder', size: [0.05, 0.7], pos: [0.12, 0.05, -0.07], material: 'metal', color: METAL },
      { shape: 'cylinder', size: [0.05, 0.7], pos: [-0.12, 0.05, -0.07], material: 'metal', color: METAL },
      { shape: 'cylinder', size: [0.2, 0.14], pos: [0, 0.75, 0], material: 'stone', color: DARK },
      { shape: 'box', size: [0.3, 0.34, 0.26], pos: [0, 0.89, 0], material: 'wall', color: '#b388ff', tint: true },
      { shape: 'cylinder', size: [0.05, 0.1], pos: [0, 1.23, 0], material: 'metal', color: METAL },
      { shape: 'dome', size: [0.22], pos: [0, 1.33, 0], material: 'wall', color: SHELL },
      { shape: 'box', size: [0.24, 0.06, 0.03], pos: [0, 1.4, 0.2], material: 'glow', color: VISOR },
    ],
  },
  {
    id: 'scholar', name: 'Scholar', color: '#35e0a1', speed: 1.3, radius: 0.3,
    desc: 'Upright cylinder under a wide brim disc, twin eyes and a mast for the long thoughts.',
    tags: 'scholar university research study teacher brim',
    parts: [
      { shape: 'cylinder', size: [0.2, 0.08], pos: [0, 0.06, 0], material: 'stone', color: DARK },
      { shape: 'cylinder', size: [0.24, 0.56], pos: [0, 0.14, 0], material: 'wall', color: '#35e0a1', tint: true },
      { shape: 'cylinder', size: [0.27, 0.06], pos: [0, 0.7, 0], material: 'metal', color: METAL },
      { shape: 'cylinder', size: [0.18, 0.24], pos: [0, 0.76, 0], material: 'wall', color: SHELL },
      { shape: 'cylinder', size: [0.34, 0.04], pos: [0, 0.94, 0], material: 'wall', color: '#c9d2da' },
      { shape: 'sphere', size: [0.035], pos: [-0.07, 0.84, 0.16], material: 'glow', color: VISOR },
      { shape: 'sphere', size: [0.035], pos: [0.07, 0.84, 0.16], material: 'glow', color: VISOR },
      { shape: 'cylinder', size: [0.012, 0.2], pos: [0, 1, 0], material: 'metal', color: METAL },
    ],
  },
];

// The eight colours the old anonymous robots were tinted with, kept as the seeding palette
const ROBOT_COLORS = ['#37b6ff', '#f2a03d', '#35e0a1', '#b388ff', '#ff8080', '#59e3ff', '#ffd479', '#8fa6bd'];

const ROBOT_NAMES = [
  'Zephyr', 'Bolt', 'Nova', 'Pixel', 'Comet', 'Rivet', 'Atlas', 'Echo',
  'Juno', 'Kite', 'Lumen', 'Milo', 'Nimbus', 'Onyx', 'Piper', 'Quill',
  'Rook', 'Sable', 'Tinker', 'Vega', 'Wren', 'Xenon', 'Yarrow', 'Zinc',
];

export const SPEED_MIN = 0.4;
export const SPEED_MAX = 4;
export const NAME_MAX = 32;

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 100) / 100;

export function robotTypeById(id) {
  return ROBOT_TYPES.find((t) => t.id === id) || null;
}

// One model, one individual's colour: a deep copy with every tinted part recoloured, so the mesh
// builder never sees a shared array it could mutate.
export function robotParts(type, color) {
  if (!type) return [];
  return type.parts.map((p) => ({
    shape: p.shape,
    size: [...p.size],
    pos: [...p.pos],
    rot: p.rot ?? 0,
    color: p.tint && color ? color : (p.color ?? null),
    material: p.material || 'wall',
  }));
}

// Footprint for indoor blockers and street spacing. Declared per model so a redesign of the parts
// never silently changes how much room a robot needs.
export function robotRadius(rec) {
  const type = robotTypeById(rec?.modelId);
  if (!type) return 0.3 * (rec?.scale ?? 1);
  const base = Number.isFinite(type.radius)
    ? type.radius
    : objectMetrics(robotParts(type, rec.color), 1).radius;
  return base * (rec.scale ?? 1);
}

export function robotMetrics(rec) {
  const type = robotTypeById(rec?.modelId) || ROBOT_TYPES[0];
  return objectMetrics(robotParts(type, rec?.color), rec?.scale ?? 1);
}

// Everything that affects a robot's mesh or gait, as one string: a cached room compares this to
// decide whether a standing walker has to be re-meshed.
export function robotKey(rec) {
  return `${rec?.modelId}|${rec?.color}|${rec?.scale ?? 1}|${rec?.speed ?? 1}`;
}

// ---- the roster ----
//
// One record per individual robot, town-wide. `spec.robots` on a space is the indoor staffing that
// room asks for; a building's crew is larger, and whoever is not on duty is out on the streets.

let seq = 0;
const seeded = new Set();

function identity() {
  const n = ++seq;
  return { id: `rb-${n}`, name: `${ROBOT_NAMES[(n - 1) % ROBOT_NAMES.length]}-${String(n).padStart(2, '0')}` };
}

export function robotById(id) {
  return id ? world.robots.find((r) => r.id === id) || null : null;
}

export function robotsOf(homeId) {
  return homeId ? world.robots.filter((r) => r.home === homeId) : [];
}

// How many robots a building staffs, from its footprint — the same attribute that sizes its room.
export function crewFor(def) {
  return Math.min(5, 2 + Math.floor((Number.isFinite(def?.footprint) ? def.footprint : 8) / 4));
}

function seedRobot(def, i) {
  const rand = rng(hashId(`robot:${def.id}`) + i * 7919);
  const type = ROBOT_TYPES[Math.floor(rand() * ROBOT_TYPES.length)];
  const color = ROBOT_COLORS[Math.floor(rand() * ROBOT_COLORS.length)];
  const { id, name } = identity();
  const rec = {
    id,
    name,
    modelId: type.id,
    color,
    scale: 1,
    // one decimal: the item panel's speed slider steps by 0.1, so a seeded robot has to hold a
    // value its own control can show and save unchanged
    speed: Math.round(type.speed * (0.85 + rand() * 0.3) * 10) / 10,
    home: def.id,
    source: 'seed',
  };
  world.robots.push(rec);
  return rec;
}

// Crews are seeded once per building and only ever appended to, so a room's staff is stable across
// entering, leaving and re-entering it.
export function seedCrews(defs) {
  const added = [];
  for (const def of defs) {
    if (!def?.id || seeded.has(def.id)) continue;
    seeded.add(def.id);
    const n = crewFor(def);
    for (let i = 0; i < n; i++) added.push(seedRobot(def, i));
  }
  return added;
}

export function deployRobot(modelId, homeId) {
  const type = robotTypeById(modelId);
  if (!type || !homeId) return null;
  const { id, name } = identity();
  const rec = {
    id, name, modelId: type.id, color: type.color,
    scale: 1, speed: type.speed, home: homeId, source: 'deploy',
  };
  world.robots.push(rec);
  return rec;
}

// Every field is whitelisted and range-checked here, before any of it reaches three.js.
export function updateRobot(id, patch) {
  const rec = robotById(id);
  if (!rec || !patch) return null;
  if (patch.name !== undefined) {
    const name = String(patch.name ?? '').trim().slice(0, NAME_MAX);
    if (name) rec.name = name;
  }
  if (patch.modelId !== undefined && robotTypeById(patch.modelId)) rec.modelId = patch.modelId;
  if (patch.color !== undefined && HEX.test(String(patch.color))) rec.color = String(patch.color).toLowerCase();
  if (patch.scale !== undefined) {
    const s = Number(patch.scale);
    if (Number.isFinite(s)) rec.scale = round(clamp(s, OBJ_SCALE_MIN, OBJ_SCALE_MAX));
  }
  if (patch.speed !== undefined) {
    const s = Number(patch.speed);
    if (Number.isFinite(s)) rec.speed = round(clamp(s, SPEED_MIN, SPEED_MAX));
  }
  if (patch.home !== undefined && world.buildings.some((b) => b.id === patch.home)) rec.home = patch.home;
  return rec;
}

export function removeRobot(id) {
  const i = world.robots.findIndex((r) => r.id === id);
  if (i < 0) return false;
  world.robots.splice(i, 1);
  return true;
}

// Who is standing inside when a room is meshed: the seeded crew up to the space's staffing request,
// then every robot deployed into it. A redesign therefore never drops a robot the user placed.
export function onDuty(crew, spec) {
  const want = Math.min(MAX_ROBOTS, Math.max(0, Math.round(spec?.robots ?? 0)));
  return [
    ...crew.filter((r) => r.source === 'seed').slice(0, want),
    ...crew.filter((r) => r.source !== 'seed'),
  ].slice(0, MAX_ROBOTS);
}

// the plain-data view of one robot: the debug global and the robot page
export function robotSummary(rec) {
  const type = robotTypeById(rec.modelId);
  const home = world.buildings.find((b) => b.id === rec.home) || null;
  const metrics = robotMetrics(rec);
  return {
    id: rec.id,
    name: rec.name,
    modelId: rec.modelId,
    model: type?.name ?? rec.modelId,
    color: rec.color,
    scale: rec.scale,
    speed: rec.speed,
    source: rec.source,
    home: rec.home,
    homeName: home?.name ?? '(nowhere)',
    parts: type?.parts.length ?? 0,
    metrics,
    radius: robotRadius(rec),
  };
}
