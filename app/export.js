'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR || '/data';
const summaries = fs.readdirSync(dataDir)
  .filter((name) => /^analytics-.+-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .map((name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
  .filter((report) => report.finalized === true && !('visitors' in report))
  .sort((left, right) => left.day.localeCompare(right.day) || left.site.localeCompare(right.site));
process.stdout.write(`${JSON.stringify({ format: 1, summaries }, null, 2)}\n`);
