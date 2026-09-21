'use strict';

const crypto = require('node:crypto');
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

const CLIENT_SCRIPT = String.raw`(() => {
  const key = 'scrappy_kin_analytics_ignore';
  const excluded = () => {
    try { return localStorage.getItem(key) === 'true'; } catch (_) { return false; }
  };
  window.scrappyKinAnalytics = {
    exclude() { try { localStorage.setItem(key, 'true'); } catch (_) {} },
    include() { try { localStorage.removeItem(key); } catch (_) {} },
    excluded
  };
  if (excluded() || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
  if (/^\/ghost(\/|$)/.test(location.pathname) || /^\/privacy(?:[./]|$)/.test(location.pathname) || /^\/help\/privacy(?:[/-]|$)/.test(location.pathname)) return;
  let referrer = 'direct';
  try { if (document.referrer) referrer = new URL(document.referrer).hostname; } catch (_) {}
  const body = JSON.stringify({ path: location.pathname, referrer });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/_analytics/event', new Blob([body], { type: 'application/json' }));
  } else {
    fetch('/_analytics/event', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true });
  }
})();`;

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

function safeReferrer(value, site) {
  if (!value || value === 'direct') return 'direct';
  const host = String(value).toLowerCase().replace(/\.$/, '');
  if (host === site) return 'internal';
  return /^[a-z0-9.-]{1,253}$/.test(host) ? host : 'other';
}

function clientIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket.remoteAddress || '';
}

function saltPath(day) {
  return path.join(DATA_DIR, `salt-${day}`);
}

function dataPath(site, day) {
  return path.join(DATA_DIR, `analytics-${site}-${day}.json`);
}

function dailySalt(day) {
  const target = saltPath(day);
  try {
    return fs.readFileSync(target, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const salt = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(target, salt, { mode: 0o600, flag: 'wx' });
    return salt;
  }
}

function emptyDay(site, day) {
  return { site, day, views: 0, visitors: [], pages: {}, referrers: {}, ignored_automation: 0 };
}

function readDay(site, day) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(site, day), 'utf8'));
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
    if (analytics && analytics[2] < today) {
      const target = path.join(DATA_DIR, name);
      const data = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (Array.isArray(data.visitors)) {
        data.unique_visitors = data.visitors.length;
        delete data.visitors;
        data.finalized = true;
        const temporary = `${target}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, target);
      }
    }
    const salt = /^salt-(\d{4}-\d{2}-\d{2})$/.exec(name);
    if (salt && salt[1] !== today) fs.rmSync(path.join(DATA_DIR, name), { force: true });
  }
}

function record(event) {
  const day = utcDay();
  finalizeOldDays(day);
  const data = readDay(event.site, day);
  if (event.automation) {
    data.ignored_automation += 1;
  } else {
    const salt = dailySalt(day);
    const token = crypto.createHmac('sha256', salt)
      .update(`${event.site}\n${event.ip}\n${event.userAgent}`)
      .digest('hex');
    data.views += 1;
    if (!data.visitors.includes(token)) data.visitors.push(token);
    incrementDimension(data.pages, event.page);
    incrementDimension(data.referrers, event.referrer);
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
    const page = safePath(payload.path);
    if (!page) return respond(response, 204);
    const event = {
      site,
      page,
      referrer: safeReferrer(payload.referrer, site),
      ip: clientIp(request),
      userAgent: String(request.headers['user-agent'] || ''),
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
