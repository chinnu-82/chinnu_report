#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveConfig } = require('../src/config');
const { openInBrowser, latestRunDir } = require('../src/reporter');

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) || 'open';
const dir = args.filter((a) => !a.startsWith('-'))[1];
const wantsIndex = args.includes('--all') || args.includes('--index');

if (cmd !== 'open') {
  console.log(`Usage: aurora-report open [reportDir] [--all]

  open          opens the most recent report
  --all         opens the list of all runs instead (timestamped runs only)`);
  process.exit(1);
}

const outDir = path.resolve(dir || resolveConfig().outputDir);
// With timestampedRuns the newest report lives in a dated sub-folder.
const latest = latestRunDir(outDir);
const target = wantsIndex || !latest ? outDir : latest;
const file = path.join(target, 'index.html');

if (!fs.existsSync(file)) {
  console.error(`No report found at ${file}. Run your Playwright tests first.`);
  process.exit(1);
}

console.log(`Opening ${file}`);
openInBrowser(file);
