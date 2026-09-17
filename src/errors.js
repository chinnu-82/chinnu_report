'use strict';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`[${ESC}\x9b][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\x07)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))`, 'g');

function stripAnsi(s) {
  return typeof s === 'string' ? s.replace(ANSI, '') : '';
}

/**
 * Each rule turns a cryptic error into something a human can act on.
 * First match wins, so order goes from most to least specific.
 */
const RULES = [
  {
    id: 'visual',
    icon: '🖼️',
    title: 'The page looks different from the approved screenshot',
    test: (m) => /toHaveScreenshot|toMatchSnapshot|pixels? \(ratio|different from|Screenshot comparison failed/i.test(m),
    explain: () => 'A visual comparison found pixels that changed since the baseline image was approved.',
    hints: [
      'Compare Expected, Actual and Diff with the slider in the Media section.',
      'If the change is intentional, update baselines with `npx playwright test --update-snapshots`.',
      'Dynamic content (dates, ads, animations) can be hidden with the `mask` option.',
    ],
  },
  {
    id: 'strict',
    icon: '👯',
    title: 'The locator matched more than one element',
    test: (m) => /strict mode violation/i.test(m),
    explain: (m, f) => `Playwright expected exactly one element${f.locator ? ` for ${f.locator}` : ''} but found ${f.count || 'several'}. It refuses to guess which one you meant.`,
    hints: [
      'Make the locator more specific, e.g. `getByRole(\'button\', { name: \'Save\' })`.',
      'Scope it inside a parent: `page.getByTestId(\'cart\').getByRole(\'button\')`.',
      'If any match is fine, use `.first()` — but prefer a precise locator.',
    ],
  },
  {
    id: 'not-found',
    icon: '🔍',
    title: 'An element never appeared on the page',
    test: (m, f) => !hasValueMismatch(f)
      && /waiting for (locator|getBy)|element\(s\) not found|Expected: visible|to be visible|toBeVisible/i.test(m)
      && /timeout|not found|exceeded/i.test(m),
    explain: (m, f) => `The test waited${f.timeout ? ` ${formatMs(f.timeout)}` : ''} for ${f.locator || 'an element'} but it ${/hidden/i.test(f.received || '') ? 'stayed hidden' : 'never showed up'}.`,
    hints: [
      'Check the failure screenshot: is the page on the screen you expected?',
      'The text, role or test-id may have changed — verify the locator in the Playwright Inspector (`npx playwright test --debug`).',
      'If the element loads slowly, wait for the network or an earlier signal instead of raising timeouts.',
    ],
  },
  {
    id: 'not-actionable',
    icon: '🚫',
    title: 'The element was there but could not be used',
    test: (m) => /intercepts pointer events|element is not (visible|enabled|editable|stable)|element is disabled|not attached to the DOM|outside of the viewport/i.test(m),
    explain: (m, f) => {
      if (/intercepts pointer events/i.test(m)) return `Something else is covering ${f.locator || 'the element'} (a modal, cookie banner, overlay or spinner) so the click would hit the wrong thing.`;
      if (/disabled|not enabled/i.test(m)) return `${f.locator || 'The element'} is disabled, so Playwright could not interact with it.`;
      return `${f.locator || 'The element'} existed but was not ready to be interacted with.`;
    },
    hints: [
      'Look at the failure screenshot for overlays, banners or loading spinners.',
      'Close or wait for the overlay to disappear before interacting.',
      'Make sure the preceding step (e.g. filling a required field) enables the control.',
    ],
  },
  {
    id: 'assertion',
    icon: '⚖️',
    title: 'A check did not match what the test expected',
    test: (m) => /expect\(|Expected[:\s]|Received[:\s]|toHave|toBe|toEqual|toContain/i.test(m),
    explain: (m, f) => {
      if (f.expected !== undefined && f.received !== undefined) {
        return `The test expected ${short(f.expected)} but the app gave ${short(f.received)}.`;
      }
      return 'An assertion compared the actual result with the expected one, and they differed.';
    },
    hints: [
      'Compare Expected and Received — the highlighted part is exactly what differs.',
      'Decide whether the app has a bug or the expectation is outdated.',
      'For values that settle over time, use web-first assertions like `toHaveText` which retry automatically.',
    ],
  },
  {
    id: 'navigation',
    icon: '🌐',
    title: 'The page could not be reached',
    test: (m) => /net::ERR_|ECONNREFUSED|ENOTFOUND|getaddrinfo|NS_ERROR_|Could not connect|page\.goto:/i.test(m),
    explain: (m, f) => `The browser failed to load ${f.url || 'the page'}${f.netCode ? ` (${f.netCode})` : ''}. The server may be down or the URL is wrong.`,
    hints: [
      'Open the URL manually to confirm the app is running.',
      'Check `baseURL` in playwright.config and any `webServer` settings.',
      'On CI, make sure the app starts before tests run.',
    ],
  },
  {
    id: 'timeout',
    icon: '⏱️',
    title: 'The test ran out of time',
    test: (m) => /Timeout \d+ms exceeded|Test timeout of|timed out/i.test(m),
    explain: (m, f) => `Something took longer than the allowed ${f.timeout ? formatMs(f.timeout) : 'time limit'} and Playwright stopped waiting.`,
    hints: [
      'Open the Story to see which step was running when time ran out.',
      'A slow backend or a missing element are the usual causes.',
      'Increase `timeout` only if the operation is legitimately slow.',
    ],
  },
  {
    id: 'closed',
    icon: '💥',
    title: 'The browser or page closed unexpectedly',
    test: (m) => /Target (page, context or browser )?(has been )?closed|browser has disconnected|Browser closed/i.test(m),
    explain: () => 'The page, context or browser was closed while the test was still using it — often a crash or a missing `await`.',
    hints: [
      'Look for a missing `await` before a Playwright call.',
      'Check whether the test (or a hook) closes the page too early.',
      'A browser crash can come from memory pressure on CI.',
    ],
  },
  {
    id: 'code',
    icon: '🐞',
    title: 'The test code itself threw an error',
    test: (m) => /^(TypeError|ReferenceError|SyntaxError|RangeError)\b/m.test(m),
    explain: (m) => `JavaScript error in the test: ${firstLine(m)}`,
    hints: [
      'Open the details to see the exact source line that threw.',
      'Usually a typo, an undefined variable, or data that did not have the expected shape.',
    ],
  },
];

const FALLBACK = {
  id: 'other',
  icon: '❗',
  title: 'The test failed with an unexpected error',
  explain: (m) => firstLine(m) || 'No error message was provided.',
  hints: ['Open the details and expand Technical details for the full error and stack trace.', 'Watch the video or open the trace to see what happened just before.'],
};

/** Expected/Received values were both found, and the element itself did exist. */
function hasValueMismatch(f) {
  return f.expected !== undefined && f.received !== undefined && !/not found/i.test(f.received)
    && !/^(visible|hidden|attached|detached|enabled|disabled|editable|checked|unchecked|focused|in viewport)$/i.test(f.expected);
}

function formatMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  return n >= 1000 ? `${+(n / 1000).toFixed(1)}s` : `${n}ms`;
}

function short(s, max = 80) {
  const str = String(s).trim();
  return str.length > max ? `“${str.slice(0, max)}…”` : `“${str}”`;
}

function firstLine(m) {
  return (m || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

/** Pulls structured facts out of Playwright's error text. */
function extractFacts(msg) {
  const f = {};
  const loc = msg.match(/(?:waiting for|Locator:)\s*((?:locator|getBy\w+|page\.\w+)\(.*?\)(?:\.\w+\(.*?\))*)\s*$/m);
  if (loc) f.locator = loc[1];
  const strict = msg.match(/strict mode violation:\s*(.+?) resolved to/);
  if (strict && !f.locator) f.locator = strict[1];
  const timeout = msg.match(/Timeout:?\s*(\d+)\s*ms/i) || msg.match(/timeout of (\d+)ms/i);
  if (timeout) f.timeout = Number(timeout[1]);
  const exp = msg.match(/^\s*Expected(?: string| pattern| value| substring)?:\s*(.*)$/m);
  const rec = msg.match(/^\s*Received(?: string| value)?:\s*(.*)$/m);
  if (exp) f.expected = unquote(exp[1]);
  if (rec) f.received = unquote(rec[1]);
  const count = msg.match(/resolved to (\d+) elements/);
  if (count) f.count = Number(count[1]);
  const url = msg.match(/navigating to "([^"]+)"/) || msg.match(/at (https?:\/\/\S+)/);
  if (url) f.url = url[1];
  const net = msg.match(/net::(ERR_[A-Z_]+)/);
  if (net) f.netCode = net[1];
  return f;
}

function unquote(s) {
  const t = s.trim();
  return /^".*"$/.test(t) ? t.slice(1, -1) : t;
}

/** Parses Playwright's code frame ("   12 |   await ...", "> 13 | ...", "     |    ^") into rows. */
function parseSnippet(snippet) {
  const text = stripAnsi(snippet || '');
  if (!text) return null;
  const rows = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*(>)?\s*(\d+)?\s*\|(.*)$/);
    if (!m) continue;
    if (!m[2]) {
      if (rows.length) rows[rows.length - 1].caret = m[3].indexOf('^');
      continue;
    }
    rows.push({ line: Number(m[2]), code: m[3].replace(/^ /, ''), focus: !!m[1] });
  }
  return rows.length ? rows : null;
}

/** Clean the message for display: drop the "Call log" noise into its own field. */
function splitCallLog(msg) {
  const idx = msg.search(/\n\s*Call log:/i);
  if (idx === -1) return { message: msg.trim(), callLog: [] };
  const callLog = msg.slice(idx).split('\n').slice(2).map((l) => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  return { message: msg.slice(0, idx).trim(), callLog };
}

function analyzeError(error) {
  if (!error) return null;
  const raw = stripAnsi(error.message || error.value || '');
  const { message, callLog } = splitCallLog(raw);
  const facts = extractFacts(raw);
  const rule = RULES.find((r) => r.test(raw, facts)) || FALLBACK;
  return {
    category: rule.id,
    icon: rule.icon,
    title: rule.title,
    explanation: rule.explain(raw, facts),
    hints: rule.hints,
    facts,
    message,
    callLog,
    stack: stripAnsi(error.stack || ''),
    snippet: parseSnippet(error.snippet),
    location: error.location || null,
    signature: signature(message),
  };
}

/** A normalized fingerprint so identical failures across tests can be grouped together. */
function signature(message) {
  return firstLine(message)
    .replace(/\d+ms/g, 'Nms')
    .replace(/https?:\/\/\S+/g, 'URL')
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\d+/g, 'N')
    .slice(0, 160);
}

const CATEGORY_LABELS = Object.fromEntries([...RULES, FALLBACK].map((r) => [r.id, { icon: r.icon, title: r.title }]));

module.exports = { analyzeError, stripAnsi, CATEGORY_LABELS };
