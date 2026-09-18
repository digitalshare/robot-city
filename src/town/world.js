import { BUILDINGS, SECTORS, CORE_REACH, sectorRadiusAt } from './data.js';

// Single source of truth for everything mutable about the town. main.js, overlay.js,
// sites.js and the AI review flow all read/write here instead of holding their own
// boot-time copies, so a docked sector or a confirmed custom building is visible
// everywhere on the next notify().
export const world = {
  buildings: [...BUILDINGS],
  groups: [],
  byId: {},
  sectors: [...SECTORS],
  land: [],
  roads: null,
  obstacles: { circles: [], rings: [], segments: [] },
  review: null,
  pendingSite: null,
  expansionIndex: 0,
  spaces: {},
  // the town-wide robot roster, owned by town/robots.js: one record per individual robot
  robots: [],
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn();
}

// a review building is hoverable but not yet in world.buildings, so it needs the fallback
export function defById(id) {
  return world.buildings.find((b) => b.id === id) || (world.review?.def.id === id ? world.review.def : null);
}

export function groupOf(id) {
  return world.byId[id] || null;
}

export function addBuilding(def, group) {
  world.buildings.push(def);
  world.groups.push(group);
  world.byId[def.id] = group;
}

export function removeBuilding(id) {
  const i = world.buildings.findIndex((b) => b.id === id);
  if (i >= 0) world.buildings.splice(i, 1);
  const g = world.byId[id];
  if (g) {
    const gi = world.groups.indexOf(g);
    if (gi >= 0) world.groups.splice(gi, 1);
    delete world.byId[id];
  }
  return g || null;
}

// Indoor spaces keyed by building id: { spec, source: 'default' | 'ai', built, objects }. Storage
// only — `built` is a three.js scene that main.js owns, so a redesign gets the previous entry back
// and frees it itself rather than world.js reaching into interior.js.
export function spaceOf(id) {
  return world.spaces[id] || null;
}

// objects is filled by main.js applySpace right after this: design furniture re-seeded from the
// spec's items plus whatever the user placed; world.js only stores the list
export function setSpace(id, spec, source) {
  const previous = world.spaces[id] || null;
  const entry = { spec, source, built: null, objects: [] };
  world.spaces[id] = entry;
  return { entry, previous };
}

// coastline radius of a docked sector, sampled once per sector
const radiusCache = new Map();
export function sectorRadius(sector) {
  let r = radiusCache.get(sector);
  if (r === undefined) {
    r = 0;
    for (let i = 0; i < 64; i++) r = Math.max(r, sectorRadiusAt((i / 64) * Math.PI * 2, sector));
    radiusCache.set(sector, r);
  }
  return r;
}

// reach()/bounds() are read every frame but only change when a sector docks
let reachCache = null;
let boundsCache = null;

export function dockSector(sector) {
  world.sectors.push(sector);
  reachCache = null;
  boundsCache = null;
}

function dockedSectors() {
  return world.sectors.filter((s) => s.id !== 'core');
}

// camera-target clamp radius. Core-only returns exactly the old hard-coded 110.
export function reach() {
  if (reachCache === null) {
    let r = CORE_REACH;
    for (const s of dockedSectors()) {
      r = Math.max(r, Math.hypot(s.offset[0], s.offset[1]) + sectorRadius(s) + 20);
    }
    reachCache = r;
  }
  return reachCache;
}

// world-space rectangle the minimap must fit; core matches the old centred 232x150
// canvas plus the bridge deck that used to run off the bottom edge
export function bounds() {
  if (boundsCache === null) {
    const b = { minX: -108, maxX: 108, minZ: -108, maxZ: 146 };
    for (const s of dockedSectors()) {
      const r = sectorRadius(s) + 2;
      b.minX = Math.min(b.minX, s.offset[0] - r);
      b.maxX = Math.max(b.maxX, s.offset[0] + r);
      b.minZ = Math.min(b.minZ, s.offset[1] - r);
      b.maxZ = Math.max(b.maxZ, s.offset[1] + r);
    }
    boundsCache = b;
  }
  return { ...boundsCache };
}

// Free a removed group's GPU resources. Only safe for groups that own their
// geometries and materials exclusively (a discarded custom building does); the road
// and terrain materials are memoized and shared, so never dispose those through here.
// Anything tagged userData.shared (custom.js sharedPart) is skipped for the same reason.
export function disposeGroup(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || m.userData.shared) continue;
      m.map?.dispose();
      m.dispose();
    }
  });
}
