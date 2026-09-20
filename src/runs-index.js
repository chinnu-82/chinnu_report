'use strict';

/**
 * The landing page written at the root of the output folder when
 * `timestampedRuns` is on: one row per run, newest first.
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDur(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  return `${m}m ${Math.round((ms % 60000) / 1000)}s`;
}

function renderRunsIndex({ title, accent = '#7c5cff', runs }) {
  const rows = [...runs].reverse(); // newest first
  const latest = rows[0];
  const totalRuns = rows.length;
  const failing = rows.filter((r) => r.failed > 0).length;

  const body = rows.map((r, i) => {
    const executed = r.total - r.skipped;
    const rate = executed > 0 ? Math.round(((r.passed + r.flaky) / executed) * 100) : 100;
    const status = r.failed ? 'failed' : r.flaky ? 'flaky' : 'passed';
    const icon = { passed: '✓', failed: '✕', flaky: '!' }[status];
    return `<a class="run ${status}" href="${esc(r.folder)}/index.html">
      <span class="badge ${status}">${icon}</span>
      <span class="when">
        <b>${esc(new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }))}</b>
        <span class="folder">${esc(r.folder)}</span>
      </span>
      <span class="counts">
        <span class="c passed">${r.passed} passed</span>
        ${r.failed ? `<span class="c failed">${r.failed} failed</span>` : ''}
        ${r.flaky ? `<span class="c flaky">${r.flaky} flaky</span>` : ''}
        ${r.skipped ? `<span class="c skipped">${r.skipped} skipped</span>` : ''}
      </span>
      <span class="rate">${rate}%</span>
      <span class="dur">${fmtDur(r.duration)}</span>
      ${i === 0 ? '<span class="latest">latest</span>' : '<span class="latest"></span>'}
    </a>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — all runs</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="#7c5cff" stroke-width="10"/></svg>')}">
<style>
:root{color-scheme:light;--accent:${esc(accent)};--bg:#f4f4f1;--surface:#fcfcfb;--surface-2:#f0efec;--ink:#0b0b0b;--ink-2:#52514e;--muted:#7a7872;--border:rgba(11,11,11,.1);
--pass:#0ca30c;--fail:#d03b3b;--flaky:#fab219;--skip:#898781;--pass-ink:#006300;--fail-ink:#b42f2f;--flaky-ink:#845500}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0d0d0d;--surface:#1a1a19;--surface-2:#232321;--ink:#fff;--ink-2:#c3c2b7;--muted:#95938c;--border:rgba(255,255,255,.1);--pass-ink:#3fcf3f;--fail-ink:#f07a7a;--flaky-ink:#fab219}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0 0 24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:26px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.tile .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.tile .l{color:var(--ink-2);font-size:12.5px}
.run{display:grid;grid-template-columns:24px 1fr auto auto auto 54px;gap:14px;align-items:center;padding:12px 16px;background:var(--surface);
border:1px solid var(--border);border-radius:12px;margin-bottom:8px;text-decoration:none;color:inherit;transition:transform .12s,border-color .12s}
.run:hover{transform:translateY(-1px);border-color:color-mix(in oklab,var(--accent) 45%,var(--border))}
.badge{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:12px}
.badge.passed{background:var(--pass)}.badge.failed{background:var(--fail)}.badge.flaky{background:var(--flaky);color:#3b2800}
.when{display:flex;flex-direction:column;min-width:0}
.folder{color:var(--muted);font-size:12px;font-family:ui-monospace,Consolas,monospace}
.counts{display:flex;gap:10px;flex-wrap:wrap;font-size:12.5px}
.c.passed{color:var(--pass-ink)}.c.failed{color:var(--fail-ink);font-weight:600}.c.flaky{color:var(--flaky-ink)}.c.skipped{color:var(--muted)}
.rate,.dur{font-variant-numeric:tabular-nums;color:var(--ink-2);font-size:13px;white-space:nowrap}
.latest{font-size:11px;color:var(--accent);font-weight:700;text-align:right}
.empty{padding:40px;text-align:center;color:var(--muted)}
@media(max-width:760px){.run{grid-template-columns:24px 1fr;row-gap:6px}.rate,.dur,.latest{grid-column:2}}
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="sub">Every test run, newest first. Each run keeps its own screenshots, videos and traces.</p>
  <div class="tiles">
    <div class="tile"><div class="v">${totalRuns}</div><div class="l">runs kept</div></div>
    <div class="tile"><div class="v">${latest ? new Date(latest.at).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}</div><div class="l">latest run</div></div>
    <div class="tile"><div class="v">${failing}</div><div class="l">runs with failures</div></div>
  </div>
  ${rows.length ? body : '<div class="empty">No runs recorded yet.</div>'}
</main>
</body>
</html>`;
}

module.exports = { renderRunsIndex };
