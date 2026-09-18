// Indoor objects: the type library, and the resolution rules that turn an instance into concrete
// parts. Objects speak the same parts DSL as custom buildings ({ shape, size, pos, rot, color,
// material }) at object scale, so custom.js can mesh both.
//
// An instance is { id, typeId, name, description, parts, pos: [x, z], rot, scale, color,
// material, shape, source: 'library' | 'ai' | 'space' }. colour/material/shape are overrides,
// null means "whatever the parts already say"; resolveParts() applies them where a type allows
// it:
//   slot — the one part whose shape may be swapped (the crate lid, the statue's body, …)
//   tint — the parts a colour/material override paints (all of them when a type flags none,
//          which is what AI-designed objects do since they carry no flags)
//
// The furniture types at the end of OBJECT_TYPES are what a space spec's items seed, so every
// piece standing on a room's floor is an editable instance; their `radius` reuses KIND_RADIUS so
// robot steering matches the layout spacing.

import { KIND_RADIUS } from './spaces.js';

export const OBJ_SCALE_MIN = 0.4;
export const OBJ_SCALE_MAX = 2.5;
export const OBJ_MAX_PARTS = 24;
export const OBJ_SIZE_MIN = 0.05;
export const OBJ_SIZE_MAX = 4;
export const OBJ_XZ_MAX = 2.5;

// bounding box of one part, from a size array whose arity depends on the shape
function dims(shape, size) {
  if (shape === 'box') return { w: size[0], h: size[1], d: size[2] };
  if (shape === 'cylinder' || shape === 'cone') return { w: size[0] * 2, h: size[1], d: size[0] * 2 };
  if (shape === 'dome') return { w: size[0] * 2, h: size[0], d: size[0] * 2 };
  return { w: size[0] * 2, h: size[0] * 2, d: size[0] * 2 };
}

// A shape swap has to rewrite the size array to the new shape's arity, or partGeometry reads
// undefined entries and hands three.js NaN. Every value is clamped back into the object caps.
function fitSize(shape, d) {
  const c = (v) => Math.min(OBJ_SIZE_MAX, Math.max(OBJ_SIZE_MIN, Math.round(v * 1000) / 1000));
  switch (shape) {
    case 'box': return [c(d.w), c(d.h), c(d.d)];
    case 'cylinder':
    case 'cone': return [c(Math.min(d.w, d.d) / 2), c(d.h)];
    case 'dome': return [c(Math.min(d.w, d.d) / 2)];
    default: return [c(Math.min(d.w, d.h, d.d) / 2)];
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// the part a shape swap acts on: the flagged slot, else the biggest part by volume
export function slotIndex(parts) {
  const flagged = parts.findIndex((p) => p.slot);
  if (flagged >= 0) return flagged;
  let best = 0;
  let vol = -1;
  parts.forEach((p, i) => {
    const d = dims(p.shape, p.size);
    const v = d.w * d.h * d.d;
    if (v > vol) {
      vol = v;
      best = i;
    }
  });
  return best;
}

// the parts a colour/material override paints
export function tintIndexes(parts) {
  const flagged = parts.map((p, i) => (p.tint ? i : -1)).filter((i) => i >= 0);
  return flagged.length ? flagged : parts.map((_, i) => i);
}

export function resolveParts(inst) {
  const parts = inst.parts;
  const slot = slotIndex(parts);
  const tint = new Set(tintIndexes(parts));
  return parts.map((p, i) => {
    const out = {
      shape: p.shape, size: [...p.size], pos: [...p.pos],
      rot: p.rot ?? 0, color: p.color ?? null, material: p.material,
    };
    if (i === slot && inst.shape && inst.shape !== p.shape) {
      out.size = fitSize(inst.shape, dims(p.shape, p.size));
      out.shape = inst.shape;
    }
    if (tint.has(i)) {
      if (inst.color) out.color = inst.color;
      if (inst.material) out.material = inst.material;
    }
    return out;
  });
}

// what the panel shows for an instance that has no overrides yet
export function effectiveAttrs(inst) {
  const parts = resolveParts(inst);
  const slot = parts[slotIndex(inst.parts)] || {};
  const tint = parts[tintIndexes(inst.parts)[0]] || {};
  return {
    shape: slot.shape || 'box',
    color: tint.color || '#c9d2da',
    material: tint.material || 'wall',
  };
}

// Generic footprint from the parts themselves, so library types and AI objects are measured the
// same way: radius for floor clamping and robot blockers, height for the info panel.
export function objectMetrics(parts, scale = 1) {
  let radius = 0.2;
  let height = 0.2;
  for (const p of parts) {
    const d = dims(p.shape, p.size);
    const [x, y] = [p.pos[0], p.pos[1]];
    radius = Math.max(radius, Math.hypot(Math.abs(x), Math.abs(p.pos[2])) + Math.max(d.w, d.d) / 2);
    height = Math.max(height, y + d.h);
  }
  return { radius: radius * scale, height: height * scale };
}

// Footprint for robot blockers, drag clamping and free spots. Furniture declares its own radius
// (the tuned KIND_RADIUS values); everything else is measured from its parts.
export function objectRadius(inst) {
  const type = typeById(inst.typeId);
  const base = type?.radius ?? objectMetrics(resolveParts(inst), 1).radius;
  return base * (inst.scale ?? 1);
}

export function instanceFromType(type, id, pos, rot = 0) {
  return {
    id,
    typeId: type.id,
    name: type.name,
    description: type.desc,
    parts: type.parts.map((p) => ({ ...p, size: [...p.size], pos: [...p.pos] })),
    pos: [clamp(pos[0], -40, 40), clamp(pos[1], -40, 40)],
    rot,
    scale: 1,
    color: null,
    material: null,
    shape: null,
    source: 'library',
  };
}

export function instanceFromSpec(spec, id, pos, rot = 0) {
  return {
    id,
    typeId: 'custom',
    name: spec.name,
    description: spec.description,
    parts: spec.parts.map((p) => ({ ...p, size: [...p.size], pos: [...p.pos] })),
    pos: [clamp(pos[0], -40, 40), clamp(pos[1], -40, 40)],
    rot,
    scale: 1,
    color: null,
    material: null,
    shape: null,
    source: 'ai',
  };
}

// A space spec item ({ kind, pos, rot, color, scale }) becomes an ordinary editable instance, so
// the furniture a room is generated with is as live as anything placed from the gallery. Unknown
// kinds yield null and are dropped by the caller rather than meshing nothing.
export function instanceFromItem(item, id) {
  const type = typeById(item?.kind);
  if (!type || !Array.isArray(item?.pos)) return null;
  const inst = instanceFromType(type, id, item.pos, item.rot || 0);
  inst.scale = clamp(Number.isFinite(item?.scale) ? item.scale : 1, OBJ_SCALE_MIN, OBJ_SCALE_MAX);
  inst.color = item?.color ?? null;
  inst.source = 'space';
  return inst;
}

const WOOD = '#c79a6a';
const WOOD_DARK = '#a97f52';
const METAL = '#9aa3ad';
const METAL_DARK = '#5b6670';
const STEEL = '#8d979f';
const STONE = '#9aa3ad';
const WHITE = '#f5f7fa';
const LEAF = '#4f9e4a';
const CYAN = '#59e3ff';
const GREEN = '#35e0a1';
const AMBER = '#ffd479';
const FABRIC = '#8fa6bd';
const ACCENT = '#2f8fe6';
const WARM = '#ffe9a8';
const PANEL = '#22303c';
const BLANKET = '#cfe0ef';
const POT = '#b0764a';
const TRUNK = '#7a5230';

// Object-local space: origin at the centre of the object's base, floor at y=0, front towards +z.
export const OBJECT_TYPES = [
  {
    id: 'crate', name: 'Supply Crate', color: WOOD,
    desc: 'Wooden shipping crate banded with steel straps.',
    tags: 'box storage cargo container wood warehouse',
    parts: [
      { shape: 'box', size: [0.8, 0.7, 0.8], pos: [0, 0, 0], material: 'wall', color: WOOD, tint: true },
      { shape: 'box', size: [0.86, 0.1, 0.86], pos: [0, 0.7, 0], material: 'wall', color: WOOD_DARK, slot: true },
      { shape: 'box', size: [0.86, 0.68, 0.09], pos: [0, 0.01, 0], material: 'metal', color: METAL },
      { shape: 'box', size: [0.86, 0.68, 0.09], pos: [0, 0.01, 0], rot: Math.PI / 2, material: 'metal', color: METAL },
    ],
  },
  {
    id: 'barrel', name: 'Storage Barrel', color: WOOD_DARK,
    desc: 'Hooped wooden barrel for liquids and loose parts.',
    tags: 'cask drum tank container round storage',
    parts: [
      { shape: 'cylinder', size: [0.36, 0.9], pos: [0, 0, 0], material: 'wall', color: WOOD_DARK, tint: true },
      { shape: 'cylinder', size: [0.38, 0.08], pos: [0, 0.14, 0], material: 'metal', color: STEEL },
      { shape: 'cylinder', size: [0.38, 0.08], pos: [0, 0.68, 0], material: 'metal', color: STEEL },
      { shape: 'cylinder', size: [0.34, 0.06], pos: [0, 0.9, 0], material: 'wall', color: WOOD, slot: true },
    ],
  },
  {
    id: 'pylon', name: 'Support Pylon', color: STEEL,
    desc: 'Tapered support column with a status light on top.',
    tags: 'pillar column post tower support structure',
    parts: [
      { shape: 'box', size: [0.7, 0.16, 0.7], pos: [0, 0, 0], material: 'stone', color: STONE, tint: true },
      { shape: 'cone', size: [0.28, 1.5], pos: [0, 0.16, 0], material: 'metal', color: STEEL, slot: true },
      { shape: 'sphere', size: [0.12], pos: [0, 1.66, 0], material: 'glow', color: GREEN },
    ],
  },
  {
    id: 'beacon', name: 'Floor Beacon', color: AMBER,
    desc: 'Short mast with a glowing lamp that marks a spot.',
    tags: 'light lamp marker signal glow pole',
    parts: [
      { shape: 'cylinder', size: [0.3, 0.1], pos: [0, 0, 0], material: 'metal', color: METAL_DARK, tint: true },
      { shape: 'cylinder', size: [0.06, 1.1], pos: [0, 0.1, 0], material: 'metal', color: METAL_DARK },
      { shape: 'sphere', size: [0.22], pos: [0, 1.2, 0], material: 'glow', color: AMBER, slot: true, tint: true },
    ],
  },
  {
    id: 'monitor', name: 'Wall Monitor', color: CYAN,
    desc: 'Display on a stand, face glowing towards the room.',
    tags: 'screen display panel monitor computer desk',
    parts: [
      { shape: 'box', size: [0.5, 0.05, 0.32], pos: [0, 0, 0], material: 'metal', color: METAL_DARK, tint: true },
      { shape: 'box', size: [0.08, 0.5, 0.08], pos: [0, 0.05, 0], material: 'metal', color: METAL_DARK },
      { shape: 'box', size: [1, 0.62, 0.06], pos: [0, 0.55, 0], material: 'wall', color: '#22303c', slot: true },
      { shape: 'box', size: [0.92, 0.54, 0.02], pos: [0, 0.59, 0.04], material: 'glow', color: CYAN, tint: true },
    ],
  },
  {
    id: 'terminal', name: 'Info Terminal', color: GREEN,
    desc: 'Standing kiosk with a lit screen and a work ledge.',
    tags: 'kiosk console station computer display info',
    parts: [
      { shape: 'box', size: [0.7, 0.1, 0.6], pos: [0, 0, 0], material: 'stone', color: STONE, tint: true },
      { shape: 'box', size: [0.55, 1, 0.45], pos: [0, 0.1, 0], material: 'wall', color: STEEL },
      { shape: 'box', size: [0.42, 0.34, 0.04], pos: [0, 0.62, 0.24], material: 'glow', color: GREEN, slot: true },
      { shape: 'box', size: [0.62, 0.06, 0.5], pos: [0, 1.1, 0], material: 'metal', color: METAL },
    ],
  },
  {
    id: 'planter', name: 'Planter Pot', color: LEAF,
    desc: 'Ceramic pot with a leafy plant in it.',
    tags: 'plant pot greenery foliage garden nature',
    parts: [
      { shape: 'cylinder', size: [0.3, 0.34], pos: [0, 0, 0], material: 'wall', color: '#b0764a', tint: true },
      { shape: 'cylinder', size: [0.33, 0.06], pos: [0, 0.34, 0], material: 'wall', color: '#9c6840' },
      { shape: 'sphere', size: [0.32], pos: [0, 0.5, 0], material: 'wall', color: LEAF, slot: true, tint: true },
      { shape: 'sphere', size: [0.2], pos: [0.16, 0.62, -0.08], material: 'wall', color: '#5cb357', tint: true },
    ],
  },
  {
    id: 'stool', name: 'Work Stool', color: WOOD,
    desc: 'Round three-legged stool for a bench or counter.',
    tags: 'seat chair furniture round stool perch',
    parts: [
      { shape: 'cylinder', size: [0.24, 0.07], pos: [0, 0.44, 0], material: 'wall', color: WOOD, slot: true, tint: true },
      { shape: 'cylinder', size: [0.03, 0.44], pos: [-0.15, 0, -0.13], material: 'metal', color: METAL_DARK },
      { shape: 'cylinder', size: [0.03, 0.44], pos: [0.15, 0, -0.13], material: 'metal', color: METAL_DARK },
      { shape: 'cylinder', size: [0.03, 0.44], pos: [0, 0, 0.18], material: 'metal', color: METAL_DARK },
    ],
  },
  {
    id: 'podium', name: 'Speaker Podium', color: '#c96f4a',
    desc: 'Lectern with a lit front panel for announcements.',
    tags: 'lectern podium stage speech desk presentation',
    parts: [
      { shape: 'box', size: [0.7, 1, 0.55], pos: [0, 0, 0], material: 'wall', color: '#c96f4a', slot: true, tint: true },
      { shape: 'box', size: [0.8, 0.07, 0.65], pos: [0, 1, 0], material: 'wall', color: WHITE },
      { shape: 'box', size: [0.5, 0.3, 0.03], pos: [0, 0.55, 0.29], material: 'glow', color: '#e8c15a' },
    ],
  },
  {
    id: 'locker', name: 'Staff Locker', color: '#5b8dd9',
    desc: 'Tall metal locker with a door, vent and handle.',
    tags: 'cupboard locker closet storage staff cabinet',
    parts: [
      { shape: 'box', size: [0.6, 1.7, 0.5], pos: [0, 0, 0], material: 'metal', color: '#5b8dd9', tint: true },
      { shape: 'box', size: [0.56, 1.62, 0.04], pos: [0, 0.04, 0.26], material: 'wall', color: '#4a76b5', slot: true },
      { shape: 'box', size: [0.05, 0.18, 0.06], pos: [0.2, 0.85, 0.3], material: 'metal', color: METAL },
      { shape: 'box', size: [0.4, 0.06, 0.02], pos: [0, 1.45, 0.28], material: 'wall', color: '#22303c' },
    ],
  },
  {
    id: 'cart', name: 'Hover Cart', color: STEEL,
    desc: 'Flatbed cart that rides on a cushion of blue light.',
    tags: 'cart trolley wagon bed transport hover delivery',
    parts: [
      { shape: 'box', size: [1, 0.1, 0.65], pos: [0, 0.34, 0], material: 'metal', color: STEEL, tint: true },
      { shape: 'box', size: [0.9, 0.28, 0.6], pos: [0, 0.44, 0], material: 'wall', color: METAL_DARK, slot: true },
      { shape: 'box', size: [0.06, 0.5, 0.06], pos: [-0.48, 0.44, 0], material: 'metal', color: METAL },
      { shape: 'box', size: [0.8, 0.06, 0.5], pos: [0, 0.24, 0], material: 'glow', color: CYAN },
    ],
  },
  {
    id: 'antenna', name: 'Relay Antenna', color: WHITE,
    desc: 'Mast with a dish and a red tip light.',
    tags: 'antenna dish relay mast radio signal roof',
    parts: [
      { shape: 'box', size: [0.5, 0.12, 0.5], pos: [0, 0, 0], material: 'stone', color: STONE, tint: true },
      { shape: 'cylinder', size: [0.045, 1.3], pos: [0, 0.12, 0], material: 'metal', color: METAL },
      { shape: 'dome', size: [0.26], pos: [0, 1.1, 0], material: 'wall', color: WHITE, slot: true, tint: true },
      { shape: 'sphere', size: [0.07], pos: [0, 1.45, 0], material: 'glow', color: '#ff8080' },
    ],
  },
  {
    id: 'fountain', name: 'Small Fountain', color: STONE,
    desc: 'Stone basin with a lit jet in the middle.',
    tags: 'fountain water basin pool courtyard feature',
    parts: [
      { shape: 'cylinder', size: [0.85, 0.4], pos: [0, 0, 0], material: 'stone', color: STONE, slot: true, tint: true },
      { shape: 'cylinder', size: [0.76, 0.08], pos: [0, 0.36, 0], material: 'glass', color: '#7fd4f0' },
      { shape: 'cylinder', size: [0.14, 0.7], pos: [0, 0.4, 0], material: 'stone', color: '#b9c1c9' },
      { shape: 'sphere', size: [0.16], pos: [0, 1.1, 0], material: 'glow', color: CYAN },
    ],
  },
  {
    id: 'statue', name: 'Founder Statue', color: WHITE,
    desc: 'Figure on a stone pedestal marking a hall.',
    tags: 'statue sculpture figure monument memorial art',
    parts: [
      { shape: 'box', size: [0.7, 0.35, 0.7], pos: [0, 0, 0], material: 'stone', color: STONE, tint: true },
      { shape: 'cone', size: [0.3, 1.2], pos: [0, 0.35, 0], material: 'stone', color: WHITE, slot: true, tint: true },
      { shape: 'sphere', size: [0.2], pos: [0, 1.55, 0], material: 'stone', color: WHITE, tint: true },
    ],
  },
  {
    id: 'battery', name: 'Power Cell Bank', color: '#3f7fbf',
    desc: 'Cased battery stack with two cells and a charge gauge.',
    tags: 'battery power cell energy storage charge backup',
    parts: [
      { shape: 'box', size: [0.6, 0.85, 0.45], pos: [0, 0, 0], material: 'metal', color: '#3f7fbf', tint: true },
      { shape: 'box', size: [0.64, 0.08, 0.5], pos: [0, 0.85, 0], material: 'wall', color: '#22303c', slot: true },
      { shape: 'cylinder', size: [0.09, 0.5], pos: [-0.15, 0.93, 0.15], material: 'metal', color: METAL },
      { shape: 'cylinder', size: [0.09, 0.5], pos: [0.15, 0.93, 0.15], material: 'metal', color: METAL },
      { shape: 'box', size: [0.4, 0.1, 0.03], pos: [0, 0.3, 0.24], material: 'glow', color: GREEN },
    ],
  },
  {
    id: 'pipe-rack', name: 'Pipe Rack', color: METAL_DARK,
    desc: 'Framed rack holding three service pipes upright.',
    tags: 'pipes rack plumbing industrial service utility',
    parts: [
      { shape: 'box', size: [1.2, 0.1, 0.5], pos: [0, 0, 0], material: 'metal', color: METAL_DARK, tint: true },
      { shape: 'box', size: [1.2, 0.08, 0.5], pos: [0, 1.35, 0], material: 'metal', color: METAL_DARK },
      { shape: 'cylinder', size: [0.11, 1.3], pos: [-0.4, 0.05, 0], material: 'metal', color: METAL },
      { shape: 'cylinder', size: [0.11, 1.3], pos: [0, 0.05, 0], material: 'wall', color: CYAN, slot: true, tint: true },
      { shape: 'cylinder', size: [0.11, 1.3], pos: [0.4, 0.05, 0], material: 'metal', color: METAL },
    ],
  },

  // ---- room furniture: what a space spec's items seed, so nothing on the floor is fixed ----

  {
    id: 'table', name: 'Table', color: WOOD, radius: KIND_RADIUS.table,
    desc: 'Rectangular work table on four steel legs.',
    tags: 'table desk furniture work surface bench',
    parts: [
      { shape: 'box', size: [1.6, 0.08, 0.9], pos: [0, 0.72, 0], material: 'wall', color: WOOD, slot: true, tint: true },
      { shape: 'box', size: [0.08, 0.76, 0.08], pos: [-0.7, 0, -0.35], material: 'metal', color: METAL },
      { shape: 'box', size: [0.08, 0.76, 0.08], pos: [0.7, 0, -0.35], material: 'metal', color: METAL },
      { shape: 'box', size: [0.08, 0.76, 0.08], pos: [-0.7, 0, 0.35], material: 'metal', color: METAL },
      { shape: 'box', size: [0.08, 0.76, 0.08], pos: [0.7, 0, 0.35], material: 'metal', color: METAL },
    ],
  },
  {
    id: 'chair', name: 'Chair', color: FABRIC, radius: KIND_RADIUS.chair,
    desc: 'Upright chair with a fabric seat and back.',
    tags: 'chair seat furniture sit stool',
    parts: [
      { shape: 'box', size: [0.5, 0.06, 0.5], pos: [0, 0.43, 0], material: 'wall', color: FABRIC, slot: true, tint: true },
      { shape: 'box', size: [0.5, 0.55, 0.07], pos: [0, 0.455, -0.22], material: 'wall', color: FABRIC, tint: true },
      { shape: 'box', size: [0.05, 0.46, 0.05], pos: [-0.2, 0, -0.2], material: 'metal', color: METAL },
      { shape: 'box', size: [0.05, 0.46, 0.05], pos: [0.2, 0, -0.2], material: 'metal', color: METAL },
      { shape: 'box', size: [0.05, 0.46, 0.05], pos: [-0.2, 0, 0.2], material: 'metal', color: METAL },
      { shape: 'box', size: [0.05, 0.46, 0.05], pos: [0.2, 0, 0.2], material: 'metal', color: METAL },
    ],
  },
  {
    id: 'counter', name: 'Service Counter', color: WOOD, radius: KIND_RADIUS.counter,
    desc: 'Long service counter with a white work top and a lit-facing trim.',
    tags: 'counter desk service reception checkout bar',
    parts: [
      { shape: 'box', size: [2.2, 0.95, 0.7], pos: [0, 0, 0], material: 'wall', color: WOOD, slot: true, tint: true },
      { shape: 'box', size: [2.3, 0.08, 0.8], pos: [0, 0.95, 0], material: 'wall', color: WHITE },
      { shape: 'box', size: [2, 0.5, 0.04], pos: [0, 0.3, 0.36], material: 'wall', color: ACCENT },
    ],
  },
  {
    id: 'shelf', name: 'Storage Shelf', color: METAL_DARK, radius: KIND_RADIUS.shelf,
    desc: 'Tall open shelf unit with four boards and stacked crates.',
    tags: 'shelf rack storage books crates cupboard',
    parts: [
      { shape: 'box', size: [0.06, 1.9, 0.45], pos: [-0.72, 0, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [0.06, 1.9, 0.45], pos: [0.72, 0, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [1.5, 0.06, 0.45], pos: [0, 0.22, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [1.5, 0.06, 0.45], pos: [0, 0.77, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [1.5, 0.06, 0.45], pos: [0, 1.32, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [1.5, 0.06, 0.45], pos: [0, 1.87, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [0.42, 0.34, 0.34], pos: [-0.45, 0.28, 0], material: 'wall', color: ACCENT },
      { shape: 'box', size: [0.42, 0.34, 0.34], pos: [0, 0.83, 0], material: 'wall', color: ACCENT },
      { shape: 'box', size: [0.42, 0.34, 0.34], pos: [0.45, 0.28, 0], material: 'wall', color: ACCENT },
    ],
  },
  {
    id: 'bed', name: 'Bed', color: WHITE, radius: KIND_RADIUS.bed,
    desc: 'Single bed with a metal frame, mattress and pillow.',
    tags: 'bed sleep mattress pillow rest ward',
    parts: [
      { shape: 'box', size: [1.9, 0.32, 1], pos: [0, 0, 0], material: 'metal', color: METAL },
      { shape: 'box', size: [1.85, 0.2, 0.95], pos: [0, 0.32, 0], material: 'wall', color: WHITE, slot: true, tint: true },
      { shape: 'box', size: [0.12, 0.7, 1], pos: [-0.95, 0, 0], material: 'wall', color: METAL_DARK },
      { shape: 'box', size: [0.55, 0.12, 0.4], pos: [-0.6, 0.52, 0], material: 'wall', color: ACCENT },
      { shape: 'box', size: [1, 0.1, 0.9], pos: [0.3, 0.5, 0], material: 'wall', color: BLANKET },
    ],
  },
  {
    id: 'sofa', name: 'Sofa', color: FABRIC, radius: KIND_RADIUS.sofa,
    desc: 'Three-seat sofa with arms and a seat cushion.',
    tags: 'sofa couch seat lounge furniture rest',
    parts: [
      { shape: 'box', size: [1.9, 0.38, 0.85], pos: [0, 0, 0], material: 'wall', color: FABRIC, slot: true, tint: true },
      { shape: 'box', size: [1.9, 0.55, 0.2], pos: [0, 0.345, -0.33], material: 'wall', color: FABRIC, tint: true },
      { shape: 'box', size: [0.2, 0.3, 0.85], pos: [-0.85, 0.38, 0], material: 'wall', color: FABRIC, tint: true },
      { shape: 'box', size: [0.2, 0.3, 0.85], pos: [0.85, 0.38, 0], material: 'wall', color: FABRIC, tint: true },
      { shape: 'box', size: [1.7, 0.12, 0.6], pos: [0, 0.38, 0.05], material: 'wall', color: ACCENT },
    ],
  },
  {
    id: 'plant', name: 'Potted Plant', color: LEAF, radius: KIND_RADIUS.plant,
    desc: 'Leafy plant in a terracotta pot.',
    tags: 'plant pot green foliage garden nature',
    parts: [
      { shape: 'cylinder', size: [0.23, 0.3], pos: [0, 0, 0], material: 'wall', color: POT, tint: true },
      { shape: 'cylinder', size: [0.035, 0.55], pos: [0, 0.275, 0], material: 'wall', color: TRUNK },
      { shape: 'sphere', size: [0.34], pos: [0, 0.58, 0], material: 'wall', color: LEAF, slot: true, tint: true },
      { shape: 'sphere', size: [0.22], pos: [0.18, 0.5, -0.1], material: 'wall', color: LEAF, tint: true },
      { shape: 'sphere', size: [0.2], pos: [-0.16, 0.55, 0.12], material: 'wall', color: LEAF, tint: true },
    ],
  },
  {
    id: 'lamp', name: 'Floor Lamp', color: WARM, radius: KIND_RADIUS.lamp,
    desc: 'Standing lamp with a warm glowing shade.',
    tags: 'lamp light floor glow standing shine',
    parts: [
      { shape: 'cylinder', size: [0.24, 0.06], pos: [0, 0, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'cylinder', size: [0.035, 1.45], pos: [0, 0.035, 0], material: 'metal', color: METAL_DARK },
      { shape: 'cylinder', size: [0.22, 0.3], pos: [0, 1.45, 0], material: 'glow', color: WARM, slot: true, tint: true },
    ],
  },
  {
    id: 'screen', name: 'Display Screen', color: CYAN, radius: KIND_RADIUS.screen,
    desc: 'Large display panel on a stand, face lit towards the room.',
    tags: 'screen display monitor panel television board',
    parts: [
      { shape: 'box', size: [0.5, 0.06, 0.32], pos: [0, 0, 0], material: 'wall', color: METAL_DARK, tint: true },
      { shape: 'box', size: [0.08, 0.95, 0.08], pos: [0, 0.025, 0], material: 'metal', color: METAL_DARK },
      { shape: 'box', size: [1.5, 0.9, 0.07], pos: [0, 0.95, 0], material: 'wall', color: PANEL, slot: true },
      { shape: 'box', size: [1.4, 0.8, 0.02], pos: [0, 1, 0.05], material: 'glow', color: CYAN, tint: true },
    ],
  },
  {
    id: 'machine', name: 'Service Machine', color: STEEL, radius: KIND_RADIUS.machine,
    desc: 'Boxy service machine with a gauge panel, cap and side pipe.',
    tags: 'machine unit industrial service equipment generator',
    parts: [
      { shape: 'box', size: [1.25, 1.45, 1], pos: [0, 0, 0], material: 'wall', color: STEEL, slot: true, tint: true },
      { shape: 'box', size: [1.3, 0.12, 1.05], pos: [0, 1.44, 0], material: 'wall', color: METAL_DARK },
      { shape: 'box', size: [0.55, 0.4, 0.05], pos: [0, 0.85, 0.52], material: 'glow', color: GREEN },
      { shape: 'cylinder', size: [0.12, 0.7], pos: [0.45, 0.75, 0.3], material: 'metal', color: METAL },
      { shape: 'box', size: [0.9, 0.25, 0.06], pos: [0, 0.225, 0.52], material: 'wall', color: ACCENT },
    ],
  },
];

export function typeById(id) {
  return OBJECT_TYPES.find((t) => t.id === id) || null;
}
