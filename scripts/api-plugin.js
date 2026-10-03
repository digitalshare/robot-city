// HTTP API and MCP server for the command functions (/building, /space, /object, ...).
//
// Nothing here lists the functions by hand: both surfaces are generated from the FUNCTIONS registry
// in src/ai/functions.js, so adding a command there adds its API endpoint and MCP tool too.
//
// The town lives in the browser (world state, the model key, the review cards), so a call is
// relayed to the open Robot City tab over a server-sent-events bridge, run through the same path as
// typing the command into the AI chat, and the outcome is sent back.
//
//   GET  /__api/functions            list the functions (id, command, description, input schema)
//   POST /__api/functions/:id        {"request": "..."} -> {status, statusText}
//   GET  /__api/bridge               SSE stream the browser tab listens on
//   POST /__api/bridge/result        the browser's answer to a job
//   POST /__mcp                      MCP (streamable HTTP, JSON-RPC): tools/list, tools/call

import { randomUUID } from 'node:crypto';

const API = '/__api';
const MCP = '/__mcp';
const MAX_BODY = 64 * 1024;
const MAX_REQUEST = 400;
const CALL_TIMEOUT_MS = 120_000;
const PROTOCOL_VERSION = '2025-03-26';

const REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    request: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_REQUEST,
      description: 'What to create, in plain language — the text that follows the command in the AI chat.',
    },
  },
  required: ['request'],
  additionalProperties: false,
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function apiPlugin() {
  return {
    name: 'robot-city:api',
    apply: 'serve',
    configureServer(server) {
      const clients = new Set();
      const jobs = new Map();

      // read per request so edits to the registry show up without restarting the dev server
      async function listFunctions() {
        const mod = await server.ssrLoadModule('/src/ai/functions.js');
        return mod.FUNCTIONS.map((fn) => ({
          id: fn.id,
          command: fn.command,
          name: fn.tool.function.name,
          label: fn.label,
          description: fn.desc,
          inputSchema: REQUEST_SCHEMA,
        }));
      }

      async function callFunction(id, request) {
        const fns = await listFunctions();
        if (!fns.some((f) => f.id === id)) {
          throw Object.assign(new Error(`unknown function "${id}"`), { status: 404 });
        }
        if (typeof request !== 'string' || !request.trim() || request.length > MAX_REQUEST) {
          throw Object.assign(new Error(`request must be 1-${MAX_REQUEST} characters`), { status: 400 });
        }
        const client = [...clients].pop();
        if (!client) {
          throw Object.assign(new Error('no Robot City tab is open — open the app in a browser first'), { status: 503 });
        }
        const jobId = randomUUID();
        const outcome = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            jobs.delete(jobId);
            reject(Object.assign(new Error('the browser did not answer in time'), { status: 504 }));
          }, CALL_TIMEOUT_MS);
          jobs.set(jobId, { resolve, timer });
        });
        client.write(`event: job\ndata: ${JSON.stringify({ jobId, fnId: id, command: fns.find((f) => f.id === id).command, request: request.trim() })}\n\n`);
        return outcome;
      }

      const toolName = (f) => f.name;

      async function handleMcp(msg) {
        const { id, method, params } = msg;
        const reply = (result) => ({ jsonrpc: '2.0', id, result });
        const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
        if (id === undefined) return null; // notification
        switch (method) {
          case 'initialize':
            return reply({
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'robot-city', version: '0.2.0' },
              instructions: 'Each tool runs a Robot City AI command in the open browser tab.',
            });
          case 'ping':
            return reply({});
          case 'tools/list': {
            const fns = await listFunctions();
            return reply({
              tools: fns.map((f) => ({
                name: toolName(f),
                title: f.label,
                description: `${f.description} (Same as the ${f.command} command.)`,
                inputSchema: f.inputSchema,
              })),
            });
          }
          case 'tools/call': {
            const fns = await listFunctions();
            const fn = fns.find((f) => toolName(f) === params?.name);
            if (!fn) return fail(-32602, `unknown tool "${params?.name}"`);
            try {
              const out = await callFunction(fn.id, params?.arguments?.request);
              return reply({
                content: [{ type: 'text', text: `${out.status}: ${out.statusText}` }],
                isError: out.status !== 'ok',
              });
            } catch (err) {
              return reply({ content: [{ type: 'text', text: err.message }], isError: true });
            }
          }
          default:
            return fail(-32601, `method not found: ${method}`);
        }
      }

      async function route(req, res, url) {
        if (url.pathname === `${API}/bridge` && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          res.write(': connected\n\n');
          clients.add(res);
          const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
          req.on('close', () => {
            clearInterval(beat);
            clients.delete(res);
          });
          return;
        }
        if (url.pathname === `${API}/bridge/result` && req.method === 'POST') {
          const body = await readJson(req);
          const job = jobs.get(body.jobId);
          if (!job) return sendJson(res, 404, { error: 'unknown or expired job' });
          jobs.delete(body.jobId);
          clearTimeout(job.timer);
          job.resolve({
            status: String(body.status || 'error').slice(0, 20),
            statusText: String(body.statusText || '').slice(0, 600),
          });
          return sendJson(res, 200, { ok: true });
        }
        if (url.pathname === `${API}/functions` && req.method === 'GET') {
          return sendJson(res, 200, { functions: await listFunctions() });
        }
        const m = url.pathname.match(/^\/__api\/functions\/([\w-]+)$/);
        if (m && req.method === 'POST') {
          const body = await readJson(req);
          return sendJson(res, 200, await callFunction(m[1], body.request));
        }
        if (url.pathname === MCP) {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST JSON-RPC to this endpoint' });
          const body = await readJson(req);
          const batch = Array.isArray(body);
          const out = (await Promise.all((batch ? body : [body]).map(handleMcp))).filter(Boolean);
          if (!out.length) {
            res.statusCode = 202;
            return res.end();
          }
          return sendJson(res, 200, batch ? out : out[0]);
        }
        return sendJson(res, 404, { error: 'not found' });
      }

      server.middlewares.use((req, res, next) => {
        if (!req.url || !(req.url.startsWith(API) || req.url.startsWith(MCP))) return next();
        const url = new URL(req.url, 'http://localhost');
        // a web page on another origin must not be able to drive the town through the user's browser
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) {
          return sendJson(res, 403, { error: 'cross-origin requests are not allowed' });
        }
        route(req, res, url).catch((err) => {
          if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || String(err) });
        });
      });
    },
  };
}
