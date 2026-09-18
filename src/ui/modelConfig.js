import { normalizeBaseUrl, listModels } from '../ai/client.js';

export function initModelConfig({ store, toast }) {
  const $ = (s) => document.querySelector(s);
  const listEl = $('#provider-list');
  const form = $('#provider-form');
  const nameEl = $('#pf-name');
  const urlEl = $('#pf-base-url');
  const keyEl = $('#pf-api-key');
  const saveBtn = $('#pf-save');
  const testBtn = $('#pf-test');
  const cancelBtn = $('#pf-cancel');
  const statusEl = $('#pf-status');
  const modelRow = $('#pf-model-row');
  const filterEl = $('#pf-model-filter');
  const modelEl = $('#pf-model');

  let draft = null;
  let testing = false;

  const provider = (id) => store.getState().providers.find((p) => p.id === id) || null;

  function renderList() {
    const state = store.getState();
    listEl.replaceChildren();
    for (const p of state.providers) {
      const row = document.createElement('div');
      row.className = 'prov-row';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'ai-active';
      radio.checked = p.id === state.activeProviderId;
      radio.title = 'Use this provider for the AI assistant';
      radio.addEventListener('change', () => store.setActiveProvider(p.id));

      const name = document.createElement('span');
      name.className = 'prov-name';
      name.textContent = p.name;
      name.title = p.baseUrl;

      const model = document.createElement('span');
      model.className = 'prov-model muted';
      model.textContent = p.model;

      const badge = document.createElement('span');
      badge.className = `badge ${p.status === 'ok' ? 'ok' : p.status === 'error' ? 'err' : 'untested'}`;
      badge.textContent = p.status === 'ok' ? 'Ready' : p.status === 'error' ? 'Error' : 'Untested';
      badge.title = p.statusMessage;

      const sub = document.createElement('div');
      sub.className = 'prov-sub';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'prov-edit';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => openDraft(p.id));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'prov-del';
      del.textContent = '×';
      del.title = 'Delete provider';
      del.addEventListener('click', () => {
        store.deleteProvider(p.id);
        if (draft && draft.id === p.id) closeDraft();
      });

      sub.append(model, edit, del);
      row.append(radio, name, badge, sub);
      listEl.appendChild(row);
    }
  }

  function currentTriple() {
    return [
      nameEl.value,
      urlEl.value,
      draft && draft.id ? keyEl.value || draft.savedApiKey : keyEl.value,
    ];
  }

  function isDirty() {
    if (!draft) return false;
    if (!draft.id) return true;
    return JSON.stringify(currentTriple()) !== JSON.stringify(draft.savedTriple);
  }

  function syncStatus() {
    const p = draft && draft.id ? provider(draft.id) : null;
    statusEl.classList.toggle('hidden', !(p && p.statusMessage));
    statusEl.classList.toggle('ok', !!p && p.status === 'ok');
    statusEl.classList.toggle('err', !!p && p.status === 'error');
    statusEl.textContent = p ? p.statusMessage : '';
  }

  function renderModelOptions() {
    const p = draft && draft.id ? provider(draft.id) : null;
    if (!p) return;
    const q = filterEl.value.trim().toLowerCase();
    const committed = p.model;
    const subset = p.models.filter((m) => !q || m.toLowerCase().includes(q));
    const opts = committed && !subset.includes(committed) ? [committed, ...subset] : subset;
    modelEl.replaceChildren();
    if (!committed) {
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = 'Select a model…';
      modelEl.appendChild(ph);
    }
    for (const m of opts) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      modelEl.appendChild(o);
    }
    modelEl.value = committed || '';
  }

  function update() {
    if (!draft) return;
    const valid =
      nameEl.value.trim() !== '' &&
      normalizeBaseUrl(urlEl.value) !== null &&
      (draft.id ? true : keyEl.value.trim() !== '');
    saveBtn.disabled = !valid;

    const clean = draft.id !== null && !isDirty();
    testBtn.disabled = !(clean && !testing);
    testBtn.title = clean ? '' : 'Save changes first';

    const p = draft.id ? provider(draft.id) : null;
    const hasModels = !!(p && p.status === 'ok' && p.models.length);
    modelRow.classList.toggle('hidden', !hasModels);
    filterEl.disabled = !hasModels || !clean;
    modelEl.disabled = !hasModels || !clean;
    if (hasModels) renderModelOptions();
  }

  function openDraft(id) {
    const p = id ? provider(id) : null;
    draft = { id, savedApiKey: p ? p.apiKey : '', savedTriple: null };
    nameEl.value = p ? p.name : '';
    urlEl.value = p ? p.baseUrl : '';
    keyEl.value = '';
    keyEl.placeholder =
      p && p.apiKey
        ? `Saved (…${p.apiKey.slice(-4)}) — leave blank to keep`
        : 'API key (stored in this browser only)';
    draft.savedTriple = p ? [p.name, p.baseUrl, p.apiKey] : null;
    filterEl.value = '';
    form.classList.remove('hidden');
    syncStatus();
    update();
  }

  function closeDraft() {
    draft = null;
    form.classList.add('hidden');
    nameEl.value = '';
    urlEl.value = '';
    keyEl.value = '';
    statusEl.classList.add('hidden');
    modelRow.classList.add('hidden');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!draft || saveBtn.disabled) return;
    const name = nameEl.value.trim();
    const baseUrl = normalizeBaseUrl(urlEl.value);
    const key = keyEl.value.trim();
    if (draft.id) {
      const p = provider(draft.id);
      const effKey = key || p.apiKey;
      const credsChanged = baseUrl !== normalizeBaseUrl(p.baseUrl) || effKey !== p.apiKey;
      store.updateProvider(draft.id, {
        name,
        baseUrl,
        apiKey: effKey,
        ...(credsChanged
          ? {
              status: 'untested',
              statusMessage: 'Credentials changed — re-test to reload models.',
              testedAt: 0,
              models: [],
              model: '',
            }
          : {}),
      });
      draft.savedApiKey = effKey;
      draft.savedTriple = [name, baseUrl, effKey];
    } else {
      const id = store.addProvider({ name, baseUrl, apiKey: key });
      draft.id = id;
      draft.savedApiKey = key;
      draft.savedTriple = [name, baseUrl, key];
      keyEl.placeholder = `Saved (…${key.slice(-4)}) — leave blank to keep`;
    }
    urlEl.value = baseUrl;
    keyEl.value = '';
    toast('Provider saved');
    renderList();
    syncStatus();
    update();
  });

  testBtn.addEventListener('click', async () => {
    if (!draft || !draft.id || testBtn.disabled) return;
    const id = draft.id;
    testing = true;
    testBtn.textContent = 'Testing…';
    update();
    try {
      const r = await listModels(provider(id), store);
      if (r.ok) {
        const p = provider(id);
        store.updateProvider(id, {
          status: 'ok',
          models: r.models,
          testedAt: Date.now(),
          statusMessage: `${r.models.length} models · ${r.viaProxy ? 'dev proxy' : 'direct'}`,
          model: r.models.length === 1 ? r.models[0] : r.models.includes(p.model) ? p.model : '',
        });
      } else {
        store.updateProvider(id, {
          status: 'error',
          statusMessage: r.message,
          testedAt: Date.now(),
          models: [],
          model: '',
        });
      }
    } catch (err) {
      store.updateProvider(id, {
        status: 'error',
        statusMessage: `Test failed: ${err.message}`,
        models: [],
        model: '',
      });
    } finally {
      testing = false;
      testBtn.textContent = 'Test connection';
      renderList();
      syncStatus();
      update();
    }
  });

  cancelBtn.addEventListener('click', closeDraft);
  $('#provider-add').addEventListener('click', () => openDraft(null));
  filterEl.addEventListener('input', renderModelOptions);
  modelEl.addEventListener('change', () => {
    if (!draft || !draft.id) return;
    store.updateProvider(draft.id, { model: modelEl.value });
    store.setActiveProvider(draft.id);
    renderList();
  });
  [nameEl, urlEl, keyEl].forEach((el) => el.addEventListener('input', update));

  store.subscribe(() => {
    renderList();
    syncStatus();
    update();
  });
  renderList();
}
