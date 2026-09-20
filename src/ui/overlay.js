import { EXPANSIONS, TYPE_COLORS, sectorRadiusAt } from '../town/data.js';
import { world, bounds, subscribe } from '../town/world.js';
import { roomEnvelope } from '../town/spaces.js';
import {
  OBJECT_TYPES, resolveParts, objectMetrics, effectiveAttrs, OBJ_SCALE_MIN, OBJ_SCALE_MAX,
} from '../town/objects.js';
import { MATERIALS, SHAPES } from '../ai/tools.js';
import { ROBOT_TYPES } from '../town/robots.js';
import { createStore } from '../ai/config.js';
import { createFunctionStore } from '../ai/functions.js';
import { initModelConfig } from './modelConfig.js';
import { initFunctions } from './functions.js';
import { initRobots } from './robots.js';
import { initAiChat } from './aiChat.js';

export function initUI(api) {
  const $ = (s) => document.querySelector(s);

  const dialogs = {
    town: $('#town-panel'),
    buildings: $('#buildings-panel'),
    objects: $('#objects-panel'),
    settings: $('#settings-panel'),
  };
  const objectPanel = $('#object-panel');
  const viewBtns = document.querySelectorAll('.nav-btn[data-view]');
  // town | buildings | objects | settings | robots | object | null. 'object' is the selected-item
  // dialog: it has no nav button of its own and never touches the menu highlight.
  let currentDialog = null;

  function setActive(view) {
    viewBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }

  function hideNavDialogs() {
    for (const d of Object.values(dialogs)) d.classList.add('hidden');
  }

  function closeDialogs() {
    fns.close();
    robotsUi.close();
    objectPanel.classList.add('hidden');
    hideNavDialogs();
    currentDialog = null;
    setActive('map');
  }

  function openDialog(name) {
    if (name === 'robots') {
      hideNavDialogs();
      currentDialog = 'robots';
      setActive('robots');
      robotsUi.open();
      return;
    }
    if (!dialogs[name]) return;
    for (const [k, d] of Object.entries(dialogs)) d.classList.toggle('hidden', k !== name);
    currentDialog = name;
    setActive(name);
    if (name === 'town') syncTown();
    if (name === 'buildings') hideBuildingDetail();
    if (name === 'objects') { hideObjectTypeDetail(); syncObjectRoom(); }
  }

  function showView(view) {
    if (view === 'map') closeDialogs();
    else openDialog(view);
  }

  // the selected-object dialog is left out on purpose: Escape reaches it through the selection.
  // Read from the widgets, not from currentDialog: #rb-close and a backdrop click hide a dialog
  // without going through closeDialogs(), so the variable can be stale by one step.
  function isDialogOpen() {
    return robotsUi.isOpen() || Object.values(dialogs).some((d) => !d.classList.contains('hidden'));
  }

  for (const dlg of Object.values(dialogs)) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialogs(); });
  }
  objectPanel.addEventListener('click', (e) => { if (e.target === objectPanel) api.clearSelection(); });
  for (const sel of ['#tw-close', '#bd-close', '#od-close', '#st-close']) {
    $(sel).addEventListener('click', closeDialogs);
  }
  $('#ob-close').addEventListener('click', () => api.clearSelection());

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2800);
  }

  // ---- buildings dialog ----

  const list = $('#building-list');
  const searchEl = $('#building-search');
  const emptyEl = $('#building-empty');
  const statEl = $('#stat-buildings');
  const bdNone = $('#bd-none');
  const bdItem = $('#bd-item');
  const bdName = $('#bd-name');
  const bdType = $('#bd-type');
  const bdDesc = $('#bd-desc');
  const bdFootprint = $('#bd-footprint');
  const bdPos = $('#bd-pos');
  const bdCrew = $('#bd-crew');
  const bdSpace = $('#bd-space');
  const bdParts = $('#bd-parts');
  let selectedBuildingId = null;

  function markRow(container, id) {
    for (const row of container.children) row.classList.toggle('selected', row.dataset.id === id);
  }

  // refilled from the world on every selection, so the numbers cannot drift from the town
  function showBuildingDetail(def) {
    selectedBuildingId = def.id;
    bdNone.classList.add('hidden');
    bdItem.classList.remove('hidden');
    bdName.textContent = def.name;
    bdType.textContent = def.type;
    bdDesc.textContent = def.desc || '';
    bdFootprint.textContent = `${Math.round(def.footprint * 2)} units across`;
    bdPos.textContent = `(${Math.round(def.pos[0])}, ${Math.round(def.pos[1])})`;
    const crew = api.robots().filter((r) => r.home === def.id).length;
    bdCrew.textContent = `${crew} robot${crew === 1 ? '' : 's'}`;
    const space = world.spaces[def.id];
    bdSpace.textContent = space
      ? `${space.spec.name} · ${space.spec.items.length} item${space.spec.items.length === 1 ? '' : 's'}`
      : 'Not designed yet';
    bdParts.textContent = def.spec ? `${def.spec.parts.length} parts` : 'Built-in design';
    markRow(list, def.id);
  }

  function hideBuildingDetail() {
    selectedBuildingId = null;
    bdItem.classList.add('hidden');
    bdNone.classList.remove('hidden');
    markRow(list, null);
  }

  function renderGallery() {
    const q = searchEl.value.trim().toLowerCase();
    statEl.textContent = String(world.buildings.length);
    const rows = [];
    for (const b of world.buildings) {
      if (q && !`${b.name} ${b.desc || ''} ${b.type}`.toLowerCase().includes(q)) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'building-row';
      row.dataset.id = b.id;
      if (b.id === selectedBuildingId) row.classList.add('selected');

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = TYPE_COLORS[b.type] || '#59e3ff';

      const text = document.createElement('span');
      text.className = 'br-text';
      const name = document.createElement('span');
      name.className = 'br-name';
      name.textContent = b.name;
      const desc = document.createElement('span');
      desc.className = 'br-desc muted';
      desc.textContent = b.desc || '';
      text.append(name, desc);

      row.append(dot, text);
      row.addEventListener('click', () => showBuildingDetail(b));
      rows.push(row);
    }
    list.replaceChildren(...rows);
    emptyEl.classList.toggle('hidden', rows.length > 0);
    if (selectedBuildingId && !world.buildings.some((b) => b.id === selectedBuildingId)) hideBuildingDetail();
  }
  searchEl.addEventListener('input', renderGallery);

  $('#bd-fly').addEventListener('click', () => {
    const id = selectedBuildingId;
    if (!id) return;
    closeDialogs();
    api.flyTo(id);
  });

  // closed before entering: a building with no indoor space raises #space-prompt, which sits
  // below this backdrop and would be unreachable
  $('#bd-enter').addEventListener('click', () => {
    const id = selectedBuildingId;
    if (!id) return;
    closeDialogs();
    api.enterInterior(id);
  });

  // ---- objects dialog ----

  const objectList = $('#object-list');
  const objectSearch = $('#object-search');
  const objectEmpty = $('#object-empty');
  const odNone = $('#od-none');
  const odItem = $('#od-item');
  const odName = $('#od-name');
  const odDesc = $('#od-desc');
  const odTags = $('#od-tags');
  const odMetrics = $('#od-metrics');
  const odRoom = $('#od-room');
  let selectedType = null;

  // returns the placed instance, or null when there is no room to place it in
  function placeType(type) {
    const room = api.interiorRoom();
    const inst = room ? api.placeObjectType(type.id) : null;
    if (!inst) {
      toast("Enter a building's indoor space first — click a building on the map.");
      return null;
    }
    toast(`${inst.name} placed in the room.`);
    return inst;
  }

  function syncObjectRoom() {
    const room = api.interiorRoom();
    if (!room) {
      odRoom.textContent = 'You are out in town — step inside a building first and this will be placed there.';
      return;
    }
    const def = world.buildings.find((b) => b.id === room.id);
    odRoom.textContent =
      `Placing into ${def?.name ?? room.id} · ${room.objectIds.length} object${room.objectIds.length === 1 ? '' : 's'} in the room.`;
  }

  function selectObjectType(t) {
    selectedType = t;
    odNone.classList.add('hidden');
    odItem.classList.remove('hidden');
    odName.textContent = t.name;
    odDesc.textContent = t.desc;
    odTags.textContent = `Search tags: ${t.tags}`;
    const measured = objectMetrics(t.parts, 1);
    const radius = t.radius ?? measured.radius;
    odMetrics.textContent =
      `${t.parts.length} part${t.parts.length === 1 ? '' : 's'} · ` +
      `${(radius * 2).toFixed(2)} wide · ${measured.height.toFixed(2)} tall`;
    syncObjectRoom();
    markRow(objectList, t.id);
  }

  function hideObjectTypeDetail() {
    selectedType = null;
    odItem.classList.add('hidden');
    odNone.classList.remove('hidden');
    markRow(objectList, null);
  }

  function renderObjectGallery() {
    const q = objectSearch.value.trim().toLowerCase();
    const rows = [];
    for (const t of OBJECT_TYPES) {
      if (q && !`${t.name} ${t.desc} ${t.tags} ${t.id}`.toLowerCase().includes(q)) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'building-row';
      row.title = t.desc;
      row.dataset.id = t.id;
      if (selectedType && t.id === selectedType.id) row.classList.add('selected');

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = t.color;

      const text = document.createElement('span');
      text.className = 'br-text';
      const name = document.createElement('span');
      name.className = 'br-name';
      name.textContent = t.name;
      const desc = document.createElement('span');
      desc.className = 'br-desc muted';
      desc.textContent = t.desc;
      text.append(name, desc);

      row.append(dot, text);
      row.addEventListener('click', () => selectObjectType(t));
      rows.push(row);
    }
    objectList.replaceChildren(...rows);
    objectEmpty.classList.toggle('hidden', rows.length > 0);
  }
  objectSearch.addEventListener('input', renderObjectGallery);

  // a refusal leaves the library open so the message is read in context; a placement swaps it for
  // the selected-object dialog, which main.js has already opened by the time this returns
  $('#od-place').addEventListener('click', () => {
    if (!selectedType) return;
    if (placeType(selectedType)) hideNavDialogs();
  });

  const obName = $('#ob-name');
  const obMeta = $('#ob-meta');
  const obPos = $('#ob-pos');
  const obSize = $('#ob-size');
  const obSizeVal = $('#ob-size-val');
  const obColor = $('#ob-color');
  const obMaterial = $('#ob-material');
  const obShape = $('#ob-shape');
  let obId = null;
  let viewBeforeObject = null;

  function option(value) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = value;
    return o;
  }

  obSize.min = String(OBJ_SCALE_MIN);
  obSize.max = String(OBJ_SCALE_MAX);
  obMaterial.replaceChildren(...MATERIALS.map(option));
  obShape.replaceChildren(...SHAPES.map(option));
  obSize.addEventListener('input', () => {
    obSizeVal.textContent = Number(obSize.value || 0).toFixed(2);
  });

  function syncObjectPos(inst) {
    obPos.textContent =
      `Position (${inst.pos[0].toFixed(2)}, ${inst.pos[1].toFixed(2)}) · ` +
      `facing ${Math.round(((inst.rot || 0) * 180) / Math.PI)}°`;
  }

  // The controls are refilled from the instance on every selection change and after every save, so
  // they can never drift from what is actually standing in the room.
  function fillObjectPanel(inst) {
    obId = inst.id;
    const attrs = effectiveAttrs(inst);
    const { radius, height } = objectMetrics(resolveParts(inst), inst.scale ?? 1);
    obName.textContent = inst.name;
    const origin = inst.source === 'ai' ? 'AI design' : `type ${inst.typeId}`;
    obMeta.textContent =
      `${origin} · ${inst.parts.length} part${inst.parts.length === 1 ? '' : 's'} · ` +
      `${(radius * 2).toFixed(2)} wide · ${height.toFixed(2)} tall`;
    syncObjectPos(inst);
    obSize.value = String(inst.scale ?? 1);
    obSizeVal.textContent = (inst.scale ?? 1).toFixed(2);
    obColor.value = attrs.color;
    obMaterial.value = attrs.material;
    obShape.value = attrs.shape;
  }

  function showObjectPanel(inst) {
    if (obId !== inst.id && currentDialog !== 'object') viewBeforeObject = currentDialog;
    fillObjectPanel(inst);
    objectPanel.classList.remove('hidden');
    currentDialog = 'object';
  }

  // hides only: reopening the library is the remover's business, so an Esc or a click on empty
  // floor never pops a dialog back up over the room
  function hideObjectPanel() {
    obId = null;
    objectPanel.classList.add('hidden');
    if (currentDialog === 'object') currentDialog = null;
  }

  // Nothing is written to the instance until Save: the drag moves it live, adjustments do not.
  $('#ob-save').addEventListener('click', () => {
    if (!obId) return;
    const inst = api.updateObject(obId, {
      scale: Number(obSize.value),
      color: obColor.value,
      material: obMaterial.value,
      shape: obShape.value,
    });
    if (!inst) {
      toast('That object is no longer in this room.');
      return;
    }
    fillObjectPanel(inst);
    toast(`${inst.name} updated.`);
  });

  $('#ob-remove').addEventListener('click', () => {
    const id = obId;
    if (!id) return;
    const name = obName.textContent;
    if (!api.removeObject(id)) return;
    toast(`${name} removed.`);
    if (dialogs[viewBeforeObject]) openDialog(viewBeforeObject);
  });

  $('#ob-derive').addEventListener('click', () => {
    const inst = api.selectedObject();
    if (!inst) return;
    // the AI panel sits below this backdrop, so the dialog steps aside for the conversation
    objectPanel.classList.add('hidden');
    chat.openWithObject(inst);
  });

  // ---- map expansion ----

  const expandBtn = $('#expand-map');
  const expandLabel = $('#expand-map-label');
  function syncExpand() {
    const next = EXPANSIONS[world.expansionIndex];
    expandBtn.disabled = !next;
    expandLabel.textContent = next ? `Expand · ${next.name}` : 'Map fully expanded';
  }
  expandBtn.addEventListener('click', () => {
    const r = api.expandMap();
    if (!r) return;
    syncExpand();
    api.flyToPoint(r.sector.offset[0], r.sector.offset[1]);
    toast(`${r.sector.name} connected — ${r.added} new buildings`);
  });

  // ---- placement mode ----

  const placeBtn = $('#nav-place');
  const banner = $('#place-banner');
  const bannerText = $('#place-banner-text');
  placeBtn.addEventListener('click', () => api.setPlacing(!api.isPlacing()));
  $('#place-cancel').addEventListener('click', () => api.setPlacing(false));

  function setPlacingState(on) {
    placeBtn.classList.toggle('active', on);
    placeBtn.setAttribute('aria-pressed', String(on));
  }
  function setPlaceBanner(text, ok) {
    bannerText.textContent = text;
    banner.classList.toggle('bad', !ok);
    banner.classList.remove('hidden');
  }
  function hidePlaceBanner() {
    banner.classList.add('hidden');
  }

  // ---- indoor spaces ----

  const minimapCard = $('#minimap-card');
  const compassEl = $('#compass');
  const townStatus = $('#town-status');
  const interiorBar = $('#interior-bar');
  const interiorName = $('#interior-name');
  const interiorType = $('#interior-type');
  const povBar = $('#pov-bar');
  const povRobot = $('#pov-robot');
  const povLocation = $('#pov-location');
  let povActive = false;

  function setMode(next, def) {
    const inside = next === 'interior';
    minimapCard.classList.toggle('hidden', inside || povActive);
    compassEl.classList.toggle('hidden', inside || povActive);
    interiorBar.classList.toggle('hidden', !inside || povActive);
    townStatus.textContent = inside && def ? `Inside ${def.name}` : 'All systems operational';
    if (!inside || !def) return;
    interiorName.textContent = def.name;
    interiorType.textContent = def.type;
    interiorType.style.background = TYPE_COLORS[def.type] || '#59e3ff';
    interiorType.style.color = '#08182a';
  }

  $('#interior-back').addEventListener('click', () => api.exitInterior());

  function setPov(robot, indoors = false) {
    povActive = !!robot;
    povBar.classList.toggle('hidden', !povActive);
    if (!robot) return;
    povRobot.textContent = robot.name;
    povLocation.textContent = indoors ? `inside ${robot.homeName}` : 'on the streets';
    minimapCard.classList.add('hidden');
    compassEl.classList.add('hidden');
    interiorBar.classList.add('hidden');
  }

  $('#pov-exit').addEventListener('click', () => api.exitRobotPov());

  const spacePrompt = $('#space-prompt');
  const spText = $('#sp-text');
  let promptId = null;

  function showSpacePrompt(def) {
    const env = roomEnvelope(def);
    promptId = def.id;
    spText.textContent =
      `${def.name} has no indoor space yet. Generate one from its attributes — a ${env.w}×${env.d} room ` +
      `with ${env.wallH}-unit walls, furnished for a ${def.type} — or describe the space you want and let the AI design it.`;
    spacePrompt.classList.remove('hidden');
  }

  function hideSpacePrompt() {
    spacePrompt.classList.add('hidden');
    promptId = null;
  }

  $('#sp-default').addEventListener('click', () => {
    const id = promptId;
    hideSpacePrompt();
    if (id) api.generateDefaultSpace(id);
  });
  $('#sp-ai').addEventListener('click', () => {
    const id = promptId;
    hideSpacePrompt();
    const def = id ? world.buildings.find((b) => b.id === id) : null;
    if (def) chat.openWithSpace(def);
  });
  $('#sp-cancel').addEventListener('click', hideSpacePrompt);

  // ---- minimap ----

  const canvas = $('#minimap');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const staticLayer = document.createElement('canvas');
  staticLayer.width = W;
  staticLayer.height = H;
  const sctx = staticLayer.getContext('2d');

  // reassigned by redrawStatic() whenever the world bounds change
  let mx = (x) => x;
  let mz = (z) => z;

  function redrawStatic() {
    const b = bounds();
    const S = Math.min(W / (b.maxX - b.minX), H / (b.maxZ - b.minZ)) * 0.92;
    const cx = W / 2 - ((b.minX + b.maxX) / 2) * S;
    const cy = H / 2 - ((b.minZ + b.maxZ) / 2) * S;
    mx = (x) => cx + x * S;
    mz = (z) => cy + z * S;

    sctx.clearRect(0, 0, W, H);
    sctx.fillStyle = '#081826';
    sctx.fillRect(0, 0, W, H);

    sctx.lineWidth = 1;
    for (const s of world.sectors) {
      sctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = sectorRadiusAt(a, s);
        const px = mx(s.offset[0] + Math.cos(a) * r);
        const py = mz(s.offset[1] + Math.sin(a) * r);
        if (i === 0) sctx.moveTo(px, py);
        else sctx.lineTo(px, py);
      }
      sctx.closePath();
      sctx.fillStyle = '#2e7d4f';
      sctx.fill();
      sctx.setLineDash([4, 3]);
      sctx.strokeStyle = '#58d08f';
      sctx.stroke();
      sctx.setLineDash([]);
    }

    // the registered road corridors are the road network, so the minimap can draw
    // them without a second copy of the geometry
    sctx.strokeStyle = 'rgba(255,255,255,0.3)';
    sctx.lineWidth = 2;
    for (const c of world.obstacles.circles) {
      sctx.beginPath();
      sctx.arc(mx(c.x), mz(c.z), Math.max(1, (c.r - 3) * S), 0, Math.PI * 2);
      sctx.stroke();
    }
    for (const r of world.obstacles.rings) {
      sctx.beginPath();
      sctx.arc(mx(r.x), mz(r.z), Math.max(1, r.r * S), 0, Math.PI * 2);
      sctx.stroke();
    }
    sctx.lineWidth = 1.6;
    for (const s of world.obstacles.segments) {
      sctx.beginPath();
      sctx.moveTo(mx(s.ax), mz(s.az));
      sctx.lineTo(mx(s.bx), mz(s.bz));
      sctx.stroke();
    }

    sctx.fillStyle = '#7fd0ff';
    for (const bd of world.buildings) {
      sctx.beginPath();
      sctx.arc(mx(bd.pos[0]), mz(bd.pos[1]), 2.4, 0, Math.PI * 2);
      sctx.fill();
    }
  }

  function drawMinimap(cam) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(staticLayer, 0, 0);
    const px = mx(cam.x);
    const py = mz(cam.z);
    const ang = Math.atan2(cam.dz, cam.dx);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(ang - 0.45) * 16, py + Math.sin(ang - 0.45) * 16);
    ctx.lineTo(px + Math.cos(ang + 0.45) * 16, py + Math.sin(ang + 0.45) * 16);
    ctx.closePath();
    ctx.fillStyle = 'rgba(127,208,255,0.35)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // ---- misc widgets ----

  $('#zoom-in').addEventListener('click', () => api.zoomBy(0.8));
  $('#zoom-out').addEventListener('click', () => api.zoomBy(1.25));
  $('#opt-shadows').addEventListener('change', (e) => api.setShadows(e.target.checked));
  $('#opt-rotate').addEventListener('change', (e) => api.setAutoRotate(e.target.checked));

  const tip = $('#tooltip');
  const showTooltip = (text) => { tip.textContent = text; tip.classList.remove('hidden'); };
  const hideTooltip = () => tip.classList.add('hidden');
  const moveTooltip = (x, y) => { tip.style.left = `${x}px`; tip.style.top = `${y}px`; };

  const needle = $('#needle');
  const setCompass = (az) => { needle.style.transform = `rotate(${((az * 180) / Math.PI).toFixed(1)}deg)`; };

  const store = createStore();
  const fnStore = createFunctionStore();
  initModelConfig({ store, toast });
  const fns = initFunctions({ fnStore, toast });
  $('#fn-open').addEventListener('click', fns.open);

  // ---- robot page ----

  const robotsUi = initRobots({ api, toast });
  const robotStat = $('#stat-robots');
  const robotsSummary = $('#robots-summary');
  $('#robots-open').addEventListener('click', () => openDialog('robots'));

  function syncRobots() {
    const all = api.robots();
    const deployed = all.filter((r) => r.source !== 'seed').length;
    robotStat.textContent = `${all.length} robot${all.length === 1 ? '' : 's'}`;
    robotsSummary.textContent =
      `${all.length} in town · ${deployed} deployed by you · ${ROBOT_TYPES.length} models`;
  }

  // ---- town overview ----

  const statArea = $('#stat-area');
  const statSectors = $('#stat-sectors');
  const statSpaces = $('#stat-spaces');
  const statObjects = $('#stat-objects');
  const statModels = $('#stat-models');
  const statDeployed = $('#stat-deployed');

  // population and buildings are left to syncRobots()/renderGallery(), which have always owned them
  function syncTown() {
    const b = bounds();
    const spaces = Object.values(world.spaces);
    statArea.textContent = `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxZ - b.minZ)} units`;
    statSectors.textContent = String(world.sectors.length);
    statSpaces.textContent = String(spaces.length);
    statObjects.textContent = String(spaces.reduce((n, s) => n + s.objects.length, 0));
    statModels.textContent = String(ROBOT_TYPES.length);
    statDeployed.textContent = String(api.robots().filter((r) => r.source !== 'seed').length);
  }

  viewBtns.forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));

  const chat = initAiChat({ store, toast, fnStore, openSettings: () => showView('settings'), api });

  renderGallery();
  renderObjectGallery();
  redrawStatic();
  syncExpand();
  syncRobots();
  syncTown();
  subscribe(() => {
    renderGallery();
    redrawStatic();
    syncRobots();
    syncTown();
  });

  return {
    showTooltip,
    hideTooltip,
    moveTooltip,
    setCompass,
    drawMinimap,
    toast,
    showView,
    isDialogOpen,
    closeDialogs,
    setPlacingState,
    setPlaceBanner,
    hidePlaceBanner,
    setMode,
    setPov,
    showSpacePrompt,
    hideSpacePrompt,
    isFunctionsOpen: fns.isOpen,
    hideFunctionsPanel: fns.close,
    isRobotsOpen: robotsUi.isOpen,
    hideRobotsPanel: robotsUi.close,
    openRobot: robotsUi.openRobot,
    showObjectPanel,
    hideObjectPanel,
    syncObjectPos,
    openAiForSite: chat.openWithSite,
    openAiForSpace: chat.openWithSpace,
    openAiForObject: chat.openWithObject,
  };
}
