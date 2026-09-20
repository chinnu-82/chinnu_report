'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolveConfig } = require('./config');
const { analyzeError, stripAnsi, CATEGORY_LABELS } = require('./errors');
const { renderReport } = require('./render');
const { renderRunsIndex } = require('./runs-index');
const { STORY_ATTACHMENT, DIAGNOSTICS_ATTACHMENT } = require('./fixtures-constants');

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'video/webm': '.webm', 'video/mp4': '.mp4', 'application/zip': '.zip', 'application/json': '.json',
  'text/plain': '.txt', 'text/html': '.html', 'text/markdown': '.md', 'text/csv': '.csv',
};
const INLINE_TEXT_LIMIT = 64 * 1024;
const STEP_CATEGORIES = new Set(['test.step', 'expect', 'pw:api', 'hook', 'fixture']);

class AuroraReporter {
  constructor(options = {}) {
    this.options = options;
    this.tests = new Map();
    this.order = [];
    this.assetCount = 0;
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    this.rootDir = config.rootDir || process.cwd();
    this.cfg = resolveConfig(this.options, process.cwd());
    this.outDir = path.resolve(process.cwd(), this.cfg.outputDir);
    this.startedAt = Date.now();
    // With timestampedRuns, every run gets its own folder so earlier reports are kept.
    this.runFolder = this.cfg.timestampedRuns ? runFolderName(new Date(this.startedAt)) : '';
    this.runDir = this.runFolder ? path.join(this.outDir, this.runFolder) : this.outDir;
    this.assetsDir = path.join(this.runDir, 'assets');
    this.fullConfig = config;
    this.totalPlanned = suite.allTests().length;

    fs.rmSync(this.assetsDir, { recursive: true, force: true });
    fs.mkdirSync(this.assetsDir, { recursive: true });
  }

  onTestEnd(test, result) {
    let entry = this.tests.get(test.id);
    if (!entry) {
      entry = { test, attempts: [] };
      this.tests.set(test.id, entry);
      this.order.push(test.id);
    }
    try {
      entry.attempts.push(this.buildAttempt(test, result, entry.attempts.length));
    } catch (e) {
      console.warn(`[aurora] Could not process result for "${test.title}": ${e.stack}`);
    }
  }

  async onEnd(fullResult) {
    try {
      const data = this.buildData(fullResult);
      fs.mkdirSync(this.runDir, { recursive: true });
      fs.writeFileSync(path.join(this.runDir, 'index.html'), renderReport(data), 'utf8');
      fs.writeFileSync(path.join(this.runDir, 'results.json'), JSON.stringify(data, null, 2), 'utf8');
      // Traces are never embedded, so keep the assets folder when it still holds files.
      if (this.cfg.singleFile && !fs.readdirSync(this.assetsDir).length) fs.rmSync(this.assetsDir, { recursive: true, force: true });

      const file = path.join(this.runDir, 'index.html');
      const { stats } = data;
      const line = `${stats.passed} passed · ${stats.failed} failed · ${stats.flaky} flaky · ${stats.skipped} skipped`;
      let indexNote = '';
      if (this.runFolder) {
        this.pruneOldRuns();
        indexNote = `\n     all runs: ${pathToUrl(path.join(this.outDir, 'index.html'))}`;
      }
      console.log(`\n  ✨ Aurora report  ${line}\n     ${pathToUrl(file)}${indexNote}\n`);

      const open = this.cfg.open;
      if (!process.env.CI && (open === 'always' || (open === 'on-failure' && stats.failed > 0))) openInBrowser(file);
    } catch (e) {
      console.error(`[aurora] Failed to write report: ${e.stack}`);
    }
  }

  /**
   * Deletes the oldest timestamped run folders and rewrites <outputDir>/index.html,
   * the page that lists every kept run.
   */
  pruneOldRuns() {
    const keepRuns = this.cfg.keepRuns;
    let folders = fs.readdirSync(this.outDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && RUN_FOLDER_RE.test(d.name))
      .map((d) => d.name)
      .sort(); // the name format sorts chronologically

    if (keepRuns > 0 && folders.length > keepRuns) {
      for (const old of folders.slice(0, folders.length - keepRuns)) {
        fs.rmSync(path.join(this.outDir, old), { recursive: true, force: true });
      }
      folders = folders.slice(-keepRuns);
    }

    const known = new Map((this.historyRuns || []).filter((r) => r.folder).map((r) => [r.folder, r]));
    const runs = folders.map((folder) => known.get(folder) || runSummaryFromDisk(this.outDir, folder)).filter(Boolean);

    fs.writeFileSync(
      path.join(this.outDir, 'index.html'),
      renderRunsIndex({ title: this.cfg.title, accent: this.cfg.theme.accent, runs }),
      'utf8',
    );
  }

  /* ------------------------------------------------------------------ */

  buildAttempt(test, result, index) {
    const atts = result.attachments || [];
    const byName = new Map();
    const media = [];
    let story = null;
    let diagnostics = null;

    for (const a of atts) {
      if (a.name === STORY_ATTACHMENT) { story = readJson(a); continue; }
      if (a.name === DIAGNOSTICS_ATTACHMENT) { diagnostics = readJson(a); continue; }
      const asset = this.storeAttachment(test, index, a);
      if (!asset) continue;
      byName.set(a.name, asset);
      if (!a.name.startsWith('aurora-shot-') && !a.name.startsWith('aurora-data-')) media.push(asset);
    }

    const errors = (result.errors && result.errors.length ? result.errors : result.error ? [result.error] : [])
      .map(analyzeError).filter(Boolean);

    const steps = (result.steps || []).map((s) => convertStep(s, this.rootDir)).filter(Boolean);
    const events = story ? storyFromRecorder(story.events, byName) : storyFromSteps(steps);

    const failureShot = byName.get('aurora-failure') || media.find((m) => m.name === 'screenshot' && m.kind === 'image');
    if (failureShot && errors.length) {
      events.push({ id: events.length + 1, kind: 'failure', title: 'Moment of failure', depth: 0, status: 'failed',
        at: result.duration, screenshot: failureShot, error: errors[0].title });
    }

    return {
      retry: result.retry,
      status: result.status,
      duration: result.duration,
      start: new Date(result.startTime).getTime(),
      worker: result.workerIndex,
      lane: result.parallelIndex ?? result.workerIndex,
      errors,
      story: events,
      steps,
      media: groupMedia(media),
      diagnostics,
      stdout: joinOutput(result.stdout),
      stderr: joinOutput(result.stderr),
    };
  }

  storeAttachment(test, retry, a) {
    const type = (a.contentType || '').split(';')[0];
    const kind = type.startsWith('image/') ? 'image'
      : type.startsWith('video/') ? 'video'
      : a.name === 'trace' || type === 'application/zip' ? 'trace'
      : type === 'text/html' ? 'html'
      : type.startsWith('text/') || type.includes('json') ? 'text'
      : 'file';

    let buffer = null;
    if (a.body) buffer = Buffer.isBuffer(a.body) ? a.body : Buffer.from(a.body);
    else if (!a.path || !fs.existsSync(a.path)) return null;

    const asset = { name: a.name, label: prettyName(a.name), type, kind };

    if (kind === 'text' && (buffer || a.path)) {
      const b = buffer || fs.readFileSync(a.path);
      if (b.length <= INLINE_TEXT_LIMIT) {
        asset.text = b.toString('utf8');
        return asset;
      }
    }

    if (this.cfg.singleFile && kind !== 'trace') {
      const b = buffer || fs.readFileSync(a.path);
      asset.src = `data:${type || 'application/octet-stream'};base64,${b.toString('base64')}`;
      return asset;
    }

    const ext = MIME_EXT[type] || path.extname(a.path || '') || '.bin';
    const fileName = `${slug(test.title).slice(0, 40)}-${++this.assetCount}${ext}`;
    const dest = path.join(this.assetsDir, fileName);
    if (buffer) fs.writeFileSync(dest, buffer);
    else fs.copyFileSync(a.path, dest);
    asset.src = `assets/${fileName}`;
    asset.size = buffer ? buffer.length : fs.statSync(dest).size;
    if (kind === 'trace') asset.command = `npx playwright show-trace "${dest}"`;
    return asset;
  }

  buildData(fullResult) {
    const cfg = this.cfg;
    const runStart = fullResult.startTime ? new Date(fullResult.startTime).getTime() : this.startedAt;
    const tests = [];

    for (const id of this.order) {
      const { test, attempts } = this.tests.get(id);
      const outcome = normalizeOutcome(test.outcome());
      const project = projectOf(test);
      const file = path.relative(this.rootDir, test.location.file).replace(/\\/g, '/');
      const titlePath = test.titlePath().filter(Boolean);
      const describe = titlePath.slice(titlePath.indexOf(path.basename(test.location.file)) + 1, -1);
      const ann = test.annotations || [];
      const pick = (type) => ann.filter((a) => a.type === type).map((a) => a.description);

      attempts.forEach((a) => { a.start -= runStart; });
      const last = attempts[attempts.length - 1] || {};

      tests.push({
        id,
        key: `${project}›${file}›${[...describe, test.title].join('›')}`,
        title: test.title,
        describe,
        file,
        line: test.location.line,
        project,
        tags: [...new Set([...(test.tags || []), ...extractTags(test.title)])],
        severity: pick('severity')[0] || null,
        owner: pick('owner')[0] || null,
        feature: pick('feature')[0] || null,
        description: pick('description').join('\n\n') || null,
        issues: pick('issue').concat(pick('bug')),
        links: pick('link').map((l) => { const [label, url] = l.includes('|') ? l.split('|') : [l, l]; return { label, url }; }),
        annotations: ann.filter((a) => !['severity', 'owner', 'feature', 'description', 'issue', 'bug', 'link'].includes(a.type)),
        outcome,
        duration: attempts.reduce((s, a) => s + (a.duration || 0), 0),
        lastDuration: last.duration || 0,
        slow: (last.duration || 0) >= cfg.slowTestThreshold,
        attempts,
      });
    }

    const stats = { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    tests.forEach((t) => { stats[t.outcome]++; });
    stats.duration = fullResult.duration ?? Date.now() - this.startedAt;
    stats.passRate = stats.total - stats.skipped ? (stats.passed + stats.flaky) / (stats.total - stats.skipped) : 1;
    stats.retries = tests.reduce((s, t) => s + Math.max(0, t.attempts.length - 1), 0);
    stats.status = fullResult.status;

    const history = this.updateHistory(stats, tests, runStart);

    return {
      meta: {
        title: cfg.title,
        subtitle: cfg.subtitle,
        logo: resolveLogo(cfg.logo),
        accent: cfg.theme.accent,
        themeMode: cfg.theme.mode,
        charts: cfg.charts,
        issueLink: cfg.links.issue,
        ciLink: cfg.links.ci,
        slowTestThreshold: cfg.slowTestThreshold,
        startedAt: runStart,
        generatedAt: Date.now(),
        planned: this.totalPlanned,
        environment: {
          Playwright: pwVersion(),
          Node: process.version,
          OS: `${os.type()} ${os.release()} (${os.arch()})`,
          Workers: String(this.fullConfig.workers),
          Projects: this.fullConfig.projects.map((p) => p.name).filter(Boolean).join(', ') || 'default',
          ...Object.fromEntries(Object.entries(cfg.environment || {}).map(([k, v]) => [k, String(v)])),
        },
        categories: CATEGORY_LABELS,
      },
      stats,
      tests,
      clusters: clusterFailures(tests),
      history: history.runs,
      stability: history.stability,
    };
  }

  updateHistory(stats, tests, runStart) {
    const file = path.join(this.outDir, 'history.json');
    let hist = { runs: [], tests: {} };
    if (this.cfg.history.enabled) {
      try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    }
    const keep = this.cfg.history.keep;
    hist.runs = [...(hist.runs || []), {
      at: runStart, total: stats.total, passed: stats.passed, failed: stats.failed, flaky: stats.flaky,
      skipped: stats.skipped, duration: stats.duration,
      ...(this.runFolder ? { folder: this.runFolder } : {}),
    }].slice(-keep);
    this.historyRuns = hist.runs;
    hist.tests = hist.tests || {};
    for (const t of tests) {
      if (t.outcome === 'skipped') continue;
      hist.tests[t.key] = [...(hist.tests[t.key] || []), { o: { passed: 'p', failed: 'f', flaky: 'k' }[t.outcome], d: t.lastDuration }].slice(-keep);
    }
    if (this.cfg.history.enabled) {
      fs.mkdirSync(this.outDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(hist), 'utf8');
    }
    const stability = {};
    for (const t of tests) stability[t.id] = hist.tests[t.key] || [];
    return { runs: hist.runs, stability };
  }
}

/* -------------------------------------------------------------------- */

function convertStep(step, rootDir, depth = 0) {
  if (!STEP_CATEGORIES.has(step.category)) return null;
  if (step.category === 'fixture' && !step.error) return null;
  if (depth > 12) return null;
  const children = (step.steps || []).map((s) => convertStep(s, rootDir, depth + 1)).filter(Boolean);
  return {
    title: step.title,
    category: step.category,
    duration: step.duration,
    error: step.error ? stripAnsi(step.error.message || '').split('\n')[0] : null,
    location: step.location ? `${path.relative(rootDir, step.location.file).replace(/\\/g, '/')}:${step.location.line}` : null,
    steps: children,
  };
}

function storyFromRecorder(events, assets) {
  return (events || []).map((e) => ({
    ...e,
    screenshot: e.screenshot ? assets.get(e.screenshot) || null : null,
    data: e.attachment ? assets.get(e.attachment) || null : undefined,
  }));
}

/** Fallback for tests that don't use the report fixture: use Playwright's own test.step tree. */
function storyFromSteps(steps) {
  const out = [];
  let at = 0;
  const walk = (list, depth, parent) => {
    for (const s of list) {
      if (s.category === 'hook' || s.category === 'fixture') continue;
      const e = { id: out.length + 1, kind: 'step', title: s.title, depth, parent, at, duration: s.duration,
        status: s.error ? 'failed' : 'passed', error: s.error, category: s.category };
      out.push(e);
      if (s.category === 'test.step') walk(s.steps, depth + 1, e.id);
      at += s.category === 'test.step' ? 0 : s.duration;
    }
  };
  walk(steps, 0, null);
  return out;
}

function groupMedia(media) {
  const visual = {};
  const rest = [];
  for (const m of media) {
    const v = m.name.match(/^(.*)-(expected|actual|diff|previous)\.(png|jpe?g)$/);
    if (v && m.kind === 'image') {
      (visual[v[1]] ||= { name: v[1] })[v[2]] = m;
    } else rest.push(m);
  }
  return { items: rest, visual: Object.values(visual) };
}

function clusterFailures(tests) {
  const map = new Map();
  for (const t of tests) {
    if (t.outcome !== 'failed') continue;
    const attempt = t.attempts[t.attempts.length - 1];
    const err = attempt && attempt.errors[0];
    if (!err) continue;
    const key = `${err.category}|${err.signature}`;
    if (!map.has(key)) map.set(key, { key, category: err.category, icon: err.icon, title: err.title, message: err.message.split('\n')[0], explanation: err.explanation, tests: [] });
    map.get(key).tests.push({ id: t.id, outcome: t.outcome });
  }
  return [...map.values()].sort((a, b) => b.tests.length - a.tests.length);
}

function normalizeOutcome(o) {
  return { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' }[o] || 'failed';
}

function projectOf(test) {
  let s = test.parent;
  while (s) {
    if (s.project && s.project()) return s.project().name || 'default';
    s = s.parent;
  }
  return 'default';
}

function extractTags(title) {
  return (title.match(/(?:^|\s)@[\w-]+/g) || []).map((t) => t.trim());
}

function readJson(a) {
  try {
    const raw = a.body ? a.body.toString('utf8') : fs.readFileSync(a.path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function joinOutput(chunks) {
  const s = (chunks || []).map((c) => (Buffer.isBuffer(c) ? c.toString('utf8') : String(c))).join('');
  return stripAnsi(s).slice(0, 100000);
}

function prettyName(name) {
  if (name === 'aurora-failure') return 'Failure screenshot';
  if (name === 'aurora-failure-html') return 'Page HTML at failure';
  if (name === 'screenshot') return 'Screenshot';
  if (name === 'video') return 'Video recording';
  if (name === 'trace') return 'Playwright trace';
  if (name === 'error-context') return 'Page snapshot at failure (accessibility tree)';
  return name;
}

function resolveLogo(logo) {
  if (!logo || /^(https?:|data:)/.test(logo)) return logo || null;
  try {
    const file = path.resolve(process.cwd(), logo);
    const ext = path.extname(file).slice(1).replace('svg', 'svg+xml').replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test';
}

function pwVersion() {
  try { return require('@playwright/test/package.json').version; } catch { return 'unknown'; }
}

/** Local-time folder name like 2026-09-20_14-32-08 — sorts chronologically as text. */
function runFolderName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

const RUN_FOLDER_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

/** Rebuilds a run summary from a folder that history.json no longer covers. */
function runSummaryFromDisk(outDir, folder) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(outDir, folder, 'results.json'), 'utf8'));
    const { stats, meta } = data;
    return {
      folder, at: meta.startedAt, total: stats.total, passed: stats.passed,
      failed: stats.failed, flaky: stats.flaky, skipped: stats.skipped, duration: stats.duration,
    };
  } catch {
    return null;
  }
}

/** The newest timestamped run folder inside a report directory, if there is one. */
function latestRunDir(outDir) {
  try {
    const folders = fs.readdirSync(outDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && RUN_FOLDER_RE.test(d.name))
      .map((d) => d.name)
      .sort();
    return folders.length ? path.join(outDir, folders[folders.length - 1]) : null;
  } catch {
    return null;
  }
}

function pathToUrl(file) {
  return `file:///${file.replace(/\\/g, '/').replace(/^\//, '')}`;
}

function openInBrowser(file) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', `"${file}"`]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch { /* ignore */ }
}

module.exports = AuroraReporter;
module.exports.openInBrowser = openInBrowser;
module.exports.latestRunDir = latestRunDir;
module.exports.runFolderName = runFolderName;
