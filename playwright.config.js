// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const { withAurora } = require('./src');

module.exports = withAurora(
  defineConfig({
    testDir: './tests',
    fullyParallel: true,
    retries: 1,
    workers: 4,
    timeout: 20000,
    // The demo shop is served over HTTP so the report can show real network traffic.
    webServer: {
      command: 'node demo-app/server.js',
      url: 'http://localhost:3210',
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
    use: { baseURL: 'http://localhost:3210' },
    projects: [
      { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
      { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    ],
  }),
  // Anything here overrides aurora.config.js
  { environment: { Branch: process.env.BRANCH || 'local' } },
);
