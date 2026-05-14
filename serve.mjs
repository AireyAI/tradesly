import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { routeIntake } from './intake-handlers.mjs';
import { routeAdmin, checkBasicAuth } from './admin-handlers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3077;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => {
      chunks.push(c);
      // 64KB cap — intake payloads are tiny, anything larger is suspicious
      if (chunks.reduce((s, c) => s + c.length, 0) > 64 * 1024) {
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0].split('#')[0];

  // ─── Admin API routes (auth-gated) ────────────────────
  if (urlPath.startsWith('/admin/api/')) {
    try {
      const result = await routeAdmin(req, '');
      const headers = { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...(result.headers || {}) };
      res.writeHead(result.status, headers);
      return res.end(result.body);
    } catch (err) {
      console.error('[serve] admin handler threw:', err);
      return sendJSON(res, 500, { error: 'internal_error' });
    }
  }

  // ─── Admin HTML page (auth-gated) ─────────────────────
  if (urlPath.startsWith('/admin')) {
    const auth = checkBasicAuth(req.headers['authorization']);
    if (!auth.ok) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Tradesly Admin", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
        ...SECURITY_HEADERS,
      });
      return res.end('Authentication required');
    }
    // Fall through to static serving below (will hit admin/index.html or admin/*.html)
  }

  // ─── Intake API routes ───────────────────────────────
  if (urlPath.startsWith('/api/')) {
    let body = '';
    if (req.method === 'POST') {
      try {
        body = await readBody(req);
      } catch (err) {
        return sendJSON(res, err.message === 'payload_too_large' ? 413 : 400, { error: err.message });
      }
    }
    try {
      const result = await routeIntake(req, body);
      return sendJSON(res, result.status, result.body);
    } catch (err) {
      console.error('[serve] intake handler threw:', err);
      return sendJSON(res, 500, { error: 'internal_error' });
    }
  }

  // ─── Static file serving ─────────────────────────────
  let staticPath = decodeURIComponent(urlPath);
  if (staticPath === '/' || staticPath === '') staticPath = '/index.html';
  // Directory index: /admin/ → /admin/index.html
  if (staticPath.endsWith('/')) staticPath = staticPath + 'index.html';
  // Add .html extension if no extension and file exists with .html
  if (!path.extname(staticPath)) {
    const indexCandidate = path.join(__dirname, staticPath, 'index.html');
    const htmlCandidate = path.join(__dirname, staticPath + '.html');
    if (fs.existsSync(indexCandidate)) staticPath = staticPath + '/index.html';
    else if (fs.existsSync(htmlCandidate)) staticPath = staticPath + '.html';
  }

  const filePath = path.join(__dirname, staticPath);
  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try /404.html for nicer 404
      fs.readFile(path.join(__dirname, '404.html'), (e2, d2) => {
        if (e2) {
          res.writeHead(404, SECURITY_HEADERS);
          return res.end('Not found');
        }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
        return res.end(d2);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Tradesly dev server running at http://localhost:${PORT}`);
  console.log(`  Intake API:   POST /api/lead, POST /api/buyer-apply, GET /api/healthz`);
  console.log(`  Admin:        http://localhost:${PORT}/admin/ (Basic Auth — user: anything, pass: $ADMIN_PASSWORD)`);
  console.log(`  Data root:    ${process.env.TRADESLY_DATA_ROOT || '~/jarvis/agents/data/ppl'}`);
  console.log(`  Telegram:     ${process.env.TG_BOT_TOKEN ? 'configured' : 'NOT configured (alerts logged to stderr only)'}`);
  console.log(`  Admin auth:   ${process.env.ADMIN_PASSWORD ? 'password required' : 'OPEN (no ADMIN_PASSWORD set — dev only)'}`);
});
