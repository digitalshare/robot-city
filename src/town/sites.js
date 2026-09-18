import { sectorRadiusAt } from './data.js';
import { world } from './world.js';

// keep new buildings off the beach ramp at the coastline
const BEACH = 6;

function onLand(x, z) {
  for (const s of world.sectors) {
    const dx = x - s.offset[0];
    const dz = z - s.offset[1];
    if (Math.hypot(dx, dz) <= sectorRadiusAt(Math.atan2(dz, dx), s) - BEACH) return true;
  }
  return false;
}

function distToSegment(px, pz, s) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.min(1, Math.max(0, ((px - s.ax) * dx + (pz - s.az) * dz) / l2)) : 0;
  return Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
}

// Can a building of `neededRadius` sit at (x, z)? Reports the tightest constraint so
// the placement banner can explain a rejection and show how much room a site really has.
export function siteCheck(x, z, neededRadius) {
  if (!onLand(x, z)) return { ok: false, reason: 'over water', clearance: 0 };

  let clearance = Infinity;
  let reason = '';
  const consider = (margin, why) => {
    if (margin < clearance) {
      clearance = margin;
      reason = why;
    }
  };

  for (const c of world.obstacles.circles) {
    consider(Math.hypot(x - c.x, z - c.z) - c.r, 'on the roundabout');
  }
  for (const r of world.obstacles.rings) {
    consider(Math.abs(Math.hypot(x - r.x, z - r.z) - r.r) - r.halfW, 'on a road');
  }
  for (const s of world.obstacles.segments) {
    consider(distToSegment(x, z, s) - s.halfW, 'on a road');
  }
  for (const b of world.buildings) {
    consider(Math.hypot(x - b.pos[0], z - b.pos[1]) - b.footprint, `too close to ${b.name}`);
  }
  // a building awaiting review is on the map too, so it blocks the same way
  if (world.review) {
    const b = world.review.def;
    consider(Math.hypot(x - b.pos[0], z - b.pos[1]) - b.footprint, `too close to ${b.name}`);
  }

  if (!Number.isFinite(clearance)) clearance = 0;
  const ok = clearance >= neededRadius;
  return { ok, reason: ok ? '' : reason, clearance };
}
