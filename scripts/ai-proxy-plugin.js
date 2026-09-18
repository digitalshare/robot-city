const PREFIX = '/__ai-proxy';
const ALLOWED_PATH = [/\/models$/, /\/chat\/completions$/];
const FWD_HEADERS = ['authorization', 'content-type', 'accept'];
const BLOCKED_HOSTS = ['169.254.169.254', 'metadata.google.internal'];
const MAX_BODY = 1024 * 1024;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: { message: 'method not allowed' } });
  }
  let target;
  try {
    target = new URL(new URL(req.url, 'http://localhost').searchParams.get('target') || '');
  } catch {
    return sendJson(res, 400, { error: { message: 'missing ?target=<absolute url>' } });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return sendJson(res, 400, { error: { message: 'target must be http(s)' } });
  }
  if (!ALLOWED_PATH.some((re) => re.test(target.pathname))) {
    return sendJson(res, 403, { error: { message: 'only /models and /chat/completions may be proxied' } });
  }
  if (BLOCKED_HOSTS.includes(target.hostname)) {
    return sendJson(res, 403, { error: { message: 'cloud metadata endpoints are blocked' } });
  }

  const headers = {};
  for (const h of FWD_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  const init = { method: req.method, headers, signal: AbortSignal.timeout(90_000) };
  if (req.method === 'POST') init.body = await readBody(req);

  const up = await fetch(target, init);
  const text = await up.text();
  res.statusCode = up.status;
  res.setHeader('content-type', up.headers.get('content-type') || 'application/json');
  res.end(text);
}

export function aiProxyPlugin() {
  return {
    name: 'robot-city:ai-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(PREFIX)) return next();
        handle(req, res).catch((err) =>
          sendJson(res, err.status || 502, {
            error: { message: `Dev proxy failure: ${err && err.message ? err.message : err}` },
          }));
      });
    },
  };
}
