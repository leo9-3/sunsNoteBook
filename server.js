// Intranet Notebook server — Node.js standard library only (no npm dependencies)
// Why: company intranet / offline machines often cannot reach npm registry.
// Data: one JSON file per day under data/, e.g. data/2026-11-16.json
// API:
//   GET    /api/notes              -> [{date, title, updatedAt, count}]
//   GET    /api/notes/:date       -> note or a blank template for that date
//   PUT    /api/notes/:date       -> save note {title, elements:[...]}
//   DELETE /api/notes/:date       -> delete
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const fileFor = d => path.join(DATA, d + '.json');

function send(res, code, body, type='application/json; charset=utf-8'){
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  res.writeHead(code, {'Content-Type':type,'Content-Length':buf.length,'Cache-Control':'no-store'});
  res.end(buf);
}
function readBody(req){ return new Promise((resolve,reject)=>{ let chunks=[]; let size=0; req.on('data',c=>{ size+=c.length; if(size>30*1024*1024) reject(new Error('too large')); else chunks.push(c); }); req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error',reject); }); }

const server = http.createServer(async (req,res)=>{
  try{
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if(p.startsWith('/api/notes')){
      const parts = p.split('/').filter(Boolean); // ['api','notes', date?]
      const date = parts[2];
      if(req.method==='GET' && !date){
        const list = fs.readdirSync(DATA).filter(f=>f.endsWith('.json')).map(f=>{
          try{ const n=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); return {date:n.date, title:n.title||'', updatedAt:n.updatedAt||null, count:(n.elements||[]).length}; }catch{ return null; }
        }).filter(Boolean).sort((a,b)=>b.date.localeCompare(a.date));
        return send(res,200,list);
      }
      if(date && !isDate(date)) return send(res,400,{error:'date must be YYYY-MM-DD'});
      if(req.method==='GET'){
        if(!fs.existsSync(fileFor(date))) return send(res,200,{date, title:'', elements:[], updatedAt:null});
        return send(res,200,JSON.parse(fs.readFileSync(fileFor(date),'utf8')));
      }
      if(req.method==='PUT'){
        const body = JSON.parse(await readBody(req)||'{}');
        const note = { date, title:String(body.title||''), elements:Array.isArray(body.elements)?body.elements:[], updatedAt:new Date().toISOString() };
        fs.writeFileSync(fileFor(date), JSON.stringify(note,null,2));
        return send(res,200,note);
      }
      if(req.method==='DELETE'){ if(fs.existsSync(fileFor(date))) fs.unlinkSync(fileFor(date)); return send(res,200,{ok:true}); }
      return send(res,405,{error:'method not allowed'});
    }
    // static
    const rel = p==='/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const fp = path.join(PUBLIC, rel);
    if(!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res,404,'Not found','text/plain; charset=utf-8');
    return send(res,200,fs.readFileSync(fp), MIME[path.extname(fp)]||'application/octet-stream');
  }catch(e){ return send(res,500,{error:String(e.message||e)}); }
});
server.listen(PORT, HOST, ()=> console.log(`Intranet Notebook: http://localhost:${PORT}  (data: ${DATA})`));
