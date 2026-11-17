// Intranet Notebook server — Node.js standard library only (no npm dependencies)
// Why: company intranet / offline machines often cannot reach npm registry.
// Storage (v0.2.0): local SQLite database at data/notebook.db, via Node's built-in
// node:sqlite — still zero dependencies. The old one-JSON-file-per-day layout is
// imported automatically on first start (files are moved to data/legacy-json/).
// If node:sqlite is unavailable (Node < 22.5), it falls back to the JSON files.
// API:
//   GET    /api/notes              -> [{date, title, updatedAt, count}] (date DESC)
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
const byDateDesc = (a,b)=> b.date.localeCompare(a.date);

// ---------- storage ----------
let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(path.join(DATA, 'notebook.db'));
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS notes(
    date TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    elements TEXT NOT NULL DEFAULT '[]',
    element_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )`);
  migrateLegacyJson();
} catch (e) {
  console.warn('SQLite unavailable, falling back to JSON files:', e.message);
  db = null;
}
function migrateLegacyJson(){
  const existing = db.prepare('SELECT COUNT(*) AS c FROM notes').get().c;
  if (existing > 0) return;
  const files = fs.readdirSync(DATA).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (!files.length) return;
  const ins = db.prepare('INSERT OR IGNORE INTO notes(date,title,elements,element_count,updated_at) VALUES(?,?,?,?,?)');
  let imported = 0;
  const legacyDir = path.join(DATA, 'legacy-json');
  for (const f of files) {
    try {
      const n = JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8'));
      const els = Array.isArray(n.elements) ? n.elements : [];
      ins.run(n.date || f.slice(0,10), String(n.title||''), JSON.stringify(els), els.length, n.updatedAt || null);
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.renameSync(path.join(DATA,f), path.join(legacyDir,f));
      imported++;
    } catch { /* leave unparsable files in place */ }
  }
  if (imported) console.log(`Migrated ${imported} legacy JSON note(s) into data/notebook.db (originals in data/legacy-json/)`);
}
const store = {
  list(){
    if (db) return db.prepare('SELECT date, title, updated_at AS updatedAt, element_count AS count FROM notes ORDER BY date DESC').all();
    return fs.readdirSync(DATA).filter(f=>f.endsWith('.json')).map(f=>{
      try{ const n=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); return {date:n.date, title:n.title||'', updatedAt:n.updatedAt||null, count:(n.elements||[]).length}; }catch{ return null; }
    }).filter(Boolean).sort(byDateDesc);
  },
  get(date){
    if (db) { const r = db.prepare('SELECT date,title,elements,updated_at AS updatedAt FROM notes WHERE date=?').get(date);
      return r ? { date:r.date, title:r.title, elements:JSON.parse(r.elements), updatedAt:r.updatedAt } : null; }
    if (!fs.existsSync(fileFor(date))) return null;
    return JSON.parse(fs.readFileSync(fileFor(date),'utf8'));
  },
  put(note){
    if (db) db.prepare('INSERT INTO notes(date,title,elements,element_count,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET title=excluded.title, elements=excluded.elements, element_count=excluded.element_count, updated_at=excluded.updated_at')
      .run(note.date, note.title, JSON.stringify(note.elements), note.elements.length, note.updatedAt);
    else fs.writeFileSync(fileFor(note.date), JSON.stringify(note,null,2));
    return note;
  },
  del(date){
    if (db) db.prepare('DELETE FROM notes WHERE date=?').run(date);
    else if (fs.existsSync(fileFor(date))) fs.unlinkSync(fileFor(date));
  }
};

// ---------- http ----------
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
      const parts = p.split('/').filter(Boolean);
      const date = parts[2];
      if(req.method==='GET' && !date) return send(res,200,store.list());
      if(date && !isDate(date)) return send(res,400,{error:'date must be YYYY-MM-DD'});
      if(req.method==='GET') return send(res,200, store.get(date) || {date, title:'', elements:[], updatedAt:null});
      if(req.method==='PUT'){
        const body = JSON.parse(await readBody(req)||'{}');
        const note = { date, title:String(body.title||''), elements:Array.isArray(body.elements)?body.elements:[], updatedAt:new Date().toISOString() };
        return send(res,200, store.put(note));
      }
      if(req.method==='DELETE'){ store.del(date); return send(res,200,{ok:true}); }
      return send(res,405,{error:'method not allowed'});
    }
    const rel = p==='/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const fp = path.join(PUBLIC, rel);
    if(!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res,404,'Not found','text/plain; charset=utf-8');
    return send(res,200,fs.readFileSync(fp), MIME[path.extname(fp)]||'application/octet-stream');
  }catch(e){ return send(res,500,{error:String(e.message||e)}); }
});
server.listen(PORT, HOST, ()=> console.log(`Intranet Notebook: http://localhost:${PORT}  (storage: ${db ? 'SQLite data/notebook.db' : 'JSON files in data/'})`));
