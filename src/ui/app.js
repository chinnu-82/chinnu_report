(() => {
  'use strict';

  const hayCache = new Map(); // declared before applyData() runs, which clears it

  // In live mode the data is replaced while the run is going, so these are rebound
  // by applyData() instead of being destructured once.
  let meta; let stats; let tests; let clusters; let stability; let runHistory;
  let byId; let projects; let allTags;

  function applyData(data) {
    ({ meta, stats, tests, clusters, stability } = data);
    runHistory = data.history;
    byId = new Map(tests.map((t) => [t.id, t]));
    projects = [...new Set(tests.map((t) => t.project))];
    allTags = [...new Set(tests.flatMap((t) => t.tags))].sort();
    hayCache.clear();
  }

  applyData(JSON.parse(document.getElementById('aurora-data').textContent));
  const app = document.getElementById('app');

  const STATUS = {
    passed: { label: 'Passed', icon: '✓', color: 'var(--pass)' },
    failed: { label: 'Failed', icon: '✕', color: 'var(--fail)' },
    flaky: { label: 'Flaky', icon: '!', color: 'var(--flaky)' },
    skipped: { label: 'Skipped', icon: '–', color: 'var(--skip)' },
  };
  const OUTCOME_COLOR = { p: 'var(--pass)', f: 'var(--fail)', k: 'var(--flaky)' };
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

  const filters = { status: '', project: '', tag: '', slow: false, q: '', sort: 'default' };
  const ui = { attempt: {}, observers: [], tips: [] };

  /* ================================================================ helpers */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
  const pct = (v) => `${Math.round(v * 100)}%`;

  function fmtDur(ms) {
    if (ms == null || Number.isNaN(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`;
  }
  const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const fmtBytes = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  function statusIcon(s) {
    const st = STATUS[s] || STATUS.failed;
    return `<span class="st-icon ${s}" aria-hidden="true">${st.icon}</span>`;
  }
  function pill(s) {
    return `<span class="pill ${s}">${statusIcon(s)}${STATUS[s].label}</span>`;
  }
  function attemptStatus(a) {
    return a.status === 'passed' ? 'passed' : a.status === 'skipped' ? 'skipped' : 'failed';
  }
  function tip(html) {
    ui.tips.push(html);
    return ui.tips.length - 1;
  }
  function tipRow(color, label, value) {
    return `<div class="tt-row"><i class="dot" style="background:${color}"></i>${esc(label)}<b>${esc(value)}</b></div>`;
  }
  function inlineMd(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function truncate(s, n) {
    s = String(s);
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }
  function issueHref(id) {
    return meta.issueLink ? meta.issueLink.replace('{id}', encodeURIComponent(id)) : null;
  }
  function lastAttempt(t) {
    return t.attempts[t.attempts.length - 1] || { errors: [], story: [], steps: [], media: { items: [], visual: [] } };
  }
  function copy(text, btn) {
    const done = () => { const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = old; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
    else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
  }

  /* ================================================================ theme */

  const THEMES = ['auto', 'light', 'dark'];
  function storedTheme() {
    try { return localStorage.getItem('aurora-theme'); } catch { return null; }
  }
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    const btn = document.getElementById('theme-btn');
    if (btn) { btn.textContent = mode === 'dark' ? '☾' : mode === 'light' ? '☀' : '◐'; btn.title = `Theme: ${mode}`; }
  }
  let theme = storedTheme() || meta.themeMode || 'auto';

  /* ================================================================ shell & routing */

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [pathPart, query = ''] = h.split('?');
    const [view = 'overview', id = ''] = pathPart.split('/');
    return { view: view || 'overview', id, params: new URLSearchParams(query) };
  }

  function shell() {
    const failCount = stats.failed + stats.flaky;
    app.innerHTML = `
      <header class="topbar">
        <a class="brand" href="#/overview" aria-label="Overview">
          ${meta.logo ? `<img src="${esc(meta.logo)}" alt="">` : '<span class="brand-mark"></span>'}
          <span style="min-width:0">
            <div class="brand-title">${esc(meta.title)}</div>
            <div class="brand-sub">${esc(meta.subtitle || fmtDate(meta.startedAt))}</div>
          </span>
        </a>
        <nav class="nav">
          <a data-nav="overview" href="#/overview">Overview</a>
          <a data-nav="tests" href="#/tests">Tests <span class="muted num">${stats.total}</span></a>
          <a data-nav="failures" href="#/failures">Failures ${failCount ? `<span class="count num">${failCount}</span>` : ''}</a>
          <a data-nav="timeline" href="#/timeline">Timeline</a>
        </nav>
        <div class="spacer"></div>
        <span id="live-pill" class="live-pill hidden" title="This report is updating while the tests run"></span>
        <label class="search"><span aria-hidden="true">⌕</span>
          <input id="q" type="search" placeholder="Search tests, tags, errors…" autocomplete="off" aria-label="Search tests">
          <kbd>/</kbd>
        </label>
        ${meta.ciLink ? `<a class="icon-btn" href="${esc(meta.ciLink)}" target="_blank" rel="noopener" title="Open CI run">↗</a>` : ''}
        <button class="icon-btn" id="theme-btn" type="button" aria-label="Toggle theme"></button>
      </header>
      <main id="view"></main>
      <div class="tooltip" id="tooltip" role="tooltip"></div>`;
    applyTheme(theme);
  }

  function render() {
    ui.observers.forEach((o) => o.disconnect());
    ui.observers = [];
    ui.tips = [];
    const r = route();
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.view));
    const view = document.getElementById('view');
    if (r.view === 'tests') renderTests(view, r);
    else if (r.view === 'failures') renderFailures(view, r);
    else if (r.view === 'timeline') renderTimeline(view);
    else renderOverview(view);
  }

  /* ================================================================ charts */

  function mount(el, draw) {
    if (!el) return;
    let lastW = -1;
    const run = () => {
      const w = Math.floor(el.clientWidth);
      if (w <= 0 || w === lastW) return;
      lastW = w;
      el.innerHTML = draw(w);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    ui.observers.push(ro);
  }

  function countScale(max, ticks = 4) {
    const step = Math.max(1, Math.ceil(niceNum(Math.max(max, 1) / ticks)));
    return { max: step * ticks, step };
  }
  function niceNum(v) {
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  /** Rect path with independent corner radii [tl, tr, br, bl]. */
  function rrect(x, y, w, h, [tl, tr, br, bl]) {
    const m = Math.min(w, h) / 2;
    [tl, tr, br, bl] = [tl, tr, br, bl].map((r) => Math.max(0, Math.min(r, m)));
    return `M${x + tl},${y}H${x + w - tr}Q${x + w},${y} ${x + w},${y + tr}V${y + h - br}Q${x + w},${y + h} ${x + w - br},${y + h}H${x + bl}Q${x},${y + h} ${x},${y + h - bl}V${y + tl}Q${x},${y} ${x + tl},${y}Z`;
  }

  function legend(items) {
    return `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;
  }

  const STATUS_SERIES = ['passed', 'flaky', 'failed', 'skipped'].map((k) => ({ key: k, label: STATUS[k].label, color: STATUS[k].color }));

  function donut(size = 176) {
    const segs = STATUS_SERIES.map((s) => ({ ...s, v: stats[s.key] })).filter((s) => s.v > 0);
    const total = segs.reduce((a, s) => a + s.v, 0) || 1;
    const cx = size / 2, R = size / 2 - 4, r = R - 18;
    const gap = segs.length > 1 ? 0.025 : 0;
    let a0 = -Math.PI / 2;
    const arc = (s, e) => {
      const large = e - s > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cx + rad * Math.sin(ang)}`;
      return `M${p(R, s)}A${R},${R} 0 ${large} 1 ${p(R, e)}L${p(r, e)}A${r},${r} 0 ${large} 0 ${p(r, s)}Z`;
    };
    const paths = segs.map((s) => {
      const sweep = (s.v / total) * Math.PI * 2;
      const start = a0 + gap, end = a0 + sweep - gap;
      a0 += sweep;
      const d = segs.length === 1 ? `${arc(-Math.PI / 2, Math.PI * 1.5 - 0.0001)}` : arc(start, Math.max(start + 0.001, end));
      const t = tip(`<div class="tt-title">${STATUS[s.key].icon} ${s.label}</div>${tipRow(s.color, 'Tests', s.v)}${tipRow(s.color, 'Share', pct(s.v / total))}`);
      return `<path class="mark" data-grp="${s.key}" data-tip="${t}" data-href="#/tests?status=${s.key}" d="${d}" fill="${s.color}" style="cursor:pointer"/>`;
    }).join('');
    const executed = stats.total - stats.skipped;
    return `<svg class="chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Pass rate ${pct(stats.passRate)}">
      ${paths}
      <text x="${cx}" y="${cx + 4}" text-anchor="middle" style="font-size:34px;font-weight:700;fill:var(--ink)">${executed ? pct(stats.passRate) : '—'}</text>
      <text x="${cx}" y="${cx + 24}" text-anchor="middle" style="font-size:12px;fill:var(--muted)">pass rate</text>
    </svg>`;
  }

  function hbarStack(w, rows, series, { valueFmt = (v) => v, rowH = 30 } = {}) {
    if (!rows.length) return '<div class="empty">Nothing to show yet.</div>';
    const lw = Math.min(210, Math.max(90, w * 0.34));
    const vw = 56;
    const bw = Math.max(40, w - lw - vw);
    const max = Math.max(...rows.map((r) => series.reduce((a, s) => a + (r.values[s.key] || 0), 0)), 1);
    const H = rows.length * rowH;
    const body = rows.map((row, i) => {
      const y = i * rowH;
      const bh = 12, by = y + (rowH - bh) / 2;
      const present = series.filter((s) => row.values[s.key] > 0);
      let x = lw;
      const segs = present.map((s, j) => {
        const full = (row.values[s.key] / max) * bw;
        const last = j === present.length - 1;
        const segW = Math.max(1, full - (last ? 0 : 2));
        const d = rrect(x, by, segW, bh, last ? [0, 4, 4, 0] : [0, 0, 0, 0]);
        x += full;
        return `<path d="${d}" fill="${s.color}"/>`;
      }).join('');
      const total = series.reduce((a, s) => a + (row.values[s.key] || 0), 0);
      const t = tip(`<div class="tt-title">${esc(row.label)}</div>${present.map((s) => tipRow(s.color, s.label, valueFmt(row.values[s.key]))).join('')}`);
      return `<g class="mark" data-grp="r${i}">
        <text class="lbl" x="${lw - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(truncate(row.label, Math.floor((lw - 10) / 6.6)))}</text>
        ${segs}
        <text class="val" x="${x + 8}" y="${y + rowH / 2 + 4}">${esc(valueFmt(total))}</text>
      </g>
      <rect class="hit" data-grp="r${i}" data-tip="${t}" ${row.href ? `data-href="${esc(row.href)}"` : ''} x="0" y="${y}" width="${w}" height="${rowH}"/>`;
    }).join('');
    return `<svg class="chart" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">
      <line class="baseline" x1="${lw}" x2="${lw}" y1="0" y2="${H}"/>${body}</svg>`;
  }

  function trendChart(w) {
    const runs = runHistory;
    if (!runs.length) return '<div class="empty">No history yet.</div>';
    const H = 220, padL = 34, padR = 6, padT = 8, padB = 26;
    const pw = w - padL - padR, ph = H - padT - padB;
    const series = STATUS_SERIES.filter((s) => s.key !== 'skipped');
    const { max, step } = countScale(Math.max(...runs.map((r) => r.passed + r.flaky + r.failed)));
    const slots = Math.max(runs.length, 12);
    const slot = pw / slots;
    const bw = Math.max(4, Math.min(26, slot * 0.64));
    const y = (v) => padT + ph - (v / max) * ph;
    let grid = '';
    for (let v = 0; v <= max; v += step) {
      grid += `<line class="${v === 0 ? 'baseline' : 'gridline'}" x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" class="num">${v}</text>`;
    }
    const labelEvery = Math.max(1, Math.ceil(44 / slot));
    const cols = runs.map((run, i) => {
      const cx = padL + slot * i + slot / 2;
      const present = series.filter((s) => run[s.key] > 0);
      let acc = 0;
      const segs = present.map((s, j) => {
        const top = j === present.length - 1;
        const y0 = y(acc), y1 = y(acc + run[s.key]);
        acc += run[s.key];
        const h = Math.max(1, y0 - y1 - (top ? 0 : 2));
        return `<path d="${rrect(cx - bw / 2, y1 + (top ? 0 : 2), bw, h, top ? [4, 4, 0, 0] : [0, 0, 0, 0])}" fill="${s.color}"/>`;
      }).join('');
      const latest = i === runs.length - 1;
      const label = latest ? 'Latest' : `#${i + 1}`;
      const t = tip(`<div class="tt-title">${latest ? 'This run' : `Run #${i + 1}`} · ${esc(fmtDate(run.at))}</div>
        ${series.map((s) => tipRow(s.color, s.label, run[s.key])).join('')}
        ${tipRow('var(--skip)', 'Skipped', run.skipped)}
        <div class="tt-row muted">Duration<b>${fmtDur(run.duration)}</b></div>`);
      const showLabel = latest || (i % labelEvery === 0 && runs.length - 1 - i >= labelEvery);
      return `<g class="mark" data-grp="c${i}">${segs}</g>
        ${showLabel ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" ${latest ? 'style="fill:var(--ink-2);font-weight:600"' : ''}>${label}</text>` : ''}
        <rect class="hit" data-grp="c${i}" data-tip="${t}" x="${cx - slot / 2}" y="${padT}" width="${slot}" height="${ph}"/>`;
    }).join('');
    return `<svg class="chart" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${grid}${cols}</svg>`;
  }

  function slowestChart(w) {
    const rows = tests.filter((t) => t.outcome !== 'skipped').sort((a, b) => b.lastDuration - a.lastDuration).slice(0, 8);
    if (!rows.length) return '<div class="empty">No executed tests.</div>';
    const svg = hbarStack(w, rows.map((t) => ({
      label: t.title, values: { d: t.lastDuration }, href: `#/tests/${t.id}`,
    })), [{ key: 'd', label: 'Duration', color: 'var(--s1)' }], { valueFmt: fmtDur });
    return svg;
  }

  function spark(values, { w = 120, h = 28, color = 'var(--s1)' } = {}) {
    if (values.length < 2) return '';
    const max = Math.max(...values, 1);
    const bw = w / values.length;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${values.map((v, i) => {
      const bh = Math.max(2, (v / max) * h);
      return `<path d="${rrect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh, [2, 2, 0, 0])}" fill="${color}" opacity="${i === values.length - 1 ? 1 : 0.45}"/>`;
    }).join('')}</svg>`;
  }

  function stabilityBars(t, n = 12) {
    const h = (stability[t.id] || []).slice(-n);
    if (h.length < 2) return '';
    const passes = h.filter((x) => x.o === 'p').length;
    return `<span class="stab" title="Last ${h.length} runs: ${passes} passed">${h.map((x) => `<i style="background:${OUTCOME_COLOR[x.o] || 'var(--skip)'}"></i>`).join('')}</span>`;
  }

  /* ================================================================ overview */

  function narrative() {
    const prev = runHistory.length > 1 ? runHistory[runHistory.length - 2] : null;
    const newlyBroken = tests.filter((t) => { const h = stability[t.id] || []; return t.outcome === 'failed' && h.length > 1 && h[h.length - 2].o !== 'f'; });
    const fixed = tests.filter((t) => { const h = stability[t.id] || []; return t.outcome === 'passed' && h.length > 1 && h[h.length - 2].o === 'f'; });
    const executed = stats.total - stats.skipped;

    let verdict, headline;
    const running = meta.live && meta.live.running;
    if (running) {
      const planned = meta.live.planned || stats.total;
      verdict = stats.failed ? 'failed' : 'flaky';
      headline = stats.total
        ? `Running… ${stats.total} of ${planned} tests done${stats.failed ? `, ${stats.failed} failed so far` : ''}`
        : 'Running… waiting for the first test to finish';
      const parts = [`This page updates as each test finishes.`];
      if (stats.failed) parts.push(`<b>${plural(stats.failed, 'test')}</b> ${stats.failed === 1 ? 'has' : 'have'} failed so far — open it below without waiting for the run to end.`);
      else if (stats.total) parts.push('Nothing has failed yet.');
      return {
        verdict, headline, text: parts.join(' '), prev: null, newlyBroken: [], fixed: [],
        chip: stats.failed ? `Running · ${plural(stats.failed, 'failure')} so far` : 'Running',
      };
    }
    if (stats.total === 0) { verdict = 'skipped'; headline = 'No tests were run'; }
    else if (stats.failed) { verdict = 'failed'; headline = `${stats.failed} of ${plural(executed, 'test')} failed`; }
    else if (stats.flaky) { verdict = 'flaky'; headline = `All tests passed — ${stats.flaky} ${stats.flaky === 1 ? 'was' : 'were'} flaky`; }
    else { verdict = 'passed'; headline = `All ${plural(executed, 'test')} passed`; }

    const parts = [`This run executed <b>${plural(executed, 'test')}</b>${projects.length > 1 ? ` across <b>${projects.length} projects</b>` : ''} in <b>${fmtDur(stats.duration)}</b>.`];
    if (clusters.length && stats.failed) {
      const c = clusters[0];
      parts.push(clusters.length === 1
        ? `Every failure has the same cause: <b>${c.icon} ${esc(c.title.toLowerCase())}</b>.`
        : `The most common problem is <b>${c.icon} ${esc(c.title.toLowerCase())}</b> (${plural(c.tests.length, 'test')}).`);
    }
    if (newlyBroken.length) parts.push(`<b>${plural(newlyBroken.length, 'test')}</b> started failing since the previous run.`);
    if (fixed.length) parts.push(`<b>${plural(fixed.length, 'test')}</b> ${fixed.length === 1 ? 'was' : 'were'} fixed.`);
    if (stats.flaky) parts.push(`<b>${plural(stats.flaky, 'test')}</b> only passed after a retry — ${stats.flaky === 1 ? 'it is' : 'they are'} unreliable.`);
    if (!stats.failed && !stats.flaky && executed) parts.push('Nothing needs your attention. 🎉');
    if (stats.skipped) parts.push(`${plural(stats.skipped, 'test')} ${stats.skipped === 1 ? 'was' : 'were'} skipped.`);
    return { verdict, headline, text: parts.join(' '), prev, newlyBroken, fixed };
  }

  function delta(cur, prev, { lowerIsBetter = false, fmt = (v) => v, unit = '' } = {}) {
    if (prev == null) return '<div class="delta">first run</div>';
    const d = cur - prev;
    if (Math.abs(d) < (unit === 'ms' ? 500 : 1)) return '<div class="delta">same as last run</div>';
    const good = lowerIsBetter ? d < 0 : d > 0;
    return `<div class="delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs last run</div>`;
  }

  function renderOverview(view) {
    const n = narrative();
    const p = n.prev;
    const kpi = (label, value, extra, href, icon = '') => `<button type="button" class="card kpi" data-href="${href}">
      <div class="label">${icon}${label}</div><div class="value num">${value}</div>${extra}</button>`;

    const attention = [];
    clusters.forEach((c, i) => attention.push(`<div class="attn-row" data-href="#/failures/${i}">
      <span class="emoji" aria-hidden="true">${c.icon}</span>
      <div><div class="t">${esc(c.title)}</div><div class="d">${esc(truncate(c.explanation, 180))}</div></div>
      <span class="n">${plural(c.tests.length, 'test')}</span></div>`));
    n.newlyBroken.slice(0, 3).forEach((t) => attention.push(`<div class="attn-row" data-href="#/tests/${t.id}">
      <span class="emoji" aria-hidden="true">🆕</span>
      <div><div class="t">Newly failing: ${esc(t.title)}</div><div class="d">Passed in the previous run — something changed.</div></div></div>`));

    const envRows = Object.entries(meta.environment).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    const c = meta.charts;
    const suiteRows = groupBy(tests, (t) => t.file).map(([file, list]) => ({
      label: file.split('/').pop(), href: `#/tests?q=${encodeURIComponent(file)}`,
      values: countOutcomes(list),
    }));
    const projectRows = groupBy(tests, (t) => t.project).map(([proj, list]) => ({ label: proj, values: countOutcomes(list), href: '#/tests' }));
    const reasonRows = Object.entries(clusters.reduce((acc, cl) => { acc[cl.category] = (acc[cl.category] || 0) + cl.tests.length; return acc; }, {}))
      .sort((a, b) => b[1] - a[1])
      .map(([cat, v]) => ({ label: `${meta.categories[cat]?.icon || ''} ${meta.categories[cat]?.title || cat}`, values: { v }, href: '#/failures' }));

    view.innerHTML = `
      <section class="card hero">
        <div>
          <span class="verdict pill ${n.verdict}">${statusIcon(n.verdict)}${n.chip || { failed: 'Needs attention', flaky: 'Passed with warnings', passed: 'All clear', skipped: 'Nothing ran' }[n.verdict]}</span>
          <h1>${esc(n.headline)}</h1>
          <p class="story-text">${n.text}</p>
          <div class="run-meta">
            <span>🗓 ${esc(fmtDate(meta.startedAt))}</span>
            <span>⏱ ${fmtDur(stats.duration)}</span>
            <span>⚙ ${esc(meta.environment.Workers)} workers</span>
            ${stats.retries ? `<span>↻ ${plural(stats.retries, 'retry', 'retries')}</span>` : ''}
            <span>🎭 Playwright ${esc(meta.environment.Playwright)}</span>
          </div>
        </div>
        <div class="ring-wrap">${donut()}</div>
      </section>

      <div class="kpis">
        ${kpi('Total', stats.total, delta(stats.total, p && p.total), '#/tests?status=')}
        ${kpi('Passed', stats.passed, delta(stats.passed, p && p.passed), '#/tests?status=passed', statusIcon('passed'))}
        ${kpi('Failed', stats.failed, delta(stats.failed, p && p.failed, { lowerIsBetter: true }), '#/tests?status=failed', statusIcon('failed'))}
        ${kpi('Flaky', stats.flaky, delta(stats.flaky, p && p.flaky, { lowerIsBetter: true }), '#/tests?status=flaky', statusIcon('flaky'))}
        ${kpi('Skipped', stats.skipped, delta(stats.skipped, p && p.skipped, { lowerIsBetter: true }), '#/tests?status=skipped', statusIcon('skipped'))}
        ${kpi('Duration', fmtDur(stats.duration), `${delta(stats.duration, p && p.duration, { lowerIsBetter: true, fmt: fmtDur, unit: 'ms' })}${spark(runHistory.slice(-14).map((r) => r.duration), { w: 110, h: 18 })}`, '#/timeline')}
      </div>

      <h2 class="section">What needs your attention</h2>
      ${attention.length ? `<div class="card card-b attention">${attention.join('')}</div>`
        : `<div class="all-good"><span style="font-size:22px">✓</span> Every test passed on its first attempt. Nothing to investigate.</div>`}

      <h2 class="section">Insights</h2>
      <div class="grid-2">
        ${c.trend ? `<section class="card span-2"><div class="card-h"><h3>Results over time</h3><span class="sub">last ${plural(runHistory.length, 'run')}${runHistory.length < 3 ? ' · trends grow with every run' : ''}</span></div>
          <div class="card-b">${legend(STATUS_SERIES.filter((s) => s.key !== 'skipped'))}<div id="ch-trend"></div></div></section>` : ''}
        ${c.suites ? `<section class="card"><div class="card-h"><h3>Results by file</h3><span class="sub">click a bar to filter</span></div>
          <div class="card-b">${legend(STATUS_SERIES)}<div id="ch-suites"></div></div></section>` : ''}
        ${c.slowest ? `<section class="card"><div class="card-h"><h3>Slowest tests</h3><span class="sub">last attempt</span></div>
          <div class="card-b"><div id="ch-slow"></div></div></section>` : ''}
        ${c.failureReasons && reasonRows.length ? `<section class="card"><div class="card-h"><h3>Why tests failed</h3><span class="sub">grouped by cause</span></div>
          <div class="card-b"><div id="ch-reasons"></div></div></section>` : ''}
        ${c.projects && projects.length > 1 ? `<section class="card"><div class="card-h"><h3>Results by project</h3><span class="sub">browsers & devices</span></div>
          <div class="card-b">${legend(STATUS_SERIES)}<div id="ch-projects"></div></div></section>` : ''}
        <section class="card"><div class="card-h"><h3>Environment</h3></div>
          <div class="card-b"><table class="tbl env-table">${envRows}</table></div></section>
      </div>`;

    mount(document.getElementById('ch-trend'), trendChart);
    mount(document.getElementById('ch-suites'), (w) => hbarStack(w, suiteRows, STATUS_SERIES));
    mount(document.getElementById('ch-slow'), slowestChart);
    mount(document.getElementById('ch-reasons'), (w) => hbarStack(w, reasonRows, [{ key: 'v', label: 'Tests', color: 'var(--fail)' }]));
    mount(document.getElementById('ch-projects'), (w) => hbarStack(w, projectRows, STATUS_SERIES));
  }

  function groupBy(list, fn) {
    const m = new Map();
    list.forEach((x) => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return [...m.entries()];
  }
  function countOutcomes(list) {
    return list.reduce((acc, t) => { acc[t.outcome] = (acc[t.outcome] || 0) + 1; return acc; }, {});
  }

  /* ================================================================ tests view */

  function visibleTests() {
    const q = filters.q.trim().toLowerCase();
    let list = tests.filter((t) => (!filters.status || t.outcome === filters.status)
      && (!filters.project || t.project === filters.project)
      && (!filters.tag || t.tags.includes(filters.tag))
      && (!filters.slow || t.slow)
      && (!q || haystack(t).includes(q)));
    const rank = { failed: 0, flaky: 1, passed: 2, skipped: 3 };
    if (filters.sort === 'slowest') list = [...list].sort((a, b) => b.lastDuration - a.lastDuration);
    if (filters.sort === 'name') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (filters.sort === 'status') list = [...list].sort((a, b) => rank[a.outcome] - rank[b.outcome]);
    return list;
  }
  function haystack(t) {
    if (!hayCache.has(t.id)) {
      hayCache.set(t.id, [t.title, t.file, t.project, ...t.describe, ...t.tags, t.owner, t.feature, ...t.issues,
        ...t.attempts.flatMap((a) => a.errors.map((e) => `${e.title} ${e.message}`))].join(' ').toLowerCase());
    }
    return hayCache.get(t.id);
  }

  function renderTests(view, r) {
    ['status', 'project', 'tag', 'q'].forEach((k) => { if (r.params.has(k)) filters[k] = r.params.get(k); });
    if (r.params.has('q')) document.getElementById('q').value = filters.q;
    const list = visibleTests();
    let id = r.id;
    if (!id || !byId.has(id)) {
      const pick = list.find((t) => t.outcome === 'failed') || list[0];
      if (pick) { window.history.replaceState(null, '', `#/tests/${pick.id}`); id = pick.id; }
    }
    view.innerHTML = `<div class="tests-layout">
      <aside class="card sidebar"><div class="filters" id="filters"></div><div class="test-list" id="test-list" role="listbox" aria-label="Tests"></div></aside>
      <section class="detail" id="detail"></section></div>`;
    renderFilters();
    renderList(id);
    renderDetail(id);
    // Shared link to an error: #/tests/<id>?error=<attempt>.<error>
    const er = r.params.get('error');
    if (er && id) {
      const [eai, eei] = er.split('.').map(Number);
      openErrorDrawer(errRef(id, eai || 0, eei || 0));
    }
  }

  function renderFilters() {
    const counts = countOutcomes(tests);
    const chip = (key, label, on, count) => `<button type="button" class="chip ${on ? 'on' : ''}" data-filter-status="${key}">${key ? statusIcon(key) : ''}${label}${count != null ? ` <span class="c">${count}</span>` : ''}</button>`;
    document.getElementById('filters').innerHTML = `
      <div class="chips">
        ${chip('', 'All', !filters.status, tests.length)}
        ${['failed', 'flaky', 'passed', 'skipped'].filter((s) => counts[s]).map((s) => chip(s, STATUS[s].label, filters.status === s, counts[s])).join('')}
      </div>
      <div class="chips">
        ${projects.length > 1 ? `<select class="select" data-filter="project" aria-label="Project"><option value="">All projects</option>${projects.map((p) => `<option ${filters.project === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
        ${allTags.length ? `<select class="select" data-filter="tag" aria-label="Tag"><option value="">All tags</option>${allTags.map((t) => `<option ${filters.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
        <select class="select" data-filter="sort" aria-label="Sort">
          ${[['default', 'File order'], ['status', 'Failures first'], ['slowest', 'Slowest first'], ['name', 'Name']].map(([v, l]) => `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button type="button" class="chip ${filters.slow ? 'on' : ''}" data-filter-slow>🐢 Slow</button>
      </div>`;
  }

  function renderList(selectedId) {
    const el = document.getElementById('test-list');
    if (!el) return;
    const list = visibleTests();
    if (!list.length) { el.innerHTML = '<div class="empty">No tests match these filters.</div>'; return; }
    const groups = filters.sort === 'default' ? groupBy(list, (t) => t.file) : [['', list]];
    el.innerHTML = groups.map(([file, items]) => {
      const cnt = countOutcomes(items);
      const bar = STATUS_SERIES.filter((s) => cnt[s.key]).map((s) => `<i style="flex:${cnt[s.key]};background:${s.color}"></i>`).join('');
      return `${file ? `<div class="group-h"><span title="${esc(file)}">📄 ${esc(file)}</span><span class="bar" aria-hidden="true">${bar}</span></div>` : ''}
        ${items.map((t) => {
          const a = lastAttempt(t);
          const sub = [projects.length > 1 ? t.project : null, t.describe.join(' › ') || null].filter(Boolean).join(' · ');
          return `<div class="test-row ${t.id === selectedId ? 'sel' : ''}" role="option" aria-selected="${t.id === selectedId}" data-href="#/tests/${t.id}" data-id="${t.id}">
            ${statusIcon(t.outcome)}
            <div style="min-width:0">
              <div class="tt" title="${esc(t.title)}">${esc(t.title)}</div>
              <div class="ts">${sub ? `<span>${esc(sub)}</span>` : ''}
                ${t.attempts.length > 1 ? `<span class="badge">↻ ${t.attempts.length - 1}</span>` : ''}
                ${t.slow ? '<span class="badge">🐢</span>' : ''}
                ${a.errors.length && t.outcome === 'failed' ? `<span>${a.errors[0].icon} ${esc(truncate(a.errors[0].title, 40))}</span>` : ''}
              </div>
            </div>
            <div style="text-align:right"><div class="dur">${t.outcome === 'skipped' ? '' : fmtDur(t.lastDuration)}</div>${stabilityBars(t, 8)}</div>
          </div>`;
        }).join('')}`;
    }).join('');
    const sel = el.querySelector('.test-row.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function renderDetail(id) {
    const el = document.getElementById('detail');
    const t = byId.get(id);
    if (!t) { el.innerHTML = '<div class="card empty">Select a test to see its story.</div>'; return; }
    const ai = Math.min(ui.attempt[id] ?? t.attempts.length - 1, t.attempts.length - 1);
    const a = t.attempts[ai] || lastAttempt(t);
    const aStatus = t.outcome === 'skipped' ? 'skipped' : attemptStatus(a);
    const diag = a.diagnostics || { console: [], pageErrors: [], network: [] };
    const diagCount = (diag.console || []).filter((c) => c.type === 'error').length + (diag.pageErrors || []).length + (diag.network || []).length;

    ui.ctx = { tid: t.id, ai, a };
    const issueBadges = t.issues.map((i) => { const href = issueHref(i); return href ? `<a class="badge" href="${esc(href)}" target="_blank" rel="noopener">🔗 ${esc(i)}</a>` : `<span class="badge">🔗 ${esc(i)}</span>`; }).join('');

    el.innerHTML = `
      <section class="card detail-head">
        <div class="crumbs">
          ${projects.length > 1 ? `<span class="badge">${esc(t.project)}</span>` : ''}
          <span class="mono">${esc(t.file)}:${t.line}</span>
          ${t.describe.map((d) => `<span class="sep">›</span><span>${esc(d)}</span>`).join('')}
        </div>
        <h2>${esc(t.title)}</h2>
        <div class="meta-row">
          ${pill(t.outcome)}
          <span class="badge num">⏱ ${fmtDur(a.duration)}</span>
          ${t.slow ? `<span class="badge">🐢 slower than ${fmtDur(meta.slowTestThreshold)}</span>` : ''}
          ${t.severity ? `<span class="badge sev-${esc(t.severity.toLowerCase())}">⚑ ${esc(t.severity)}</span>` : ''}
          ${t.feature ? `<span class="badge">◆ ${esc(t.feature)}</span>` : ''}
          ${t.owner ? `<span class="badge">👤 ${esc(t.owner)}</span>` : ''}
          ${t.tags.map((g) => `<span class="badge tag">${esc(g)}</span>`).join('')}
          ${issueBadges}
          ${t.links.map((l) => `<a class="badge" href="${esc(l.url)}" target="_blank" rel="noopener">↗ ${esc(l.label)}</a>`).join('')}
          ${t.annotations.map((an) => `<span class="badge" title="${esc(an.description || '')}">${esc(an.type)}${an.description ? `: ${esc(truncate(an.description, 60))}` : ''}</span>`).join('')}
          ${diagCount ? `<a class="badge" href="#diag" data-scroll="diag" style="color:var(--fail-ink)">⚠ ${plural(diagCount, 'browser error')}</a>` : ''}
        </div>
        ${t.description ? `<div class="desc">${inlineMd(t.description)}</div>` : ''}
        ${t.attempts.length > 1 ? `<div class="attempts" role="tablist" aria-label="Attempts">${t.attempts.map((x, i) => `
          <button type="button" role="tab" aria-selected="${i === ai}" class="${i === ai ? 'on' : ''}" data-attempt="${i}" data-test="${t.id}">
            ${statusIcon(attemptStatus(x))}${i === 0 ? 'First run' : `Retry ${i}`} <span class="muted num">${fmtDur(x.duration)}</span></button>`).join('')}</div>` : ''}
      </section>

      ${a.errors.map((e, i) => whyCard(t, ai, e, i, a.errors.length)).join('')}
      ${storyCard(t, a, aStatus)}
      ${mediaCard(a)}
      ${diagCount || (diag.console || []).length ? diagnosticsCard(diag) : ''}
      ${stabilityCard(t)}
      ${a.steps.length ? `<section class="card"><details><summary class="card-h" style="cursor:pointer;padding-bottom:16px"><h3>Technical steps</h3><span class="sub">every Playwright action, assertion & hook</span></summary>
        <div class="card-b" style="padding-top:0"><ul class="tree">${a.steps.map(treeNode).join('')}</ul></div></details></section>` : ''}
      ${a.stdout || a.stderr ? `<section class="card"><details><summary class="card-h" style="cursor:pointer;padding-bottom:16px"><h3>Console output</h3><span class="sub">stdout / stderr from the test</span></summary>
        <div class="card-b" style="padding-top:0;display:grid;gap:8px">${a.stdout ? `<pre class="codeframe" style="padding:12px">${esc(a.stdout)}</pre>` : ''}${a.stderr ? `<pre class="codeframe" style="padding:12px;color:#f7a1a1">${esc(a.stderr)}</pre>` : ''}</div></details></section>` : ''}
    `;
    el.querySelectorAll('[data-compare]').forEach(initCompare);
    document.querySelectorAll('.test-row').forEach((row) => {
      const on = row.dataset.id === id;
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', on);
    });
  }

  /* ---------- why it failed ---------- */

  function diffHighlight(a, b) {
    a = String(a); b = String(b);
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let e = 0;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    const mk = (str, cls) => `${esc(str.slice(0, s))}<mark class="${cls}">${esc(str.slice(s, str.length - e))}</mark>${esc(str.slice(str.length - e))}`;
    return [mk(a, 'diff-exp'), mk(b, 'diff-add')];
  }

  function compareBlock(f) {
    if (f.expected === undefined || f.received === undefined) return '';
    const [exp, rec] = diffHighlight(f.expected, f.received);
    return `<div class="compare">
      <div class="exp"><div class="k">✓ Expected</div><pre>${exp}</pre></div>
      <div class="rec"><div class="k">✕ Received</div><pre>${rec}</pre></div></div>`;
  }

  function codeFrame(e) {
    if (!e.snippet) return '';
    const loc = e.location ? `${e.location.file.split(/[\\/]/).slice(-2).join('/')}:${e.location.line}` : '';
    return `<div>${loc ? `<div class="codeframe-file">${esc(loc)}</div>` : ''}<div class="codeframe">${e.snippet.map((row) => {
      let out = `<div class="ln ${row.focus ? 'focus' : ''}"><span>${row.line}</span><span>${esc(row.code)}</span></div>`;
      if (row.focus && row.caret >= 0) out += `<div class="ln"><span></span><span class="caret">${' '.repeat(Math.max(0, row.caret - 1))}^</span></div>`;
      return out;
    }).join('')}</div></div>`;
  }

  /** "testId|attempt|error|storyEventId" — what a clickable error points at. */
  function errRef(tid, ai, ei, evId = '') {
    return `${tid}|${ai}|${ei}|${evId}`;
  }

  /** Which analyzed error a raw step error belongs to (falls back to the first one). */
  function errorIndexFor(a, rawText) {
    if (!a || !a.errors.length) return -1;
    const norm = (s) => String(s || '').replace(/^\w*Error:\s*/, '').trim().toLowerCase();
    const n = norm(rawText);
    if (n) {
      const k = a.errors.findIndex((e) => { const m = norm(e.message.split('\n')[0]); return m && (m.includes(n) || n.includes(m)); });
      if (k >= 0) return k;
    }
    return 0;
  }

  /** A plain-language error line that opens the details drawer when clicked. */
  function errButton(ref, e, raw, extraStyle = '') {
    const text = e ? e.explanation : raw;
    return `<button type="button" class="ev-err" data-err="${esc(ref)}" style="${extraStyle}" title="Click for full details">
      <span aria-hidden="true">${e ? e.icon : '✕'}</span><span class="txt">${inlineMd(text)}</span><span class="more">Details ›</span></button>`;
  }

  function whyCard(t, ai, e, i, total) {
    const f = e.facts || {};
    const a = t.attempts[ai];
    const failedStep = [...(a.story || [])].reverse().find((ev) => ev.kind === 'step' && ev.status !== 'passed');
    const ref = errRef(t.id, ai, i);
    return `<section class="card why">
      <div class="why-head" data-err="${esc(ref)}" role="button" tabindex="0" title="Click for full details">
        <span class="emoji" aria-hidden="true">${e.icon}</span>
        <div style="min-width:0">
          <div class="kicker">Why it failed${total > 1 ? ` · error ${i + 1} of ${total}` : ''}</div>
          <h3>${esc(e.title)}</h3>
          <p>${inlineMd(e.explanation)}</p>
        </div>
      </div>
      <div class="why-body">
        ${compareBlock(f)}
        <div class="why-facts">
          ${failedStep && i === 0 ? `<span class="fact">📍 Failed at step <b>${esc(failedStep.title)}</b></span>` : ''}
          ${f.locator ? `<span class="fact">🎯 <code>${esc(f.locator)}</code></span>` : ''}
          ${e.location ? `<span class="fact">📄 <code>${esc(e.location.file.split(/[\\/]/).pop())}:${e.location.line}</code></span>` : ''}
        </div>
        <div class="why-tip">💡 ${inlineMd(e.hints[0] || 'Open the details to see what happened.')}</div>
        <div><button type="button" class="btn primary" data-err="${esc(ref)}">🔎 See full details</button>
          <span class="muted" style="font-size:12px;margin-left:8px">where it happened, what Playwright tried, browser clues, history & fixes</span></div>
      </div>
    </section>`;
  }

  /* ---------- story ---------- */

  const EV_GLYPH = { note: '✎', data: '≡', screenshot: '◉', failure: '!' };

  function storyCard(t, a, aStatus) {
    const events = a.story || [];
    if (!events.length) {
      if (t.outcome === 'skipped') return `<section class="card card-b"><div class="empty">⏭ This test was skipped${t.annotations.find((x) => x.type === 'skip')?.description ? `: ${esc(t.annotations.find((x) => x.type === 'skip').description)}` : ''}.</div></section>`;
      return '';
    }
    const shots = events.filter((e) => e.screenshot);
    let stepNo = 0;
    const items = events.map((e) => {
      const kind = e.kind || 'step';
      const st = kind === 'failure' ? 'failure' : e.status || 'passed';
      const glyph = kind === 'step' ? (st === 'passed' ? (e.depth === 0 ? ++stepNo : '✓') : '✕') : EV_GLYPH[kind] || '•';
      const shotIdx = e.screenshot ? shots.indexOf(e) : -1;
      let body = '';
      if (kind === 'note') body = `<div class="ev-note ${esc(e.level || '')}">${inlineMd(e.title)}</div>`;
      else {
        body = `<div class="ev-title"><span class="t">${esc(e.title)}</span>
          ${e.category && e.category !== 'test.step' ? `<span class="ev-kind">${esc(e.category)}</span>` : ''}
          ${st === 'soft-failed' ? '<span class="badge" style="color:var(--fail-ink)">soft check</span>' : ''}
          <span class="time num">${e.duration != null && kind === 'step' ? `${fmtDur(e.duration)} · ` : ''}+${fmtDur(e.at)}</span></div>`;
        if (e.error) {
          const k = kind === 'failure' ? 0 : errorIndexFor(a, e.error);
          body += errButton(errRef(t.id, ui.ctx.ai, Math.max(0, k), e.id), a.errors[k], e.error);
        }
        if (e.data) body += `<details><summary class="muted" style="cursor:pointer;font-size:13px">Show data</summary><pre>${esc(e.data.text ?? '(binary)')}</pre></details>`;
        if (e.screenshot) body += `<button type="button" class="ev-shot" data-play="${shotIdx}" aria-label="Open screenshot: ${esc(e.title)}"><img loading="lazy" src="${esc(e.screenshot.src)}" alt=""></button>`;
      }
      return `<li class="ev ${esc(kind === 'failure' ? 'failure' : st)}" style="margin-left:${(e.depth || 0) * 24}px">
        <span class="node" aria-hidden="true">${glyph}</span><div class="ev-main">${kind === 'note' ? '' : ''}${body}</div></li>`;
    }).join('');

    ui.player = shots.map((e) => {
      const k = e.error ? (e.kind === 'failure' ? 0 : errorIndexFor(a, e.error)) : -1;
      return {
        title: e.title, src: e.screenshot.src, status: e.kind === 'failure' ? 'failed' : e.status, at: e.at,
        error: k >= 0 && a.errors[k] ? a.errors[k].explanation : e.error,
        err: k >= 0 ? errRef(t.id, ui.ctx.ai, k, e.id) : null,
      };
    });
    const steps = events.filter((e) => e.kind === 'step');
    const failedSteps = steps.filter((e) => e.status !== 'passed').length;

    return `<section class="card">
      <div class="card-h" style="align-items:center">
        <h3>Test story</h3><span class="sub">${plural(steps.length, 'step')}${failedSteps ? ` · ${failedSteps} failed` : ''} · ${plural(shots.length, 'screenshot')}</span>
        <div class="story-toolbar">${shots.length ? `<button type="button" class="btn primary" data-play="0" data-autoplay>▶ Play story</button>` : ''}</div>
      </div>
      <div class="card-b"><ol class="story">${items}</ol></div>
    </section>`;
  }

  /* ---------- media ---------- */

  function mediaCard(a) {
    const { items = [], visual = [] } = a.media || {};
    const images = items.filter((m) => m.kind === 'image' && m.src);
    const videos = items.filter((m) => m.kind === 'video' && m.src);
    const traces = items.filter((m) => m.kind === 'trace' && m.src);
    const others = items.filter((m) => !['image', 'video', 'trace'].includes(m.kind));
    if (!images.length && !videos.length && !traces.length && !others.length && !visual.length) return '';
    ui.gallery = images.map((m) => ({ title: m.label, src: m.src, status: m.name === 'aurora-failure' ? 'failed' : 'passed' }));

    return `<section class="card"><div class="card-h"><h3>Media & evidence</h3><span class="sub">${[
      visual.length && plural(visual.length, 'visual diff'), videos.length && plural(videos.length, 'video'),
      images.length && plural(images.length, 'screenshot'), traces.length && 'trace'].filter(Boolean).join(' · ')}</span></div>
      <div class="card-b" style="display:grid;gap:18px">
        ${visual.map((v, i) => {
          const base = v.actual || v.previous;
          const top = v.expected;
          if (!base || !top) return '';
          return `<div><div style="font-weight:600;margin-bottom:6px">🖼 ${esc(v.name)} <span class="muted" style="font-weight:400">— drag to compare</span></div>
            <div class="compare-slider" data-compare="${i}">
              <img src="${esc(base.src)}" alt="Actual">
              <img class="top-img" src="${esc(top.src)}" alt="Expected" style="position:absolute;inset:0;width:100%;clip-path:inset(0 50% 0 0)">
              <div class="handle" style="left:50%"></div>
              <input type="range" min="0" max="100" value="50" aria-label="Compare expected and actual">
            </div>
            <div class="cmp-labels"><span style="color:var(--pass-ink)">◀ Expected</span><span style="color:var(--fail-ink)">Actual ▶</span></div>
            ${v.diff ? `<div style="margin-top:10px"><div class="muted" style="font-size:12px;margin-bottom:4px">Diff (changed pixels in red)</div>
              <img src="${esc(v.diff.src)}" alt="Diff" style="max-width:100%;border-radius:10px;border:1px solid var(--border)"></div>` : ''}
          </div>`;
        }).join('')}
        ${videos.map((v, i) => `<div>
          <div class="video-wrap"><video id="vid-${i}" src="${esc(v.src)}" controls preload="metadata"></video></div>
          <div class="video-bar"><span class="muted" style="font-size:12px">Speed</span>
            ${[0.25, 0.5, 1, 2].map((s) => `<button type="button" class="btn speed ${s === 1 ? 'on' : ''}" data-speed="${s}" data-video="vid-${i}">${s}×</button>`).join('')}
            <a class="btn" href="${esc(v.src)}" download style="margin-left:auto">⬇ Download</a></div></div>`).join('')}
        ${images.length ? `<div class="media-grid">${images.map((m, i) => `<figure class="media-item" style="margin:0">
          <img loading="lazy" src="${esc(m.src)}" alt="${esc(m.label)}" data-gallery="${i}">
          <figcaption class="cap"><span>${esc(m.label)}</span><span class="muted">${fmtBytes(m.size)}</span></figcaption></figure>`).join('')}</div>` : ''}
        ${traces.map((tr) => `<div class="trace-box"><span style="font-size:20px">🧭</span>
          <div style="flex:1;min-width:0"><div style="font-weight:600">Playwright trace</div>
          <code title="${esc(tr.command)}">${esc(tr.command)}</code></div>
          <button type="button" class="btn" data-copy="${esc(tr.command)}">Copy command</button>
          <a class="btn" href="${esc(tr.src)}" download>⬇ Download</a>
          <a class="btn" href="https://trace.playwright.dev" target="_blank" rel="noopener">Open viewer ↗</a></div>`).join('')}
        ${others.map((o) => `<div class="trace-box"><span style="font-size:18px">${o.kind === 'html' ? '🧾' : '📎'}</span>
          <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(o.label)}</div><span class="muted">${esc(o.type)} ${fmtBytes(o.size)}</span></div>
          ${o.src ? `<a class="btn" href="${esc(o.src)}" target="_blank" rel="noopener">Open</a>` : ''}
          ${o.text != null ? `<details style="width:100%"><summary class="muted" style="cursor:pointer">Preview</summary><pre style="margin-top:6px;max-height:300px;overflow:auto">${esc(o.text)}</pre></details>` : ''}</div>`).join('')}
      </div></section>`;
  }

  function initCompare(el) {
    const input = el.querySelector('input');
    const top = el.querySelector('.top-img');
    const handle = el.querySelector('.handle');
    input.addEventListener('input', () => {
      top.style.clipPath = `inset(0 ${100 - input.value}% 0 0)`;
      handle.style.left = `${input.value}%`;
    });
  }

  /* ---------- diagnostics ---------- */

  function diagnosticsCard(diag) {
    const consoleRows = diag.console || [];
    const pageErrors = diag.pageErrors || [];
    const net = diag.network || [];
    const section = (title, body) => `<div><div style="font-weight:600;margin:4px 0 6px">${title}</div>${body}</div>`;
    return `<section class="card" id="diag"><div class="card-h"><h3>Browser diagnostics</h3><span class="sub">captured automatically — no code needed</span></div>
      <div class="card-b" style="display:grid;gap:16px">
        ${pageErrors.length ? section(`💥 Uncaught page errors <span class="badge">${pageErrors.length}</span>`,
          `<table class="tbl"><tr><th>At</th><th>Error</th></tr>${pageErrors.map((p) => `<tr><td class="n">+${fmtDur(p.at)}</td><td><b>${esc(p.message)}</b>
          ${p.stack ? `<details><summary class="muted" style="cursor:pointer">stack</summary><pre>${esc(p.stack)}</pre></details>` : ''}</td></tr>`).join('')}</table>`) : ''}
        ${consoleRows.length ? section(`🖥 Console <span class="badge">${consoleRows.length}</span>`,
          `<table class="tbl"><tr><th>At</th><th>Level</th><th>Message</th></tr>${consoleRows.map((c) => `<tr><td class="n">+${fmtDur(c.at)}</td>
          <td>${c.type === 'error' ? '<span style="color:var(--fail-ink);font-weight:600">✕ error</span>' : '<span style="color:var(--flaky-ink);font-weight:600">! warning</span>'}</td>
          <td><span class="mono">${esc(c.text)}</span>${c.source ? `<div class="muted" style="font-size:11.5px">${esc(c.source)}</div>` : ''}</td></tr>`).join('')}</table>`) : ''}
        ${net.length ? section(`🌐 Failed network requests <span class="badge">${net.length}</span>`,
          `<div class="net-list">${net.map(networkRow).join('')}</div>`) : ''}
      </div></section>`;
  }

  /** One failed request: a summary line, expanding to the request and the response. */
  function networkRow(n) {
    const headers = (title, map) => {
      const rows = Object.entries(map || {});
      if (!rows.length) return '';
      return `<div class="net-block"><div class="net-k">${title}</div>
        <table class="tbl net-headers">${rows.map(([k, v]) => `<tr><td class="hk">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>`;
    };
    const body = (title, b) => {
      if (!b || !b.text) return '';
      return `<div class="net-block"><div class="net-k">${title}
        <span class="muted" style="font-weight:400">${fmtBytes(b.size)}${b.truncated ? ' · shown up to the size limit' : ''}</span></div>
        <pre class="codeframe" style="padding:10px 12px">${esc(b.text)}</pre></div>`;
    };
    const failed = !n.status;
    return `<details class="net-item">
      <summary>
        <span class="status-code ${failed ? 'err' : ''}">${failed ? 'FAILED' : n.status}</span>
        <span class="net-method">${esc(n.method || '')}</span>
        <span class="net-url mono" title="${esc(n.url)}">${esc(n.url)}</span>
        <span class="muted num">+${fmtDur(n.at)}</span>
      </summary>
      <div class="net-body">
        <div class="net-meta">
          ${n.error ? `<span class="badge" style="color:var(--fail-ink)">${esc(n.error)}</span>` : ''}
          ${n.resource ? `<span class="badge">${esc(n.resource)}</span>` : ''}
          ${n.duration != null ? `<span class="badge">took ${fmtDur(n.duration)}</span>` : ''}
          ${n.statusText && n.statusText !== n.error ? `<span class="badge">${esc(n.statusText)}</span>` : ''}
        </div>
        <div class="net-cols">
          <div>
            <div class="net-h">↗ Request</div>
            ${headers('Headers', n.requestHeaders)}
            ${body('Body', n.requestBody)}
            ${!n.requestHeaders && !n.requestBody ? '<div class="muted" style="font-size:12.5px">No request details were recorded.</div>' : ''}
          </div>
          <div>
            <div class="net-h">↘ Response</div>
            ${failed ? `<div class="muted" style="font-size:12.5px">No response — the request never completed (${esc(n.error || 'failed')}).</div>`
              : `${headers('Headers', n.responseHeaders)}${body('Body', n.responseBody)}
                 ${!n.responseHeaders && !n.responseBody ? '<div class="muted" style="font-size:12.5px">No response details were recorded.</div>' : ''}`}
          </div>
        </div>
      </div>
    </details>`;
  }

  /* ---------- stability ---------- */

  function stabilityCard(t) {
    const h = stability[t.id] || [];
    if (h.length < 2) return '';
    const passes = h.filter((x) => x.o === 'p').length;
    const flakies = h.filter((x) => x.o === 'k').length;
    const fails = h.filter((x) => x.o === 'f').length;
    const green = (passes + flakies) / h.length;
    const verdict = fails === 0 && flakies === 0 ? ['passed', 'Rock solid']
      : fails === 0 ? ['flaky', 'Passes, but needs retries']
      : green >= 0.8 ? ['flaky', 'Mostly stable'] : ['failed', 'Unstable'];
    const summary = [
      passes ? `passed <b>${passes}</b>` : '',
      flakies ? `passed after a retry <b>${flakies}</b>` : '',
      fails ? `failed <b>${fails}</b>` : '',
    ].filter(Boolean).join(' · ');
    const cells = h.map((x, i) => {
      const s = x.o === 'p' ? 'passed' : x.o === 'k' ? 'flaky' : 'failed';
      const latest = i === h.length - 1;
      return `<span title="${latest ? 'This run' : `Run ${i + 1}`}: ${STATUS[s].label} · ${fmtDur(x.d)}" style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;background:${STATUS[s].color};color:${s === 'flaky' ? '#3b2800' : '#fff'};font-size:11px;font-weight:800;${latest ? 'box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink)' : ''}">${STATUS[s].icon}</span>`;
    }).join('');
    return `<section class="card"><div class="card-h"><h3>Stability</h3><span class="sub">last ${plural(h.length, 'run')}</span></div>
      <div class="card-b" style="display:grid;gap:12px">
        <div class="meta-row">${pill(verdict[0]).replace(STATUS[verdict[0]].label, verdict[1])}<span class="ink2">Of the last ${h.length} runs: ${summary}</span></div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${cells}</div>
        <div class="muted" style="font-size:12px;display:flex;gap:10px;align-items:center">Duration per run ${spark(h.map((x) => x.d || 0), { w: Math.min(360, h.length * 18), h: 32 })}</div>
      </div></section>`;
  }

  /* ---------- technical tree ---------- */

  const CAT_LABEL = { 'test.step': 'step', 'pw:api': 'action', expect: 'assert', hook: 'hook', fixture: 'fixture' };
  function treeNode(s) {
    const kids = s.steps && s.steps.length;
    return `<li class="${kids && !s.error ? 'closed' : ''}">
      <div class="node-row">
        <span class="tog" ${kids ? 'data-toggle' : ''}>${kids ? '▸' : ''}</span>
        ${s.error ? '<span class="st-icon failed">✕</span>' : ''}
        <span class="cat">${CAT_LABEL[s.category] || s.category}</span>
        <span class="${s.error ? 'err' : ''}" style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</span>
        <span class="dur num">${fmtDur(s.duration)}</span>
      </div>
      ${s.error && ui.ctx ? (() => {
        const k = errorIndexFor(ui.ctx.a, s.error);
        return errButton(errRef(ui.ctx.tid, ui.ctx.ai, Math.max(0, k)), ui.ctx.a.errors[k], s.error, 'margin:2px 0 6px 22px;width:calc(100% - 22px)');
      })() : ''}
      ${kids ? `<ul class="tree">${s.steps.map(treeNode).join('')}</ul>` : ''}
    </li>`;
  }

  /* ================================================================ failures view */

  function renderFailures(view, r) {
    const flaky = tests.filter((t) => t.outcome === 'flaky');
    const failedCount = stats.failed;
    if (!clusters.length && !flaky.length) {
      view.innerHTML = `<section class="card hero"><div><span class="verdict pill passed">${statusIcon('passed')}All clear</span>
        <h1>No failures in this run</h1><p class="story-text">Every executed test passed on its first attempt. Enjoy the green. 🌿</p></div><div class="ring-wrap">${donut()}</div></section>`;
      return;
    }
    const row = (tt) => {
      const t = byId.get(tt.id);
      const why = t.outcome === 'flaky' ? (t.attempts.find((a) => a.errors.length) || { errors: [] }).errors[0] : null;
      return `<div class="test-row" data-href="#/tests/${t.id}">${statusIcon(t.outcome)}
        <div style="min-width:0"><div class="tt">${esc(t.title)}</div><div class="ts">${esc([projects.length > 1 ? t.project : '', t.file].filter(Boolean).join(' · '))}${why ? ` · ${why.icon} first attempt: ${esc(why.explanation)}` : ''}</div></div>
        ${t.outcome === 'failed' || why ? `<button type="button" class="btn" style="padding:3px 10px;font-size:12px" data-err="${esc(errRef(t.id, t.outcome === 'flaky' ? t.attempts.findIndex((x) => x.errors.length) : t.attempts.length - 1, 0))}">Error details</button>` : ''}
        <div class="dur">${fmtDur(t.lastDuration)}</div></div>`;
    };
    view.innerHTML = `
      <h2 class="section" style="margin-top:4px">Failures grouped by cause</h2>
      <p class="ink2" style="margin:-4px 0 16px">${failedCount && clusters.length ? `${plural(failedCount, 'failed test')} ${clusters.length === 1 ? 'share one root cause' : `boil down to ${plural(clusters.length, 'distinct problem')}`}. Fix the top group first — it unblocks the most tests.` : 'Only flaky tests below.'}</p>
      <div style="display:grid;gap:14px">
        ${clusters.map((c, i) => `<section class="card cluster" id="cluster-${i}">
          <div class="cluster-head"><span class="emoji" aria-hidden="true">${c.icon}</span>
            <div style="min-width:0"><h3>${esc(c.title)}</h3><p>${inlineMd(c.explanation)}</p></div>
            <div class="cluster-count"><b class="num" style="color:var(--fail-ink)">${c.tests.length}</b><span class="muted">${c.tests.length === 1 ? 'test' : 'tests'}</span></div></div>
          ${(() => {
            const first = byId.get(c.tests[0].id);
            const ai = first.attempts.length - 1;
            return `<button type="button" class="cluster-msg" data-err="${esc(errRef(first.id, ai, 0))}" title="Click for full details">
              <span style="min-width:0">${esc(c.message)}</span><span class="more">Details ›</span></button>`;
          })()}
          <div class="cluster-tests">${c.tests.map(row).join('')}</div>
        </section>`).join('')}
      </div>
      ${flaky.length ? `<h2 class="section">Flaky tests <span class="muted" style="text-transform:none;letter-spacing:0">— failed first, passed on retry</span></h2>
        <section class="card"><div class="cluster-tests">${flaky.map((t) => row({ id: t.id })).join('')}</div></section>` : ''}`;
    if (r.id !== '') {
      const target = document.getElementById(`cluster-${r.id}`);
      if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.style.boxShadow = '0 0 0 2px var(--accent)'; }
    }
  }

  /* ================================================================ timeline view */

  function renderTimeline(view) {
    const runs = tests.flatMap((t) => t.attempts.map((a, i) => ({ t, a, i })));
    const end = Math.max(1, ...runs.map((x) => x.a.start + x.a.duration));
    const lanes = [...new Set(runs.map((x) => x.a.lane))].sort((a, b) => a - b);
    const busy = runs.reduce((s, x) => s + x.a.duration, 0);
    const util = lanes.length ? busy / (end * lanes.length) : 0;
    const sumTests = tests.reduce((s, t) => s + t.duration, 0);

    view.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:0">
        <div class="card kpi"><div class="label">Wall-clock time</div><div class="value num">${fmtDur(stats.duration)}</div><div class="delta">from start to finish</div></div>
        <div class="card kpi"><div class="label">Total test time</div><div class="value num">${fmtDur(sumTests)}</div><div class="delta">if run one by one</div></div>
        <div class="card kpi"><div class="label">Time saved by parallelism</div><div class="value num">${sumTests > stats.duration ? `${(sumTests / Math.max(1, stats.duration)).toFixed(1)}×` : '—'}</div><div class="delta">${plural(lanes.length, 'worker lane')}</div></div>
        <div class="card kpi"><div class="label">Worker utilization</div><div class="value num">${pct(Math.min(1, util))}</div><div class="delta">${util < 0.6 ? 'workers were often idle' : 'workers stayed busy'}</div></div>
      </div>
      <section class="card" style="margin-top:16px"><div class="card-h"><h3>Execution timeline</h3><span class="sub">each row is a worker · hover for details · click to open</span></div>
        <div class="card-b">${legend([{ label: 'Passed', color: 'var(--pass)' }, { label: 'Failed attempt', color: 'var(--fail)' }, { label: 'Skipped', color: 'var(--skip)' }])}
        <div class="gantt-wrap" id="ch-gantt"></div></div></section>`;

    mount(document.getElementById('ch-gantt'), (w) => {
      if (!runs.length) return '<div class="empty">No test executions recorded.</div>';
      const padL = 74, padT = 24, laneH = 30, barH = 18;
      const pw = w - padL - 8;
      const H = padT + lanes.length * laneH + 4;
      const x = (ms) => padL + (ms / end) * pw;
      const stepMs = niceNum(end / Math.max(2, Math.floor(pw / 90)));
      let axis = '';
      for (let v = 0; v <= end; v += stepMs) {
        axis += `<line class="gridline" x1="${x(v)}" x2="${x(v)}" y1="${padT - 6}" y2="${H}"/><text x="${x(v)}" y="${padT - 10}" text-anchor="middle" class="num">${fmtDur(v)}</text>`;
      }
      const laneBg = lanes.map((l, i) => `<text class="lbl" x="${padL - 10}" y="${padT + i * laneH + laneH / 2 + 4}" text-anchor="end">Worker ${l + 1}</text>
        <line class="baseline" x1="${padL}" x2="${w - 8}" y1="${padT + (i + 1) * laneH}" y2="${padT + (i + 1) * laneH}" style="opacity:.5"/>`).join('');
      const bars = runs.map(({ t, a, i }, k) => {
        const li = lanes.indexOf(a.lane);
        const st = attemptStatus(a);
        const bx = x(a.start), bw = Math.max(2, x(a.start + a.duration) - bx - 2);
        const by = padT + li * laneH + (laneH - barH) / 2;
        const tt = tip(`<div class="tt-title">${statusIcon(st)} ${esc(t.title)}</div>
          ${tipRow(STATUS[st].color, i ? `Retry ${i}` : 'Attempt', STATUS[st].label)}
          <div class="tt-row muted">Started<b>+${fmtDur(a.start)}</b></div><div class="tt-row muted">Duration<b>${fmtDur(a.duration)}</b></div>
          <div class="tt-row muted">File<b>${esc(t.file.split('/').pop())}</b></div>`);
        return `<path class="mark" data-grp="g${k}" data-tip="${tt}" data-href="#/tests/${t.id}" style="cursor:pointer" d="${rrect(bx, by, bw, barH, [4, 4, 4, 4])}" fill="${STATUS[st].color}"/>`;
      }).join('');
      return `<svg class="chart" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${axis}${laneBg}${bars}</svg>`;
    });
  }

  /* ================================================================ error details drawer */

  /** Playwright call-log lines, rewritten as plain sentences. */
  const CALL_LOG_RULES = [
    [/^Expect "(\w+)" with timeout (\d+)ms/i, (m) => `Started the check <b>${esc(m[1])}</b> (keeps retrying for up to ${fmtDur(+m[2])})`],
    [/^(?:\w+\.)?(\w+)\(.*\) with timeout (\d+)ms/i, (m) => `Started <b>${esc(m[1])}</b> (waits up to ${fmtDur(+m[2])})`],
    [/^waiting for element to be visible, enabled and stable/i, () => 'Waited until the element was visible, enabled and not moving'],
    [/^waiting for (.+)$/i, (m) => `Looked for <code>${esc(m[1])}</code> on the page`],
    [/^locator resolved to (\d+) elements?/i, (m) => `Found <b>${m[1]}</b> matching elements`],
    [/^locator resolved to (.+)$/i, (m) => `Found the element <code>${esc(truncate(m[1], 90))}</code>`],
    [/^unexpected value "(.*)"$/i, (m) => `Read the value <b>“${esc(m[1])}”</b>, which is not what the test expects`, 'bad'],
    [/^element is not (\w+)/i, (m) => `The element was not ${esc(m[1])} yet`, 'bad'],
    [/^(.+) intercepts pointer events/i, (m) => `Something is covering the element: <code>${esc(truncate(m[1], 80))}</code>`, 'bad'],
    [/^retrying (.+) action, attempt #(\d+)/i, (m) => `Tried the ${esc(m[1])} again (attempt ${m[2]})`],
    [/^waiting (\d+)ms$/i, (m) => `Paused ${fmtDur(+m[1])} before retrying`],
    [/^scrolling into view if needed/i, () => 'Scrolled the element into view'],
    [/^done scrolling/i, () => 'Finished scrolling'],
    [/^performing (\w+) action/i, (m) => `Performed the ${esc(m[1])}`],
    [/^(\w+) action done/i, (m) => `The ${esc(m[1])} completed`],
    [/^navigating to "(.+?)", waiting until "(.+?)"/i, (m) => `Opened <code>${esc(m[1])}</code> and waited for "${esc(m[2])}"`],
    [/^element is visible, enabled and stable/i, () => 'The element was ready'],
  ];

  function plainCallLog(lines) {
    const out = [];
    for (const raw of lines) {
      let html = esc(raw);
      let cls = '';
      for (const [re, fn, c] of CALL_LOG_RULES) {
        const m = raw.match(re);
        if (m) { html = fn(m); cls = c || ''; break; }
      }
      const key = raw.replace(/\d+/g, '#');
      const prev = out[out.length - 1];
      if (prev && prev.key === key) prev.count++;
      else out.push({ key, html, cls, raw, count: 1 });
    }
    return out;
  }

  function bugReportText(t, a, e, failedEv) {
    const f = e.facts || {};
    return [
      `**Test:** ${t.title}${projects.length > 1 ? ` (${t.project})` : ''}`,
      `**File:** ${t.file}:${t.line}`,
      `**Problem:** ${e.title}. ${e.explanation}`,
      failedEv ? `**Failed step:** ${failedEv.title}` : '',
      f.expected !== undefined ? `**Expected:** ${f.expected}` : '',
      f.received !== undefined ? `**Received:** ${f.received}` : '',
      f.locator ? `**Element:** \`${f.locator}\`` : '',
      t.attempts.length > 1 ? `**Attempts:** ${t.attempts.map((x, i) => `${i ? `retry ${i}` : 'first run'} ${attemptStatus(x)}`).join(', ')}` : '',
      '', '```', e.message, '```',
    ].filter((l) => l !== '').join('\n').replace('\n```', '\n\n```');
  }

  function openErrorDrawer(ref) {
    const [tid, aiStr, eiStr, evStr] = String(ref).split('|');
    const t = byId.get(tid);
    if (!t) return;
    const ai = Math.min(Math.max(0, +aiStr || 0), t.attempts.length - 1);
    const a = t.attempts[ai];
    if (!a || !a.errors.length) return;
    const ei = Math.min(+eiStr || 0, a.errors.length - 1);
    const e = a.errors[ei];
    const f = e.facts || {};
    const story = a.story || [];

    document.querySelector('.drawer-root')?.remove();

    // Where it happened
    const failedEv = (evStr && story.find((x) => String(x.id) === evStr && x.kind === 'step'))
      || [...story].reverse().find((x) => x.kind === 'step' && x.status !== 'passed');
    const failAt = failedEv ? failedEv.at + (failedEv.duration || 0) : a.duration;
    const failIdx = failedEv ? story.indexOf(failedEv) : story.length;
    const before = story.slice(0, failIdx).filter((x) => x.kind === 'step' || x.kind === 'note').filter((x) => !failedEv || x.id !== failedEv.parent).slice(-4);
    const shotEv = [...story].reverse().find((x) => x.kind === 'failure' && x.screenshot)
      || (failedEv && failedEv.screenshot ? failedEv : null);
    const shots = story.filter((x) => x.screenshot);

    // Browser clues
    const diag = a.diagnostics || {};
    const clues = [
      ...(diag.pageErrors || []).map((p) => ({ at: p.at, icon: '💥', kind: 'Page error', text: p.message })),
      ...(diag.console || []).filter((c) => c.type === 'error').map((c) => ({ at: c.at, icon: '🖥', kind: 'Console error', text: c.text })),
      ...(diag.network || []).map((n) => ({ at: n.at, icon: '🌐', kind: `HTTP ${n.status || 'failed'}`, text: `${n.method} ${n.url}${n.error ? ` — ${n.error}` : ''}` })),
    ].sort((x, y) => x.at - y.at);
    // Only flag clues that happened while the failing step ran (or in the last 3s when no step is known).
    const nearFrom = failedEv ? failedEv.at : failAt - 3000;
    const isNear = (c) => c.at >= nearFrom && c.at <= failAt + 1000;

    // Is this new?
    const h = stability[t.id] || [];
    const pastFails = h.slice(0, -1).filter((x) => x.o === 'f').length;
    const prev = h.length > 1 ? h[h.length - 2] : null;
    let historyText;
    if (h.length < 2) historyText = 'This is the first recorded run of this test, so there is no history yet.';
    else if (t.outcome === 'flaky') historyText = `It failed, then <b>passed on retry</b>. That usually means a timing problem (slow data, animations, race conditions) rather than a real bug.`;
    else if (prev && prev.o !== 'f') historyText = `🆕 <b>This is new.</b> The test passed in the previous run, so a recent change in the app or the test most likely caused it.`;
    else historyText = `🔁 <b>This keeps happening.</b> The test failed in ${pastFails} of the previous ${h.length - 1} runs.`;
    const cluster = clusters.find((c) => c.tests.some((x) => x.id === t.id));
    const others = cluster ? cluster.tests.filter((x) => x.id !== t.id) : [];

    const calls = plainCallLog(e.callLog || []);
    const sec = (n, title, body) => `<section class="dsec"><h4><span class="n">${n}</span>${title}</h4>${body}</section>`;
    let n = 0;

    const root = document.createElement('div');
    root.className = 'drawer-root';
    root.innerHTML = `
      <div class="drawer-backdrop" data-drawer-close></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="Error details">
        <header class="drawer-head">
          <span class="emoji" aria-hidden="true">${e.icon}</span>
          <div style="min-width:0;flex:1">
            <div class="kicker">Error details · ${esc(truncate(t.title, 70))}${t.attempts.length > 1 ? ` · ${ai ? `retry ${ai}` : 'first run'}` : ''}${a.errors.length > 1 ? ` · error ${ei + 1} of ${a.errors.length}` : ''}</div>
            <h3>${esc(e.title)}</h3>
            <p>${inlineMd(e.explanation)}</p>
            <div class="drawer-actions">
              <button type="button" class="btn" data-copy-bug>📋 Copy for bug report</button>
              <button type="button" class="btn" data-copy-link>🔗 Copy link</button>
              ${a.errors.length > 1 ? `<button type="button" class="btn" data-err="${esc(errRef(t.id, ai, (ei + 1) % a.errors.length))}">Next error ›</button>` : ''}
            </div>
          </div>
          <button type="button" class="icon-btn" data-drawer-close aria-label="Close (Esc)" title="Close (Esc)">✕</button>
        </header>
        <div class="drawer-body">
          ${compareBlock(f) ? sec(++n, 'What was expected vs. what happened', `${compareBlock(f)}
            <p class="muted" style="margin:8px 0 0;font-size:12.5px">The highlighted part is the difference.</p>`) : ''}

          ${sec(++n, 'Where it happened', `<div class="where">
            ${failedEv ? `<div class="where-row"><span class="k">Step</span><span><b>${esc(failedEv.title)}</b> <span class="muted">· started at +${fmtDur(failedEv.at)}${failedEv.duration != null ? `, failed after ${fmtDur(failedEv.duration)}` : ''}</span></span></div>` : ''}
            ${f.locator ? `<div class="where-row"><span class="k">Element</span><span class="locator">🎯 ${esc(f.locator)}</span><button type="button" class="btn" style="padding:2px 8px;font-size:12px" data-copy="${esc(f.locator)}">Copy</button></div>` : ''}
            ${f.url ? `<div class="where-row"><span class="k">URL</span><code>${esc(f.url)}</code></div>` : ''}
            ${f.timeout ? `<div class="where-row"><span class="k">Waited</span><span>${fmtDur(f.timeout)}</span></div>` : ''}
            ${e.location ? `<div class="where-row"><span class="k">Code</span><code>${esc(t.file)}:${e.location.line}</code></div>` : ''}
          </div>${codeFrame(e)}`)}

          ${shotEv ? sec(++n, 'What the page looked like', `<button type="button" class="ev-shot" style="max-width:100%" data-drawer-shot="${shots.indexOf(shotEv)}">
              <img src="${esc(shotEv.screenshot.src)}" alt="Page at the moment of failure"></button>
              <p class="muted" style="margin:6px 0 0;font-size:12.5px">Screenshot at the moment of failure. Click to open it with the rest of the test's screenshots.</p>`) : ''}

          ${before.length ? sec(++n, 'What the test did just before', `<ol class="before">
            ${before.map((x) => `<li class="${x.kind === 'note' ? 'note' : x.status}">${x.kind === 'note' ? '✎' : statusIcon(x.status === 'passed' ? 'passed' : 'failed')}
              <span>${x.kind === 'note' ? inlineMd(x.title) : esc(x.title)}</span><span class="muted num">+${fmtDur(x.at)}</span></li>`).join('')}
            ${failedEv ? `<li class="failed">${statusIcon('failed')}<span><b>${esc(failedEv.title)}</b> ← failed here</span><span class="muted num">+${fmtDur(failedEv.at)}</span></li>` : ''}
          </ol>`) : ''}

          ${calls.length ? sec(++n, 'Step by step: what Playwright tried', `<ul class="tried">
            ${calls.map((c) => `<li class="${c.cls}" title="${esc(c.raw)}"><span>${c.html}</span>${c.count > 1 ? `<span class="x">repeated ${c.count}×</span>` : ''}</li>`).join('')}
          </ul>`) : ''}

          ${sec(++n, 'Clues from the browser', clues.length ? `<div class="clues">
            ${clues.map((c) => `<div class="clue ${isNear(c) ? 'near' : ''}"><span>${c.icon}</span>
              <div style="min-width:0"><div><b>${esc(c.kind)}</b> <span class="muted num">+${fmtDur(c.at)}</span>${isNear(c) ? ' <span class="badge" style="color:var(--fail-ink)">during the failing step</span>' : ''}</div>
              <div class="mono clue-text">${esc(c.text)}</div></div></div>`).join('')}
          </div>` : '<p class="muted" style="margin:0">✓ No console errors, page errors or failed requests were recorded. The problem is most likely in what the page showed, not in a crash.</p>')}

          ${sec(++n, 'Is this new?', `<p style="margin:0">${historyText}</p>
            ${h.length > 1 ? `<div class="hist">${h.map((x, i) => `<i class="${x.o}" title="${i === h.length - 1 ? 'This run' : `Run ${i + 1}`}"></i>`).join('')}<span class="muted">oldest → this run</span></div>` : ''}
            ${t.attempts.length > 1 ? `<p style="margin:8px 0 0">Attempts: ${t.attempts.map((x, i) => `${statusIcon(attemptStatus(x))} ${i ? `Retry ${i}` : 'First run'}`).join(' &nbsp; ')}</p>` : ''}
            ${others.length ? `<p style="margin:10px 0 4px"><b>${plural(others.length, 'other test')}</b> failed for the same reason:</p>
              <div>${others.slice(0, 6).map((x) => { const o = byId.get(x.id); return `<a class="badge" href="#/tests/${o.id}" data-drawer-close>${statusIcon(o.outcome)} ${esc(truncate(o.title, 50))}${projects.length > 1 ? ` · ${esc(o.project)}` : ''}</a>`; }).join(' ')}</div>` : ''}`)}

          ${sec(++n, 'How to fix it', `<ul class="hints">${e.hints.map((x) => `<li><span>${inlineMd(x)}</span></li>`).join('')}</ul>`)}

          <section class="dsec"><details><summary><b>Technical details</b> <span class="muted">full error message, Playwright call log and stack trace</span></summary>
            <div style="display:grid;gap:8px;margin-top:10px">
              <pre class="codeframe" style="padding:12px">${esc(e.message)}</pre>
              ${e.callLog.length ? `<pre class="codeframe" style="padding:12px">${e.callLog.map((l) => `- ${esc(l)}`).join('\n')}</pre>` : ''}
              ${e.stack ? `<pre class="codeframe" style="padding:12px;color:#b8b6ae">${esc(e.stack.split('\n').filter((l) => /^\s+at /.test(l)).join('\n'))}</pre>` : ''}
            </div></details></section>
        </div>
      </aside>`;

    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    const lastFocus = document.activeElement;
    root.querySelector('.drawer .icon-btn').focus();

    const close = () => {
      root.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      // Live updates that arrived while this was open are applied now.
      if (ui.liveDeferred) { ui.liveDeferred = false; render(); updateLivePill(); }
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape' && !document.querySelector('.overlay')) { ev.preventDefault(); ev.stopPropagation(); close(); }
    };
    root.addEventListener('click', (ev) => {
      const tgt = ev.target;
      if (tgt.closest('[data-copy-bug]')) { ev.stopPropagation(); copy(bugReportText(t, a, e, failedEv), tgt.closest('button')); return; }
      if (tgt.closest('[data-copy-link]')) {
        ev.stopPropagation();
        copy(`${location.href.split('#')[0]}#/tests/${t.id}?error=${ai}.${ei}`, tgt.closest('button'));
        return;
      }
      const shot = tgt.closest('[data-drawer-shot]');
      if (shot) {
        ev.stopPropagation();
        openPlayer(shots.map((x) => ({ title: x.title, src: x.screenshot.src, status: x.kind === 'failure' ? 'failed' : x.status, at: x.at })), +shot.dataset.drawerShot, false);
        return;
      }
      if (tgt.closest('[data-err]')) { ev.stopPropagation(); close(); openErrorDrawer(tgt.closest('[data-err]').dataset.err); return; }
      if (tgt.closest('[data-drawer-close]')) {
        if (!tgt.closest('a')) ev.stopPropagation();
        close();
      }
    });
    document.addEventListener('keydown', onKey, true);
  }

  /* ================================================================ player / lightbox */

  function openPlayer(items, start, autoplay) {
    if (!items || !items.length) return;
    let i = Math.max(0, Math.min(start, items.length - 1));
    let playing = !!autoplay;
    let timer = null;
    const DUR = 2600;
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';

    const draw = () => {
      const it = items[i];
      const failed = it.status === 'failed' || it.status === 'soft-failed';
      ov.innerHTML = `
        <div class="overlay-top">
          <span class="num" style="opacity:.7">${i + 1} / ${items.length}</span>
          <span class="ttl">${esc(it.title)}</span><div class="spacer"></div>
          ${items.length > 1 ? `<button type="button" class="icon-btn" data-pl="toggle" title="Play / pause (space)">${playing ? '❚❚' : '▶'}</button>` : ''}
          <a class="icon-btn" href="${esc(it.src)}" download title="Download">⬇</a>
          <button type="button" class="icon-btn" data-pl="close" title="Close (Esc)">✕</button>
        </div>
        <div class="overlay-stage">
          ${items.length > 1 ? '<button type="button" class="icon-btn overlay-nav prev" data-pl="prev" aria-label="Previous">‹</button>' : ''}
          <img src="${esc(it.src)}" alt="${esc(it.title)}">
          ${items.length > 1 ? '<button type="button" class="icon-btn overlay-nav next" data-pl="next" aria-label="Next">›</button>' : ''}
        </div>
        <div class="player-caption">
          <div class="cap-title">${failed ? '<span class="st-icon failed">✕</span>' : '<span class="st-icon passed">✓</span>'} Step ${i + 1}: ${esc(it.title)}
            ${it.at != null ? `<span style="opacity:.6;font-weight:400;font-size:13px">+${fmtDur(it.at)}</span>` : ''}</div>
          ${it.error ? (it.err
            ? `<button type="button" class="cap-err" data-err="${esc(it.err)}">✕ ${esc(it.error)} <u>Details ›</u></button>`
            : `<div class="cap-err">${esc(it.error)}</div>`) : ''}
          ${items.length > 1 ? `<div class="progress">${items.map((x, k) => `<span data-pl-go="${k}" class="${k < i ? 'done' : ''} ${k === i && playing ? 'cur' : ''} ${x.status === 'failed' || x.status === 'soft-failed' ? 'failed' : ''}" style="--dur:${DUR}ms" title="${esc(x.title)}"></span>`).join('')}</div>` : ''}
        </div>`;
      clearTimeout(timer);
      if (playing) timer = setTimeout(() => { if (i < items.length - 1) { i++; draw(); } else { playing = false; draw(); } }, DUR);
    };
    const close = () => {
      clearTimeout(timer);
      ov.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey, true);
      if (ui.liveDeferred) { ui.liveDeferred = false; render(); updateLivePill(); }
    };
    const go = (n) => { i = (n + items.length) % items.length; draw(); };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === ' ') { playing = !playing; draw(); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    ov.addEventListener('click', (e) => {
      const errEl = e.target.closest('[data-err]');
      if (errEl) { e.stopPropagation(); close(); openErrorDrawer(errEl.dataset.err); return; }
      const b = e.target.closest('[data-pl],[data-pl-go]');
      if (!b) { if (e.target === ov || e.target.classList.contains('overlay-stage')) close(); return; }
      if (b.dataset.plGo) { playing = false; go(+b.dataset.plGo); return; }
      const act = b.dataset.pl;
      if (act === 'close') close();
      if (act === 'prev') { playing = false; go(i - 1); }
      if (act === 'next') { playing = false; go(i + 1); }
      if (act === 'toggle') { playing = !playing; if (playing && i === items.length - 1) i = 0; draw(); }
    });
    document.addEventListener('keydown', onKey, true);
    draw();
  }

  /* ================================================================ events */

  let hovered = null;
  function onMove(e) {
    const el = e.target.closest && e.target.closest('[data-tip]');
    const tt = document.getElementById('tooltip');
    if (!tt) return;
    if (hovered && hovered !== el) {
      const svg = hovered.closest('svg');
      if (svg) { svg.classList.remove('hovering'); svg.querySelectorAll('.on').forEach((m) => m.classList.remove('on')); }
      hovered = null;
    }
    if (!el) { tt.classList.remove('show'); return; }
    if (hovered !== el) {
      hovered = el;
      tt.innerHTML = ui.tips[+el.dataset.tip] || '';
      const svg = el.closest('svg');
      const grp = el.dataset.grp;
      if (svg && grp) {
        svg.classList.add('hovering');
        svg.querySelectorAll(`.mark[data-grp="${grp}"]`).forEach((m) => m.classList.add('on'));
      }
    }
    const pad = 14;
    const r = tt.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tt.style.left = `${x}px`;
    tt.style.top = `${y}px`;
    tt.classList.add('show');
  }

  function onClick(e) {
    const t = e.target;
    const errEl = t.closest('[data-err]');
    if (errEl) { e.preventDefault(); openErrorDrawer(errEl.dataset.err); return; }
    const play = t.closest('[data-play]');
    if (play) { openPlayer(ui.player, +play.dataset.play, play.hasAttribute('data-autoplay')); return; }
    const gal = t.closest('[data-gallery]');
    if (gal) { openPlayer(ui.gallery, +gal.dataset.gallery, false); return; }
    const speed = t.closest('[data-speed]');
    if (speed) {
      const v = document.getElementById(speed.dataset.video);
      if (v) v.playbackRate = +speed.dataset.speed;
      speed.parentElement.querySelectorAll('.speed').forEach((b) => b.classList.toggle('on', b === speed));
      return;
    }
    const cp = t.closest('[data-copy]');
    if (cp) { copy(cp.dataset.copy, cp); return; }
    const tog = t.closest('[data-toggle]');
    if (tog) { const li = tog.closest('li'); li.classList.toggle('closed'); tog.textContent = li.classList.contains('closed') ? '▸' : '▾'; return; }
    const att = t.closest('[data-attempt]');
    if (att) { ui.attempt[att.dataset.test] = +att.dataset.attempt; renderDetail(att.dataset.test); return; }
    const scroll = t.closest('[data-scroll]');
    if (scroll) { e.preventDefault(); document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }); return; }
    const fs = t.closest('[data-filter-status]');
    if (fs) { filters.status = fs.dataset.filterStatus; refreshList(); return; }
    if (t.closest('[data-filter-slow]')) { filters.slow = !filters.slow; refreshList(); return; }
    if (t.closest('#theme-btn')) { cycleTheme(); return; }
    const nav = t.closest('[data-href]');
    if (nav && !t.closest('a[href^="http"]')) {
      document.getElementById('tooltip')?.classList.remove('show');
      location.hash = nav.dataset.href.replace(/^#/, '');
    }
  }

  function refreshList() {
    const r = route();
    renderFilters();
    renderList(r.id);
    const first = visibleTests()[0];
    if (first && !visibleTests().some((x) => x.id === r.id)) location.hash = `/tests/${first.id}`;
  }

  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('aurora-theme', theme); } catch { /* private mode */ }
    applyTheme(theme);
  }

  function onChange(e) {
    const f = e.target.dataset && e.target.dataset.filter;
    if (f) { filters[f] = e.target.value; refreshList(); }
  }

  let searchTimer;
  function onInput(e) {
    if (e.target.id !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = e.target.value;
      if (route().view !== 'tests') location.hash = '/tests';
      else refreshList();
    }, 120);
  }

  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.matches('[data-err]:not(button)')) {
      e.preventDefault();
      openErrorDrawer(document.activeElement.dataset.err);
      return;
    }
    if (document.querySelector('.drawer-root, .overlay')) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      document.getElementById('q').focus();
      return;
    }
    if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    const r = route();
    if (r.view === 'tests' && (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const list = [...document.querySelectorAll('.test-row')];
      const idx = list.findIndex((x) => x.dataset.id === r.id);
      const next = list[idx + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); location.hash = `/tests/${next.dataset.id}`; }
    }
    const keys = { 1: 'overview', 2: 'tests', 3: 'failures', 4: 'timeline' };
    if (keys[e.key]) location.hash = `/${keys[e.key]}`;
  }

  let lastRoute = null;
  function onRoute() {
    const r = route();
    if (lastRoute && lastRoute.view === 'tests' && r.view === 'tests' && document.getElementById('detail') && ![...r.params.keys()].length) {
      if (byId.has(r.id)) { renderDetail(r.id); document.getElementById('detail').scrollIntoView({ block: 'nearest' }); window.scrollTo({ top: 0 }); }
      else render();
    } else {
      render();
      window.scrollTo({ top: 0 });
    }
    lastRoute = r;
  }

  /* ================================================================ live mode */

  function updateLivePill() {
    const pill = document.getElementById('live-pill');
    if (!pill || !meta.live) return;
    pill.classList.remove('hidden');
    if (meta.live.running) {
      const done = stats.total;
      const planned = meta.live.planned || done;
      pill.className = 'live-pill running';
      pill.innerHTML = `<i></i>LIVE <span class="num">${done}/${planned}</span>
        <span class="live-bar"><span style="width:${planned ? Math.round((done / planned) * 100) : 0}%"></span></span>`;
    } else {
      pill.className = 'live-pill done';
      pill.innerHTML = '✓ Run finished';
      pill.title = meta.live.reportFile ? `Saved report: ${meta.live.reportFile}` : 'The run has finished';
    }
  }

  /** Swap in fresh data without losing the reader's place. */
  function liveApply(data) {
    const openOverlay = document.querySelector('.drawer-root, .overlay');
    applyData(data);
    updateLivePill();
    // Never yank the page out from under an open error panel or the story player.
    if (openOverlay) { ui.liveDeferred = true; return; }
    const y = window.scrollY;
    const listTop = document.getElementById('test-list')?.scrollTop;
    render();
    window.scrollTo({ top: y });
    const list = document.getElementById('test-list');
    if (list && listTop != null) list.scrollTop = listTop;
  }

  function connectLive() {
    if (!meta.live || !meta.live.running || typeof EventSource === 'undefined') return;
    const source = new EventSource('events');
    const onData = (e) => { try { liveApply(JSON.parse(e.data)); } catch { /* ignore a bad frame */ } };
    source.addEventListener('snapshot', onData);
    source.addEventListener('update', onData);
    source.addEventListener('finished', (e) => { onData(e); source.close(); });
    source.onerror = () => { /* EventSource retries on its own */ };
    window.addEventListener('beforeunload', () => source.close());
  }

  shell();
  updateLivePill();
  connectLive();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);
  onRoute();
})();
