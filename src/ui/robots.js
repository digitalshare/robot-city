import * as THREE from 'three';
import { world, disposeGroup } from '../town/world.js';
import { buildParts } from '../town/custom.js';
import { OBJ_SCALE_MIN, OBJ_SCALE_MAX } from '../town/objects.js';
import {
  ROBOT_TYPES, robotTypeById, robotParts, robotMetrics, robotRadius, SPEED_MIN, SPEED_MAX,
} from '../town/robots.js';

// The robot page: one master–detail dialog over the town roster. The left is the list of deployed
// robots plus the model library they come from; the right is that robot's item panel next to a small
// live 3D preview. Nothing here holds robot state — every read goes through the api and every write
// comes back as the record that was actually stored, so the controls can never drift from the town.
export function initRobots({ api, toast }) {
  const panel = document.querySelector('#robot-panel');
  const listEl = document.querySelector('#rb-list');
  const typesEl = document.querySelector('#rb-types');
  const searchEl = document.querySelector('#rb-search');
  const emptyEl = document.querySelector('#rb-empty');
  const countEl = document.querySelector('#rb-count');

  const noneEl = document.querySelector('#rb-none');
  const itemEl = document.querySelector('#rb-item');
  const typeEl = document.querySelector('#rb-type-item');

  const itemH = document.querySelector('#rb-item-h');
  const nameEl = document.querySelector('#rb-name');
  const modelEl = document.querySelector('#rb-model');
  const colorEl = document.querySelector('#rb-color');
  const sizeEl = document.querySelector('#rb-size');
  const sizeVal = document.querySelector('#rb-size-val');
  const speedEl = document.querySelector('#rb-speed');
  const speedVal = document.querySelector('#rb-speed-val');
  const homeEl = document.querySelector('#rb-home');
  const statusEl = document.querySelector('#rb-status');

  const typeNameEl = document.querySelector('#rb-type-name');
  const typeDescEl = document.querySelector('#rb-type-desc');
  const typeMetaEl = document.querySelector('#rb-type-meta');
  const typeHomeEl = document.querySelector('#rb-type-home');

  const canvas = document.querySelector('#rb-canvas');
  const previewNote = document.querySelector('#rb-preview-note');

  let selected = null;

  // ---- the two lists ----

  function row(className, dotColor, name, sub, onPick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;

    const dot = document.createElement('span');
    dot.className = 'rb-dot';
    dot.style.background = dotColor;

    const text = document.createElement('span');
    text.className = 'rb-text';
    const title = document.createElement('span');
    title.className = 'rb-name';
    title.textContent = name;
    const line = document.createElement('span');
    line.className = 'rb-sub-line';
    line.textContent = sub;
    text.append(title, line);

    el.append(dot, text);
    el.addEventListener('click', onPick);
    return el;
  }

  const matches = (q, ...fields) => !q || fields.join(' ').toLowerCase().includes(q);

  function renderList() {
    const q = searchEl.value.trim().toLowerCase();
    const all = api.robots();
    countEl.textContent = String(all.length);

    const rows = [];
    for (const r of all) {
      if (!matches(q, r.name, r.model, r.modelId, r.homeName)) continue;
      const el = row('rb-row', r.color, r.name, `${r.model} · ${r.homeName}`, () => selectRobot(r.id));
      el.dataset.robot = r.id;
      rows.push(el);
    }
    listEl.replaceChildren(...rows);
    emptyEl.classList.toggle('hidden', rows.length > 0);

    for (const el of typesEl.children) {
      const t = robotTypeById(el.dataset.type);
      el.classList.toggle('hidden', !t || !matches(q, t.name, t.desc, t.tags, t.id));
    }
    syncCurrent();
  }

  // which row is the one the detail panel is showing
  function syncCurrent() {
    const id = selected?.id ?? null;
    for (const el of listEl.children) {
      el.setAttribute('aria-current', String(selected?.kind === 'robot' && el.dataset.robot === id));
    }
    for (const el of typesEl.children) {
      el.setAttribute('aria-current', String(selected?.kind === 'type' && el.dataset.type === id));
    }
  }

  function buildTypes() {
    const rows = ROBOT_TYPES.map((t) => {
      const el = row(
        'rb-type-row', t.color, t.name,
        `${t.parts.length} parts · speed ${t.speed.toFixed(1)}`,
        () => selectType(t.id)
      );
      el.dataset.type = t.id;
      el.title = t.desc;
      return el;
    });
    typesEl.replaceChildren(...rows);
  }

  // ---- the detail blocks ----

  function show(which) {
    noneEl.classList.toggle('hidden', which !== 'none');
    itemEl.classList.toggle('hidden', which !== 'item');
    typeEl.classList.toggle('hidden', which !== 'type');
  }

  function fillHomes(sel, value) {
    const opts = world.buildings.map((b) => {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.name;
      return o;
    });
    sel.replaceChildren(...opts);
    if (value && world.buildings.some((b) => b.id === value)) sel.value = value;
  }

  function statusText(r) {
    const where = r.indoors ? `inside ${r.homeName}` : 'out on the streets';
    const at = r.pos ? ` at (${r.pos[0].toFixed(2)}, ${r.pos[1].toFixed(2)})` : '';
    const kind = r.source === 'seed' ? 'Seeded crew' : 'Deployed';
    return `${kind} · ${r.parts} part${r.parts === 1 ? '' : 's'} · `
      + `${(r.radius * 2).toFixed(2)} wide · ${r.metrics.height.toFixed(2)} tall · ${where}${at}`;
  }

  // refilled from the stored record on every selection change and after every save
  function fillItem(r) {
    if (!r) {
      selected = null;
      show('none');
      stopPreview();
      return;
    }
    itemH.textContent = r.name;
    nameEl.value = r.name;
    modelEl.value = r.modelId;
    colorEl.value = r.color;
    sizeEl.value = String(r.scale);
    sizeVal.textContent = r.scale.toFixed(2);
    speedEl.value = String(r.speed);
    speedVal.textContent = r.speed.toFixed(1);
    fillHomes(homeEl, r.home);
    statusEl.textContent = statusText(r);
    show('item');
    setPreview(r.modelId, r.color, r.scale);
  }

  function fillType(t) {
    typeNameEl.textContent = t.name;
    typeDescEl.textContent = t.desc;
    const probe = { modelId: t.id, color: t.color, scale: 1 };
    typeMetaEl.textContent = `${t.parts.length} parts · speed ${t.speed.toFixed(1)} · `
      + `${(robotRadius(probe) * 2).toFixed(2)} wide · ${robotMetrics(probe).height.toFixed(2)} tall`;
    fillHomes(typeHomeEl, api.interiorRoom()?.id || typeHomeEl.value || world.buildings[0]?.id);
    show('type');
    setPreview(t.id, t.color, 1);
  }

  function selectRobot(id) {
    selected = { kind: 'robot', id };
    fillItem(api.robot(id));
    syncCurrent();
  }

  function selectType(id) {
    const t = robotTypeById(id);
    if (!t) return;
    selected = { kind: 'type', id };
    fillType(t);
    syncCurrent();
  }

  // ---- the 3D preview ----
  //
  // One extra WebGL context for the whole page, built on the first open rather than at boot, and
  // never fatal: three throws when a context cannot be created, so this degrades to a hidden canvas
  // with a note instead of taking the town down with it.

  let renderer = null;
  let previewScene = null;
  let previewCam = null;
  let previewGroup = null;
  let previewKey = null;
  let previewFailed = false;
  let raf = 0;
  let statusTimer = 0;

  function ensureRenderer() {
    if (renderer) return true;
    if (previewFailed) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
      renderer.setSize(canvas.width, canvas.height, false);
    } catch (err) {
      console.warn('robot preview unavailable:', err?.message || err);
      renderer = null;
      previewFailed = true;
      canvas.classList.add('hidden');
      previewNote.classList.remove('hidden');
      return false;
    }
    previewScene = new THREE.Scene();
    previewScene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.2, 3.4, 3);
    previewScene.add(key);
    previewCam = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 60);
    return true;
  }

  // fresh materials and geometry per model, so dropping the previous one is safe
  function setPreview(modelId, color, scale) {
    const key = `${modelId}|${color}|${scale}`;
    if (key === previewKey) return;
    previewKey = key;
    if (!ensureRenderer()) return;
    if (previewGroup) {
      previewScene.remove(previewGroup);
      disposeGroup(previewGroup);
      previewGroup = null;
    }
    const type = robotTypeById(modelId);
    if (!type) return;
    const g = new THREE.Group();
    buildParts(g, robotParts(type, color));
    g.scale.setScalar(scale);
    previewGroup = g;
    previewScene.add(g);

    const { radius, height } = robotMetrics({ modelId, color, scale });
    const dist = Math.max(2.4, (height + radius) * 1.85);
    previewCam.position.set(dist * 0.58, height * 0.78, dist);
    previewCam.lookAt(0, height * 0.46, 0);
    previewCam.updateProjectionMatrix();
    startLoop();
  }

  function stopPreview() {
    previewKey = null;
    if (!previewGroup || !previewScene) return;
    previewScene.remove(previewGroup);
    disposeGroup(previewGroup);
    previewGroup = null;
  }

  function startLoop() {
    if (raf || !renderer) return;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (!previewGroup) return;
      previewGroup.rotation.y += 0.012;
      renderer.render(previewScene, previewCam);
    };
    raf = requestAnimationFrame(step);
  }

  function stopLoop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // where the selection is standing right now, but only while it can actually move
  function startStatus() {
    stopStatus();
    statusTimer = setInterval(() => {
      if (panel.classList.contains('hidden') || selected?.kind !== 'robot') return;
      const r = api.robot(selected.id);
      if (r) statusEl.textContent = statusText(r);
    }, 250);
  }

  function stopStatus() {
    if (!statusTimer) return;
    clearInterval(statusTimer);
    statusTimer = 0;
  }

  // ---- controls ----

  function previewFromFields() {
    setPreview(modelEl.value, colorEl.value, Number(sizeEl.value) || 1);
  }

  sizeEl.min = String(OBJ_SCALE_MIN);
  sizeEl.max = String(OBJ_SCALE_MAX);
  speedEl.min = String(SPEED_MIN);
  speedEl.max = String(SPEED_MAX);
  modelEl.replaceChildren(...ROBOT_TYPES.map((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    return o;
  }));

  nameEl.addEventListener('input', () => { itemH.textContent = nameEl.value || '(unnamed)'; });
  modelEl.addEventListener('change', previewFromFields);
  colorEl.addEventListener('input', previewFromFields);
  sizeEl.addEventListener('input', () => {
    sizeVal.textContent = Number(sizeEl.value || 0).toFixed(2);
    previewFromFields();
  });
  speedEl.addEventListener('input', () => {
    speedVal.textContent = Number(speedEl.value || 0).toFixed(1);
  });

  document.querySelector('#rb-save').addEventListener('click', () => {
    if (selected?.kind !== 'robot') return;
    const rec = api.saveRobot(selected.id, {
      name: nameEl.value,
      modelId: modelEl.value,
      color: colorEl.value,
      scale: Number(sizeEl.value),
      speed: Number(speedEl.value),
      home: homeEl.value,
    });
    if (!rec) {
      toast('That robot is no longer in town.');
      return;
    }
    renderList();
    fillItem(api.robot(rec.id));
    toast(`${rec.name} updated.`);
  });

  document.querySelector('#rb-remove').addEventListener('click', () => {
    if (selected?.kind !== 'robot') return;
    const name = nameEl.value || 'That robot';
    if (!api.dropRobot(selected.id)) return;
    selected = null;
    stopPreview();
    show('none');
    renderList();
    toast(`${name} removed from the roster.`);
  });

  document.querySelector('#rb-focus').addEventListener('click', () => {
    if (selected?.kind !== 'robot') return;
    const id = selected.id;
    // this dialog sits above the no-indoor-space prompt, so it has to be gone before the
    // building it is focusing can ask for one
    close();
    const r = api.focusRobot(id);
    if (r && !r.ok && r.reason !== 'no-space') toast('That robot has no home building any more.');
  });

  document.querySelector('#rb-deploy').addEventListener('click', () => {
    if (selected?.kind !== 'type') return;
    const modelId = selected.id;
    const rec = api.deployRobot(modelId, typeHomeEl.value);
    if (!rec) {
      toast('Pick a building to deploy into.');
      return;
    }
    const home = world.buildings.find((b) => b.id === rec.home);
    renderList();
    selectRobot(rec.id);
    toast(`${rec.name} deployed to ${home?.name ?? 'the room you are in'}.`);
  });

  searchEl.addEventListener('input', renderList);
  document.querySelector('#rb-close').addEventListener('click', close);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) close();
  });

  buildTypes();
  renderList();
  show('none');

  function open() {
    panel.classList.remove('hidden');
    ensureRenderer();
    startLoop();
    startStatus();
    renderList();
    if (selected?.kind === 'robot') {
      // the roster can change while the dialog is closed
      fillItem(api.robot(selected.id));
      syncCurrent();
    } else if (selected?.kind === 'type') {
      selectType(selected.id);
    } else {
      const first = api.robots()[0];
      if (first) selectRobot(first.id);
      else show('none');
    }
  }

  function close() {
    panel.classList.add('hidden');
    stopLoop();
    stopStatus();
  }

  function isOpen() {
    return !panel.classList.contains('hidden');
  }

  function openRobot(id) {
    if (api.robot(id)) selected = { kind: 'robot', id };
    open();
  }

  return { open, close, isOpen, openRobot };
}
