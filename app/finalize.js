'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR || '/data';
const today = new Date().toISOString().slice(0, 10);
for (const name of fs.readdirSync(dataDir)) {
  const analytics = /^analytics-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
  if (analytics && analytics[2] < today) {
    const target = path.join(dataDir, name);
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
  if (salt && salt[1] !== today) fs.rmSync(path.join(dataDir, name), { force: true });
}
