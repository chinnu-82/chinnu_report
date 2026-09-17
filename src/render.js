'use strict';

const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, 'ui');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** JSON that is safe to drop inside a <script> tag. */
function safeJson(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

function renderReport(data) {
  const css = fs.readFileSync(path.join(UI, 'app.css'), 'utf8');
  const js = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
  const { meta, stats } = data;
  const failing = stats.failed > 0;
  const favicon = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="${failing ? '#d03b3b' : '#0ca30c'}" stroke-width="10"/></svg>`,
  )}`;
  const themeAttr = meta.themeMode === 'light' || meta.themeMode === 'dark' ? ` data-theme="${meta.themeMode}"` : '';

  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<link rel="icon" href="${favicon}">
<style>:root{--accent:${escapeHtml(meta.accent)};}</style>
<style>${css}</style>
</head>
<body>
<div id="app"><div class="boot">Loading report…</div></div>
<script id="aurora-data" type="application/json">${safeJson(data)}</script>
<script>${js}</script>
</body>
</html>`;
}

module.exports = { renderReport };
