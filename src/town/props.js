import * as THREE from 'three';
import { RING_R, spokeDir } from './data.js';

const CAR_COLORS = [0x2f6fd0, 0xd04848, 0xe8b13c, 0xeef2f5, 0x7a4fd0, 0x3aa6dd];

function car(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.9, 4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 })
  );
  body.position.y = 0.75;
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.7, 2),
    new THREE.MeshStandardMaterial({ color: 0xbfe4f5, roughness: 0.2 })
  );
  cab.position.set(0, 1.5, -0.3);
  body.castShadow = true;
  cab.castShadow = true;
  g.add(body, cab);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.9 });
  for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.42, wz);
    g.add(w);
  }
  return g;
}

export function buildProps(scene) {
  const placements = [];
  const ringAngles = [20, 80, 140, 200, 260, 320];
  ringAngles.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const lane = i % 2 === 0 ? RING_R - 1.7 : RING_R + 1.7;
    placements.push({
      x: Math.sin(a) * lane,
      z: Math.cos(a) * lane,
      rot: Math.atan2(Math.cos(a), -Math.sin(a)),
      color: CAR_COLORS[i % CAR_COLORS.length],
    });
  });
  placements.push({ x: -1.6, z: 84, rot: 0, color: CAR_COLORS[3] });
  placements.push({ x: 1.6, z: 122, rot: Math.PI, color: CAR_COLORS[0] });
  const e = spokeDir(Math.PI / 2);
  placements.push({ x: e.x * 38 + 1.7, z: e.z * 38, rot: Math.PI / 2, color: CAR_COLORS[1] });

  for (const p of placements) {
    const c = car(p.color);
    c.position.set(p.x, 0.06, p.z);
    c.rotation.y = p.rot;
    scene.add(c);
  }
}
