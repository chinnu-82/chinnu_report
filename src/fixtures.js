'use strict';

const base = require('@playwright/test');
const { resolveConfig } = require('./config');
const { stripAnsi } = require('./errors');
const { STORY_ATTACHMENT, DIAGNOSTICS_ATTACHMENT } = require('./fixtures-constants');
const { resolveNetworkOptions, shouldRecord, describeRequest, describeResponse } = require('./network');
const { resolveConsoleOptions, isExcluded, describeArgs } = require('./console-capture');

/** Response bodies being read right now, awaited before the diagnostics are attached. */
const inFlight = new Set();

const STORY_TYPE = 'application/vnd.aurora.story+json';
const DIAG_TYPE = 'application/vnd.aurora.diagnostics+json';
const LIMIT = 200;

let cachedConfig;
const config = () => (cachedConfig ||= resolveConfig());

/** Pages owned by the running test, keyed by testId (one test per worker at a time, but be safe). */
const pages = new Map();

function screenshotWanted(mode, failed) {
  if (mode === true || mode === 'on') return true;
  if (mode === 'on-failure') return failed;
  return false;
}

function firstLine(msg) {
  return stripAnsi(msg || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
}

class Recorder {
  constructor(testInfo) {
    this.testInfo = testInfo;
    this.started = Date.now();
    this.events = [];
    this.stack = [];
    this.shots = 0;
    this.softFailures = [];
  }

  get page() {
    return this._page || pages.get(this.testInfo.testId);
  }

  /** Point screenshots at another page (e.g. a popup). */
  usePage(page) {
    this._page = page;
  }

  _push(event) {
    const parent = this.stack[this.stack.length - 1];
    const e = { id: this.events.length + 1, depth: this.stack.length, parent: parent ? parent.id : null, at: Date.now() - this.started, ...event };
    this.events.push(e);
    return e;
  }

  async _shoot(label, { highlight, fullPage, page } = {}) {
    const target = page || this.page;
    if (!target || target.isClosed()) return null;
    const locators = highlight ? [].concat(highlight) : [];
    try {
      for (const l of locators) {
        await l.evaluateAll((els) => els.forEach((el) => {
          el.setAttribute('data-aurora-prev-style', el.getAttribute('style') || '');
          el.style.outline = '3px solid #ff3d7f';
          el.style.outlineOffset = '3px';
          el.style.boxShadow = '0 0 0 9999px rgba(10, 8, 30, .35)';
        })).catch(() => {});
      }
      const body = await target.screenshot({ fullPage: fullPage ?? config().capture.fullPage, timeout: 5000, animations: 'disabled' });
      const name = `aurora-shot-${++this.shots}`;
      await this.testInfo.attach(name, { body, contentType: 'image/png' });
      return name;
    } catch {
      return null;
    } finally {
      for (const l of locators) {
        await l.evaluateAll((els) => els.forEach((el) => {
          el.setAttribute('style', el.getAttribute('data-aurora-prev-style') || '');
          el.removeAttribute('data-aurora-prev-style');
        })).catch(() => {});
      }
    }
  }

  /**
   * Records a step in the report story. Takes a screenshot when it ends (configurable).
   *
   *   await report.step('Log in', async () => { ... });
   *   await report.step('Dashboard is shown');                    // marker step, just a screenshot
   *   await report.step('Search', fn, { screenshot: false });
   *   await report.step('Cart', fn, { highlight: page.locator('#cart') });
   */
  async step(title, fn, options = {}) {
    if (fn && typeof fn === 'object') [fn, options] = [undefined, fn];
    const rec = this._push({ kind: 'step', title, status: 'passed' });
    this.stack.push(rec);
    let failed = false;
    try {
      return fn ? await base.test.step(title, fn, { box: options.box }) : undefined;
    } catch (e) {
      failed = true;
      rec.status = 'failed';
      rec.error = firstLine(e.message);
      throw e;
    } finally {
      this.stack.pop();
      rec.duration = Date.now() - this.started - rec.at;
      const mode = options.screenshot ?? config().capture.stepScreenshots;
      if (!rec.childShot && screenshotWanted(mode, failed)) {
        rec.screenshot = await this._shoot(title, options);
      }
      if (rec.screenshot || rec.childShot) {
        this.stack.forEach((s) => { s.childShot = true; });
      }
    }
  }

  /**
   * Like step(), but a failure does not stop the test. The test is still marked failed at the end.
   *
   *   await report.check('Price shows discount', async () => {
   *     await expect(page.getByTestId('price')).toHaveText('$90');
   *   });
   */
  async check(title, fn, options = {}) {
    try {
      await this.step(title, fn, { ...options, screenshot: options.screenshot ?? 'on-failure' });
      return true;
    } catch (e) {
      const rec = [...this.events].reverse().find((ev) => ev.kind === 'step' && ev.title === title);
      if (rec) rec.status = 'soft-failed';
      this.softFailures.push({ title, error: e });
      return false;
    }
  }

  /** Take a named screenshot at any point. Pass `highlight` to outline elements. */
  async screenshot(title = 'Screenshot', options = {}) {
    const rec = this._push({ kind: 'screenshot', title, status: 'passed' });
    rec.screenshot = await this._shoot(title, options);
    if (rec.screenshot) this.stack.forEach((s) => { s.childShot = true; });
    return rec.screenshot;
  }

  /** A short message in the story, e.g. which test data was used. */
  note(text, level = 'info') {
    this._push({ kind: 'note', title: String(text), level });
  }

  /** Attach any data (object, string, Buffer) and show it inline in the story. */
  async attach(title, data, contentType) {
    const isBuffer = Buffer.isBuffer(data);
    const type = contentType || (isBuffer ? 'application/octet-stream' : typeof data === 'string' ? 'text/plain' : 'application/json');
    const body = isBuffer ? data : typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const name = `aurora-data-${this.events.length + 1}`;
    await this.testInfo.attach(name, { body, contentType: type });
    this._push({ kind: 'data', title, attachment: name, contentType: type });
  }

  _annotate(type, description) {
    this.testInfo.annotations.push({ type, description: String(description) });
  }

  severity(level) { this._annotate('severity', level); }
  owner(name) { this._annotate('owner', name); }
  feature(name) { this._annotate('feature', name); }
  issue(id) { this._annotate('issue', id); }
  description(text) { this._annotate('description', text); }
  link(url, label = url) { this._annotate('link', `${label}|${url}`); }

  async _finish() {
    await this.testInfo.attach(STORY_ATTACHMENT, {
      body: JSON.stringify({ started: this.started, events: this.events }),
      contentType: STORY_TYPE,
    });
    if (this.softFailures.length && this.testInfo.status === this.testInfo.expectedStatus) {
      const [first] = this.softFailures;
      const titles = this.softFailures.map((f) => `  ✗ ${f.title}`).join('\n');
      const err = new Error(`${this.softFailures.length} check(s) failed:\n${titles}\n\n${stripAnsi(first.error.message)}`);
      err.stack = `${err.message}\n${(first.error.stack || '').split('\n').filter((l) => /^\s+at /.test(l)).join('\n')}`;
      throw err;
    }
  }
}

function watchPage(page, diag, started) {
  const cfg = config().capture;
  const at = () => Date.now() - started;
  const add = (list, item) => { if (list.length < LIMIT) list.push({ at: at(), page: page.url(), ...item }); };

  const con = resolveConsoleOptions(cfg.console);
  const net = resolveNetworkOptions(cfg.network);
  if (con.enabled) {
    page.on('console', (msg) => {
      const type = msg.type();
      if (!con.levels.includes(type)) return;
      const loc = msg.location() || {};
      const source = loc.url ? `${loc.url}:${loc.lineNumber}${loc.columnNumber ? `:${loc.columnNumber}` : ''}` : '';
      const text = msg.text();
      if (isExcluded(text, source, con)) return;
      // The browser logs its own "Failed to load resource" line for every failed request.
      // If that URL is excluded from the network report, leave its echo out too.
      if (net.enabled && loc.url && /^Failed to load resource/.test(text) && !shouldRecord(loc.url, null, net)) return;
      // Reserve the slot now so messages stay in the order they were logged.
      const entry = { at: at(), page: page.url(), type, text, source };
      if (diag.console.length < LIMIT) diag.console.push(entry);
      // Reading the logged values is async — wait for it before the test ends.
      const pending = describeArgs(msg, con)
        .then((args) => { if (args) entry.args = args; })
        .catch(() => {});
      inFlight.add(pending);
      pending.finally(() => inFlight.delete(pending));
    });
  }
  if (cfg.pageErrors) {
    page.on('pageerror', (err) => add(diag.pageErrors, { name: err.name, message: err.message, stack: err.stack }));
  }
  if (net.enabled) {
    if (net.requestFailures) {
      page.on('requestfailed', (req) => {
        const failure = req.failure();
        if (failure && /ERR_ABORTED/.test(failure.errorText)) return;
        if (!shouldRecord(req.url(), req, net)) return;
        add(diag.network, {
          ...describeRequest(req, net),
          status: 0,
          error: failure ? failure.errorText : 'request failed',
        });
      });
    }
    page.on('response', (res) => {
      if (res.status() < net.failedStatus) return;
      const req = res.request();
      if (!shouldRecord(res.url(), req, net)) return;
      // Reading the body is async, so remember the promise and wait for it before the test ends.
      const pending = (async () => {
        const entry = { ...describeRequest(req, net), ...(await describeResponse(res, net)) };
        entry.error = entry.statusText || `HTTP ${entry.status}`;
        add(diag.network, entry);
      })().catch(() => {});
      inFlight.add(pending);
      pending.finally(() => inFlight.delete(pending));
    });
  }
}

/** Response bodies are still being read when the test finishes; give them a moment. */
async function settleNetwork(timeoutMs = 2000) {
  if (!inFlight.size) return;
  await Promise.race([
    Promise.allSettled([...inFlight]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    const started = Date.now();
    const diag = { console: [], pageErrors: [], network: [] };
    watchPage(page, diag, started);
    page.context().on('page', (p) => { if (p !== page) watchPage(p, diag, started); });
    pages.set(testInfo.testId, page);

    await use(page);

    const cfg = config().capture;
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed && !page.isClosed()) {
      if (cfg.failureScreenshot) {
        const body = await page.screenshot({ fullPage: cfg.fullPage, timeout: 5000 }).catch(() => null);
        if (body) await testInfo.attach('aurora-failure', { body, contentType: 'image/png' });
      }
      if (cfg.failureHtml) {
        const html = await page.content().catch(() => null);
        if (html) await testInfo.attach('aurora-failure-html', { body: html, contentType: 'text/html' });
      }
    }
    await settleNetwork();
    if (diag.console.length || diag.pageErrors.length || diag.network.length) {
      await testInfo.attach(DIAGNOSTICS_ATTACHMENT, { body: JSON.stringify(diag), contentType: DIAG_TYPE });
    }
    pages.delete(testInfo.testId);
  },

  report: async ({}, use, testInfo) => {
    const recorder = new Recorder(testInfo);
    await use(recorder);
    await recorder._finish();
  },
});

module.exports = { test, expect: base.expect, STORY_ATTACHMENT, DIAGNOSTICS_ATTACHMENT };
