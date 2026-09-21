// @ts-check
const { defineAuroraConfig } = require('./src');

// Every option is optional — delete what you don't need.
module.exports = defineAuroraConfig({
  title: 'Nimbus Store — E2E',
  subtitle: 'Nightly regression',
  // logo: './assets/logo.svg',
  outputDir: 'aurora-report',
  open: 'never', // 'always' | 'never' | 'on-failure'
  singleFile: false, // true = one portable HTML file with all media embedded

  theme: {
    mode: 'auto', // 'auto' | 'light' | 'dark'
    accent: '#7c5cff',
  },

  capture: {
    stepScreenshots: 'on', // screenshot after every report.step(): 'on' | 'on-failure' | 'off'
    failureScreenshot: true,
    failureHtml: true,
    fullPage: false,
    video: 'on', // 'on' | 'off' | 'retain-on-failure' | 'on-first-retry'
    trace: 'retain-on-failure',
    console: true, // browser console errors & warnings
    pageErrors: true, // uncaught exceptions in the page

    // Failed requests are recorded with the request that went out and the
    // response that came back. Set to `false` to turn the whole thing off.
    network: {
      requestBody: true,
      responseBody: true,
      maxBodySize: 4096,
      // Noise nobody wants in a test report — matched by substring, * wildcard,
      // RegExp or a (url) => boolean function.
      exclude: [
        '**/analytics/**',
        'google-analytics.com',
        'googletagmanager.com',
        /facebook\.com\/tr/,
        'hotjar.com',
      ],
    },
  },

  charts: { trend: true, timeline: true, slowest: true, suites: true, failureReasons: true, projects: true },
  history: { enabled: true, keep: 30 },
  slowTestThreshold: 5000,

  environment: {
    App: 'Nimbus Store 2.3.1',
    URL: 'demo-app/index.html',
  },
  links: {
    issue: 'https://github.com/your-org/nimbus/issues?q={id}',
  },
});
