import http from 'node:http';

const MODELS = [
  { id: 'mock-gpt-4o', object: 'model', owned_by: 'mock' },
  { id: 'mock-mini', object: 'model', owned_by: 'mock' },
  { id: 'mock-reasoning', object: 'model', owned_by: 'mock' },
];

const stats = {
  cors: { models: 0, chat: 0, tools: 0, spaces: 0, objects: 0, last: null },
  plain: { models: 0, chat: 0, tools: 0, spaces: 0, objects: 0, last: null },
};

function json(res, status, payload, cors) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (cors) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization,content-type,accept');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-max-age', '86400');
  }
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function designFor(prompt) {
  const label =
    prompt
      .replace(/\[(fence|invalid)\]/g, ' ')
      .replace(/^\/building\s*/i, '')
      .trim() || 'new building';
  const bare = label.replace(/^(a|an|the)\s+/i, '');
  const name = bare
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
  return {
    name,
    description: `A ${bare} generated for Robot City.`,
    parts: [
      { shape: 'box', size: [8, 3, 8], pos: [0, 0, 0], material: 'stone', color: '#8d979f' },
      { shape: 'cylinder', size: [3, 14], pos: [0, 3, 0], material: 'glass' },
      { shape: 'cylinder', size: [3.3, 1], pos: [0, 10, 0], material: 'glow', color: '#59e3ff' },
      { shape: 'cone', size: [3, 5], pos: [0, 17, 0], material: 'metal' },
      { shape: 'sphere', size: [0.6], pos: [0, 22, 0], material: 'glow' },
    ],
  };
}

// Written as literal JSON text on purpose: JSON.stringify would turn 1e999 into null and
// the client would never see the Infinity that Number.isFinite exists to catch.
const INVALID_ARGS =
  '{"name":"Broken Torus","description":"Deliberately invalid design.","parts":[' +
  '{"shape":"torus","size":[1e999],"pos":[0,0,0],"material":"wall"}]}';

const INVALID_SPACE_ARGS =
  '{"name":"Broken Hall","description":"Deliberately invalid room.","floor":[10,10],"wallHeight":4,' +
  '"items":[{"kind":"fountain","pos":[0,0],"scale":1e999},{"kind":"table","pos":[99,99]}],"robots":3}';

const INVALID_OBJECT_ARGS =
  '{"name":"Broken Torus","description":"Deliberately invalid object.","parts":[' +
  '{"shape":"torus","size":[1e999],"pos":[0,0,0],"material":"wall"}]}';

// The parts stay well inside the object caps, which every room envelope in the app clears, so the
// mock never has to negotiate a size with the room it was given.
function objectFor(prompt, msgs) {
  const label =
    prompt
      .replace(/\[(fence|invalid)\]/g, ' ')
      .replace(/^\/object\s*/i, '')
      .trim() || 'new object';
  const bare = label.replace(/^(a|an|the)\s+/i, '');
  const name = bare
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 32);
  const ctx = msgs
    .filter((m) => m && m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
  const derived = ctx.includes('Reference object:');
  return {
    name: `${derived ? 'Derived ' : ''}${name}`.slice(0, 40),
    description: `A ${bare} designed for an indoor space in Robot City.`,
    parts: [
      { shape: 'box', size: [0.9, 0.18, 0.9], pos: [0, 0, 0], material: 'stone', color: '#8d979f' },
      { shape: 'cylinder', size: [0.16, 1.0], pos: [0, 0.18, 0], material: 'metal', color: '#9aa3ad' },
      { shape: 'sphere', size: [0.3], pos: [0, 1.18, 0], material: 'glow', color: '#59e3ff' },
      { shape: 'cone', size: [0.34, 0.3], pos: [0, 1.78, 0], material: 'metal', color: '#c9d2da' },
    ],
  };
}

// The room has to fit the building the client named, so read the envelope back out of the
// preloaded system context rather than hard-coding one that would fail validation.
function roomFor(prompt, msgs) {
  const label =
    prompt
      .replace(/\[(fence|invalid)\]/g, ' ')
      .replace(/^\/space\s*/i, '')
      .trim() || 'new room';
  const bare = label.replace(/^(a|an|the)\s+/i, '');
  const name = bare
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
  const ctx = msgs
    .filter((m) => m && m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
  const env = /room envelope: ([\d.]+) by ([\d.]+) floor, ([\d.]+) unit walls/.exec(ctx);
  // the reference block only appears when the building already has a room standing
  const refit = ctx.includes('Current indoor space:');
  const w = env ? Number(env[1]) : 12;
  const d = env ? Number(env[2]) : 12;
  // 0.56 of the half-size keeps every item off the walls even in the smallest envelope
  const x = Math.round(w * 0.28 * 100) / 100;
  const z = Math.round(d * 0.28 * 100) / 100;
  return {
    name: `${refit ? 'Refit ' : ''}${name}`.slice(0, 40),
    description: `A ${bare} designed for Robot City.`,
    floor: [w, d],
    wallHeight: env ? Number(env[3]) : 4,
    palette: { floor: '#c9d2da', wall: '#f2f5f8', accent: '#35e0a1' },
    items: [
      { kind: 'counter', pos: [-x, -z], rot: 0.4 },
      { kind: 'table', pos: [0, -z] },
      { kind: 'chair', pos: [-x * 0.4, z * 0.5], rot: 1.2, scale: 0.9 },
      { kind: 'chair', pos: [x * 0.4, z * 0.5], rot: -1.2, scale: 0.9 },
      { kind: 'shelf', pos: [x, -z * 0.2], rot: -0.5 },
      { kind: 'bed', pos: [x, z], rot: 1.57 },
      { kind: 'plant', pos: [-x, z], scale: 1.2 },
      { kind: 'lamp', pos: [0, z], color: '#ffd479' },
    ],
    robots: 3,
  };
}

function cannedArgs(toolName, prompt, msgs) {
  const invalid = prompt.includes('[invalid]');
  if (toolName === 'create_space') {
    return invalid ? INVALID_SPACE_ARGS : JSON.stringify(roomFor(prompt, msgs));
  }
  if (toolName === 'create_object') {
    return invalid ? INVALID_OBJECT_ARGS : JSON.stringify(objectFor(prompt, msgs));
  }
  return invalid ? INVALID_ARGS : JSON.stringify(designFor(prompt));
}

function makeServer(kind, cors) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      if (!cors) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 204;
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'authorization,content-type,accept');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-max-age', '86400');
      res.end();
      return;
    }
    if (url.pathname === '/__stats') return json(res, 200, stats, false);

    const authed = req.headers.authorization === 'Bearer mock-key-ok';
    const denied = { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } };

    if (url.pathname === '/v1/models') {
      stats[kind].models += 1;
      if (!authed) return json(res, 401, denied, cors);
      const shape = url.searchParams.get('shape');
      if (shape === 'names') return json(res, 200, { models: [{ name: 'llama3.1' }] }, cors);
      if (shape === 'bare') return json(res, 200, ['alpha', 'beta'], cors);
      return json(res, 200, { object: 'list', data: MODELS }, cors);
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      stats[kind].chat += 1;
      if (!authed) return json(res, 401, denied, cors);
      const body = await readBody(req);
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const last = [...msgs].reverse().find((m) => m && m.role === 'user');
      const prompt = last && typeof last.content === 'string' ? last.content : '';

      // verify reads this back to prove which system prompt actually reached the model
      stats[kind].last = {
        msgs: msgs.length,
        tools: Array.isArray(body.tools) ? body.tools.map((t) => t?.function?.name).filter(Boolean) : [],
        system: msgs
          .filter((m) => m && m.role === 'system')
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .join('\n\n')
          .slice(0, 6000),
        user: prompt.slice(0, 200),
      };

      // Only answer as a tool call when the client really sent the schema; a [fence]
      // prompt makes us ignore it and reply in text instead, to exercise the fallback.
      if (Array.isArray(body.tools) && body.tools.length) {
        const toolName = body.tools[0]?.function?.name || 'create_building';
        const bucket = toolName === 'create_space' ? 'spaces' : toolName === 'create_object' ? 'objects' : 'tools';
        stats[kind][bucket] += 1;
        const asFence = prompt.includes('[fence]');
        const args = cannedArgs(toolName, prompt, msgs);
        const choice = asFence
          ? {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '```json\n' + args + '\n```' },
            }
          : {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  { id: 'call_mock_1', type: 'function', function: { name: toolName, arguments: args } },
                ],
              },
            };
        return json(
          res,
          200,
          {
            id: 'chatcmpl-mock-tool',
            object: 'chat.completion',
            model: body.model,
            choices: [choice],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
          cors);
      }

      const content = `Echo: ${prompt}\nmodel=${body.model}\nmsgs=${msgs.length}`;
      return json(
        res,
        200,
        {
          id: 'chatcmpl-mock-1',
          object: 'chat.completion',
          model: body.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
        cors);
    }

    json(res, 404, { error: { message: `no route ${url.pathname}` } }, cors);
  });
}

makeServer('cors', true).listen(5199, '127.0.0.1');
makeServer('plain', false).listen(5198, '127.0.0.1');
console.log('mock provider listening on 5199 (cors) and 5198 (no cors)');
