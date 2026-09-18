// The /building and /space tools: schemas, the preloaded session contexts that teach the model
// each DSL, extraction from either transport, and the validation gates. Nothing the model returns
// is ever treated as code — it is data, whitelisted and range-checked here before it reaches
// three.js.

import {
  KINDS, KIND_RADIUS, MAX_ITEMS, MAX_ROBOTS, SCALE_MIN, SCALE_MAX, WALL_MIN, WALL_MAX,
  ITEM_MARGIN, roomEnvelope,
} from '../town/spaces.js';
import { TYPE_COLORS } from '../town/data.js';
import { objectMetrics, resolveParts } from '../town/objects.js';

export const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'dome'];
export const MATERIALS = ['wall', 'glass', 'glow', 'metal', 'stone'];
export const MAX_PARTS = 48;

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_NAME = 48;
const MAX_DESC = 240;
const SIZE_MIN = 0.4;
const SIZE_MAX = 60;
const XZ_MAX = 24;
const Y_MIN = -1;
const Y_MAX = 60;
const FOOTPRINT_MIN = 4;
const FOOTPRINT_MAX = 20;
const HEIGHT_MAX = 60;

export const BUILDING_TOOL = {
  type: 'function',
  function: {
    name: 'create_building',
    description: 'Create a 3D building in Robot City out of primitive parts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: `Building name, at most ${MAX_NAME} characters.` },
        description: {
          type: 'string',
          description: `One sentence describing the building, at most ${MAX_DESC} characters.`,
        },
        parts: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PARTS,
          description: 'The primitive parts that make up the building, in building-local space.',
          items: {
            type: 'object',
            properties: {
              shape: { type: 'string', enum: SHAPES },
              size: {
                type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 3,
                description: 'box: [width, height, depth]. cylinder and cone: [radius, height]. sphere and dome: [radius].',
              },
              pos: {
                type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
                description: '[x, y, z] in building-local space. y is the height of the part base above the ground.',
              },
              rot: { type: 'number', description: 'Optional rotation about the vertical axis, in radians.' },
              color: { type: 'string', description: 'Optional colour as "#rrggbb".' },
              material: { type: 'string', enum: MATERIALS },
            },
            required: ['shape', 'size', 'pos', 'material'],
          },
        },
      },
      required: ['name', 'description', 'parts'],
    },
  },
};

// The editable half of the /building system prompt: the shape and material whitelist, the
// coordinate conventions and the caps. Plain chat never sees it. The surveyed site is not
// part of it — buildingFacts adds that per call, so an edited prompt can never drop the
// constraints the validator enforces.
export const BUILDING_RULES = [
  'You are designing one building for Robot City, a 3D map of a small robot-built town.',
  'Describe the building ONLY as a list of primitive parts. You cannot send code and nothing you write is evaluated.',
  `Allowed shapes: ${SHAPES.join(', ')}.`,
  `Allowed materials: ${MATERIALS.join(', ')}. wall, stone and metal are opaque; glass is translucent; glow is self-lit.`,
  `size — box takes [width, height, depth]; cylinder and cone take [radius, height]; sphere and dome take [radius]. Every number must be between ${SIZE_MIN} and ${SIZE_MAX}.`,
  `pos — [x, y, z] in building-local space, with the building centred on x=0, z=0. x and z must be within +/-${XZ_MAX}. y is the height of the part BASE above the ground, so y=0 stands the part on the ground; y must be between ${Y_MIN} and ${Y_MAX}.`,
  'rot — optional rotation about the vertical axis in radians.',
  'color — optional "#rrggbb" hex string; omit it to use the material default.',
  `Use at most ${MAX_PARTS} parts. A few large parts read better than many tiny ones.`,
  `Scale is roughly 1 unit = 1 metre. Existing town buildings are 6 to 20 units across and 3 to 25 tall; keep the whole design within ${FOOTPRINT_MAX} units of the centre and ${HEIGHT_MAX} units tall.`,
  'Put the main volume at ground level and stack details on top of it, not floating in the air.',
  'Call create_building with the finished design. If you cannot call tools, reply with a single ```json fenced object holding exactly the create_building arguments and nothing else.',
].join('\n');

export function buildingFacts(site) {
  if (!site) return '';
  return [
    'Context for this call',
    `The building will be placed at map position (${site.x.toFixed(1)}, ${site.z.toFixed(1)}).`,
    `That site has ${site.clearance.toFixed(1)} units of clearance to the nearest road or building, so keep every part within ${Math.max(1, Math.floor(site.clearance)).toFixed(0)} units of the centre.`,
  ].join('\n');
}

export const SPACE_TOOL = {
  type: 'function',
  function: {
    name: 'create_space',
    description: 'Create the indoor space of a Robot City building: a furnished room that robots walk around in.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: `Short name for the room, at most ${MAX_NAME} characters.` },
        description: {
          type: 'string',
          description: `One sentence describing the room, at most ${MAX_DESC} characters.`,
        },
        floor: {
          type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2,
          description: '[width, depth] of the floor in units.',
        },
        wallHeight: { type: 'number', description: `Wall height in units, ${WALL_MIN} to ${WALL_MAX}.` },
        palette: {
          type: 'object',
          description: 'Optional room colours; each defaults to the building\'s own scheme.',
          properties: {
            floor: { type: 'string', description: 'Floor colour as "#rrggbb".' },
            wall: { type: 'string', description: 'Wall colour as "#rrggbb".' },
            accent: { type: 'string', description: 'Accent colour as "#rrggbb", used for trim, cushions and crates.' },
          },
        },
        items: {
          type: 'array',
          maxItems: MAX_ITEMS,
          description: 'The furniture in the room, in room-local coordinates.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: KINDS },
              pos: {
                type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2,
                description: '[x, z] in units from the centre of the floor.',
              },
              rot: { type: 'number', description: 'Optional rotation about the vertical axis, in radians. 0 faces the +z side of the room.' },
              color: { type: 'string', description: 'Optional "#rrggbb" override for the item\'s main surface.' },
              scale: { type: 'number', description: `Optional size multiplier, ${SCALE_MIN} to ${SCALE_MAX}.` },
            },
            required: ['kind', 'pos'],
          },
        },
        robots: { type: 'integer', minimum: 0, maximum: MAX_ROBOTS, description: 'How many robots wander the room.' },
      },
      required: ['name', 'description', 'floor', 'wallHeight', 'items', 'robots'],
    },
  },
};

// what the mesher actually builds for each kind, so the model can furnish a room it cannot see
const KIND_NOTES = {
  table: 'table 1.6 x 0.9, 0.8 tall',
  chair: 'single seat 0.5 wide, back facing -z',
  counter: 'service counter 2.2 wide, 1 tall',
  shelf: 'storage shelf 1.5 wide, 1.9 tall, with crates',
  bed: 'single bed 1.9 long, headboard at -x',
  sofa: 'two-seat sofa 1.9 wide, back facing -z',
  plant: 'potted plant about 1.2 tall',
  lamp: 'floor lamp 1.7 tall with a warm glowing shade',
  screen: 'display on a stand, 1.5 wide, glowing face towards +z',
  machine: 'industrial machine 1.25 wide, 1.5 tall, with a status panel',
};

const ROOM_MIN = 6;

export const SPACE_RULES = [
  'You are designing the indoor space of one building in Robot City, a 3D map of a small robot-built town.',
  'The room is walked around in by small robots, so keep the middle of the floor clear and pull furniture away from the walls.',
  'Describe the room ONLY as data. You cannot send code and nothing you write is evaluated.',
  `Allowed item kinds: ${KINDS.map((k) => `${k} (${KIND_NOTES[k]})`).join('; ')}.`,
  `floor — [width, depth] in units. At least ${ROOM_MIN} by ${ROOM_MIN}, and no larger than this building's room envelope, given under "Context for this call".`,
  `wallHeight — between ${WALL_MIN} and ${WALL_MAX} units; use the wall height from that envelope.`,
  'palette — optional; floor, wall and accent colours as "#rrggbb".',
  `items — at most ${MAX_ITEMS} entries, each { kind, pos, rot?, color?, scale? }. Furniture always stands on the floor, so there is no height to send.`,
  'Whether you create this building\'s first room or redesign the one already standing is stated under "Context for this call"; a redesign sends a complete room that replaces the furniture listed there.',
  `pos — [x, z] in room-local units from the centre of the floor. Keep the whole item inside the room and at least ${ITEM_MARGIN} units off a wall; the x and z limits for this room are given under "Context for this call".`,
  'rot — optional rotation about the vertical axis in radians; 0 faces the +z side of the room.',
  `scale — optional size multiplier between ${SCALE_MIN} and ${SCALE_MAX}; 1 is the size given in the kind list.`,
  'color — optional "#rrggbb" override for the item\'s main surface.',
  `robots — how many robots wander the room, 0 to ${MAX_ROBOTS}.`,
  'Call create_space with the finished room. If you cannot call tools, reply with a single ```json fenced object holding exactly the create_space arguments and nothing else.',
].join('\n');

const MAX_REF_OBJECTS = 24;

function spaceObjectLine(o) {
  const origin = o.typeId === 'custom' ? 'AI design' : `type ${o.typeId}`;
  const color = o.attrs && o.attrs.color ? `, ${o.attrs.color}` : '';
  return `  - ${o.name} (${origin}, source ${o.source}) at [${o.pos.join(', ')}], rot ${Number(o.rot ?? 0).toFixed(2)}, ` +
    `scale ${o.scale ?? 1}, ${(o.metrics.radius * 2).toFixed(2)} wide ${o.metrics.height.toFixed(2)} tall${color}`;
}

export function spaceFacts(def, current) {
  if (!def) return '';
  const env = roomEnvelope(def);
  const lines = [
    'Context for this call',
    'The building this room belongs to:',
    `- name: ${def.name}`,
    `- type: ${def.type}`,
    `- footprint: ${def.footprint} units across, labelled at ${def.labelHeight} units high`,
    `- description: ${def.desc || 'none given'}`,
    `- room envelope: ${env.w} by ${env.d} floor, ${env.wallH} unit walls`,
    `Keep every item inside that envelope: with a ${env.w} by ${env.d} floor, x and z stay within +/-${(env.w / 2 - 1).toFixed(1)}.`,
  ];
  if (current) {
    const { spec, objects } = current;
    lines.push(
      `Current indoor space: ${spec.name} (${current.source} design) — the room standing in this building right now.`,
      `- floor ${spec.floor[0]} by ${spec.floor[1]}, wallHeight ${spec.wallHeight}, robots ${spec.robots}`,
      `- palette: floor ${spec.palette.floor}, wall ${spec.palette.wall}, accent ${spec.palette.accent}`,
      `- ${objects.length} object${objects.length === 1 ? '' : 's'} standing in the room:`,
    );
    for (const o of objects.slice(0, MAX_REF_OBJECTS)) lines.push(spaceObjectLine(o));
    if (objects.length > MAX_REF_OBJECTS) lines.push(`  - …and ${objects.length - MAX_REF_OBJECTS} more`);
    lines.push(
      'Redesign this room: send a complete create_space room. Your items replace the furniture listed above; ' +
        'objects the user placed themselves are not yours to remove and stay where they are.',
    );
  } else {
    lines.push('This building has no indoor space yet: create the first one.');
  }
  lines.push(
    `Design the indoor space that belongs in this ${def.type} building. If the user names a kind of room, build that; otherwise invent one that fits the building.`,
  );
  return lines.join('\n');
}

const OBJ_MAX_PARTS = 24;
const OBJ_SIZE_MIN = 0.05;
const OBJ_SIZE_MAX = 4;
const OBJ_XZ_MAX = 2.5;
// the whole object stays this far inside the walls, and this far below the ceiling
const OBJ_MARGIN = 0.6;
const OBJ_HEADROOM = 0.2;
const MAX_REF_PARTS = 12;

export const OBJECT_TOOL = {
  type: 'function',
  function: {
    name: 'create_object',
    description: 'Create one 3D object that stands on the floor of a Robot City indoor space.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: `Short name for the object, at most ${MAX_NAME} characters.` },
        description: {
          type: 'string',
          description: `One sentence describing the object, at most ${MAX_DESC} characters.`,
        },
        parts: {
          type: 'array',
          minItems: 1,
          maxItems: OBJ_MAX_PARTS,
          description: 'The primitive parts that make up the object, in object-local space.',
          items: {
            type: 'object',
            properties: {
              shape: { type: 'string', enum: SHAPES },
              size: {
                type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 3,
                description: 'box: [width, height, depth]. cylinder and cone: [radius, height]. sphere and dome: [radius].',
              },
              pos: {
                type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
                description: '[x, y, z] in object-local space. y is the height of the part base above the floor.',
              },
              rot: { type: 'number', description: 'Optional rotation about the vertical axis, in radians.' },
              color: { type: 'string', description: 'Optional colour as "#rrggbb".' },
              material: { type: 'string', enum: MATERIALS },
            },
            required: ['shape', 'size', 'pos', 'material'],
          },
        },
      },
      required: ['name', 'description', 'parts'],
    },
  },
};

// The room the object has to fit, stated once so the context and the validator cannot disagree.
function objectEnvelope(room) {
  return {
    maxR: Math.max(0.5, Math.min(room.w, room.d) / 2 - OBJ_MARGIN),
    maxY: Math.max(0.5, room.wallH - OBJ_HEADROOM),
  };
}

function objectRefLines(ref) {
  const parts = resolveParts(ref);
  const { radius, height } = objectMetrics(parts, ref.scale ?? 1);
  const origin = ref.typeId === 'custom' ? 'AI design' : `type ${ref.typeId}`;
  const lines = [
    `Reference object: ${ref.name} (${origin})`,
    `- description: ${ref.description || 'none given'}`,
    `- overall size: ${(radius * 2).toFixed(2)} units wide, ${height.toFixed(2)} units tall, at scale ${ref.scale ?? 1}`,
    `- ${parts.length} parts:`,
  ];
  for (const p of parts.slice(0, MAX_REF_PARTS)) {
    const spin = p.rot ? `, rot ${Number(p.rot).toFixed(2)}` : '';
    lines.push(`  - ${p.shape}, size [${p.size.join(', ')}] at [${p.pos.join(', ')}], ${p.material}${p.color ? `, ${p.color}` : ''}${spin}`);
  }
  if (parts.length > MAX_REF_PARTS) lines.push(`  - …and ${parts.length - MAX_REF_PARTS} more`);
  return lines;
}

export const OBJECT_RULES = [
  'You are designing one object for an indoor space in Robot City, a 3D map of a small robot-built town.',
  'An object is a thing that stands on the floor of a room, at furniture scale rather than building scale: a crate, a beacon, a console, a planter, a statue.',
  'Describe the object ONLY as a list of primitive parts. You cannot send code and nothing you write is evaluated.',
  `Allowed shapes: ${SHAPES.join(', ')}.`,
  `Allowed materials: ${MATERIALS.join(', ')}. wall, stone and metal are opaque; glass is translucent; glow is self-lit.`,
  `size — box takes [width, height, depth]; cylinder and cone take [radius, height]; sphere and dome take [radius]. Every number must be between ${OBJ_SIZE_MIN} and ${OBJ_SIZE_MAX}.`,
  `pos — [x, y, z] in object-local space, with the object centred on x=0, z=0. x and z must be within +/-${OBJ_XZ_MAX}. y is the height of the part BASE above the floor, so y=0 stands the part on the floor; this room's ceiling limit is given under "Context for this call".`,
  'rot — optional rotation about the vertical axis in radians.',
  'color — optional "#rrggbb" hex string; omit it to use the material default.',
  `Use at most ${OBJ_MAX_PARTS} parts. Two to eight read best: one main volume on the floor, then details on top of it, never floating in the air.`,
  'Scale is 1 unit = 1 metre and robots walk past this object, so keep it inside the clear radius and height limit given under "Context for this call".',
  'Call create_object with the finished object. If you cannot call tools, reply with a single ```json fenced object holding exactly the create_object arguments and nothing else.',
].join('\n');

export function objectFacts(room, ref) {
  if (!room) return '';
  const { maxR, maxY } = objectEnvelope(room);
  const lines = [
    'Context for this call',
    `The object will stand on the floor of a ${room.w} by ${room.d} room with ${room.wallH}-unit walls.`,
    `Keep the whole thing within ${maxR.toFixed(1)} units of its centre and ${maxY.toFixed(1)} units tall, so y stays between 0 and ${maxY.toFixed(1)}.`,
  ];
  if (ref) {
    lines.push(
      '',
      'The user has selected an object that is already standing in this room:',
      ...objectRefLines(ref),
      '',
      'Derive a related but distinct object from that reference: the same family of thing, with your own proportions and details. Do not send the reference back unchanged.',
    );
  }
  return lines.join('\n');
}

function tryParse(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// first balanced {...} in a string, skipping braces inside JSON string literals
function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function unwrap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (Array.isArray(obj.parts) || Array.isArray(obj.items) || typeof obj.name === 'string') return obj;
  if (obj.create_building) return unwrap(obj.create_building);
  if (obj.create_space) return unwrap(obj.create_space);
  if (obj.create_object) return unwrap(obj.create_object);
  if (obj.arguments !== undefined) {
    return typeof obj.arguments === 'string' ? unwrap(tryParse(obj.arguments)) : unwrap(obj.arguments);
  }
  return obj;
}

// Native tool_calls first, then a ```json fence, then the first balanced object.
export function extractToolCall(result) {
  const fn = result?.toolCalls?.[0]?.function;
  if (fn) {
    const args = typeof fn.arguments === 'string' ? tryParse(fn.arguments) : fn.arguments;
    const unwrapped = unwrap(args);
    if (unwrapped) return unwrapped;
  }
  const text = typeof result?.text === 'string' ? result.text : '';
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : firstJsonObject(text);
  return candidate ? unwrap(tryParse(candidate)) : null;
}

function str(v) {
  if (typeof v === 'string') return v.slice(0, 40);
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v;
}

// JSON.parse('-1e999') yields -Infinity, so every number is checked with isFinite
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function numArray(v, min, max) {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  if (!v.every(finite)) return null;
  return v.map(Number);
}

function sizeFor(shape, s) {
  if (shape === 'box') {
    if (s.length === 3) return s;
    if (s.length === 2) return [s[0], s[1], s[0]];
    return [s[0], s[0], s[0]];
  }
  if (shape === 'cylinder' || shape === 'cone') return s.length >= 2 ? [s[0], s[1]] : [s[0], s[0] * 2];
  return [s[0]];
}

// rotation-independent bounding radius, so `rot` can never push a part outside the cap
function horizontalExtent(shape, s) {
  return shape === 'box' ? Math.hypot(s[0], s[2]) / 2 : s[0];
}

function verticalExtent(shape, s) {
  if (shape === 'sphere') return s[0] * 2;
  if (shape === 'dome') return s[0];
  return s[1];
}

export function validateBuildingSpec(args, site) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, spec: null, errors: ['The model did not return a building object.'] };
  }
  const errors = [];

  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) errors.push('name is required');
  else if (name.length > MAX_NAME) errors.push(`name must be ${MAX_NAME} characters or fewer`);

  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (description.length > MAX_DESC) errors.push(`description must be ${MAX_DESC} characters or fewer`);

  const parts = Array.isArray(args.parts) ? args.parts : null;
  if (!parts) errors.push('parts must be an array');
  else if (!parts.length) errors.push('parts must contain at least one part');
  else if (parts.length > MAX_PARTS) errors.push(`parts must contain at most ${MAX_PARTS} entries (got ${parts.length})`);

  const clean = [];
  let maxR = 0;
  let maxY = 0;

  if (parts) {
    parts.forEach((raw, i) => {
      const at = `part ${i + 1}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`${at} is not an object`);
        return;
      }
      if (!SHAPES.includes(raw.shape)) {
        errors.push(`${at} shape "${str(raw.shape)}" is not one of ${SHAPES.join(', ')}`);
        return;
      }
      if (!MATERIALS.includes(raw.material)) {
        errors.push(`${at} material "${str(raw.material)}" is not one of ${MATERIALS.join(', ')}`);
        return;
      }
      const size = numArray(raw.size, 1, 3);
      if (!size) {
        errors.push(`${at} size must be 1 to 3 finite numbers`);
        return;
      }
      if (size.some((v) => v < SIZE_MIN || v > SIZE_MAX)) {
        errors.push(`${at} size values must be between ${SIZE_MIN} and ${SIZE_MAX}`);
        return;
      }
      const pos = numArray(raw.pos, 3, 3);
      if (!pos) {
        errors.push(`${at} pos must be 3 finite numbers`);
        return;
      }
      if (Math.abs(pos[0]) > XZ_MAX || Math.abs(pos[2]) > XZ_MAX) {
        errors.push(`${at} pos x and z must be within +/-${XZ_MAX}`);
        return;
      }
      if (pos[1] < Y_MIN || pos[1] > Y_MAX) {
        errors.push(`${at} pos y must be between ${Y_MIN} and ${Y_MAX}`);
        return;
      }
      let rot = 0;
      if (raw.rot !== undefined && raw.rot !== null) {
        if (typeof raw.rot !== 'number' || !Number.isFinite(raw.rot)) {
          errors.push(`${at} rot must be a finite number`);
          return;
        }
        if (Math.abs(raw.rot) > Math.PI * 2) {
          errors.push(`${at} rot must be within +/-2*PI radians`);
          return;
        }
        rot = raw.rot;
      }
      let color = null;
      if (raw.color !== undefined && raw.color !== null) {
        if (typeof raw.color !== 'string' || !COLOR_RE.test(raw.color)) {
          errors.push(`${at} color must be a "#rrggbb" hex string`);
          return;
        }
        color = raw.color;
      }
      const s = sizeFor(raw.shape, size);
      clean.push({ shape: raw.shape, size: s, pos, rot, color, material: raw.material });
      maxR = Math.max(maxR, Math.hypot(pos[0], pos[2]) + horizontalExtent(raw.shape, s));
      maxY = Math.max(maxY, pos[1] + verticalExtent(raw.shape, s));
    });
  }

  if (errors.length) return { ok: false, spec: null, errors };

  const footprint = Math.min(FOOTPRINT_MAX, Math.max(FOOTPRINT_MIN, maxR));
  if (maxR > footprint) {
    errors.push(`the design reaches ${maxR.toFixed(1)} units from its centre but the footprint cap is ${FOOTPRINT_MAX}`);
  }
  if (maxY > HEIGHT_MAX) {
    errors.push(`the design is ${maxY.toFixed(1)} units tall but the height cap is ${HEIGHT_MAX}`);
  }
  if (site && footprint > site.clearance) {
    errors.push(`a footprint of ${footprint.toFixed(1)} units does not fit the selected site, which has ${site.clearance.toFixed(1)} units of clearance`);
  }
  if (errors.length) return { ok: false, spec: null, errors };

  return {
    ok: true,
    errors: [],
    spec: {
      name,
      description,
      parts: clean,
      footprint,
      height: maxY,
      labelHeight: Math.min(maxY + 2, 40),
    },
  };
}

function paletteFrom(v, def, errors) {
  const base = { floor: '#c9d2da', wall: '#eef2f6', accent: TYPE_COLORS[def.type] || TYPE_COLORS.custom };
  if (v === undefined || v === null) return base;
  if (typeof v !== 'object' || Array.isArray(v)) {
    errors.push('palette must be an object of "#rrggbb" colours');
    return base;
  }
  const out = { ...base };
  for (const key of ['floor', 'wall', 'accent']) {
    const c = v[key];
    if (c === undefined || c === null) continue;
    if (typeof c !== 'string' || !COLOR_RE.test(c)) {
      errors.push(`palette.${key} must be a "#rrggbb" hex string`);
      continue;
    }
    out[key] = c;
  }
  return out;
}

export function validateSpaceSpec(args, def) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, spec: null, errors: ['The model did not return a room object.'] };
  }
  const env = roomEnvelope(def);
  const errors = [];

  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) errors.push('name is required');
  else if (name.length > MAX_NAME) errors.push(`name must be ${MAX_NAME} characters or fewer`);

  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (description.length > MAX_DESC) errors.push(`description must be ${MAX_DESC} characters or fewer`);

  const floor = numArray(args.floor, 2, 2);
  if (!floor) errors.push('floor must be 2 finite numbers');
  else if (floor[0] < ROOM_MIN || floor[1] < ROOM_MIN) errors.push(`floor must be at least ${ROOM_MIN} by ${ROOM_MIN} units`);
  else if (floor[0] > env.w || floor[1] > env.d) errors.push(`floor must fit this building, so at most ${env.w} by ${env.d} units`);

  const wallHeight = finite(args.wallHeight) ? args.wallHeight : null;
  if (wallHeight === null) errors.push('wallHeight must be a finite number');
  else if (wallHeight < WALL_MIN || wallHeight > WALL_MAX) errors.push(`wallHeight must be between ${WALL_MIN} and ${WALL_MAX}`);

  let robots = 3;
  if (args.robots !== undefined && args.robots !== null) {
    if (!Number.isInteger(args.robots)) errors.push('robots must be an integer');
    else if (args.robots < 0 || args.robots > MAX_ROBOTS) errors.push(`robots must be between 0 and ${MAX_ROBOTS}`);
    else robots = args.robots;
  }

  const palette = paletteFrom(args.palette, def, errors);

  const rawItems = Array.isArray(args.items) ? args.items : null;
  if (!rawItems) errors.push('items must be an array');
  else if (rawItems.length > MAX_ITEMS) errors.push(`items must contain at most ${MAX_ITEMS} entries (got ${rawItems.length})`);

  const items = [];
  if (rawItems && rawItems.length <= MAX_ITEMS && floor) {
    const hw = floor[0] / 2;
    const hd = floor[1] / 2;
    rawItems.forEach((raw, i) => {
      const at = `item ${i + 1}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`${at} is not an object`);
        return;
      }
      if (!KINDS.includes(raw.kind)) {
        errors.push(`${at} kind "${str(raw.kind)}" is not one of ${KINDS.join(', ')}`);
        return;
      }
      const pos = numArray(raw.pos, 2, 2);
      if (!pos) {
        errors.push(`${at} pos must be 2 finite numbers`);
        return;
      }
      let scale = 1;
      if (raw.scale !== undefined && raw.scale !== null) {
        if (!finite(raw.scale)) {
          errors.push(`${at} scale must be a finite number`);
          return;
        }
        if (raw.scale < SCALE_MIN || raw.scale > SCALE_MAX) {
          errors.push(`${at} scale must be between ${SCALE_MIN} and ${SCALE_MAX}`);
          return;
        }
        scale = raw.scale;
      }
      let rot = 0;
      if (raw.rot !== undefined && raw.rot !== null) {
        if (!finite(raw.rot)) {
          errors.push(`${at} rot must be a finite number`);
          return;
        }
        if (Math.abs(raw.rot) > Math.PI * 2) {
          errors.push(`${at} rot must be within +/-2*PI radians`);
          return;
        }
        rot = raw.rot;
      }
      let color = null;
      if (raw.color !== undefined && raw.color !== null) {
        if (typeof raw.color !== 'string' || !COLOR_RE.test(raw.color)) {
          errors.push(`${at} color must be a "#rrggbb" hex string`);
          return;
        }
        color = raw.color;
      }
      // the whole item has to fit at its scaled size, with the clearance the mesher and the
      // robot blockers assume, or it would end up sticking through a wall
      const reach = (KIND_RADIUS[raw.kind] ?? 0.6) * scale + ITEM_MARGIN;
      if (hw - reach < 0 || hd - reach < 0) {
        errors.push(`${at} cannot fit in a ${floor[0]} by ${floor[1]} room at that scale`);
        return;
      }
      if (Math.abs(pos[0]) > hw - reach || Math.abs(pos[1]) > hd - reach) {
        errors.push(`${at} at [${pos[0]}, ${pos[1]}] does not fit inside a ${floor[0]} by ${floor[1]} floor`);
        return;
      }
      items.push({ kind: raw.kind, pos, rot, color, scale });
    });
  }

  if (errors.length) return { ok: false, spec: null, errors };

  return {
    ok: true,
    errors: [],
    spec: { name, description, floor, wallHeight, palette, items, robots },
  };
}

export function validateObjectSpec(args, room) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, spec: null, errors: ['The model did not return an object.'] };
  }
  if (!room || !finite(room.w) || !finite(room.d) || !finite(room.wallH)) {
    return { ok: false, spec: null, errors: ['There is no indoor space to put that object in.'] };
  }
  const { maxR, maxY } = objectEnvelope(room);
  const errors = [];

  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) errors.push('name is required');
  else if (name.length > MAX_NAME) errors.push(`name must be ${MAX_NAME} characters or fewer`);

  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (description.length > MAX_DESC) errors.push(`description must be ${MAX_DESC} characters or fewer`);

  const parts = Array.isArray(args.parts) ? args.parts : null;
  if (!parts) errors.push('parts must be an array');
  else if (!parts.length) errors.push('parts must contain at least one part');
  else if (parts.length > OBJ_MAX_PARTS) errors.push(`parts must contain at most ${OBJ_MAX_PARTS} entries (got ${parts.length})`);

  const clean = [];
  let reach = 0;
  let top = 0;

  if (parts && parts.length <= OBJ_MAX_PARTS) {
    parts.forEach((raw, i) => {
      const at = `part ${i + 1}`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(`${at} is not an object`);
        return;
      }
      if (!SHAPES.includes(raw.shape)) {
        errors.push(`${at} shape "${str(raw.shape)}" is not one of ${SHAPES.join(', ')}`);
        return;
      }
      if (!MATERIALS.includes(raw.material)) {
        errors.push(`${at} material "${str(raw.material)}" is not one of ${MATERIALS.join(', ')}`);
        return;
      }
      const size = numArray(raw.size, 1, 3);
      if (!size) {
        errors.push(`${at} size must be 1 to 3 finite numbers`);
        return;
      }
      if (size.some((v) => v < OBJ_SIZE_MIN || v > OBJ_SIZE_MAX)) {
        errors.push(`${at} size values must be between ${OBJ_SIZE_MIN} and ${OBJ_SIZE_MAX}`);
        return;
      }
      const pos = numArray(raw.pos, 3, 3);
      if (!pos) {
        errors.push(`${at} pos must be 3 finite numbers`);
        return;
      }
      if (Math.abs(pos[0]) > OBJ_XZ_MAX || Math.abs(pos[2]) > OBJ_XZ_MAX) {
        errors.push(`${at} pos x and z must be within +/-${OBJ_XZ_MAX}`);
        return;
      }
      // an object stands on the floor, so unlike a building part it can never start below y=0
      if (pos[1] < 0 || pos[1] > maxY) {
        errors.push(`${at} pos y must be between 0 and ${maxY.toFixed(1)}`);
        return;
      }
      let rot = 0;
      if (raw.rot !== undefined && raw.rot !== null) {
        if (!finite(raw.rot)) {
          errors.push(`${at} rot must be a finite number`);
          return;
        }
        if (Math.abs(raw.rot) > Math.PI * 2) {
          errors.push(`${at} rot must be within +/-2*PI radians`);
          return;
        }
        rot = raw.rot;
      }
      let color = null;
      if (raw.color !== undefined && raw.color !== null) {
        if (typeof raw.color !== 'string' || !COLOR_RE.test(raw.color)) {
          errors.push(`${at} color must be a "#rrggbb" hex string`);
          return;
        }
        color = raw.color;
      }
      const s = sizeFor(raw.shape, size);
      clean.push({ shape: raw.shape, size: s, pos, rot, color, material: raw.material });
      reach = Math.max(reach, Math.hypot(pos[0], pos[2]) + horizontalExtent(raw.shape, s));
      top = Math.max(top, pos[1] + verticalExtent(raw.shape, s));
    });
  }

  if (errors.length) return { ok: false, spec: null, errors };

  if (reach > maxR) {
    errors.push(`the object reaches ${reach.toFixed(2)} units from its centre but this room allows ${maxR.toFixed(2)}`);
  }
  if (top > maxY) {
    errors.push(`the object is ${top.toFixed(2)} units tall but this room allows ${maxY.toFixed(2)}`);
  }
  if (errors.length) return { ok: false, spec: null, errors };

  return { ok: true, errors: [], spec: { name, description, parts: clean } };
}
