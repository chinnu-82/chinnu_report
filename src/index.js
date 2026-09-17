'use strict';

const path = require('path');
const { resolveConfig, deepMerge, DEFAULTS } = require('./config');

/**
 * Wraps your Playwright config with Aurora in one line:
 *
 *   module.exports = withAurora(defineConfig({ ... }), { title: 'Checkout suite' });
 *
 * - adds the Aurora reporter (keeping your other reporters)
 * - turns on video/trace according to `capture.video` / `capture.trace`
 *   (anything you set explicitly in `use` still wins)
 */
function withAurora(playwrightConfig = {}, options = {}) {
  const merged = deepMerge(safeEnv(), options);
  process.env.AURORA_OPTIONS = JSON.stringify(merged);
  const cfg = resolveConfig(merged);

  const reporterPath = path.join(__dirname, 'reporter.js');
  const existing = normalizeReporters(playwrightConfig.reporter)
    .filter(([name]) => !String(name).includes('aurora-report') && path.resolve(String(name)) !== reporterPath);

  return {
    ...playwrightConfig,
    reporter: [...(existing.length ? existing : [['list']]), [reporterPath, merged]],
    use: {
      video: cfg.capture.video,
      trace: cfg.capture.trace,
      ...(playwrightConfig.use || {}),
    },
  };
}

function normalizeReporters(r) {
  if (!r) return [];
  if (typeof r === 'string') return [[r]];
  return r.map((x) => (Array.isArray(x) ? x : [x]));
}

function safeEnv() {
  try { return JSON.parse(process.env.AURORA_OPTIONS || '{}'); } catch { return {}; }
}

/** Identity helper for aurora.config.js to get editor autocompletion. */
function defineAuroraConfig(options) {
  return options;
}

const { test, expect } = require('./fixtures');

// Plain assignments (not getters) so ESM projects can `import { test, expect } from 'aurora-report'`.
exports.withAurora = withAurora;
exports.defineAuroraConfig = defineAuroraConfig;
exports.DEFAULTS = DEFAULTS;
exports.test = test;
exports.expect = expect;
