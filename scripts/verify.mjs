import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OBJECT_TYPES } from '../src/town/objects.js';
import { ROBOT_TYPES } from '../src/town/robots.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = path.join(root, 'shots');
mkdirSync(shots, { recursive: true });

const dev = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'pipe' });
const mock = spawn('node', ['scripts/mock-provider.mjs'], { cwd: root, stdio: 'pipe' });

// A leftover server from an earlier crashed run answers the readiness probes below, so the
// suite would silently drive against the wrong process. Watch our own children for early exit.
const died = [];
for (const [child, label] of [[dev, 'vite'], [mock, 'mock provider']]) {
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.on('exit', (code) => { if (code) died.push(`${label} exited ${code}: ${err.trim().split('\n').slice(0, 6).join(' | ')}`); });
}

function bail(msg) {
  console.error(msg);
  if (died.length) console.error(died.join('\n'));
  mock.kill();
  dev.kill();
  process.exit(1);
}

// an uncaught Playwright error skips the kill calls at the bottom, leaving the ports squatted
process.on('exit', () => { mock.kill(); dev.kill(); });

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (died.length) break;
  try { up = (await fetch('http://localhost:5173')).ok; } catch { /* retry */ }
}
if (!up) bail('vite did not start');

let mockUp = false;
for (let i = 0; i < 40 && !mockUp; i++) {
  await new Promise((r) => setTimeout(r, 250));
  if (died.length) break;
  try {
    mockUp =
      (await fetch('http://127.0.0.1:5199/__stats')).ok &&
      (await fetch('http://127.0.0.1:5198/__stats')).ok;
  } catch { /* retry */ }
}
if (!mockUp) bail('mock provider did not start (are 5198/5199 already in use?)');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// The nav dialogs are modal backdrops covering everything but #brand-panel, so any click into the
// AI panel needs them out of the way first. #fn-panel sits above them (z 24), hence the order.
async function closeDialogs() {
  const pairs = [
    ['#fn-panel', '#fn-close'],
    ['#robot-panel', '#rb-close'],
    ['#town-panel', '#tw-close'],
    ['#buildings-panel', '#bd-close'],
    ['#objects-panel', '#od-close'],
    ['#settings-panel', '#st-close'],
  ];
  for (const [dlg, btn] of pairs) {
    if (!(await page.isHidden(dlg))) await page.click(btn);
  }
  // by class, not #ob-close: that button also drops the selection the drag flows assert on
  await page.evaluate(() => document.querySelector('#object-panel').classList.add('hidden'));
}

async function aiOpen() {
  await closeDialogs();
  if (await page.isHidden('#ai-panel')) await page.click('#nav-ai');
}

await page.goto('http://localhost:5173');
await page.waitForFunction(() => window.__robotTown && window.__robotTown.ready, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(shots, '1-overview.png') });

const p = await page.evaluate(() => window.__robotTown.screenPos('city-hall'));
await page.mouse.move(p.x, p.y);
await page.waitForTimeout(500);
const tipVisible = await page.evaluate(() => !document.querySelector('#tooltip').classList.contains('hidden'));
const tip = (await page.textContent('#tooltip')).trim();
console.log('TOOLTIP:', JSON.stringify(tip), 'visible:', tipVisible);
await page.screenshot({ path: path.join(shots, '2-hover.png') });

await page.click('[data-view="buildings"]');
await page.waitForTimeout(300);
await page.locator('#building-list .building-row').first().click();
await page.waitForTimeout(150);
// the row selects into the detail column now; #bd-fly is what closes the dialog and flies
const flyDetail = await page.evaluate(() => ({
  name: document.querySelector('#bd-name').textContent.trim(),
  itemShown: !document.querySelector('#bd-item').classList.contains('hidden'),
  noneHidden: document.querySelector('#bd-none').classList.contains('hidden'),
}));
console.log('FLYTO_DETAIL:', JSON.stringify(flyDetail));
await page.click('#bd-fly');
await page.waitForTimeout(1700);
await page.screenshot({ path: path.join(shots, '3-flyto.png') });

const before = await page.evaluate(() => window.__robotTown.cameraPose());
await page.mouse.move(800, 500);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(500);
await page.mouse.down();
await page.mouse.move(1100, 480, { steps: 12 });
await page.mouse.up();
await page.mouse.down({ button: 'right' });
await page.mouse.move(900, 640, { steps: 12 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(500);
const after = await page.evaluate(() => window.__robotTown.cameraPose());
const moved = JSON.stringify(before) !== JSON.stringify(after);
console.log('CAMERA_MOVED:', moved);
await page.screenshot({ path: path.join(shots, '4-explore.png') });
const townErrors = errors.slice();

// ---------- AI assistant flow against the mock provider (no real keys) ----------
await page.click('[data-view="buildings"]');
const settingsClickable = await page.evaluate(() => {
  const b = document.querySelector('[data-view="settings"]');
  const r = b.getBoundingClientRect();
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
});
console.log('SETTINGS_CLICKABLE:', settingsClickable);

await page.click('[data-view="settings"]');
await page.click('#provider-add');
const saveDisabledEmpty = await page.isDisabled('#pf-save');
const testDisabledEmpty = await page.isDisabled('#pf-test');
await page.fill('#pf-name', 'Mock CORS');
await page.fill('#pf-base-url', 'http://127.0.0.1:5199/v1/');
await page.fill('#pf-api-key', 'mock-key-ok');
const saveEnabledFilled = await page.isEnabled('#pf-save');
const testDisabledBeforeSave = await page.isDisabled('#pf-test');
console.log('GATING:', JSON.stringify({ saveDisabledEmpty, testDisabledEmpty, saveEnabledFilled, testDisabledBeforeSave }));

await page.click('#pf-save');
const testEnabledAfterSave = await page.isEnabled('#pf-test');
await page.click('#pf-test');
await page.waitForSelector('#pf-status.ok', { timeout: 10000 });
const statusText = (await page.textContent('#pf-status')).trim();
console.log('TEST_STATUS:', JSON.stringify(statusText));
await page.waitForFunction(() => !document.querySelector('#pf-model').disabled, null, { timeout: 5000 });
const modelOptions = await page.$$eval('#pf-model option', (os) => os.map((o) => o.value));
await page.selectOption('#pf-model', 'mock-mini');

await page.fill('#pf-model-filter', 'reason');
const filtered = await page.$$eval('#pf-model option', (os) => os.map((o) => o.value));
const filteredValue = await page.$eval('#pf-model', (s) => s.value);
await page.fill('#pf-model-filter', '');
const unfilteredValue = await page.$eval('#pf-model', (s) => s.value);
console.log('FILTER:', JSON.stringify({ filtered, filteredValue, unfilteredValue }));

await page.fill('#pf-name', 'Mock CORS2');
const testDisabledDirty = await page.isDisabled('#pf-test');
const modelDisabledDirty = await page.isDisabled('#pf-model');
await page.fill('#pf-name', 'Mock CORS');
const testEnabledClean = await page.isEnabled('#pf-test');
await page.click('#pf-cancel');
console.log('DIRTY_GATE:', JSON.stringify({ testDisabledDirty, modelDisabledDirty, testEnabledClean }));
await page.screenshot({ path: path.join(shots, '6-model-config.png') });

await aiOpen();
const panelVisible = await page.isVisible('#ai-panel');
const modelLabel = (await page.textContent('#ai-model-label')).trim();
await page.fill('#ai-input', 'hello town');
await page.click('#ai-send');
await page.waitForSelector('#ai-messages .ai-msg.assistant', { timeout: 15000 });
const reply = (await page.$$eval('#ai-messages .ai-msg-body', (ns) => ns[ns.length - 1].textContent)).trim();
console.log('CHAT_REPLY:', JSON.stringify(reply), 'label:', JSON.stringify(modelLabel));
await page.screenshot({ path: path.join(shots, '5-ai-chat.png') });

await page.click('#ai-collapse');
const collapsedHeight = await page.$eval('#ai-panel', (p) => p.getBoundingClientRect().height);
await page.click('#ai-collapse');
const historyKept = await page.$$eval('#ai-messages .ai-msg', (ns) => ns.length);
console.log('COLLAPSE:', Math.round(collapsedHeight), 'messages after expand:', historyKept);

const geom = [];
for (const height of [1000, 800]) {
  await page.setViewportSize({ width: 1600, height });
  await page.waitForTimeout(150);
  geom.push(await page.evaluate(() => {
    const ai = document.querySelector('#ai-panel').getBoundingClientRect();
    const mm = document.querySelector('#minimap-card').getBoundingClientRect();
    return { aiTop: Math.round(ai.top), aiBottom: Math.round(ai.bottom), mmTop: Math.round(mm.top) };
  }));
}
await page.setViewportSize({ width: 1600, height: 1000 });
console.log('GEOMETRY:', JSON.stringify(geom));

await page.click('[data-view="settings"]');
await page.click('#provider-add');
await page.fill('#pf-name', 'Bad Key');
await page.fill('#pf-base-url', 'http://127.0.0.1:5199/v1');
await page.fill('#pf-api-key', 'nope');
await page.click('#pf-save');
await page.click('#pf-test');
await page.waitForSelector('#pf-status.err', { timeout: 10000 });
const errText = (await page.textContent('#pf-status')).trim();
console.log('BAD_KEY:', JSON.stringify(errText));
await page.click('#provider-list .prov-row:last-child .prov-del');
const rowCount = await page.$$eval('#provider-list .prov-row', (rs) => rs.length);

await page.click('#provider-add');
await page.fill('#pf-name', 'Mock Proxy');
await page.fill('#pf-base-url', 'http://127.0.0.1:5198/v1');
await page.fill('#pf-api-key', 'mock-key-ok');
await page.click('#pf-save');
await page.click('#pf-test');
await page.waitForSelector('#pf-status.ok', { timeout: 10000 });
const proxyStatus = (await page.textContent('#pf-status')).trim();
await page.selectOption('#pf-model', 'mock-mini');
await page.click('#pf-cancel');
await aiOpen();
await page.fill('#ai-input', 'via proxy');
await page.click('#ai-send');
await page.waitForFunction(
  () => document.querySelectorAll('#ai-messages .ai-msg.assistant').length >= 2,
  null,
  { timeout: 15000 });
const stats = await (await fetch('http://127.0.0.1:5199/__stats')).json();
console.log('PROXY:', JSON.stringify(proxyStatus), 'rows after delete:', rowCount, 'stats:', JSON.stringify(stats));

await page.reload();
await page.waitForFunction(() => window.__robotTown && window.__robotTown.ready, null, { timeout: 30000 });
const persisted = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('robotTown.ai.v1'));
  const good = s.providers.find((p) => p.name === 'Mock CORS');
  return { count: s.providers.length, status: good.status, model: good.model, key: good.apiKey };
});
await page.click('[data-view="settings"]');
const badge = (await page.textContent('#provider-list .prov-row .badge')).trim();
await page.click('#nav-ai');
const labelAfterReload = (await page.textContent('#ai-model-label')).trim();
console.log('PERSIST:', JSON.stringify(persisted), 'badge:', badge, 'label:', labelAfterReload);

const aiOk =
  settingsClickable &&
  saveDisabledEmpty && testDisabledEmpty && saveEnabledFilled && testDisabledBeforeSave &&
  testEnabledAfterSave && /3 models/.test(statusText) && /direct/.test(statusText) &&
  modelOptions.includes('mock-mini') &&
  JSON.stringify(filtered) === JSON.stringify(['mock-mini', 'mock-reasoning']) &&
  filteredValue === 'mock-mini' && unfilteredValue === 'mock-mini' &&
  testDisabledDirty && modelDisabledDirty && testEnabledClean &&
  panelVisible && modelLabel === 'mock-mini · Mock CORS' &&
  reply === 'Echo: hello town\nmodel=mock-mini\nmsgs=2' &&
  collapsedHeight < 60 && historyKept === 2 &&
  geom.every((g) => g.aiBottom <= g.mmTop - 8 && g.aiTop >= 100) &&
  /401/.test(errText) && rowCount === 1 && /dev proxy/.test(proxyStatus) &&
  stats.plain.models >= 1 && stats.plain.chat >= 1 && stats.cors.chat >= 1 &&
  persisted.count === 2 && persisted.status === 'ok' && persisted.model === 'mock-mini' &&
  persisted.key === 'mock-key-ok' && badge === 'Ready' && labelAfterReload === 'mock-mini · Mock Proxy';
console.log('AI_OK:', aiOk);
const aiPhaseEnd = errors.length;

// ---------- gallery ----------
await page.click('[data-view="buildings"]');
await page.waitForTimeout(250);
const gallery = await page.evaluate(() => ({
  rows: document.querySelectorAll('#building-list .building-row').length,
  withText: [...document.querySelectorAll('#building-list .br-desc')].filter((n) => n.textContent.trim().length > 8).length,
  dotted: [...document.querySelectorAll('#building-list .dot')].filter((n) => n.style.background).length,
  stat: document.querySelector('#stat-buildings').textContent,
}));

await page.fill('#building-search', 'cafe');
await page.waitForTimeout(150);
const cafeRows = await page.$$eval('#building-list .br-name', (ns) => ns.map((n) => n.textContent));
// searching a description, not a name, proves desc is in the index
await page.fill('#building-search', 'colonnade');
await page.waitForTimeout(150);
const descHit = await page.$$eval('#building-list .br-name', (ns) => ns.map((n) => n.textContent));
await page.fill('#building-search', 'zzz');
await page.waitForTimeout(150);
const emptyShown = await page.isVisible('#building-empty');
const zzzRows = await page.$$eval('#building-list .building-row', (ns) => ns.length);
await page.fill('#building-search', '');
await page.waitForTimeout(150);
const clearedRows = await page.$$eval('#building-list .building-row', (ns) => ns.length);
await page.screenshot({ path: path.join(shots, '7-gallery.png') });
console.log('GALLERY:', JSON.stringify({ ...gallery, cafeRows, descHit, emptyShown, zzzRows, clearedRows }));

// ---------- map expansion ----------
// the AI panel would sit over the minimap card once it grows, so close it first
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
await page.click('[data-view="map"]');
await page.waitForTimeout(200);

const coreBounds = await page.evaluate(() => window.__robotTown.bounds());
const expandLabel0 = (await page.textContent('#expand-map-label')).trim();
await page.click('#expand-map');
await page.waitForTimeout(400);
const toastText = (await page.textContent('#toast')).trim();
await page.waitForTimeout(900);
const afterFirst = await page.evaluate(() => ({
  sectors: window.__robotTown.sectors().length,
  buildings: window.__robotTown.buildings().length,
  connected: window.__robotTown.roadConnected('g4', 's:east-quay:in'),
  reach: window.__robotTown.reach(),
  bounds: window.__robotTown.bounds(),
}));

// the old clamp pulled controls.target back to r <= 110 every frame, so a target
// beyond it only survives if reach() really is driving the clamp now
await page.evaluate(() => window.__robotTown.flyToPoint(148, 0));
await page.waitForTimeout(1800);
const pose = await page.evaluate(() => window.__robotTown.cameraPose());
const targetMag = Math.hypot(pose.t[0], pose.t[2]);
await page.screenshot({ path: path.join(shots, '8-expansion.png') });

for (let i = 0; i < 3; i++) {
  await page.click('#expand-map');
  await page.waitForTimeout(900);
}
const expandDone = await page.evaluate(() => ({
  disabled: document.querySelector('#expand-map').disabled,
  label: document.querySelector('#expand-map-label').textContent.trim(),
  sectors: window.__robotTown.sectors().length,
  buildings: window.__robotTown.buildings().length,
  links: [
    ['g4', 's:east-quay:in'],
    ['g8', 's:north-ridge:in'],
    ['g12', 's:west-marina:in'],
    ['g2', 's:sunset-heights:in'],
    ['b:quay-depot', 'r0'],
    ['b:heights-homes', 'g0'],
    ['b:marina-hall', 'br0'],
    ['b:ridge-green', 'g8'],
  ].map(([a, b]) => window.__robotTown.roadConnected(a, b)),
}));
console.log('EXPAND:', JSON.stringify({ expandLabel0, toastText, afterFirst, targetMag: Math.round(targetMag), expandDone }));

// ---------- placement mode ----------
await page.click('#nav-place');
await page.waitForTimeout(250);
const bannerVisible = await page.isVisible('#place-banner');
const placeActive = await page.$eval('#nav-place', (b) => b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true');

await page.evaluate(() => window.__robotTown.flyTo('hospital'));
await page.waitForTimeout(1800);
const hp = await page.evaluate(() => window.__robotTown.screenPos('hospital', 0));
await page.mouse.move(hp.x, hp.y);
await page.waitForTimeout(400);
const overBuilding = await page.evaluate(() => ({
  text: document.querySelector('#place-banner-text').textContent,
  bad: document.querySelector('#place-banner').classList.contains('bad'),
}));

const freeSpot = await page.evaluate(() => {
  for (let r = 92; r >= 68; r -= 4) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const c = window.__robotTown.siteCheck(x, z, 8);
      if (c.ok && c.clearance >= 10) return { x, z };
    }
  }
  return null;
});
await page.evaluate((s) => window.__robotTown.flyToPoint(s.x, s.z), freeSpot);
await page.waitForTimeout(1800);
const fp = await page.evaluate((s) => window.__robotTown.screenPoint(s.x, s.z, 0), freeSpot);
await page.mouse.move(fp.x, fp.y);
await page.waitForTimeout(400);
const freeBanner = await page.evaluate(() => ({
  text: document.querySelector('#place-banner-text').textContent,
  bad: document.querySelector('#place-banner').classList.contains('bad'),
}));
await page.screenshot({ path: path.join(shots, '9-place-mode.png') });

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const escHidBanner = (await page.isHidden('#place-banner')) &&
  !(await page.$eval('#nav-place', (b) => b.classList.contains('active')));

await page.click('#nav-place');
await page.waitForTimeout(200);
await page.mouse.move(fp.x, fp.y);
await page.waitForTimeout(300);
await page.mouse.click(fp.x, fp.y);
await page.waitForTimeout(600);
const picked = await page.evaluate(() => ({
  site: window.__robotTown.pendingSite(),
  aiOpen: !document.querySelector('#ai-panel').classList.contains('hidden'),
  collapsed: document.querySelector('#ai-panel').classList.contains('collapsed'),
  input: document.querySelector('#ai-input').value,
  bubble: document.querySelector('#ai-messages .ai-msg:last-child .ai-msg-body').textContent,
  bannerHidden: document.querySelector('#place-banner').classList.contains('hidden'),
}));
console.log('PLACE:', JSON.stringify({ bannerVisible, placeActive, overBuilding, freeSpot, freeBanner, escHidBanner, picked }));

// ---------- /building tool flow ----------
const pickedSite = picked.site;

await page.fill('#ai-input', '/building a tall glass spire');
await page.click('#ai-send');
await page.waitForFunction(() => document.querySelectorAll('#ai-messages .ai-msg.review').length >= 1, null, { timeout: 25000 });
await page.waitForTimeout(400);
const review1 = await page.evaluate(() => window.__robotTown.review());
const card1 = await page.evaluate(() => ({
  name: document.querySelector('#ai-messages .ai-msg.review .rv-name').textContent,
  meta: document.querySelector('#ai-messages .ai-msg.review .rv-meta').textContent,
  buildings: window.__robotTown.buildings().length,
}));
await page.screenshot({ path: path.join(shots, '10-review.png') });

await page.click('#ai-messages .ai-msg.review .btn-ghost');
await page.waitForTimeout(700);
const afterDiscard = await page.evaluate(() => ({
  review: window.__robotTown.review(),
  buildings: window.__robotTown.buildings().length,
  note: document.querySelector('#ai-messages .ai-msg.review .rv-note').textContent,
  disabled: document.querySelector('#ai-messages .ai-msg.review .btn-primary').disabled,
}));

await page.fill('#ai-input', '/building a tall glass spire');
await page.click('#ai-send');
await page.waitForFunction(() => document.querySelectorAll('#ai-messages .ai-msg.review').length >= 2, null, { timeout: 25000 });
await page.waitForTimeout(300);
const review2 = await page.evaluate(() => window.__robotTown.review());
await page.locator('#ai-messages .ai-msg.review').nth(1).locator('.btn-primary').click();
await page.waitForTimeout(900);
const afterConfirm = await page.evaluate((id) => ({
  review: window.__robotTown.review(),
  buildings: window.__robotTown.buildings().length,
  names: window.__robotTown.buildings().map((b) => b.name),
  graphLeaf: window.__robotTown.roadConnected(`b:${id}`, 'r0'),
  drivewayNode: window.__robotTown.nearestGraphNode(
    ...window.__robotTown.buildings().find((b) => b.id === id).pos),
}), review2.id);
await page.screenshot({ path: path.join(shots, '11-confirmed.png') });

await page.click('[data-view="buildings"]');
await page.waitForTimeout(200);
await page.fill('#building-search', 'glass spire');
await page.waitForTimeout(200);
const galleryFound = await page.$$eval('#building-list .br-name', (ns) => ns.map((n) => n.textContent));
const galleryStat = await page.textContent('#stat-buildings');
await page.fill('#building-search', '');

// JSON-fence fallback: the provider ignores `tools` and answers in text
await aiOpen();
await page.click('[data-view="map"]');
await page.fill('#ai-input', '/building [fence] a small kiosk');
await page.click('#ai-send');
await page.waitForFunction(() => document.querySelectorAll('#ai-messages .ai-msg.review').length >= 3, null, { timeout: 25000 });
await page.waitForTimeout(300);
const fenceReview = await page.evaluate(() => window.__robotTown.review());
await page.locator('#ai-messages .ai-msg.review').nth(2).locator('.btn-ghost').click();
await page.waitForTimeout(600);

// invalid spec: the validation gate must reject it and leave no review behind
const errBefore = await page.$$eval('#ai-messages .ai-msg.error', (ns) => ns.length);
await page.fill('#ai-input', '/building [invalid] a broken tower');
await page.click('#ai-send');
await page.waitForFunction((n) => document.querySelectorAll('#ai-messages .ai-msg.error').length > n, errBefore, { timeout: 25000 });
await page.waitForTimeout(300);
const invalidErr = (await page.$$eval('#ai-messages .ai-msg.error .ai-msg-body', (ns) => ns[ns.length - 1].textContent)).trim();
const reviewAfterInvalid = await page.evaluate(() => ({
  review: window.__robotTown.review(),
  buildings: window.__robotTown.buildings().length,
}));
const toolStats = await (await fetch('http://127.0.0.1:5199/__stats')).json();
const proxyToolStats = await (await fetch('http://127.0.0.1:5198/__stats')).json();
console.log('TOOLS:', JSON.stringify({
  review1, card1, afterDiscard, afterConfirm, galleryFound, galleryStat,
  fenceReview, invalidErr, reviewAfterInvalid,
  tools: toolStats.cors.tools + proxyToolStats.plain.tools,
}));

// ---------- indoor spaces ----------
// the AI panel would cover the building we are about to click; "Design with AI" reopens it
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
await page.click('[data-view="map"]');
await page.evaluate(() => window.__robotTown.flyTo('city-hall'));
await page.waitForTimeout(1800);
const townPose = await page.evaluate(() => window.__robotTown.cameraPose());
const chScreen = await page.evaluate(() => window.__robotTown.screenPos('city-hall', 0));
await page.mouse.click(chScreen.x, chScreen.y);
await page.waitForTimeout(400);
const noSpacePrompt = await page.evaluate(() => ({
  shown: !document.querySelector('#space-prompt').classList.contains('hidden'),
  text: document.querySelector('#sp-text').textContent,
  interior: window.__robotTown.interior(),
  space: window.__robotTown.space('city-hall'),
}));

await page.click('#sp-default');
await page.waitForTimeout(700);
const inside = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  space: window.__robotTown.space('city-hall'),
  promptHidden: document.querySelector('#space-prompt').classList.contains('hidden'),
  minimapHidden: document.querySelector('#minimap-card').classList.contains('hidden'),
  compassHidden: document.querySelector('#compass').classList.contains('hidden'),
  barVisible: !document.querySelector('#interior-bar').classList.contains('hidden'),
  barName: document.querySelector('#interior-name').textContent,
  barType: document.querySelector('#interior-type').textContent,
}));
const robotsA = await page.evaluate(() => window.__robotTown.robotPositions());
await page.waitForTimeout(700);
const robotsB = await page.evaluate(() => window.__robotTown.robotPositions());
const robotsMoved = robotsA.length > 0 && JSON.stringify(robotsA) !== JSON.stringify(robotsB);
await page.screenshot({ path: path.join(shots, '12-interior.png') });

await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const exited = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  minimapHidden: document.querySelector('#minimap-card').classList.contains('hidden'),
  barHidden: document.querySelector('#interior-bar').classList.contains('hidden'),
  spaceKept: window.__robotTown.space('city-hall').source,
  pose: window.__robotTown.cameraPose(),
}));
const poseRestored = ['p', 't'].every((k) =>
  exited.pose[k].every((v, i) => Math.abs(v - townPose[k][i]) < 1));

// the built scene stays cached on the space entry, so walking back in needs no rebuild
await page.mouse.click(chScreen.x, chScreen.y);
await page.waitForTimeout(500);
const reentered = await page.evaluate(() => window.__robotTown.interior());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.evaluate(() => window.__robotTown.flyTo('hospital'));
await page.waitForTimeout(1800);
const hpScreen = await page.evaluate(() => window.__robotTown.screenPos('hospital', 0));
await page.mouse.click(hpScreen.x, hpScreen.y);
await page.waitForTimeout(400);
const hpPrompt = await page.evaluate(() => ({
  shown: !document.querySelector('#space-prompt').classList.contains('hidden'),
  text: document.querySelector('#sp-text').textContent,
}));
// the room the model returns has to fit the envelope the prompt advertised for this building
const hpEnv = Number(/a ([\d.]+)×([\d.]+) room/.exec(hpPrompt.text)?.[1] ?? NaN);
await page.click('#sp-ai');
await page.waitForTimeout(400);
const aiOpened = await page.evaluate(() => ({
  panelOpen: !document.querySelector('#ai-panel').classList.contains('hidden'),
  collapsed: document.querySelector('#ai-panel').classList.contains('collapsed'),
  input: document.querySelector('#ai-input').value,
  bubble: document.querySelector('#ai-messages .ai-msg:last-child .ai-msg-body').textContent,
  promptHidden: document.querySelector('#space-prompt').classList.contains('hidden'),
  interior: window.__robotTown.interior(),
}));

await page.fill('#ai-input', '/space a calm recovery ward');
await page.click('#ai-send');
await page.waitForFunction(() => window.__robotTown.space('hospital') !== null, null, { timeout: 25000 });
await page.waitForTimeout(900);
const aiSpace = await page.evaluate(() => ({
  space: window.__robotTown.space('hospital'),
  interior: window.__robotTown.interior(),
  toast: document.querySelector('#toast').textContent,
}));
const aiBubble = (await page.$$eval(
  '#ai-messages .ai-msg.assistant .ai-msg-body',
  (ns) => ns[ns.length - 1].textContent)).trim();
await page.screenshot({ path: path.join(shots, '13-space-ai.png') });

// fence fallback: no tool call, the room arrives as a ```json block instead
await page.fill('#ai-input', '/space [fence] a bright lobby');
await page.click('#ai-send');
await page.waitForFunction(
  (n) => window.__robotTown.space('hospital')?.name !== n,
  aiSpace.space.name,
  { timeout: 25000 });
await page.waitForTimeout(800);
const fenceSpace = await page.evaluate(() => ({
  space: window.__robotTown.space('hospital'),
  interior: window.__robotTown.interior(),
}));

// invalid room: rejected by the gate, the applied room and the view are untouched
const spaceErrBefore = await page.$$eval('#ai-messages .ai-msg.error', (ns) => ns.length);
await page.fill('#ai-input', '/space [invalid] a broken hall');
await page.click('#ai-send');
await page.waitForFunction(
  (n) => document.querySelectorAll('#ai-messages .ai-msg.error').length > n,
  spaceErrBefore,
  { timeout: 25000 });
await page.waitForTimeout(300);
const spaceErr = (await page.$$eval(
  '#ai-messages .ai-msg.error .ai-msg-body',
  (ns) => ns[ns.length - 1].textContent)).trim();
const unchanged = await page.evaluate(() => ({
  name: window.__robotTown.space('hospital').name,
  interior: window.__robotTown.interior()?.id ?? null,
}));

await page.click('#interior-back');
await page.waitForTimeout(500);
const backOut = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  minimapHidden: document.querySelector('#minimap-card').classList.contains('hidden'),
  barHidden: document.querySelector('#interior-bar').classList.contains('hidden'),
}));
const spaceStats = await (await fetch('http://127.0.0.1:5198/__stats')).json();
console.log('INTERIOR:', JSON.stringify({
  noSpacePrompt, inside, robotsMoved, robotCount: robotsA.length,
  exited: { ...exited, pose: undefined }, poseRestored, reentered,
  hpPrompt, aiOpened, aiSpace, aiBubble, fenceSpace, spaceErr, unchanged, backOut,
  spaces: spaceStats.plain.spaces,
}));

// ---------- indoor objects ----------
const crateType = OBJECT_TYPES.find((t) => t.id === 'crate');

// An open panel swallows pointer events and furniture can occlude the object, so a pixel is only
// usable when the pick ray resolves to the object we aimed at AND nothing in the DOM covers it.
async function clearOverlays() {
  // #fn-panel first (it covers the robot page, whose preview canvas would otherwise answer the
  // elementFromPoint checks below), then the nav dialogs, then #object-panel by class: #ob-close
  // would drop the selection the drag flows assert on
  await closeDialogs();
  if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
  await page.waitForTimeout(250);
}

async function pickablePixel(id) {
  return page.evaluate((i) => {
    const o = window.__robotTown.objects().find((x) => x.id === i);
    if (!o) return null;
    for (const f of [0.5, 0.85, 0.2, 0.65, 0.35]) {
      const at = window.__robotTown.objectScreen(i, o.metrics.height * f);
      if (!at || !at.onScreen) continue;
      if (window.__robotTown.objectAt(at.x, at.y) !== i) continue;
      if (document.elementFromPoint(at.x, at.y)?.tagName !== 'CANVAS') continue;
      return at;
    }
    return null;
  }, id);
}

// Furniture can hide a piece from the entry angle. A drag that starts on empty floor rotates the
// camera instead of moving anything, and being a moved press it does not deselect either.
async function orbitStep() {
  const bg = await page.evaluate(() => {
    for (let y = 0.3; y <= 0.8; y += 0.1) {
      for (let x = 0.25; x <= 0.8; x += 0.1) {
        const px = Math.round(innerWidth * x);
        const py = Math.round(innerHeight * y);
        if (window.__robotTown.objectAt(px, py) !== null) continue;
        if (document.elementFromPoint(px, py)?.tagName !== 'CANVAS') continue;
        return { x: px, y: py };
      }
    }
    return null;
  });
  if (!bg) return false;
  await page.mouse.move(bg.x, bg.y);
  await page.mouse.down();
  await page.mouse.move(bg.x + 240, bg.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  return true;
}

async function pickableAfterOrbit(id, turns = 6) {
  for (let i = 0; i <= turns; i++) {
    const at = await pickablePixel(id);
    if (at) return at;
    if (!(await orbitStep())) return null;
  }
  return null;
}

async function clickObject(id) {
  await clearOverlays();
  const at = await pickablePixel(id);
  if (!at) return null;
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(350);
  return (await page.evaluate(() => window.__robotTown.selectedObject())) === id ? at : null;
}

async function selectByClick(id) {
  // the orbit probe needs a bare canvas too, not just the click that follows it
  await clearOverlays();
  if (!(await pickableAfterOrbit(id))) return null;
  return clickObject(id);
}

// Both ends of the gesture have to reach the canvas, not a panel, so overlays go first; the drop
// point comes from screenPoint() so the expected room-local position is known exactly.
async function dragObject(id) {
  await clearOverlays();
  const from = await pickableAfterOrbit(id);
  const plan = await page.evaluate((i) => {
    const o = window.__robotTown.objects().find((x) => x.id === i);
    if (!o) return null;
    const room = window.__robotTown.interior().room;
    // same margin dragTo clamps with, so the expected point is reachable
    const b = Math.max(0.5, Math.min(room.w, room.d) / 2 - o.radius - 0.2);
    for (const [dx, dz] of [[3, 3], [-3, -3], [3, -3], [-3, 3]]) {
      const tx = Math.max(-b, Math.min(b, o.pos[0] + dx));
      const tz = Math.max(-b, Math.min(b, o.pos[1] + dz));
      if (Math.hypot(tx - o.pos[0], tz - o.pos[1]) < 1) continue;
      const to = window.__robotTown.screenPoint(tx, tz, 0);
      if (!to.onScreen) continue;
      if (document.elementFromPoint(to.x, to.y)?.tagName !== 'CANVAS') continue;
      return { to, start: o.pos, expect: [tx, tz] };
    }
    return null;
  }, id);
  if (!from || !plan || ![from.x, from.y, plan.to.x, plan.to.y].every(Number.isFinite)) return null;
  const poseBefore = await page.evaluate(() => window.__robotTown.cameraPose());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(plan.to.x, plan.to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate((i) => ({
    pos: window.__robotTown.objects().find((x) => x.id === i).pos,
    groups: window.__robotTown.interior().objects,
    selected: window.__robotTown.selectedObject(),
    panelPos: document.querySelector('#ob-pos').textContent,
    pose: window.__robotTown.cameraPose(),
  }), id);
  return {
    from,
    plan,
    after,
    delta: Math.hypot(after.pos[0] - plan.start[0], after.pos[1] - plan.start[1]),
    landed: Math.abs(after.pos[0] - plan.expect[0]) < 0.2 &&
      Math.abs(after.pos[1] - plan.expect[1]) < 0.2,
    poseHeld: ['p', 't'].every((k) =>
      after.pose[k].every((v, i2) => Math.abs(v - poseBefore[k][i2]) < 0.05)),
  };
}

// A room full of furniture occludes itself, so probes walk the list instead of trusting an index,
// and orbit between passes when the current angle hides every candidate.
async function firstSelectable(ids) {
  for (let turn = 0; turn <= 6; turn++) {
    for (const id of ids) {
      if (await clickObject(id)) return id;
    }
    if (!(await orbitStep())) break;
  }
  return null;
}

if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
await page.click('[data-view="map"]');
await page.evaluate(() => window.__robotTown.flyTo('city-hall'));
await page.waitForTimeout(1800);
const chScreen2 = await page.evaluate(() => window.__robotTown.screenPos('city-hall', 0));
await page.mouse.click(chScreen2.x, chScreen2.y);
await page.waitForTimeout(800);
const objEntered = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  space: window.__robotTown.space('city-hall'),
  promptHidden: document.querySelector('#space-prompt').classList.contains('hidden'),
  objects: window.__robotTown.objects().length,
  selected: window.__robotTown.selectedObject(),
  allSpace: window.__robotTown.objects().every((o) => o.source === 'space'),
  allStanding: window.__robotTown.objects().every((o) => Number.isFinite(o.metrics.height) && o.metrics.height > 0),
}));
const FURN = objEntered.objects;

// the design furniture is not scenery: it selects, opens a panel, retints through Save and drags
const seededIds = await page.evaluate(() =>
  window.__robotTown.objects().filter((o) => o.source === 'space').map((o) => o.id));
const furnId = await firstSelectable(seededIds);
if (!furnId) bail(`no seeded furniture is clickable: ${JSON.stringify(seededIds)}`);
const furnSelected = await page.evaluate((id) => ({
  selected: window.__robotTown.selectedObject(),
  object: window.__robotTown.objects().find((x) => x.id === id),
  panelShown: !document.querySelector('#object-panel').classList.contains('hidden'),
  name: document.querySelector('#ob-name').textContent,
  meta: document.querySelector('#ob-meta').textContent,
  pos: document.querySelector('#ob-pos').textContent,
}), furnId);
// the colour goes in before the drag: dragging hides the panel, and fill() needs a visible input
await page.fill('#ob-color', '#7fd4f0');
await page.click('#ob-save');
await page.waitForTimeout(600);
const furnSaved = await page.evaluate((id) => ({
  object: window.__robotTown.objects().find((x) => x.id === id),
  groups: window.__robotTown.interior().objects,
  selected: window.__robotTown.selectedObject(),
  toast: document.querySelector('#toast').textContent,
}), furnId);
const furnDrag = await dragObject(furnId);
if (!furnDrag) bail(`seeded furniture could not be dragged: ${furnId}`);

// the type gallery: every library type, searchable by tag, with an empty state
await page.click('[data-view="objects"]');
await page.waitForTimeout(300);
const objGallery = await page.evaluate(() => ({
  rows: document.querySelectorAll('#object-list .building-row').length,
  dotted: document.querySelectorAll('#object-list .dot').length,
  panelShown: !document.querySelector('#objects-panel').classList.contains('hidden'),
  navActive: document.querySelector('[data-view="objects"]').classList.contains('active'),
}));
await page.fill('#object-search', 'cargo');
await page.waitForTimeout(250);
const objTagHit = await page.$$eval('#object-list .br-name', (ns) => ns.map((n) => n.textContent));
await page.fill('#object-search', 'table');
await page.waitForTimeout(250);
const objFurnHit = await page.$$eval('#object-list .br-name', (ns) => ns.map((n) => n.textContent));
await page.fill('#object-search', 'zzz');
await page.waitForTimeout(250);
const objNone = await page.evaluate(() => ({
  rows: document.querySelectorAll('#object-list .building-row').length,
  empty: !document.querySelector('#object-empty').classList.contains('hidden'),
}));
await page.fill('#object-search', '');
await page.waitForTimeout(250);
const objCleared = await page.$$eval('#object-list .br-name', (ns) => ns.length);

// placing a type puts it in the room the user is standing in, selected, with its dialog open
await page.locator('#object-list .building-row', { hasText: crateType.name }).first().click();
await page.waitForTimeout(200);
await page.click('#od-place');
await page.waitForTimeout(600);
const placed = await page.evaluate(() => ({
  objects: window.__robotTown.objects(),
  selected: window.__robotTown.selectedObject(),
  groups: window.__robotTown.interior().objects,
  panelShown: !document.querySelector('#object-panel').classList.contains('hidden'),
  galleryHidden: document.querySelector('#objects-panel').classList.contains('hidden'),
  navStillActive: document.querySelector('[data-view="objects"]').classList.contains('active'),
  name: document.querySelector('#ob-name').textContent,
  meta: document.querySelector('#ob-meta').textContent,
  pos: document.querySelector('#ob-pos').textContent,
  size: document.querySelector('#ob-size').value,
  sizeVal: document.querySelector('#ob-size-val').textContent,
  color: document.querySelector('#ob-color').value,
  material: document.querySelector('#ob-material').value,
  shape: document.querySelector('#ob-shape').value,
  toast: document.querySelector('#toast').textContent,
}));
const crateInst = placed.objects.find((o) => o.typeId === 'crate' && o.source === 'library') ?? null;
const crateId = crateInst?.id ?? null;

const crateAt = await selectByClick(crateId);
if (!crateAt) bail(`crate is not clickable from any angle: ${crateId}`);
const crateClicked = await page.evaluate(() => ({
  selected: window.__robotTown.selectedObject(),
  panelShown: !document.querySelector('#object-panel').classList.contains('hidden'),
  name: document.querySelector('#ob-name').textContent,
}));

// adjustments stay pending until Save, then land on the instance and rebuild its group
await page.fill('#ob-size', '1.6');
await page.fill('#ob-color', '#ff8080');
await page.selectOption('#ob-material', 'metal');
await page.selectOption('#ob-shape', 'cylinder');
await page.waitForTimeout(250);
const pendingSave = await page.evaluate((id) => ({
  sizeVal: document.querySelector('#ob-size-val').textContent,
  object: window.__robotTown.objects().find((x) => x.id === id),
}), crateId);
await page.click('#ob-save');
await page.waitForTimeout(600);
const adjusted = await page.evaluate((id) => ({
  object: window.__robotTown.objects().find((x) => x.id === id),
  groups: window.__robotTown.interior().objects,
  selected: window.__robotTown.selectedObject(),
  meta: document.querySelector('#ob-meta').textContent,
  toast: document.querySelector('#toast').textContent,
}), crateId);
await page.screenshot({ path: path.join(shots, '14-object-panel.png') });

// dragging moves the object across the floor and must not orbit the camera
const crateDrag = await dragObject(crateId);
if (!crateDrag) bail(`crate drag is not usable: ${crateId}`);
const {
  from: dragFrom, plan: dragPlan, after: dragged,
  delta: dragDelta, landed: dragLanded, poseHeld,
} = crateDrag;

// /object adds the design straight into the room, no review card
const reviewCardsBefore = await page.$$eval('#ai-messages .ai-msg.review', (ns) => ns.length);
await aiOpen();
await page.fill('#ai-input', '/object a glowing beacon');
await page.click('#ai-send');
await page.waitForFunction((n) => window.__robotTown.objects().length > n, FURN + 1, { timeout: 25000 });
await page.waitForTimeout(700);
const aiObject = await page.evaluate(() => ({
  objects: window.__robotTown.objects(),
  selected: window.__robotTown.selectedObject(),
  groups: window.__robotTown.interior().objects,
  panelName: document.querySelector('#ob-name').textContent,
  panelMeta: document.querySelector('#ob-meta').textContent,
  reviewCards: document.querySelectorAll('#ai-messages .ai-msg.review').length,
  toast: document.querySelector('#toast').textContent,
}));
const beacon = aiObject.objects.at(-1);
const aiObjectBubble = (await page.$$eval(
  '#ai-messages .ai-msg.assistant .ai-msg-body',
  (ns) => ns[ns.length - 1].textContent)).trim();
await page.screenshot({ path: path.join(shots, '15-object-ai.png') });

await aiOpen();
await page.fill('#ai-input', '/object [fence] a small plinth');
await page.click('#ai-send');
await page.waitForFunction((n) => window.__robotTown.objects().length > n, FURN + 2, { timeout: 25000 });
await page.waitForTimeout(600);
const fenceObject = await page.evaluate(() => ({
  names: window.__robotTown.objects().map((o) => o.name),
  sources: window.__robotTown.objects().map((o) => o.source),
  groups: window.__robotTown.interior().objects,
}));

const objErrBefore = await page.$$eval('#ai-messages .ai-msg.error', (ns) => ns.length);
await aiOpen();
await page.fill('#ai-input', '/object [invalid] a broken thing');
await page.click('#ai-send');
await page.waitForFunction(
  (n) => document.querySelectorAll('#ai-messages .ai-msg.error').length > n,
  objErrBefore,
  { timeout: 25000 });
await page.waitForTimeout(300);
const objectErr = (await page.$$eval(
  '#ai-messages .ai-msg.error .ai-msg-body',
  (ns) => ns[ns.length - 1].textContent)).trim();
const afterInvalidObject = await page.evaluate(() => ({
  count: window.__robotTown.objects().length,
  groups: window.__robotTown.interior().objects,
}));

// the selected object becomes the reference the next /object derives from
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
const crateAt2 = await selectByClick(crateId);
if (!crateAt2) bail(`crate is not clickable for the derive flow: ${crateId}`);
const crateReselected = await page.evaluate(() => ({
  selected: window.__robotTown.selectedObject(),
  name: document.querySelector('#ob-name').textContent,
}));
await page.click('#ob-derive');
await page.waitForTimeout(400);
const deriveOpened = await page.evaluate(() => ({
  panelOpen: !document.querySelector('#ai-panel').classList.contains('hidden'),
  collapsed: document.querySelector('#ai-panel').classList.contains('collapsed'),
  input: document.querySelector('#ai-input').value,
  bubble: document.querySelector('#ai-messages .ai-msg:last-child .ai-msg-body').textContent,
}));
await page.fill('#ai-input', '/object a taller sibling');
await page.click('#ai-send');
await page.waitForFunction((n) => window.__robotTown.objects().length > n, FURN + 3, { timeout: 25000 });
await page.waitForTimeout(700);
const derivedObject = await page.evaluate(() => ({
  objects: window.__robotTown.objects().map((o) => ({ name: o.name, source: o.source, typeId: o.typeId })),
  selected: window.__robotTown.selectedObject(),
  panelName: document.querySelector('#ob-name').textContent,
}));

// removing the selected object closes its dialog and drops its blocker and group. The crate was
// placed from the library and nothing since then deselected through the app, so the library is
// what comes back
await page.click('#ob-remove');
await page.waitForTimeout(600);
const removed = await page.evaluate(() => ({
  count: window.__robotTown.objects().length,
  groups: window.__robotTown.interior().objects,
  selected: window.__robotTown.selectedObject(),
  panelHidden: document.querySelector('#object-panel').classList.contains('hidden'),
  galleryShown: !document.querySelector('#objects-panel').classList.contains('hidden'),
  toast: document.querySelector('#toast').textContent,
  spaceObjects: window.__robotTown.space('city-hall').objects,
}));

// Esc deselects an object before it leaves the room — on a seeded piece, so the design furniture
// is proven to take part in the selection order
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
const escIds = await page.evaluate(() =>
  window.__robotTown.objects().filter((o) => o.source === 'space').map((o) => o.id));
const escId = await firstSelectable(escIds);
if (!escId) bail(`no seeded furniture is clickable for the Esc flow: ${JSON.stringify(escIds)}`);
const escSelected = await page.evaluate(() => window.__robotTown.selectedObject());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const escOne = await page.evaluate(() => ({
  selected: window.__robotTown.selectedObject(),
  interior: window.__robotTown.interior()?.id ?? null,
  panelHidden: document.querySelector('#object-panel').classList.contains('hidden'),
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const escTwo = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  selected: window.__robotTown.selectedObject(),
  barHidden: document.querySelector('#interior-bar').classList.contains('hidden'),
  spaceObjects: window.__robotTown.space('city-hall').objects,
}));

// outside a room there is nothing to add to, so /object is refused without a request
const strayErrBefore = await page.$$eval('#ai-messages .ai-msg.error', (ns) => ns.length);
if (await page.isHidden('#ai-panel')) await page.click('#nav-ai');
await page.fill('#ai-input', '/object a stray crate');
await page.click('#ai-send');
await page.waitForFunction(
  (n) => document.querySelectorAll('#ai-messages .ai-msg.error').length > n,
  strayErrBefore,
  { timeout: 20000 });
await page.waitForTimeout(300);
const strayErr = (await page.$$eval(
  '#ai-messages .ai-msg.error .ai-msg-body',
  (ns) => ns[ns.length - 1].textContent)).trim();
const strayCount = await page.evaluate(() => window.__robotTown.space('city-hall').objects);

// objects live on the space entry, so walking back in re-attaches every group
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
await page.mouse.click(chScreen2.x, chScreen2.y);
await page.waitForTimeout(900);
const objReentered = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  space: window.__robotTown.space('city-hall'),
  objects: window.__robotTown.objects(),
  selected: window.__robotTown.selectedObject(),
  panelHidden: document.querySelector('#object-panel').classList.contains('hidden'),
}));

// ---------- space redesign: /space sent from inside the room it changes ----------
// City Hall is standing with 16 seeded furniture plus the crate, the beacon and the plinth. A
// redesign replaces only the furniture, keeps what the user placed, and must not move the camera.
if (await page.isHidden('#ai-panel')) await page.click('#nav-ai');
const suBefore = await page.evaluate(() => ({
  pose: window.__robotTown.cameraPose(),
  interior: window.__robotTown.interior(),
  furniture: window.__robotTown.objects().filter((o) => o.source === 'space').length,
  keepers: window.__robotTown.objects()
    .filter((o) => o.source !== 'space')
    .map((o) => ({ name: o.name, source: o.source })),
}));
await page.fill('#ai-input', '/space a brighter atrium');
await page.click('#ai-send');
await page.waitForFunction(
  () => window.__robotTown.space('city-hall')?.source === 'ai', null, { timeout: 25000 });
await page.waitForTimeout(900);
const spaceUpdate = await page.evaluate(() => ({
  space: window.__robotTown.space('city-hall'),
  interior: window.__robotTown.interior(),
  pose: window.__robotTown.cameraPose(),
  objects: window.__robotTown.objects(),
  toast: document.querySelector('#toast').textContent,
}));
const suBubble = (await page.$$eval(
  '#ai-messages .ai-msg.assistant .ai-msg-body',
  (ns) => ns[ns.length - 1].textContent)).trim();
const suStats = await (await fetch('http://127.0.0.1:5198/__stats')).json();
const suStatsCors = await (await fetch('http://127.0.0.1:5199/__stats')).json();
const suLast =
  [suStats.plain.last, suStats.cors.last, suStatsCors.plain.last, suStatsCors.cors.last]
    .find((l) => l && l.user === '/space a brighter atrium') || null;
// no enterInterior on a redesign: applySpace rebuilt the room around the camera that was already there
const suPoseHeld = ['p', 't'].every((k) =>
  spaceUpdate.pose[k].every((v, i) => Math.abs(v - suBefore.pose[k][i]) < 0.02));
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');

const objectStats = await (await fetch('http://127.0.0.1:5198/__stats')).json();
const objectStatsCors = await (await fetch('http://127.0.0.1:5199/__stats')).json();
console.log('OBJECTS:', JSON.stringify({
  objEntered,
  furniture: {
    furnId,
    name: furnSelected.name, meta: furnSelected.meta, panelShown: furnSelected.panelShown,
    object: { typeId: furnSelected.object.typeId, source: furnSelected.object.source, color: furnSelected.object.color },
    saved: { color: furnSaved.object.color, groups: furnSaved.groups, selected: furnSaved.selected, toast: furnSaved.toast },
    drag: { from: [furnDrag.from.x, furnDrag.from.y], start: furnDrag.plan.start, expect: furnDrag.plan.expect, pos: furnDrag.after.pos, delta: furnDrag.delta, landed: furnDrag.landed, poseHeld: furnDrag.poseHeld },
  },
  objGallery, objTagHit, objFurnHit, objNone, objCleared,
  placed: { ...placed, objects: placed.objects.length, crate: crateInst && [crateInst.id, crateInst.name, crateInst.typeId, crateInst.source] },
  crateClicked, crateId,
  pendingSave: { ...pendingSave, object: { scale: pendingSave.object.scale, color: pendingSave.object.color } },
  adjusted: { ...adjusted, object: { scale: adjusted.object.scale, color: adjusted.object.color, material: adjusted.object.material, shape: adjusted.object.shape, attrs: adjusted.object.attrs, parts: adjusted.object.parts } },
  sizeReadout: pendingSave.sizeVal,
  drag: { from: dragFrom && [dragFrom.x, dragFrom.y], start: dragPlan?.start, expect: dragPlan?.expect, pos: dragged.pos, dragDelta, dragLanded, poseHeld, panelPos: dragged.panelPos },
  aiObject: { ...aiObject, objects: aiObject.objects.length, beacon: [beacon.name, beacon.source, beacon.typeId, beacon.parts] },
  aiObjectBubble, fenceObject, objectErr, afterInvalidObject,
  crateReselected, deriveOpened,
  derivedObject: { ...derivedObject, objects: derivedObject.objects.length, derived: derivedObject.objects.at(-1) },
  removed,
  escSelected, escOne, escTwo, strayErr, strayCount,
  objReentered: { ...objReentered, objects: objReentered.objects.length, names: objReentered.objects.map((o) => o.name).slice(-3) },
  spaceUpdate: {
    before: {
      interior: suBefore.interior?.id ?? null,
      furniture: suBefore.furniture,
      keepers: suBefore.keepers.map((k) => `${k.name}/${k.source}`),
    },
    space: spaceUpdate.space,
    interior: spaceUpdate.interior,
    objects: spaceUpdate.objects.length,
    names: spaceUpdate.objects.map((o) => o.name),
    sources: spaceUpdate.objects.map((o) => o.source),
    poseHeld: suPoseHeld,
    bubble: suBubble,
    toast: spaceUpdate.toast,
    last: suLast && { tools: suLast.tools, msgs: suLast.msgs, system: `${suLast.system.length} chars` },
  },
  objects: objectStats.plain.objects + objectStatsCors.cors.objects,
}));

// ---------- functions: editable system prompts + call history ----------
await page.click('[data-view="map"]');
await page.click('#interior-back');
await page.waitForTimeout(600);
await page.click('[data-view="settings"]');
await page.waitForTimeout(300);
const fnOpener = await page.evaluate(() => ({
  shown: !!document.querySelector('#functions-config').offsetParent,
  panelShown: !document.querySelector('#settings-panel').classList.contains('hidden'),
  hint: document.querySelector('#functions-config .fn-hint').textContent,
  opener: document.querySelector('#fn-open').textContent,
  summary: document.querySelector('#fn-summary').textContent,
  dialogHidden: document.querySelector('#fn-panel').classList.contains('hidden'),
  inlineRows: document.querySelectorAll('#functions-config .fn-row').length,
}));

await page.click('#fn-open');
await page.waitForTimeout(300);
const fnSection = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-list .fn-row')];
  const box = document.querySelector('.fn-card').getBoundingClientRect();
  return {
    shown: !document.querySelector('#fn-panel').classList.contains('hidden'),
    card: [Math.round(box.width), Math.round(box.height)],
    rows: rows.length,
    cmds: rows.map((r) => r.querySelector('.fn-cmd').textContent),
    labels: rows.map((r) => r.querySelector('.fn-label').textContent),
    badges: rows.map((r) => r.querySelector('.badge').textContent),
    counts: rows.map((r) => r.querySelector('.fn-count').textContent),
    expanded: rows.map((r) => r.getAttribute('aria-expanded')),
    detailsHidden: [...document.querySelectorAll('.fn-detail')].filter((d) => d.classList.contains('hidden')).length,
    cols: document.querySelectorAll('#fn-detail-building .fn-cols > .fn-col').length,
    promptCols: getComputedStyle(document.querySelector('#fn-detail-building .fn-cols'))
      .gridTemplateColumns.split(' ').length,
  };
});

// Escape belongs to the modal before anything under it
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const fnEscaped = await page.evaluate(() => ({
  dialogHidden: document.querySelector('#fn-panel').classList.contains('hidden'),
  interior: window.__robotTown.interior()?.id ?? null,
  view: document.querySelector('#settings-panel').classList.contains('hidden') === false,
}));
await page.click('#fn-open');
await page.waitForTimeout(300);
const fnReopened = await page.evaluate(() => ({
  shown: !document.querySelector('#fn-panel').classList.contains('hidden'),
  selected: document.querySelector('#fn-row-building').getAttribute('aria-expanded'),
  detailShown: !document.querySelector('#fn-detail-building').classList.contains('hidden'),
}));

// clicking a function switches the big area to its editor, prefilled with its system prompt
await page.click('#fn-row-building');
await page.waitForTimeout(250);
const fnBuildingOpen = await page.evaluate(() => ({
  detailShown: !document.querySelector('#fn-detail-building').classList.contains('hidden'),
  expanded: document.querySelector('#fn-row-building').getAttribute('aria-expanded'),
  value: document.querySelector('#fn-prompt-building').value,
  note: document.querySelector('#fn-detail-building .fn-note').textContent,
  saveDisabled: document.querySelector('#fn-save-building').disabled,
  resetDisabled: document.querySelector('#fn-reset-building').disabled,
  badge: document.querySelector('#fn-badge-building').textContent,
  histRows: document.querySelectorAll('#fn-hist-building .fn-call').length,
  promptWide: document.querySelector('#fn-prompt-building').getBoundingClientRect().width > 300,
}));

const fnCustomText = `${fnBuildingOpen.value}\nMARKER BUILDING: prefer tall spires.`;
await page.fill('#fn-prompt-building', fnCustomText);
const fnSaveEnabledDirty = await page.isEnabled('#fn-save-building');
await page.click('#fn-save-building');
await page.waitForTimeout(300);
const fnSavedPrompt = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('robotTown.ai.functions.v1'));
  return {
    stored: s.prompts.building || null,
    keys: Object.keys(s.prompts),
    value: document.querySelector('#fn-prompt-building').value,
    badge: document.querySelector('#fn-badge-building').textContent,
    saveDisabled: document.querySelector('#fn-save-building').disabled,
    resetDisabled: document.querySelector('#fn-reset-building').disabled,
    toast: document.querySelector('#toast').textContent,
  };
});

const fnBuildingHist = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-hist-building .fn-call')];
  const rejected = rows.find((r) => r.querySelector('.badge').textContent === 'Rejected');
  if (rejected) rejected.querySelector('.fn-call-row').click();
  return {
    rows: rows.length,
    statuses: rows.map((r) => r.querySelector('.badge').textContent),
    reqs: rows.map((r) => r.querySelector('.fn-call-req').textContent),
    countLabel: document.querySelector('#fn-count-building').textContent,
    emptyHidden: document.querySelector('#fn-empty-building').classList.contains('hidden'),
  };
});
await page.waitForTimeout(250);
// a rejected call collapse-opens onto its status and the whole prompt context that was sent
const fnRejectedCall = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-hist-building .fn-call')];
  const rejected = rows.find((r) => r.querySelector('.badge').textContent === 'Rejected');
  const detail = rejected.querySelector('.fn-call-detail');
  return {
    open: !detail.classList.contains('hidden'),
    expanded: rejected.querySelector('.fn-call-row').getAttribute('aria-expanded'),
    status: rejected.querySelector('.fn-call-status').textContent,
    meta: rejected.querySelector('.fn-call-meta').textContent,
    dump: rejected.querySelector('.fn-dump').textContent,
  };
});

// A saved prompt replaces the rules only: the facts for the call are still appended, so a prompt
// stripped of every number still gets a room that fits the building.
await page.click('#fn-row-space');
await page.waitForTimeout(250);
await page.fill('#fn-prompt-space', 'MARKER SPACE: design a calm, quiet room.');
await page.click('#fn-save-space');
await page.waitForTimeout(300);
const fnSpaceSaved = await page.evaluate(() => ({
  stored: JSON.parse(localStorage.getItem('robotTown.ai.functions.v1')).prompts.space || null,
  badge: document.querySelector('#fn-badge-space').textContent,
}));

// the backdrop covers the map, so it goes away before the flow clicks a building again
await page.click('#fn-close');
await page.waitForTimeout(300);
const fnClosed = await page.evaluate(() => document.querySelector('#fn-panel').classList.contains('hidden'));

const fnTarget = await page.evaluate(() => {
  const b = window.__robotTown.buildings().find((x) => window.__robotTown.space(x.id) === null);
  return b ? { id: b.id, name: b.name } : null;
});
if (!fnTarget) bail('every building already has an indoor space, so the /space prompt flow cannot be tested');
await page.click('[data-view="map"]');
if (!(await page.isHidden('#ai-panel'))) await page.click('#nav-ai');
await page.evaluate((id) => window.__robotTown.flyTo(id), fnTarget.id);
await page.waitForTimeout(1900);
let fnSpScreen = await page.evaluate((id) => window.__robotTown.screenPos(id, 0), fnTarget.id);
await page.mouse.click(fnSpScreen.x, fnSpScreen.y);
await page.waitForTimeout(400);
if (await page.isHidden('#space-prompt')) {
  fnSpScreen = await page.evaluate((id) => window.__robotTown.screenPos(id, 5), fnTarget.id);
  await page.mouse.click(fnSpScreen.x, fnSpScreen.y);
  await page.waitForTimeout(400);
}
if (await page.isHidden('#space-prompt')) bail(`clicking ${fnTarget.name} did not offer the indoor-space prompt`);
const fnSpPrompt = await page.evaluate(() => ({
  shown: !document.querySelector('#space-prompt').classList.contains('hidden'),
  text: document.querySelector('#sp-text').textContent,
}));
const fnEnv = Number(/a ([\d.]+)×([\d.]+) room/.exec(fnSpPrompt.text)?.[1] ?? NaN);
await page.click('#sp-ai');
await page.waitForTimeout(400);
await page.fill('#ai-input', '/space a quiet reading room');
await page.click('#ai-send');
await page.waitForFunction((id) => window.__robotTown.space(id) !== null, fnTarget.id, { timeout: 25000 });
await page.waitForTimeout(900);
const fnSpaceApplied = await page.evaluate((id) => ({
  space: window.__robotTown.space(id),
  interior: window.__robotTown.interior(),
  toast: document.querySelector('#toast').textContent,
}), fnTarget.id);

const fnStats = await (await fetch('http://127.0.0.1:5198/__stats')).json();
const fnLast =
  [fnStats.plain.last, fnStats.cors.last].find((l) => l && l.user === '/space a quiet reading room') || null;

await page.click('#interior-back');
await page.waitForTimeout(600);
await page.click('[data-view="settings"]');
await page.waitForTimeout(300);
await page.click('#fn-open');
await page.waitForTimeout(300);
await page.click('#fn-row-space');
await page.waitForTimeout(250);

// the redesign sent from inside City Hall earlier: its recorded prompt carries the standing room
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-hist-space .fn-call')];
  const hit = rows.find((r) => r.querySelector('.fn-call-req').textContent === '/space a brighter atrium');
  if (hit) hit.querySelector('.fn-call-row').click();
});
await page.waitForTimeout(250);
const suCall = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-hist-space .fn-call')];
  const hit = rows.find((r) => r.querySelector('.fn-call-req').textContent === '/space a brighter atrium');
  if (!hit) return null;
  const detail = hit.querySelector('.fn-call-detail');
  return {
    open: !detail.classList.contains('hidden'),
    badge: hit.querySelector('.badge').textContent,
    status: hit.querySelector('.fn-call-status').textContent,
    meta: hit.querySelector('.fn-call-meta').textContent,
    dump: detail.querySelector('.fn-dump').textContent,
  };
});

await page.evaluate(() => document.querySelector('#fn-hist-space .fn-call .fn-call-row').click());
await page.waitForTimeout(250);
const fnSpaceCall = await page.evaluate(() => {
  const top = document.querySelector('#fn-hist-space .fn-call');
  return {
    req: top.querySelector('.fn-call-req').textContent,
    badge: top.querySelector('.badge').textContent,
    open: !top.querySelector('.fn-call-detail').classList.contains('hidden'),
    status: top.querySelector('.fn-call-status').textContent,
    meta: top.querySelector('.fn-call-meta').textContent,
    dump: top.querySelector('.fn-dump').textContent,
    spaceRows: document.querySelectorAll('#fn-hist-space .fn-call').length,
  };
});

// the shot is the whole panel: the function list on the left, /space's prompt and its newest call
// open on the right, all inside a card that fits the viewport
await page.screenshot({ path: path.join(shots, '16-functions.png') });

await page.click('#fn-row-object');
await page.waitForTimeout(250);

const fnObjectHist = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-hist-object .fn-call')];
  const blocked = rows.find((r) => r.querySelector('.badge').textContent === 'Blocked');
  if (blocked) blocked.querySelector('.fn-call-row').click();
  return {
    rows: rows.length,
    statuses: rows.map((r) => r.querySelector('.badge').textContent),
    reqs: rows.map((r) => r.querySelector('.fn-call-req').textContent),
  };
});
await page.waitForTimeout(250);
const fnBlockedCall = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#fn-hist-object .fn-call')];
  const blocked = rows.find((r) => r.querySelector('.badge').textContent === 'Blocked');
  if (!blocked) return null;
  return {
    open: !blocked.querySelector('.fn-call-detail').classList.contains('hidden'),
    status: blocked.querySelector('.fn-call-status').textContent,
    meta: blocked.querySelector('.fn-call-meta').textContent,
    dump: blocked.querySelector('.fn-dump').textContent,
  };
});

await page.click('#fn-row-space');
await page.waitForTimeout(250);
await page.click('#fn-reset-space');
await page.waitForTimeout(300);
const fnReset = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('robotTown.ai.functions.v1'));
  return {
    keys: Object.keys(s.prompts),
    badge: document.querySelector('#fn-badge-space').textContent,
    value: document.querySelector('#fn-prompt-space').value,
    saveDisabled: document.querySelector('#fn-save-space').disabled,
    resetDisabled: document.querySelector('#fn-reset-space').disabled,
    toast: document.querySelector('#toast').textContent,
  };
});

// prompts and history live in their own localStorage key, so both survive a reload
await page.reload();
await page.waitForFunction(() => window.__robotTown && window.__robotTown.ready, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.click('[data-view="settings"]');
await page.waitForTimeout(300);
const fnSummaryAfter = await page.evaluate(() => document.querySelector('#fn-summary').textContent);
await page.click('#fn-open');
await page.waitForTimeout(300);
await page.click('#fn-row-building');
await page.waitForTimeout(250);
const fnPersist = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('robotTown.ai.functions.v1'));
  const rows = [...document.querySelectorAll('#fn-list .fn-row')];
  return {
    promptKeys: Object.keys(s.prompts),
    historyCounts: {
      building: s.history.building.length,
      space: s.history.space.length,
      object: s.history.object.length,
    },
    value: document.querySelector('#fn-prompt-building').value,
    badges: rows.map((r) => r.querySelector('.badge').textContent),
    counts: rows.map((r) => r.querySelector('.fn-count').textContent),
    rendered: {
      building: document.querySelectorAll('#fn-hist-building .fn-call').length,
      space: document.querySelectorAll('#fn-hist-space .fn-call').length,
      object: document.querySelectorAll('#fn-hist-object .fn-call').length,
    },
  };
});

console.log('FUNCTIONS:', JSON.stringify({
  fnOpener,
  fnSection,
  fnEscaped, fnReopened, fnClosed,
  fnBuildingOpen: { ...fnBuildingOpen, value: `${fnBuildingOpen.value.length} chars`, note: fnBuildingOpen.note.slice(0, 40) },
  fnSaveEnabledDirty,
  fnSavedPrompt: { ...fnSavedPrompt, value: `${fnSavedPrompt.value.length} chars`, stored: `${fnSavedPrompt.stored.length} chars` },
  fnBuildingHist,
  fnRejectedCall: {
    open: fnRejectedCall.open, expanded: fnRejectedCall.expanded,
    status: fnRejectedCall.status.slice(0, 90), meta: fnRejectedCall.meta,
    dumpChars: fnRejectedCall.dump.length,
    dumpHead: fnRejectedCall.dump.slice(0, 80),
    hasAssistantSystem: fnRejectedCall.dump.includes('You are the assistant inside Robot City'),
    hasTool: fnRejectedCall.dump.includes('create_building'),
    hasRequest: fnRejectedCall.dump.includes('/building [invalid] a broken tower'),
    hasRules: fnRejectedCall.dump.includes('Allowed shapes: box, cylinder, sphere, cone, dome'),
  },
  fnSpaceSaved, fnTarget, fnSpPrompt: { shown: fnSpPrompt.shown, env: fnEnv },
  fnSpaceApplied, fnLast: fnLast && { ...fnLast, system: `${fnLast.system.length} chars` },
  suCall: suCall && {
    open: suCall.open, badge: suCall.badge,
    status: suCall.status.slice(0, 90), meta: suCall.meta,
    dumpChars: suCall.dump.length,
    hasReference: suCall.dump.includes('Current indoor space:'),
    hasMarker: suCall.dump.includes('MARKER SPACE:'),
  },
  fnSpaceCall: { ...fnSpaceCall, dump: `${fnSpaceCall.dump.length} chars` },
  fnObjectHist,
  fnBlockedCall: fnBlockedCall && { ...fnBlockedCall, dump: `${fnBlockedCall.dump.length} chars` },
  fnReset: { ...fnReset, value: `${fnReset.value.length} chars` },
  fnSummaryAfter,
  fnPersist,
}));

// ---------- robots ----------
// Last on purpose: FUNCTIONS reloads the page and reads its newest /space call, and this phase
// sends no AI messages at all, so no mock assertion moves.
await page.click('#fn-close');
await page.waitForTimeout(250);
await page.click('[data-view="map"]');
await page.waitForTimeout(300);

const rbRoster0 = await page.evaluate(() => window.__robotTown.robots());
const rbBuildings = await page.evaluate(() => window.__robotTown.buildings().length);
await page.click('[data-view="robots"]');
await page.waitForTimeout(700);
const rbOpen = await page.evaluate(() => {
  const hidden = (s) => document.querySelector(s).classList.contains('hidden');
  const c = document.querySelector('#rb-canvas');
  return {
    dialog: !hidden('#robot-panel'),
    stat: document.querySelector('#stat-robots').textContent,
    summary: document.querySelector('#robots-summary').textContent,
    rows: document.querySelectorAll('#rb-list .rb-row').length,
    types: [...document.querySelectorAll('#rb-types .rb-type-row')].map((e) => e.dataset.type),
    count: document.querySelector('#rb-count').textContent,
    later: document.querySelector('.rb-later').textContent,
    auto: !hidden('#rb-item') && hidden('#rb-none') && hidden('#rb-type-item'),
    name: document.querySelector('#rb-name').value,
    current: document.querySelector('#rb-list .rb-row[aria-current="true"]')?.dataset.robot ?? null,
    canvas: { w: c.clientWidth, h: c.clientHeight, hidden: c.classList.contains('hidden') },
    noteHidden: hidden('#rb-preview-note'),
  };
});

await page.fill('#rb-search', rbRoster0[0].name.toLowerCase());
await page.waitForTimeout(250);
const rbSearchNarrow = await page.evaluate(() => document.querySelectorAll('#rb-list .rb-row').length);
await page.fill('#rb-search', 'zzzqq');
await page.waitForTimeout(250);
const rbSearchNone = await page.evaluate(() => ({
  rows: document.querySelectorAll('#rb-list .rb-row').length,
  types: [...document.querySelectorAll('#rb-types .rb-type-row')]
    .filter((e) => !e.classList.contains('hidden')).length,
  empty: !document.querySelector('#rb-empty').classList.contains('hidden'),
}));
await page.fill('#rb-search', '');
await page.waitForTimeout(250);
const rbSearchCleared = await page.evaluate(() => document.querySelectorAll('#rb-list .rb-row').length);

await page.click('#rb-list .rb-row >> nth=1');
await page.waitForTimeout(400);
const rbSelect = await page.evaluate(() => {
  const id = document.querySelector('#rb-list .rb-row[aria-current="true"]')?.dataset.robot ?? null;
  const r = id ? window.__robotTown.robot(id) : null;
  const v = (s) => document.querySelector(s).value;
  return {
    id,
    rec: r && {
      name: r.name, modelId: r.modelId, color: r.color,
      scale: r.scale, speed: r.speed, home: r.home,
    },
    fields: {
      head: document.querySelector('#rb-item-h').textContent,
      name: v('#rb-name'), model: v('#rb-model'), color: v('#rb-color'),
      size: v('#rb-size'), sizeOut: document.querySelector('#rb-size-val').textContent,
      speed: v('#rb-speed'), speedOut: document.querySelector('#rb-speed-val').textContent,
      home: v('#rb-home'), homes: document.querySelectorAll('#rb-home option').length,
      sizeMin: document.querySelector('#rb-size').min, sizeMax: document.querySelector('#rb-size').max,
    },
    status: document.querySelector('#rb-status').textContent,
    typeHidden: document.querySelector('#rb-type-item').classList.contains('hidden'),
  };
});
await page.screenshot({ path: path.join(shots, '17-robots.png') });

// a robot can only be edited where it stands, so walk into City Hall first (the reload above
// dropped every space, so the room offers its prompt)
await page.click('#rb-close');
await page.waitForTimeout(250);
const rbClosed = await page.evaluate(() => document.querySelector('#robot-panel').classList.contains('hidden'));
await page.evaluate(() => window.__robotTown.enterInterior('city-hall'));
await page.waitForTimeout(600);
if (!(await page.isHidden('#space-prompt'))) {
  await page.click('#sp-default');
  await page.waitForTimeout(1400);
}
const rbRoom = await page.evaluate(() => window.__robotTown.interior());

const rbIndoorClickAim = await page.evaluate(() => {
  const id = window.__robotTown.interior()?.robotIds[0] ?? null;
  const robot = id ? window.__robotTown.robot(id) : null;
  if (!robot?.pos) return null;
  const point = window.__robotTown.screenPoint(robot.pos[0], robot.pos[1], 0.8);
  return { id, ...point, picked: window.__robotTown.robotAt(point.x, point.y) };
});
if (rbIndoorClickAim?.picked === rbIndoorClickAim.id) {
  await page.mouse.click(rbIndoorClickAim.x, rbIndoorClickAim.y);
  await page.waitForTimeout(250);
}
const rbIndoorClick = await page.evaluate((aim) => ({
  aimed: aim?.id ?? null,
  picked: aim?.picked ?? null,
  panel: !document.querySelector('#robot-panel').classList.contains('hidden'),
  selected: document.querySelector('#rb-list .rb-row[aria-current="true"]')?.dataset.robot ?? null,
}), rbIndoorClickAim);

await page.click('[data-view="robots"]');
await page.waitForTimeout(600);
const editId = rbRoom?.robotIds[0] ?? null;
await page.click(`#rb-list .rb-row[data-robot="${editId}"]`);
await page.waitForTimeout(400);
const preEdit = await page.evaluate(() => ({
  interior: window.__robotTown.interior(),
  pose: window.__robotTown.cameraPose(),
}));
await page.fill('#rb-name', 'Verify Bot');
await page.evaluate(() => {
  const set = (sel, val) => {
    const el = document.querySelector(sel);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('#rb-color', '#ff8800');
  set('#rb-size', '1.5');
  set('#rb-speed', '2.5');
});
await page.waitForTimeout(400);
const rbDirty = await page.evaluate(() => ({
  head: document.querySelector('#rb-item-h').textContent,
  sizeOut: document.querySelector('#rb-size-val').textContent,
  speedOut: document.querySelector('#rb-speed-val').textContent,
}));
await page.click('#rb-save');
await page.waitForTimeout(600);
const rbEdit = await page.evaluate((id) => {
  const it = window.__robotTown.interior();
  const r = window.__robotTown.robot(id);
  return {
    interior: it && { id: it.id, robots: it.robots, robotIds: it.robotIds, objects: it.objects, items: it.items },
    rec: r && {
      name: r.name, modelId: r.modelId, color: r.color, scale: r.scale, speed: r.speed,
      home: r.home, indoors: r.indoors, pos: r.pos,
    },
    nameField: document.querySelector('#rb-name').value,
    status: document.querySelector('#rb-status').textContent,
    toast: document.querySelector('#toast').textContent,
    pose: window.__robotTown.cameraPose(),
  };
}, editId);
const rbRoomCollision = await page.evaluate(() => window.__robotTown.interiorCollisions());

// the library row deploys into the room the camera is standing in
await page.click('#rb-types .rb-type-row[data-type="courier"]');
await page.waitForTimeout(400);
const rbType = await page.evaluate(() => ({
  itemHidden: document.querySelector('#rb-item').classList.contains('hidden'),
  shown: !document.querySelector('#rb-type-item').classList.contains('hidden'),
  name: document.querySelector('#rb-type-name').textContent,
  desc: document.querySelector('#rb-type-desc').textContent,
  meta: document.querySelector('#rb-type-meta').textContent,
  home: document.querySelector('#rb-type-home').value,
}));
await page.click('#rb-deploy');
await page.waitForTimeout(700);
const rbDeploy = await page.evaluate((before) => {
  const it = window.__robotTown.interior();
  const added = (it ? it.robotIds : []).filter((x) => !before.includes(x));
  const id = added[0] ?? null;
  const r = id ? window.__robotTown.robot(id) : null;
  return {
    interior: it && { id: it.id, robots: it.robots },
    added, newId: id,
    rec: r && { name: r.name, modelId: r.modelId, source: r.source, home: r.home, indoors: r.indoors },
    roster: window.__robotTown.robots().length,
    stat: document.querySelector('#stat-robots').textContent,
    selected: document.querySelector('#rb-list .rb-row[aria-current="true"]')?.dataset.robot ?? null,
    toast: document.querySelector('#toast').textContent,
  };
}, rbRoom?.robotIds ?? []);

await page.selectOption('#rb-home', 'hospital');
await page.click('#rb-save');
await page.waitForTimeout(700);
const rbReassign = await page.evaluate((id) => {
  const it = window.__robotTown.interior();
  const r = window.__robotTown.robot(id);
  return {
    interior: it && { id: it.id, robots: it.robots, still: it.robotIds.includes(id) },
    rec: r && { home: r.home, homeName: r.homeName, indoors: r.indoors, pos: r.pos },
    toast: document.querySelector('#toast').textContent,
  };
}, rbDeploy.newId);

await page.click('#rb-remove');
await page.waitForTimeout(600);
const rbRemove = await page.evaluate(() => ({
  roster: window.__robotTown.robots().length,
  rows: document.querySelectorAll('#rb-list .rb-row').length,
  none: !document.querySelector('#rb-none').classList.contains('hidden'),
  itemHidden: document.querySelector('#rb-item').classList.contains('hidden'),
  stat: document.querySelector('#stat-robots').textContent,
  toast: document.querySelector('#toast').textContent,
}));

// Focus: the dialog has to be gone before the building can ask for a space, since it sits above
// the prompt in the z-ladder
await page.click('#rb-close');
await page.waitForTimeout(250);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const rbUni = await page.evaluate(() =>
  window.__robotTown.robots().find((r) => r.home === 'university')?.id ?? null);
await page.click('[data-view="robots"]');
await page.waitForTimeout(600);
await page.click(`#rb-list .rb-row[data-robot="${rbUni}"]`);
await page.waitForTimeout(300);
await page.click('#rb-focus');
await page.waitForTimeout(800);
const rbFocusPrompt = await page.evaluate(() => ({
  dialogHidden: document.querySelector('#robot-panel').classList.contains('hidden'),
  prompt: !document.querySelector('#space-prompt').classList.contains('hidden'),
  interior: window.__robotTown.interior(),
}));
if (rbFocusPrompt.prompt) {
  await page.click('#sp-default');
  await page.waitForTimeout(1400);
}
const rbFocus = await page.evaluate((id) => {
  const it = window.__robotTown.interior();
  const r = window.__robotTown.robot(id);
  const t = window.__robotTown.cameraPose().t;
  const d = r?.pos ? Math.hypot(r.pos[0] - t[0], r.pos[1] - t[2]) : null;
  return {
    interior: it && { id: it.id, robots: it.robots, has: it.robotIds.includes(id), room: it.room },
    rec: r && { home: r.home, indoors: r.indoors, pos: r.pos },
    dist: d === null ? null : Math.round(d * 100) / 100,
    inRoom: !!(r?.pos && it) &&
      Math.abs(r.pos[0]) <= it.room.w / 2 && Math.abs(r.pos[1]) <= it.room.d / 2,
  };
}, rbUni);

// Escape closes the dialog and must not also leave the room
await page.click('[data-view="robots"]');
await page.waitForTimeout(500);
const rbEscOpen = await page.evaluate(() => !document.querySelector('#robot-panel').classList.contains('hidden'));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const rbEscape = await page.evaluate(() => ({
  dialog: document.querySelector('#robot-panel').classList.contains('hidden'),
  interior: window.__robotTown.interior()?.id ?? null,
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const rbEscTwice = await page.evaluate(() => window.__robotTown.interior());

// the crew that is not standing in a room walks the streets
await page.evaluate(() => window.__robotTown.flyTo('city-hall'));
await page.waitForTimeout(2200);
const crowdA = await page.evaluate(() => window.__robotTown.crowd());
await page.waitForTimeout(900);
const crowdB = await page.evaluate(() => window.__robotTown.crowd());
const rbCrowd = {
  total: crowdA.total, visible: crowdA.visible, meshes: crowdA.meshes,
  inWorldGroups: crowdA.inWorldGroups,
  yields: crowdB.yields,
  minClearance: crowdB.minClearance,
  moved: JSON.stringify(crowdA.sample) !== JSON.stringify(crowdB.sample),
  sample: crowdA.sample.slice(0, 2),
};
await page.screenshot({ path: path.join(shots, '18-crowd.png') });

// First-person view follows simulation data rather than requiring one of the limited crowd meshes.
const rbStreetPovId = await page.evaluate(() =>
  window.__robotTown.robots().find((r) => r.home === 'hospital')?.id ?? null);
const rbStreetBefore = await page.evaluate(() => window.__robotTown.cameraPose());
await page.click('[data-view="robots"]');
await page.waitForTimeout(400);
await page.click(`#rb-list .rb-row[data-robot="${rbStreetPovId}"]`);
const rbPovButton = await page.isVisible('#rb-pov');
await page.click('#rb-pov');
await page.waitForTimeout(450);
const rbStreetPovA = await page.evaluate(() => ({
  pov: window.__robotTown.pov(),
  overlay: !document.querySelector('#pov-bar').classList.contains('hidden'),
  panelHidden: document.querySelector('#robot-panel').classList.contains('hidden'),
}));
await page.waitForTimeout(700);
const rbStreetPovB = await page.evaluate(() => window.__robotTown.pov());
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const rbStreetPovExit = await page.evaluate(() => ({
  pov: window.__robotTown.pov(),
  overlayHidden: document.querySelector('#pov-bar').classList.contains('hidden'),
  pose: window.__robotTown.cameraPose(),
}));

// A robot on duty mounts its cached room and restores the previous town view on exit.
const rbIndoorBefore = await page.evaluate(() => window.__robotTown.cameraPose());
await page.click('[data-view="robots"]');
await page.waitForTimeout(400);
await page.click(`#rb-list .rb-row[data-robot="${editId}"]`);
await page.click('#rb-pov');
await page.waitForTimeout(600);
const rbIndoorPov = await page.evaluate(() => ({
  pov: window.__robotTown.pov(),
  interior: window.__robotTown.interior(),
  overlay: !document.querySelector('#pov-bar').classList.contains('hidden'),
}));
await page.click('#pov-exit');
await page.waitForTimeout(250);
const rbIndoorPovExit = await page.evaluate(() => ({
  pov: window.__robotTown.pov(),
  interior: window.__robotTown.interior(),
  pose: window.__robotTown.cameraPose(),
}));

// the edit is roster data, so a room rebuilt from scratch has to reproduce it
await page.evaluate(() => window.__robotTown.rebuildInterior('city-hall'));
await page.waitForTimeout(500);
await page.evaluate(() => window.__robotTown.enterInterior('city-hall'));
await page.waitForTimeout(1000);
const rbPersist = await page.evaluate((id) => {
  const it = window.__robotTown.interior();
  const r = window.__robotTown.robot(id);
  return {
    interior: it && { id: it.id, robots: it.robots, has: it.robotIds.includes(id) },
    rec: r && { name: r.name, modelId: r.modelId, color: r.color, scale: r.scale, speed: r.speed, indoors: r.indoors },
  };
}, editId);
await page.keyboard.press('Escape');
await page.waitForTimeout(700);

console.log('ROBOTS:', JSON.stringify({
  roster: rbRoster0.length,
  first: rbRoster0[0] && { id: rbRoster0[0].id, name: rbRoster0[0].name, model: rbRoster0[0].model },
  rbOpen: { ...rbOpen, later: rbOpen.later.slice(0, 30) },
  rbSearch: { q: rbRoster0[0].name, narrow: rbSearchNarrow, none: rbSearchNone, cleared: rbSearchCleared },
  rbSelect: { ...rbSelect, status: rbSelect.status.slice(0, 80) },
  rbClosed, rbRoom, rbIndoorClick, rbRoomCollision,
  rbDirty,
  rbEdit: {
    ...rbEdit,
    rec: rbEdit.rec && { ...rbEdit.rec, pos: rbEdit.rec.pos },
    status: rbEdit.status.slice(0, 80),
    poseHeld: ['p', 't'].every((k) => rbEdit.pose[k].every((v, i) => Math.abs(v - preEdit.pose[k][i]) < 0.25)),
  },
  rbType: { ...rbType, desc: rbType.desc.slice(0, 40) },
  rbDeploy, rbReassign, rbRemove,
  rbUni, rbFocusPrompt: { ...rbFocusPrompt, interior: rbFocusPrompt.interior?.id ?? null },
  rbFocus,
  rbEscOpen, rbEscape, rbEscTwice,
  rbCrowd,
  rbPov: { button: rbPovButton, streetA: rbStreetPovA, streetB: rbStreetPovB,
    streetExit: rbStreetPovExit, indoor: rbIndoorPov, indoorExit: rbIndoorPovExit },
  rbPersist,
}));

// ---------- page dialogs: town overview / buildings / objects / settings ----------
// Last on purpose: it sends no AI messages, so no mock assertion moves, and it leaves the town in
// whatever state the dialogs produce.
// openDialog() only hides the four nav dialogs, so a robot page left over from the phase above
// would sit on top of the town card
await clearOverlays();
// the robot phase ends standing inside City Hall. Every probe below is a town-mode probe: the
// status line, the fly-to, and the library's "no room to place into" refusal all need to be out
if (!(await page.isHidden('#interior-bar'))) {
  await page.click('#interior-back');
  await page.waitForTimeout(900);
}
await page.click('[data-view="town"]');
await page.waitForTimeout(350);
const town = await page.evaluate((models) => {
  const t = window.__robotTown;
  const b = t.bounds();
  const rs = t.robots();
  const deployed = rs.filter((r) => r.source !== 'seed').length;
  const ids = t.buildings().map((x) => x.id);
  const spaces = ids.map((id) => t.space(id)).filter(Boolean);
  const text = (s) => document.querySelector(s).textContent;
  return {
    shown: !document.querySelector('#town-panel').classList.contains('hidden'),
    navActive: document.querySelector('[data-view="town"]').classList.contains('active'),
    status: text('#town-status'),
    summary: text('#robots-summary'),
    stats: {
      robots: text('#stat-robots'), buildings: text('#stat-buildings'), area: text('#stat-area'),
      sectors: text('#stat-sectors'), spaces: text('#stat-spaces'), objects: text('#stat-objects'),
      models: text('#stat-models'), deployed: text('#stat-deployed'),
    },
    expect: {
      robots: `${rs.length} robot${rs.length === 1 ? '' : 's'}`,
      buildings: String(ids.length),
      area: `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxZ - b.minZ)} units`,
      sectors: String(t.sectors().length),
      spaces: String(spaces.length),
      objects: String(spaces.reduce((n, s) => n + s.objects, 0)),
      models: String(models),
      deployed: String(deployed),
    },
    expectSummary: `${rs.length} in town · ${deployed} deployed by you · ${models} models`,
  };
}, ROBOT_TYPES.length);
await page.screenshot({ path: path.join(shots, '19-town.png') });

// the town dialog is also the way into the robot page
await page.click('#robots-open');
await page.waitForTimeout(700);
const townToRobots = await page.evaluate(() => ({
  townHidden: document.querySelector('#town-panel').classList.contains('hidden'),
  robotsShown: !document.querySelector('#robot-panel').classList.contains('hidden'),
  navActive: document.querySelector('[data-view="robots"]').classList.contains('active'),
}));
await page.click('#rb-close');
await page.waitForTimeout(300);

await page.click('[data-view="buildings"]');
await page.waitForTimeout(350);
// the whole design rests on #brand-panel outranking the backdrops: with a dialog up, every nav
// button still has to be the hit-test target, or the menu is unreachable
const navReachable = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-btn[data-view]')].map((b) => {
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
  }));
const bdBuildings = await page.evaluate(() => window.__robotTown.buildings().length);
const bdRows = await page.$$eval('#building-list .building-row', (ns) => ns.length);
await page.fill('#building-search', 'zzzqq');
await page.waitForTimeout(200);
const bdNone = await page.evaluate(() => ({
  rows: document.querySelectorAll('#building-list .building-row').length,
  empty: !document.querySelector('#building-empty').classList.contains('hidden'),
  detailHidden: document.querySelector('#bd-item').classList.contains('hidden'),
}));
await page.fill('#building-search', '');
await page.waitForTimeout(200);
const bdCleared = await page.$$eval('#building-list .building-row', (ns) => ns.length);

const bdTarget = await page.evaluate(() => {
  const hit = window.__robotTown.buildings().find((b) => window.__robotTown.space(b.id) !== null);
  return hit ? { id: hit.id, name: hit.name, type: hit.type } : null;
});
if (!bdTarget) bail('no building has an indoor space, so the buildings dialog cannot be exercised');
await page.click(`#building-list .building-row[data-id="${bdTarget.id}"]`);
await page.waitForTimeout(250);
const bdItem = await page.evaluate((id) => {
  const text = (s) => document.querySelector(s).textContent;
  return {
    noneHidden: document.querySelector('#bd-none').classList.contains('hidden'),
    shown: !document.querySelector('#bd-item').classList.contains('hidden'),
    selected: document.querySelectorAll('#building-list .building-row.selected').length,
    name: text('#bd-name'), type: text('#bd-type'), desc: text('#bd-desc'),
    rowDesc: document.querySelector(`#building-list .building-row[data-id="${id}"] .br-desc`).textContent,
    footprint: text('#bd-footprint'), pos: text('#bd-pos'), crew: text('#bd-crew'),
    space: text('#bd-space'), parts: text('#bd-parts'),
  };
}, bdTarget.id);
await page.screenshot({ path: path.join(shots, '20-buildings-dialog.png') });

// parked in a corner first, so "the camera moved" cannot be satisfied by already being there
await page.evaluate(() => window.__robotTown.flyToPoint(-95, -95));
await page.waitForTimeout(1800);
const poseBeforeFly = await page.evaluate(() => window.__robotTown.cameraPose());
await page.click('#bd-fly');
await page.waitForTimeout(1900);
const bdFly = await page.evaluate(() => ({
  closed: document.querySelector('#buildings-panel').classList.contains('hidden'),
  mapActive: document.querySelector('[data-view="map"]').classList.contains('active'),
  pose: window.__robotTown.cameraPose(),
}));
const bdFlyMoved = JSON.stringify(bdFly.pose) !== JSON.stringify(poseBeforeFly);

// out in town there is no room to place into, and the library stays open to say so
await page.click('[data-view="objects"]');
await page.waitForTimeout(350);
const odRows = await page.$$eval('#object-list .building-row', (ns) => ns.length);
const odType = OBJECT_TYPES[0];
await page.click(`#object-list .building-row[data-id="${odType.id}"]`);
await page.waitForTimeout(250);
const odItem = await page.evaluate(() => {
  const text = (s) => document.querySelector(s).textContent;
  return {
    noneHidden: document.querySelector('#od-none').classList.contains('hidden'),
    shown: !document.querySelector('#od-item').classList.contains('hidden'),
    selected: document.querySelectorAll('#object-list .building-row.selected').length,
    name: text('#od-name'), desc: text('#od-desc'), tags: text('#od-tags'),
    metrics: text('#od-metrics'), room: text('#od-room'),
  };
});
const objectsInTown = await page.evaluate(() => window.__robotTown.objects().length);
await page.click('#od-place');
await page.waitForTimeout(400);
const odRefused = await page.evaluate(() => ({
  stillOpen: !document.querySelector('#objects-panel').classList.contains('hidden'),
  dialogHidden: document.querySelector('#object-panel').classList.contains('hidden'),
  objects: window.__robotTown.objects().length,
  toast: document.querySelector('#toast').textContent,
}));
await page.screenshot({ path: path.join(shots, '21-objects-dialog.png') });

// "Step inside" has to drop the backdrop first: a building with no space raises #space-prompt,
// which sits below it
await page.click('[data-view="buildings"]');
await page.waitForTimeout(300);
await page.click(`#building-list .building-row[data-id="${bdTarget.id}"]`);
await page.waitForTimeout(200);
await page.click('#bd-enter');
await page.waitForTimeout(1400);
const bdEntered = await page.evaluate(() => ({
  interior: window.__robotTown.interior()?.id ?? null,
  closed: document.querySelector('#buildings-panel').classList.contains('hidden'),
  promptHidden: document.querySelector('#space-prompt').classList.contains('hidden'),
  barName: document.querySelector('#interior-name').textContent,
}));

await page.click('[data-view="objects"]');
await page.waitForTimeout(350);
await page.click(`#object-list .building-row[data-id="${odType.id}"]`);
await page.waitForTimeout(200);
const odRoom = (await page.textContent('#od-room')).trim();
const objectsBefore = await page.evaluate(() => window.__robotTown.objects().length);
await page.click('#od-place');
await page.waitForTimeout(700);
const odPlaced = await page.evaluate(() => ({
  objects: window.__robotTown.objects().length,
  selected: window.__robotTown.selectedObject(),
  galleryHidden: document.querySelector('#objects-panel').classList.contains('hidden'),
  shown: !document.querySelector('#object-panel').classList.contains('hidden'),
  name: document.querySelector('#ob-name').textContent,
  toast: document.querySelector('#toast').textContent,
}));
const placedId = odPlaced.selected;
if (!placedId) bail('the objects dialog placed nothing');

// the selected-object dialog is modal now, so its close button has to give the selection back
await page.click('#ob-close');
await page.waitForTimeout(350);
const obClosed = await page.evaluate(() => ({
  hidden: document.querySelector('#object-panel').classList.contains('hidden'),
  selected: window.__robotTown.selectedObject(),
}));
const obAt = await selectByClick(placedId);
if (!obAt) bail(`the object placed from the dialog is not clickable: ${placedId}`);
const obReopened = await page.evaluate(() => ({
  shown: !document.querySelector('#object-panel').classList.contains('hidden'),
  name: document.querySelector('#ob-name').textContent,
  size: document.querySelector('#ob-size').value,
}));
await page.fill('#ob-size', '1.4');
await page.click('#ob-save');
await page.waitForTimeout(600);
const obSaved = await page.evaluate((id) => ({
  scale: window.__robotTown.objects().find((o) => o.id === id)?.scale ?? null,
  toast: document.querySelector('#toast').textContent,
}), placedId);
await page.click('#ob-remove');
await page.waitForTimeout(500);
// re-picked from the canvas, so there is no library behind it to hand back
const obRemoved = await page.evaluate((id) => ({
  gone: window.__robotTown.objects().every((o) => o.id !== id),
  hidden: document.querySelector('#object-panel').classList.contains('hidden'),
  gallery: !document.querySelector('#objects-panel').classList.contains('hidden'),
  toast: document.querySelector('#toast').textContent,
}), placedId);

// the same removal reached from the library does hand it back
await page.click('[data-view="objects"]');
await page.waitForTimeout(300);
await page.click(`#object-list .building-row[data-id="${odType.id}"]`);
await page.waitForTimeout(200);
await page.click('#od-place');
await page.waitForTimeout(600);
const obFromGallery = await page.evaluate(() => ({
  selected: window.__robotTown.selectedObject(),
  galleryHidden: document.querySelector('#objects-panel').classList.contains('hidden'),
}));
await page.click('#ob-remove');
await page.waitForTimeout(500);
const obGalleryBack = await page.evaluate((id) => ({
  gone: window.__robotTown.objects().every((o) => o.id !== id),
  gallery: !document.querySelector('#objects-panel').classList.contains('hidden'),
  navActive: document.querySelector('[data-view="objects"]').classList.contains('active'),
}), obFromGallery.selected);

await page.click('[data-view="settings"]');
await page.waitForTimeout(350);
const stOpen = await page.evaluate(() => ({
  shown: !document.querySelector('#settings-panel').classList.contains('hidden'),
  model: !!document.querySelector('#model-config').offsetParent,
  functions: !!document.querySelector('#functions-config').offsetParent,
  providers: document.querySelectorAll('#provider-list .prov-row').length,
  head: document.querySelector('#settings-panel .cfg-h').textContent,
  keyMasked: document.querySelector('#pf-api-key').type === 'password',
}));
const shadowsA = await page.isChecked('#opt-shadows');
await page.click('#opt-shadows');
await page.waitForTimeout(300);
const shadowsB = await page.isChecked('#opt-shadows');
await page.click('#opt-shadows');
await page.waitForTimeout(300);
const shadowsC = await page.isChecked('#opt-shadows');
await page.screenshot({ path: path.join(shots, '22-settings-dialog.png') });

await page.click('#fn-open');
await page.waitForTimeout(400);
const stFunctions = await page.evaluate(() => {
  const z = (s) => Number(getComputedStyle(document.querySelector(s)).zIndex);
  return {
    fnShown: !document.querySelector('#fn-panel').classList.contains('hidden'),
    stStill: !document.querySelector('#settings-panel').classList.contains('hidden'),
    fnAbove: z('#fn-panel') > z('#settings-panel'),
    interior: window.__robotTown.interior()?.id ?? null,
  };
});
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
const stEscFn = await page.evaluate(() => ({
  fnHidden: document.querySelector('#fn-panel').classList.contains('hidden'),
  stStill: !document.querySelector('#settings-panel').classList.contains('hidden'),
  interior: window.__robotTown.interior()?.id ?? null,
}));

// one Escape closes the dialog and leaves the room alone; the second one is what exits
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
const escInside = await page.evaluate(() => ({
  stHidden: document.querySelector('#settings-panel').classList.contains('hidden'),
  mapActive: document.querySelector('[data-view="map"]').classList.contains('active'),
  interior: window.__robotTown.interior()?.id ?? null,
}));
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const escOut = await page.evaluate(() => window.__robotTown.interior());

await page.click('[data-view="town"]');
await page.waitForTimeout(350);
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
const escTown = await page.evaluate(() => ({
  townHidden: document.querySelector('#town-panel').classList.contains('hidden'),
  mapActive: document.querySelector('[data-view="map"]').classList.contains('active'),
  interior: window.__robotTown.interior(),
}));

console.log('PANELS:', JSON.stringify({
  town: { ...town, summary: town.summary.slice(0, 40) },
  townToRobots,
  navReachable,
  bd: { rows: bdRows, buildings: bdBuildings, none: bdNone, cleared: bdCleared, target: bdTarget.name },
  bdItem: { ...bdItem, desc: bdItem.desc.slice(0, 40) },
  bdFly: { closed: bdFly.closed, mapActive: bdFly.mapActive }, bdFlyMoved,
  odRows, odItem: { ...odItem, desc: odItem.desc.slice(0, 40), room: odItem.room.slice(0, 40) },
  objectsInTown, odRefused, bdEntered, odRoom: odRoom.slice(0, 50), odPlaced,
  obClosed, obReopened, obSaved, obRemoved,
  obFromGallery: { placed: obFromGallery.selected !== null, galleryHidden: obFromGallery.galleryHidden },
  obGalleryBack,
  stOpen, shadows: [shadowsA, shadowsB, shadowsC],
  stFunctions, stEscFn, escInside, escOut: escOut === null, escTown,
}));

const galleryOk =
  gallery.rows === 13 && gallery.withText === 13 && gallery.dotted === 13 && gallery.stat === '13' &&
  JSON.stringify(cafeRows) === JSON.stringify(['Buddy Cafe']) &&
  JSON.stringify(descHit) === JSON.stringify(['City Hall']) &&
  emptyShown && zzzRows === 0 && clearedRows === 13;

const expandOk =
  expandLabel0 === 'Expand · East Quay' &&
  /East Quay connected — 4 new buildings/.test(toastText) &&
  afterFirst.sectors === 2 && afterFirst.buildings === 17 && afterFirst.connected === true &&
  afterFirst.reach > 110 && afterFirst.bounds.maxX > coreBounds.maxX &&
  targetMag > 110 &&
  expandDone.links.every(Boolean) &&
  expandDone.disabled && expandDone.label === 'Map fully expanded' &&
  expandDone.sectors === 5 && expandDone.buildings === 29;

const placeOk =
  bannerVisible && placeActive &&
  overBuilding.bad && /Hospital/.test(overBuilding.text) &&
  freeSpot !== null && fp.onScreen && !freeBanner.bad && /clearance/.test(freeBanner.text) &&
  escHidBanner &&
  picked.site !== null && Math.abs(picked.site.x - freeSpot.x) < 1 && Math.abs(picked.site.z - freeSpot.z) < 1 &&
  picked.aiOpen && !picked.collapsed && picked.input.startsWith('/building') &&
  /Site selected/.test(picked.bubble) && picked.bannerHidden;

const nearSite = review1 !== null && pickedSite !== null &&
  Math.abs(review1.pos[0] - pickedSite.x) < 0.01 && Math.abs(review1.pos[1] - pickedSite.z) < 0.01;

const toolOk =
  nearSite && review1.parts === 5 && card1.name === 'Tall Glass Spire' && /5 parts/.test(card1.meta) &&
  card1.buildings === 29 &&
  afterDiscard.review === null && afterDiscard.buildings === 29 && /Discarded/.test(afterDiscard.note) && afterDiscard.disabled &&
  afterConfirm.review === null && afterConfirm.buildings === 30 &&
  afterConfirm.names.includes('Tall Glass Spire') && afterConfirm.graphLeaf === true &&
  typeof afterConfirm.drivewayNode === 'string' && afterConfirm.drivewayNode.length > 0 &&
  JSON.stringify(galleryFound) === JSON.stringify(['Tall Glass Spire']) && galleryStat === '30' &&
  fenceReview !== null && fenceReview.name === 'Small Kiosk' &&
  /torus/.test(invalidErr) && reviewAfterInvalid.review === null && reviewAfterInvalid.buildings === 30 &&
  toolStats.cors.tools + proxyToolStats.plain.tools >= 4;

const interiorOk =
  noSpacePrompt.shown && /City Hall/.test(noSpacePrompt.text) && /22×22/.test(noSpacePrompt.text) &&
  noSpacePrompt.interior === null && noSpacePrompt.space === null &&
  inside.promptHidden && inside.minimapHidden && inside.compassHidden &&
  inside.barVisible && inside.barName === 'City Hall' && inside.barType === 'cityHall' &&
  inside.interior !== null && inside.interior.id === 'city-hall' && inside.interior.mode === 'interior' &&
  inside.interior.items > 0 && inside.interior.robots >= 3 && inside.interior.robots <= 5 &&
  inside.interior.objects === inside.space.items && inside.space.objects === inside.space.items &&
  inside.interior.room.w === inside.space.floor[0] && inside.interior.room.d === inside.space.floor[1] &&
  inside.space.source === 'default' && inside.space.kinds.length >= 3 && inside.space.built &&
  robotsMoved &&
  exited.interior === null && !exited.minimapHidden && exited.barHidden &&
  exited.spaceKept === 'default' && poseRestored &&
  reentered !== null && reentered.id === 'city-hall' && reentered.objects === reentered.items &&
  hpPrompt.shown && /Hospital/.test(hpPrompt.text) &&
  aiOpened.panelOpen && !aiOpened.collapsed && aiOpened.promptHidden &&
  aiOpened.input.startsWith('/space') && /Hospital/.test(aiOpened.bubble) &&
  /room envelope/.test(aiOpened.bubble) &&
  aiOpened.interior === null &&
  aiSpace.space !== null && aiSpace.space.source === 'ai' &&
  aiSpace.space.name === 'Calm Recovery Ward' && aiSpace.space.items === 8 && aiSpace.space.robots === 3 &&
  aiSpace.space.kinds.includes('bed') && aiSpace.space.built &&
  aiSpace.space.objects === aiSpace.space.items &&
  hpEnv > 10 && aiSpace.space.floor[0] === hpEnv && aiSpace.space.floor[1] === hpEnv &&
  aiSpace.interior !== null && aiSpace.interior.id === 'hospital' && aiSpace.interior.robots === 3 &&
  aiSpace.interior.objects === aiSpace.space.items &&
  /Calm Recovery Ward/.test(aiBubble) && /Hospital/.test(aiSpace.toast) &&
  fenceSpace.space.name === 'Refit Bright Lobby' && fenceSpace.space.source === 'ai' &&
  fenceSpace.space.items === 8 && fenceSpace.interior !== null && fenceSpace.interior.id === 'hospital' &&
  fenceSpace.space.objects === 8 && fenceSpace.interior.objects === 8 &&
  /fountain/.test(spaceErr) && unchanged.name === 'Refit Bright Lobby' && unchanged.interior === 'hospital' &&
  backOut.interior === null && !backOut.minimapHidden && backOut.barHidden &&
  spaceStats.plain.spaces >= 3;

const interiorObjectsOk =
  objEntered.interior !== null && objEntered.interior.id === 'city-hall' && objEntered.promptHidden &&
  objEntered.objects === objEntered.space.items && objEntered.selected === null &&
  objEntered.allSpace && objEntered.allStanding &&
  objEntered.space.source === 'default' && objEntered.space.objects === objEntered.space.items &&
  furnSelected.selected === furnId && furnSelected.panelShown && furnSelected.object.source === 'space' &&
  furnSelected.name.length > 0 && /type /.test(furnSelected.meta) && /Position \(/.test(furnSelected.pos) &&
  furnSaved.object.color === '#7fd4f0' && furnSaved.selected === furnId &&
  furnSaved.groups === FURN && /updated/.test(furnSaved.toast) &&
  furnDrag.delta > 0.5 && furnDrag.landed && furnDrag.poseHeld &&
  furnDrag.after.selected === furnId && furnDrag.after.groups === FURN &&
  objGallery.rows === OBJECT_TYPES.length && objGallery.dotted === OBJECT_TYPES.length &&
  objGallery.panelShown && objGallery.navActive &&
  JSON.stringify(objTagHit) === JSON.stringify([crateType.name]) &&
  objFurnHit.includes('Table') &&
  objNone.rows === 0 && objNone.empty && objCleared === OBJECT_TYPES.length &&
  placed.objects.length === FURN + 1 && crateInst !== null && crateInst.name === crateType.name &&
  placed.selected === crateId && placed.groups === FURN + 1 && placed.panelShown && placed.galleryHidden &&
  placed.navStillActive && placed.name === crateType.name && /type crate/.test(placed.meta) &&
  /4 parts/.test(placed.meta) && /Position \(/.test(placed.pos) &&
  placed.size === '1' && placed.sizeVal === '1.00' &&
  /Supply Crate placed in the room/.test(placed.toast) &&
  crateClicked.selected === crateId && crateClicked.panelShown && crateClicked.name === crateType.name &&
  crateAt !== null && crateAt2 !== null &&
  pendingSave.sizeVal === '1.60' && pendingSave.object.scale === 1 && pendingSave.object.color === null &&
  adjusted.object.scale === 1.6 && adjusted.object.color === '#ff8080' &&
  adjusted.object.material === 'metal' && adjusted.object.shape === 'cylinder' &&
  adjusted.object.attrs.shape === 'cylinder' && adjusted.object.attrs.color === '#ff8080' &&
  adjusted.object.attrs.material === 'metal' && adjusted.object.parts === 4 &&
  adjusted.groups === FURN + 1 && adjusted.selected === crateId && /Supply Crate updated/.test(adjusted.toast) &&
  dragDelta > 0.5 && dragLanded && poseHeld && dragged.groups === FURN + 1 && dragged.selected === crateId &&
  /Position \(/.test(dragged.panelPos) &&
  dragged.panelPos.includes(dragged.pos[0].toFixed(2)) && dragged.panelPos.includes(dragged.pos[1].toFixed(2)) &&
  aiObject.objects.length === FURN + 2 && beacon.name === 'Glowing Beacon' &&
  beacon.source === 'ai' && beacon.typeId === 'custom' && beacon.parts === 4 &&
  aiObject.selected === beacon.id &&
  aiObject.groups === FURN + 2 && aiObject.panelName === 'Glowing Beacon' && /AI design/.test(aiObject.panelMeta) &&
  aiObject.reviewCards === reviewCardsBefore && /Glowing Beacon/.test(aiObject.toast) &&
  /Glowing Beacon — 4 parts/.test(aiObjectBubble) && /City Hall/.test(aiObjectBubble) &&
  fenceObject.names.length === FURN + 3 && fenceObject.names[FURN + 2] === 'Small Plinth' &&
  fenceObject.sources.slice(0, FURN).every((s) => s === 'space') &&
  fenceObject.sources.slice(FURN).every((s) => s === 'library' || s === 'ai') &&
  fenceObject.groups === FURN + 3 &&
  /torus/.test(objectErr) && afterInvalidObject.count === FURN + 3 && afterInvalidObject.groups === FURN + 3 &&
  crateReselected.selected === crateId && crateReselected.name === crateType.name &&
  deriveOpened.panelOpen && !deriveOpened.collapsed && deriveOpened.input.startsWith('/object') &&
  /Reference object: Supply Crate/.test(deriveOpened.bubble) && /type crate/.test(deriveOpened.bubble) &&
  /4 parts/.test(deriveOpened.bubble) &&
  derivedObject.objects.length === FURN + 4 && derivedObject.objects.at(-1).name.startsWith('Derived') &&
  derivedObject.objects.at(-1).source === 'ai' && derivedObject.panelName.startsWith('Derived') &&
  removed.count === FURN + 3 && removed.groups === FURN + 3 && removed.selected === null &&
  removed.panelHidden && removed.galleryShown && /removed/.test(removed.toast) &&
  removed.spaceObjects === FURN + 3 &&
  escSelected === escId && escOne.selected === null && escOne.interior === 'city-hall' && escOne.panelHidden &&
  escTwo.interior === null && escTwo.selected === null && escTwo.barHidden &&
  escTwo.spaceObjects === FURN + 3 &&
  /indoor space you are standing in/.test(strayErr) && strayCount === FURN + 3 &&
  objReentered.interior !== null && objReentered.interior.id === 'city-hall' &&
  objReentered.interior.objects === FURN + 3 && objReentered.space.objects === FURN + 3 &&
  objReentered.objects.length === FURN + 3 && objReentered.selected === null && objReentered.panelHidden &&
  objReentered.objects.map((o) => o.name).includes('Glowing Beacon') &&
  objReentered.objects.map((o) => o.name).includes(crateType.name) &&
  objectStats.plain.objects + objectStatsCors.cors.objects >= 4;

const functionsOk =
  fnOpener.shown && fnOpener.panelShown && fnOpener.dialogHidden && fnOpener.inlineRows === 0 &&
  /system prompt/i.test(fnOpener.hint) && /Open the functions panel/.test(fnOpener.opener) &&
  /^3 functions · \d+ calls? · \d+ custom prompts?$/.test(fnOpener.summary) &&
  fnSection.shown && fnSection.rows === 3 &&
  fnSection.card[0] >= 1000 && fnSection.card[1] >= 700 &&
  JSON.stringify(fnSection.cmds) === JSON.stringify(['/building', '/space', '/object']) &&
  fnSection.labels.every((l) => l.length > 0) &&
  JSON.stringify(fnSection.badges) === JSON.stringify(['Default', 'Default', 'Default']) &&
  fnSection.counts.every((c) => /^\d+ calls?$/.test(c)) && Number.parseInt(fnSection.counts[0], 10) >= 3 &&
  JSON.stringify(fnSection.expanded) === JSON.stringify(['true', 'false', 'false']) &&
  fnSection.detailsHidden === 2 && fnSection.cols === 2 && fnSection.promptCols === 2 &&
  fnEscaped.dialogHidden && fnEscaped.interior === null && fnEscaped.view &&
  fnReopened.shown && fnReopened.selected === 'true' && fnReopened.detailShown &&
  fnBuildingOpen.detailShown && fnBuildingOpen.expanded === 'true' && fnBuildingOpen.badge === 'Default' &&
  fnBuildingOpen.promptWide &&
  fnBuildingOpen.value.includes('Allowed shapes: box, cylinder, sphere, cone, dome') &&
  fnBuildingOpen.value.includes('Call create_building') && !fnBuildingOpen.value.includes('MARKER') &&
  /added after this text automatically/.test(fnBuildingOpen.note) &&
  fnBuildingOpen.saveDisabled && fnBuildingOpen.resetDisabled &&
  fnSaveEnabledDirty &&
  fnSavedPrompt.stored !== null && fnSavedPrompt.stored.includes('MARKER BUILDING:') &&
  fnSavedPrompt.stored.includes('Allowed shapes:') && fnSavedPrompt.value === fnCustomText &&
  fnSavedPrompt.badge === 'Custom' && fnSavedPrompt.saveDisabled && !fnSavedPrompt.resetDisabled &&
  /\/building prompt saved/.test(fnSavedPrompt.toast) &&
  fnBuildingHist.rows >= 4 && fnBuildingHist.rows === fnBuildingHist.statuses.length &&
  fnBuildingHist.statuses[0] === 'Rejected' && fnBuildingHist.statuses.includes('OK') &&
  fnBuildingHist.reqs[0] === '/building [invalid] a broken tower' &&
  fnBuildingHist.countLabel === `${fnBuildingHist.rows} calls` && fnBuildingHist.emptyHidden &&
  fnRejectedCall.open && fnRejectedCall.expanded === 'true' && /torus/.test(fnRejectedCall.status) &&
  /create_building/.test(fnRejectedCall.meta) && /messages?$/.test(fnRejectedCall.meta) &&
  !/never sent/.test(fnRejectedCall.meta) &&
  fnRejectedCall.dump.includes('--- system ---') && fnRejectedCall.dump.includes('--- user ---') &&
  fnRejectedCall.dump.includes('You are the assistant inside Robot City') &&
  fnRejectedCall.dump.includes('Allowed shapes: box, cylinder, sphere, cone, dome') &&
  fnRejectedCall.dump.includes('create_building') &&
  fnRejectedCall.dump.includes('/building [invalid] a broken tower') &&
  fnSpaceSaved.stored === 'MARKER SPACE: design a calm, quiet room.' && fnSpaceSaved.badge === 'Custom' &&
  fnClosed &&
  fnSpPrompt.shown && Number.isFinite(fnEnv) && fnEnv >= 10 &&
  fnSpaceApplied.space !== null && fnSpaceApplied.space.source === 'ai' &&
  fnSpaceApplied.space.items === 8 && fnSpaceApplied.space.built &&
  fnSpaceApplied.space.floor[0] === fnEnv && fnSpaceApplied.space.floor[1] === fnEnv &&
  fnSpaceApplied.interior !== null && fnSpaceApplied.interior.id === fnTarget.id &&
  fnLast !== null && JSON.stringify(fnLast.tools) === JSON.stringify(['create_space']) &&
  fnLast.msgs >= 2 && fnLast.system.includes('MARKER SPACE:') &&
  fnLast.system.includes('Context for this call') && fnLast.system.includes('room envelope:') &&
  !fnLast.system.includes('Allowed item kinds:') &&
  fnSpaceCall.badge === 'OK' && fnSpaceCall.req === '/space a quiet reading room' && fnSpaceCall.open &&
  /Applied/.test(fnSpaceCall.status) && /create_space/.test(fnSpaceCall.meta) &&
  fnSpaceCall.spaceRows >= 4 &&
  fnSpaceCall.dump.includes('MARKER SPACE:') && fnSpaceCall.dump.includes('room envelope:') &&
  fnSpaceCall.dump.includes('You are the assistant inside Robot City') &&
  fnSpaceCall.dump.includes('/space a quiet reading room') &&
  fnObjectHist.rows >= 5 && fnObjectHist.statuses.includes('Blocked') && fnObjectHist.statuses.includes('Rejected') &&
  fnBlockedCall !== null && fnBlockedCall.open &&
  /indoor space you are standing in/.test(fnBlockedCall.status) &&
  /never sent/.test(fnBlockedCall.meta) && /create_object/.test(fnBlockedCall.meta) &&
  fnBlockedCall.dump.includes('create_object') && fnBlockedCall.dump.includes('/object a stray crate') &&
  !fnReset.keys.includes('space') && fnReset.badge === 'Default' &&
  fnReset.value.includes('Allowed item kinds:') && !fnReset.value.includes('MARKER') &&
  fnReset.saveDisabled && fnReset.resetDisabled && /restored to default/.test(fnReset.toast) &&
  JSON.stringify(fnPersist.promptKeys) === JSON.stringify(['building']) &&
  /^3 functions · \d+ calls? · 1 custom prompt$/.test(fnSummaryAfter) &&
  fnPersist.value.includes('MARKER BUILDING:') && fnPersist.badges[0] === 'Custom' &&
  fnPersist.badges[1] === 'Default' && fnPersist.badges[2] === 'Default' &&
  fnPersist.historyCounts.building >= 4 && fnPersist.historyCounts.space >= 5 && fnPersist.historyCounts.object >= 5 &&
  fnPersist.rendered.building === fnPersist.historyCounts.building &&
  fnPersist.rendered.space === fnPersist.historyCounts.space &&
  fnPersist.rendered.object === fnPersist.historyCounts.object;

const suNames = spaceUpdate.objects.map((o) => o.name);
const spaceUpdateOk =
  suBefore.interior !== null && suBefore.interior.id === 'city-hall' &&
  suBefore.furniture === FURN && suBefore.keepers.length === 3 &&
  spaceUpdate.space !== null && spaceUpdate.space.source === 'ai' &&
  spaceUpdate.space.name === 'Refit Brighter Atrium' &&
  spaceUpdate.space.items === 8 && spaceUpdate.space.robots === 3 && spaceUpdate.space.built &&
  spaceUpdate.interior !== null && spaceUpdate.interior.id === 'city-hall' &&
  spaceUpdate.interior.mode === 'interior' &&
  spaceUpdate.interior.name === 'Refit Brighter Atrium' && spaceUpdate.interior.items === 8 &&
  spaceUpdate.interior.objects === 11 &&
  spaceUpdate.objects.length === 11 && spaceUpdate.space.objects === 11 &&
  spaceUpdate.objects.filter((o) => o.source === 'space').length === 8 &&
  suBefore.keepers.every((k) =>
    spaceUpdate.objects.some((o) => o.name === k.name && o.source === k.source)) &&
  suNames.includes('Glowing Beacon') && suNames.includes(crateType.name) && suNames.includes('Small Plinth') &&
  suPoseHeld &&
  /Refit Brighter Atrium/.test(suBubble) && /City Hall/.test(suBubble) &&
  /replaced the room/.test(spaceUpdate.toast) &&
  suLast !== null && JSON.stringify(suLast.tools) === JSON.stringify(['create_space']) &&
  suLast.msgs >= 2 &&
  suLast.system.includes('Current indoor space:') &&
  suLast.system.includes('Redesign this room') &&
  suLast.system.includes('room envelope:') &&
  suLast.system.includes('Glowing Beacon') && suLast.system.includes(crateType.name) &&
  suCall !== null && suCall.open && suCall.badge === 'OK' &&
  /^Updated "Refit Brighter Atrium" in City Hall/.test(suCall.status) &&
  /create_space/.test(suCall.meta) && !/never sent/.test(suCall.meta) &&
  suCall.dump.includes('Current indoor space:') &&
  suCall.dump.includes('/space a brighter atrium') &&
  !suCall.dump.includes('MARKER SPACE:');

const robotsOk =
  rbOpen.dialog && rbOpen.rows === rbRoster0.length && rbRoster0.length > 0 &&
  rbOpen.count === String(rbRoster0.length) &&
  rbOpen.stat === `${rbRoster0.length} robots` &&
  rbOpen.types.length === ROBOT_TYPES.length &&
  rbOpen.types.every((t) => ROBOT_TYPES.some((x) => x.id === t)) &&
  rbOpen.summary === `${rbRoster0.length} in town · `
    + `${rbRoster0.filter((r) => r.source !== 'seed').length} deployed by you · ${ROBOT_TYPES.length} models` &&
  /file upload or a URL/.test(rbOpen.later) &&
  rbOpen.auto && rbOpen.name === rbRoster0[0].name && rbOpen.current === rbRoster0[0].id &&
  rbOpen.canvas.w > 100 && rbOpen.canvas.h > 80 && !rbOpen.canvas.hidden && rbOpen.noteHidden &&
  rbSearchNarrow > 0 && rbSearchNarrow < rbRoster0.length &&
  rbSearchNone.rows === 0 && rbSearchNone.types === 0 && rbSearchNone.empty &&
  rbSearchCleared === rbRoster0.length &&
  rbSelect.id === rbRoster0[1].id && rbSelect.typeHidden &&
  rbSelect.fields.head === rbSelect.rec.name &&
  rbSelect.fields.name === rbSelect.rec.name && rbSelect.fields.model === rbSelect.rec.modelId &&
  rbSelect.fields.color === rbSelect.rec.color && rbSelect.fields.home === rbSelect.rec.home &&
  Number(rbSelect.fields.size) === rbSelect.rec.scale &&
  Number(rbSelect.fields.speed) === rbSelect.rec.speed &&
  rbSelect.fields.sizeOut === rbSelect.rec.scale.toFixed(2) &&
  rbSelect.fields.speedOut === rbSelect.rec.speed.toFixed(1) &&
  rbSelect.fields.homes === rbBuildings &&
  Number(rbSelect.fields.sizeMin) === 0.4 && Number(rbSelect.fields.sizeMax) === 2.5 &&
  /part/.test(rbSelect.status) &&
  rbClosed && rbRoom !== null && rbRoom.id === 'city-hall' &&
  rbRoom.robots >= 3 && rbRoom.robots <= 5 && rbRoom.robotIds.length === rbRoom.robots &&
  rbRoomCollision?.robots === rbRoom.robots && rbRoomCollision.minClearance >= 0 &&
  rbIndoorClick.aimed !== null && rbIndoorClick.picked === rbIndoorClick.aimed &&
  rbIndoorClick.panel && rbIndoorClick.selected === rbIndoorClick.aimed &&
  editId !== null &&
  rbDirty.head === 'Verify Bot' && rbDirty.sizeOut === '1.50' && rbDirty.speedOut === '2.5' &&
  rbEdit.rec.name === 'Verify Bot' && rbEdit.rec.color === '#ff8800' &&
  rbEdit.rec.scale === 1.5 && rbEdit.rec.speed === 2.5 &&
  rbEdit.rec.home === 'city-hall' && rbEdit.rec.indoors === true && rbEdit.rec.pos !== null &&
  rbEdit.nameField === 'Verify Bot' && /updated/.test(rbEdit.toast) &&
  JSON.stringify(rbEdit.interior.robotIds) === JSON.stringify(preEdit.interior.robotIds) &&
  rbEdit.interior.robots === preEdit.interior.robots &&
  rbEdit.interior.objects === preEdit.interior.objects &&
  rbEdit.interior.items === preEdit.interior.items &&
  ['p', 't'].every((k) => rbEdit.pose[k].every((v, i) => Math.abs(v - preEdit.pose[k][i]) < 0.25)) &&
  rbType.itemHidden && rbType.shown && rbType.name === 'Courier' && rbType.home === 'city-hall' &&
  /parts · speed 2\.2/.test(rbType.meta) && rbType.desc.length > 20 &&
  rbDeploy.added.length === 1 && rbDeploy.newId !== null &&
  rbDeploy.interior.robots === preEdit.interior.robots + 1 &&
  rbDeploy.roster === rbRoster0.length + 1 &&
  rbDeploy.stat === `${rbRoster0.length + 1} robots` &&
  rbDeploy.rec.modelId === 'courier' && rbDeploy.rec.source === 'deploy' &&
  rbDeploy.rec.home === 'city-hall' && rbDeploy.rec.indoors === true &&
  rbDeploy.selected === rbDeploy.newId && /deployed to City Hall/.test(rbDeploy.toast) &&
  rbReassign.interior.still === false &&
  rbReassign.interior.robots === preEdit.interior.robots &&
  rbReassign.rec.home === 'hospital' && rbReassign.rec.homeName === 'Hospital' &&
  rbReassign.rec.indoors === false && rbReassign.rec.pos !== null &&
  /updated/.test(rbReassign.toast) &&
  rbRemove.roster === rbRoster0.length && rbRemove.rows === rbRoster0.length &&
  rbRemove.none && rbRemove.itemHidden &&
  rbRemove.stat === `${rbRoster0.length} robots` && /removed from the roster/.test(rbRemove.toast) &&
  rbUni !== null && rbFocusPrompt.dialogHidden && rbFocusPrompt.prompt &&
  rbFocus.interior.id === 'university' && rbFocus.interior.has === true &&
  rbFocus.rec.home === 'university' && rbFocus.rec.indoors === true && rbFocus.inRoom === true &&
  rbEscOpen && rbEscape.dialog && rbEscape.interior === 'university' && rbEscTwice === null &&
  rbCrowd.total === rbRoster0.length && rbCrowd.visible > 0 && rbCrowd.meshes > 0 &&
  rbCrowd.inWorldGroups === false && rbCrowd.moved && rbCrowd.yields > 0 && rbCrowd.minClearance >= 0 &&
  rbPovButton && rbStreetPovId !== null &&
  rbStreetPovA.pov?.id === rbStreetPovId && rbStreetPovA.pov.location === 'town' &&
  rbStreetPovA.pov.controlsEnabled === false && rbStreetPovA.overlay && rbStreetPovA.panelHidden &&
  rbStreetPovB?.id === rbStreetPovId &&
  JSON.stringify(rbStreetPovA.pov.camera) !== JSON.stringify(rbStreetPovB.camera) &&
  rbStreetPovExit.pov === null && rbStreetPovExit.overlayHidden &&
  ['p', 't'].every((k) => rbStreetPovExit.pose[k].every((v, i) => Math.abs(v - rbStreetBefore[k][i]) < 0.5)) &&
  rbIndoorPov.pov?.id === editId && rbIndoorPov.pov.location === 'interior' &&
  rbIndoorPov.pov.controlsEnabled === false && rbIndoorPov.overlay &&
  rbIndoorPov.interior?.id === 'city-hall' && rbIndoorPov.interior.robotIds.includes(editId) &&
  rbIndoorPovExit.pov === null && rbIndoorPovExit.interior === null &&
  ['p', 't'].every((k) => rbIndoorPovExit.pose[k].every((v, i) => Math.abs(v - rbIndoorBefore[k][i]) < 0.5)) &&
  rbPersist.interior.id === 'city-hall' && rbPersist.interior.has === true &&
  rbPersist.rec.name === 'Verify Bot' && rbPersist.rec.color === '#ff8800' &&
  rbPersist.rec.scale === 1.5 && rbPersist.rec.speed === 2.5 &&
  rbPersist.rec.modelId === rbEdit.rec.modelId && rbPersist.rec.indoors === true;

const townStatsOk = Object.keys(town.stats).every((k) => town.stats[k] === town.expect[k]);

const panelsOk =
  town.shown && town.navActive && townStatsOk && town.summary === town.expectSummary &&
  /operational|Inside/.test(town.status) &&
  townToRobots.townHidden && townToRobots.robotsShown && townToRobots.navActive &&
  navReachable.length === 6 && navReachable.every(Boolean) &&
  bdRows === bdBuildings && bdBuildings > 0 &&
  bdNone.rows === 0 && bdNone.empty && bdNone.detailHidden && bdCleared === bdBuildings &&
  bdItem.noneHidden && bdItem.shown && bdItem.selected === 1 &&
  bdItem.name === bdTarget.name && bdItem.type === bdTarget.type &&
  bdItem.desc === bdItem.rowDesc && bdItem.desc.length > 0 &&
  /units across/.test(bdItem.footprint) && /^\(-?\d+, -?\d+\)$/.test(bdItem.pos) &&
  /^\d+ robots?$/.test(bdItem.crew) && /·/.test(bdItem.space) &&
  (bdItem.parts === 'Built-in design' || /^\d+ parts$/.test(bdItem.parts)) &&
  bdFly.closed && bdFly.mapActive && bdFlyMoved &&
  odRows === OBJECT_TYPES.length &&
  odItem.noneHidden && odItem.shown && odItem.selected === 1 &&
  odItem.name === odType.name && odItem.desc === odType.desc &&
  odItem.tags === `Search tags: ${odType.tags}` && /part/.test(odItem.metrics) &&
  /out in town/.test(odItem.room) &&
  odRefused.stillOpen && odRefused.dialogHidden &&
  odRefused.objects === objectsInTown && /Enter a building/.test(odRefused.toast) &&
  bdEntered.interior === bdTarget.id && bdEntered.closed && bdEntered.promptHidden &&
  bdEntered.barName === bdTarget.name &&
  /Placing into/.test(odRoom) &&
  odPlaced.objects === objectsBefore + 1 && odPlaced.selected !== null &&
  odPlaced.galleryHidden && odPlaced.shown && odPlaced.name === odType.name &&
  /placed in the room/.test(odPlaced.toast) &&
  obClosed.hidden && obClosed.selected === null &&
  obAt !== null && obReopened.shown && obReopened.name === odType.name && obReopened.size === '1' &&
  obSaved.scale === 1.4 && /updated/.test(obSaved.toast) &&
  obRemoved.gone && obRemoved.hidden && !obRemoved.gallery && /removed/.test(obRemoved.toast) &&
  obFromGallery.selected !== null && obFromGallery.galleryHidden &&
  obGalleryBack.gone && obGalleryBack.gallery && obGalleryBack.navActive &&
  stOpen.shown && stOpen.model && stOpen.functions && stOpen.providers > 0 &&
  stOpen.head === 'Display' && stOpen.keyMasked &&
  shadowsA !== shadowsB && shadowsB !== shadowsC && shadowsA === shadowsC &&
  stFunctions.fnShown && stFunctions.stStill && stFunctions.fnAbove &&
  stFunctions.interior === bdTarget.id &&
  stEscFn.fnHidden && stEscFn.stStill && stEscFn.interior === bdTarget.id &&
  escInside.stHidden && escInside.mapActive && escInside.interior === bdTarget.id &&
  escOut === null &&
  escTown.townHidden && escTown.mapActive && escTown.interior === null;

// the AI phase deliberately triggers a 401 (bad-key test) and CORS-blocked direct
// probes (proxy fallback); the browser logs those itself, so allowlist exactly them
const isExpectedAiNoise = (t) =>
  /CORS policy|blocked by CORS|ERR_BLOCKED_BY|Failed to fetch/i.test(t) ||
  /Failed to load resource: the server responded with a status of 401/.test(t) ||
  /Failed to load resource: net::ERR_FAILED/.test(t);
const aiErrors = errors.slice(townErrors.length, aiPhaseEnd).filter((t) => !isExpectedAiNoise(t));
// the tool flow talks to the no-CORS provider through the dev proxy, so the direct
// attempt logs the same blocked-by-CORS line; nothing else is acceptable
const newErrors = errors.slice(aiPhaseEnd).filter((t) => !isExpectedAiNoise(t));
console.log('CONSOLE_ERRORS:', townErrors.length ? townErrors : 'none',
  '| AI_PHASE:', aiErrors.length ? aiErrors : 'none',
  '| NEW_PHASES:', newErrors.length ? newErrors : 'none');
console.log('PHASES:', JSON.stringify({
  galleryOk, expandOk, placeOk, toolOk, interiorOk, interiorObjectsOk, spaceUpdateOk, functionsOk,
  robotsOk, panelsOk,
}));
const pass =
  tip === 'City Hall' && tipVisible && moved && townErrors.length === 0 && aiOk &&
  galleryOk && expandOk && placeOk && toolOk && interiorOk && interiorObjectsOk &&
  spaceUpdateOk && functionsOk && robotsOk && panelsOk &&
  aiErrors.length === 0 && newErrors.length === 0;
console.log(pass ? 'VERIFY PASS' : 'VERIFY FAIL');

await browser.close();
mock.kill();
dev.kill();
process.exit(pass ? 0 : 1);
