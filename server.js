const http = require('http');
const fs = require('fs');
const path = require('path');

// =========================================
// Configuration
// =========================================
const PORT = 80;

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
  '.ttf': 'font/ttf'
};

// =========================================
// Utility Functions
// =========================================

/**
 * Decode URL-safe base64 config string
 */
function safeAtob(str) {
  try {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const dec = Buffer.from(b64, 'base64').toString('utf-8');
    return decodeURIComponent(
      dec.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch (e) {
    return null;
  }
}

/**
 * Detect provider type from upstream URL
 */
function detectProvider(url) {
  if (!url) return 'unknown';
  const u = url.toLowerCase();

  if (u.includes('torrentio.strem.fun')) return 'torrentio';
  if (u.includes('mediafusion')) return 'mediafusion';
  if (u.includes('comet') && !u.includes('comet.elfhosted.com/manifest')) return 'comet';
  if (u.includes('zmb') && u.includes('manifest.json')) return 'zmb';
  if (u.includes('jacred') || u.includes('maxvol.pro')) return 'jacred';
  if (u.includes('peerflix')) return 'peerflix';
  if (u.includes('api/v') && (u.includes('torznab') || u.includes('search') || u.includes('indexers') || u.includes('apikey'))) {
    return 'torznab';
  }
  return 'stremio-addon';
}

// =========================================
// Provider Fetch Handlers
// =========================================

/**
 * Fetch from Stremio addons (Torrentio, MediaFusion, Comet, Zmb)
 */
async function fetchStremioAddon(upstreamUrl, type, id) {
  try {
    let url = upstreamUrl.trim()
      .replace(/\/manifest\.json(\?.*)?$/, '')
      .replace(/\/configure(\?.*)?$/, '')
      .replace(/\/$/, '');

    url += `/stream/${type}/${id}`;
    console.log(`[Torrio] Fetching Stremio addon: ${url}`);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      console.error(`[Torrio] Stremio addon HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const streams = data.streams || [];
    console.log(`[Torrio] Stremio addon found ${streams.length} streams`);
    return streams;

  } catch (err) {
    console.error(`[Torrio] Stremio addon failed: ${err.message}`);
    return [];
  }
}

// Fetch from Prowlarr/Jackett (Torznab API)
async function fetchTorznab(torznabUrl, type, id) {
  try {
    const urlObj = new URL(torznabUrl.trim());
    const apiKey =
      urlObj.searchParams.get('apikey') ||
      urlObj.searchParams.get('apiKey') ||
      '';
    const isProwlarr = urlObj.pathname.includes('/api/v1/search');

    let searchUrl = `${urlObj.origin}${urlObj.pathname}?`;
    const params = new URLSearchParams();

    // Extract IMDB ID
    const imdbMatch = id.match(/(tt\d+)/);
    const imdbId = imdbMatch ? imdbMatch[1] : '';
    const query = id.replace('.json', '').replace(imdbId, '').trim();

    if (isProwlarr) {
      // ✅ PROWLARR NATIVE API v1
      console.log('[Torrio] Using Prowlarr Native API v1');
      if (type === 'movie') params.set('type', 'movie');
      else if (type === 'series') params.set('type', 'tv');
      else params.set('type', 'search');
      if (imdbId) params.set('imdbid', imdbId);
      if (query) params.set('q', query);
      if (apiKey) params.set('apikey', apiKey);
      params.set('limit', '100');
    } else {
      // ✅ TORZNAB API
      console.log('[Torrio] Using Torznab API');
      if (type === 'movie') params.set('t', 'movie');
      else if (type === 'series') params.set('t', 'tvsearch');
      else params.set('t', 'search');
      if (imdbId) params.set('imdbid', imdbId);
      if (query) params.set('q', query);
      if (apiKey) params.set('apikey', apiKey);
      params.set('limit', '100');
      params.set('extended', '1');
    }

    searchUrl += params.toString();
    console.log(`[Torrio] Fetching: ${searchUrl}`);

    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Torrio/1.0',
        'Accept': 'application/json, application/xml, */*'
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      console.error(`[Torrio] Torznab HTTP ${res.status}: ${res.statusText}`);
      const errorText = await res.text().catch(() => '');
      console.error(`[Torrio] Error body: ${errorText.slice(0, 300)}`);
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    console.log(`[Torrio] Response Content-Type: ${contentType}`);

    let data;
    try {
      const text = await res.text();
      console.log(`[Torrio] Response length: ${text.length} bytes`);
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        data = JSON.parse(text);
        console.log('[Torrio] Parsed as JSON');
      } else {
        console.log('[Torrio] Unknown format - using empty array');
        data = [];
      }
    } catch (parseErr) {
      console.error('[Torrio] JSON parse error:', parseErr.message);
      data = [];
    }

    console.log('[Torrio] Response type:', Array.isArray(data) ? 'array' : typeof data);
    if (!Array.isArray(data) && data?.Results) {
      console.log(`[Torrio] Found Results array: ${data.Results.length} items`);
      data = data.Results;
    }

    const streams = [];
    const results = Array.isArray(data) ? data : [];
    console.log(`[Torrio] Processing ${results.length} results`);

    results.forEach((item, index) => {
      // ✅ PROWLARR V1 API FIELD MAPPING
      const magnetOrLink =
        item.downloadUrl ||
        item.MagnetUri ||
        item.MagnetURI ||
        item.torrent ||
        item.Link ||
        item.link ||
        item.guid ||
        item.Guid;

      if (magnetOrLink) {
        // Field mapping (handle both lowercase & uppercase)
        const title = item.title || item.Title || `Unknown ${index + 1}`;
        const sizeBytes = item.size || item.Size || 0;
        const size = sizeBytes ? (sizeBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '';
        const seeders = item.seeders || item.Seeders || 0;
        const indexer = item.indexer || item.Indexer || '';

        streams.push({
          name: `Prowlarr${indexer ? ` • ${indexer}` : ''}\n${size}`,
          title: `${title}\n👥 ${seeders || 'N/A'}`,
          url: magnetOrLink,
          seeders: seeders,
          size: sizeBytes,
          infoHash: item.infoHash || item.InfoHash || ''
        });
      }
    });

    console.log(`[Torrio] Converted ${streams.length} streams from Prowlarr`);
    console.log(`[Torrio] Total streams to return: ${streams.length}`);
    return streams;

  } catch (err) {
    console.error('[Torrio] Torznab failed:', err.message);
    console.error(err.stack);
    return [];
  }
}

/**
 * Fetch from Jacred
 */
async function fetchJacred(jacredUrl, type, id) {
  try {
    let url = jacredUrl.trim().replace(/\/$/, '');

    const imdbMatch = id.match(/(tt\d+)/);
    if (!imdbMatch) {
      console.log('[Torrio] Jacred needs IMDB ID');
      return [];
    }

    url += `/api/search?imdb=${imdbMatch[1]}`;
    console.log(`[Torrio] Fetching Jacred: ${url}`);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const streams = [];
    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item.magnet || item.torrent || item.download) {
          streams.push({
            name: `Jacred\n${item.quality || ''} ${item.size ? (item.size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : ''}`,
            title: `${item.title || 'Unknown'}\n👥 ${item.seeders || 0}`,
            url: item.magnet || item.torrent || item.download,
            seeders: item.seeders || 0,
            size: item.size || 0
          });
        }
      });
    }

    console.log(`[Torrio] Jacred found ${streams.length} streams`);
    return streams;

  } catch (err) {
    console.error(`[Torrio] Jacred failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch from Peerflix
 */
async function fetchPeerflix(peerflixUrl, type, id) {
  try {
    let url = peerflixUrl.trim()
      .replace(/\/manifest\.json(\?.*)?$/, '')
      .replace(/\/$/, '');

    url += `/stream/${type}/${id}`;
    console.log(`[Torrio] Fetching Peerflix: ${url}`);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const streams = data.streams || [];

    console.log(`[Torrio] Peerflix found ${streams.length} streams`);
    return streams;

  } catch (err) {
    console.error(`[Torrio] Peerflix failed: ${err.message}`);
    return [];
  }
}

// =========================================
// Main Fetch Dispatcher
// =========================================

async function fetchFromUpstream(upstreamUrl, type, id) {
  const provider = detectProvider(upstreamUrl);
  console.log(`[Torrio] Provider detected: ${provider}`);

  switch (provider) {
    case 'torznab':
      return await fetchTorznab(upstreamUrl, type, id);
    case 'jacred':
      return await fetchJacred(upstreamUrl, type, id);
    case 'peerflix':
      return await fetchPeerflix(upstreamUrl, type, id);
    case 'torrentio':
    case 'mediafusion':
    case 'comet':
    case 'zmb':
    case 'stremio-addon':
    default:
      return await fetchStremioAddon(upstreamUrl, type, id);
  }
}

// =========================================
// Filter & Sort Logic
// =========================================

function applyFilters(streams, filters) {
  if (!streams || !Array.isArray(streams)) return streams;
  let filtered = [...streams];

  // Resolution filter
  if (filters?.resolution?.length) {
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.resolution.some(r => t.toLowerCase().includes(r.toLowerCase()));
    });
  }

  // Quality filter
  if (filters?.quality?.length) {
    const qMap = {
      bluray: ['bluray', 'bdrip', 'remux', 'bdremux'],
      webdl: ['webdl', 'webrip'],
      hdtv: ['hdtv'],
      dvd: ['dvdrip', 'dvd'],
      cam: ['cam', 'ts', 'scr']
    };
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.quality.some(q => qMap[q]?.some(k => t.toLowerCase().includes(k)));
    });
  }

  // HDR filter
  if (filters?.hdr?.length && !filters.hdr.includes('sdr')) {
    const hMap = {
      dolbyvision: ['dolby vision', 'dv ', 'dv.'],
      hdr10plus: ['hdr10+'],
      hdr10: ['hdr10'],
      hdr: ['hdr']
    };
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.hdr.some(h => hMap[h]?.some(k => t.toLowerCase().includes(k)));
    });
  }

  // Language filter
  if (filters?.language?.length) {
    filtered = filtered.filter(s => {
      const t = (s.title || '') + (s.name || '');
      return filters.language.some(l => t.toLowerCase().includes(l.toLowerCase()));
    });
  }

  // 3D filter
  if (filters?.hide3d) {
    filtered = filtered.filter(s => !((s.title || '') + (s.name || '')).toLowerCase().includes('3d'));
  }

  // Sort by seeders
  if (filters?.sort_by?.[0] === 'seeders') {
    filtered.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
  }
  // Sort by resolution
  else if (filters?.sort_by?.[0] === 'resolution') {
    const resOrder = { '4k': 4, '2160p': 4, '1440p': 3, '1080p': 2, '720p': 1, '576p': 0, '480p': 0, '360p': 0 };
    filtered.sort((a, b) => {
      const ta = ((a.title || '') + (a.name || '')).toLowerCase();
      const tb = ((b.title || '') + (b.name || '')).toLowerCase();
      const ra = Object.keys(resOrder).find(r => ta.includes(r)) || 'other';
      const rb = Object.keys(resOrder).find(r => tb.includes(r)) || 'other';
      return (resOrder[rb] || 0) - (resOrder[ra] || 0);
    });
  }

  return filtered;
}

// =========================================
// HTTP Server
// =========================================

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pn = url.pathname;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 🎯 MANIFEST.JSON Handler
  const mMatch = pn.match(/^\/([^/]+)\/manifest\.json$/);
  if (mMatch) {
    const cfgKey = mMatch[1];
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base = `${proto}://${host}`;

    const manifest = {
      id: 'org.stremio.Torrio',
      version: '1.0',
      name: 'Torrio',
      description: 'Stremio addon Torrio (Configured)',
      types: ['movie', 'series', 'anime'],
      catalogs: [],
      resources: ['stream'],
      logo: `https://torz.sapu.tr/icon.png`,
      idPrefixes: ['tt', 'kitsu'],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      },
      configurationURL: `${base}/${cfgKey}/configure`
    };

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify(manifest));
  }

  // 🎯 STREAM REQUEST Handler
  const sMatch = pn.match(/^\/([^/]+)\/stream\/(movie|series|anime)\/([^/]+\.json)$/);
  if (sMatch) {
    const cfgKey = sMatch[1];
    const type = sMatch[2];
    const id = sMatch[3];
    const configJson = safeAtob(cfgKey);
    const config = configJson ? JSON.parse(configJson) : {};

    const upstreamUrls = (config.upstream_url || '').split('\n').filter(u => u.trim());
    if (upstreamUrls.length === 0) upstreamUrls.push('https://torrentio.strem.fun');

    const filters = config.filters || {};
    const maxStreams = config.max_streams || 20;

    try {
      // Fetch all upstreams in parallel
      const results = await Promise.allSettled(
        upstreamUrls.map(u => fetchFromUpstream(u, type, id))
      );

      let allStreams = [];
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          allStreams.push(...r.value);
        } else {
          console.error('[Torrio] Upstream rejected:', r.reason);
        }
      });

      // Apply filters
      allStreams = applyFilters(allStreams, filters);

      // Limit results
      const finalStreams = allStreams.slice(0, maxStreams);

      console.log(`[Torrio] Returning ${finalStreams.length} streams to Stremio`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ streams: finalStreams }));

    } catch (err) {
      console.error('[Torrio] Stream error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ streams: [{ name: `[Torrio Error] ${err.message}` }] }));
    }
  }

  // 📦 SERVE STATIC FILES Handler
  if (pn === '/' || pn === '/index.html') pn = '/index.html';
  let fp = path.join(__dirname, pn);
  const root = path.resolve(__dirname);

  if (!fp.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(fp).toLowerCase();
  const ct = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fp, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) {
            res.writeHead(500);
            return res.end('Server Error');
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(d);
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    const nc = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, {
      'Content-Type': ct,
      'Cache-Control': nc ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  });

}).listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Torrio running on port ${PORT}`);
});
