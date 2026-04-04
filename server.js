const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 80;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function safeAtob(str) {
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    return decodeURIComponent(
      decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch (e) { return null; }
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // 🎯 MANIFEST.JSON FOR STREMIO - MUST MATCH VERCEL EXACTLY
  const manifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json(?:\?.*)?$/);
  if (manifestMatch) {
    const configKey = manifestMatch[1];
    const configJson = safeAtob(configKey);
    
    // Build manifest EXACTLY like Vercel
    const baseUrl = req.headers.host ? `https://${req.headers.host}` : '';
    const manifest = {
      id: 'org.stremio.torrio',
      version: '1',
      name: 'Torrio',
      description: 'Stremio addon TorrServer (Configured)',
      types: ['movie', 'series', 'anime'],
      catalogs: [],
      resources: ['stream'],
      logo: `${baseUrl}/static/logo.png`,
      idPrefixes: ['tt', 'kitsu'],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      },
      configurationURL: `${baseUrl}/${configKey}/configure`
    };
    
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(manifest));
    return;
  }

  if (pathname === '/' || pathname === '/index.html') pathname = '/index.html';
  let filePath = path.join(__dirname, pathname);
  const rootDir = path.resolve(__dirname);
  if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) { res.writeHead(500); res.end('Server Error'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(d);
        });
      } else { res.writeHead(404); res.end('Not Found'); }
      return;
    }
    const noCache = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': noCache ? 'no-store, no-cache, must-revalidate, private' : 'public, max-age=3600, immutable'
    });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Torrio running on port ${PORT}`);
});