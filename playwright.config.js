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
    projects: [
      { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
      { name: 'Mobile Chrome', use: { ...devices['Pixel 7'] } },
    ],
  }),
  // Anything here overrides aurora.config.js
  { environment: { Branch: process.env.BRANCH || 'local' } },
);
