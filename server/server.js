/**
 * server/server.js  — Owner: M1
 *
 * Entry point. Creates an HTTP server that:
 *   1. Serves /api/* requests via router.js
 *   2. Serves static files from public/
 *   3. Falls back to 404 for unknown paths
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { loadRoutes, dispatch } = require('./router');
const { sendError, sendJson } = require('./utils/http');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

/** MIME type map for static files */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf'
};

/**
 * Serves a file from the public/ directory.
 * Returns false if file not found (caller should 404).
 */
function serveStatic(req, res, urlPath) {
  // Normalise and prevent directory traversal
  let relPath = urlPath;
  if (relPath === '/' || relPath === '') relPath = '/index.html';

  const absPath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!absPath.startsWith(PUBLIC_DIR)) {
    // Directory traversal attempt
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return true;
  }

  // If path is a directory, look for index.html inside it
  let targetPath = absPath;
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(targetPath, 'index.html');
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return false; // Signal: not found
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  const stat = fs.statSync(targetPath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=3600'
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  fs.createReadStream(targetPath).pipe(res);
  return true;
}

async function requestHandler(req, res) {
  const rawUrl = req.url || '/';
  const parsedUrl = new URL(rawUrl, 'http://localhost');
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

  try {
    if (pathname.startsWith('/api')) {
      // Delegate to router
      await dispatch(req, res);
    } else {
      // Try to serve a static file
      const served = serveStatic(req, res, pathname);
      if (!served) {
        // SPA fallback: if no static file found for non-/api path,
        // serve index.html so client-side routing can handle it.
        // If public/index.html also missing, send a 404.
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
          const stat = fs.statSync(indexPath);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache'
          });
          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(indexPath).pipe(res);
        } else {
          sendJson(res, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Page not found' } });
        }
      }
    }
  } catch (err) {
    sendError(res, err);
  }
}

async function start() {
  // Verify DB connectivity before accepting traffic
  console.log('[server] Checking database connection…');
  try {
    await db.testConnection();
    console.log(`[server] MySQL connected to ${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}`);
  } catch (err) {
    console.error('[server] FATAL: Cannot connect to MySQL.', err.message);
    console.error('[server] Ensure MySQL is running and .env is configured correctly.');
    process.exit(1);
  }

  // Load all route modules
  loadRoutes();

  const server = http.createServer(requestHandler);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${config.PORT} is already in use.`);
    } else {
      console.error('[server] Server error:', err.message);
    }
    process.exit(1);
  });

  server.listen(config.PORT, () => {
    console.log(`[server] MakeMyTour listening on http://localhost:${config.PORT}`);
    console.log(`[server] Environment: ${config.NODE_ENV}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[server] SIGTERM received, shutting down…');
    server.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    console.log('\n[server] Interrupted, shutting down…');
    server.close(() => process.exit(0));
  });
}

start();
