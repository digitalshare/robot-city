import { FUNCTIONS } from '../ai/functions.js';

const STATUS_LABEL = {
  sending: 'Sending',
  ok: 'OK',
  rejected: 'Rejected',
  unreadable: 'Unreadable',
  blocked: 'Blocked',
  error: 'Error',
};

// ok is green, a gate that stopped the design is amber, a lost request is red
const STATUS_TONE = {
  sending: 'err',
  ok: 'ok',
  rejected: 'warn',
  unreadable: 'warn',
  blocked: 'warn',
  error: 'err',
};

function timeOf(at) {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour12: false }) : '--:--:--';
}

// The whole final prompt context, in the order it was sent. One textContent assignment: nothing
// a model or a user typed is ever parsed as markup.
function dumpText(call) {
  return call.messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n\n');
}

export function initFunctions({ fnStore, toast }) {
  const panel = document.querySelector('#fn-panel');
  const listEl = document.querySelector('#fn-list');
  const detailEl = document.querySelector('#fn-detail');
  const summaryEl = document.querySelector('#fn-summary');
  const closeBtn = document.querySelector('#fn-close');
  const openCall = new Map();
  let selected = null;

  function meta(call) {
    const bits = [call.model, call.provider].filter(Boolean);
    if (call.status !== 'blocked' && call.status !== 'sending') bits.push(`${call.ms} ms`);
    if (call.viaProxy) bits.push('dev proxy');
    bits.push(...call.tools);
    bits.push(`${call.messages.length} message${call.messages.length === 1 ? '' : 's'}`);
    if (call.status === 'blocked') bits.push('never sent');
    return bits.join(' · ');
  }

  function renderHistory(fn) {
    const hist = document.querySelector(`#fn-hist-${fn.id}`);
    const empty = document.querySelector(`#fn-empty-${fn.id}`);
    const calls = fnStore.history(fn.id);
    empty.classList.toggle('hidden', calls.length > 0);
    const shown = openCall.get(fn.id);
    if (shown && !calls.some((c) => c.id === shown)) openCall.delete(fn.id);

    const rows = calls.map((call) => {
      const wrap = document.createElement('div');
      wrap.className = 'fn-call';

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'fn-call-row';
      head.setAttribute('aria-expanded', String(openCall.get(fn.id) === call.id));
      head.setAttribute('aria-controls', `fn-call-${call.id}`);
      head.title = call.request;

      const when = document.createElement('span');
      when.className = 'fn-call-time';
      when.textContent = timeOf(call.at);

      const req = document.createElement('span');
      req.className = 'fn-call-req';
      req.textContent = call.request || '(no text)';

      const badge = document.createElement('span');
      badge.className = `badge ${STATUS_TONE[call.status] || 'untested'}`;
      badge.textContent = STATUS_LABEL[call.status] || call.status;

      head.append(when, req, badge);
      head.addEventListener('click', () => {
        openCall.set(fn.id, openCall.get(fn.id) === call.id ? null : call.id);
        renderHistory(fn);
      });

      const detail = document.createElement('div');
      detail.className = 'fn-call-detail';
      detail.id = `fn-call-${call.id}`;
      detail.classList.toggle('hidden', openCall.get(fn.id) !== call.id);

      const status = document.createElement('span');
      status.className = 'fn-call-status';
      status.textContent = call.statusText || STATUS_LABEL[call.status] || call.status;

      const info = document.createElement('span');
      info.className = 'muted fn-call-meta';
      info.textContent = meta(call);

      const dump = document.createElement('pre');
      dump.className = 'fn-dump';
      dump.textContent = dumpText(call);

      detail.append(status, info, dump);
      wrap.append(head, detail);
      return wrap;
    });

    hist.replaceChildren(...rows);
  }

  function syncRow(fn) {
    const prompt = document.querySelector(`#fn-prompt-${fn.id}`);
    const save = document.querySelector(`#fn-save-${fn.id}`);
    const reset = document.querySelector(`#fn-reset-${fn.id}`);
    const badge = document.querySelector(`#fn-badge-${fn.id}`);
    const count = document.querySelector(`#fn-count-${fn.id}`);
    const effective = fnStore.effectivePrompt(fn.id);

    badge.textContent = fnStore.isCustom(fn.id) ? 'Custom' : 'Default';
    badge.className = `badge ${fnStore.isCustom(fn.id) ? 'ok' : 'untested'}`;
    const n = fnStore.history(fn.id).length;
    count.textContent = `${n} call${n === 1 ? '' : 's'}`;
    save.disabled = prompt.value.trim() === effective.trim();
    reset.disabled = !fnStore.isCustom(fn.id);
  }

  function syncSummary() {
    const calls = FUNCTIONS.reduce((n, fn) => n + fnStore.history(fn.id).length, 0);
    const custom = FUNCTIONS.filter((fn) => fnStore.isCustom(fn.id)).length;
    summaryEl.textContent =
      `${FUNCTIONS.length} functions · ${calls} call${calls === 1 ? '' : 's'} · ` +
      `${custom} custom prompt${custom === 1 ? '' : 's'}`;
  }

  function refill(fn) {
    document.querySelector(`#fn-prompt-${fn.id}`).value = fnStore.effectivePrompt(fn.id);
    syncRow(fn);
  }

  function buildRow(fn) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'fn-row';
    row.id = `fn-row-${fn.id}`;
    row.setAttribute('aria-expanded', 'false');
    row.setAttribute('aria-controls', `fn-detail-${fn.id}`);

    const top = document.createElement('span');
    top.className = 'fn-row-top';

    const cmd = document.createElement('span');
    cmd.className = 'fn-cmd';
    cmd.textContent = fn.command;

    const label = document.createElement('span');
    label.className = 'fn-label';
    label.textContent = fn.label;

    top.append(cmd, label);

    const sub = document.createElement('span');
    sub.className = 'fn-row-sub';

    const badge = document.createElement('span');
    badge.id = `fn-badge-${fn.id}`;

    const count = document.createElement('span');
    count.id = `fn-count-${fn.id}`;
    count.className = 'muted fn-count';

    sub.append(badge, count);
    row.append(top, sub);
    row.addEventListener('click', () => select(fn.id));
    return row;
  }

  function buildDetail(fn) {
    const detail = document.createElement('div');
    detail.className = 'fn-detail';
    detail.id = `fn-detail-${fn.id}`;
    detail.classList.add('hidden');

    const head = document.createElement('h3');
    head.className = 'fn-detail-h';

    const cmd = document.createElement('span');
    cmd.className = 'fn-cmd';
    cmd.textContent = fn.command;

    const label = document.createElement('span');
    label.textContent = ` ${fn.label}`;

    head.append(cmd, label);

    const desc = document.createElement('p');
    desc.className = 'muted fn-desc';
    desc.textContent = fn.desc;

    const cols = document.createElement('div');
    cols.className = 'fn-cols';

    const promptCol = document.createElement('div');
    promptCol.className = 'fn-col';

    const pl = document.createElement('label');
    pl.className = 'fn-pl';
    pl.htmlFor = `fn-prompt-${fn.id}`;
    pl.textContent = 'System prompt';

    const prompt = document.createElement('textarea');
    prompt.className = 'fn-prompt';
    prompt.id = `fn-prompt-${fn.id}`;
    prompt.rows = 16;
    prompt.spellcheck = false;
    prompt.value = fnStore.effectivePrompt(fn.id);
    prompt.addEventListener('input', () => syncRow(fn));

    const note = document.createElement('p');
    note.className = 'muted fn-note';
    note.textContent =
      'Sent as the system message for this function. The facts for each call — the surveyed site, ' +
      "the building's room envelope, the standing room and its objects, any reference object — are " +
      'added after this text automatically.';

    const actions = document.createElement('div');
    actions.className = 'fn-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.id = `fn-save-${fn.id}`;
    save.className = 'btn-primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      fnStore.setPrompt(fn.id, prompt.value);
      refill(fn);
      toast(`${fn.command} prompt saved`);
    });

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.id = `fn-reset-${fn.id}`;
    reset.className = 'btn-ghost';
    reset.textContent = 'Restore default';
    reset.addEventListener('click', () => {
      fnStore.resetPrompt(fn.id);
      refill(fn);
      toast(`${fn.command} prompt restored to default`);
    });

    actions.append(save, reset);
    promptCol.append(pl, prompt, note, actions);

    const histCol = document.createElement('div');
    histCol.className = 'fn-col';

    const histH = document.createElement('h4');
    histH.className = 'fn-hist-h';
    histH.textContent = 'Call history';

    const hist = document.createElement('div');
    hist.className = 'fn-hist';
    hist.id = `fn-hist-${fn.id}`;

    const empty = document.createElement('p');
    empty.className = 'muted fn-hist-empty';
    empty.id = `fn-empty-${fn.id}`;
    empty.textContent = 'No calls yet.';

    histCol.append(histH, hist, empty);
    cols.append(promptCol, histCol);
    detail.append(head, desc, cols);
    return detail;
  }

  // Every detail block exists from the start and is only toggled, so a half-typed draft survives
  // both a selection switch and a store notification.
  function select(id) {
    selected = id;
    for (const fn of FUNCTIONS) {
      const on = fn.id === id;
      document.querySelector(`#fn-detail-${fn.id}`).classList.toggle('hidden', !on);
      document.querySelector(`#fn-row-${fn.id}`).setAttribute('aria-expanded', String(on));
    }
  }

  listEl.replaceChildren(...FUNCTIONS.map(buildRow));
  detailEl.replaceChildren(...FUNCTIONS.map(buildDetail));
  for (const fn of FUNCTIONS) {
    syncRow(fn);
    renderHistory(fn);
  }
  syncSummary();

  closeBtn.addEventListener('click', close);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) close();
  });

  // A call finishing while an editor is open must not touch the textarea, so this re-renders the
  // nav rows, the history lists and the summary only.
  fnStore.subscribe(() => {
    for (const fn of FUNCTIONS) {
      syncRow(fn);
      renderHistory(fn);
    }
    syncSummary();
  });

  function open() {
    panel.classList.remove('hidden');
    if (!selected) select(FUNCTIONS[0].id);
  }

  function close() {
    panel.classList.add('hidden');
  }

  function isOpen() {
    return !panel.classList.contains('hidden');
  }

  return { open, close, isOpen };
}
