'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Every option Aurora understands, with its default.
 * Users only override what they care about — in aurora.config.js,
 * in withAurora(config, { ... }) or in the reporter tuple options.
 */
const DEFAULTS = {
  title: 'Test Report',
  subtitle: '',
  /** Path or URL to a logo image shown in the header. */
  logo: null,
  /** Where the report is written (relative to the project root). */
  outputDir: 'aurora-report',
  /**
   * Keep every run instead of overwriting: each run is written to
   * <outputDir>/<timestamp>/index.html, and <outputDir>/index.html lists them all.
   */
  timestampedRuns: false,
  /** How many timestamped run folders to keep. Older ones are deleted. 0 keeps everything. */
  keepRuns: 30,
  /** 'always' | 'never' | 'on-failure' — open the report in your browser when the run ends. */
  open: 'on-failure',
  /** Embed every screenshot/video into index.html so the report is a single portable file. */
  singleFile: false,

  theme: {
    /** 'auto' | 'light' | 'dark' */
    mode: 'auto',
    /** Brand accent used for highlights, links and the header glow. */
    accent: '#7c5cff',
  },

  capture: {
    /** Screenshot after each report.step(): 'on' | 'on-failure' | 'off' */
    stepScreenshots: 'on',
    /** Take a screenshot automatically when a test fails. */
    failureScreenshot: true,
    /** Save the page HTML when a test fails. */
    failureHtml: true,
    /** Capture full scrollable page instead of the viewport. */
    fullPage: false,
    /** Passed to Playwright use.video by withAurora(): 'on' | 'off' | 'retain-on-failure' | 'on-first-retry' */
    video: 'retain-on-failure',
    /** Passed to Playwright use.trace by withAurora(). */
    trace: 'retain-on-failure',
    /** Record browser console errors & warnings. */
    console: true,
    /** Record uncaught page exceptions. */
    pageErrors: true,
    /** Record failed requests and HTTP responses >= 400. */
    network: true,
  },

  charts: {
    trend: true,
    timeline: true,
    slowest: true,
    suites: true,
    failureReasons: true,
    projects: true,
  },

  history: {
    enabled: true,
    /** How many previous runs are kept for trend charts and stability scores. */
    keep: 30,
  },

  /** Tests slower than this (ms) get a "slow" badge. */
  slowTestThreshold: 10000,

  /** Extra key/values shown in the Environment panel, e.g. { Build: '1.4.2', Branch: 'main' } */
  environment: {},

  links: {
    /** Annotation types 'issue' / 'bug' become links. {id} is replaced. */
    issue: '',
    /** Optional link to the CI job. */
    ci: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '',
  },
};

const CONFIG_FILES = ['aurora.config.js', 'aurora.config.cjs', 'aurora.config.json'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, ...overrides) {
  const out = { ...base };
  for (const o of overrides) {
    if (!isPlainObject(o)) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
    }
  }
  return out;
}

function loadFileConfig(rootDir) {
  for (const name of CONFIG_FILES) {
    const file = path.join(rootDir, name);
    if (!fs.existsSync(file)) continue;
    try {
      if (name.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
      // require.cache is unavailable when Playwright loads this module from an ESM config.
      if (require.cache) delete require.cache[require.resolve(file)];
      const mod = require(file);
      return mod && mod.default ? mod.default : mod;
    } catch (e) {
      const esmHint = name.endsWith('.js') ? ' If your project uses "type": "module", rename it to aurora.config.cjs (module.exports = {...}) or use aurora.config.json.' : '';
      console.warn(`[aurora] Could not load ${name}: ${e.message}.${esmHint}`);
    }
  }
  return {};
}

function envConfig() {
  try {
    return process.env.AURORA_OPTIONS ? JSON.parse(process.env.AURORA_OPTIONS) : {};
  } catch {
    return {};
  }
}

/**
 * Resolution order (later wins): defaults → aurora.config.js → withAurora()/env → reporter options.
 */
function resolveConfig(inlineOptions = {}, rootDir = process.cwd()) {
  return deepMerge(DEFAULTS, loadFileConfig(rootDir), envConfig(), inlineOptions);
}

module.exports = { DEFAULTS, resolveConfig, deepMerge };
