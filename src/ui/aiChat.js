import { chat } from '../ai/client.js';
import { getActive } from '../ai/config.js';
import {
  extractToolCall, validateBuildingSpec, validateSpaceSpec, validateObjectSpec,
} from '../ai/tools.js';
import { functionById, composePrompt } from '../ai/functions.js';
import { world } from '../town/world.js';
import { roomEnvelope } from '../town/spaces.js';
import { resolveParts, objectMetrics, effectiveAttrs } from '../town/objects.js';

// Rebuilt per request: the town grows (docked sectors, confirmed AI buildings), and a
// prompt frozen at module load would never tell the model about any of it.
function systemPrompt() {
  return {
    role: 'system',
    content:
      'You are the assistant inside Robot City, an interactive 3D map of a small robot-built town. ' +
      `The town contains these buildings: ${world.buildings.map((b) => b.name).join(', ')}. ` +
      'Answer questions about the town and general questions helpfully and briefly. ' +
      'Reply in plain text; preserve newlines; do not use markdown.',
  };
}

const BUILDING_RE = /^\/building(\s|$)/i;
const SPACE_RE = /^\/space(\s|$)/i;
const OBJECT_RE = /^\/object(\s|$)/i;
const MAX_SHOWN_ERRORS = 6;

export function initAiChat({ store, toast, fnStore, openSettings, api }) {
  const $ = (s) => document.querySelector(s);
  const panel = $('#ai-panel');
  const navBtn = $('#nav-ai');
  const collapseBtn = $('#ai-collapse');
  const label = $('#ai-model-label');
  const messagesEl = $('#ai-messages');
  const emptyEl = $('#ai-empty');
  const form = $('#ai-composer');
  const input = $('#ai-input');
  const sendBtn = $('#ai-send');

  const history = [];
  let pending = false;
  let liveCard = null;
  // the building a /space request designs for, set when the user asks for a room from the map
  let spaceRef = null;
  // snapshot of the object a /object request derives from, set by the panel's "Derive with AI"
  let objectRef = null;

  function addBubble(kind, text) {
    const wrap = document.createElement('div');
    wrap.className = `ai-msg ${kind}`;
    const body = document.createElement('div');
    body.className = 'ai-msg-body';
    body.textContent = text;
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    return wrap;
  }

  function stickToBottom(force) {
    const gap = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    if (force || gap < 48) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function syncReady() {
    const active = getActive(store.getState());
    label.textContent = active ? `${active.model} · ${active.provider.name}` : 'No model configured';
    emptyEl.classList.toggle('hidden', !!active);
    sendBtn.disabled = !active || pending;
    input.disabled = pending;
  }

  // ---- review card ----

  function resolveCard(card, note) {
    if (!card) return;
    card.classList.add('resolved');
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    const n = card.querySelector('.rv-note');
    n.textContent = note;
    n.classList.remove('hidden');
    if (liveCard === card) liveCard = null;
  }

  // Every string here comes from the model, so it all goes in through textContent.
  function addReviewCard(spec, spot) {
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg review';
    const body = document.createElement('div');
    body.className = 'ai-msg-body';

    const name = document.createElement('b');
    name.className = 'rv-name';
    name.textContent = spec.name;

    const desc = document.createElement('span');
    desc.className = 'rv-desc';
    desc.textContent = spec.description;

    const meta = document.createElement('span');
    meta.className = 'rv-meta';
    meta.textContent =
      `${spec.parts.length} part${spec.parts.length === 1 ? '' : 's'} · ` +
      `height ${spec.height.toFixed(1)} · footprint ${spec.footprint.toFixed(1)} · ` +
      `site (${spot.x.toFixed(0)}, ${spot.z.toFixed(0)})`;

    const actions = document.createElement('div');
    actions.className = 'rv-actions';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-primary';
    confirmBtn.textContent = 'Confirm';
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'btn-ghost';
    discardBtn.textContent = 'Discard';
    actions.append(confirmBtn, discardBtn);

    const note = document.createElement('span');
    note.className = 'rv-note hidden';

    body.append(name, desc, meta, actions, note);
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);

    confirmBtn.addEventListener('click', () => {
      const def = api.commitReview();
      if (!def) return;
      resolveCard(wrap, 'Confirmed — added to the building library and gallery.');
      toast(`${def.name} is now part of the town.`);
    });
    discardBtn.addEventListener('click', () => {
      api.discardReview();
      resolveCard(wrap, 'Discarded — the design was removed from the map.');
    });

    liveCard = wrap;
    return wrap;
  }

  function errorList(errors) {
    const shown = errors.slice(0, MAX_SHOWN_ERRORS);
    const rest = errors.length - shown.length;
    return shown.map((e) => `• ${e}`).join('\n') + (rest > 0 ? `\n• …and ${rest} more` : '');
  }

  // The model's reply is data. It is extracted, whitelisted and range-checked before
  // anything reaches three.js, and the human — not a second model round trip — decides
  // whether the result joins the town. Each handler returns the outcome for the call
  // history in Settings → Functions.
  function handleBuildingReply(result, site) {
    const args = extractToolCall(result);
    if (!args) {
      history.push({ role: 'assistant', content: result.text });
      const raw = result.text ? `\n\n${result.text.slice(0, 600)}` : '';
      addBubble('error', `I could not read a building design from that reply.${raw}`);
      return { status: 'unreadable', statusText: 'No create_building call in the reply.' };
    }

    const v = validateBuildingSpec(args, site);
    if (!v.ok) {
      history.push({ role: 'assistant', content: `Design rejected: ${v.errors.join('; ')}`.slice(0, 600) });
      addBubble('error', `That design was rejected:\n${errorList(v.errors)}`);
      return { status: 'rejected', statusText: v.errors.join('; ') };
    }

    const previous = liveCard;
    const res = api.beginReview(v.spec, site);
    if (!res || !res.ok) {
      const message = res?.message || 'That design could not be placed on the map.';
      addBubble('error', message);
      return { status: 'error', statusText: message };
    }
    resolveCard(previous, 'Superseded by a newer design.');

    const spec = v.spec;
    history.push({
      role: 'assistant',
      content:
        `Proposed building "${spec.name}" — ${spec.parts.length} parts, footprint ${spec.footprint.toFixed(1)}, ` +
        `height ${spec.height.toFixed(1)}, sited at (${res.spot.x.toFixed(1)}, ${res.spot.z.toFixed(1)}). Awaiting confirmation.`,
    });
    addReviewCard(spec, res.spot);
    api.clearPendingSite();
    return {
      status: 'ok',
      statusText:
        `Proposed "${spec.name}" — ${spec.parts.length} parts, sited at ` +
        `(${res.spot.x.toFixed(1)}, ${res.spot.z.toFixed(1)}). Awaiting confirmation.`,
    };
  }

  // A room needs no review state: there is nothing to site on the map, and the user is standing in
  // the result the moment it validates, so leaving it is the discard. A redesign is already standing
  // there too — applySpace rebuilds the room in place — so the camera stays where it was.
  function handleSpaceReply(result, def, updating) {
    const args = extractToolCall(result);
    if (!args) {
      history.push({ role: 'assistant', content: result.text });
      const raw = result.text ? `\n\n${result.text.slice(0, 600)}` : '';
      addBubble('error', `I could not read a room design from that reply.${raw}`);
      return { status: 'unreadable', statusText: 'No create_space call in the reply.' };
    }

    const v = validateSpaceSpec(args, def);
    if (!v.ok) {
      history.push({ role: 'assistant', content: `Room rejected: ${v.errors.join('; ')}`.slice(0, 600) });
      addBubble('error', `That room was rejected:\n${errorList(v.errors)}`);
      return { status: 'rejected', statusText: v.errors.join('; ') };
    }

    const spec = v.spec;
    api.applySpace(def.id, spec, 'ai');
    if (!updating) api.enterInterior(def.id);
    history.push({
      role: 'assistant',
      content:
        `${updating ? 'Redesigned' : 'Designed'} "${spec.name}" for ${def.name} — ${spec.items.length} items, ` +
        `${spec.robots} robots, floor ${spec.floor[0]} x ${spec.floor[1]}, walls ${spec.wallHeight}. Applied to the building.`,
    });
    const summary =
      `${spec.name} — ${spec.items.length} items and ${spec.robots} robot${spec.robots === 1 ? '' : 's'} ` +
      `in a ${spec.floor[0]}×${spec.floor[1]} room for ${def.name}. ${spec.description}`;
    addBubble('assistant', summary.trim());
    toast(updating ? `${def.name}: ${spec.name} replaced the room.` : `${def.name}: ${spec.name} is ready.`);
    return {
      status: 'ok',
      statusText: updating
        ? `Updated "${spec.name}" in ${def.name} — ${spec.items.length} items, ${spec.robots} robots, ` +
          `floor ${spec.floor[0]} x ${spec.floor[1]}.`
        : `Applied "${spec.name}" to ${def.name} — ${spec.items.length} items, ${spec.robots} robots, ` +
          `floor ${spec.floor[0]} x ${spec.floor[1]}.`,
    };
  }

  // An object needs no review state either: it lands in the room the user is standing in, and the
  // info panel that opens on it — with its Remove button — is the discard.
  function handleObjectReply(result, roomInfo) {
    const args = extractToolCall(result);
    if (!args) {
      history.push({ role: 'assistant', content: result.text });
      const raw = result.text ? `\n\n${result.text.slice(0, 600)}` : '';
      addBubble('error', `I could not read an object design from that reply.${raw}`);
      return { status: 'unreadable', statusText: 'No create_object call in the reply.' };
    }

    const v = validateObjectSpec(args, roomInfo.room);
    if (!v.ok) {
      history.push({ role: 'assistant', content: `Object rejected: ${v.errors.join('; ')}`.slice(0, 600) });
      addBubble('error', `That object was rejected:\n${errorList(v.errors)}`);
      return { status: 'rejected', statusText: v.errors.join('; ') };
    }

    const inst = api.addObjectSpec(v.spec, 'ai');
    if (!inst) {
      const message = 'That object could not be placed — the indoor space is no longer open.';
      addBubble('error', message);
      return { status: 'error', statusText: message };
    }

    const { height } = objectMetrics(resolveParts(inst), inst.scale ?? 1);
    const roomName = world.buildings.find((b) => b.id === roomInfo.id)?.name || 'the room';
    history.push({
      role: 'assistant',
      content:
        `Created object "${inst.name}" — ${inst.parts.length} parts, ${height.toFixed(2)} units tall, ` +
        `standing at (${inst.pos[0].toFixed(1)}, ${inst.pos[1].toFixed(1)}) in ${roomName}.`,
    });
    const summary =
      `${inst.name} — ${inst.parts.length} parts, ${height.toFixed(2)} units tall, placed in ${roomName}. ` +
      `${v.spec.description}`;
    addBubble('assistant', summary.trim());
    toast(`${inst.name} added to ${roomName}.`);
    return {
      status: 'ok',
      statusText: `Placed "${inst.name}" in ${roomName} — ${inst.parts.length} parts, ${height.toFixed(2)} units tall.`,
    };
  }

  navBtn.addEventListener('click', () => {
    const open = !panel.classList.toggle('hidden');
    navBtn.classList.toggle('active', open);
    navBtn.setAttribute('aria-expanded', String(open));
    if (open) stickToBottom(true);
  });

  collapseBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
  });

  $('#ai-open-settings').addEventListener('click', () => {
    openSettings();
    document.querySelector('#model-config').scrollIntoView({ block: 'nearest' });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const active = getActive(store.getState());
    if (!text || !active || pending) return;
    pending = true;
    input.value = '';
    history.push({ role: 'user', content: text });
    addBubble('user', text);
    const pendingEl = addBubble('pending', '');
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'd';
      pendingEl.firstChild.appendChild(d);
    }
    stickToBottom(true);
    syncReady();

    // Only a function call carries its schema and session context; plain chat keeps sending exactly
    // [system, user] so the message count stays predictable.
    const building = BUILDING_RE.test(text);
    const designing = !building && SPACE_RE.test(text);
    const objecting = !building && !designing && OBJECT_RE.test(text);
    const fn = building
      ? functionById('building')
      : designing
        ? functionById('space')
        : objecting
          ? functionById('object')
          : null;
    const site = building ? api.pendingSite() : null;
    // Standing inside a room always targets that room; spaceRef only survives from town mode.
    const inside = objecting || designing ? api.interiorRoom() : null;
    const spaceState = designing
      ? inside
        ? api.spaceState(inside.id)
        : spaceRef
          ? api.spaceState(spaceRef.id)
          : null
      : null;
    const ref = spaceState ? spaceState.def : designing ? spaceRef : null;
    // a building that already has a room is a redesign, even from town mode
    const current = spaceState && spaceState.spec ? spaceState : null;
    const roomInfo = objecting ? inside : null;
    // a reference the user has since removed (or a room they left) degrades to no reference
    const objRef = roomInfo && objectRef && roomInfo.objectIds.includes(objectRef.id) ? objectRef : null;
    // The rules come from Settings → Functions (or the default), the facts from wherever the user
    // is standing, so an edited prompt can never drop the site, envelope or reference the
    // validators and the model both need.
    const facts = !fn
      ? ''
      : fn.id === 'building'
        ? fn.facts(site)
        : fn.id === 'space'
          ? fn.facts(ref, current)
          : fn.facts(roomInfo ? roomInfo.room : null, objRef);
    const messages = [
      systemPrompt(),
      ...(fn ? [{ role: 'system', content: composePrompt(fn, fnStore.effectivePrompt(fn.id), facts) }] : []),
      ...history.slice(-20),
    ];
    const callId = fn
      ? fnStore.beginCall({
          fnId: fn.id,
          request: text,
          messages,
          tools: [fn.tool.function.name],
          model: active.model,
          provider: active.provider.name,
        })
      : null;
    const started = performance.now();

    try {
      if (designing && !ref) {
        pendingEl.remove();
        const message =
          '/space designs the indoor space of one building. Click a building and choose "Design with AI", ' +
          'or stand inside a room and redesign it.';
        addBubble('error', message);
        fnStore.endCall(callId, { status: 'blocked', statusText: message });
        return;
      }
      if (objecting && !roomInfo) {
        pendingEl.remove();
        const message =
          '/object adds an object to the indoor space you are standing in. ' +
          'Click a building on the map to enter its interior first.';
        addBubble('error', message);
        fnStore.endCall(callId, { status: 'blocked', statusText: message });
        return;
      }
      const r = await chat({
        baseUrl: active.provider.baseUrl,
        apiKey: active.provider.apiKey,
        model: active.model,
        messages,
        ...(fn ? { tools: [fn.tool] } : {}),
      });
      pendingEl.remove();
      const ms = performance.now() - started;
      if (!r.ok) {
        addBubble('error', r.message);
        fnStore.endCall(callId, { status: 'error', statusText: r.message, ms, viaProxy: r.viaProxy });
      } else if (fn) {
        const outcome =
          fn.id === 'building'
            ? handleBuildingReply(r, site)
            : fn.id === 'space'
              ? handleSpaceReply(r, ref, !!current)
              : handleObjectReply(r, roomInfo);
        fnStore.endCall(callId, { ...outcome, ms, viaProxy: r.viaProxy });
      } else {
        history.push({ role: 'assistant', content: r.text });
        addBubble('assistant', r.text);
      }
    } catch (err) {
      pendingEl.remove();
      addBubble('error', `Request failed: ${err.message}`);
      fnStore.endCall(callId, {
        status: 'error',
        statusText: err.message,
        ms: performance.now() - started,
      });
    } finally {
      pending = false;
      syncReady();
      stickToBottom(true);
    }
  });

  // Placement mode hands over a surveyed site and the space prompt hands over a building: same
  // opening move, seed the command and tell the user what the model will be given.
  function openWith(command, message) {
    panel.classList.remove('hidden', 'collapsed');
    collapseBtn.setAttribute('aria-expanded', 'true');
    collapseBtn.title = 'Collapse';
    navBtn.classList.add('active');
    navBtn.setAttribute('aria-expanded', 'true');
    input.value = command;
    addBubble('assistant', message);
    syncReady();
    stickToBottom(true);
    input.focus();
  }

  function openWithSite(site) {
    openWith(
      '/building ',
      `Site selected at (${site.x.toFixed(0)}, ${site.z.toFixed(0)}) — ${site.clearance.toFixed(1)} units of clearance. ` +
        'Tell me what to build there, or send /building <description>.'
    );
  }

  function openWithSpace(def) {
    spaceRef = def;
    const env = roomEnvelope(def);
    openWith(
      '/space ',
      `Reference: ${def.name} (${def.type}) — footprint ${def.footprint}, room envelope ${env.w}×${env.d} with ${env.wallH}-unit walls. ` +
        'Tell me what kind of indoor space to build inside it, or send /space <description>.'
    );
  }

  function openWithObject(inst) {
    // a snapshot, so edits made in the panel afterwards cannot change what the model was told
    objectRef = { ...inst, parts: inst.parts.map((p) => ({ ...p })) };
    const { radius, height } = objectMetrics(resolveParts(inst), inst.scale ?? 1);
    const origin = inst.typeId === 'custom' ? 'AI design' : `type ${inst.typeId}`;
    openWith(
      '/object ',
      `Reference object: ${inst.name} (${origin}) — ${inst.parts.length} parts, ` +
        `${(radius * 2).toFixed(2)} units wide, ${height.toFixed(2)} tall, ${effectiveAttrs(inst).material} finish. ` +
        'Tell me how to derive a related object, or send /object <description>.'
    );
  }

  store.subscribe(syncReady);
  syncReady();

  return { openWithSite, openWithSpace, openWithObject };
}
