const http = require('http');
const fs = require('fs');
const path = require('path');

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

// Decode URL-safe base64 config
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

// ✅ Extract infohash from any torrent link format
function extractInfoHash(url) {
  try {
    if (!url) return null;
    
    // Magnet link: magnet:?xt=urn:btih:ABC123...
    if (url.startsWith('magnet:')) {
      const match = url.match(/xt=urn:btih:([a-zA-Z0-9]{40})/i);
      if (match) return match[1].toLowerCase();
    }
    
    // TorrServer play URL: /play/ABC123/...
    const playMatch = url.match(/\/play\/([a-zA-Z0-9]{40})\//i);
    if (playMatch) return playMatch[1].toLowerCase();
    
    // Infohash as hostname: abc123...:8090
    const hostMatch = url.match(/^(?:https?:\/\/)?([a-zA-Z0-9]{40})[\/:\.]/i);
    if (hostMatch) return hostMatch[1].toLowerCase();
    
    // Prowlarr downloadUrl link param (base64 encoded infohash)
    if (url.includes('/download?') && url.includes('link=')) {
      try {
        const urlObj = new URL(url);
        const linkParam = urlObj.searchParams.get('link');
        if (linkParam) {
          const decoded = Buffer.from(linkParam, 'base64').toString('utf-8');
          if (/^[a-fA-F0-9]{40}$/.test(decoded)) {
            return decoded.toLowerCase();
          }
        }
      } catch (e) {
        // Ignore decode errors
      }
    }
    
    return null;
  } catch (e) {
    console.error('[Torrio] InfoHash extraction error:', e.message);
    return null;
  }
}

// ✅ Convert any torrent link to TorrServer play URL
function toTorrServerPlayUrl(torrHost, streamObj, filename = 'video.mp4') {
  try {
    if (!torrHost) return streamObj.url;
    let host = torrHost.trim().replace(/\/$/, '');
    
    // ✅ PRIORITAS: Jika stream punya _infoHash valid (dari Prowlarr), pakai langsung
    if (streamObj._infoHash && /^[a-fA-F0-9]{40}$/.test(streamObj._infoHash)) {
      return `${host}/play/${streamObj._infoHash}/${filename}`;
    }
    
    const url = streamObj.url;
    if (!url) return streamObj.url;
    
    // Jika sudah TorrServer play URL, return as-is
    if (url.includes('/play/') && url.startsWith(host)) return url;
    
    // Fallback: extract infohash dari URL
    if (url.startsWith('magnet:')) {
      const match = url.match(/xt=urn:btih:([a-zA-Z0-9]{40})/i);
      if (match) {
        return `${host}/play/${match[1].toLowerCase()}/${filename}`;
      }
    }
    
    // Jika tidak bisa extract, return original URL
    console.log(`[Torrio] Could not extract infohash, passing URL as-is: ${url.slice(0, 80)}...`);
    return url;
    
  } catch (e) {
    console.error('[Torrio] TorrServer URL conversion error:', e.message);
    return streamObj.url;
  }
}

// ✅ Fetch from TorrServer with HTTP Basic Auth
async function fetchTorrServer(torrHost, torrUsername, torrPassword, type, id) {
  try {
    let host = torrHost.trim().replace(/\/$/, '');
    const streamUrl = `${host}/stremio/${type}/${id}`;
    console.log(`[Torrio] Fetching TorrServer: ${streamUrl}`);
    
    const headers = { 'User-Agent': 'Torrio/1.0', 'Accept': 'application/json' };
    
    // HTTP Basic Auth (RFC 7617)
    if (torrUsername && torrPassword) {
      const credentials = Buffer.from(`${torrUsername}:${torrPassword}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
      console.log('[Torrio] Using HTTP Basic Auth for TorrServer');
    }
    
    const res = await fetch(streamUrl, {
      headers: headers,
      signal: AbortSignal.timeout(20000)
    });
    
    if (!res.ok) {
      console.error(`[Torrio] TorrServer HTTP ${res.status}`);
      if (res.status === 401) {
        console.error('[Torrio] TorrServer auth failed - check username/password');
      }
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const streams = data.streams || [];
    console.log(`[Torrio] TorrServer found ${streams.length} streams`);
    return streams;
  } catch (err) {
    console.error(`[Torrio] TorrServer failed: ${err.message}`);
    return [];
  }
}

// Detect provider type from URL
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

// Fetch from Stremio addons (Torrentio, MediaFusion, Comet, Zmb)
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
    const apiKey = urlObj.searchParams.get('apikey') || urlObj.searchParams.get('apiKey') || '';
    const isProwlarrNative = urlObj.pathname.includes('/api/v1/search');
    
    let searchUrl = `${urlObj.origin}${urlObj.pathname}?`;
    const params = new URLSearchParams();
    
    // Prowlarr Native API v1 uses 'type', Torznab uses 't'
    if (isProwlarrNative) {
      console.log('[Torrio] Using Prowlarr Native API v1');
      if (type === 'movie') params.set('type', 'movie');
      else if (type === 'series') params.set('type', 'tv');
      else params.set('type', 'search');
    } else {
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
    
    // Handle both array flat and {Results: [...]} formats
    const results = Array.isArray(data) ? data : (data.Results && Array.isArray(data.Results) ? data.Results : []);
    console.log(`[Torrio] Processing ${results.length} results`);
    
    results.forEach(item => {
      // ✅ PRIORITAS: Gunakan InfoHash field dari Prowlarr (jika ada)
      let magnetOrLink = null;
      let infoHash = null;
      
      // Priority 1: InfoHash field (40-char hex) - PALING RELIABLE
      if (item.InfoHash && typeof item.InfoHash === 'string' && /^[a-fA-F0-9]{40}$/.test(item.InfoHash)) {
        infoHash = item.InfoHash.toLowerCase();
        magnetOrLink = `magnet:?xt=urn:btih:${infoHash}`;
        console.log(`[Torrio] Using InfoHash field: ${infoHash}`);
      }
      // Priority 2: MagnetUri/MagnetURI
      else if (item.MagnetUri || item.MagnetURI) {
        magnetOrLink = item.MagnetUri || item.MagnetURI;
        // Try extract infohash from magnet for fallback
        const match = magnetOrLink.match(/xt=urn:btih:([a-zA-Z0-9]{40})/i);
        if (match) infoHash = match[1].toLowerCase();
      }
      // Priority 3: Link/Guid
      else if (item.Link || item.Guid) {
        magnetOrLink = item.Link || item.Guid;
      }
      // Priority 4: downloadUrl (fallback - pass as-is)
      else if (item.downloadUrl) {
        magnetOrLink = item.downloadUrl;
        // Try extract from downloadUrl link param (optional)
        try {
          const dlUrl = new URL(item.downloadUrl);
          const linkParam = dlUrl.searchParams.get('link');
          if (linkParam) {
            const decoded = Buffer.from(linkParam, 'base64').toString('utf-8');
            if (/^[a-fA-F0-9]{40}$/.test(decoded)) {
              infoHash = decoded.toLowerCase();
            }
          }
        } catch (e) { /* ignore */ }
      }
      
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
          size: item.Size || item.size || 0,
          _infoHash: infoHash // ✅ ALWAYS include for TorrServer wrapping
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

// Fetch from Jacred
async function fetchJacred(jacredUrl, type, id) {
  try {
    let url = jacredUrl.trim().replace(/\/$/, '');
    const imdbMatch = id.match(/(tt\d+)/);
    if (!imdbMatch) return [];
    
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

// Fetch from Peerflix
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

// Main fetch dispatcher
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

// Apply filters - flexible & forgiving
function applyFilters(streams, filters, applyGlobalFilter = true) {
  if (!streams || !Array.isArray(streams)) return streams;
  if (!applyGlobalFilter) return streams;
  
  let filtered = [...streams];
  
  // Resolution filter
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
  
  // Quality filter
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
  
  // HDR filter
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
          if (h.toLowerCase() === 'sdr') return true;
          const keywords = hMap[h.toLowerCase()] || [h.toLowerCase()];
          return keywords.some(k => t.includes(k));
        });
      });
    }
  }
  
  // Language filter - keep stream if no language info
  if (filters?.language?.length) {
    const allLangs = ['english', 'indonesian', 'vietnamese', 'chinese', 'japanese', 'korean', 'french', 'german', 'spanish', 'italian', 'portuguese', 'russian', 'hindi', 'thai', 'arabic', 'turkish', 'polish', 'dutch', 'swedish', 'danish', 'norwegian', 'finnish', 'greek', 'czech', 'hungarian', 'romanian', 'hebrew', 'malay', 'tagalog', 'ukrainian', 'multi'];
    filtered = filtered.filter(s => {
      const t = ((s.title || '') + (s.name || '')).toLowerCase();
      const hasLangKeyword = filters.language.some(l => t.includes(l.toLowerCase()));
      const hasAnyLang = allLangs.some(lang => t.includes(lang));
      return hasLangKeyword || !hasAnyLang;
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

// HTTP Server
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pn = url.pathname;
  
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
      id: 'org.stremio.Torrio',
      version: '1.0',
      name: 'Torrio',
      description: 'Stremio addon Torrio (Configured)',
      types: ['movie', 'series', 'anime'],
      catalogs: [],
      resources: ['stream'],
      logo: `https://torz.sapu.tr/icon.png`,
      idPrefixes: ['tt', 'kitsu'],
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
    
    const torrHost = config.jacktorr_host || '';
    const torrUsername = config.jacktorr_username || '';
    const torrPassword = config.jacktorr_password || '';
    
    const upstreamUrls = (config.upstream_url || '').split('\n').filter(u => u.trim());
    const upstreamFilters = config.upstream_filters || [];
    const upstreamDirect = config.upstream_direct || [];
    
    if (upstreamUrls.length === 0) upstreamUrls.push('https://torrentio.strem.fun');
    const filters = config.filters || {};
    const maxStreams = config.max_streams || 20;
    
    try {
      let allStreams = [];
      
      // ✅ Fetch from TorrServer if configured
      if (torrHost) {
        console.log('[Torrio] TorrServer configured, fetching from TorrServer...');
        const torrStreams = await fetchTorrServer(torrHost, torrUsername, torrPassword, type, id);
        // TorrServer already returns play URLs, no wrapping needed
        allStreams.push(...torrStreams);
      }
      
      // ✅ Fetch from upstream URLs with per-URL settings
      for (let i = 0; i < upstreamUrls.length; i++) {
        const upstreamUrl = upstreamUrls[i];
        const applyFilter = upstreamFilters[i] !== false; // Default true
        const useDirect = upstreamDirect[i] === true; // Default false
        
        console.log(`[Torrio] Fetching upstream ${i+1}: ${upstreamUrl}`);
        console.log(`[Torrio] Apply filter: ${applyFilter}, Direct: ${useDirect}, TorrWrap: ${!!torrHost && !useDirect}`);
        
        try {
          const streams = await fetchFromUpstream(upstreamUrl, type, id);
          const filteredStreams = applyFilters(streams, filters, applyFilter);
          
          // ✅ Wrap ALL upstream streams with TorrServer play URL if enabled and not direct
          if (torrHost && !useDirect) {
            filteredStreams.forEach(s => {
              if (s.url) {
                const originalUrl = s.url;
                s.url = toTorrServerPlayUrl(torrHost, s);
                if (s.url !== originalUrl) {
                  console.log(`[Torrio] Wrapped: ${originalUrl.slice(0, 60)}... → ${s.url.slice(0, 60)}...`);
                }
              }
            });
          }
          
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
      
      // Debug: log sample URL format
      if (finalStreams.length > 0) {
        console.log(`[Torrio] Sample URL: ${finalStreams[0].url?.slice(0, 100)}...`);
      }
      
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

