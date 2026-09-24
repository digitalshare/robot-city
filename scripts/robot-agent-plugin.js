const PREFIX = '/__robot-chat';
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 2000;
const MAX_MEMORY = 8000;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw Object.assign(new Error(`${name} is not configured`), { status: 503 });
  return value.replace(/\/+$/, '');
}

async function jsonFetch(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* preserve a useful status below */ }
  if (!response.ok) {
    const detail = data?.error?.message || text.slice(0, 200);
    throw Object.assign(new Error(`${response.status}${detail ? `: ${detail}` : ''}`), { status: response.status });
  }
  return data;
}

async function recall(robotId, query) {
  const base = requiredEnv('COGNEE_BASE_URL');
  const key = requiredEnv('COGNEE_API_KEY');
  return jsonFetch(`${base}/api/v1/recall`, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, session_id: robotId }),
  });
}

async function remember(robotId, question, answer) {
  const base = requiredEnv('COGNEE_BASE_URL');
  const key = requiredEnv('COGNEE_API_KEY');
  return jsonFetch(`${base}/api/v1/remember/entry`, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: { type: 'qa', question, answer },
      dataset_name: process.env.COGNEE_DATASET || 'robot-city',
      session_id: robotId,
    }),
  });
}

function memoryText(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data || '');
  return text.slice(0, MAX_MEMORY);
}

async function invokeAgent(input) {
  const strandsUrl = process.env.STRANDS_AGENT_URL?.trim();
  if (strandsUrl) {
    const result = await jsonFetch(strandsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { text: String(result?.text || result?.answer || result?.output || '').trim(), provider: 'strands' };
  }

  const base = requiredEnv('ROBOT_AGENT_BASE_URL');
  const key = requiredEnv('ROBOT_AGENT_API_KEY');
  const model = process.env.ROBOT_AGENT_MODEL?.trim() || 'default';
  const result = await jsonFetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: input.messages,
    }),
  });
  const content = result?.choices?.[0]?.message?.content;
  return { text: Array.isArray(content) ? content.map((p) => p?.text || '').join('') : String(content || '').trim(), provider: 'openai-compatible' };
}

async function handle(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
  const body = await readBody(req);
  const robotId = String(body.robotId || '').trim();
  const message = String(body.message || '').trim();
  const robot = body.robot && typeof body.robot === 'object' ? body.robot : {};
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(robotId)) return sendJson(res, 400, { error: 'invalid robotId' });
  if (!message || message.length > MAX_MESSAGE) return sendJson(res, 400, { error: 'message must be 1-2000 characters' });

  const recalled = await recall(robotId, message);
  const memory = memoryText(recalled);
  const identity = `You are ${String(robot.name || robotId).slice(0, 80)}, a private Robot City robot. `
    + `Your model is ${String(robot.model || robot.modelId || 'unknown').slice(0, 80)}. `
    + `Your home is ${String(robot.homeName || robot.home || 'unknown').slice(0, 100)}. `
    + 'Keep your memories private to this robot and never claim access to another robot\'s memory.';
  const result = await invokeAgent({
    robotId,
    robot,
    messages: [
      { role: 'system', content: identity },
      ...(memory ? [{ role: 'system', content: `Private recalled memory for this robot:\n${memory}` }] : []),
      { role: 'user', content: message },
    ],
  });
  if (!result.text) throw Object.assign(new Error('agent returned no text'), { status: 502 });
  await remember(robotId, message, result.text);
  return sendJson(res, 200, { reply: result.text, provider: result.provider, robotId });
}

export function robotAgentPlugin() {
  return {
    name: 'robot-city:robot-agent',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next();
        handle(req, res).catch((err) => sendJson(res, err.status || 502, { error: err.message || String(err) }));
      });
    },
  };
}
