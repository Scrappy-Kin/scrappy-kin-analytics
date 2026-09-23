'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/data';
const ALLOWED_SITES = new Set(
  (process.env.ALLOWED_SITES || 'blog.scrappykin.com,scrappykin.com')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const BOT_PATTERN = /(bot|crawler|spider|slurp|preview|facebookexternalhit|whatsapp|telegram)/i;
const MAX_BODY_BYTES = 2048;
const MAX_DIMENSIONS = 500;
let writeQueue = Promise.resolve();

const CLIENT_SCRIPT = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safeSite(hostHeader) {
  const host = String(hostHeader || '').split(':')[0].toLowerCase();
  return ALLOWED_SITES.has(host) ? host : null;
}

function safePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500 || !value.startsWith('/')) return null;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  if (/[\u0000-\u001f\u007f]/.test(withoutQuery)) return null;
  if (/^\/ghost(\/|$)/.test(withoutQuery) || /^\/privacy(?:[./]|$)/.test(withoutQuery) || /^\/help\/privacy(?:[/-]|$)/.test(withoutQuery)) return null;
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : '/';
}

function dataPath(site, day) {
  return path.join(DATA_DIR, `analytics-${site}-${day}.json`);
}

function emptyDay(site, day) {
  return { site, day, views: 0, pages: {}, ignored_automation: 0 };
}

function readDay(site, day) {
  try {
    const data = JSON.parse(fs.readFileSync(dataPath(site, day), 'utf8'));
    delete data.referrers;
    delete data.visitors;
    delete data.unique_visitors;
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDay(site, day);
    throw error;
  }
}

function incrementDimension(collection, key) {
  if (!(key in collection) && Object.keys(collection).length >= MAX_DIMENSIONS) key = 'other';
  collection[key] = (collection[key] || 0) + 1;
}

function writeDay(site, day, data) {
  const target = dataPath(site, day);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function finalizeOldDays(today) {
  for (const name of fs.readdirSync(DATA_DIR)) {
    const analytics = /^analytics-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (analytics) {
      const target = path.join(DATA_DIR, name);
      const data = JSON.parse(fs.readFileSync(target, 'utf8'));
      const wasFinalized = data.finalized === true;
      const legacyFields = ['referrers', 'visitors', 'unique_visitors'];
      const hadLegacy = legacyFields.some((field) => Object.prototype.hasOwnProperty.call(data, field));
      delete data.referrers;
      delete data.visitors;
      delete data.unique_visitors;
      if (analytics[2] < today) data.finalized = true;
      if (hadLegacy || (analytics[2] < today && !wasFinalized)) {
        const temporary = `${target}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, target);
      }
    }
    const salt = /^salt-(\d{4}-\d{2}-\d{2})$/.exec(name);
    if (salt) fs.rmSync(path.join(DATA_DIR, name), { force: true });
  }
}

function record(event) {
  const day = utcDay();
  finalizeOldDays(day);
  const data = readDay(event.site, day);
  if (event.automation) {
    data.ignored_automation += 1;
  } else {
    data.views += 1;
    incrementDimension(data.pages, event.page);
  }
  writeDay(event.site, day, data);
}

function respond(response, status, body = '', contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  response.end(body);
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) reject(new Error('body_too_large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
finalizeOldDays(utcDay());

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return respond(response, 200, 'ok\n');
  if (request.method === 'GET' && request.url === '/script.js') {
    return respond(response, 200, CLIENT_SCRIPT, 'application/javascript; charset=utf-8');
  }
  if (request.method !== 'POST' || request.url !== '/event') return respond(response, 404);
  if (request.headers['sec-gpc'] === '1' || request.headers.dnt === '1') return respond(response, 204);

  const site = safeSite(request.headers['x-analytics-site']);
  if (!site) return respond(response, 403);
  try {
    const payload = JSON.parse(await collectBody(request));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.keys(payload).length !== 2 || payload.contract !== 'consent-v1' ||
        !Object.prototype.hasOwnProperty.call(payload, 'path')) {
      return respond(response, 204);
    }
    const page = safePath(payload.path);
    if (!page) return respond(response, 204);
    const event = {
      site,
      page,
      automation: BOT_PATTERN.test(String(request.headers['user-agent'] || ''))
    };
    writeQueue = writeQueue.catch(() => {}).then(() => record(event));
    await writeQueue;
    return respond(response, 204);
  } catch (_) {
    return respond(response, 400);
  }
});

server.listen(PORT, '0.0.0.0');
