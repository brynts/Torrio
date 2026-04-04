// server.js - Single-file server for Torrio (static + manifest.json)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 80;
const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject'
};

function safeAtob(str) {
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    return decodeURIComponent(decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  } catch (e) { return null; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // Handle manifest.json dynamically
  const manifestMatch = pathname.match(/^\/([A-Za-z0-9_-]{10,})\/manifest\.json$/);
  if (manifestMatch) {
    const configKey = manifestMatch[1];
    const configJson = safeAtob(configKey);
    if (!configJson) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid config' }));
      return;
    }
    const manifest = {
      id: 'com.torrio.stremio', version: '2.5.0', name: 'Tor Fast',
      description: 'TorrServer + Multi-Source Aggregator for Stremio',
      resources: ['stream', 'meta'], types: ['movie', 'series'],
      idPrefixes: ['tt', 'kitsu'],
      behaviorHints: { configurable: true, configurationRequired: false },
      catalogs: [], background: 'https://i.imgur.com/3xJYs3L.jpeg',
      logo: 'https://i.imgur.com/3xJYs3L.jpeg'
    };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(manifest));
    return;
  }

  // Serve static files
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.join(__dirname, pathname);
  
  // Prevent directory traversal
  if (!filePath.startsWith(path.join(__dirname, '/'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: if file not found, serve index.html
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) { res.writeHead(500); res.end('Server Error'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          res.end(d);
        });
      } else {
        res.writeHead(404); res.end('Not Found');
      }
      return;
    }
    const cacheControl = ['.html', '.js', '.css'].includes(ext) 
      ? 'no-store, no-cache, must-revalidate' 
      : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Torrio server running on port ${PORT}`));
