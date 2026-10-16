'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
const legacyFields = ['referrers', 'visitors', 'unique_visitors'];

async function writeAggregate(target, data, io = fs) {
  // Serialize before yielding: new arrivals belong to the next snapshot.
  const snapshot = `${JSON.stringify(data)}\n`;
  await io.writeFile(`${target}.tmp`, snapshot, { mode: 0o600 });
  await io.rename(`${target}.tmp`, target);
}

async function finalize(dataDir, today = utcDay(), io = fs) {
  for (const name of await io.readdir(dataDir)) {
    const match = /^analytics-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (match) {
      const target = path.join(dataDir, name);
      const data = JSON.parse(await io.readFile(target, 'utf8'));
      const changed = legacyFields.some(field => Object.hasOwn(data, field)) ||
        (match[2] < today && data.finalized !== true);
      for (const field of legacyFields) delete data[field];
      if (match[2] < today) data.finalized = true;
      if (changed) await writeAggregate(target, data, io);
    }
    if (/^salt-\d{4}-\d{2}-\d{2}$/.test(name)) await io.rm(path.join(dataDir, name), { force: true });
  }
}

async function createStore({ dataDir, sites, now = () => new Date(), io = fs }) {
  let day = utcDay(now());
  let entries = new Map();
  let flushing = null;
  let rolling = false;
  let failed = false;
  const target = (site, date) => path.join(dataDir, `analytics-${site}-${date}.json`);

  async function load(date) {
    const loaded = new Map();
    for (const site of sites) {
      let data;
      try { data = JSON.parse(await io.readFile(target(site, date), 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        data = { site, day: date, views: 0, pages: {}, ignored_automation: 0 };
      }
      for (const field of legacyFields) delete data[field];
      delete data.finalized;
      loaded.set(site, { data, version: 0, saved: 0 });
    }
    return loaded;
  }

  await io.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await finalize(dataDir, day, io);
  entries = await load(day);

  function flush() {
    if (flushing) return flushing;
    const nextDay = utcDay(now());
    rolling = nextDay > day;
    flushing = (async () => {
      for (const [site, entry] of entries) {
        if (entry.saved === entry.version) continue;
        const version = entry.version;
        await writeAggregate(target(site, day), entry.data, io);
        entry.saved = version;
      }
      if (rolling) {
        // record() waits through rollover, so yesterday cannot change here.
        await finalize(dataDir, nextDay, io);
        const loaded = await load(nextDay);
        entries = loaded;
        day = nextDay;
      }
      failed = false;
    })().catch(error => { failed = true; throw error; })
      .finally(() => { flushing = null; rolling = false; });
    return flushing;
  }

  async function record({ site, page, automation }) {
    while (rolling || utcDay(now()) > day) await flush();
    if (utcDay(now()) < day || !entries.has(site)) throw Error('store_unavailable');
    const entry = entries.get(site);
    if (automation) entry.data.ignored_automation += 1;
    else {
      entry.data.views += 1;
      const pages = entry.data.pages;
      if (!Object.hasOwn(pages, page) && Object.keys(pages).length >= 500) page = 'other';
      pages[page] = (Object.hasOwn(pages, page) ? pages[page] : 0) + 1;
    }
    entry.version += 1;
  }

  return { record, flush, healthy: () => !failed };
}

module.exports = { createStore, finalize, utcDay };
