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

const USAGE = `Usage:
  aurora-report open [reportDir] [--all]   open the most recent report
                                           --all opens the list of all runs
  aurora-report live [playwright args…]    run your tests with the live report on`;

// `live` runs Playwright with live mode on, whatever the shell — no env-var juggling.
if (cmd === 'live') {
  const { spawn } = require('child_process');
  // require.resolve can't reach cli.js because of the package's exports map, so walk
  // up from the project (and from here, when installed inside node_modules) instead.
  const cli = (() => {
    const candidates = [];
    for (const start of [process.cwd(), __dirname]) {
      let dir = start;
      for (;;) {
        candidates.push(path.join(dir, 'node_modules', '@playwright', 'test', 'cli.js'));
        candidates.push(path.join(dir, 'node_modules', 'playwright', 'cli.js'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    return candidates.find((c) => fs.existsSync(c));
  })();
  if (!cli) {
    console.error('Could not find @playwright/test in this project. Run npm install first.');
    process.exit(1);
  }
  const passthrough = args.slice(args.indexOf('live') + 1);
  const child = spawn(process.execPath, [cli, 'test', ...passthrough], {
    stdio: 'inherit',
    env: { ...process.env, AURORA_LIVE: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  return;
}

if (cmd !== 'open') {
  console.log(USAGE);
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
