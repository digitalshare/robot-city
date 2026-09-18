// The Functions section of Settings: which AI function calls exist, the system prompt each one
// sends, and the history of what was actually sent. A saved prompt is inert text — it travels to
// the provider inside a system message and is never parsed, evaluated or meshed.

import {
  BUILDING_TOOL, SPACE_TOOL, OBJECT_TOOL,
  BUILDING_RULES, SPACE_RULES, OBJECT_RULES,
  buildingFacts, spaceFacts, objectFacts,
} from './tools.js';

export const FUNCTIONS = [
  {
    id: 'building',
    command: '/building',
    label: 'Create a building',
    desc: 'Designs one building out of primitive parts and opens the review card.',
    tool: BUILDING_TOOL,
    rules: BUILDING_RULES,
    facts: buildingFacts,
  },
  {
    id: 'space',
    command: '/space',
    label: 'Design an indoor space',
    desc: 'Furnishes the room inside one building and walks you into it.',
    tool: SPACE_TOOL,
    rules: SPACE_RULES,
    facts: spaceFacts,
  },
  {
    id: 'object',
    command: '/object',
    label: 'Create an object',
    desc: 'Adds one object to the indoor space you are standing in.',
    tool: OBJECT_TOOL,
    rules: OBJECT_RULES,
    facts: objectFacts,
  },
];

export const functionById = (id) => FUNCTIONS.find((f) => f.id === id) || null;

export const CALL_STATUSES = ['sending', 'ok', 'rejected', 'unreadable', 'blocked', 'error'];

const KEY = 'robotTown.ai.functions.v1';
const MAX_HISTORY = 20;
const MAX_MESSAGES = 40;
const MAX_MSG_CHARS = 4000;
const MAX_PROMPT_CHARS = 20000;
const MAX_REQUEST_CHARS = 400;
const MAX_STATUS_CHARS = 300;
const MAX_LABEL_CHARS = 80;

function clip(text, max) {
  if (typeof text !== 'string') return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// the editable rules with this call's facts appended, as the single system message the model gets
export function composePrompt(fn, saved, facts) {
  const rules = typeof saved === 'string' && saved.trim() ? saved : fn.rules;
  const text = clip(rules, MAX_PROMPT_CHARS).trim();
  return facts ? `${text}\n\n${facts}` : text;
}

function sanitizeCall(c, fnId) {
  return {
    id: typeof c.id === 'string' ? c.id : `c${fnId}`,
    at: Number.isFinite(c.at) ? c.at : 0,
    fnId,
    request: clip(c.request, MAX_REQUEST_CHARS),
    status: CALL_STATUSES.includes(c.status) ? c.status : 'error',
    statusText: clip(c.statusText, MAX_STATUS_CHARS),
    ms: Number.isFinite(c.ms) ? c.ms : 0,
    model: clip(c.model, MAX_LABEL_CHARS),
    provider: clip(c.provider, MAX_LABEL_CHARS),
    viaProxy: c.viaProxy === true,
    tools: Array.isArray(c.tools) ? c.tools.filter((t) => typeof t === 'string').slice(0, 4) : [],
    messages: (Array.isArray(c.messages) ? c.messages : []).slice(0, MAX_MESSAGES).map((m) => ({
      role: clip(m?.role, 16),
      content: clip(m?.content, MAX_MSG_CHARS),
    })),
  };
}

function emptyState() {
  const history = {};
  for (const fn of FUNCTIONS) history[fn.id] = [];
  return { version: 1, prompts: {}, history };
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return emptyState();
    const state = emptyState();
    for (const fn of FUNCTIONS) {
      // a saved copy of the default carries no information, so it is dropped on load
      const text = s.prompts && s.prompts[fn.id];
      if (typeof text === 'string' && text.trim() && text.trim() !== fn.rules) {
        state.prompts[fn.id] = clip(text, MAX_PROMPT_CHARS);
      }
      const list = s.history && s.history[fn.id];
      if (Array.isArray(list)) {
        state.history[fn.id] = list
          .filter((c) => c && typeof c === 'object' && Number.isFinite(c.at))
          .slice(0, MAX_HISTORY)
          .map((c) => sanitizeCall(c, fn.id));
      }
    }
    return state;
  } catch {
    return emptyState();
  }
}

let seq = 0;

export function createFunctionStore() {
  let state = loadState();
  const listeners = new Set();

  function commit(next) {
    state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // quota: keep the newest half of each history and try once more, then run from memory
      const history = {};
      for (const fn of FUNCTIONS) history[fn.id] = state.history[fn.id].slice(0, Math.ceil(MAX_HISTORY / 2));
      state = { ...state, history };
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        // private mode or a full disk: the session keeps working from memory
      }
    }
    for (const fn of listeners) fn(state);
  }

  function patchPrompt(id, text) {
    const fn = functionById(id);
    if (!fn) return;
    const trimmed = clip(text, MAX_PROMPT_CHARS).trim();
    const prompts = { ...state.prompts };
    if (!trimmed || trimmed === fn.rules) delete prompts[id];
    else prompts[id] = trimmed;
    commit({ ...state, prompts });
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    history: (id) => state.history[id] || [],
    effectivePrompt(id) {
      const fn = functionById(id);
      return state.prompts[id] ?? (fn ? fn.rules : '');
    },
    isCustom: (id) => typeof state.prompts[id] === 'string',
    setPrompt: patchPrompt,
    resetPrompt: (id) => patchPrompt(id, ''),

    // Recorded before the request goes out, so a call that never reaches the model — /space with
    // no building, /object with no room — still explains itself in the history.
    beginCall({ fnId, request, messages, tools, model, provider }) {
      const list = state.history[fnId];
      if (!list) return null;
      const id = `c${Date.now().toString(36)}${(seq++).toString(36)}`;
      const entry = sanitizeCall({
        id,
        at: Date.now(),
        request,
        status: 'sending',
        statusText: 'Waiting for the model…',
        model,
        provider,
        tools,
        messages,
      }, fnId);
      commit({
        ...state,
        history: { ...state.history, [fnId]: [entry, ...list].slice(0, MAX_HISTORY) },
      });
      return id;
    },

    endCall(callId, { status, statusText, ms, viaProxy } = {}) {
      if (!callId) return;
      const history = { ...state.history };
      for (const fn of FUNCTIONS) {
        const list = history[fn.id];
        const i = list.findIndex((c) => c.id === callId);
        if (i < 0) continue;
        const next = [...list];
        next[i] = {
          ...next[i],
          status: CALL_STATUSES.includes(status) ? status : 'error',
          statusText: clip(statusText, MAX_STATUS_CHARS) || next[i].statusText,
          ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : next[i].ms,
          viaProxy: viaProxy === true,
        };
        history[fn.id] = next;
        commit({ ...state, history });
        return;
      }
    },
  };
}
