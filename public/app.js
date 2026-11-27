// Intranet Notebook — freeform canvas (OneNote-style)
// v0.1.1: click any empty spot to type right there (no block dragging needed);
//         images move by dragging the image itself and never duplicate via native drag.
// Elements: {id,type:'text'|'heading'|'sticky'|'todo'|'image',x,y,w,h,text?,src?}
const $=s=>document.querySelector(s);
const today=()=>{const d=new Date();return d.toISOString().slice(0,10)};
let date=today(), note={date,title:'',elements:[]}, zoom=1, pan={x:20,y:20}, saveTimer=null, useServer=true;
// collections (v0.5.0): the built-in 'diary' book holds one note per date; free
// books hold titled pages (pg_* ids) — the left rail switches between them
let books=[{id:'diary',name:'日记',kind:'diary'}], bookId=localStorage.getItem('nb-book')||'diary';
const curBook=()=>books.find(b=>b.id===bookId)||books[0];
// server capability mode, decided once at boot by detectMode():
//   'new' = current server, 'old' = a pre-v0.5.0 server still running (it has
//   /api/notes but no /api/books), 'none' = no server at all (file:// demo).
// localStorage may ONLY be used in 'none' mode — falling back to it while an
// old server answers produced the v0.5.0 hybrid bug: saves/deletes went to
// localStorage while lists came from the server, so deleted diary notes stayed
// in the tree and new books/pages never showed up.
let serverMode='new', oldServer=false;
const lsOK=()=>serverMode==='none';
async function detectMode(){
  try{ await api('/api/books'); serverMode='new'; }
  catch{ try{ await api('/api/notes'); serverMode='old'; }catch{ serverMode='none'; } }
  useServer=serverMode!=='none'; oldServer=serverMode==='old';
}
let saveInFlight=null; const tombstones=new Set();
const isDateId=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'');
function esc(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const uid=()=>Math.random().toString(36).slice(2,10);

async function api(path,opts){ const r=await fetch(path,opts); if(!r.ok) throw new Error(r.status); return r.json(); }
async function loadNote(d, opts={}){ document.body.classList.remove('nav-open');
  const wasOpen=(date===d);
  date=d; if(curBook().kind==='diary') expandFor(d);
  let fresh=false;
  try{ note=await api('/api/notes/'+d); fresh=!note.updatedAt; }
  catch{ const raw=lsOK()?localStorage.getItem('notebook:'+d):null; fresh=!raw; note=JSON.parse(raw||JSON.stringify({date:d,title:'',elements:[]})); }
  if(!note.elements) note.elements=[];
  if(note.folder==null) note.folder='';
  if(note.parent==null) note.parent='';
  inkUndo.length=0; inkRedo.length=0; // stroke history is per-note
  if(note.folder) expandedFolders.add(bookId+':'+note.folder); // opening a page expands its folder once; the user can still collapse it afterwards
  if(note.parent){ let p=note.parent, guard=0; while(p&&guard++<20){ expandedPages.add(p); const pn=pageCache.get(p); p=pn?(pn.parent||''):''; } }
  tombstones.delete(d);
  note.id=d; note.book=bookId; if(isDateId(d)) note.date=d;
  $('#title').value=note.title||''; render(); refreshList();
  const label=curBook().kind==='diary'?d:'页面';
  if(opts.create&&fresh){
    // explicit "new note" click: persist at once so the list shows the new entry,
    // and put the cursor in the title box — without this the button looked dead
    await save(); markSaved('已新建 '+label+'（默认名：'+note.title+'，可在顶部改名）');
    $('#title').focus(); $('#title').select();
  } else if(opts.create&&wasOpen){
    markSaved(label+'已经在打开状态');
    $('#title').focus(); $('#title').select();
  } else markSaved('已打开 '+label);
}
const defaultTitle=d=>{ const dt=new Date(d+'T00:00:00'); return dt.getDate()+'日 星期'+'日一二三四五六'[dt.getDay()]; };
async function save(){
  if(tombstones.has(date)) return; // deleted while a save was pending — never resurrect it
  markSaved('保存中…'); note.title=$('#title').value; note.id=date; note.book=bookId; if(isDateId(date)) note.date=date;
  // every new diary note gets a default name like "17日 星期二" (kalo's rule); a name
  // the user typed always wins, and clearing a name back to blank restores the
  // default. Free pages fall back to 未命名页面 instead of a date-based name.
  if(!(note.title||'').trim()){ note.title=curBook().kind==='diary'?defaultTitle(date):'未命名页面'; if(document.activeElement!==$('#title')) $('#title').value=note.title; }
  note.elements.forEach(el=>{ if(el.runs&&Object.keys(el.runs).length) el.colors={}; }); // runs supersede legacy colours
  // never persist empty text blocks (e.g. a stray click that was never typed into)
  note.elements=note.elements.filter(el=>el.type==='image'||el.type==='table'||el.type==='ink'||(el.text||'').trim()!==''||el.id===window._sel);
  try{ if(!useServer) throw 0; saveInFlight=api('/api/notes/'+date,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(note)}); await saveInFlight; }
  catch{ if(!useServer) localStorage.setItem('notebook:'+date,JSON.stringify(note)); else { markSaved('保存失败：服务端无响应，请确认程序还在运行'); return; } }
  saveInFlight=null;
  markSaved('已保存 '+new Date().toLocaleTimeString()); refreshList();
}
const scheduleSave=()=>{ clearTimeout(saveTimer); saveTimer=setTimeout(save,500); };
const markSaved=t=>$('#saveState').textContent=t+(useServer?'':'（本地演示模式）');

// Date tree (v0.2.1): left panel groups notes 年 -> 月 -> 日, like a classic diary tree.
// expandedKeys holds the 'YYYY' / 'YYYY-MM' nodes the user currently has open.
const expandedKeys=new Set();
function expandFor(d){ if(!d) return; const p=String(d).split('-'); if(p.length<2) return; expandedKeys.add(p[0]); expandedKeys.add(p[0]+'-'+p[1]); }
async function listAllNotes(){
  try{ return await api('/api/notes'); }
  catch{ if(!lsOK()) return [];
    return Object.keys(localStorage).filter(k=>k.startsWith('notebook:')&&k!=='notebook:books'&&k!=='notebook:folders').map(k=>{ try{ const n=JSON.parse(localStorage.getItem(k)); return {id:n.id||n.date, book:n.book||'diary', date:n.date||null, folder:n.folder||'', parent:n.parent||'', title:n.title, updatedAt:n.updatedAt||null, count:(n.elements||[]).length}; }catch{ return null; } }).filter(Boolean); }
}
async function refreshList(){
  let list=[];
  list=await listAllNotes();
  const q=($('#search').value||'').toLowerCase();
  const box=$('#noteList');
  const mine=list.filter(n=>(n.book||'diary')===bookId);
  if(curBook().kind!=='diary'){
    // free book: folders (collapsible) + a page tree — a page can parent other
    // pages (right-click -> new child note) and then renders like a folder
    await refreshFolders();
    pageCache.clear(); mine.forEach(n=>pageCache.set(n.id,n));
    if(q){
      const hits=mine.filter(n=>(n.title||'').toLowerCase().includes(q)).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
      if(!hits.length){ box.innerHTML='<p class="hint">没有符合搜索的页面。</p>'; return; }
      box.innerHTML=hits.map(n=>pageRowHtml(n,0,false,false)).join('');
      wirePageRows(box); return;
    }
    const byParent=new Map();
    mine.forEach(n=>{ const p=n.parent||''; if(!byParent.has(p)) byParent.set(p,[]); byParent.get(p).push(n); });
    const inMine=new Set(mine.map(n=>n.id));
    const kidsOf=n=>(byParent.get(n.id)||[]).slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    const renderNodes=(nodes,depth)=>nodes.map(n=>{
      const ch=kidsOf(n), has=ch.length>0, open=expandedPages.has(n.id);
      let h=pageRowHtml(n,depth,has,open);
      if(has&&open) h+=renderNodes(ch,depth+1);
      return h;
    }).join('');
    const topInGroup=g=>mine.filter(n=>(n.folder||'')===g&&(!(n.parent||'')||!inMine.has(n.parent))).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    const names=[...new Set([...folders, ...mine.map(n=>n.folder||'').filter(f=>f)])].sort((a,b)=>a.localeCompare(b,'zh'));
    let html='';
    for(const f of names){
      const key=bookId+':'+f, open=expandedFolders.has(key);
      const cnt=mine.filter(n=>(n.folder||'')===f).length;
      html+=`<div class="folderRow" data-fld="${esc(f)}" title="单击展开/收起 · 双击改名"><span class="tw">${open?'▾':'▸'}</span>📁 ${esc(f)}<span class="cnt">${cnt} 页</span><span class="fact" data-fadd="${esc(f)}" title="在这个文件夹里新建页面">＋</span><span class="fact fdel" data-fdel="${esc(f)}" title="删除文件夹（页面移回根目录）">✕</span></div>`;
      if(open) html+=renderNodes(topInGroup(f),1);
    }
    html+=renderNodes(topInGroup(''),0);
    if(!mine.length&&!names.length){ box.innerHTML='<p class="hint">这个合集还没有页面，点上面新建一页，或先建个文件夹分类。</p>'; return; }
    box.innerHTML=html;
    box.querySelectorAll('.folderRow').forEach(r=>{ r.onclick=()=>{ const key=bookId+':'+r.dataset.fld; expandedFolders.has(key)?expandedFolders.delete(key):expandedFolders.add(key); refreshList(); }; r.ondblclick=()=>renameFolder(r.dataset.fld); });
    box.querySelectorAll('[data-fadd]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); createPage(x.dataset.fadd); });
    box.querySelectorAll('[data-fdel]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); deleteFolder(x.dataset.fdel); });
    wirePageRows(box);
    return;
  }
  list=mine.sort((a,b)=>String(a.date).localeCompare(String(b.date))); // chronological: oldest first, newest last — tree groups inherit this order
  const filtered=list.filter(n=>!q||n.date.includes(q)||(n.title||'').toLowerCase().includes(q));
  if(!filtered.length){ box.innerHTML='<p class="hint">还没有纪要，点上面新建今天的。</p>'; return; }
  if(!expandedKeys.size){ expandFor(today()); expandFor(date); }
  const years=new Map();
  for(const n of filtered){ const [y,m]=n.date.split('-'); if(!years.has(y)) years.set(y,new Map()); const mm=years.get(y); if(!mm.has(m)) mm.set(m,[]); mm.get(m).push(n); }
  let html='';
  for(const [y,months] of years){
    const yOpen=!!q||expandedKeys.has(y);
    const yCount=[...months.values()].reduce((s,a)=>s+a.length,0);
    html+=`<div class="treeRow treeYear" data-k="${y}"><span class="tw">${yOpen?'▾':'▸'}</span>${y}年<span class="cnt">${yCount} 篇</span></div>`;
    if(yOpen) for(const [m,days] of months){
      const key=y+'-'+m, mOpen=!!q||expandedKeys.has(key);
      html+=`<div class="treeRow treeMonth" data-k="${key}"><span class="tw">${mOpen?'▾':'▸'}</span>${Number(m)}月<span class="cnt">${days.length} 篇</span></div>`;
      if(mOpen) html+='<div class="treeDays">'+days.map(n=>{ const wd='日一二三四五六'[new Date(n.date+'T00:00:00').getDay()]; return `<div class="noteItem treeDay ${n.date===date?'active':''}" data-d="${n.date}" title="单击打开 · 双击改名"><b>${Number(n.date.slice(8))}日</b><small>周${wd}</small><span class="tt">${n.title||'<i>未命名纪要</i>'}</span><span class="tdel" data-del="${n.date}" title="删除这篇纪要">✕</span></div>`; }).join('')+'</div>';
    }
  }
  box.innerHTML=html;
  box.querySelectorAll('.treeRow').forEach(r=>r.onclick=()=>{ const k=r.dataset.k; expandedKeys.has(k)?expandedKeys.delete(k):expandedKeys.add(k); refreshList(); });
  box.querySelectorAll('.noteItem').forEach(el=>{
    el.onclick=()=>loadNote(el.dataset.d);
    el.ondblclick=()=>{ $('#title').focus(); $('#title').select(); };
  });
  box.querySelectorAll('[data-del]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); deleteNote(x.dataset.del); });
}

function applyTransform(){ $('#canvas').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`; $('#zoomLabel').textContent=Math.round(zoom*100)+'%'; }
function render(){ const c=$('#canvas'); c.innerHTML=''; note.elements.forEach(el=>c.appendChild(nodeFor(el))); applyTransform(); }

function startMove(e, el, div){
  e.preventDefault(); select(el.id);
  const sx=e.clientX, sy=e.clientY, ox=el.x, oy=el.y;
  const mv=ev=>{ el.x=ox+(ev.clientX-sx)/zoom; el.y=oy+(ev.clientY-sy)/zoom; div.style.left=el.x+'px'; div.style.top=el.y+'px'; };
  const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
}
// ---- per-line formatting (v0.2.5) -------------------------------------------
// A body is a flat list of line <div>s. el.text stays plain text with \n;
// el.marks[lineIdx] = 'h1'|'h2'|'h3' and el.fonts[lineIdx] = a CSS font stack
// carry the Word-style paragraph formatting. The DOM is the source of truth
// while editing; readRich() folds it back into the data model on every input.
function renderLineContent(d, text, runs){
  if(text===''){ d.appendChild(document.createElement('br')); return; }
  if(!runs||!runs.length){ d.textContent=text; return; }
  let pos=0;
  runs.slice().sort((a,b)=>a.s-b.s).forEach(r=>{
    if(r.s>pos) d.appendChild(document.createTextNode(text.slice(pos, r.s)));
    const sp=document.createElement('span'); sp.style.color=r.c; sp.textContent=text.slice(r.s, r.e); d.appendChild(sp);
    pos=Math.max(pos, r.e);
  });
  if(pos<text.length) d.appendChild(document.createTextNode(text.slice(pos)));
}
function renderBody(b, el){
  b.innerHTML='';
  if(!(el.text||'')) return; // leave empty: the CSS placeholder shows
  // legacy migration: v0.2.8 stored whole-line colours in el.colors — turn them
  // into full-line character runs once; from v0.2.9 colours live only in el.runs
  if((!el.runs||!Object.keys(el.runs).length)&&el.colors&&Object.keys(el.colors).length){
    el.runs={};
    el.text.split('\n').forEach((t,i)=>{ if(el.colors[i]&&t) el.runs[i]=[{s:0, e:t.length, c:el.colors[i]}]; });
    el.colors={}; // migrated — never let the stale per-line colours resurrect
  }
  el.text.split('\n').forEach((t,i)=>{
    const d=document.createElement('div');
    const im=/^\{\{img:([a-z0-9]+)\}\}$/.exec(t);
    if(im&&el.imgs&&el.imgs[im[1]]){ // inline image line (v0.4.0): an atomic island inside the text
      const meta=el.imgs[im[1]];
      d.className='ln imgLn'; d.contentEditable='false';
      const wrap=document.createElement('span'); wrap.className='imgWrap';
      const img=document.createElement('img'); img.src=meta.src; img.dataset.iid=im[1]; img.draggable=false; img.style.width=(meta.w||420)+'px';
      const rz=document.createElement('span'); rz.className='imgRz'; rz.textContent='◢'; rz.title='拖动调整图片宽度';
      wrap.appendChild(img); wrap.appendChild(rz); d.appendChild(wrap);
      wrap.addEventListener('mousedown',e=>{ e.stopPropagation(); b.querySelectorAll('.imgWrap.sel').forEach(w=>w.classList.remove('sel')); wrap.classList.add('sel'); });
      wrap.addEventListener('dblclick',e=>{ e.preventDefault(); e.stopPropagation(); openLightbox(meta.src); });
      rz.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
        const sx=e.clientX, ow=meta.w||420;
        const mv=ev=>{ meta.w=Math.max(60,Math.min(1000,Math.round(ow+(ev.clientX-sx)/zoom))); img.style.width=meta.w+'px'; };
        const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
        addEventListener('mousemove',mv); addEventListener('mouseup',up); });
      b.appendChild(d);
      return;
    }
    d.className='ln'+(el.marks&&el.marks[i]?' lv-'+el.marks[i]:'');
    if(el.fonts&&el.fonts[i]) d.style.fontFamily=el.fonts[i];
    renderLineContent(d, t, el.runs&&el.runs[i]);
    b.appendChild(d);
  });
}
// ---- simple tables (v0.2.7): el.rows is a 2D array of plain-text cells --------
function readTable(tbl){ return [...tbl.rows].map(tr=>[...tr.cells].map(td=>((td.innerText||'').replace(/\r\n?/g,'\n').replace(/\n+$/,'')))); }
function buildTable(div, el){
  const tbl=div.querySelector('table.tbl'); if(!tbl) return;
  if(!Array.isArray(el.rows)||!el.rows.length) el.rows=[['','',''],['','',''],['','','']];
  tbl.innerHTML='';
  el.rows.forEach(row=>{
    const tr=document.createElement('tr');
    row.forEach(cell=>{
      const td=document.createElement('td');
      td.contentEditable='true'; td.textContent=cell||'';
      td.oninput=()=>{ el.rows=readTable(tbl); scheduleSave(); };
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
}
function tableOp(el, div, op){
  const tbl=div.querySelector('table.tbl'); el.rows=readTable(tbl);
  const cols=el.rows[0]?el.rows[0].length:0;
  if(op==='addr') el.rows.push(Array(cols).fill(''));
  else if(op==='delr'){ if(el.rows.length>1) el.rows.pop(); }
  else if(op==='addc') el.rows.forEach(r=>r.push(''));
  else if(op==='delc'){ if(cols>1) el.rows.forEach(r=>r.pop()); }
  buildTable(div, el); scheduleSave();
}
// Extract one line div's text plus its character-level colour runs. Spans carry
// the colour; the div's own colour (v0.2.8 per-line data) counts as a base run.
function extractLine(div){
  let text=''; const lr=[];
  const addText=(t,color)=>{ if(color&&t) lr.push({s:text.length, e:text.length+t.length, c:color}); text+=t; };
  const walk=(node,color)=>{
    [...node.childNodes].forEach(ch=>{
      if(ch.nodeType===3) addText(ch.textContent, color);
      else if(ch.nodeName==='BR') text+='\n';
      else{
        const c=(ch.style&&ch.style.color)||color;
        const block=/^(DIV|P)$/.test(ch.nodeName);
        if(block&&text&&!text.endsWith('\n')) text+='\n';
        walk(ch, c);
        if(block&&!text.endsWith('\n')) text+='\n';
      }
    });
  };
  walk(div, (div.style&&div.style.color)||'');
  if(text.endsWith('\n')) text=text.slice(0,-1); // a trailing <br> is the empty-line marker, not a line break
  const merged=[]; lr.forEach(r=>{ if(r.e<=r.s) return; const last=merged[merged.length-1]; if(last&&last.c===r.c&&last.e===r.s) last.e=r.e; else merged.push({...r}); });
  return {text, runs:merged};
}
function readRich(b, el){
  const lines=[], marks={}, fonts={}, runs={};
  const pushPlain=txt=>{
    String(txt).replace(/\r\n?/g,'\n').split('\n').forEach(part=>lines.push(part));
  };
  const pushLine=div=>{
    const im=div.querySelector('img[data-iid]');
    if(im){ lines.push('{{img:'+im.dataset.iid+'}}'); return; } // inline image line folds back to its token
    const ex=extractLine(div);
    String(ex.text).replace(/\r\n?/g,'\n').split('\n').forEach((part,j)=>{
      const i=lines.length; lines.push(part);
      if(j===0){
        const m=/lv-(h[123])/.exec(div.className||''); if(m) marks[i]=m[1];
        if(div.style&&div.style.fontFamily) fonts[i]=div.style.fontFamily;
        const rr=ex.runs.filter(r=>r.s<part.length).map(r=>({s:r.s, e:Math.min(r.e, part.length), c:r.c})).filter(r=>r.e>r.s);
        if(rr.length) runs[i]=rr;
      }
    });
  };
  let stray='';
  [...b.childNodes].forEach(ch=>{
    if(ch.nodeType===3){ stray+=ch.textContent; }
    else if(ch.nodeName==='BR'){ pushPlain(stray); stray=''; }
    else { if(stray){ pushPlain(stray); stray=''; } pushLine(ch); }
  });
  if(stray) pushPlain(stray);
  if(!lines.length) lines.push('');
  let end=lines.length; while(end>1 && lines[end-1]==='') end--;
  lines.length=end;
  Object.keys(marks).forEach(k=>{ if(+k>=end) delete marks[k]; });
  Object.keys(fonts).forEach(k=>{ if(+k>=end) delete fonts[k]; });
  Object.keys(runs).forEach(k=>{ if(+k>=end) delete runs[k]; });
  el.text=lines.join('\n');
  el.marks=marks; el.fonts=fonts; el.runs=runs; el.colors={}; // colours live in runs now (v0.2.9)
}
function focusBody(el){ setTimeout(()=>{ const b=document.querySelector(`[data-id="${el.id}"] .body`); if(!b) return; b.focus();
  const r=document.createRange(); r.selectNodeContents(b); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); },0); }

function nodeFor(el){
  const div=document.createElement('div'); div.className='el '+el.type+(el.id===window._sel?' selected':''); div.dataset.id=el.id;
  // text/heading blocks hug their content (v0.2.2): the box is only as wide as the
  // longest line, so clicking beside the text hits the canvas and starts a new block.
  // Since v0.3.0 the user can drag the corner to give a text block a manual width
  // (el.mw) — text then wraps inside that width; double-clicking the corner clears
  // el.mw and restores the hug-content behaviour. Other block types keep fixed size.
  const isText=el.type==='text'||el.type==='heading';
  div.style.left=el.x+'px'; div.style.top=el.y+'px';
  if(isText){ if(el.mw){ div.style.width=el.mw+'px'; } else { div.style.width='max-content'; div.style.maxWidth='900px'; } }
  else{ div.style.width=el.w+'px'; if(el.h) div.style.height=el.h+'px'; }
  const label=el.type==='image'?'图片':el.type==='todo'?'待办':el.type==='sticky'?'便签':el.type==='table'?'表格':el.type==='ink'?'绘图':'文字';
  div.innerHTML=`<div class="grip"><span>⠿ ${label}</span>`+
    (el.type==='table'?`<span class="tops"><button data-op="addr">＋行</button><button data-op="delr">－行</button><button data-op="addc">＋列</button><button data-op="delc">－列</button></span>`:'')+
    `<button class="del" title="删除">✕</button></div>`+
    (el.type==='image'?`<img draggable="false" alt=""/>`:el.type==='table'?`<div class="tblWrap"><table class="tbl"></table></div>`:el.type==='ink'?`<svg class="inkSvg" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none"><path d="${inkPath(el.pts||[])}" fill="none" stroke="${el.color||'#d92d20'}" stroke-width="${el.lw||3}" stroke-linecap="round" stroke-linejoin="round"/></svg>`:`<div class="body" contenteditable="true" data-placeholder="在这里输入…"></div>`)+`<div class="resize" title="拖动调整大小；文字块双击此角恢复自动宽度">◢</div>`;
  if(el.type==='image'){ div.querySelector('img').src=el.src; }
  else if(el.type==='ink'){ div.querySelector('.inkSvg').addEventListener('mousedown',e=>startMove(e,el,div)); }
  else if(el.type==='table'){
    buildTable(div, el);
    div.querySelectorAll('[data-op]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); tableOp(el, div, b.dataset.op); });
  }
  else{
    const b=div.querySelector('.body'); renderBody(b, el);
    // read via readRich (innerText-based), never textContent: line breaks inside a
    // contenteditable live in its <div>/<br> structure, and textContent glues lines
    // together with no separator — that merged multi-line notes into one blob (v0.2.4)
    b.oninput=()=>{ readRich(b, el); scheduleSave(); };
    // clicking into text edits it — it must NOT start a move/pan
    b.onmousedown=e=>{ e.stopPropagation(); if(!e.target.closest('.imgWrap')) b.querySelectorAll('.imgWrap.sel').forEach(w=>w.classList.remove('sel')); };
    // a selected inline image is deleted with Delete/Backspace (Word behaviour)
    b.onkeydown=e=>{
      if(e.key!=='Delete'&&e.key!=='Backspace') return;
      const sel=b.querySelector('.imgWrap.sel'); if(!sel) return;
      e.preventDefault(); removeInlineImage(b, el, sel);
    };
    // an empty text block that loses focus disappears again (OneNote behaviour)
    b.onblur=()=>{ setTimeout(()=>{ if(el.type!=='todo' && el.type!=='sticky' && (el.text||'').trim()===''){ note.elements=note.elements.filter(x=>x.id!==el.id); render(); scheduleSave(); } },150); };
  }
  div.querySelector('.grip .del').onclick=()=>{ note.elements=note.elements.filter(x=>x.id!==el.id); render(); scheduleSave(); };
  div.querySelector('.grip').onmousedown=e=>startMove(e,el,div);
  // images: drag the image itself to move it (native HTML drag is disabled, so no copy/ghost)
  if(el.type==='image'){ const im=div.querySelector('img'); im.onmousedown=e=>startMove(e,el,div); im.ondblclick=e=>{ e.stopPropagation(); openLightbox(el.src); }; }
  const rz=div.querySelector('.resize'); if(rz){
    rz.onmousedown=e=>{ e.preventDefault(); e.stopPropagation(); const sx=e.clientX,sy=e.clientY,ow=el.w,oh=el.h||div.offsetHeight,owT=el.mw||div.offsetWidth;
      const mv=ev=>{
        if(isText){ // text blocks: width only — the height follows the wrapped content
          el.mw=Math.max(80, Math.round(owT+(ev.clientX-sx)/zoom));
          div.style.width=el.mw+'px'; div.style.maxWidth='none';
        } else {
          el.w=Math.max(60,ow+(ev.clientX-sx)/zoom); el.h=Math.max(36,oh+(ev.clientY-sy)/zoom);
          div.style.width=el.w+'px'; div.style.height=el.h+'px';
        }
      };
      const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
      addEventListener('mousemove',mv); addEventListener('mouseup',up); };
    if(isText) rz.ondblclick=e=>{ e.stopPropagation(); el.mw=null; render(); scheduleSave(); };
  }
  // edge resize (v0.8.0): drag a side to grow the box in that one direction —
  // the corner above keeps doing both axes at once. Text blocks resize by
  // width only (their height follows the content), so they get left/right
  // edges; image blocks get all four.
  if(isText||el.type==='image'){
    (isText?['e','w']:['e','w','n','s']).forEach(m=>{
      const ed=document.createElement('div'); ed.className='edge '+m; ed.title='拖动边框调整大小';
      ed.onmousedown=e=>{ e.preventDefault(); e.stopPropagation(); select(el.id);
        const sx=e.clientX, sy=e.clientY, ox=el.x, oy=el.y, ow=el.w||div.offsetWidth, oh=el.h||div.offsetHeight, owT=el.mw||div.offsetWidth;
        const mv=ev=>{ const dx=(ev.clientX-sx)/zoom, dy=(ev.clientY-sy)/zoom;
          if(isText){
            if(m==='e') el.mw=Math.max(80,Math.round(owT+dx));
            else { const nw=Math.max(80,Math.round(owT-dx)); el.x=Math.round(ox+(owT-nw)); el.mw=nw; }
            div.style.left=el.x+'px'; div.style.width=el.mw+'px'; div.style.maxWidth='none';
          } else {
            if(m==='e') el.w=Math.max(60,Math.round(ow+dx));
            if(m==='w'){ const nw=Math.max(60,Math.round(ow-dx)); el.x=Math.round(ox+(ow-nw)); el.w=nw; }
            if(m==='s') el.h=Math.max(36,Math.round(oh+dy));
            if(m==='n'){ const nh=Math.max(36,Math.round(oh-dy)); el.y=Math.round(oy+(oh-nh)); el.h=nh; }
            div.style.left=el.x+'px'; div.style.top=el.y+'px'; div.style.width=el.w+'px'; div.style.height=el.h+'px';
          }
        };
        const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
        addEventListener('mousemove',mv); addEventListener('mouseup',up);
      };
      div.appendChild(ed);
    });
  }
  div.onmousedown=()=>select(el.id);
  return div;
}
function select(id){ window._sel=id; document.querySelectorAll('.el').forEach(n=>n.classList.toggle('selected',n.dataset.id===id)); }
function canvasPos(clientX,clientY){ const r=$('#viewport').getBoundingClientRect(); return {x:(clientX-r.left-pan.x)/zoom, y:(clientY-r.top-pan.y)/zoom}; }
function addEl(type,x,y,extra={}){ const el={id:uid(),type,x:Math.round(x),y:Math.round(y),w:type==='image'?320:type==='table'?440:280,h:type==='image'?220:null,text:type==='todo'?'☐ 待办事项\n☐ 跟进人 / 截止日期':type==='sticky'?'便签':type==='heading'?'标题':'',...extra}; if(type==='table'&&!el.rows) el.rows=[['','',''],['','',''],['','','']]; note.elements.push(el); render(); scheduleSave(); return el; }
function typeAt(p){ const el=addEl('text',p.x,p.y); select(el.id); focusBody(el); return el; }

document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{ const el=addEl(b.dataset.add, 80+Math.random()*120 - pan.x/zoom, 80+Math.random()*80 - pan.y/zoom); select(el.id); if(el.type==='table'){ const td=document.querySelector(`[data-id="${el.id}"] td`); if(td) td.focus(); } else if(el.type!=='image') focusBody(el); });
// ---- inline images inside text blocks (v0.4.0) ------------------------------
// A text line whose whole content is {{img:<id>}} renders el.imgs[id] inline, so
// pictures sit inside the text flow (OneNote-style) instead of floating on top.
function shiftStyles(el, from, delta){
  ['marks','fonts'].forEach(k=>{ if(!el[k]) return; const o={}; Object.keys(el[k]).forEach(i=>{ const n=+i; o[n>=from?n+delta:n]=el[k][i]; }); el[k]=o; });
  if(el.runs){ const o={}; Object.keys(el.runs).forEach(i=>{ const n=+i; o[n>=from?n+delta:n]=el.runs[i]; }); el.runs=o; }
}
function dropLineStyles(el, li){ ['marks','fonts','runs'].forEach(k=>{ if(el[k]) delete el[k][li]; }); }
function insertInlineImage(b, el, src, forceLine){
  readRich(b, el);
  let li=(forceLine!=null)?forceLine:0;
  if(forceLine==null&&fmtCtx&&fmtCtx.body===b&&fmtCtx.range) li=boundaryLine(b, fmtCtx.range.startContainer, fmtCtx.range.startOffset, false);
  const lines=(el.text||'').split('\n');
  li=Math.max(0, Math.min(li, lines.length-1));
  const id=uid();
  (el.imgs=el.imgs||{})[id]={src, w:420};
  const token='{{img:'+id+'}}';
  if((lines[li]||'').trim()===''){ dropLineStyles(el, li); lines[li]=token; }
  else { lines.splice(li+1,0,token); shiftStyles(el, li+1, 1); }
  el.text=lines.join('\n');
  renderBody(b, el); scheduleSave();
  return true;
}
function removeInlineImage(b, el, wrap){
  readRich(b, el);
  const lineDiv=wrap.closest('.ln'); const li=[...b.children].indexOf(lineDiv);
  if(li<0) return;
  const lines=el.text.split('\n');
  const m=/^\{\{img:([a-z0-9]+)\}\}$/.exec(lines[li]||'');
  if(m&&el.imgs) delete el.imgs[m[1]];
  dropLineStyles(el, li);
  lines.splice(li,1); if(!lines.length) lines.push('');
  el.text=lines.join('\n'); shiftStyles(el, li+1, -1);
  renderBody(b, el); scheduleSave();
}
function editingTextTarget(allowSelected){
  if(fmtCtx&&fmtCtx.body&&document.contains(fmtCtx.body)){
    const holder=fmtCtx.body.closest('.el'); const el=holder&&note.elements.find(x=>x.id===holder.dataset.id);
    if(el&&(el.type==='text'||el.type==='heading')) return {b:fmtCtx.body, el};
  }
  if(allowSelected&&window._sel){
    const el=note.elements.find(x=>x.id===window._sel);
    if(el&&(el.type==='text'||el.type==='heading')){ const b=document.querySelector(`[data-id="${el.id}"] .body`); if(b) return {b, el}; }
  }
  return null;
}
function viewCenter(){ const r=$('#viewport').getBoundingClientRect(); return canvasPos(r.left+r.width/2, r.top+r.height/2); }
let pendingPoint=null; // canvas point from the right-click "insert image here"
function placeImage(src, allowSelected){
  const t=editingTextTarget(allowSelected);
  if(t&&insertInlineImage(t.b, t.el, src)) return;
  const p=pendingPoint||viewCenter(); pendingPoint=null;
  addEl('image', Math.round(p.x), Math.round(p.y), {src});
}
$('#imgInput').onchange=e=>{ [...e.target.files].forEach(f=>{ const r=new FileReader(); r.onload=()=>placeImage(r.result, true); r.readAsDataURL(f); }); e.target.value=''; };
addEventListener('paste',e=>{ const item=[...(e.clipboardData||[]).items||[]].find(i=>i.type.startsWith('image/')); if(item){ const r=new FileReader(); r.onload=()=>placeImage(r.result, false); r.readAsDataURL(item.getAsFile()); }});
// Ctrl+S / Cmd+S saves the note itself — never the browser's "save webpage" dialog
addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='s'){ e.preventDefault(); clearTimeout(saveTimer); save(); }
});
// ---- format bar: font + heading levels, applied per line (Word-style) -------
let fmtCtx=null; // last text selection inside a body: {body, range}
document.addEventListener('selectionchange',()=>{
  const s=getSelection(); if(!s.rangeCount) return;
  const r=s.getRangeAt(0); let n=r.startContainer;
  while(n&&!(n.classList&&n.classList.contains('body'))) n=n.parentNode;
  if(n){ fmtCtx={body:n, range:r.cloneRange()}; syncFmtBar(); }
});
function fmtTarget(){
  if(!fmtCtx||!document.contains(fmtCtx.body)) return null;
  const wrap=fmtCtx.body.closest('.el'); if(!wrap) return null;
  const el=note.elements.find(x=>x.id===wrap.dataset.id); if(!el) return null;
  return {b:fmtCtx.body, el};
}
// While typing, the browser leaves the first line as bare text nodes (only Enter
// creates <div>s). Wrap such stray lines into line divs so every line is a real
// element a style can hang on. Nodes are moved, never recreated, so the live
// selection/caret survive the reparenting.
function normalizeBody(b){
  if(![...b.childNodes].some(ch=>ch.nodeType===3||ch.nodeName==='BR')) return;
  const frag=document.createDocumentFragment(); let cur=null;
  const newDiv=()=>{ const d=document.createElement('div'); d.className='ln'; frag.appendChild(d); return d; };
  [...b.childNodes].forEach(ch=>{
    if(ch.nodeType===3){ if(!cur) cur=newDiv(); cur.appendChild(ch); }
    else if(ch.nodeName==='BR'){ if(cur){ cur.appendChild(ch); } else { newDiv().appendChild(ch); } cur=null; }
    else { cur=null; frag.appendChild(ch); }
  });
  b.appendChild(frag);
}
// data-line slots of a body in order; a slot is the line's element, or null for a
// bare-text line (no element yet, hence no style). Mirrors readRich's line split.
function lineNodes(b){
  const out=[]; let open=false;
  [...b.childNodes].forEach(ch=>{
    if(ch.nodeType===3){ if(ch.textContent && !open){ out.push(null); open=true; } }
    else if(ch.nodeName==='BR'){ if(open) open=false; else out.push(null); }
    else { out.push(ch); open=false; }
  });
  if(!out.length) out.push(null);
  return out;
}
function slotOfChild(b, target){
  let li=-1, open=false;
  for(const ch of b.childNodes){
    if(ch.nodeType===3){ if(ch.textContent && !open){ li++; open=true; } }
    else if(ch.nodeName==='BR'){ if(open) open=false; else li++; }
    else { li++; open=false; }
    if(ch===target) return Math.max(li,0);
  }
  return Math.max(li,0);
}
function boundaryLine(b, container, offset, isEnd){
  if(container===b){
    const kids=[...b.childNodes]; if(!kids.length) return 0;
    return slotOfChild(b, kids[Math.max(0, Math.min(isEnd?offset-1:offset, kids.length-1))]);
  }
  let n=container; while(n&&n.parentNode!==b) n=n.parentNode;
  return n?slotOfChild(b, n):0;
}
function childIndexAt(b, container, offset, isEnd){
  if(container===b) return isEnd?offset-1:offset;
  let n=container; while(n&&n.parentNode!==b) n=n.parentNode;
  return n?[...b.childNodes].indexOf(n):0;
}
function targetLines(b, range){
  const divs=[...b.children]; if(!divs.length) return [];
  if(!range) return [divs[0]];
  const kids=[...b.childNodes];
  const si=childIndexAt(b, range.startContainer, range.startOffset, false);
  let ei=childIndexAt(b, range.endContainer, range.endOffset, true);
  // a triple-clicked line's selection often ends at offset 0 of the NEXT line;
  // that next line is not part of the selection (Word behaves the same way)
  if(ei>si && range.endOffset===0){
    const lineEl=divs[ei];
    if(lineEl && (range.endContainer===lineEl || lineEl.contains(range.endContainer))){
      const probe=document.createRange(); probe.setStart(lineEl,0); probe.setEnd(range.endContainer, range.endOffset);
      if(probe.toString().length===0) ei--;
    }
  }
  const hit=divs.filter(d=>{ const i=kids.indexOf(d); return i>=Math.min(si,ei)&&i<=Math.max(si,ei); });
  return hit.length?hit:[divs[0]];
}
function applyFmt(mut){
  const t=fmtTarget(); if(!t) return;
  readRich(t.b, t.el); // fold the latest edits into the model first
  normalizeBody(t.b); // every line becomes a real element (see above)
  if(!t.b.children.length) renderBody(t.b, t.el);
  targetLines(t.b, fmtCtx.range).forEach(mut);
  readRich(t.b, t.el); scheduleSave(); syncFmtBar();
  // give the caret back to the text so the user can keep typing
  try{ t.b.focus(); const s=getSelection(); s.removeAllRanges(); s.addRange(fmtCtx.range); }
  catch(e){ focusBody(t.el); }
}
function applyLevel(lv){ applyFmt(d=>{ d.className='ln'+(lv?' lv-'+lv:''); }); }
function applyFont(stack){ applyFmt(d=>{ d.style.fontFamily=stack; }); }
// ---- character-level colour (v0.2.9): colour applies to the exact selection --
function lineTextOffset(lineDiv, container, offset){
  if(!lineDiv) return 0;
  if(container===lineDiv){ let n=0; const kids=[...lineDiv.childNodes]; for(let i=0;i<Math.min(offset,kids.length);i++) n+=kids[i].textContent.length; return n; }
  let n=0; const walker=document.createTreeWalker(lineDiv, NodeFilter.SHOW_TEXT); let cur;
  while(cur=walker.nextNode()){ if(cur===container) return n+Math.min(offset, cur.textContent.length); n+=cur.textContent.length; }
  return n;
}
function applyRuns(el, lineIdx, s, e, c){
  if(e<=s) return;
  const out=[];
  ((el.runs&&el.runs[lineIdx])||[]).forEach(r=>{
    if(r.e<=s||r.s>=e){ out.push(r); return; }
    if(r.s<s) out.push({s:r.s, e:s, c:r.c});
    if(r.e>e) out.push({s:e, e:r.e, c:r.c});
  });
  if(c) out.push({s, e, c});
  out.sort((a,b)=>a.s-b.s);
  const merged=[]; out.forEach(r=>{ const last=merged[merged.length-1]; if(last&&last.c===r.c&&last.e===r.s) last.e=r.e; else merged.push({...r}); });
  el.runs=el.runs||{};
  if(merged.length) el.runs[lineIdx]=merged; else delete el.runs[lineIdx];
}
function selectRangeByOffsets(b, sLine, sOff, eLine, eOff){
  const divs=[...b.children]; if(!divs.length) return;
  const point=(div, off)=>{
    const walker=document.createTreeWalker(div, NodeFilter.SHOW_TEXT); let cur, acc=0;
    while(cur=walker.nextNode()){ if(acc+cur.textContent.length>=off) return [cur, off-acc]; acc+=cur.textContent.length; }
    return [div, div.childNodes.length];
  };
  const sp=point(divs[Math.min(sLine, divs.length-1)], sOff);
  const ep=point(divs[Math.min(eLine, divs.length-1)], eOff);
  const r=document.createRange(); r.setStart(sp[0], sp[1]); r.setEnd(ep[0], ep[1]);
  const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r);
  fmtCtx={body:b, range:r.cloneRange()};
}
function applyColor(c){
  const t=fmtTarget(); if(!t) return;
  readRich(t.b, t.el); // fold the latest edits (and any legacy line colours) into the model
  normalizeBody(t.b); // every line becomes a real element
  if(!t.b.children.length) renderBody(t.b, t.el);
  const range=fmtCtx.range; if(!range) return;
  const divs=[...t.b.children];
  const lineLen=i=>(t.el.text.split('\n')[i]||'').length;
  let sLine=boundaryLine(t.b, range.startContainer, range.startOffset, false);
  let eLine=boundaryLine(t.b, range.endContainer, range.endOffset, true);
  let sOff=lineTextOffset(divs[sLine], range.startContainer, range.startOffset);
  let eOff=lineTextOffset(divs[eLine], range.endContainer, range.endOffset);
  if(eOff===0&&eLine>sLine){ eLine--; eOff=lineLen(eLine); } // triple-click spill into the next line
  if(sLine===eLine&&sOff===eOff){ sOff=0; eOff=lineLen(sLine); } // caret only: colour the whole line (v0.2.8 behaviour)
  for(let i=sLine;i<=eLine;i++) applyRuns(t.el, i, i===sLine?sOff:0, i===eLine?eOff:lineLen(i), c);
  renderBody(t.b, t.el); scheduleSave(); syncFmtBar();
  try{ t.b.focus(); selectRangeByOffsets(t.b, sLine, sOff, eLine, eOff); }
  catch(e){ focusBody(t.el); }
}
function cssToHex(c){
  if(!c) return null;
  if(/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); if(!m) return null;
  return '#'+[1,2,3].map(i=>(+m[i]).toString(16).padStart(2,'0')).join('');
}
function syncFmtBar(){
  const t=fmtTarget(); if(!t) return;
  const li=boundaryLine(t.b, fmtCtx.range.startContainer, fmtCtx.range.startOffset, false);
  const first=lineNodes(t.b)[li];
  const m=first?/lv-(h[123])/.exec(first.className||''):null;
  document.querySelectorAll('.lvBtn').forEach(btn=>btn.classList.toggle('on',(btn.dataset.lv||'')===(m?m[1]:'')));
  const fs=$('#fontSel'); const want=(first&&first.style&&first.style.fontFamily)||'';
  if([...fs.options].some(o=>o.value===want)) fs.value=want;
  let colAtCaret='';
  { let n=fmtCtx.range.startContainer; while(n&&n!==t.b){ if(n.style&&n.style.color){ colAtCaret=n.style.color; break; } n=n.parentNode; } }
  const hex=cssToHex(colAtCaret||(first&&first.style?first.style.color:''));
  if(hex) $('#colorPick').value=hex; // the picker opens at the colour under the caret
}
document.querySelectorAll('.lvBtn').forEach(btn=>{
  btn.addEventListener('mousedown',e=>e.preventDefault()); // keep the text selection alive
  btn.addEventListener('click',()=>applyLevel(btn.dataset.lv||''));
});
$('#fontSel').addEventListener('change',e=>applyFont(e.target.value));
document.querySelectorAll('.colorBtn').forEach(btn=>{
  btn.addEventListener('mousedown',e=>e.preventDefault()); // keep the text selection alive
  btn.addEventListener('click',()=>applyColor(btn.dataset.color||''));
});
$('#colorPick').addEventListener('change',e=>applyColor(e.target.value));
// Ctrl+Alt+0/1/2/3 switch the current line's level (OneNote-style)
addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.altKey&&['0','1','2','3'].includes(e.key)){
    if(!fmtTarget()) return;
    e.preventDefault(); applyLevel(e.key==='0'?'':'h'+e.key);
  }
});
// kill the browser's native drag for anything on the canvas: dragging an image must move it, never copy it
document.addEventListener('dragstart',e=>{ if(e.target.closest && e.target.closest('#canvas')) e.preventDefault(); });
$('#viewport').addEventListener('dragover',e=>e.preventDefault());
$('#viewport').addEventListener('drop',e=>{
  e.preventDefault();
  const files=[...(e.dataTransfer.files||[])].filter(f=>f.type.startsWith('image/'));
  if(!files.length) return; // internal drags carry no Files — ignore them so nothing duplicates
  const p=canvasPos(e.clientX,e.clientY);
  const dropBody=e.target.closest?e.target.closest('.el .body'):null;
  files.forEach((f,i)=>{ const r=new FileReader(); r.onload=()=>{
    if(dropBody){ // dropped onto a text block: embed at the nearest line instead of floating
      const holder=dropBody.closest('.el'); const el=holder&&note.elements.find(x=>x.id===holder.dataset.id);
      if(el&&(el.type==='text'||el.type==='heading')){
        const divs=[...dropBody.children]; let li=divs.length-1;
        for(let j=0;j<divs.length;j++){ if(e.clientY<divs[j].getBoundingClientRect().bottom){ li=j; break; } }
        insertInlineImage(dropBody, el, r.result, li); return;
      }
    }
    addEl('image',p.x+i*24,p.y+i*24,{src:r.result});
  }; r.readAsDataURL(f); });
});
// right-click on blank areas (canvas or the sidebar's empty space) pops a
// centred calendar to create/open a note for any day (v0.2.7; centred inline
// calendar since v0.3.0 — no second click to open a native date picker)
const ctxNew=$('#ctxNew');
let calView=null; // {y, m} — the month the popup calendar is showing
function renderCal(){
  const t0=today();
  $('#calTitle').textContent=calView.y+'年'+(calView.m+1)+'月';
  const startDay=(new Date(calView.y, calView.m, 1).getDay()+6)%7; // Monday-first grid
  const days=new Date(calView.y, calView.m+1, 0).getDate();
  let html='';
  ['一','二','三','四','五','六','日'].forEach(d=>html+='<div class="calWd">'+d+'</div>');
  for(let i=0;i<startDay;i++) html+='<div></div>';
  for(let d=1;d<=days;d++){
    const ds=calView.y+'-'+String(calView.m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    html+='<div class="calDay'+(ds===t0?' today':'')+'" data-d="'+ds+'">'+d+'</div>';
  }
  $('#calGrid').innerHTML=html;
  $('#calGrid').querySelectorAll('.calDay').forEach(el=>el.onclick=()=>{ hideCtxNew(); loadNote(el.dataset.d,{create:true}); });
}
function showCtxNew(){
  const diary=curBook().kind==='diary';
  $('#calWrap').hidden=!diary; $('#ctxToday').hidden=!diary; $('#ctxNewPage').hidden=diary;
  const n=new Date(); calView={y:n.getFullYear(), m:n.getMonth()};
  renderCal(); ctxNew.hidden=false;
}
function hideCtxNew(){ ctxNew.hidden=true; }
$('#calPrev').onclick=()=>{ calView.m--; if(calView.m<0){ calView.m=11; calView.y--; } renderCal(); };
$('#calNext').onclick=()=>{ calView.m++; if(calView.m>11){ calView.m=0; calView.y++; } renderCal(); };
$('#ctxToday').onclick=()=>{ hideCtxNew(); loadNote(today(),{create:true}); };
$('#ctxNewPage').onclick=()=>{ hideCtxNew(); createPage(); };
$('#ctxCancel').onclick=hideCtxNew;
let ctxPoint=null; // canvas coords of the right-click, for "insert here" (v0.4.0)
$('#ctxInsText').onclick=()=>{ hideCtxNew(); const p=ctxPoint||viewCenter(); const el=addEl('text', Math.round(p.x), Math.round(p.y)); select(el.id); focusBody(el); };
$('#ctxInsImg').onclick=()=>{ hideCtxNew(); pendingPoint=ctxPoint; $('#imgInput').click(); };
$('#viewport').addEventListener('contextmenu',e=>{
  if(e.target.id!=='viewport'&&e.target.id!=='canvas') return; // blank canvas only
  e.preventDefault(); ctxPoint=canvasPos(e.clientX,e.clientY); showCtxNew();
});
document.querySelector('aside').addEventListener('contextmenu',e=>{
  if(e.target.closest('button,input,select,textarea,.noteItem,.treeRow')) return;
  e.preventDefault(); ctxPoint=viewCenter(); showCtxNew();
});
document.addEventListener('mousedown',e=>{ if(!ctxNew.hidden&&!e.target.closest('#ctxNew')) hideCtxNew(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') hideCtxNew(); });
// empty canvas: drag = pan, click without moving = type right there (OneNote behaviour)
$('#viewport').addEventListener('mousedown',e=>{
  if(e.button!==0) return; // left button only — a right click opens the new-note popup, never a text block
  if(e.target.id!=='viewport'&&e.target.id!=='canvas') return;
  const sx=e.clientX, sy=e.clientY, ox=pan.x, oy=pan.y; let moved=false;
  const mv=ev=>{ if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>4) moved=true; if(moved){ pan.x=ox+ev.clientX-sx; pan.y=oy+ev.clientY-sy; applyTransform(); } };
  const up=ev=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up);
    if(!moved) typeAt(canvasPos(ev.clientX,ev.clientY)); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
});
(function(){
  let tTarget=null, tId=null, downSent=false;
  function synth(type, t, target){
    const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:t.clientX,clientY:t.clientY,button:0,buttons:type==='mouseup'?0:1});
    e._fromTouch=true; target.dispatchEvent(e);
  }
  // swallow the browser's own compatibility mousedown for a touch we already
  // translated, so handlers never see the same press twice
  document.addEventListener('mousedown',e=>{ if(tTarget&&downSent&&!e._fromTouch){ e.stopPropagation(); e.preventDefault(); } },true);
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1){ tTarget=null; return; }
    const t=e.touches[0], el=document.elementFromPoint(t.clientX,t.clientY);
    if(!el||!el.closest('#viewport')){ tTarget=null; return; }
    if(!drawMode&&el.closest('.body')){ tTarget=null; return; } // text editing keeps native touch
    tTarget=el; tId=t.identifier; downSent=true;
    synth('mousedown', t, el);
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!tTarget) return;
    for(const t of e.changedTouches){ if(t.identifier!==tId) continue;
      synth('mousemove', t, tTarget);
      if(e.cancelable) e.preventDefault();
    }
  },{passive:false});
  const end=e=>{
    if(!tTarget) return;
    for(const t of e.changedTouches){ if(t.identifier!==tId) continue;
      synth('mouseup', t, tTarget);
      setTimeout(()=>{ tTarget=null; tId=null; downSent=false; }, 50);
    }
  };
  document.addEventListener('touchend',end); document.addEventListener('touchcancel',end);
})();
// mouse wheel scrolls the page up/down (v0.4.0, OneNote behaviour); Ctrl+wheel zooms at the cursor
function clampPan(){
  const vw=$('#viewport').clientWidth, vh=$('#viewport').clientHeight;
  pan.x=Math.max(Math.min(60, vw-4000*zoom-40), Math.min(60, pan.x));
  pan.y=Math.max(Math.min(60, vh-3000*zoom-40), Math.min(60, pan.y));
}
$('#viewport').addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.ctrlKey){
    const f=e.deltaY<0?1.08:1/1.08, nz=Math.max(.3,Math.min(2,zoom*f));
    const r=$('#viewport').getBoundingClientRect(), cx=e.clientX-r.left, cy=e.clientY-r.top;
    pan.x=cx-(cx-pan.x)*(nz/zoom); pan.y=cy-(cy-pan.y)*(nz/zoom); zoom=nz;
  } else { pan.y-=e.deltaY; pan.x-=e.deltaX; }
  clampPan(); applyTransform();
},{passive:false});
$('#zoomIn').onclick=()=>{zoom=Math.min(2,zoom*1.15);applyTransform()}; $('#zoomOut').onclick=()=>{zoom=Math.max(.3,zoom/1.15);applyTransform()};
$('#fitBtn').onclick=()=>{pan={x:20,y:20};zoom=1;applyTransform()};
$('#todayBtn').onclick=()=>loadNote(today(),{create:true});
$('#datePick').onchange=e=>{ if(e.target.value) loadNote(e.target.value,{create:true}); };
$('#search').oninput=refreshList;
$('#title').oninput=scheduleSave;
$('#exportBtn').onclick=()=>{ const data=JSON.stringify(note,null,2), name=date+'-纪要.json';
  if(window.AndroidBridge&&AndroidBridge.saveText){ AndroidBridge.saveText(name, data); markSaved('已导出到手机的下载目录'); return; }
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type:'application/json'})); a.download=name; a.click(); };
async function deleteNote(d){
  clearTimeout(saveTimer); // a pending autosave must not resurrect the note
  const t=(d===date&&note.title)?'「'+note.title+'」':'';
  if(!confirm('确定删除 '+(isDateId(d)?d+' ':'')+t+'这一篇吗？删除后无法恢复。')) return;
  if(saveInFlight){ try{ await saveInFlight; }catch{} saveInFlight=null; } // let a running save land first, then delete wins
  tombstones.add(d);
  try{ if(!useServer) throw 0; await api('/api/notes/'+d,{method:'DELETE'}); }
  catch{ if(!useServer) localStorage.removeItem('notebook:'+d); else { tombstones.delete(d); markSaved('删除失败：服务端无响应'); return; } }
  if(d===date){
    const list=await listAllNotes();
    const mine=list.filter(x=>(x.book||'diary')===bookId);
    if(curBook().kind==='diary'){
      const next=mine.find(x=>x.date>d)||[...mine].reverse().find(x=>x.date<d);
      await loadNote(next?next.id:today());
    } else {
      mine.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
      if(mine.length) await loadNote(mine[0].id); else await createPage();
    }
  } else refreshList();
  markSaved('已删除');
}
$('#delBtn').onclick=()=>deleteNote(date);

// ---- ink drawing (v0.9.0, OneNote-style) --------------------------------------
// Each finished stroke becomes its own ink element: a smoothed SVG path in a
// bounding box, so it can be selected, moved, resized and deleted like any
// other block. Draw mode intercepts canvas mousedowns in the capture phase,
// so the pen also draws over existing blocks, exactly like OneNote ink.
function inkPath(pts){
  if(!pts||!pts.length) return '';
  if(pts.length<3) return 'M'+pts.map(p=>p[0]+' '+p[1]).join(' L ');
  let d=`M ${pts[0][0]} ${pts[0][1]}`;
  for(let i=1;i<pts.length-1;i++){ const mx=Math.round((pts[i][0]+pts[i+1][0])/2*10)/10, my=Math.round((pts[i][1]+pts[i+1][1])/2*10)/10; d+=` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`; }
  return d+` L ${pts[pts.length-1][0]} ${pts[pts.length-1][1]}`;
}
let drawMode=false, penColor='#d92d20', penWidth=3.5, erasing=false;
const inkUndo=[], inkRedo=[]; // stroke history for Ctrl+Z / Ctrl+Y in draw mode (v0.9.1)
function setDrawMode(on){
  drawMode=on; erasing=false;
  $('#penBar').hidden=!on;
  $('#penBtn').classList.toggle('on',on);
  $('#eraseBtn').classList.remove('on');
  $('#viewport').classList.toggle('drawing',on);
}
$('#penBtn').onclick=()=>setDrawMode(!drawMode);
$('#penExit').onclick=()=>setDrawMode(false);
document.querySelectorAll('#penBar .psw').forEach(b=>b.onclick=()=>{ penColor=b.dataset.c; erasing=false; $('#eraseBtn').classList.remove('on'); document.querySelectorAll('#penBar .psw').forEach(x=>x.classList.toggle('on',x===b)); });
document.querySelectorAll('#penBar .plw').forEach(b=>b.onclick=()=>{ penWidth=parseFloat(b.dataset.lw); document.querySelectorAll('#penBar .plw').forEach(x=>x.classList.toggle('on',x===b)); });
$('#eraseBtn').onclick=()=>{ erasing=!erasing; $('#eraseBtn').classList.toggle('on',erasing); };
function finishStroke(pts){
  if(!pts.length) return;
  inkRedo.length=0; // a fresh stroke invalidates the redo stack
  if(pts.length===1) pts.push({x:pts[0].x+0.1, y:pts[0].y});
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y), pad=penWidth+2;
  const x0=Math.min(...xs)-pad, y0=Math.min(...ys)-pad, x1=Math.max(...xs)+pad, y1=Math.max(...ys)+pad;
  const el={id:uid(), type:'ink', x:Math.round(x0), y:Math.round(y0), w:Math.max(4,Math.round(x1-x0)), h:Math.max(4,Math.round(y1-y0)), color:penColor, lw:penWidth,
    pts:pts.map(p=>[Math.round((p.x-x0)*10)/10, Math.round((p.y-y0)*10)/10])};
  note.elements.push(el); inkUndo.push({act:'add', el, idx:note.elements.length-1}); render(); scheduleSave(); select(el.id);
}
function eraseAt(clientX, clientY){
  const p=canvasPos(clientX, clientY);
  for(let i=note.elements.length-1;i>=0;i--){ const el=note.elements[i];
    if(el.type==='ink'&&p.x>=el.x-6&&p.x<=el.x+el.w+6&&p.y>=el.y-6&&p.y<=el.y+el.h+6){ note.elements.splice(i,1); inkUndo.push({act:'erase', el, idx:i}); inkRedo.length=0; render(); scheduleSave(); return; } }
}
$('#viewport').addEventListener('mousedown',e=>{
  if(!drawMode||e.button!==0) return;
  e.preventDefault(); e.stopPropagation();
  if(erasing){ eraseAt(e.clientX,e.clientY);
    const mv=ev=>eraseAt(ev.clientX,ev.clientY);
    const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up); return;
  }
  const pts=[canvasPos(e.clientX,e.clientY)];
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','inkLive'); svg.setAttribute('width','4000'); svg.setAttribute('height','3000');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('fill','none'); path.setAttribute('stroke',penColor); path.setAttribute('stroke-width',penWidth);
  path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round');
  svg.appendChild(path); $('#canvas').appendChild(svg);
  const mv=ev=>{ const p=canvasPos(ev.clientX,ev.clientY), l=pts[pts.length-1];
    if(Math.hypot(p.x-l.x,p.y-l.y)>=2){ pts.push(p); path.setAttribute('d',inkPath(pts.map(q=>[Math.round(q.x*10)/10,Math.round(q.y*10)/10]))); } };
  const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); svg.remove(); finishStroke(pts); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
}, true);
function inkUndoOnce(){
  const h=inkUndo.pop(); if(!h) return;
  if(h.act==='add'){ const i=note.elements.findIndex(e=>e.id===h.el.id); if(i>=0) note.elements.splice(i,1); }
  else note.elements.splice(Math.min(h.idx, note.elements.length), 0, h.el);
  inkRedo.push(h); render(); scheduleSave();
}
function inkRedoOnce(){
  const h=inkRedo.pop(); if(!h) return;
  if(h.act==='add') note.elements.splice(Math.min(h.idx, note.elements.length), 0, h.el);
  else { const i=note.elements.findIndex(e=>e.id===h.el.id); if(i>=0) note.elements.splice(i,1); }
  inkUndo.push(h); render(); scheduleSave();
}
$('#undoBtn').onclick=inkUndoOnce;
$('#redoBtn').onclick=inkRedoOnce;
document.addEventListener('keydown',e=>{
  if(!drawMode) return;
  const ae=document.activeElement;
  if(ae&&(ae.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(ae.tagName))) return;
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){ e.preventDefault(); inkUndoOnce(); }
  else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||(e.shiftKey&&e.key.toLowerCase()==='z'))){ e.preventDefault(); inkRedoOnce(); }
});
// Delete key removes the selected block (v0.9.1, kalo's ask for ink strokes;
// applies to any selected block when not editing text)
document.addEventListener('keydown',e=>{
  if(e.key!=='Delete'&&e.key!=='Backspace') return;
  const ae=document.activeElement;
  if(ae&&(ae.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(ae.tagName))) return;
  const id=window._sel; if(!id) return;
  const i=note.elements.findIndex(el=>el.id===id); if(i<0) return;
  e.preventDefault();
  note.elements.splice(i,1); window._sel=null; render(); scheduleSave();
});

// ---- collections rail (v0.5.0) ----------------------------------------------
async function refreshBooks(){
  if(serverMode==='new'){ try{ books=await api('/api/books'); }catch{} }
  else if(serverMode==='old'){ books=[{id:'diary',name:'日记',kind:'diary'}]; bookId='diary'; }
  else { try{ const bs=JSON.parse(localStorage.getItem('notebook:books')||'null'); if(Array.isArray(bs)&&bs.length) books=bs; }catch{} }
  if(!books.find(b=>b.id===bookId)) bookId='diary';
  const box=$('#bookList');
  box.innerHTML=books.map(b=>`<div class="bookItem ${b.id===bookId?'active':''}" data-bk="${b.id}" title="${b.kind==='diary'?'按日期的日记合集':'自由页面合集'} · 单击切换 · 双击改名"><span class="bic">${b.kind==='diary'?'📅':'📓'}</span><span class="bname">${esc(b.name)}</span>${b.kind!=='diary'?`<span class="bdel" data-bdel="${b.id}" title="删除这个合集">✕</span>`:''}</div>`).join('');
  box.querySelectorAll('.bookItem').forEach(el=>{ el.onclick=()=>switchBook(el.dataset.bk); el.ondblclick=()=>renameBook(el.dataset.bk); });
  box.querySelectorAll('[data-bdel]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); deleteBook(x.dataset.bdel); });
  const diary=curBook().kind==='diary';
  $('#diaryTools').hidden=!diary; $('#pageTools').hidden=diary;
  $('#search').placeholder=diary?'搜索日期或标题…':'搜索页面标题…';
  $('#oldServerTip').hidden=!oldServer;
  $('#bookAdd').style.display=oldServer?'none':'';
}
async function openBookHome(){
  if(curBook().kind==='diary'){ loadNote(today()); return; }
  const list=await listAllNotes();
  const mine=list.filter(n=>(n.book||'diary')===bookId).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  if(mine.length) loadNote(mine[0].id); else createPage();
}
async function switchBook(id){
  if(id===bookId){ refreshBooks(); return; }
  clearTimeout(saveTimer); if(note&&note.id) await save(); // flush the current note under its own book first
  bookId=id; localStorage.setItem('nb-book', id);
  await refreshBooks();
  await openBookHome();
  refreshList();
}
async function createPage(folder='', parent=''){
  const id='pg_'+uid();
  note={id, book:bookId, date:null, folder, parent, title:'未命名页面', elements:[]}; date=id;
  if(folder) expandedFolders.add(bookId+':'+folder);
  if(parent) expandedPages.add(parent);
  $('#title').value=note.title; render();
  await save(); markSaved('已新建页面（可在顶部改名）');
  $('#title').focus(); $('#title').select(); refreshList();
}
$('#navBtn').onclick=()=>document.body.classList.toggle('nav-open');
$('#pageNewBtn').onclick=()=>createPage();
$('#bookAdd').onclick=async()=>{
  const name=prompt('新合集的名字（例如：学习、工作、随笔）');
  if(!name||!name.trim()) return;
  let b=null;
  try{ if(!useServer) throw 0; b=await api('/api/books',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})}); }
  catch{ if(!lsOK()){ markSaved('新建合集失败：服务端无响应'); return; } b={id:'bk_'+uid(), name:name.trim(), kind:'free'}; books.push(b); localStorage.setItem('notebook:books', JSON.stringify(books)); }
  await refreshBooks(); switchBook(b.id);
};
async function renameBook(id){
  const b=books.find(x=>x.id===id); if(!b) return;
  const name=prompt('合集改名', b.name);
  if(!name||!name.trim()||name.trim()===b.name) return;
  try{ if(!useServer) throw 0; await api('/api/books/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})}); }
  catch{ if(!lsOK()){ markSaved('改名失败：服务端无响应'); return; } b.name=name.trim(); localStorage.setItem('notebook:books', JSON.stringify(books)); }
  refreshBooks();
}
async function deleteBook(id){
  const b=books.find(x=>x.id===id); if(!b||b.kind==='diary') return;
  if(!confirm('确定删除合集「'+b.name+'」吗？里面的页面会一起删除，无法恢复。')) return;
  try{ if(!useServer) throw 0; await api('/api/books/'+id,{method:'DELETE'}); }
  catch{ if(!lsOK()){ markSaved('删除合集失败：服务端无响应'); return; } books=books.filter(x=>x.id!==id); localStorage.setItem('notebook:books', JSON.stringify(books));
    Object.keys(localStorage).filter(k=>k.startsWith('notebook:pg_')).forEach(k=>{ try{ const n=JSON.parse(localStorage.getItem(k)); if(n&&n.book===id) localStorage.removeItem(k); }catch{} }); }
  if(bookId===id){ bookId='diary'; localStorage.setItem('nb-book','diary'); }
  await refreshBooks(); await openBookHome(); refreshList();
}
// ---- folders inside free books (v0.6.0) -------------------------------------
let folders=[]; const expandedFolders=new Set();
async function refreshFolders(){
  folders=[];
  if(curBook().kind==='diary') return;
  if(serverMode==='new'){ try{ folders=(await api('/api/folders?book='+encodeURIComponent(bookId))).map(f=>f.name); }catch{} }
  else if(lsOK()){ try{ folders=JSON.parse(localStorage.getItem('notebook:folders')||'[]').filter(f=>f.book===bookId).map(f=>f.name); }catch{} }
}
$('#folderAddBtn').onclick=async()=>{
  const name=prompt('新文件夹的名字（例如：2026 会议、部门培训）');
  if(!name||!name.trim()) return;
  const nm=name.trim();
  try{ if(!useServer) throw 0; await api('/api/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({book:bookId,name:nm})}); }
  catch{ if(!lsOK()){ markSaved('建文件夹失败：服务端无响应'); return; }
    const all=JSON.parse(localStorage.getItem('notebook:folders')||'[]'); if(!all.some(f=>f.book===bookId&&f.name===nm)) all.push({book:bookId,name:nm}); localStorage.setItem('notebook:folders',JSON.stringify(all)); }
  expandedFolders.add(bookId+':'+nm); refreshList();
};
async function renameFolder(oldName){
  const nm=prompt('文件夹改名', oldName);
  if(!nm||!nm.trim()||nm.trim()===oldName) return;
  const newName=nm.trim();
  try{ if(!useServer) throw 0; await api('/api/folders',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({book:bookId,name:oldName,newName})}); }
  catch{ if(!lsOK()){ markSaved('文件夹改名失败：服务端无响应'); return; }
    const all=JSON.parse(localStorage.getItem('notebook:folders')||'[]'); const f=all.find(x=>x.book===bookId&&x.name===oldName); if(f) f.name=newName; localStorage.setItem('notebook:folders',JSON.stringify(all));
    Object.keys(localStorage).filter(k=>k.startsWith('notebook:pg_')).forEach(k=>{ try{ const n=JSON.parse(localStorage.getItem(k)); if(n&&n.book===bookId&&n.folder===oldName){ n.folder=newName; localStorage.setItem(k,JSON.stringify(n)); } }catch{} }); }
  if(note&&note.folder===oldName) note.folder=newName;
  expandedFolders.delete(bookId+':'+oldName); expandedFolders.add(bookId+':'+newName);
  refreshList();
}
async function deleteFolder(name){
  if(!confirm('确定删除文件夹「'+name+'」吗？里面的页面会移到根目录，不会被删除。')) return;
  try{ if(!useServer) throw 0; await api('/api/folders?book='+encodeURIComponent(bookId)+'&name='+encodeURIComponent(name),{method:'DELETE'}); }
  catch{ if(!lsOK()){ markSaved('删文件夹失败：服务端无响应'); return; }
    const all=JSON.parse(localStorage.getItem('notebook:folders')||'[]').filter(f=>!(f.book===bookId&&f.name===name)); localStorage.setItem('notebook:folders',JSON.stringify(all));
    Object.keys(localStorage).filter(k=>k.startsWith('notebook:pg_')).forEach(k=>{ try{ const n=JSON.parse(localStorage.getItem(k)); if(n&&n.book===bookId&&n.folder===name){ n.folder=''; localStorage.setItem(k,JSON.stringify(n)); } }catch{} }); }
  if(note&&note.folder===name) note.folder='';
  expandedFolders.delete(bookId+':'+name);
  refreshList();
}
// auto-stop heartbeat (v0.7.0): while any UI tab is open the server stays up;
// closing the last tab beacons /api/bye and the server exits on its own —
// no more stop-windows.bat. Reloads are safe: the new page's first heartbeat
// cancels the pending exit.
function startHeartbeat(){
  if(!useServer) return;
  const beat=()=>{ fetch('/api/heartbeat',{method:'POST'}).catch(()=>{}); };
  beat(); setInterval(beat, 5000);
  addEventListener('pagehide', ()=>{ if(navigator.sendBeacon) navigator.sendBeacon('/api/bye'); });
}
// ---- image lightbox (v0.8.0): double-click an image to view it full screen --
function openLightbox(src){
  const lb=$('#lightbox'); $('#lightboxImg').src=src; lb.hidden=false;
  if(lb.requestFullscreen) lb.requestFullscreen().catch(()=>{});
}
function closeLightbox(){
  $('#lightbox').hidden=true;
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
}
$('#lightbox').onclick=closeLightbox;
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!$('#lightbox').hidden) closeLightbox(); });

// ---- page tree rows + right-click menu (v0.8.0) ------------------------------
const expandedPages=new Set(); const pageCache=new Map();
function pageRowHtml(n, depth, has, open){
  return `<div class="noteItem pageItem ${n.id===date?'active':''}" data-pg="${n.id}" style="margin-left:${depth*16}px" title="单击打开 · 双击改名 · 右键新建同级/下级笔记"><span class="ptog" data-tog="${n.id}">${has?(open?'▾':'▸'):''}</span><span class="picon">${has?'📁':'📄'}</span><span class="tt">${esc(n.title)||'<i>未命名页面</i>'}</span><small>${(n.updatedAt||'').slice(0,10)}</small><span class="tdel" data-delpg="${n.id}" title="删除这一页">✕</span></div>`;
}
function wirePageRows(box){
  box.querySelectorAll('.pageItem').forEach(el=>{
    el.onclick=()=>loadNote(el.dataset.pg);
    el.ondblclick=()=>{ $('#title').focus(); $('#title').select(); };
    el.oncontextmenu=e=>{ e.preventDefault(); e.stopPropagation(); showPageCtx(e, el.dataset.pg); };
  });
  box.querySelectorAll('[data-tog]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); const id=x.dataset.tog; expandedPages.has(id)?expandedPages.delete(id):expandedPages.add(id); refreshList(); });
  box.querySelectorAll('[data-delpg]').forEach(x=>x.onclick=e=>{ e.stopPropagation(); deleteNote(x.dataset.delpg); });
}
let ctxPageId=null;
function showPageCtx(e, id){
  ctxPageId=id;
  const m=$('#pageCtx'); m.hidden=false;
  m.style.left=Math.min(e.clientX, innerWidth-240)+'px';
  m.style.top=Math.min(e.clientY, innerHeight-110)+'px';
}
function hidePageCtx(){ $('#pageCtx').hidden=true; ctxPageId=null; }
$('#pcSibling').onclick=()=>{ const p=pageCache.get(ctxPageId); hidePageCtx(); if(p) createPage(p.folder||'', p.parent||''); };
$('#pcChild').onclick=()=>{ const p=pageCache.get(ctxPageId); hidePageCtx(); if(p) createPage(p.folder||'', p.id); };
document.addEventListener('mousedown',e=>{ if(!$('#pageCtx').hidden&&!e.target.closest('#pageCtx')) hidePageCtx(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') hidePageCtx(); });

(async()=>{ await detectMode(); startHeartbeat(); await refreshBooks(); await openBookHome(); })();
