import * as THREE from 'three';
import { PALETTE } from './data.js';
import { reg, M, glass, glow, add, box, cyl, dome } from './buildings.js';

// Every material here goes through reg(): main.js restores m.userData.baseEmissive on
// hover-out, so an unregistered material would get emissive.setHex(undefined).
const MATERIALS = {
  wall: (color) => M(color ?? PALETTE.white),
  stone: (color) => M(color ?? PALETTE.stone, { roughness: 1 }),
  metal: (color) => M(color ?? PALETTE.gray, { roughness: 0.35, metalness: 0.75 }),
  glass: (color) => (color
    ? reg(new THREE.MeshStandardMaterial({
      color, transparent: true, opacity: 0.5, roughness: 0.08, metalness: 0.4,
    }))
    : glass()),
  glow: (color) => glow(color ?? PALETTE.glowCyan, 1.1),
};

// size is interpreted per shape, and pos.y is the height of the part's BASE above the
// building's ground plane, so a part with pos.y 0 always sits on the ground.
function partGeometry(part) {
  const s = part.size;
  switch (part.shape) {
    case 'box': return { geo: box(s[0], s[1], s[2]), lift: s[1] / 2 };
    case 'cylinder': return { geo: cyl(s[0], s[0], s[1], 24), lift: s[1] / 2 };
    case 'cone': return { geo: new THREE.ConeGeometry(s[0], s[1], 24), lift: s[1] / 2 };
    case 'sphere': return { geo: new THREE.SphereGeometry(s[0], 24, 16), lift: s[0] };
    case 'dome': return { geo: dome(s[0]), lift: 0 };
    default: return null;
  }
}

// Meshes one parts-DSL array into a group. Exported so indoor objects can reuse the exact
// same shapes and materials at object scale.
export function buildParts(g, parts) {
  for (const part of parts) {
    const built = partGeometry(part);
    if (!built) continue;
    const mat = MATERIALS[part.material](part.color);
    const [x, y, z] = part.pos;
    add(g, built.geo, mat, x, y + built.lift, z, 0, part.rot ?? 0, 0);
  }
}

export function buildCustomBuilding(g, def) {
  buildParts(g, def.spec.parts);
}

// The sharing version of the same recipe: one geometry per shape-and-size and one material per
// material-and-colour, both tagged so disposeGroup() leaves them alone. A street crowd is then a
// few dozen groups over a couple of dozen buffers instead of a fresh allocation per robot.
const geoCache = new Map();
const matCache = new Map();

export function sharedPart(part) {
  const gk = `${part.shape}|${part.size.join(',')}`;
  let built = geoCache.get(gk);
  if (!built) {
    built = partGeometry(part);
    if (!built) return null;
    built.geo.userData.shared = true;
    geoCache.set(gk, built);
  }
  const mk = `${part.material}|${part.color ?? ''}`;
  let mat = matCache.get(mk);
  if (!mat) {
    mat = MATERIALS[part.material](part.color);
    mat.userData.shared = true;
    matCache.set(mk, mat);
  }
  return { geo: built.geo, lift: built.lift, mat };
}
