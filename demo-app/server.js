'use strict';

/**
 * A tiny static server for the demo shop, with a couple of endpoints that fail
 * on purpose so the report has real network traffic to show.
 *
 *   node demo-app/server.js          → http://localhost:3210
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DEMO_PORT || 3210);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  // Analytics beacon: noise a test report should be able to leave out.
  if (route.startsWith('/analytics/')) {
    return json(res, 500, { ok: false, reason: 'analytics collector unavailable' });
  }

  // The recommendation service is "down", so the shop has to cope.
  if (route === '/api/recommendations') {
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => json(res, 500, {
      error: 'recommendation_engine_unavailable',
      retryAfter: 30,
      requestEcho: body ? JSON.parse(body) : null,
    }, { 'x-request-id': 'req_8f21c', 'x-api-key': 'should-be-hidden-in-the-report' }));
  }

  const file = path.join(ROOT, route === '/' ? 'index.html' : route.replace(/^\//, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end(`Not found: ${route}`);
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`Demo shop on http://localhost:${PORT}`));
