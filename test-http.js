'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createCollector } = require('./app/server');

async function fixture(t, options = {}) {
  const recorded = [];
  const store = { record: async event => { recorded.push(event); }, healthy: () => true };
  const collector = createCollector({ store, sites: new Set(['scrappykin.com']), ...options });
  collector.server.listen(0, '127.0.0.1');
  await once(collector.server, 'listening');
  t.after(() => collector.stop());
  const url = `http://127.0.0.1:${collector.server.address().port}`;
  return { ...collector, url, recorded };
}

const payload = JSON.stringify({ path: '/', contract: 'consent-v1' });
function send(url, body = payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${url}/event`, {
      method: 'POST', headers: { 'x-analytics-site': 'scrappykin.com', ...headers }
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.write(body); // Exercise chunked bodies without Content-Length.
    request.end();
  });
}

function hold(url) {
  const request = http.request(`${url}/event`, {
    method: 'POST', headers: { 'x-analytics-site': 'scrappykin.com', 'transfer-encoding': 'chunked' }
  });
  request.on('error', () => {});
  const response = new Promise(resolve => request.once('response', res => {
    res.resume(); res.once('end', () => resolve(res.statusCode));
  }));
  request.flushHeaders();
  return { request, response };
}

test('byte limit rejects multibyte chunked bodies and declared oversized bodies', async t => {
  const { url, recorded } = await fixture(t);
  assert.equal(await send(url, '€'.repeat(700)), 413);
  assert.equal(await send(url, '', { 'content-length': '3000' }), 413);
  assert.equal(recorded.length, 0);
  assert.equal(await send(url), 204);
  assert.equal(recorded.length, 1);
});

test('admission bounds body readers; a timed-out reader releases its slot', async t => {
  const { server, url, recorded } = await fixture(t, { maxPending: 1, bodyTimeoutMs: 100 });
  const entered = once(server, 'request');
  const held = hold(url);
  await entered;
  assert.equal(await send(url), 503);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal(held.request.destroyed, false);
  assert.equal(await held.response, 408);
  assert.equal(await send(url), 204);
  assert.equal(recorded.length, 1);
});

test('aborted body releases its slot without crashing the server', async t => {
  const { server, url } = await fixture(t, { maxPending: 1 });
  const entered = once(server, 'request');
  const held = hold(url);
  const [incoming] = await entered;
  const closed = once(incoming, 'close').catch(() => {});
  held.request.destroy();
  await closed;
  assert.equal(await send(url), 204);
});

test('pending budget also covers rollover; storage failure is a service failure', async t => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const store = { healthy: () => false, record: async () => { entered(); await gate; throw Error('disk failed'); } };
  const { url } = await fixture(t, { maxPending: 1, store });
  const first = send(url);
  await started;
  assert.equal(await send(url), 503);
  assert.equal((await fetch(`${url}/script.js`)).status, 200);
  assert.equal((await fetch(`${url}/health`)).status, 503);
  release();
  assert.equal(await first, 503);
});

test('consent signals, legacy payloads, and excluded paths never reach recording', async t => {
  const { url, recorded } = await fixture(t);
  assert.equal(await send(url, payload, { 'sec-gpc': '1' }), 204);
  assert.equal(await send(url, payload, { dnt: '1' }), 204);
  assert.equal(await send(url, '{"path":"/"}'), 204);
  assert.equal(await send(url, '{"path":"/privacy/","contract":"consent-v1"}'), 204);
  assert.equal(await send(url, '{"path":"/","contract":"consent-v1","account":"no"}'), 204);
  assert.equal(recorded.length, 0);
});
