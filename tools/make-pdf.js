#!/usr/bin/env node
'use strict';

/**
 * Turns a Markdown document into a print-ready PDF.
 *
 *   node tools/make-pdf.js docs/TUTORIAL.md docs/Aurora-Report-Tutorial.pdf
 *
 * Mermaid diagrams are rendered as vectors, screenshots are embedded, the
 * contents list is clickable, and every "Part" starts on a fresh page.
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { chromium } = require('@playwright/test');
const { pathToFileURL } = require('url');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const SRC = path.resolve(positional[0] || 'docs/TUTORIAL.md');
const OUT = path.resolve(positional[1] || 'docs/Aurora-Report-Tutorial.pdf');
const PKG = require('../package.json');

const REPO = 'github.com/chinnu-82/chinnu_report';
const SUBTITLES = {
  'TUTORIAL.md': 'A hands-on tutorial for Playwright test reports',
  'GUIDE.md': 'The complete guide to using it in your project',
};

const COVER = {
  title: 'Aurora Report',
  subtitle: flag('subtitle') || SUBTITLES[path.basename(SRC)] || 'Documentation',
  version: PKG.version,
  repo: REPO,
};

/** GitHub's heading-slug rules, so links inside the document still work. */
const slug = (s) => s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/ /g, '-');

/** Links to sibling documents only work on GitHub, so point them there rather than at a missing file. */
function absoluteDocLinks(markdown) {
  return markdown.replace(/\]\((?!https?:|#)([A-Za-z0-9._-]+\.(?:md|pdf))(#[^)]*)?\)/g,
    (_, file, anchor = '') => `](https://${REPO}/blob/main/docs/${file}${anchor})`);
}

function buildHtml(markdown) {
  const mermaid = [];
  // Pull the diagrams out before Markdown conversion; mermaid renders them in the browser.
  const prepared = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    mermaid.push(code.trim());
    return `<div class="mermaid-slot" data-index="${mermaid.length - 1}"></div>`;
  });

  const renderer = new marked.Renderer();
  const baseHeading = renderer.heading.bind(renderer);
  renderer.heading = function heading(token) {
    const html = baseHeading(token);
    const text = this.parser.parseInline(token.tokens).replace(/<[^>]+>/g, '');
    return html.replace(/^<h(\d)/, `<h$1 id="${slug(text.trim())}"`);
  };

  const body = marked.parse(prepared, { renderer, mangle: false, headerIds: false });

  return { html: body, mermaid };
}

const CSS = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root {
    --ink: #14141a; --ink-2: #44444f; --muted: #6b6b77; --accent: #6d4aff;
    --line: #e3e3ea; --surface: #f7f7fb; --code-bg: #1b1b22;
    --pass: #0ca30c; --fail: #d03b3b; --flaky: #b07a00;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); background: #fff;
    font: 10.5pt/1.55 "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* ---------- cover ---------- */
  .cover { height: 244mm; display: flex; flex-direction: column; justify-content: center; break-after: page; }
  .cover .band { height: 10px; border-radius: 6px; margin-bottom: 34px;
    background: linear-gradient(120deg, var(--accent), #22d3ee 55%, #f472b6); }
  .cover .mark { width: 54px; height: 54px; border-radius: 16px; margin-bottom: 22px;
    background: conic-gradient(from 200deg, var(--accent), #22d3ee, #f472b6, var(--accent)); }
  .cover h1 { font-size: 34pt; margin: 0 0 6px; letter-spacing: -.02em; }
  .cover .sub { font-size: 14pt; color: var(--ink-2); margin: 0 0 30px; }
  .cover .meta { font-size: 10pt; color: var(--muted); line-height: 1.8; }
  .cover .meta b { color: var(--ink-2); font-weight: 600; }
  .cover .rule { height: 3px; width: 90px; background: var(--accent); border-radius: 2px; margin: 26px 0; }
  /* ---------- headings ---------- */
  h1, h2, h3, h4 { line-height: 1.25; break-after: avoid; }
  h1 { font-size: 21pt; margin: 0 0 10px; letter-spacing: -.01em; }
  h2 { font-size: 16pt; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--line); break-before: page; }
  h2:first-of-type { break-before: avoid; }
  h3 { font-size: 12.5pt; margin: 18px 0 8px; color: var(--ink); }
  h4 { font-size: 11pt; margin: 14px 0 6px; }
  p, li { orphans: 2; widows: 2; }
  a { color: #4b32c3; text-decoration: none; }
  strong { font-weight: 650; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
  blockquote {
    margin: 12px 0; padding: 9px 14px; background: var(--surface);
    border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0; color: var(--ink-2);
    break-inside: avoid;
  }
  blockquote p { margin: 0; }
  /* ---------- code ---------- */
  code { font-family: "Cascadia Mono", Consolas, ui-monospace, monospace; font-size: 9pt;
    background: #eef0f6; padding: 1px 4px; border-radius: 4px; }
  pre { background: var(--code-bg); color: #e6e6ef; padding: 11px 13px; border-radius: 9px;
    overflow: hidden; white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 10px 0; }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.6pt; line-height: 1.5; }
  /* ---------- tables ---------- */
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.4pt; break-inside: avoid; }
  th { text-align: left; background: var(--surface); border-bottom: 2px solid var(--line); padding: 6px 8px; }
  td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
  tr:nth-child(even) td { background: #fbfbfd; }
  /* ---------- figures ---------- */
  /* Figures must fit a page, or Chromium clips them at the page edge. */
  img { max-width: 100%; max-height: 195mm; width: auto; height: auto; display: block; margin: 12px auto;
    border: 1px solid var(--line); border-radius: 8px; break-inside: avoid; }
  .mermaid-slot { break-inside: avoid; margin: 14px 0; text-align: center; }
  .mermaid-slot svg { max-width: 100% !important; max-height: 205mm !important; width: auto !important; height: auto; }
  /* ---------- exercises (details are opened for print) ---------- */
  details { background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
    padding: 9px 12px; margin: 10px 0; break-inside: avoid; }
  details summary { font-weight: 600; margin-bottom: 6px; list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  details summary::before { content: "✔ "; color: var(--pass); }
  /* ---------- contents ---------- */
  .toc { break-after: page; }
  .toc h2 { break-before: avoid; }
  .toc ol { list-style: none; padding: 0; counter-reset: toc; }
  .toc li { counter-increment: toc; padding: 7px 0; border-bottom: 1px dotted var(--line); font-size: 11pt; }
  .toc li::before { content: counter(toc) ". "; color: var(--muted); }
  .toc a { color: var(--ink); }
  .toc .sub { display: block; font-size: 9pt; color: var(--muted); padding-left: 18px; }
`;

// Chromium draws the header on every page, including the cover, so the running title is left empty.
const HEADER = '<span></span>';
const FOOTER = `<div style="font-size:7pt;color:#8b8b96;width:100%;padding:0 16mm;display:flex;justify-content:space-between">
  <span>github.com/chinnu-82/chinnu_report</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

function coverAndToc(markdown) {
  const parts = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
    .filter((t) => !/^contents$/i.test(t));
  const items = parts.map((t) => {
    // Headings already numbered ("## 1. Install") must not be numbered twice by the list counter.
    const label = t.replace(/^\d+\.\s*/, '');
    const [head, ...rest] = label.split('—');
    return `<li><a href="#${slug(t)}">${head.trim()}</a>${rest.length ? `<span class="sub">${rest.join('—').trim()}</span>` : ''}</li>`;
  }).join('');
  const today = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<section class="cover">
      <div class="band"></div>
      <div class="mark"></div>
      <h1>${COVER.title}</h1>
      <p class="sub">${COVER.subtitle}</p>
      <div class="rule"></div>
      <div class="meta">
        <div><b>Version</b> ${COVER.version}</div>
        <div><b>Updated</b> ${today}</div>
        <div><b>Source</b> ${COVER.repo}</div>
      </div>
    </section>
    <section class="toc"><h2>Contents</h2><ol>${items}</ol></section>`;
}

(async () => {
  const markdown = fs.readFileSync(SRC, 'utf8');
  // The in-page contents list is replaced by the generated one — it appears
  // as "## Contents" in the tutorial and as "**Contents**" in the guide.
  const withoutToc = markdown
    .replace(/## Contents\n[\s\S]*?\n---\n/, '')
    .replace(/\*\*Contents\*\*\n[\s\S]*?\n---\n/, '');
  const { html, mermaid } = buildHtml(absoluteDocLinks(withoutToc));

  const page = `<!doctype html><html><head><meta charset="utf-8">
    <base href="${pathToFileURL(path.dirname(SRC)).href}/">
    <style>${CSS}</style></head>
    <body>${coverAndToc(withoutToc)}<main>${html}</main>
    <script id="diagrams" type="application/json">${JSON.stringify(mermaid).replace(/</g, '\\u003c')}</script>
    </body></html>`;

  const tmp = path.join(path.dirname(OUT), '.tutorial-print.html');
  fs.writeFileSync(tmp, page, 'utf8');

  const browser = await chromium.launch();
  const tab = await browser.newPage();
  const problems = [];
  tab.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  await tab.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });

  // Render the Mermaid diagrams into the placeholders.
  await tab.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' });
  const rendered = await tab.evaluate(async () => {
    const diagrams = JSON.parse(document.getElementById('diagrams').textContent);
    window.mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { useMaxWidth: true } });
    let ok = 0;
    for (const slot of document.querySelectorAll('.mermaid-slot')) {
      const code = diagrams[Number(slot.dataset.index)];
      try {
        const { svg } = await window.mermaid.render(`d${slot.dataset.index}`, code);
        slot.innerHTML = svg;
        ok++;
      } catch (e) {
        slot.innerHTML = `<pre>${code}</pre>`;
      }
    }
    // Print the answers to the exercises instead of hiding them.
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
    return ok;
  });

  const images = await tab.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
  if (images.length) problems.push(`images that did not load: ${images.join(', ')}`);
  if (rendered !== mermaid.length) problems.push(`diagrams rendered: ${rendered}/${mermaid.length}`);

  // Writing straight to OUT fails if the file is open in a PDF viewer, so build it
  // beside the target first and then move it into place.
  const staging = `${OUT}.new`;
  await tab.pdf({
    path: staging,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: HEADER,
    footerTemplate: FOOTER,
    margin: { top: '18mm', bottom: '20mm', left: '0', right: '0' },
  });
  await browser.close();
  fs.unlinkSync(tmp);

  try {
    fs.renameSync(staging, OUT);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      console.error(`\n  Could not replace ${path.basename(OUT)} — it is open in another program (a PDF viewer?).`);
      console.error(`  Close it and run this again. The new file is waiting at:\n    ${staging}\n`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`PDF written: ${OUT} (${kb} KB, ${mermaid.length} diagrams)`);
  if (problems.length) {
    console.log('Problems:');
    problems.forEach((p) => console.log(`  - ${p}`));
    process.exitCode = 1;
  }
})();
