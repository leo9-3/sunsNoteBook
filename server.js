// Intranet Notebook server — Node.js standard library only (no npm dependencies)
// Why: company intranet / offline machines often cannot reach npm registry.
// Storage (v0.2.0): local SQLite database at data/notebook.db, via Node's built-in
// node:sqlite — still zero dependencies. The old one-JSON-file-per-day layout is
// imported automatically on first start (files are moved to data/legacy-json/).
// If node:sqlite is unavailable (Node < 22.5), it falls back to the JSON files.
// API:
//   GET    /api/folders?book=:id   -> [{name}]  (v0.6.0 folders inside free books)
//   POST/PUT/DELETE /api/folders   -> create / rename / delete a folder (pages fall back to root)
//   GET    /api/books              -> [{id, name, kind}]  (v0.5.0 collections: 'diary' + free books)
//   POST   /api/books              -> create a free book {name}
//   PUT    /api/books/:id          -> rename a book {name}
//   DELETE /api/books/:id          -> delete a free book and its pages (diary cannot be deleted)
//   GET    /api/notes              -> [{id, book, date, title, updatedAt, count}]
//   GET    /api/notes/:id          -> note or a blank template (id = YYYY-MM-DD for diary, pg_* for pages)
//   PUT    /api/notes/:id          -> save note {book, title, elements:[...]}
//   DELETE /api/notes/:id          -> delete
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
const byDateAsc = (a,b)=> a.date.localeCompare(b.date);

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
  db.exec(`CREATE TABLE IF NOT EXISTS books(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'free',
    sort INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec("INSERT OR IGNORE INTO books(id,name,kind,sort) VALUES('diary','日记','diary',0)");
  db.exec(`CREATE TABLE IF NOT EXISTS folders(
    book TEXT NOT NULL,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(book, name)
  )`);
  migrateNotesToBooks();
  migrateFolders();
  migrateParents();
  migrateLegacyJson();
} catch (e) {
  console.warn('SQLite unavailable, falling back to JSON files:', e.message);
  db = null;
}
// v0.5.0: notes gain (id, book) — diary notes keep id = date; free-book pages get
// pg_* ids and date = NULL. Existing rows are copied over untouched.
function migrateNotesToBooks(){
  const cols = db.prepare('PRAGMA table_info(notes)').all().map(r=>r.name);
  if (cols.includes('id')) return;
  db.exec(`CREATE TABLE notes_new(
    id TEXT PRIMARY KEY,
    book TEXT NOT NULL DEFAULT 'diary',
    date TEXT,
    title TEXT NOT NULL DEFAULT '',
    elements TEXT NOT NULL DEFAULT '[]',
    element_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )`);
  db.exec("INSERT INTO notes_new(id,book,date,title,elements,element_count,updated_at) SELECT date,'diary',date,title,elements,element_count,updated_at FROM notes");
  db.exec('DROP TABLE notes');
  db.exec('ALTER TABLE notes_new RENAME TO notes');
  console.log('Migrated notes table to the books schema (v0.5.0); all existing notes are in the diary book');
}
// v0.6.0: pages can live in a named folder inside their book ('' = book root)
function migrateFolders(){
  const cols = db.prepare('PRAGMA table_info(notes)').all().map(r=>r.name);
  if (!cols.includes('folder')) db.exec("ALTER TABLE notes ADD COLUMN folder TEXT NOT NULL DEFAULT ''");
}
// v0.8.0: a free-book page can be the child of another page (right-click ->
// new child note); the parent then renders as a folder-like tree node
function migrateParents(){
  const cols = db.prepare('PRAGMA table_info(notes)').all().map(r=>r.name);
  if (!cols.includes('parent')) db.exec("ALTER TABLE notes ADD COLUMN parent TEXT NOT NULL DEFAULT ''");
}
function migrateLegacyJson(){
  const existing = db.prepare('SELECT COUNT(*) AS c FROM notes').get().c;
  if (existing > 0) return;
  const files = fs.readdirSync(DATA).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (!files.length) return;
  const ins = db.prepare("INSERT OR IGNORE INTO notes(id,book,date,title,elements,element_count,updated_at) VALUES(?,'diary',?,?,?,?,?)");
  let imported = 0;
  const legacyDir = path.join(DATA, 'legacy-json');
  for (const f of files) {
    try {
      const n = JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8'));
      const els = Array.isArray(n.elements) ? n.elements : [];
      const d = n.date || f.slice(0,10);
      ins.run(d, d, String(n.title||''), JSON.stringify(els), els.length, n.updatedAt || null);
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.renameSync(path.join(DATA,f), path.join(legacyDir,f));
      imported++;
    } catch { /* leave unparsable files in place */ }
  }
  if (imported) console.log(`Migrated ${imported} legacy JSON note(s) into data/notebook.db (originals in data/legacy-json/)`);
}
const isPageId = s => /^pg_[a-z0-9]+$/.test(s);
const isBookId = s => /^[a-z0-9_]+$/.test(s);
const BOOKS_FILE = path.join(DATA, '_books.json');
function booksFallback(){ try{ const bs = JSON.parse(fs.readFileSync(BOOKS_FILE,'utf8')); if (Array.isArray(bs) && bs.length) return bs; }catch{} return [{id:'diary',name:'日记',kind:'diary'}]; }
function saveBooksFallback(bs){ fs.writeFileSync(BOOKS_FILE, JSON.stringify(bs,null,2)); }
const FOLDERS_FILE = path.join(DATA, '_folders.json');
function foldersFallback(){ try{ const fs_ = JSON.parse(fs.readFileSync(FOLDERS_FILE,'utf8')); if (Array.isArray(fs_)) return fs_; }catch{} return []; }
function saveFoldersFallback(fs_){ fs.writeFileSync(FOLDERS_FILE, JSON.stringify(fs_,null,2)); }
const store = {
  listBooks(){
    if (db) return db.prepare('SELECT id, name, kind FROM books ORDER BY sort ASC, name ASC').all();
    return booksFallback();
  },
  addBook(name){
    const id = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    if (db){ const s = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM books').get().s;
      db.prepare('INSERT INTO books(id,name,kind,sort) VALUES(?,?,?,?)').run(id, name, 'free', s); }
    else { const bs = booksFallback(); bs.push({id, name, kind:'free'}); saveBooksFallback(bs); }
    return {id, name, kind:'free'};
  },
  renameBook(id, name){
    if (db) db.prepare('UPDATE books SET name=? WHERE id=?').run(name, id);
    else { const bs = booksFallback(); const b = bs.find(x=>x.id===id); if (b) b.name = name; saveBooksFallback(bs); }
  },
  delBook(id){
    if (db){ db.prepare('DELETE FROM notes WHERE book=?').run(id); db.prepare('DELETE FROM books WHERE id=?').run(id); }
    else { saveBooksFallback(booksFallback().filter(x=>x.id!==id));
      fs.readdirSync(DATA).filter(f=>f.endsWith('.json') && f!=='_books.json').forEach(f=>{ try{ const n = JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); if (n.book===id) fs.unlinkSync(path.join(DATA,f)); }catch{} }); }
  },
  listFolders(book){
    if (db) return db.prepare('SELECT name FROM folders WHERE book=? ORDER BY sort ASC, name ASC').all(book).map(r=>r.name);
    return foldersFallback().filter(f=>f.book===book).map(f=>f.name);
  },
  addFolder(book, name){
    if (db){ const s = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM folders WHERE book=?').get(book).s;
      db.prepare('INSERT OR IGNORE INTO folders(book,name,sort) VALUES(?,?,?)').run(book, name, s); }
    else { const fs_ = foldersFallback(); if (!fs_.some(f=>f.book===book && f.name===name)) { fs_.push({book, name}); saveFoldersFallback(fs_); } }
  },
  renameFolder(book, oldName, newName){
    if (db){ db.prepare('UPDATE OR IGNORE folders SET name=? WHERE book=? AND name=?').run(newName, book, oldName);
      db.prepare('UPDATE notes SET folder=? WHERE book=? AND folder=?').run(newName, book, oldName); }
    else { const fs_ = foldersFallback(); const f = fs_.find(x=>x.book===book && x.name===oldName); if (f) f.name = newName; saveFoldersFallback(fs_); }
  },
  delFolder(book, name){
    if (db){ db.prepare('DELETE FROM folders WHERE book=? AND name=?').run(book, name);
      db.prepare("UPDATE notes SET folder='' WHERE book=? AND folder=?").run(book, name); }
    else saveFoldersFallback(foldersFallback().filter(f=>!(f.book===book && f.name===name)));
  },
  list(){
    if (db) return db.prepare('SELECT id, book, date, folder, parent, title, updated_at AS updatedAt, element_count AS count FROM notes').all();
    return fs.readdirSync(DATA).filter(f=>f.endsWith('.json') && f!=='_books.json').map(f=>{
      try{ const n = JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8')); return {id:n.id||n.date, book:n.book||'diary', date:n.date||null, folder:n.folder||'', parent:n.parent||'', title:n.title||'', updatedAt:n.updatedAt||null, count:(n.elements||[]).length}; }catch{ return null; }
    }).filter(Boolean);
  },
  get(id){
    if (db) { const r = db.prepare('SELECT id, book, date, folder, parent, title, elements, updated_at AS updatedAt FROM notes WHERE id=?').get(id);
      return r ? { id:r.id, book:r.book, date:r.date, folder:r.folder||'', parent:r.parent||'', title:r.title, elements:JSON.parse(r.elements), updatedAt:r.updatedAt } : null; }
    const f = path.join(DATA, id + '.json');
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f,'utf8'));
  },
  put(note){
    if (db) db.prepare('INSERT INTO notes(id,book,date,folder,parent,title,elements,element_count,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET book=excluded.book, date=excluded.date, folder=excluded.folder, parent=excluded.parent, title=excluded.title, elements=excluded.elements, element_count=excluded.element_count, updated_at=excluded.updated_at')
      .run(note.id, note.book, note.date, note.folder||'', note.parent||'', note.title, JSON.stringify(note.elements), note.elements.length, note.updatedAt);
    else fs.writeFileSync(path.join(DATA, note.id + '.json'), JSON.stringify(note,null,2));
    return note;
  },
  del(id){
    if (db) { const cur = db.prepare('SELECT parent FROM notes WHERE id=?').get(id);
      if (cur) db.prepare('UPDATE notes SET parent=? WHERE parent=?').run(cur.parent||'', id); // children move up, never cascade-delete
      db.prepare('DELETE FROM notes WHERE id=?').run(id); }
    else { const f = path.join(DATA, id + '.json');
      let par = ''; try { par = JSON.parse(fs.readFileSync(f,'utf8')).parent || ''; } catch {}
      if (fs.existsSync(f)) fs.unlinkSync(f);
      fs.readdirSync(DATA).filter(x=>x.endsWith('.json') && x!=='_books.json' && x!=='_folders.json').forEach(x=>{ try { const n = JSON.parse(fs.readFileSync(path.join(DATA,x),'utf8')); if (n.parent===id) { n.parent = par; fs.writeFileSync(path.join(DATA,x), JSON.stringify(n,null,2)); } } catch {} }); }
  }
};

// ---------- auto-stop (v0.7.0) ----------
// The page heartbeats every few seconds and beacons /api/bye when it closes.
// When the UI is gone the server exits by itself, so no background process is
// left holding the port (the mixed-version trap of v0.5.0). A page reload also
// fires the beacon, so the exit waits 8s and any new heartbeat cancels it;
// a crashed tab is covered by the 150s heartbeat watchdog. Shared-server
// installs can disable all of this with NOTEBOOK_NO_AUTOSTOP=1.
const AUTOSTOP = process.env.NOTEBOOK_NO_AUTOSTOP !== '1';
let lastBeat = 0, everBeat = false, byeTimer = null;
if (AUTOSTOP) setInterval(()=>{
  if (everBeat && Date.now() - lastBeat > 150000){
    console.log('Notebook: no UI heartbeat for 150s, auto-stopping.');
    process.exit(0);
  }
}, 5000);

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
    if(p==='/api/heartbeat'){
      lastBeat = Date.now(); everBeat = true;
      if (byeTimer){ clearTimeout(byeTimer); byeTimer = null; }
      return send(res,200,{ok:true});
    }
    if(p==='/api/bye'){
      if (AUTOSTOP && !byeTimer){
        byeTimer = setTimeout(()=>{ console.log('Notebook: UI closed, auto-stopping.'); process.exit(0); }, 8000);
      }
      return send(res,200,{ok:true});
    }
    if(p.startsWith('/api/books')){
      const parts = p.split('/').filter(Boolean);
      const bid = parts[2];
      if(req.method==='GET' && !bid) return send(res,200,store.listBooks());
      if(req.method==='POST' && !bid){
        const body = JSON.parse(await readBody(req)||'{}');
        const name = String(body.name||'').trim();
        if(!name) return send(res,400,{error:'name required'});
        return send(res,200,store.addBook(name));
      }
      if(bid && !isBookId(bid)) return send(res,400,{error:'bad book id'});
      if(req.method==='PUT'){
        const body = JSON.parse(await readBody(req)||'{}');
        const name = String(body.name||'').trim();
        if(!name) return send(res,400,{error:'name required'});
        store.renameBook(bid, name); return send(res,200,{ok:true});
      }
      if(req.method==='DELETE'){
        if(bid==='diary') return send(res,400,{error:'the diary book cannot be deleted'});
        store.delBook(bid); return send(res,200,{ok:true});
      }
      return send(res,405,{error:'method not allowed'});
    }
    if(p.startsWith('/api/folders')){
      const book = url.searchParams.get('book') || '';
      if(req.method==='GET'){
        if(!isBookId(book)) return send(res,400,{error:'bad book id'});
        return send(res,200,store.listFolders(book).map(name=>({name})));
      }
      const body = JSON.parse(await readBody(req)||'{}');
      const bk = String(body.book || book || '');
      if(!isBookId(bk)) return send(res,400,{error:'bad book id'});
      if(req.method==='POST'){
        const name = String(body.name||'').trim();
        if(!name) return send(res,400,{error:'name required'});
        store.addFolder(bk, name); return send(res,200,{ok:true});
      }
      if(req.method==='PUT'){
        const name = String(body.name||'').trim(), newName = String(body.newName||'').trim();
        if(!name || !newName) return send(res,400,{error:'name and newName required'});
        store.renameFolder(bk, name, newName); return send(res,200,{ok:true});
      }
      if(req.method==='DELETE'){
        const name = String(url.searchParams.get('name') || body.name || '');
        if(!name) return send(res,400,{error:'name required'});
        store.delFolder(bk, name); return send(res,200,{ok:true});
      }
      return send(res,405,{error:'method not allowed'});
    }
    if(p.startsWith('/api/notes')){
      const parts = p.split('/').filter(Boolean);
      const id = parts[2];
      if(req.method==='GET' && !id) return send(res,200,store.list());
      if(id && !isDate(id) && !isPageId(id)) return send(res,400,{error:'id must be YYYY-MM-DD or pg_*'});
      if(req.method==='GET'){
        const n = store.get(id);
        return send(res,200, n || {id, book:isDate(id)?'diary':null, date:isDate(id)?id:null, folder:'', parent:'', title:'', elements:[], updatedAt:null});
      }
      if(req.method==='PUT'){
        const body = JSON.parse(await readBody(req)||'{}');
        const note = { id, book:String(body.book||(isDate(id)?'diary':'')), date:isDate(id)?id:null, folder:String(body.folder||''), parent:String(body.parent||''), title:String(body.title||''), elements:Array.isArray(body.elements)?body.elements:[], updatedAt:new Date().toISOString() };
        if(!note.book) return send(res,400,{error:'book required for pages'});
        return send(res,200, store.put(note));
      }
      if(req.method==='DELETE'){ store.del(id); return send(res,200,{ok:true}); }
      return send(res,405,{error:'method not allowed'});
    }
    const rel = p==='/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const fp = path.join(PUBLIC, rel);
    if(!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res,404,'Not found','text/plain; charset=utf-8');
    return send(res,200,fs.readFileSync(fp), MIME[path.extname(fp)]||'application/octet-stream');
  }catch(e){ return send(res,500,{error:String(e.message||e)}); }
});
server.listen(PORT, HOST, ()=> console.log(`Intranet Notebook: http://localhost:${PORT}  (storage: ${db ? 'SQLite data/notebook.db' : 'JSON files in data/'})`));
