'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('./app/storage');

const site = 'scrappykin.com';
const sites = new Set([site]);
const event = { site, page: '/', automation: false };
const report = (dir, day) => path.join(dir, `analytics-${site}-${day}.json`);
const read = async (dir, day) => JSON.parse(await fs.readFile(report(dir, day), 'utf8'));
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'analytics-storage-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('load once, batch counts, bound paths, and resume after restart', async t => {
  const dataDir = await directory(t);
  let reads = 0;
  let scans = 0;
  let writes = 0;
  const io = { ...fs,
    readFile: (...args) => { reads++; return fs.readFile(...args); },
    readdir: (...args) => { scans++; return fs.readdir(...args); },
    writeFile: (...args) => { writes++; return fs.writeFile(...args); }
  };
  const options = { dataDir, sites, io, now: () => new Date('2026-10-16T12:00:00Z') };
  const store = await createStore(options);
  for (let i = 0; i < 505; i++) await store.record({ ...event, page: `/page-${i}` });
  await store.record({ ...event, automation: true });
  assert.equal(reads, 1);
  assert.equal(scans, 1);
  assert.equal(writes, 0);
  await store.flush();
  assert.equal(writes, 1);
  const data = await read(dataDir, '2026-10-16');
  assert.equal(data.views, 505);
  assert.equal(data.ignored_automation, 1);
  assert.equal(Object.keys(data.pages).length, 501);
  assert.equal(data.pages.other, 5);
  await store.flush();
  assert.equal(writes, 1);
  const restarted = await createStore(options);
  await restarted.record(event);
  await restarted.flush();
  assert.equal((await read(dataDir, '2026-10-16')).views, 506);
});

test('failed rename retains counts; retry replaces rather than replays increments', async t => {
  const dataDir = await directory(t);
  let fail = true;
  const io = { ...fs, rename: (...args) => fail ? Promise.reject(Error('disk failed')) : fs.rename(...args) };
  const store = await createStore({ dataDir, sites, io });
  await store.record(event);
  await assert.rejects(store.flush(), /disk failed/);
  assert.equal(store.healthy(), false);
  await store.record(event);
  fail = false;
  await store.flush();
  assert.equal(store.healthy(), true);
  assert.equal((await read(dataDir, new Date().toISOString().slice(0, 10))).views, 2);
});

test('one writer; arrivals during a flush remain dirty for the next snapshot', async t => {
  const dataDir = await directory(t);
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let writes = 0;
  const io = { ...fs, writeFile: async (...args) => {
    if (++writes === 1) { started(); await gate; }
    return fs.writeFile(...args);
  } };
  const store = await createStore({ dataDir, sites, io });
  await store.record(event);
  const first = store.flush();
  await entered;
  assert.equal(store.flush(), first);
  await store.record(event);
  release();
  await first;
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await read(dataDir, day)).views, 1);
  await store.flush();
  assert.equal((await read(dataDir, day)).views, 2);
  assert.equal(writes, 2);
});

test('startup scrubs today and salts; quiet rollover finalizes yesterday', async t => {
  const dataDir = await directory(t);
  let time = new Date('2026-10-16T23:59:59Z');
  await fs.writeFile(report(dataDir, '2026-10-16'), JSON.stringify({
    site, day: '2026-10-16', views: 2, pages: { '/': 2 }, ignored_automation: 0,
    visitors: ['old'], unique_visitors: 1, referrers: { example: 2 }
  }));
  await fs.writeFile(path.join(dataDir, 'salt-2026-10-16'), 'old');
  const store = await createStore({ dataDir, sites, now: () => time });
  const scrubbed = await read(dataDir, '2026-10-16');
  assert.equal('visitors' in scrubbed || 'unique_visitors' in scrubbed || 'referrers' in scrubbed, false);
  assert.equal(scrubbed.finalized, undefined);
  assert.equal((await fs.readdir(dataDir)).some(name => name.startsWith('salt-')), false);
  await store.record(event);
  time = new Date('2026-10-17T00:00:01Z');
  await store.flush();
  assert.equal((await read(dataDir, '2026-10-16')).finalized, true);
  assert.equal((await read(dataDir, '2026-10-16')).views, 3);
  await store.record(event);
  await store.flush();
  assert.equal((await read(dataDir, '2026-10-17')).views, 1);
});

test('failed rollover blocks new-day increments until recovery', async t => {
  const dataDir = await directory(t);
  let time = new Date('2026-10-16T23:59:59Z');
  let fail = false;
  const io = { ...fs, rename: (...args) => fail ? Promise.reject(Error('disk failed')) : fs.rename(...args) };
  const store = await createStore({ dataDir, sites, now: () => time, io });
  await store.record(event);
  fail = true;
  time = new Date('2026-10-17T00:00:01Z');
  await assert.rejects(store.record(event));
  fail = false;
  await store.record(event);
  await store.flush();
  assert.equal((await read(dataDir, '2026-10-16')).views, 1);
  assert.equal((await read(dataDir, '2026-10-17')).views, 1);
});

test('midnight arrival waits for an older in-flight snapshot and records on the new day', async t => {
  const dataDir = await directory(t);
  let time = new Date('2026-10-16T23:59:59Z');
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  const io = { ...fs, rename: async (...args) => {
    if (first) { first = false; started(); await gate; }
    return fs.rename(...args);
  } };
  const store = await createStore({ dataDir, sites, now: () => time, io });
  await store.record(event);
  const flushing = store.flush();
  await entered;
  time = new Date('2026-10-17T00:00:01Z');
  const newDay = store.record(event);
  release();
  await Promise.all([flushing, newDay]);
  await store.flush();
  assert.equal((await read(dataDir, '2026-10-16')).views, 1);
  assert.equal((await read(dataDir, '2026-10-16')).finalized, true);
  assert.equal((await read(dataDir, '2026-10-17')).views, 1);
});

test('an abrupt restart recovers the last flushed snapshot, losing only unflushed counts', async t => {
  const dataDir = await directory(t);
  const store = await createStore({ dataDir, sites });
  await store.record(event);
  await store.flush();
  await store.record(event); // Abandon this in-memory state, as on a crash.
  const restarted = await createStore({ dataDir, sites });
  await restarted.record(event);
  await restarted.flush();
  assert.equal((await read(dataDir, new Date().toISOString().slice(0, 10))).views, 2);
});
