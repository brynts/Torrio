// server.js - Torrio: Static files + Stremio manifest.json handler
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 80;

// MIME types untuk static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

// Decode base64url (URL-safe base64) seperti di client-side
function safeAtob(str) {
  try {
    // Convert base64url to standard base64
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (base64.length % 4) base64 += '=';
    // Decode
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    // Handle URI encoding for Unicode
    return decodeURIComponent(
      decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch (e) {
    console.error('Decode error:', e.message);
    return null;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // 🎯 HANDLE /manifest.json FOR STREMIO (Server-side rendering)
  // Match: /ANY_BASE64_STRING/manifest.json (lebih flexible)
  const manifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json(?:\?.*)?$/);
  
  if (manifestMatch) {
    const configKey = manifestMatch[1];
    
    // Optional: validate config (decode to check if valid)
    const configJson = safeAtob(configKey);
    
    // Return minimal valid Stremio manifest (sama seperti Vercel)
    const manifest = {
      id: 'com.torrio.stremio',
      version: '1.0',
      name: 'Torrio',
      description: 'TorrServer + Multi-Source Aggregator for Stremio',
      resources: ['stream', 'meta'],
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'kitsu'],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      },
      catalogs: [],
      background: 'https://blog.stremio.com/wp-content/uploads/2023/08/Stremio-logo-dark-background-1024x570.png',
      logo: 'https://blog.stremio.com/wp-content/uploads/2023/08/Stremio-logo-dark-background-1024x570.png'
    };
    
    // Set proper headers untuk Stremio
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    res.end(JSON.stringify(manifest));
    return; // ✅ Done - jangan serve static file
  }

  // 📦 SERVE STATIC FILES (index.html dengan inline CSS+JS)
  if (pathname === '/' || pathname === '/index.html') {
    pathname = '/index.html';
  }
  
  let filePath = path.join(__dirname, pathname);
  
  // Security: cegah directory traversal attack
  const rootDir = path.resolve(__dirname);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: jika file tidak ditemukan & bukan asset, serve index.html
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server Error');
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          });
          res.end(d);
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
      return;
    }
    
    // Cache policy: no-cache untuk HTML/JS/CSS, cache untuk assets
    const noCacheExts = ['.html', '.js', '.css'];
    const cacheControl = noCacheExts.includes(ext)
      ? 'no-store, no-cache, must-revalidate, private'
      : 'public, max-age=3600, immutable';
    
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Torrio server running on port ${PORT}`);
  console.log(`   Frontend: http://localhost/`);
  console.log(`   Manifest: http://localhost/<CONFIG>/manifest.json`);
});