const http = require('http');
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

http.createServer((req,res)=>{
  const url = new URL(req.url,`http://localhost:${PORT}`);
  let pn = url.pathname;

  const m = pn.match(/^\/([^/]+)\/manifest\.json(?:\?.*)?$/);
  if(m){
    const cfgKey = m[1];
    const host = req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const base = `${proto}://${host}`;
    
    const manifest = {
      id: 'org.stremio.Torrio',
      version: '1.0',
      name: 'Torrio',
      description: 'Stremio addon Torrio (Configured)',
      types: ['movie','series','anime'],
      catalogs: [],
      resources: ['stream'],
      logo: `https://torz.sapu.tr/icon.png`,
      idPrefixes: ['tt','kitsu'],
      behaviorHints: { configurable:true, configurationRequired:false },
      configurationURL: `${base}/${cfgKey}/configure`
    };
    
    res.writeHead(200,{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, no-cache, must-revalidate, private',
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type'
    });
    res.end(JSON.stringify(manifest));
    return;
  }

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
    res.writeHead(200,{
      'Content-Type':ct,
      'Cache-Control': nc ? 'no-store, no-cache, must-revalidate, private' : 'public, max-age=3600, immutable'
    });
    res.end(data);
  });
}).listen(PORT,'0.0.0.0',()=>console.log(`✅ Torrio on port ${PORT}`));
