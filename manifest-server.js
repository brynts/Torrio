// manifest-server.js - Minimal HTTP server for Stremio manifest.json
const http = require('http');
const { URL } = require('url');

const PORT = 3000;

function safeAtob(str) {
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    return decodeURIComponent(
      decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch (e) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/([A-Za-z0-9_-]{10,})\/manifest\.json$/);
  
  if (match) {
    const configKey = match[1];
    const configJson = safeAtob(configKey);
    
    if (!configJson) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid config' }));
      return;
    }
    
    const manifest = {
      id: 'com.torrio.stremio',
      version: '2.5.0',
      name: 'Tor Fast',
      description: 'TorrServer + Multi-Source Aggregator for Stremio',
      resources: ['stream', 'meta'],
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'kitsu'],
      behaviorHints: { configurable: true, configurationRequired: false },
      catalogs: [],
      background: 'https://i.imgur.com/3xJYs3L.jpeg',
      logo: 'https://i.imgur.com/3xJYs3L.jpeg'
    };
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(JSON.stringify(manifest));
    return;
  }
  
  // Proxy other requests to nginx (static files)
  const options = {
    hostname: '127.0.0.1',
    port: 8080,
    path: url.pathname + url.search,
    method: req.method,
    headers: req.headers
  };
  
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  req.pipe(proxy);
  proxy.on('error', (e) => {
    console.error('Proxy error:', e);
    res.writeHead(502);
    res.end('Bad Gateway');
  });
});

server.listen(PORT, '127.0.0.1');
console.log(`Manifest server running on port ${PORT}`);
