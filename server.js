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

function detectProvider(url) {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('torrentio.strem.fun')) return 'torrentio';
  if (u.includes('mediafusion')) return 'mediafusion';
  if (u.includes('comet') && !u.includes('comet.elfhosted.com/manifest')) return 'comet';
  if (u.includes('zmb') && u.includes('manifest.json')) return 'zmb';
  if (u.includes('jacred') || u.includes('maxvol.pro')) return 'jacred';
  if (u.includes('peerflix')) return 'peerflix';
  if (u.includes('api/v') && (u.includes('torznab') || u.includes('search') || u.includes('indexers') || u.includes('apikey'))) return 'torznab';
  return 'stremio-addon';
}

async function fetchStremioAddon(upstreamUrl, type, id) {
  try {
    let url = upstreamUrl.trim().replace(/\/manifest\.json(\?.*)?$/, '').replace(/\/configure(\?.*)?$/, '').replace(/\/$/, '');
    url += `/stream/${type}/${id}`;
    console.log(`[Torrio] Fetching Stremio addon: ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.error(`[Torrio] Stremio addon HTTP ${res.status}`); throw new Error(`HTTP ${res.status}`); }
    const data = await res.json();
    const streams = data.streams || [];
    console.log(`[Torrio] Stremio addon found ${streams.length} streams`);
    return streams;
  } catch (err) { console.error(`[Torrio] Stremio addon failed: ${err.message}`); return []; }
}

async function fetchTorznab(torznabUrl, type, id) {
  try {
    const urlObj = new URL(torznabUrl.trim());
    const apiKey = urlObj.searchParams.get('apikey') || urlObj.searchParams.get('apiKey') || '';
    const isProwlarrNative = urlObj.pathname.includes('/api/v1/search');
    
    let searchUrl = `${urlObj.origin}${urlObj.pathname}?`;
    const params = new URLSearchParams();
    
    // ✅ PROWLARR NATIVE API v1: pakai 'type', bukan 't'
    if (isProwlarrNative) {
      console.log('[Torrio] Using Prowlarr Native API v1');
      if (type === 'movie') params.set('type', 'movie');
      else if (type === 'series') params.set('type', 'tv');
      else params.set('type', 'search');
    } else {
      // ✅ TORZNAB API: pakai 't'
      console.log('[Torrio] Using Torznab API');
      if (type === 'movie') params.set('t', 'movie');
      else if (type === 'series') params.set('t', 'tvsearch');
      else params.set('t', 'search');
    }
    
    const imdbMatch = id.match(/(tt\d+)/);
    if (imdbMatch) params.set('imdbid', imdbMatch[1]);
    const query = id.replace('.json', '');
    if (query) params.set('q', query);
    if (apiKey) params.set('apikey', apiKey);
    params.set('limit', '100');
    
    searchUrl += params.toString();
    console.log(`[Torrio] Fetching: ${searchUrl}`);
    
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json, application/xml' },
      signal: AbortSignal.timeout(20000)
    });
    
    if (!res.ok) {
      console.error(`[Torrio] Torznab HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const streams = [];
    
    // ✅ PROWLARR NATIVE: response adalah ARRAY FLAT, bukan object {Results: [...]}
    const results = Array.isArray(data) ? data : (data.Results && Array.isArray(data.Results) ? data.Results : []);
    console.log(`[Torrio] Processing ${results.length} results`);
    
    results.forEach(item => {
      const magnetOrLink = item.MagnetUri || item.MagnetURI || item.Link || item.Guid || item.downloadUrl;
      if (magnetOrLink) {
        const size = item.Size ? (item.Size / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '';
        const seeders = item.Seeders || item.seeders || 0;
        const peers = item.Peers || item.Leechers || item.peers || 0;
        const title = item.Title || item.title || 'Unknown';
        streams.push({
          name: `Prowlarr\n${size}`,
          title: `${title}\n👥 ${seeders} | 🔽 ${peers}`,
          url: magnetOrLink,
          seeders: seeders,
          size: item.Size || item.size || 0
        });
      }
    });
    
    console.log(`[Torrio] Torznab found ${streams.length} streams`);
    return streams;
  } catch (err) {
    console.error(`[Torrio] Torznab failed: ${err.message}`);
    return [];
  }
}

async function fetchJacred(jacredUrl, type, id) {
  try {
    let url = jacredUrl.trim().replace(/\/$/, '');
    const imdbMatch = id.match(/(tt\d+)/);
    if (!imdbMatch) return [];
    url += `/api/search?imdb=${imdbMatch[1]}`;
    console.log(`[Torrio] Fetching Jacred: ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) });
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
  } catch (err) { console.error(`[Torrio] Jacred failed: ${err.message}`); return []; }
}

async function fetchPeerflix(peerflixUrl, type, id) {
  try {
    let url = peerflixUrl.trim().replace(/\/manifest\.json(\?.*)?$/, '').replace(/\/$/, '');
    url += `/stream/${type}/${id}`;
    console.log(`[Torrio] Fetching Peerflix: ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const streams = data.streams || [];
    console.log(`[Torrio] Peerflix found ${streams.length} streams`);
    return streams;
  } catch (err) { console.error(`[Torrio] Peerflix failed: ${err.message}`); return []; }
}

async function fetchFromUpstream(upstreamUrl, type, id) {
  const provider = detectProvider(upstreamUrl);
  console.log(`[Torrio] Provider detected: ${provider}`);
  switch (provider) {
    case 'torznab': return await fetchTorznab(upstreamUrl, type, id);
    case 'jacred': return await fetchJacred(upstreamUrl, type, id);
    case 'peerflix': return await fetchPeerflix(upstreamUrl, type, id);
    default: return await fetchStremioAddon(upstreamUrl, type, id);
  }
}

// ✅ APPLY FILTERS - FLEXIBLE & SMART
function applyFilters(streams, filters, applyGlobalFilter = true) {
  if (!streams || !Array.isArray(streams)) return streams;
  if (!applyGlobalFilter) return streams; // Skip if per-URL flag is false
  
  let filtered = [...streams];
  
  // Resolution - flexible mapping
  if (filters?.resolution?.length) {
    const resMap = {
      '4k': ['4k', '2160p', 'uhd', '3840'],
      '1440p': ['1440p', '2k', '2560'],
      '1080p': ['1080p', 'fhd', '1920', '1920x1080', 'fullhd'],
      '720p': ['720p', 'hd', '1280', '1280x720'],
      '576p': ['576p', 'pal', '720x576'],
      '480p': ['480p', 'sd', '854x480', '640x480', '720x480', 'ntsc'],
      '360p': ['360p', '640x360'],
      'other': ['other', 'unknown']
    };
    filtered = filtered.filter(s => {
      const t = ((s.title || '') + (s.name || '')).toLowerCase();
      return filters.resolution.some(r => {
        const keywords = resMap[r.toLowerCase()] || [r.toLowerCase()];
        return keywords.some(k => t.includes(k));
      });
    });
  }
  
  // Quality - flexible mapping
  if (filters?.quality?.length) {
    const qMap = {
      bluray: ['bluray', 'bdrip', 'remux', 'bdremux', 'blu-ray', 'brrip'],
      webdl: ['webdl', 'webrip', 'web-dl', 'amzn', 'nf', 'dsnp', 'hulu', 'disney', 'apple', 'atvp'],
      hdtv: ['hdtv', 'tvrip', 'dsr'],
      dvd: ['dvdrip', 'dvd', 'r5', 'scr', 'screener', 'dvdscr'],
      cam: ['cam', 'ts', 'tc', 'camsrip', 'telecine', 'hdcam']
    };
    filtered = filtered.filter(s => {
      const t = ((s.title || '') + (s.name || '')).toLowerCase();
      return filters.quality.some(q => {
        const keywords = qMap[q.toLowerCase()] || [q.toLowerCase()];
        return keywords.some(k => t.includes(k));
      });
    });
  }
  
  // HDR - handle SDR properly
  if (filters?.hdr?.length) {
    const wantsHdr = filters.hdr.some(h => h.toLowerCase() !== 'sdr');
    if (wantsHdr) {
      const hMap = {
        dolbyvision: ['dolby vision', 'dv ', 'dv.', 'dolbyvision'],
        hdr10plus: ['hdr10+', 'hdr10plus'],
        hdr10: ['hdr10'],
        hdr: ['hdr'],
        sdr: ['sdr']
      };
      filtered = filtered.filter(s => {
        const t = ((s.title || '') + (s.name || '')).toLowerCase();
        return filters.hdr.some(h => {
          if (h.toLowerCase() === 'sdr') return true; // SDR = show all
          const keywords = hMap[h.toLowerCase()] || [h.toLowerCase()];
          return keywords.some(k => t.includes(k));
        });
      });
    }
  }
  
  // Language - ONLY filter if stream HAS language info
  if (filters?.language?.length) {
    const allLangs = ['english', 'indonesian', 'vietnamese', 'chinese', 'japanese', 'korean', 'french', 'german', 'spanish', 'italian', 'portuguese', 'russian', 'hindi', 'thai', 'arabic', 'turkish', 'polish', 'dutch', 'swedish', 'danish', 'norwegian', 'finnish', 'greek', 'czech', 'hungarian', 'romanian', 'hebrew', 'malay', 'tagalog', 'ukrainian', 'multi'];
    filtered = filtered.filter(s => {
      const t = ((s.title || '') + (s.name || '')).toLowerCase();
      const hasLangKeyword = filters.language.some(l => t.includes(l.toLowerCase()));
      const hasAnyLang = allLangs.some(lang => t.includes(lang));
      return hasLangKeyword || !hasAnyLang; // Keep if matches OR has no language info
    });
  }
  
  // 3D filter
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
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  
  // MANIFEST
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
  
  // STREAM REQUEST
  const sMatch = pn.match(/^\/([^/]+)\/stream\/(movie|series|anime)\/([^/]+\.json)$/);
  if (sMatch) {
    const cfgKey = sMatch[1];
    const type = sMatch[2];
    const id = sMatch[3];
    const configJson = safeAtob(cfgKey);
    const config = configJson ? JSON.parse(configJson) : {};
    
    const upstreamUrls = (config.upstream_url || '').split('\n').filter(u => u.trim());
    const upstreamFilters = config.upstream_filters || []; // ✅ PER-URL FILTER FLAGS
    const upstreamDirect = config.upstream_direct || [];
    
    if (upstreamUrls.length === 0) upstreamUrls.push('https://torrentio.strem.fun');
    const filters = config.filters || {};
    const maxStreams = config.max_streams || 20;
    
    try {
      let allStreams = [];
      
      // ✅ FETCH EACH UPSTREAM WITH ITS OWN FILTER SETTING
      for (let i = 0; i < upstreamUrls.length; i++) {
        const upstreamUrl = upstreamUrls[i];
        const applyFilter = upstreamFilters[i] !== false; // Default true
        const useDirect = upstreamDirect[i] === true;
        
        console.log(`[Torrio] Fetching upstream ${i+1}: ${upstreamUrl}`);
        console.log(`[Torrio] Apply global filter: ${applyFilter}, Direct: ${useDirect}`);
        
        try {
          const streams = await fetchFromUpstream(upstreamUrl, type, id);
          const filteredStreams = applyFilters(streams, filters, applyFilter); // ✅ PASS applyGlobalFilter
          const limitedStreams = useDirect ? filteredStreams : filteredStreams.slice(0, maxStreams);
          allStreams.push(...limitedStreams);
          console.log(`[Torrio] Upstream ${i+1}: ${streams.length} → ${limitedStreams.length} streams`);
        } catch (err) {
          console.error(`[Torrio] Upstream ${i+1} failed:`, err.message);
        }
      }
      
      // Final sort & limit
      if (filters?.sort_by?.[0] === 'seeders') {
        allStreams.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
      } else if (filters?.sort_by?.[0] === 'resolution') {
        const resOrder = { '4k':4, '2160p':4, '1440p':3, '1080p':2, '720p':1, '576p':0, '480p':0, '360p':0 };
        allStreams.sort((a, b) => {
          const ta = ((a.title||'')+(a.name||'')).toLowerCase();
          const tb = ((b.title||'')+(b.name||'')).toLowerCase();
          const ra = Object.keys(resOrder).find(r => ta.includes(r)) || 'other';
          const rb = Object.keys(resOrder).find(r => tb.includes(r)) || 'other';
          return (resOrder[rb]||0) - (resOrder[ra]||0);
        });
      }
      
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
  
  // STATIC FILES
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
