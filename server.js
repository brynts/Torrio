// server.js - Torrio: Static + Manifest + Stream Proxy to TorrServer
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 80;
const MIME = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'
};

function safeAtob(str) {
  try {
    let b64 = str.replace(/-/g,'+').replace(/_/g,'/');
    while(b64.length%4) b64+='=';
    const dec = Buffer.from(b64,'base64').toString('utf-8');
    return decodeURIComponent(dec.split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  } catch(e){ return null; }
}

// Proxy request to TorrServer
function proxyToTorrServer(req, res, torrHost, torrPass, streamPath, config) {
  const isHttps = torrHost.startsWith('https://');
  const lib = isHttps ? https : http;
  const torrUrl = new URL(streamPath, torrHost);
  
  const options = {
    hostname: torrUrl.hostname,
    port: torrUrl.port || (isHttps ? 443 : 80),
    path: torrUrl.pathname + torrUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Torrio/1.0',
      'Accept': 'application/json'
    }
  };
  
  // Add basic auth if password exists
  if (torrPass) {
    options.auth = `:${torrPass}`;
  }
  
  const proxyReq = lib.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        // Apply upstream filters if enabled
        if (config?.filters && config.upstream_filters?.[0]) {
          if (parsed.streams && Array.isArray(parsed.streams)) {
            // Apply resolution filter
            if (config.filters.resolution?.length) {
              parsed.streams = parsed.streams.filter(s => {
                const title = (s.title + s.name).toLowerCase();
                return config.filters.resolution.some(r => title.includes(r.toLowerCase()));
              });
            }
            // Apply quality filter
            if (config.filters.quality?.length) {
              parsed.streams = parsed.streams.filter(s => {
                const title = (s.title + s.name).toLowerCase();
                const qmap = { bluray: ['bluray','bdrip','remux'], webdl: ['webdl','webrip'], hdtv: ['hdtv'], dvd: ['dvdrip'], cam: ['cam','ts','scr'] };
                return config.filters.quality.some(q => qmap[q]?.some(k => title.includes(k)));
              });
            }
            // Apply HDR filter
            if (config.filters.hdr?.length && !config.filters.hdr.includes('sdr')) {
              parsed.streams = parsed.streams.filter(s => {
                const title = (s.title + s.name).toLowerCase();
                const hmap = { dolbyvision: ['dolby vision','dv'], hdr10plus: ['hdr10+'], hdr10: ['hdr10'], hdr: ['hdr'] };
                return config.filters.hdr.some(h => hmap[h]?.some(k => title.includes(k)));
              });
            }
            // Apply language filter
            if (config.filters.language?.length) {
              parsed.streams = parsed.streams.filter(s => {
                const title = (s.title + s.name).toLowerCase();
                return config.filters.language.some(lang => title.includes(lang.toLowerCase()));
              });
            }
            // Apply 3D filter
            if (config.filters.hide3d) {
              parsed.streams = parsed.streams.filter(s => !(s.title + s.name).toLowerCase().includes('3d'));
            }
            // Sort
            if (config.filters.sort_by?.[0] === 'seeders') {
              parsed.streams.sort((a,b) => (b.seeders||0) - (a.seeders||0));
            } else if (config.filters.sort_by?.[0] === 'resolution') {
              const resOrder = { '4k':4, '1440p':3, '1080p':2, '720p':1, '576p':0, '480p':0, '360p':0 };
              parsed.streams.sort((a,b) => {
                const ra = Object.keys(resOrder).find(r => (a.title+a.name).toLowerCase().includes(r)) || 'other';
                const rb = Object.keys(resOrder).find(r => (b.title+b.name).toLowerCase().includes(r)) || 'other';
                return (resOrder[rb]||0) - (resOrder[ra]||0);
              });
            }
            // Limit max streams
            if (config.max_streams) {
              parsed.streams = parsed.streams.slice(0, config.max_streams);
            }
          }
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(parsed));
      } catch(e) {
        // If parse fails, return raw
        res.writeHead(proxyRes.statusCode, { 'Content-Type': proxyRes.headers['content-type'] || 'application/json' });
        res.end(data);
      }
    });
  });
  
  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ streams: [{ name: `[Torrio] Error: ${err.message}` }] }));
  });
  
  proxyReq.end();
}

http.createServer((req,res)=>{
  const url = new URL(req.url,`http://localhost:${PORT}`);
  let pn = url.pathname;

  // 🎯 MANIFEST.JSON
  const m = pn.match(/^\/([^/]+)\/manifest\.json(?:\?.*)?$/);
  if(m){
    const cfgKey = m[1];
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const base = `${proto}://${host}`;
    const manifest = {
      id: 'org.stremio.Torrio', version: '1.0', name: 'Torrio',
      description: 'Stremio addon Torrio (Configured)',
      types: ['movie','series','anime'], catalogs: [], resources: ['stream'],
      logo: `https://torz.sapu.tr/icon.png`, idPrefixes: ['tt','kitsu'],
      behaviorHints: { configurable:true, configurationRequired:false },
      configurationURL: `${base}/${cfgKey}/configure`
    };
    res.writeHead(200,{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, no-cache, must-revalidate, private', 'Access-Control-Allow-Origin':'*' });
    res.end(JSON.stringify(manifest));
    return;
  }

  // 🎯 STREAM HANDLER - Proxy to TorrServer
  const streamMatch = pn.match(/^\/([^/]+)\/stream\/(movie|series|anime)\/([^\/]+\.json)(?:\?.*)?$/);
  if(streamMatch){
    const cfgKey = streamMatch[1];
    const type = streamMatch[2];
    const id = streamMatch[3]; // e.g. tt1234567.json or tt1234567:1:1.json
    const configJson = safeAtob(cfgKey);
    const config = configJson ? JSON.parse(configJson) : {};
    
    const torrHost = config.jacktorr_host || 'http://127.0.0.1:8090';
    const torrPass = config.jacktorr_password || '';
    
    // Build stream path for TorrServer (Jacktorr API)
    const streamPath = `/stremio/${type}/${id}`;
    
    proxyToTorrServer(req, res, torrHost, torrPass, streamPath, config);
    return;
  }

  // 📦 SERVE STATIC FILES
  if(pn==='/'||pn==='/index.html') pn='/index.html';
  let fp = path.join(__dirname,pn);
  const root = path.resolve(__dirname);
  if(!fp.startsWith(root)){ res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(fp).toLowerCase();
  const ct = MIME[ext]||'application/octet-stream';
  fs.readFile(fp,(err,data)=>{
    if(err){
      if(err.code==='ENOENT'&&!ext){
        fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{
          if(e){ res.writeHead(500); res.end('Error'); return; }
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
          res.end(d);
        });
      } else { res.writeHead(404); res.end('Not Found'); }
      return;
    }
    const nc = ['.html','.js','.css'].includes(ext);
    res.writeHead(200,{ 'Content-Type':ct, 'Cache-Control': nc ? 'no-store, no-cache, must-revalidate, private' : 'public, max-age=3600, immutable' });
    res.end(data);
  });
}).listen(PORT,'0.0.0.0',()=>console.log(`✅ Torrio on port ${PORT}`));
