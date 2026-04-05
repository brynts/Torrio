const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 80;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function safeAtob(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const dec = Buffer.from(b64, 'base64').toString('utf-8');
    return decodeURIComponent(dec.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  } catch (e) { return null; }
}

async function fetchUpstreamStreams(upstreamUrl, type, id) {
  try {
    let url = upstreamUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    let streamUrl = url.replace(/\/manifest\.json(\?.*)?$/, '');
    streamUrl = streamUrl.replace(/\/$/, '');
    streamUrl += `/stream/${type}/${id}`;
    console.log(`[Torrio] Fetching: ${streamUrl}`);
    const res = await fetch(streamUrl, {
      headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.streams || [];
  } catch (err) {
    console.error(`[Torrio] Upstream failed: ${err.message}`);
    return [];
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pn = url.pathname;  // ✅ FIX: Pakai let, bukan const

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // 🎯 MANIFEST.JSON
  const mMatch = pn.match(/^\/([^/]+)\/manifest\.json$/);
  if (mMatch) {
    const cfgKey = mMatch[1];
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base = `${proto}://${host}`;
    const manifest = {
      id: 'org.stremio.Torrio', version: '1.0', name: 'Torrio',
      description: 'Stremio addon Torrio (Configured)',
      types: ['movie', 'series', 'anime'], catalogs: [], resources: ['stream'],
      logo: `https://torz.sapu.tr/icon.png`, idPrefixes: ['tt', 'kitsu'],
      behaviorHints: { configurable: true, configurationRequired: false },
      configurationURL: `${base}/${cfgKey}/configure`
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(manifest));
  }

  // 🎯 STREAM REQUEST
  const sMatch = pn.match(/^\/([^/]+)\/stream\/(movie|series|anime)\/([^/]+\.json)$/);
  if (sMatch) {
    const cfgKey = sMatch[1];
    const type = sMatch[2];
    const id = sMatch[3];
    const configJson = safeAtob(cfgKey);
    const config = configJson ? JSON.parse(configJson) : {};
    const upstreamUrls = (config.upstream_url || '').split('\n').filter(u => u.trim());
    if (upstreamUrls.length === 0) upstreamUrls.push('https://torrentio.strem.fun');

    try {
      const results = await Promise.allSettled(
        upstreamUrls.map(u => fetchUpstreamStreams(u, type, id))
      );
      let allStreams = [];
      results.forEach(r => { if (r.status === 'fulfilled') allStreams.push(...r.value); });
      const max = config.max_streams || 20;
      const finalStreams = allStreams.slice(0, max);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ streams: finalStreams }));
    } catch (err) {
      console.error('[Torrio] Stream error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ streams: [{ name: `[Torrio Error] ${err.message}` }] }));
    }
  }

  // 📦 SERVE STATIC FILES
  if (pn === '/' || pn === '/index.html') pn = '/index.html';
  let fp = path.join(__dirname, pn);
  const root = path.resolve(__dirname);
  if (!fp.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  const ext = path.extname(fp).toLowerCase();
  const ct = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(fp, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) { res.writeHead(500); return res.end('Server Error'); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(d);
        });
      } else { res.writeHead(404); res.end('Not Found'); }
      return;
    }
    const nc = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': nc ? 'no-store' : 'public, max-age=3600' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`✅ Torrio running on port ${PORT}`));
