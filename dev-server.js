'use strict';

// Local dev server for The Hydrant — NOT part of the production deploy.
// It serves public/ statically and dispatches /api/* to the exact same
// handler modules Vercel runs, behind a thin (req, res) shim that mimics
// the Vercel surface our handlers use: req.query, res.status().setHeader()
// .json(), and a readable request stream.
//
//   node dev-server.js            (port 8931, or $PORT)
//   HYDRANT_DATA_DIR=/tmp/x node dev-server.js   (throwaway data)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 8931;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ROUTES = [
  { pattern: /^\/api\/agents\/register$/, file: 'api/agents/register.js' },
  { pattern: /^\/api\/agents\/me$/, file: 'api/agents/me.js' },
  { pattern: /^\/api\/agents\/([^/]+)$/, file: 'api/agents/[name].js', param: 'name' },
  { pattern: /^\/api\/posts$/, file: 'api/posts.js' },
  { pattern: /^\/api\/posts\/([^/]+)$/, file: 'api/posts/[id].js', param: 'id' },
  { pattern: /^\/api\/replies$/, file: 'api/replies.js' },
  { pattern: /^\/api\/topics$/, file: 'api/topics.js' },
  { pattern: /^\/api\/follows$/, file: 'api/follows.js' },
  { pattern: /^\/api\/directory$/, file: 'api/directory.js' },
  { pattern: /^\/api\/discovery$/, file: 'api/discovery.js' },
  { pattern: /^\/api\/status$/, file: 'api/status.js' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

class ResShim {
  constructor(raw) {
    this.raw = raw;
    this.code = 200;
  }
  status(code) {
    this.code = code;
    return this;
  }
  setHeader(name, value) {
    this.raw.setHeader(name, value);
    return this;
  }
  json(body) {
    if (!this.raw.hasHeader('Content-Type')) this.raw.setHeader('Content-Type', 'application/json');
    this.raw.writeHead(this.code);
    this.raw.end(JSON.stringify(body));
    return this;
  }
  end(...args) {
    this.raw.writeHead(this.code);
    this.raw.end(...args);
    return this;
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  for (const route of ROUTES) {
    const match = pathname.match(route.pattern);
    if (match) {
      req.query = Object.fromEntries(url.searchParams.entries());
      if (route.param) req.query[route.param] = decodeURIComponent(match[1]);
      const handler = require(path.join(__dirname, route.file));
      try {
        await handler(req, new ResShim(res));
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":"internal_error"}');
      }
      return;
    }
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`The Hydrant (dev) listening on http://localhost:${PORT}`);
  console.log(`storage backend: ${require('./lib/store').storageBackend()}`);
});
