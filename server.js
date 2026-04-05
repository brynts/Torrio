const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 80;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

// Decode base64url config
function safeAtob(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const dec = Buffer.from(b64, 'base64').toString('utf-8');
    return decodeURIComponent(dec.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  } catch (e) { return null; }
}

// Fetch stream from upstream addon (Torrentio, Jackett, etc.)
function fetchUpstream(upstreamUrl, streamPath) {
  return new Promise((resolve, reject) => {
    // Clean URL: remove /manifest.json & trailing slash
    let baseUrl = upstreamUrl.replace(/\/manifest\.json\/?$/, '').replace(/\/$/, '');
    const fullUrl = `${baseUrl}/stream/${streamPath}`;
    const urlObj = new URL(fullUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from upstream')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Apply filters from config
function applyFilters(streams, filters) {
  if (!streams || !Array.isArray(streams)) return streams;
  let filtered = [...streams];

  if (filters?.resolution?.length) {
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.resolution.some(r => t.toLowerCase().includes(r.toLowerCase()));
    });
  }
  if (filters?.quality?.length) {
    const qMap = { bluray: ['bluray','bdrip','remux','bdremux'], webdl: ['webdl','webrip'], hdtv: ['hdtv'], dvd: ['dvdrip','dvd'], cam: ['cam','ts','scr'] };
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.quality.some(q => qMap[q]?.some(k => t.toLowerCase().includes(k)));
    });
  }
  if (filters?.hdr?.length && !filters.hdr.includes('sdr')) {
    const hMap = { dolbyvision: ['dolby vision','dv ','dv.'], hdr10plus: ['hdr10+'], hdr10: ['hdr10'], hdr: ['hdr'] };
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.hdr.some(h => hMap[h]?.some(k => t.toLowerCase().includes(k)));
    });
  }
  if (filters?.language?.length) {
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.language.some(l => t.toLowerCase().includes(l.toLowerCase()));
    });
  }
  if (filters?.hide3d) {
    filtered = filtered.filter(s => !((s.title || '') + (s.name || '')).toLowerCase().includes('3d'));
  }
  // Sort
  if (filters?.sort_by?.[0] === 'seeders') {
    filtered.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
  } else if (filters?.sort_by?.[0] === 'resolution') {
    const resOrder = { '4k':4, '2160p':4, '1440p':3, '1080p':2, '720p':1, '576p':0, '480p':0, '360p':0 };
    filtered.sort((a, b) => {
      const ta = ((a.title||'')+(a.name||'')).toLowerCase();
      const tb = ((b.title||'')+(b.name||'')).toLowerCase();
      const ra = Object.keys(resOrder).find(r => ta.includes(r)) || 'other';
      const rb = Object.keys(resOrder).find(r => tb.includes(r)) || 'other';
      return (resOrder[rb]||0) - (resOrder[ra]||0);
    });
  }
  return filtered;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pn = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 🎯 MANIFEST
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
    res.end(JSON.stringify(manifest));
    return;
  }

  // 🎯 STREAM REQUEST (Proxy to Upstream + Filter)
  const sMatch = pn.match(/^\/([^/]+)\/stream\/(movie|series|anime)\/([^/]+\.json)$/);
  if (sMatch) {
    const cfgKey = sMatch[1];
    const type = sMatch[2];
    const id = sMatch[3];
    const configJson = safeAtob(cfgKey);
    const config = configJson ? JSON.parse(configJson) : {};
    
    // Ambil upstream URL pertama (bisa multiline)
    const upstreamUrl = (config.upstream_url || '').split('\n')[0]?.trim() || 'https://torrentio.strem.fun';
    const filters = config.filters || {};
    const maxStreams = config.max_streams || 20;

    try {
      const upstreamRes = await fetchUpstream(upstreamUrl, `${type}/${id}`);
      let streams = upstreamRes.streams || [];
      streams = applyFilters(streams, filters);
      if (streams.length > maxStreams) streams = streams.slice(0, maxStreams);
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ streams }));
    } catch (err) {
      console.error('Stream fetch error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ streams: [{ name: `[Torrio] Error: ${err.message}`, url: '' }] }));
    }
    return;
  }

  // 🎯 CONFIGURE PAGE (load frontend with pre-filled config)
  if (pn.match(/^\/([^/]+)\/configure$/)) {
    pn = '/index.html';
  }

  // 📦 SERVE STATIC FILES
  if (pn === '/' || pn === '/index.html') pn = '/index.html';
  let fp = path.join(__dirname, pn);
  const root = path.resolve(__dirname);
  if (!fp.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext = path.extname(fp).toLowerCase();
  const ct = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fp, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) { res.writeHead(500); res.end('Error'); return; }
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
