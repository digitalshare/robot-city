import { TYPE_COLORS, rng } from './data.js';

// One space spec, two producers: the seeded generator here and the AI /space tool. interior.js
// meshes both, so a generated room and a designed room are the same kind of thing.
//
// { name, description, floor: [w, d], wallHeight, palette: { floor, wall, accent },
//   items: [{ kind, pos: [x, z], rot, color, scale }], robots }
//
// Coordinates are room-local with the centre at (0, 0); furniture always stands on the floor, so
// the spec carries no y and nothing can be left floating.

export const KINDS = ['table', 'chair', 'counter', 'shelf', 'bed', 'sofa', 'plant', 'lamp', 'screen', 'machine'];

// blocker radius at scale 1 — robots steer around these, so it hugs the visible footprint
export const KIND_RADIUS = {
  table: 0.9, chair: 0.45, counter: 1.2, shelf: 0.85, bed: 1.3,
  sofa: 1.05, plant: 0.4, lamp: 0.35, screen: 0.85, machine: 1.25,
};

export const MAX_ITEMS = 60;
export const MAX_ROBOTS = 8;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2.5;
export const WALL_MIN = 2.6;
export const WALL_MAX = 12;

// items keep this far from the walls, and this much of the middle stays free to walk through
export const ITEM_MARGIN = 0.4;
const CLEAR = 2.2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 100) / 100;

// The room a building can hold, derived from its attributes. The generator, the /space system
// context and validateSpaceSpec all read this, so the model is told the same envelope that the
// validator enforces and a procedural room can never be rejected.
export function roomEnvelope(def) {
  const footprint = Number.isFinite(def?.footprint) ? def.footprint : 8;
  const s = clamp(round(footprint * 2.2), 10, 34);
  return { w: s, d: s, wallH: round(clamp(3 + footprint * 0.12, 3, 6.5)) };
}

// [kind, count] per building type. Counts are a wish list: layoutItems() drops whatever does not
// fit, so a small room gets a sparse but still legible version of the same recipe.
const RECIPES = {
  cafe: [['counter', 1], ['table', 4], ['chair', 8], ['plant', 3], ['lamp', 2]],
  hospital: [['bed', 4], ['screen', 3], ['chair', 4], ['plant', 2], ['lamp', 1]],
  warehouse: [['shelf', 8], ['machine', 3], ['counter', 1], ['lamp', 2]],
  factory: [['machine', 6], ['shelf', 4], ['counter', 1], ['screen', 2]],
  mall: [['counter', 5], ['plant', 4], ['lamp', 4], ['sofa', 2], ['shelf', 2]],
  park: [['plant', 8], ['lamp', 4], ['sofa', 3]],
  university: [['table', 5], ['chair', 6], ['screen', 3], ['shelf', 4]],
  research: [['table', 4], ['screen', 4], ['shelf', 3], ['machine', 2], ['chair', 4]],
  residential: [['bed', 3], ['sofa', 2], ['table', 3], ['plant', 2], ['lamp', 2]],
  power: [['machine', 5], ['screen', 3], ['shelf', 2]],
  sports: [['lamp', 6], ['sofa', 4], ['plant', 2], ['screen', 1]],
  cityHall: [['table', 3], ['chair', 6], ['plant', 4], ['lamp', 2], ['counter', 1]],
  default: [['table', 3], ['chair', 4], ['plant', 3], ['lamp', 2], ['shelf', 1]],
};

export function hashId(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A jittered grid over the floor with the middle ring removed, shuffled so consecutive recipe
// entries land in different places instead of clustering by kind.
function freeCells(w, d, need, rand) {
  const perSide = Math.max(2, Math.ceil(Math.sqrt(need * 1.4)));
  const cols = Math.max(2, Math.min(perSide, Math.floor(w / 1.6)));
  const rows = Math.max(2, Math.min(perSide, Math.floor(d / 1.6)));
  const cw = w / cols;
  const cd = d / rows;
  const cells = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -w / 2 + (i + 0.5) * cw;
      const z = -d / 2 + (j + 0.5) * cd;
      if (Math.hypot(x, z) < CLEAR) continue;
      cells.push({ x: x + (rand() - 0.5) * cw * 0.5, z: z + (rand() - 0.5) * cd * 0.5 });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

function layoutItems(w, d, recipe, rand) {
  const need = recipe.reduce((n, r) => n + r[1], 0);
  const cells = freeCells(w, d, need, rand);
  const items = [];
  for (const [kind, count] of recipe) {
    for (let n = 0; n < count; n++) {
      const cell = cells.pop();
      if (!cell) return items;
      const scale = round(0.9 + rand() * 0.3);
      const reach = (KIND_RADIUS[kind] ?? 0.6) * scale + ITEM_MARGIN;
      const bx = Math.max(0, w / 2 - reach);
      const bz = Math.max(0, d / 2 - reach);
      const x = round(clamp(cell.x, -bx, bx));
      const z = round(clamp(cell.z, -bz, bz));
      // face the room centre, which is where the walkway is
      items.push({ kind, pos: [x, z], rot: round(Math.atan2(-x, -z)), color: null, scale });
    }
  }
  return items;
}

function robotCount(type) {
  let n = 3;
  if (type === 'mall' || type === 'university') n++;
  if (type === 'warehouse' || type === 'factory') n++;
  return Math.min(MAX_ROBOTS, n);
}

// Deterministic per building: the same id always lays out the same room, so entering, leaving and
// re-entering a building never reshuffles its furniture.
export function defaultSpaceSpec(def) {
  const env = roomEnvelope(def);
  const type = def.type || 'default';
  const rand = rng(hashId(def.id || def.name || type));
  const recipe = RECIPES[type] || RECIPES.default;
  return {
    name: `${def.name} Interior`,
    description: "Interior generated from the building's type, footprint and height.",
    floor: [env.w, env.d],
    wallHeight: env.wallH,
    palette: { floor: '#c9d2da', wall: '#eef2f6', accent: TYPE_COLORS[type] || TYPE_COLORS.custom },
    items: layoutItems(env.w, env.d, recipe, rand),
    robots: robotCount(type),
  };
}
