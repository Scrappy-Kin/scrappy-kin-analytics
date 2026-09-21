'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR || '/data';
const daysArg = process.argv[2] || '30';
const siteArg = process.argv[3] || 'all';
const days = daysArg === 'all' ? null : Math.max(1, Math.min(36500, Number(daysArg)));
if (daysArg !== 'all' && !Number.isInteger(days)) throw new Error('days must be an integer or all');
const cutoff = new Date();
if (days) {
  cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
  cutoff.setUTCHours(0, 0, 0, 0);
}

const reports = fs.readdirSync(dataDir)
  .filter((name) => /^analytics-.+-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .map((name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
  .filter((report) => (siteArg === 'all' || report.site === siteArg) && (!days || new Date(`${report.day}T00:00:00Z`) >= cutoff))
  .sort((left, right) => left.day.localeCompare(right.day) || left.site.localeCompare(right.site));

const pages = {};
const referrers = {};
let views = 0;
let dailyVisitors = 0;
let automation = 0;
for (const report of reports) {
  views += report.views;
  dailyVisitors += report.unique_visitors ?? report.visitors?.length ?? 0;
  automation += report.ignored_automation;
  for (const [key, count] of Object.entries(report.pages)) pages[`${report.site}${key}`] = (pages[`${report.site}${key}`] || 0) + count;
  for (const [key, count] of Object.entries(report.referrers)) referrers[key] = (referrers[key] || 0) + count;
}

const top = (values) => Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`Scrappy Kin privacy analytics — ${days ? `last ${days} UTC day(s)` : 'all history'} — ${siteArg}`);
console.log(`views=${views} daily_unique_visitors=${dailyVisitors} ignored_automation=${automation}`);
console.log('Daily unique visitors cannot be linked across days or sites.');
console.log('\nDaily');
for (const report of reports) console.log(`  ${report.day}  ${report.site}  views=${report.views} unique=${report.unique_visitors ?? report.visitors?.length ?? 0}${report.finalized ? '' : ' (today)'}`);
console.log('\nTop pages');
for (const [key, count] of top(pages)) console.log(`  ${String(count).padStart(6)}  ${key}`);
console.log('\nReferrers');
for (const [key, count] of top(referrers)) console.log(`  ${String(count).padStart(6)}  ${key}`);
