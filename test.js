'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-analytics-'));
const port = 19000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['app/server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ALLOWED_SITES: 'blog.scrappykin.com,scrappykin.com' },
  stdio: 'ignore'
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy');
}

async function event(headers = {}, body = { path: '/field-note/', referrer: 'bsky.app' }, site = 'blog.scrappykin.com') {
  return fetch(`http://127.0.0.1:${port}/event`, {
    method: 'POST',
    headers: {
      'x-analytics-site': site,
      'content-type': 'application/json',
      'user-agent': 'Test Browser',
      'x-forwarded-for': '203.0.113.9',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function runClient(script, { stored = null, gpc = false, dnt = '0', pathname = '/', referrer = '' } = {}) {
  const sent = [];
  const storage = new Map(stored === null ? [] : [['scrappy_kin_analytics_ignore', stored]]);
  const context = {
    Blob,
    document: { referrer },
    fetch: (...args) => { sent.push(args); return Promise.resolve({ ok: true }); },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value)
    },
    location: { pathname },
    navigator: {
      doNotTrack: dnt,
      globalPrivacyControl: gpc,
      sendBeacon: (...args) => { sent.push(args); return true; }
    },
    URL,
    window: {}
  };
  vm.runInNewContext(script, context);
  return { context, sent, storage };
}

(async () => {
  try {
    await waitForHealth();
    assert.equal((await event()).status, 204);
    assert.equal((await event()).status, 204);
    assert.equal((await event({ 'sec-gpc': '1' })).status, 204);
    assert.equal((await event({ dnt: '1' })).status, 204);
    assert.equal((await event({ 'user-agent': 'FriendlyBot' })).status, 204);
    assert.equal((await event({}, { path: '/privacy/', referrer: 'direct' })).status, 204);
    assert.equal((await event({}, { path: '/ghost/settings/', referrer: 'direct' })).status, 204);
    assert.equal((await event({}, {
      path: '/field-note/?secret=query-value#fragment',
      referrer: 'bsky.app',
      account: 'forbidden-account',
      fullUrl: 'https://example.invalid/private',
      geography: 'forbidden-place'
    })).status, 204);
    assert.equal((await event({}, { path: '/', referrer: 'direct' }, 'scrappykin.com')).status, 204);

    const dataName = fs.readdirSync(dataDir).find((name) => name.startsWith('analytics-blog.scrappykin.com-'));
    const raw = fs.readFileSync(path.join(dataDir, dataName), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.views, 3);
    assert.equal(data.visitors.length, 1);
    assert.equal(data.pages['/field-note'], 3);
    assert.equal(data.referrers['bsky.app'], 3);
    assert.equal(data.ignored_automation, 1);
    assert.equal(raw.includes('203.0.113.9'), false);
    assert.equal(raw.includes('Test Browser'), false);
    assert.equal(raw.includes('query-value'), false);
    assert.equal(raw.includes('forbidden-account'), false);
    assert.equal(raw.includes('example.invalid'), false);
    assert.equal(raw.includes('forbidden-place'), false);

    const mainSiteName = fs.readdirSync(dataDir).find((name) => name.startsWith('analytics-scrappykin.com-'));
    const mainSite = JSON.parse(fs.readFileSync(path.join(dataDir, mainSiteName), 'utf8'));
    assert.equal(mainSite.site, 'scrappykin.com');
    assert.equal(mainSite.views, 1);

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const oldReport = path.join(dataDir, `analytics-blog.scrappykin.com-${yesterday}.json`);
    fs.writeFileSync(oldReport, JSON.stringify({ site: 'blog.scrappykin.com', day: yesterday, views: 3, visitors: ['one', 'two'], pages: { '/old': 3 }, referrers: { direct: 3 }, ignored_automation: 0 }));
    fs.writeFileSync(path.join(dataDir, `salt-${yesterday}`), 'do-not-keep');
    const finalize = spawn(process.execPath, ['app/finalize.js'], { cwd: __dirname, env: { ...process.env, DATA_DIR: dataDir } });
    assert.equal(await new Promise((resolve) => finalize.on('exit', resolve)), 0);
    const finalized = JSON.parse(fs.readFileSync(oldReport, 'utf8'));
    assert.equal(finalized.unique_visitors, 2);
    assert.equal('visitors' in finalized, false);
    assert.equal(fs.existsSync(path.join(dataDir, `salt-${yesterday}`)), false);

    const exporter = spawn(process.execPath, ['app/export.js'], { cwd: __dirname, env: { ...process.env, DATA_DIR: dataDir } });
    let exported = '';
    exporter.stdout.on('data', (chunk) => { exported += chunk; });
    assert.equal(await new Promise((resolve) => exporter.on('exit', resolve)), 0);
    const archive = JSON.parse(exported);
    assert.equal(archive.summaries.length, 1);
    assert.equal(exported.includes('visitors'), true);
    assert.equal(exported.includes('"visitors"'), false);

    const script = await (await fetch(`http://127.0.0.1:${port}/script.js`)).text();
    assert.match(script, /globalPrivacyControl/);
    assert.match(script, /scrappy_kin_analytics_ignore/);
    assert.match(script, /help\\\/privacy/);
    assert.equal(runClient(script).sent.length, 1);
    assert.equal(runClient(script, { stored: 'true' }).sent.length, 0);
    assert.equal(runClient(script, { gpc: true }).sent.length, 0);
    assert.equal(runClient(script, { dnt: '1' }).sent.length, 0);
    assert.equal(runClient(script, { pathname: '/privacy' }).sent.length, 0);
    assert.equal(runClient(script, { pathname: '/ghost/settings' }).sent.length, 0);
    const controls = runClient(script);
    controls.context.window.scrappyKinAnalytics.exclude();
    assert.equal(controls.storage.get('scrappy_kin_analytics_ignore'), 'true');
    controls.context.window.scrappyKinAnalytics.include();
    assert.equal(controls.storage.has('scrappy_kin_analytics_ignore'), false);
    console.log('privacy analytics tests passed');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
