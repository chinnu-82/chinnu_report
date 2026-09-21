'use strict';

/**
 * Turns a failed request into something you can debug from the report:
 * the request that went out, and the response that came back.
 *
 * Users decide what is worth recording through `capture.network`, including
 * which URLs to leave out entirely (analytics, pixels, noisy third parties).
 */

const NETWORK_DEFAULTS = {
  enabled: true,
  /** Responses with this status or higher count as failures. */
  failedStatus: 400,
  /** Also record requests that never got a response (DNS, refused, aborted…). */
  requestFailures: true,
  requestHeaders: true,
  requestBody: true,
  responseHeaders: true,
  responseBody: true,
  /** Bodies longer than this are cut off (bytes). */
  maxBodySize: 4096,
  /** Header values replaced with "«hidden»" before they reach the report. */
  redactHeaders: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'x-csrf-token'],
  /** URLs to leave out of the report: substrings, * wildcards, RegExp, or (url, request) => boolean. */
  exclude: [],
  /** When set, only URLs matching these are recorded. */
  include: [],
};

const REDACTED = '«hidden»';

/** `capture.network` accepts true, false, or an options object. */
function resolveNetworkOptions(value) {
  if (value === false || value === null || value === undefined) return { ...NETWORK_DEFAULTS, enabled: false };
  if (value === true) return { ...NETWORK_DEFAULTS };
  return { ...NETWORK_DEFAULTS, ...value, enabled: value.enabled !== false };
}

/**
 * Matches a URL against one pattern.
 * - RegExp        → tested against the URL
 * - function      → called with (url, request)
 * - string with * → glob-style, e.g. "**\/analytics/**" or "https://*.segment.io/*"
 * - plain string  → matched anywhere in the URL, e.g. "google-analytics.com"
 */
function matchesPattern(pattern, url, request) {
  if (!pattern) return false;
  if (pattern instanceof RegExp) return pattern.test(url);
  if (typeof pattern === 'function') {
    try { return !!pattern(url, request); } catch { return false; }
  }
  const text = String(pattern);
  if (!text.includes('*')) return url.includes(text);
  const rx = new RegExp(`^${text
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')}$`);
  return rx.test(url);
}

function shouldRecord(url, request, options) {
  const { include, exclude } = options;
  if (include && include.length && !include.some((p) => matchesPattern(p, url, request))) return false;
  if (exclude && exclude.length && exclude.some((p) => matchesPattern(p, url, request))) return false;
  return true;
}

function redactHeaders(headers, options) {
  if (!headers) return undefined;
  const hidden = (options.redactHeaders || []).map((h) => String(h).toLowerCase());
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = hidden.includes(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

function clipBody(text, options) {
  if (text == null) return undefined;
  const max = options.maxBodySize;
  const body = String(text);
  return body.length > max
    ? { text: body.slice(0, max), truncated: true, size: body.length }
    : { text: body, truncated: false, size: body.length };
}

/** Pretty-print JSON bodies so they are readable in the report. */
function formatBody(body, contentType) {
  if (!body) return body;
  if (/json/i.test(contentType || '')) {
    try { return { ...body, text: JSON.stringify(JSON.parse(body.text), null, 2) }; } catch { /* leave as-is */ }
  }
  return body;
}

function describeRequest(request, options) {
  const entry = {
    method: request.method(),
    url: request.url(),
    resource: request.resourceType(),
  };
  if (options.requestHeaders) {
    try { entry.requestHeaders = redactHeaders(request.headers(), options); } catch { /* ignore */ }
  }
  if (options.requestBody) {
    try {
      const post = request.postData();
      if (post) {
        const headers = request.headers() || {};
        entry.requestBody = formatBody(clipBody(post, options), headers['content-type']);
      }
    } catch { /* ignore */ }
  }
  return entry;
}

async function describeResponse(response, options) {
  const entry = { status: response.status(), statusText: response.statusText() };
  let contentType = '';
  if (options.responseHeaders || options.responseBody) {
    try {
      const headers = await response.allHeaders().catch(() => response.headers());
      contentType = headers['content-type'] || '';
      if (options.responseHeaders) entry.responseHeaders = redactHeaders(headers, options);
    } catch { /* ignore */ }
  }
  if (options.responseBody && !/^(image|video|audio|font)\//.test(contentType)) {
    try {
      entry.responseBody = formatBody(clipBody(await response.text(), options), contentType);
    } catch {
      entry.responseBody = { text: '(the body was not available — the request may have been redirected or aborted)', truncated: false, size: 0 };
    }
  }
  try {
    const timing = response.request().timing();
    if (timing && timing.responseEnd > 0) entry.duration = Math.round(timing.responseEnd);
  } catch { /* ignore */ }
  return entry;
}

module.exports = {
  NETWORK_DEFAULTS,
  resolveNetworkOptions,
  matchesPattern,
  shouldRecord,
  describeRequest,
  describeResponse,
  REDACTED,
};
