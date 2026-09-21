'use strict';

/**
 * Live mode: a tiny local server that shows the report while the tests are still
 * running. Each finished test is pushed to the open page over server-sent events,
 * so you can watch the story build up instead of waiting for the run to end.
 *
 * It listens on 127.0.0.1 only — nothing is exposed to the network.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { renderReport } = require('./render');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => (err.code === 'EADDRINUSE' ? resolve(false) : reject(err));
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(true);
    });
  });
}

/**
 * @param {object} options
 * @param {() => object} options.getData   latest report data
 * @param {() => string} options.getRunDir where assets live right now
 */
async function startLiveServer({ getData, getRunDir, port = 4321, host = '127.0.0.1', attempts = 20 }) {
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      send(res, 'snapshot', getData());
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = renderReport(getData());
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (url.pathname === '/results.json') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
      return res.end(JSON.stringify(getData()));
    }

    // Screenshots, videos and traces are written as the run goes along.
    const file = path.join(getRunDir(), decodeURIComponent(url.pathname.replace(/^\//, '')));
    if (!file.startsWith(getRunDir()) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  });

  let chosen = null;
  for (let i = 0; i < attempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await listen(server, port + i, host)) { chosen = port + i; break; }
  }
  if (chosen === null) throw new Error(`no free port between ${port} and ${port + attempts - 1}`);

  const heartbeat = setInterval(() => {
    clients.forEach((res) => res.write(': ping\n\n'));
  }, 15000);
  heartbeat.unref();

  return {
    url: `http://localhost:${chosen}/`,
    port: chosen,
    get viewers() { return clients.size; },
    /** Push the latest data to every open page. */
    push(data, event = 'update') {
      clients.forEach((res) => send(res, event, data));
    },
    async close() {
      clearInterval(heartbeat);
      clients.forEach((res) => res.end());
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* the page went away */ }
}

module.exports = { startLiveServer };
