const KEY = 'robotTown.ai.v1';

const DEFAULTS = { version: 1, providers: [], activeProviderId: null };

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.providers)) return structuredClone(DEFAULTS);
    const providers = s.providers.filter(
      (p) => p && typeof p.id === 'string' && typeof p.baseUrl === 'string');
    for (const p of providers) {
      p.name = typeof p.name === 'string' ? p.name : 'Provider';
      p.apiKey = typeof p.apiKey === 'string' ? p.apiKey : '';
      p.status = p.status === 'ok' || p.status === 'error' ? p.status : 'untested';
      p.statusMessage = typeof p.statusMessage === 'string' ? p.statusMessage : '';
      p.testedAt = Number.isFinite(p.testedAt) ? p.testedAt : 0;
      p.models = Array.isArray(p.models) ? p.models.filter((m) => typeof m === 'string') : [];
      p.model = typeof p.model === 'string' ? p.model : '';
    }
    const activeProviderId =
      typeof s.activeProviderId === 'string' && providers.some((p) => p.id === s.activeProviderId)
        ? s.activeProviderId
        : providers[0]?.id ?? null;
    return { version: 1, providers, activeProviderId };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function createStore() {
  let state = loadState();
  const listeners = new Set();

  function commit(next) {
    state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // quota or private mode: keep working from memory
    }
    for (const fn of listeners) fn(state);
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    addProvider({ name, baseUrl, apiKey }) {
      const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      const provider = {
        id, name, baseUrl, apiKey,
        status: 'untested', statusMessage: '', testedAt: 0, models: [], model: '',
      };
      const providers = [...state.providers, provider];
      commit({ ...state, providers, activeProviderId: state.activeProviderId ?? id });
      return id;
    },
    updateProvider(id, patch) {
      const providers = state.providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
      commit({ ...state, providers });
    },
    deleteProvider(id) {
      const providers = state.providers.filter((p) => p.id !== id);
      const activeProviderId =
        state.activeProviderId === id ? providers[0]?.id ?? null : state.activeProviderId;
      commit({ ...state, providers, activeProviderId });
    },
    setActiveProvider(id) {
      commit({ ...state, activeProviderId: id });
    },
  };
}

export function getActive(state) {
  const provider = state.providers.find((p) => p.id === state.activeProviderId) || null;
  if (!provider || provider.status !== 'ok' || !provider.model) return null;
  return { provider, model: provider.model };
}
