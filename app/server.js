'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./storage');

const CLIENT_SCRIPT = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
const BOT_PATTERN = /(bot|crawler|spider|slurp|preview|facebookexternalhit|whatsapp|telegram)/i;
const MAX_BODY_BYTES = 2048;

function safePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500 || !value.startsWith('/')) return null;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  if (/[\u0000-\u001f\u007f]/.test(withoutQuery)) return null;
  if (/^\/ghost(\/|$)/.test(withoutQuery) || /^\/privacy(?:[./]|$)/.test(withoutQuery) || /^\/help\/privacy(?:[/-]|$)/.test(withoutQuery)) return null;
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : '/';
}

function respond(response, status, body = '', close = false, contentType = 'text/plain; charset=utf-8') {
  if (response.destroyed) return;
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': status === 200 && contentType.startsWith('application/javascript') ? 'public, max-age=300' : 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(close ? { connection: 'close' } : {})
  });
  if (close) response.once('finish', () => response.destroy());
  response.end(body);
}

function collectBody(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => finish(408), timeoutMs);
    function finish(status, body) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAbort);
      request.removeListener('error', onAbort);
      request.once('error', () => {}); // An abort can be followed by a socket error.
      if (status) {
        request.pause();
        reject(Object.assign(Error('request_rejected'), { status }));
      } else resolve(body);
    }
    function onData(chunk) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) return finish(413);
      chunks.push(chunk);
    }
    function onEnd() { finish(0, Buffer.concat(chunks).toString('utf8')); }
    function onAbort() { finish(400); }
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAbort);
    request.once('error', onAbort);
  });
}

function createCollector({ store, sites, maxPending = 64, bodyTimeoutMs = 5000 }) {
  let pending = 0;
  let stopping = false;
  const server = http.createServer({
    maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000, connectionsCheckingInterval: 1000
  }, async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const healthy = !stopping && store.healthy();
      return respond(response, healthy ? 200 : 503, healthy ? 'ok\n' : 'unavailable\n');
    }
    if (request.method === 'GET' && request.url === '/script.js') {
      return respond(response, 200, CLIENT_SCRIPT, false, 'application/javascript; charset=utf-8');
    }
    if (request.method !== 'POST' || request.url !== '/event') return respond(response, 404, '', true);
    if (request.headers['sec-gpc'] === '1' || request.headers.dnt === '1') return respond(response, 204, '', true);
    const site = String(request.headers['x-analytics-site'] || '').split(':')[0].toLowerCase();
    if (!sites.has(site)) return respond(response, 403, '', true);
    if (stopping || pending >= maxPending) return respond(response, 503, '', true);
    if (Number(request.headers['content-length']) > MAX_BODY_BYTES) return respond(response, 413, '', true);
    pending += 1;
    try {
      let payload;
      try { payload = JSON.parse(await collectBody(request, bodyTimeoutMs)); }
      catch (error) { return respond(response, error.status || 400, '', true); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).length !== 2 || payload.contract !== 'consent-v1' ||
          !Object.hasOwn(payload, 'path')) return respond(response, 204);
      const page = safePath(payload.path);
      if (!page) return respond(response, 204);
      await store.record({ site, page, automation: BOT_PATTERN.test(String(request.headers['user-agent'] || '')) });
      return respond(response, 204);
    } catch (_) { return respond(response, 503, '', true); }
    finally { pending -= 1; }
  });
  server.maxConnections = 128;
  server.keepAliveTimeout = 5000;
  server.setTimeout(10000, socket => socket.destroy());
  return { server, stop: () => { stopping = true; return new Promise(resolve => server.close(resolve)); } };
}

async function start() {
  const sites = new Set((process.env.ALLOWED_SITES || 'blog.scrappykin.com,scrappykin.com')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const store = await createStore({ dataDir: process.env.DATA_DIR || '/data', sites });
  const collector = createCollector({ store, sites });
  collector.server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  // Coalesce slow writes; a timer never builds a queue of pending flushes.
  const timer = setInterval(() => { store.flush().catch(() => {}); }, 60000);
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), 15000);
    try {
      await collector.stop();
      await store.flush();
      await store.flush(); // Include arrivals admitted during an earlier in-flight snapshot.
    } catch (_) { process.exitCode = 1; }
    finally { clearTimeout(deadline); }
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) start().catch(() => {
  console.error('analytics startup failed');
  process.exitCode = 1;
});
module.exports = { createCollector };
