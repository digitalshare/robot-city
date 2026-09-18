const CAN_PROXY = import.meta.env.DEV;
const PROXY_PREFIX = '/__ai-proxy';

class NetError extends Error {}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return u.toString().replace(/\/+$/, '');
}

async function requestJson(url, { method = 'GET', apiKey, body, timeoutMs = 60_000 } = {}) {
  const init = () => ({
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  try {
    const res = await fetch(url, init());
    return { res, viaProxy: false };
  } catch {
    if (!CAN_PROXY) {
      throw new NetError(`Could not reach ${hostOf(url)} from the browser (CORS or offline).`);
    }
    try {
      const res = await fetch(`${PROXY_PREFIX}?target=${encodeURIComponent(url)}`, init());
      return { res, viaProxy: true };
    } catch {
      throw new NetError(`Could not reach ${hostOf(url)} from the browser or the dev proxy.`);
    }
  }
}

async function readError(res, host) {
  let detail = '';
  try {
    const data = await res.json();
    const m = data && data.error && data.error.message;
    if (typeof m === 'string') detail = m.slice(0, 200);
  } catch {
    // non-JSON error body
  }
  const suffix = detail ? ` — ${detail}` : '';
  switch (res.status) {
    case 401: return `Invalid API key (401) for ${host}.${suffix}`;
    case 403: return `Key not permitted for this endpoint (403).${suffix}`;
    case 404: return `Endpoint not found (404) at ${host} — the base URL may need a /v1 suffix.${suffix}`;
    case 429: return `Rate limited or out of credits (429).${suffix}`;
    default:
      if (res.status >= 500) return `Provider unavailable (${res.status}).${suffix}`;
      return `Request failed (${res.status}).${suffix}`;
  }
}

function normalizeModels(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : null;
  if (!list) return null;
  const out = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : item && (item.id || item.name);
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
  }
  return out.length ? out : null;
}

export async function listModels(provider, store) {
  const base = normalizeBaseUrl(provider.baseUrl);
  if (!base) return { ok: false, message: 'Base URL is not a valid http(s) address.' };
  const urls = /\/v\d+$/.test(base) ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];
  for (let i = 0; i < urls.length; i++) {
    let res;
    let viaProxy;
    try {
      ({ res, viaProxy } = await requestJson(urls[i], { apiKey: provider.apiKey }));
    } catch (e) {
      return { ok: false, message: e.message };
    }
    if (res.status === 404 && i < urls.length - 1) continue;
    if (!res.ok) return { ok: false, status: res.status, message: await readError(res, hostOf(urls[i])) };
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, message: 'Provider returned a non-JSON response.' };
    }
    const models = normalizeModels(data);
    if (!models) return { ok: false, message: 'Provider answered but returned no recognizable model list.' };
    const corrected = i === 1 ? `${base}/v1` : base;
    if (store && corrected !== base) store.updateProvider(provider.id, { baseUrl: corrected });
    return { ok: true, models, viaProxy, baseUrl: corrected };
  }
  return {
    ok: false,
    status: 404,
    message: `Endpoint not found (404) at ${hostOf(urls[0])} — the base URL may need a /v1 suffix.`,
  };
}

export async function chat({ baseUrl, apiKey, model, messages, tools, toolChoice }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ok: false, message: 'Base URL is not a valid http(s) address.' };
  const url = `${base}/chat/completions`;
  let res;
  let viaProxy;
  try {
    ({ res, viaProxy } = await requestJson(url, {
      method: 'POST',
      apiKey,
      body: {
        model,
        messages,
        stream: false,
        // tool_choice stays 'auto': the object form is rejected by some
        // OpenAI-compatible providers, and the JSON fallback covers the rest
        ...(tools ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
      },
      timeoutMs: 120_000,
    }));
  } catch (e) {
    return { ok: false, message: e.message };
  }
  if (!res.ok) return { ok: false, status: res.status, message: await readError(res, hostOf(url)) };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, message: 'Provider returned a non-JSON response.' };
  }
  const message = data?.choices?.[0]?.message;
  const content = message?.content;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : null;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
        : null;
  if (text === null && !toolCalls) return { ok: false, message: 'Provider returned no message content.' };
  return {
    ok: true,
    text: text ?? '',
    viaProxy,
    message,
    toolCalls,
    finishReason: data?.choices?.[0]?.finish_reason ?? null,
  };
}
