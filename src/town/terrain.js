import * as THREE from 'three';
import { PALETTE, islandRadiusAt, sectorRadiusAt } from './data.js';

// shared between the core island and every docked sector so the overlap seam is
// invisible: identical colour, roughness and normals, no material mismatch
let landMats = null;
function landMaterials() {
  if (!landMats) {
    landMats = [
      new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 1 }),
    ];
  }
  return landMats;
}

function landGeometry(radiusAt, offsetX, offsetZ, lift) {
  const shape = new THREE.Shape();
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radiusAt(a);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 4,
    bevelEnabled: true,
    bevelThickness: 0.8,
    bevelSize: 1.2,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  // the flat top cap lands at y = lift; the bevel ramp falls away below it
  geo.translate(offsetX, -4.8 + lift, offsetZ);
  return geo;
}

export function buildTerrain(scene) {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: 0x2f9cbf, roughness: 0.45, metalness: 0.05 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -2.0;
  water.receiveShadow = true;
  water.name = 'water';
  scene.add(water);

  const island = new THREE.Mesh(landGeometry(islandRadiusAt, 0, 0, 0), landMaterials());
  island.receiveShadow = true;
  island.name = 'island';
  scene.add(island);

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(13, 48),
    new THREE.MeshStandardMaterial({ color: PALETTE.plaza, roughness: 1 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.05;
  plaza.receiveShadow = true;
  scene.add(plaza);

  const stoneMat = new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 1 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 56), stoneMat);
  deck.position.set(0, -0.65, 112);
  deck.castShadow = true;
  deck.receiveShadow = true;
  scene.add(deck);
  for (const z of [92, 108, 124, 136]) {
    for (const x of [-3.2, 3.2]) {
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 5, 10), stoneMat);
      pier.position.set(x, -3, z);
      scene.add(pier);
    }
  }

  return { island, water, plaza, land: [island, plaza] };
}

// Dock one authored sector onto the core island. Same extrude recipe, same shared
// materials, lifted 0.02 so its grass cap wins over the core cap in the overlap
// (identical colour, so the seam is invisible) and its bevel ramp hides underneath.
export function buildSectorLand(container, sector) {
  const mesh = new THREE.Mesh(
    landGeometry((a) => sectorRadiusAt(a, sector), sector.offset[0], sector.offset[1], 0.02),
    landMaterials()
  );
  mesh.receiveShadow = true;
  mesh.name = `land-${sector.id}`;
  container.add(mesh);
  return mesh;
}
