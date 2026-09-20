# ✨ Aurora Report for Playwright

A test report that **tells the story** of every test: each step with a screenshot, videos, and a plain-English explanation of why a test failed. All of it comes in one fast HTML dashboard that works offline.

```
npx playwright test   →   aurora-report/index.html
```

🎓 **New here?** Start with the [Tutorial](docs/TUTORIAL.md) — run the demo and investigate a real failure in 30 minutes, with screenshots and flowcharts. Also available as a [printable PDF](docs/Aurora-Report-Tutorial.pdf).

📘 **Adding it to your own project?** Read the full guide with copy-paste examples: [docs/GUIDE.md](docs/GUIDE.md).

## Why Aurora?

| | Aurora | Allure | Extent |
|---|---|---|---|
| Setup | 1 line in `playwright.config` | CLI + results dir + generate step | Java/.NET-first, adapters |
| Opens without a server | ✅ plain `index.html` | ❌ needs `allure open` / web server | ✅ |
| Single portable file | ✅ `singleFile: true` | ❌ | ❌ |
| **Keep every run in its own timestamped folder** | ✅ `timestampedRuns: true` | history plugin | ❌ |
| **Plain-English failure analysis** ("expected $75 but got $85", fix hints) | ✅ | ❌ | ❌ |
| **Failures grouped by root cause** | ✅ automatic | manual category rules | ❌ |
| **Browser console, page errors, failed requests** captured with zero code | ✅ | ❌ | ❌ |
| Step screenshots with **element highlighting** | ✅ | manual attach | manual attach |
| **Story player**: replay a test as a slideshow | ✅ | ❌ | ❌ |
| Visual-diff slider (expected ⇆ actual) | ✅ | plugin | ❌ |
| Parallel worker timeline | ✅ | ✅ | ❌ |
| Trends, stability per test, "newly failing" detection | ✅ built-in history | ✅ (needs history copy) | partial |
| Soft checks that keep the test going | ✅ `report.check()` | ❌ | ❌ |
| Dark mode, keyboard navigation, mobile layout | ✅ | partial | partial |

## Quick start

**1. Wrap your config** (keeps your existing reporters):

```js
// playwright.config.js
const { defineConfig } = require('@playwright/test');
const { withAurora } = require('aurora-report');

module.exports = withAurora(defineConfig({
  testDir: './tests',
  retries: 1,
}), { title: 'My App — E2E' });
```

**2. Import `test` from Aurora** to record steps (optional, since plain Playwright tests work too):

```js
const { test, expect } = require('aurora-report');

test('customer can check out', async ({ page, report }) => {
  report.severity('critical');
  report.issue('SHOP-142');

  await report.step('Open the store', async () => {
    await page.goto('/');
  });                                           // 📸 screenshot taken automatically

  await report.step('Cart shows 2 items', async () => {
    await expect(page.getByTestId('cart')).toContainText('2');
  }, { highlight: page.getByTestId('cart') });  // 🎯 element outlined in the screenshot

  await report.check('Discount is applied', async () => {   // soft check: test continues
    await expect(page.getByTestId('total')).toHaveText('$90');
  });

  report.note('Used coupon SAVE10');
  await report.attach('Order payload', { id: 991, items: 2 });
  await report.screenshot('Final page', { fullPage: true });
});
```

**3. Run** `npx playwright test` and open `aurora-report/index.html` (or `npx aurora-report open`).

## The `report` fixture

| Method | What it does |
|---|---|
| `report.step(title, fn?, options?)` | Records a step (nesting is supported). Takes a screenshot when the step ends. Leave out `fn` for a marker step that only takes a screenshot. |
| `report.check(title, fn, options?)` | A soft step. If it fails, the test keeps running and is marked failed at the end. |
| `report.screenshot(title?, options?)` | Takes a named screenshot at any point. |
| `report.note(text, level?)` | Adds a message to the story. `level` is `'info'`, `'warn'` or `'success'`. |
| `report.attach(title, data)` | Attaches JSON, text or a Buffer and shows it inline. |
| `report.severity()` `owner()` `feature()` `issue()` `description()` `link(url, label)` | Adds metadata shown as badges. Issues become links through `links.issue`. |
| `report.usePage(page)` | Sends screenshots to another page, such as a popup. |

Step options: `{ screenshot: 'on' | 'off' | 'on-failure', highlight: Locator | Locator[], fullPage, page, box }`.

**Error capturing needs no code.** Every test that uses `page` automatically records:
- a failure screenshot and the page HTML at the moment of failure
- browser console errors and warnings
- uncaught page exceptions
- failed network requests and HTTP responses of 400 or higher
- video and trace, based on your `capture` settings

## Configuration

Put options in `aurora.config.js` in the project root, pass them to `withAurora(config, options)`, or pass them as reporter options. Every option is optional.

```js
// aurora.config.js
const { defineAuroraConfig } = require('aurora-report');

module.exports = defineAuroraConfig({
  title: 'Nimbus Store — E2E',
  subtitle: 'Nightly regression',
  logo: './logo.svg',
  outputDir: 'aurora-report',
  open: 'on-failure',          // 'always' | 'never' | 'on-failure'
  singleFile: false,           // true = one HTML file with every screenshot and video embedded

  theme: { mode: 'auto', accent: '#7c5cff' },

  capture: {
    stepScreenshots: 'on',     // 'on' | 'on-failure' | 'off'
    failureScreenshot: true,
    failureHtml: true,
    fullPage: false,
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    console: true,
    pageErrors: true,
    network: true,
  },

  charts: { trend: true, timeline: true, slowest: true, suites: true, failureReasons: true, projects: true },
  history: { enabled: true, keep: 30 },
  slowTestThreshold: 10000,
  environment: { Build: process.env.BUILD_ID, Branch: process.env.BRANCH },
  links: { issue: 'https://jira.example.com/browse/{id}' },
});
```

Priority, from lowest to highest: defaults → `aurora.config.js` → `withAurora()` options → reporter tuple options.

Without `withAurora`, add the reporter yourself:

```js
reporter: [['list'], ['aurora-report/src/reporter.js', { title: 'My report' }]],
```

## What's in the report

- **Overview**: a summary of the run in plain sentences, a pass-rate ring, KPI tiles with changes since the last run, a "What needs your attention" list, and charts (results over time, results by file, slowest tests, failure causes, results by project).
- **Tests**: a searchable, filterable list (by status, project, tag or slow tests) with stability bars. Each test shows:
  - *Why it failed*: the cause, Expected vs Received with the difference highlighted, the locator, fix hints and the code frame
  - *Test story*: a step timeline with screenshots and a ▶ **Play story** slideshow
  - *Media*: video with speed controls, the visual diff slider, the trace command, page HTML and the ARIA snapshot
  - *Browser diagnostics*, *Stability* across runs, the *Technical steps* tree, and stdout/stderr
  - Tabs for each retry attempt
- **Failures**: failed tests grouped by root cause, plus flaky tests and the reason each one failed the first time.
- **Timeline**: a Gantt chart of workers, the time saved by parallel runs, and worker utilization.

Keyboard: `/` to search · `j`/`k` for the next or previous test · `1`–`4` to switch views · `←`/`→`/`space` in the story player.

## Try the demo

```
npm install
npx playwright install chromium
npx playwright test
npm run report
```

The demo suite (`tests/shop.spec.js` against `demo-app/`) fails on purpose. It includes a wrong total, a missing button, a flaky toast, a skipped test and page errors, so every part of the report has something to show.
