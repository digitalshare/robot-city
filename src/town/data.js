export const PALETTE = {
  sky: 0xcfe8ff,
  water: 0x2a7fbf,
  grass: 0x79c06a,
  stone: 0x9aa3ad,
  plaza: 0xcfd6dd,
  road: 0x565d68,
  dash: 0xf4f7fa,
  white: 0xf5f7fa,
  cream: 0xf0e6d2,
  brick: 0xc96f4a,
  glass: 0x9fd8ef,
  glassDeep: 0x3aa6dd,
  gray: 0xb9c1c9,
  grayDark: 0x7d8790,
  orange: 0xf2a03d,
  red: 0xd94141,
  pink: 0xf2a7c3,
  leaf: 0x4f9e4a,
  trunk: 0x8a5a33,
  glowBlue: 0x37b6ff,
  glowCyan: 0x59e3ff,
};

// mulberry32: one deterministic stream per seed, so a rebuilt sampler reproduces itself
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// radial island outline, 24 samples every 15deg; angle 0 = +X (east), 90deg = +Z (south)
export const ISLAND_RADII = [
  100, 99, 98, 98, 99, 101, 104, 103, 101, 99, 98, 97,
  98, 98, 97, 96, 96, 97, 96, 96, 97, 98, 99, 100,
];

export function islandRadiusAt(angle) {
  const n = ISLAND_RADII.length;
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const f = (a / (Math.PI * 2)) * n;
  const i = Math.floor(f);
  const t = f - i;
  return ISLAND_RADII[i % n] * (1 - t) + ISLAND_RADII[(i + 1) % n] * t;
}

export const ROUND_IN = 13;
export const ROUND_OUT = 19;
export const RING_R = 60;
export const RING_W = 6;

// spoke angles in radians, 0 = south (+Z); north spoke omitted (City Hall sits on the north axis)
export const SPOKE_ANGLES = [0, 45, 90, 135, 225, 270, 315].map((d) => (d * Math.PI) / 180);
export const spokeDir = (a) => ({ x: Math.sin(a), z: Math.cos(a) });

export const BUILDINGS = [
  { id: 'city-hall',  name: 'City Hall',                    type: 'cityHall',    pos: [0, -30],   rot: 0,     labelHeight: 15, footprint: 10, desc: 'Marble colonnade under a glass dome on the north plaza. Seat of the robot council.' },
  { id: 'university', name: 'University',                   type: 'university',  pos: [-14, -78], rot: 0.35,  labelHeight: 19, footprint: 13, desc: 'Brick halls with a clock tower and a front lawn. Where young robots learn to think.' },
  { id: 'hospital',   name: 'Hospital',                     type: 'hospital',    pos: [30, -70],  rot: -0.4,  labelHeight: 12, footprint: 11, desc: 'Ribbon windows, a red cross facade and a rooftop helipad for emergency airlifts.' },
  { id: 'factory',    name: 'Factory',                      type: 'factory',     pos: [68, -46],  rot: 0.7,   labelHeight: 14, footprint: 13, desc: 'Three striped smokestacks and pipe runs. The town heavy manufacturing floor.' },
  { id: 'warehouse',  name: 'Warehouse & Logistics',        type: 'warehouse',   pos: [76, -20],  rot: 1.2,   labelHeight: 11, footprint: 11, desc: 'Barrel-roofed logistics hall with orange loading doors and a blue LOGISTICS sign.' },
  { id: 'research',   name: 'Research & Innovation Center', type: 'research',    pos: [-66, -44], rot: 0.3,   labelHeight: 23, footprint: 10, desc: 'Glass podium under a sixteen-storey tower with a glowing mast. Tallest structure in town.' },
  { id: 'residential',name: 'Residential Area',             type: 'residential', pos: [-76, -20], rot: 0,     labelHeight: 9,  footprint: 13, desc: 'Seven gabled houses with chimneys, arranged around a shared green.' },
  { id: 'mall',       name: 'Shopping Mall',                type: 'mall',        pos: [-40, -16], rot: 0.5,   labelHeight: 11, footprint: 10, desc: 'Glass atrium and a columned rotunda under a blue MALL sign.' },
  { id: 'cafe',       name: 'Buddy Cafe',                   type: 'cafe',        pos: [36, -14],  rot: -0.3,  labelHeight: 7,  footprint: 6,  desc: 'Striped awning, three umbrella tables and the best lubricant in town.' },
  { id: 'ailab',      name: 'AI Lab',                       type: 'ailab',       pos: [74, 10],   rot: -0.2,  labelHeight: 13, footprint: 9,  desc: 'Cylindrical glass drum ringed by a cyan glow band and capped with a dome.' },
  { id: 'power',      name: 'Power Plant',                  type: 'power',       pos: [44, 22],   rot: 0,     labelHeight: 13, footprint: 8,  desc: 'Containment ring around a blue glow core on a stone disc. Powers the whole island.' },
  { id: 'sports',     name: 'Sports Complex',               type: 'sports',      pos: [16, 40],   rot: 0.2,   labelHeight: 11, footprint: 14, desc: 'Ribbed stadium bowl with a ring roof, floodlit pitch and twelve columns.' },
  { id: 'park',       name: 'Park',                         type: 'park',        pos: [-44, 26],  rot: 0,     labelHeight: 8,  footprint: 12, desc: 'Pond, bandstand kiosk, stone arch and three warm lamp posts.' },
];

// dot colour per building type in the gallery, keyed by `type`
export const TYPE_COLORS = {
  cityHall: '#e8c15a',
  university: '#c96f4a',
  hospital: '#ff6b6b',
  factory: '#8d979f',
  warehouse: '#5b8dd9',
  research: '#59e3ff',
  residential: '#f2c9a7',
  mall: '#2f8fe6',
  cafe: '#f2a03d',
  ailab: '#37b6ff',
  power: '#b388ff',
  sports: '#3f7fbf',
  park: '#4f9e4a',
  custom: '#ffd479',
};

export const SECTORS = [{ id: 'core', name: 'Core Island', offset: [0, 0], scale: 1, spin: 0 }];

function buildGraph() {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    nodes.push({ id: `r${i}`, x: Math.sin(a) * 16, z: Math.cos(a) * 16 });
    edges.push({ a: `r${i}`, b: `r${(i + 1) % 8}` });
  }
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    nodes.push({ id: `g${k}`, x: Math.sin(a) * RING_R, z: Math.cos(a) * RING_R });
    edges.push({ a: `g${k}`, b: `g${(k + 1) % 16}` });
  }
  const roundIdx = [0, 1, 2, 3, 5, 6, 7];
  const ringIdx = [0, 2, 4, 6, 10, 12, 14];
  SPOKE_ANGLES.forEach((_, i) => edges.push({ a: `r${roundIdx[i]}`, b: `g${ringIdx[i]}` }));

  nodes.push({ id: 'br0', x: 0, z: 63 }, { id: 'br1', x: 0, z: 96 }, { id: 'br2', x: 0, z: 140 });
  edges.push({ a: 'g0', b: 'br0' }, { a: 'br0', b: 'br1' }, { a: 'br1', b: 'br2' });

  for (const b of BUILDINGS) {
    const id = `b:${b.id}`;
    nodes.push({ id, x: b.pos[0], z: b.pos[1] });
    let best = null;
    let bd = Infinity;
    for (const n of nodes) {
      if (n.id === id || n.id.startsWith('b:')) continue;
      const d = (n.x - b.pos[0]) ** 2 + (n.z - b.pos[1]) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    edges.push({ a: id, b: best });
  }
  return { nodes, edges };
}

export const ROAD_GRAPH = buildGraph();

// camera-target clamp radius for the core island; was a bare literal in main.js
export const CORE_REACH = 110;

// Four authored sectors, docked one per click. Offsets are ~148 out with scale 0.66
// (coastline 63-69), which overlaps the core's ~96-104 outline by 12-20 units so the
// two landmasses read as one island. Bearings avoid the south bridge corridor
// (|x| < 5, z 55..146). `anchor` is the core ROAD_GRAPH node the connector road starts from.
export const EXPANSIONS = [
  {
    id: 'east-quay', name: 'East Quay', offset: [148, 0], scale: 0.66, spin: 0.4,
    anchor: 'g4', ring: 24, round: 8,
    buildings: [
      { id: 'quay-depot',   name: 'Quay Depot',        type: 'warehouse',   k: 0, lr: 46, labelHeight: 11, footprint: 11, desc: 'Barrel-roofed freight hall serving the eastern berths.' },
      { id: 'quay-canteen', name: 'Dockside Canteen',  type: 'cafe',        k: 3, lr: 46, labelHeight: 7,  footprint: 6,  desc: 'Awning and umbrella tables within sight of the cranes.' },
      { id: 'quay-homes',   name: 'Quayside Homes',    type: 'residential', k: 5, lr: 46, labelHeight: 9,  footprint: 13, desc: 'Gabled cottages for the dock crews, built around a green.' },
      { id: 'quay-market',  name: 'Fish Market Hall',  type: 'mall',        k: 7, lr: 46, labelHeight: 11, footprint: 10, desc: 'Glass rotunda where the morning catch is traded.' },
    ],
  },
  {
    id: 'north-ridge', name: 'North Ridge', offset: [0, -148], scale: 0.66, spin: 1.9,
    anchor: 'g8', ring: 24, round: 8,
    buildings: [
      { id: 'ridge-school',  name: 'Ridge School',     type: 'university',  k: 0, lr: 46, labelHeight: 19, footprint: 13, desc: 'Clock-tower campus for the northern districts.' },
      { id: 'ridge-clinic',  name: 'North Clinic',     type: 'hospital',    k: 3, lr: 46, labelHeight: 12, footprint: 11, desc: 'Ribbon-window ward block with its own helipad.' },
      { id: 'ridge-homes',   name: 'Ridge Terraces',   type: 'residential', k: 5, lr: 46, labelHeight: 9,  footprint: 13, desc: 'Seven terraced houses climbing the ridge green.' },
      { id: 'ridge-green',   name: 'Ridge Green',      type: 'park',        k: 7, lr: 46, labelHeight: 8,  footprint: 12, desc: 'Pond and bandstand at the quiet end of the ridge.' },
    ],
  },
  {
    id: 'west-marina', name: 'West Marina', offset: [-148, 0], scale: 0.66, spin: 3.3,
    anchor: 'g12', ring: 24, round: 8,
    buildings: [
      { id: 'marina-cafe',   name: 'Marina Cafe',        type: 'cafe',      k: 0, lr: 46, labelHeight: 7,  footprint: 6,  desc: 'Striped awning right on the waterfront promenade.' },
      { id: 'marina-hotel',  name: 'Marina Hotel',       type: 'mall',      k: 3, lr: 46, labelHeight: 11, footprint: 10, desc: 'Glass atrium hosting visitors arriving by boat.' },
      { id: 'marina-park',   name: 'West Marina Park',   type: 'park',      k: 5, lr: 46, labelHeight: 8,  footprint: 12, desc: 'Lamp-lit promenade garden between the pontoons.' },
      { id: 'marina-hall',   name: 'Marina Sports Hall', type: 'sports',    k: 7, lr: 46, labelHeight: 11, footprint: 14, desc: 'Ribbed stadium bowl floodlit over the marina.' },
    ],
  },
  {
    id: 'sunset-heights', name: 'Sunset Heights', offset: [104, 104], scale: 0.64, spin: 5.0,
    anchor: 'g2', ring: 24, round: 8,
    buildings: [
      { id: 'heights-lab',     name: 'Sunset Labs',      type: 'research',    k: 0, lr: 46, labelHeight: 23, footprint: 10, desc: 'Glass tower and glowing mast overlooking the south-east.' },
      { id: 'heights-power',   name: 'Ridge Substation', type: 'power',       k: 3, lr: 46, labelHeight: 13, footprint: 8,  desc: 'Containment ring feeding the newer districts.' },
      { id: 'heights-factory', name: 'Assembly Works',   type: 'factory',     k: 5, lr: 46, labelHeight: 14, footprint: 13, desc: 'Smokestack assembly floor for chassis and shells.' },
      { id: 'heights-homes',   name: 'Heights Villas',   type: 'residential', k: 7, lr: 46, labelHeight: 9,  footprint: 13, desc: 'Houses on the slope with a view over the whole town.' },
    ],
  },
];

// ring nodes a sector gets radial spokes to; the rest of the ring is drive-only
export const SECTOR_SPOKE_NODES = [2, 4, 6];

// coastline radius of a docked sector, reusing the core outline table with a per-sector
// spin and scale so each one gets a different organic shape for free
export function sectorRadiusAt(angle, sector) {
  return islandRadiusAt(angle + sector.spin) * sector.scale;
}

// bearing (spokeDir convention, 0 = +Z) from a sector centre back towards the core;
// the connector road arrives here, so ring node 0 sits on it
export function sectorEntryBearing(sector) {
  return Math.atan2(-sector.offset[0], -sector.offset[1]);
}

export function sectorNodeBearing(sector, k) {
  return sectorEntryBearing(sector) + (k * Math.PI) / 4;
}

// world-space point on a sector's ring/building circle at ring-node index k
export function sectorPointAt(sector, k, radius) {
  const d = spokeDir(sectorNodeBearing(sector, k));
  return { x: sector.offset[0] + d.x * radius, z: sector.offset[1] + d.z * radius };
}

// Resolve an authored sector entry into a full building def. rot faces the sector
// centre because every builder puts its doors and signage on local +Z.
export function sectorBuildingDef(sector, b) {
  const p = sectorPointAt(sector, b.k, b.lr);
  return { ...b, pos: [p.x, p.z], rot: sectorNodeBearing(sector, b.k) + Math.PI };
}

export function graphNode(id) {
  return ROAD_GRAPH.nodes.find((n) => n.id === id) || null;
}

export function graphAddNode(id, x, z) {
  ROAD_GRAPH.nodes.push({ id, x, z });
  adjCache = null;
}

export function graphAddEdge(a, b) {
  ROAD_GRAPH.edges.push({ a, b });
  adjCache = null;
}

// Adjacency, rebuilt only when the graph changes: a walking robot asks for its neighbours on
// every arrival, so this cannot be an O(edges) scan per step.
let adjCache = null;

export function adjacency() {
  if (!adjCache) {
    adjCache = new Map();
    for (const e of ROAD_GRAPH.edges) {
      if (!adjCache.has(e.a)) adjCache.set(e.a, []);
      if (!adjCache.has(e.b)) adjCache.set(e.b, []);
      adjCache.get(e.a).push(e.b);
      adjCache.get(e.b).push(e.a);
    }
  }
  return adjCache;
}

export function graphNeighbors(id) {
  return adjacency().get(id) || [];
}

export function nearestGraphNode(x, z, filter) {
  let best = null;
  let bd = Infinity;
  for (const n of ROAD_GRAPH.nodes) {
    if (filter && !filter(n)) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// register a building as a graph leaf hung off the nearest road node, mirroring the
// building-stub logic in buildGraph()
export function connectToGraph(id, x, z) {
  const n = nearestGraphNode(x, z, (c) => !c.id.startsWith('b:'));
  if (!n) return null;
  if (!graphNode(id)) graphAddNode(id, x, z);
  graphAddEdge(id, n.id);
  return n.id;
}

export function graphConnected(fromId, toId) {
  const adj = adjacency();
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) return true;
    for (const next of adj.get(cur) || []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}
