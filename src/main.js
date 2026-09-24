import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './styles.css';
import {
  PALETTE, EXPANSIONS, sectorBuildingDef, nearestGraphNode, graphNode, connectToGraph, graphConnected,
} from './town/data.js';
import { buildTerrain, buildSectorLand } from './town/terrain.js';
import { buildRoads, buildSectorRoads, roadSegment } from './town/roads.js';
import { buildBuildings, buildBuilding } from './town/buildings.js';
import { buildVegetation, buildSectorVegetation } from './town/vegetation.js';
import { buildProps } from './town/props.js';
import { buildCustomBuilding } from './town/custom.js';
import { siteCheck } from './town/sites.js';
import { defaultSpaceSpec } from './town/spaces.js';
import {
  buildInterior, updateRobots, disposeInterior,
  addObject, removeObject, replaceObject, moveObject, objectGroup, freeSpotFor,
  addRobotMesh, removeRobotMesh, replaceRobotMesh, interiorRobotView, interiorCollisionStats,
} from './town/interior.js';
import {
  robotById, robotsOf, robotSummary, robotMetrics, robotRadius, robotKey, seedCrews, onDuty,
  persistRoster, restoreRoster, deployRobot, updateRobot, removeRobot,
} from './town/robots.js';
import {
  initCrowd, updateCrowd, syncCrowd, crowdStats, crowdRobotPos, crowdRobotView, pickCrowdRobot,
} from './town/crowd.js';
import {
  typeById, resolveParts, objectMetrics, objectRadius, effectiveAttrs,
  instanceFromType, instanceFromSpec, instanceFromItem, OBJ_SCALE_MIN, OBJ_SCALE_MAX,
} from './town/objects.js';
import {
  world, reach, bounds, notify, dockSector, addBuilding, removeBuilding, defById, disposeGroup,
  spaceOf, setSpace,
} from './town/world.js';
import { initUI } from './ui/overlay.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.sky, 260, 620);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 1200);
camera.position.set(70, 105, 165);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 18;
controls.maxDistance = 420;
controls.maxPolarAngle = Math.PI * 0.46;
controls.target.set(0, 0, -5);
controls.autoRotateSpeed = 0.6;

scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x6fae6f, 0.75));
const sun = new THREE.DirectionalLight(0xfff2df, 2.8);
sun.position.set(70, 110, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -130;
sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130;
sun.shadow.camera.bottom = -130;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0005;
scene.add(sun);

const terrain = buildTerrain(scene);
world.land.push(...terrain.land);
buildRoads(scene);
const { groups, byId } = buildBuildings(scene);
world.groups = groups;
world.byId = byId;
let vegetation = buildVegetation(scene);
buildProps(scene);

// Every building staffs a crew, and the crew that is not on duty inside a room walks the streets.
// Restore saved robot identities before seeding so a project restart keeps each robot's agent key.
restoreRoster();
// seedCrews must run before initCrowd, which reads the roster it just filled.
seedCrews(world.buildings);
persistRoster();
initCrowd(scene);

// Everything that was a hard-coded number for the core island is derived from reach(),
// which returns exactly 110 until the first sector docks — so nothing moves until then.
function applyScale() {
  const r = reach();
  const box = Math.max(130, r + 20);
  sun.shadow.camera.left = -box;
  sun.shadow.camera.right = box;
  sun.shadow.camera.top = box;
  sun.shadow.camera.bottom = -box;
  sun.shadow.camera.far = Math.max(400, (r + 20) * 2.6);
  sun.shadow.camera.updateProjectionMatrix();
  scene.fog.far = Math.max(620, r * 4);
  controls.maxDistance = Math.max(420, r * 2.2);
}
applyScale();

let tween = null;
function startTween(toTarget, toCam, dur = 1200) {
  tween = {
    t0: performance.now(),
    dur,
    fromT: controls.target.clone(),
    fromC: camera.position.clone(),
    toT: toTarget,
    toC: toCam,
  };
  controls.enabled = false;
}

function flyToPoint(x, z) {
  exitInterior();
  const target = new THREE.Vector3(x, 2, z);
  const az = controls.getAzimuthalAngle();
  const cam = new THREE.Vector3(
    target.x + Math.sin(az) * 42,
    26,
    target.z + Math.cos(az) * 42
  );
  startTween(target, cam);
}

function flyTo(id) {
  const b = defById(id);
  if (!b) return;
  flyToPoint(b.pos[0], b.pos[1]);
}

function zoomBy(f) {
  if (pov) return;
  const offset = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(offset.length() * f, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(offset.setLength(len));
}

// ---- map expansion ----

function refreshVegetation() {
  scene.remove(vegetation);
  disposeGroup(vegetation);
  vegetation = buildVegetation(scene);
}

function expandMap() {
  const sector = EXPANSIONS[world.expansionIndex];
  if (!sector) return null;
  const index = world.expansionIndex++;

  dockSector(sector);
  world.land.push(buildSectorLand(scene, sector));
  buildSectorRoads(sector);

  const defs = [];
  for (const b of sector.buildings) {
    const def = sectorBuildingDef(sector, b);
    addBuilding(def, buildBuilding(scene, def));
    defs.push(def);
  }
  // sampled after the buildings exist so their footprints clear trees
  buildSectorVegetation(scene, sector, index);

  seedCrews(defs);
  persistRoster();
  syncCrowd();
  applyScale();
  notify();
  return { sector, added: sector.buildings.length, index };
}

// ---- placement mode ----

const PROBE_RADIUS = 8;
let placing = false;
let marker = null;
// makeMarker() builds green, so the tracked state must start green too or the first
// invalid site never recolours
let markerOk = true;

function makeMarker(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(PROBE_RADIUS - 0.8, PROBE_RADIUS, 48), mat);
  ring.rotation.x = -Math.PI / 2;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(PROBE_RADIUS - 0.8, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthTest: false })
  );
  disc.rotation.x = -Math.PI / 2;
  g.add(ring, disc);
  g.position.y = 0.09;
  g.renderOrder = 900;
  g.visible = false;
  scene.add(g);
  return g;
}

function setMarkerColor(g, ok) {
  const hex = ok ? 0x35e0a1 : 0xff8080;
  g.traverse((o) => {
    if (o.isMesh && o.material.color.getHex() !== hex) o.material.color.setHex(hex);
  });
}

function setPlacing(on) {
  if (on && mode !== 'town') return;
  placing = on;
  ui.setPlacingState(on);
  if (on) {
    setHovered(null);
    ui.hideTooltip();
    renderer.domElement.style.cursor = 'crosshair';
    ui.setPlaceBanner('Pick a clear spot for the new building. Esc cancels.', true);
    return;
  }
  renderer.domElement.style.cursor = 'grab';
  if (!world.pendingSite && marker) marker.visible = false;
  ui.hidePlaceBanner();
}

function pickFreeSite(needed) {
  let best = null;
  for (let r = 24; r <= reach() && !best; r += 6) {
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const c = siteCheck(x, z, needed);
      if (c.ok && (!best || c.clearance > best.clearance)) best = { x, z, radius: needed, clearance: c.clearance };
    }
  }
  return best;
}

// ---- review lifecycle for AI-generated buildings ----

let reviewSeq = 0;

function discardReview() {
  const rv = world.review;
  if (!rv) return null;
  world.review = null;
  removeBuilding(rv.id);
  scene.remove(rv.group);
  disposeGroup(rv.group);
  scene.remove(rv.marker);
  disposeGroup(rv.marker);
  return rv;
}

function beginReview(spec, site) {
  const previous = discardReview();
  const spot = site || pickFreeSite(spec.footprint);
  if (!spot) {
    notify();
    return { ok: false, message: 'No free site is large enough for that footprint — pick one with Add Building first.', superseded: !!previous };
  }
  const id = `custom-${++reviewSeq}`;
  const def = {
    id,
    name: spec.name,
    desc: spec.description,
    type: 'custom',
    spec,
    pos: [spot.x, spot.z],
    rot: 0,
    footprint: spec.footprint,
    labelHeight: spec.labelHeight,
  };
  const group = buildBuilding(scene, def, buildCustomBuilding);
  if (!group) return { ok: false, message: 'That design could not be built.', superseded: !!previous };

  // hoverable and raycastable straight away, but not in world.buildings until confirmed
  world.groups.push(group);
  world.byId[id] = group;
  const marker = makeMarker(0xffb347);
  marker.position.set(spot.x, 0.09, spot.z);
  marker.visible = true;
  world.review = { id, def, group, marker, spot };
  notify();
  return { ok: true, id, def, spot, superseded: !!previous };
}

function commitReview() {
  const rv = world.review;
  if (!rv) return null;
  world.review = null;
  scene.remove(rv.marker);
  disposeGroup(rv.marker);
  addBuilding(rv.def, rv.group);
  seedCrews([rv.def]);
  world.pendingSite = null;
  if (marker) marker.visible = false;

  const nodeId = connectToGraph(`b:${rv.def.id}`, rv.def.pos[0], rv.def.pos[1]);
  const node = nodeId ? graphNode(nodeId) : null;
  if (node) {
    const dx = node.x - rv.def.pos[0];
    const dz = node.z - rv.def.pos[1];
    const len = Math.hypot(dx, dz);
    if (len > rv.def.footprint) {
      const ux = dx / len;
      const uz = dz / len;
      const ax = rv.def.pos[0] + ux * (rv.def.footprint - 1);
      const az = rv.def.pos[1] + uz * (rv.def.footprint - 1);
      roadSegment(world.roads, ax, az, node.x, node.z, { width: 4 });
      world.obstacles.segments.push({ ax, az, bx: node.x, bz: node.z, halfW: 5 });
    }
  }

  refreshVegetation();
  syncCrowd();
  notify();
  return rv.def;
}

// ---- interior mode ----

// Entering a building does not tear the town down: the same renderer, camera and OrbitControls are
// pointed at a second scene, so leaving restores the town exactly as it was and re-entering a
// visited room is instant because its scene stays cached on the space entry.
let mode = 'town';
let interior = null;
let interiorId = null;
let townCam = null;

function clampInteriorTarget() {
  const { hw, hd, wallH } = interior.room;
  const t = controls.target;
  t.x = THREE.MathUtils.clamp(t.x, -(hw - 1), hw - 1);
  t.z = THREE.MathUtils.clamp(t.z, -(hd - 1), hd - 1);
  t.y = THREE.MathUtils.clamp(t.y, 0.5, wallH - 0.4);
}

function mountInterior(id) {
  const def = defById(id);
  const space = spaceOf(id);
  if (!def || !space) return null;
  if (space.built) {
    // a cached room was meshed before whatever the roster has done to its crew since
    syncRoomCrew(id);
    interior = space.built;
  } else {
    interior = space.built = buildInterior(
      def, space.spec, space.objects, onDuty(robotsOf(id), space.spec)
    );
  }
  interiorId = id;
  townCam = {
    pos: camera.position.clone(),
    target: controls.target.clone(),
    autoRotate: controls.autoRotate,
  };
  tween = null;
  controls.enabled = true;
  controls.autoRotate = false;
  controls.minDistance = 1.5;
  controls.maxDistance = Math.max(6, Math.min(interior.room.hw, interior.room.hd) * 1.6);
  controls.maxPolarAngle = 1.45;
  controls.target.set(0, 1.4, 0);
  camera.position.set(0, interior.room.wallH * 0.75, Math.min(interior.room.hw, interior.room.hd) * 1.1);
  camera.lookAt(controls.target);
  mode = 'interior';
  renderer.domElement.style.cursor = 'grab';
  ui.setMode('interior', def);
  return interior;
}

function exitInterior() {
  if (pov) exitRobotPov();
  if (mode !== 'interior') return false;
  selectObject(null);
  drag = null;
  mode = 'town';
  interior = null;
  interiorId = null;
  tween = null;
  controls.minDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.46;
  applyScale();
  if (townCam) {
    controls.autoRotate = townCam.autoRotate;
    controls.target.copy(townCam.target);
    camera.position.copy(townCam.pos);
    townCam = null;
  }
  camera.lookAt(controls.target);
  setHovered(null);
  ui.setMode('town');
  return true;
}

function enterInterior(id) {
  if (pov) exitRobotPov();
  const def = defById(id);
  if (!def) return { ok: false, reason: 'unknown-building' };
  if (placing) setPlacing(false);
  if (!spaceOf(id)) {
    ui.showSpacePrompt(def);
    return { ok: false, reason: 'no-space' };
  }
  if (mode === 'interior') exitInterior();
  mountInterior(id);
  return { ok: true, id };
}

function applySpace(id, spec, source) {
  const def = defById(id);
  if (!def || !spec) return null;
  const { entry, previous } = setSpace(id, spec, source);
  // The spec's items are the design record; the floor holds them as editable instances. A
  // redesign re-seeds its own furniture and keeps whatever the user placed or derived.
  entry.objects = [
    ...(previous?.objects || []).filter((o) => o.source !== 'space'),
    ...(spec.items || []).map((item) => instanceFromItem(item, nextObjectId())).filter(Boolean),
  ];
  if (previous?.built) disposeInterior(previous.built);
  if (mode === 'interior' && interiorId === id) {
    interior = entry.built = buildInterior(
      def, spec, entry.objects, onDuty(robotsOf(id), spec)
    );
    controls.maxDistance = Math.max(6, Math.min(interior.room.hw, interior.room.hd) * 1.6);
    clampInteriorTarget();
    highlightSelected();
  }
  notify();
  return entry;
}

// ---- indoor objects ----
//
// Instances live on the space entry; their three.js groups live in the cached interior scene. So
// adding, adjusting, moving or removing one object never rebuilds the room and never resets the
// robots, and a /space redesign meshes the survivors when buildInterior() runs again.

let selectedObjectId = null;
let drag = null;
let objectSeq = 0;

const nextObjectId = () => `obj-${++objectSeq}`;

function objectsOf(id) {
  return spaceOf(id)?.objects ?? [];
}

function currentObjects() {
  return mode === 'interior' && interiorId ? objectsOf(interiorId) : [];
}

function objectById(id) {
  return id ? currentObjects().find((o) => o.id === id) || null : null;
}

// the plain-data view of one instance: the debug global, and the /space reference block
function objectSummary(o) {
  return {
    id: o.id,
    typeId: o.typeId,
    name: o.name,
    source: o.source,
    pos: o.pos,
    rot: o.rot,
    scale: o.scale,
    color: o.color,
    material: o.material,
    shape: o.shape,
    parts: o.parts.length,
    attrs: effectiveAttrs(o),
    metrics: objectMetrics(resolveParts(o), o.scale ?? 1),
    radius: objectRadius(o),
  };
}

function highlightSelected() {
  const g = interior && selectedObjectId ? objectGroup(interior, selectedObjectId) : null;
  if (g) setEmissive(g, 0x2a6db0, 0.35);
}

function selectObject(id) {
  if (interior && selectedObjectId) {
    const prev = objectGroup(interior, selectedObjectId);
    if (prev) setEmissive(prev, null);
  }
  selectedObjectId = objectById(id) ? id : null;
  highlightSelected();
  const inst = objectById(selectedObjectId);
  if (inst) ui.showObjectPanel(inst);
  else ui.hideObjectPanel();
  return inst;
}

function addObjectInstance(inst) {
  objectsOf(interiorId).push(inst);
  addObject(interior, inst);
  selectObject(inst.id);
  notify();
  return inst;
}

// A new object gets a floor spot clear of the furniture and of everything already placed.
function placeAtFreeSpot(inst) {
  const spot = freeSpotFor(interior, objectRadius(inst));
  inst.pos = [spot.x, spot.z];
  return inst;
}

function placeObjectType(typeId) {
  const type = typeById(typeId);
  if (!type || mode !== 'interior' || !interior) return null;
  return addObjectInstance(placeAtFreeSpot(instanceFromType(type, nextObjectId(), [0, 0])));
}

function addObjectSpec(spec, source) {
  if (!spec || mode !== 'interior' || !interior) return null;
  const inst = instanceFromSpec(spec, nextObjectId(), [0, 0]);
  if (source) inst.source = source;
  return addObjectInstance(placeAtFreeSpot(inst));
}

function updateObject(id, overrides) {
  const inst = objectById(id);
  if (!inst || mode !== 'interior' || !interior || !overrides) return null;
  if (overrides.scale !== undefined) {
    const s = Number(overrides.scale);
    if (Number.isFinite(s)) inst.scale = THREE.MathUtils.clamp(s, OBJ_SCALE_MIN, OBJ_SCALE_MAX);
  }
  if (overrides.color !== undefined) inst.color = overrides.color || null;
  if (overrides.material !== undefined) inst.material = overrides.material || null;
  if (overrides.shape !== undefined) inst.shape = overrides.shape || null;
  if (overrides.rot !== undefined) inst.rot = Number(overrides.rot) || 0;
  replaceObject(interior, inst);
  if (selectedObjectId === inst.id) highlightSelected();
  notify();
  return inst;
}

function removeObjectInstance(id) {
  if (mode !== 'interior' || !interior) return false;
  const objects = objectsOf(interiorId);
  const i = objects.findIndex((o) => o.id === id);
  if (i < 0) return false;
  objects.splice(i, 1);
  removeObject(interior, id);
  if (selectedObjectId === id) selectObject(null);
  notify();
  return true;
}

function pickObjectId() {
  if (!interior) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interior.objectGroups, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.objectId) o = o.parent;
  return o ? o.userData.objectId : null;
}

function pickInteriorRobotId() {
  if (!interior) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interior.robots.map((r) => r.mesh), true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.robotId) o = o.parent;
  return o ? o.userData.robotId : null;
}

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const floorHit = new THREE.Vector3();

// Dragging moves the instance across the floor plane, clamped inside the walls by the object's own
// footprint so it can never be pushed through one.
function dragTo(clientX, clientY) {
  const inst = objectById(drag.id);
  if (!inst) return;
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(floorPlane, floorHit)) return;
  const radius = objectRadius(inst);
  const bx = Math.max(0, interior.room.hw - radius - 0.2);
  const bz = Math.max(0, interior.room.hd - radius - 0.2);
  const x = Math.round(THREE.MathUtils.clamp(floorHit.x, -bx, bx) * 100) / 100;
  const z = Math.round(THREE.MathUtils.clamp(floorHit.z, -bz, bz) * 100) / 100;
  inst.pos = [x, z];
  moveObject(interior, inst.id, x, z);
  ui.syncObjectPos(inst);
}

function endDrag() {
  if (!drag) return;
  const { id, moved } = drag;
  drag = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = 'grab';
  if (!moved) selectObject(id);
}

// ---- robots ----
//
// The roster is town-wide data (town/robots.js); a room only ever holds the part of its building's
// crew that is on duty there. So editing a robot never rebuilds a room — the standing walker is
// added, re-meshed where it stands or freed — and objects, object positions and the camera pose all
// survive. A cached room is reconciled again when it is mounted, which is what catches an edit made
// while the camera was somewhere else.

function syncRoomCrew(id) {
  const space = spaceOf(id);
  const built = space?.built;
  if (!built) return;
  const duty = onDuty(robotsOf(id), space.spec);
  for (const walker of [...built.robots]) {
    const rec = duty.find((d) => d.id === walker.id);
    if (!rec) removeRobotMesh(built, walker.id);
    else if (robotKey(rec) !== walker.key) replaceRobotMesh(built, rec);
  }
  for (const rec of duty) {
    if (!built.robots.some((w) => w.id === rec.id)) addRobotMesh(built, rec);
  }
}

// an edit can move a robot between two buildings, and both rooms have to hear about it
function syncRooms(...ids) {
  for (const id of new Set(ids.filter(Boolean))) syncRoomCrew(id);
}

function deployRobotInto(modelId, homeId) {
  const home = homeId || (mode === 'interior' ? interiorId : null);
  if (!home || !defById(home)) return null;
  const rec = deployRobot(modelId, home);
  if (!rec) return null;
  syncRoomCrew(home);
  syncCrowd();
  notify();
  return rec;
}

function saveRobot(id, patch) {
  if (pov?.id === id) exitRobotPov();
  const before = robotById(id);
  if (!before) return null;
  const from = before.home;
  const rec = updateRobot(id, patch);
  if (!rec) return null;
  syncRooms(from, rec.home);
  syncCrowd();
  notify();
  return rec;
}

function dropRobot(id) {
  if (pov?.id === id) exitRobotPov();
  const rec = robotById(id);
  if (!rec || !removeRobot(id)) return false;
  syncRoomCrew(rec.home);
  syncCrowd();
  notify();
  return true;
}

function focusRobot(id) {
  const rec = robotById(id);
  return rec ? enterInterior(rec.home) : null;
}

// ---- robot first-person view ----

let pov = null;
const povDirection = new THREE.Vector3();

function cloneTownCam(value) {
  return value ? {
    pos: value.pos.clone(),
    target: value.target.clone(),
    autoRotate: value.autoRotate,
  } : null;
}

function robotLocation(rec) {
  const space = spaceOf(rec.home);
  const indoors = !!space && onDuty(robotsOf(rec.home), space.spec).some((r) => r.id === rec.id);
  return { mode: indoors ? 'interior' : 'town', space };
}

function firstPersonRobot(id) {
  const rec = robotById(id);
  if (!rec) return { ok: false, reason: 'unknown-robot' };
  if (pov) exitRobotPov();
  if (placing) setPlacing(false);
  selectObject(null);

  const target = robotLocation(rec);
  const saved = {
    mode,
    interiorId,
    townCam: cloneTownCam(townCam),
    pos: camera.position.clone(),
    target: controls.target.clone(),
    enabled: controls.enabled,
    autoRotate: controls.autoRotate,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    maxPolarAngle: controls.maxPolarAngle,
    near: camera.near,
  };

  if (target.mode === 'interior' && (mode !== 'interior' || interiorId !== rec.home)) {
    if (mode === 'interior') exitInterior();
    if (!mountInterior(rec.home)) return { ok: false, reason: 'no-space' };
  } else if (target.mode === 'town' && mode === 'interior') {
    exitInterior();
  }

  tween = null;
  controls.enabled = false;
  controls.autoRotate = false;
  camera.near = 0.08;
  camera.updateProjectionMatrix();
  renderer.domElement.style.cursor = 'default';
  setHovered(null);
  pov = { id, location: target.mode, saved };
  ui.closeDialogs();
  ui.setPov(robotSummary(rec), target.mode === 'interior');
  updatePovCamera();
  return { ok: true, id, location: target.mode };
}

function exitRobotPov() {
  if (!pov) return false;
  const { saved } = pov;
  pov = null;

  if (saved.mode === 'town') {
    if (mode === 'interior') exitInterior();
  } else if (saved.interiorId && (mode !== 'interior' || interiorId !== saved.interiorId)) {
    if (mode === 'interior') exitInterior();
    mountInterior(saved.interiorId);
  }

  townCam = cloneTownCam(saved.townCam);
  camera.position.copy(saved.pos);
  controls.target.copy(saved.target);
  controls.enabled = saved.enabled;
  controls.autoRotate = saved.autoRotate;
  controls.minDistance = saved.minDistance;
  controls.maxDistance = saved.maxDistance;
  controls.maxPolarAngle = saved.maxPolarAngle;
  camera.near = saved.near;
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  renderer.domElement.style.cursor = 'grab';
  ui.setPov(null);
  ui.setMode(mode, mode === 'interior' ? defById(interiorId) : null);
  return true;
}

function updatePovCamera() {
  if (!pov) return true;
  const rec = robotById(pov.id);
  const pose = pov.location === 'interior'
    ? interiorRobotView(interior, pov.id)
    : crowdRobotView(pov.id);
  if (!rec || !pose) {
    exitRobotPov();
    return false;
  }
  const metrics = robotMetrics(rec);
  const forward = robotRadius(rec) + 0.05;
  povDirection.set(Math.sin(pose.rot), 0, Math.cos(pose.rot));
  camera.position.set(
    pose.x + povDirection.x * forward,
    pose.y + Math.max(0.38, metrics.height * 0.72),
    pose.z + povDirection.z * forward
  );
  controls.target.copy(camera.position).addScaledVector(povDirection, 3);
  camera.lookAt(controls.target);
  return true;
}

// the record plus where it is standing right now: meshed in the room the camera is in, or out on
// the street with the rest of the crowd
function robotState(id) {
  const rec = robotById(id);
  if (!rec) return null;
  const walker = mode === 'interior' && interior && interiorId === rec.home
    ? interior.robots.find((r) => r.id === id) || null
    : null;
  const at = walker || crowdRobotPos(id);
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    ...robotSummary(rec),
    indoors: !!walker,
    pos: at ? [r2(at.x), r2(at.z)] : null,
  };
}

// the debug global's escape hatch: throw a room away and mesh it again from the roster
function rebuildInterior(id) {
  const def = defById(id);
  const space = spaceOf(id);
  if (!def || !space) return null;
  if (space.built) disposeInterior(space.built);
  space.built = buildInterior(def, space.spec, space.objects, onDuty(robotsOf(id), space.spec));
  if (mode === 'interior' && interiorId === id) {
    interior = space.built;
    clampInteriorTarget();
    highlightSelected();
  }
  return space.built;
}

// deterministic per building, so "generate from attributes" never reshuffles a room
function generateDefaultSpace(id) {
  const def = defById(id);
  if (!def || !applySpace(id, defaultSpaceSpec(def), 'default')) return null;
  mountInterior(id);
  return spaceOf(id).spec;
}

const ui = initUI({
  flyTo,
  flyToPoint,
  zoomBy,
  setShadows: (on) => { sun.castShadow = on; },
  setAutoRotate: (on) => { controls.autoRotate = on; },
  expandMap,
  setPlacing,
  isPlacing: () => placing,
  beginReview,
  commitReview,
  discardReview,
  pendingSite: () => world.pendingSite,
  clearPendingSite: () => {
    world.pendingSite = null;
    if (marker) marker.visible = false;
  },
  enterInterior,
  exitInterior,
  generateDefaultSpace,
  applySpace,
  placeObjectType,
  addObjectSpec,
  updateObject,
  removeObject: removeObjectInstance,
  selectedObject: () => objectById(selectedObjectId),
  clearSelection: () => selectObject(null),
  interiorRoom: () => (mode === 'interior' && interior
    ? { id: interiorId, room: interior.room, objectIds: currentObjects().map((o) => o.id) }
    : null),
  robots: () => world.robots.map(robotSummary),
  robot: robotState,
  deployRobot: deployRobotInto,
  saveRobot,
  dropRobot,
  focusRobot,
  firstPersonRobot,
  exitRobotPov,
  // the whole standing room as plain data: what a /space redesign is sent as its reference
  spaceState: (id) => {
    const s = spaceOf(id);
    const d = defById(id);
    if (!s || !d) return null;
    return {
      def: {
        id: d.id, name: d.name, type: d.type,
        footprint: d.footprint, labelHeight: d.labelHeight, desc: d.desc,
      },
      source: s.source,
      spec: {
        name: s.spec.name,
        description: s.spec.description,
        floor: s.spec.floor,
        wallHeight: s.spec.wallHeight,
        palette: s.spec.palette,
        robots: s.spec.robots,
      },
      objects: objectsOf(id).map(objectSummary),
    };
  },
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;
let hovered = null;

marker = makeMarker(0x35e0a1);

function setEmissive(group, hex, intensity) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.emissive) continue;
      if (hex === null) {
        m.emissive.setHex(m.userData.baseEmissive);
        m.emissiveIntensity = m.userData.baseEmissiveIntensity;
      } else {
        m.emissive.setHex(hex);
        m.emissiveIntensity = intensity;
      }
    }
  });
}

function setHovered(id) {
  if (id === hovered) return;
  const prev = hovered ? world.byId[hovered] : null;
  if (prev) setEmissive(prev, null);
  hovered = id;
  const g = id ? world.byId[id] : null;
  if (g) {
    setEmissive(g, 0x2a6db0, 0.3);
    ui.showTooltip(defById(id)?.name ?? '');
  } else {
    ui.hideTooltip();
  }
  if (!placing) renderer.domElement.style.cursor = g ? 'pointer' : 'grab';
}

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointerActive = true;
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
  if (drag.moved) dragTo(e.clientX, e.clientY);
});
renderer.domElement.addEventListener('pointerleave', () => {
  pointerActive = false;
  if (placing) marker.visible = false;
  else setHovered(null);
});

function groundPoint() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.land, false);
  return hits.length ? hits[0].point : null;
}

function updatePlacing() {
  if (!pointerActive) {
    marker.visible = false;
    return;
  }
  const p = groundPoint();
  if (!p) {
    marker.visible = false;
    return;
  }
  const check = siteCheck(p.x, p.z, PROBE_RADIUS);
  marker.visible = true;
  marker.position.set(p.x, 0.09, p.z);
  if (check.ok !== markerOk) {
    markerOk = check.ok;
    setMarkerColor(marker, markerOk);
  }
  ui.setPlaceBanner(
    check.ok
      ? `Site at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) with ${check.clearance.toFixed(1)} units of clearance — click to build here.`
      : `${check.reason} here (${check.clearance.toFixed(1)} units of clearance). Needs ${PROBE_RADIUS}.`,
    check.ok
  );
}

function pickBuildingId() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.groups, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.buildingId) o = o.parent;
  return o ? o.userData.buildingId : null;
}

function updateHover() {
  if (!pointerActive || tween || mode !== 'town') return;
  setHovered(pickBuildingId());
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  if (pov) return;
  if (mode !== 'interior' || !interior || e.button !== 0) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  if (pickInteriorRobotId()) return;
  const id = pickObjectId();
  if (!id) return;
  // Suspending the orbit in this same event is what keeps a drag from becoming a camera rotate:
  // OrbitControls has already seen the pointerdown, but its move handler bails out while disabled
  // and its pointerup handler still clears its own state.
  drag = { id, x: e.clientX, y: e.clientY, moved: false };
  controls.enabled = false;
  renderer.domElement.style.cursor = 'grabbing';
});

// On the canvas rather than the window, so a click inside a dialog selects nothing.
renderer.domElement.addEventListener('pointerup', (e) => {
  if (drag) {
    endDrag();
    return;
  }
  if (mode !== 'interior' || e.button !== 0) return;
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
  selectObject(null);
});
renderer.domElement.addEventListener('pointercancel', endDrag);
renderer.domElement.addEventListener('click', (e) => {
  // OrbitControls also fires click at the end of a drag; only treat a still press as a pick
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointerActive = true;
  if (pov) return;
  if (mode === 'interior') {
    const rid = pickInteriorRobotId();
    if (rid) ui.openRobot(rid);
    return;
  }
  if (mode !== 'town') return;

  if (!placing) {
    // buildings first: a robot standing in front of one must not steal the click
    const id = pickBuildingId();
    if (id) {
      enterInterior(id);
      return;
    }
    raycaster.setFromCamera(pointer, camera);
    const rid = pickCrowdRobot(raycaster);
    if (rid) ui.openRobot(rid);
    return;
  }

  const p = groundPoint();
  if (!p) return;
  const check = siteCheck(p.x, p.z, PROBE_RADIUS);
  if (!check.ok) return;
  world.pendingSite = { x: p.x, z: p.z, radius: PROBE_RADIUS, clearance: check.clearance };
  marker.position.set(p.x, 0.09, p.z);
  markerOk = true;
  setMarkerColor(marker, true);
  setPlacing(false);
  marker.visible = true;
  ui.openAiForSite(world.pendingSite);
});

renderer.domElement.addEventListener('dblclick', (e) => {
  if (pov || placing || mode !== 'town') return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...world.land, terrain.water], false);
  if (!hits.length) return;
  const p = hits[0].point;
  const r = Math.hypot(p.x, p.z);
  const limit = reach();
  const scale = r > limit ? limit / r : 1;
  const toTarget = new THREE.Vector3(p.x * scale, 1, p.z * scale);
  const delta = toTarget.clone().sub(controls.target);
  startTween(toTarget, camera.position.clone().add(delta), 900);
});

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (pov) exitRobotPov();
  else if (ui.isFunctionsOpen()) ui.hideFunctionsPanel();
  else if (ui.isRobotsOpen()) ui.hideRobotsPanel();
  else if (ui.isDialogOpen()) ui.closeDialogs();
  else if (placing) setPlacing(false);
  else if (selectedObjectId) selectObject(null);
  else if (mode === 'interior') exitInterior();
  else ui.hideSpacePrompt();
});

const anchor = new THREE.Vector3();
const viewDir = new THREE.Vector3();
let lastNow = performance.now();

function tick(now) {
  requestAnimationFrame(tick);

  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;

  if (tween) {
    const k = Math.min(1, (now - tween.t0) / tween.dur);
    const e = k * k * (3 - 2 * k);
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.lerpVectors(tween.fromC, tween.toC, e);
    camera.lookAt(controls.target);
    if (k >= 1) {
      tween = null;
      controls.enabled = true;
    }
  } else if (!pov) {
    controls.update();
  }

  if (mode === 'interior') {
    clampInteriorTarget();
    updateRobots(interior, dt, now);
    if (pov) updatePovCamera();
    renderer.render(mode === 'interior' ? interior.scene : scene, camera);
    return;
  }

  const t = controls.target;
  const limit = reach();
  const tr = Math.hypot(t.x, t.z);
  if (tr > limit) {
    t.x *= limit / tr;
    t.z *= limit / tr;
  }

  // the interior branch returned above, so the street crowd is the only walkers running here
  updateCrowd(dt, now, camera);
  if (pov) updatePovCamera();

  if (pov) {
    renderer.render(mode === 'interior' ? interior.scene : scene, camera);
    return;
  }
  if (placing) updatePlacing();
  else updateHover();

  if (hovered) {
    const b = defById(hovered);
    if (b) {
      anchor.set(b.pos[0], b.labelHeight, b.pos[1]).project(camera);
      if (anchor.z < 1) {
        ui.moveTooltip(
          (anchor.x * 0.5 + 0.5) * innerWidth,
          (-anchor.y * 0.5 + 0.5) * innerHeight
        );
      }
    }
  }

  if (world.review) {
    const pulse = 1 + Math.sin(now * 0.004) * 0.12;
    world.review.marker.scale.set(pulse, 1, pulse);
  }

  ui.setCompass(controls.getAzimuthalAngle());
  camera.getWorldDirection(viewDir);
  ui.drawMinimap({ x: camera.position.x, z: camera.position.z, dx: viewDir.x, dz: viewDir.z });

  renderer.render(scene, camera);
}
requestAnimationFrame(tick);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.__robotTown = {
  ready: true,
  screenPoint(x, z, h = 0) {
    const v = new THREE.Vector3(x, h, z).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * innerWidth,
      y: (-v.y * 0.5 + 0.5) * innerHeight,
      onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1,
    };
  },
  screenPos(id, h = 5) {
    const b = defById(id);
    if (!b) return null;
    const p = window.__robotTown.screenPoint(b.pos[0], b.pos[1], h);
    return { x: p.x, y: p.y };
  },
  pendingSite: () => world.pendingSite,
  cameraPose() {
    return { p: camera.position.toArray(), t: controls.target.toArray() };
  },
  buildings: () => world.buildings.map((b) => ({ id: b.id, name: b.name, type: b.type, pos: b.pos })),
  sectors: () => world.sectors.map((s) => ({ id: s.id, name: s.name, offset: s.offset })),
  robots: () => world.robots.map(robotSummary),
  robot: robotState,
  firstPersonRobot,
  exitRobotPov,
  pov: () => (pov ? {
    id: pov.id,
    location: pov.location,
    controlsEnabled: controls.enabled,
    camera: camera.position.toArray(),
    target: controls.target.toArray(),
  } : null),
  crowd: crowdStats,
  rebuildInterior,
  bounds,
  reach,
  review: () => (world.review
    ? { id: world.review.id, name: world.review.def.name, parts: world.review.def.spec.parts.length, pos: world.review.def.pos }
    : null),
  siteCheck: (x, z, r = PROBE_RADIUS) => siteCheck(x, z, r),
  roadConnected: (a, b) => graphConnected(a, b),
  nearestGraphNode: (x, z) => nearestGraphNode(x, z, (n) => !n.id.startsWith('b:'))?.id ?? null,
  setPlacing,
  flyTo,
  flyToPoint,
  expandMap,
  interior: () => (mode === 'interior' && interior
    ? {
      id: interiorId,
      mode,
      name: interior.spec.name,
      items: interior.spec.items.length,
      robots: interior.robots.length,
      robotIds: interior.robots.map((r) => r.id),
      objects: interior.objectGroups.length,
      room: { w: interior.room.w, d: interior.room.d, wallH: interior.room.wallH },
    }
    : null),
  space: (id) => {
    const s = spaceOf(id);
    if (!s) return null;
    return {
      source: s.source,
      name: s.spec.name,
      items: s.spec.items.length,
      kinds: [...new Set(s.spec.items.map((i) => i.kind))],
      robots: s.spec.robots,
      floor: s.spec.floor,
      wallHeight: s.spec.wallHeight,
      objects: s.objects.length,
      built: !!s.built,
    };
  },
  // no id reads the room the camera is standing in; an id reads the entry, so objects placed in a
  // visited building can be checked from town mode too
  objects: (id) => (id ? objectsOf(id) : currentObjects()).map(objectSummary),
  selectedObject: () => selectedObjectId,
  objectScreen(id, h = null) {
    const inst = objectById(id);
    if (!inst || mode !== 'interior') return null;
    const { height } = objectMetrics(resolveParts(inst), inst.scale ?? 1);
    const p = window.__robotTown.screenPoint(inst.pos[0], inst.pos[1], h ?? height / 2);
    return { x: p.x, y: p.y, onScreen: p.onScreen };
  },
  // the pick a pointerdown at this client point would make, without selecting anything
  objectAt(clientX, clientY) {
    if (mode !== 'interior') return null;
    pointer.x = (clientX / innerWidth) * 2 - 1;
    pointer.y = -(clientY / innerHeight) * 2 + 1;
    return pickObjectId();
  },
  robotAt(clientX, clientY) {
    if (mode !== 'interior') return null;
    pointer.x = (clientX / innerWidth) * 2 - 1;
    pointer.y = -(clientY / innerHeight) * 2 + 1;
    return pickInteriorRobotId();
  },
  robotPositions: () => (interior ? interior.robots.map((r) => [r.x, r.z]) : []),
  interiorCollisions: () => interiorCollisionStats(interior),
  enterInterior,
  exitInterior,
};
