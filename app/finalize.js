'use strict';

const { finalize } = require('./storage');

// Offline maintenance only: stop the collector before using this writer.
finalize(process.env.DATA_DIR || '/data').catch(() => {
  console.error('analytics finalization failed');
  process.exitCode = 1;
});
