'use strict';

const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR || '/data';
const today = new Date().toISOString().slice(0, 10);
for (const name of fs.readdirSync(dataDir)) {
  const analytics = /^analytics-(.+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
  if (analytics) {
    const target = path.join(dataDir, name);
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    const hadLegacy = ['referrers', 'visitors', 'unique_visitors']
      .some((field) => Object.prototype.hasOwnProperty.call(data, field));
    const wasFinalized = data.finalized === true;
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
  if (salt) fs.rmSync(path.join(dataDir, name), { force: true });
}
