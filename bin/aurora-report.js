#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveConfig } = require('../src/config');
const { openInBrowser } = require('../src/reporter');

const [cmd = 'open', dir] = process.argv.slice(2);

if (cmd !== 'open') {
  console.log('Usage: aurora-report open [reportDir]');
  process.exit(1);
}

const outDir = path.resolve(dir || resolveConfig().outputDir);
const file = path.join(outDir, 'index.html');
if (!fs.existsSync(file)) {
  console.error(`No report found at ${file}. Run your Playwright tests first.`);
  process.exit(1);
}
console.log(`Opening ${file}`);
openInBrowser(file);
