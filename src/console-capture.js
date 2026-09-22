'use strict';

const { matchesPattern } = require('./network');

/**
 * Browser console capture: records what the page logged, with each argument
 * turned into something readable in the report — objects as JSON, Errors with
 * their stack, DOM nodes as HTML — instead of "[object Object]".
 */

const CONSOLE_DEFAULTS = {
  enabled: true,
  /** Console levels to record. Add 'info', 'log' or 'debug' for more. */
  levels: ['error', 'warning'],
  /** Read the logged values themselves, not just the message text. */
  args: true,
  /** Each value is cut off after this many characters. */
  maxArgSize: 4000,
  /** Messages to leave out: substring, * wildcard, RegExp or (text) => boolean. */
  exclude: [],
};

/** `capture.console` accepts true, false, or an options object. */
function resolveConsoleOptions(value) {
  if (value === false || value === null || value === undefined) return { ...CONSOLE_DEFAULTS, enabled: false };
  if (value === true) return { ...CONSOLE_DEFAULTS };
  return { ...CONSOLE_DEFAULTS, ...value, enabled: value.enabled !== false };
}

function isExcluded(text, source, options) {
  const { exclude } = options;
  if (!exclude || !exclude.length) return false;
  return exclude.some((p) => matchesPattern(p, text) || (source && matchesPattern(p, source)));
}

/**
 * Serialises one console argument inside the page, where the real value lives.
 * Runs in the browser, so it must not reference anything from this file.
 */
function serializeInPage(value, max) {
  const clip = (s) => (s.length > max ? `${s.slice(0, max)}…` : s);
  let kind = typeof value;
  if (value === null) kind = 'null';
  else if (Array.isArray(value)) kind = 'array';
  else if (value instanceof Error) kind = 'error';
  else if (typeof Node !== 'undefined' && value instanceof Node) kind = 'element';

  if (kind === 'error') return { kind, name: value.name, message: value.message, stack: value.stack || '' };
  if (kind === 'element') return { kind, text: clip(value.outerHTML || value.textContent || value.nodeName) };
  if (kind === 'string') return { kind, text: clip(value) };
  if (kind === 'function') return { kind, text: clip(String(value)) };
  if (kind === 'object' || kind === 'array') {
    const seen = new WeakSet();
    let text;
    try {
      text = JSON.stringify(value, (key, v) => {
        if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
        if (typeof Node !== 'undefined' && v instanceof Node) return `<${v.nodeName.toLowerCase()}>`;
        if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
        if (typeof v === 'bigint') return `${v}n`;
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      }, 2);
    } catch (e) {
      text = String(value);
    }
    return { kind, text: clip(text === undefined ? String(value) : text) };
  }
  return { kind, text: String(value) };
}

async function describeArgs(msg, options) {
  if (!options.args) return undefined;
  const handles = msg.args();
  if (!handles.length) return undefined;
  const out = [];
  for (const handle of handles.slice(0, 10)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      out.push(await handle.evaluate(serializeInPage, options.maxArgSize));
    } catch {
      out.push({ kind: 'unknown', text: '(this value was no longer available — the page may have navigated away)' });
    }
  }
  return out;
}

module.exports = { CONSOLE_DEFAULTS, resolveConsoleOptions, isExcluded, describeArgs };
