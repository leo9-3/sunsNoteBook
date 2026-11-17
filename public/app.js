// Intranet Notebook — freeform canvas (OneNote-style)
// v0.1.1: click any empty spot to type right there (no block dragging needed);
//         images move by dragging the image itself and never duplicate via native drag.
// Elements: {id,type:'text'|'heading'|'sticky'|'todo'|'image',x,y,w,h,text?,src?}
const $=s=>document.querySelector(s);
const today=()=>{const d=new Date();return d.toISOString().slice(0,10)};
let date=today(), note={date,title:'',elements:[]}, zoom=1, pan={x:20,y:20}, saveTimer=null, useServer=true;
const uid=()=>Math.random().toString(36).slice(2,10);

async function api(path,opts){ const r=await fetch(path,opts); if(!r.ok) throw new Error(r.status); return r.json(); }
async function loadNote(d, opts={}){
  const wasOpen=(date===d);
  date=d; expandFor(d);
  let fresh=false;
  try{ note=await api('/api/notes/'+d); fresh=!note.updatedAt; }
  catch{ useServer=false; const raw=localStorage.getItem('notebook:'+d); fresh=!raw; note=JSON.parse(raw||JSON.stringify({date:d,title:'',elements:[]})); }
  if(!note.elements) note.elements=[];
  $('#title').value=note.title||''; render(); refreshList();
  if(opts.create&&fresh){
    // explicit "new note" click: persist at once so the tree shows the new entry,
    // and put the cursor in the title box — without this the button looked dead
    await save(); markSaved('已新建 '+d+'，在顶部标题栏给它起个名');
    $('#title').focus(); $('#title').select();
  } else if(opts.create&&wasOpen){
    markSaved(d+' 的纪要已经在打开状态');
    $('#title').focus(); $('#title').select();
  } else markSaved('已打开 '+d);
}
async function save(){
  markSaved('保存中…'); note.title=$('#title').value; note.date=date;
  // never persist empty text blocks (e.g. a stray click that was never typed into)
  note.elements=note.elements.filter(el=>el.type==='image'||(el.text||'').trim()!==''||el.id===window._sel);
  try{ if(!useServer) throw 0; await api('/api/notes/'+date,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(note)}); }
  catch{ localStorage.setItem('notebook:'+date,JSON.stringify(note)); }
  markSaved('已保存 '+new Date().toLocaleTimeString()); refreshList();
}
const scheduleSave=()=>{ clearTimeout(saveTimer); saveTimer=setTimeout(save,500); };
const markSaved=t=>$('#saveState').textContent=t+(useServer?'':'（本地演示模式）');

// Date tree (v0.2.1): left panel groups notes 年 -> 月 -> 日, like a classic diary tree.
// expandedKeys holds the 'YYYY' / 'YYYY-MM' nodes the user currently has open.
const expandedKeys=new Set();
function expandFor(d){ if(!d) return; const p=String(d).split('-'); if(p.length<2) return; expandedKeys.add(p[0]); expandedKeys.add(p[0]+'-'+p[1]); }
async function refreshList(){
  let list=[];
  try{ list=await api('/api/notes'); }catch{ list=Object.keys(localStorage).filter(k=>k.startsWith('notebook:')).map(k=>{const n=JSON.parse(localStorage.getItem(k));return{date:n.date,title:n.title,count:(n.elements||[]).length}}); }
  list.sort((a,b)=>String(a.date).localeCompare(String(b.date))); // chronological: oldest first, newest last — tree groups inherit this order
  const q=($('#search').value||'').toLowerCase();
  const filtered=list.filter(n=>!q||n.date.includes(q)||(n.title||'').toLowerCase().includes(q));
  const box=$('#noteList');
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
function renderBody(b, el){
  b.innerHTML='';
  if(!(el.text||'')) return; // leave empty: the CSS placeholder shows
  el.text.split('\n').forEach((t,i)=>{
    const d=document.createElement('div');
    d.className='ln'+(el.marks&&el.marks[i]?' lv-'+el.marks[i]:'');
    if(el.fonts&&el.fonts[i]) d.style.fontFamily=el.fonts[i];
    d.textContent=t;
    if(t==='') d.appendChild(document.createElement('br'));
    b.appendChild(d);
  });
}
function readRich(b, el){
  const lines=[], marks={}, fonts={};
  const push=(txt,node)=>{
    String(txt).replace(/\r\n?/g,'\n').split('\n').forEach((part,j)=>{
      const i=lines.length; lines.push(part);
      if(node&&j===0){
        const m=/lv-(h[123])/.exec(node.className||''); if(m) marks[i]=m[1];
        if(node.style&&node.style.fontFamily) fonts[i]=node.style.fontFamily;
      }
    });
  };
  let stray='';
  [...b.childNodes].forEach(ch=>{
    if(ch.nodeType===3){ stray+=ch.textContent; }
    else if(ch.nodeName==='BR'){ push(stray,null); stray=''; }
    else { if(stray){ push(stray,null); stray=''; } push(ch.innerText||'', ch); }
  });
  if(stray) push(stray,null);
  if(!lines.length) lines.push('');
  let end=lines.length; while(end>1 && lines[end-1]==='') end--;
  lines.length=end;
  Object.keys(marks).forEach(k=>{ if(+k>=end) delete marks[k]; });
  Object.keys(fonts).forEach(k=>{ if(+k>=end) delete fonts[k]; });
  el.text=lines.join('\n');
  el.marks=marks; el.fonts=fonts;
}
function focusBody(el){ setTimeout(()=>{ const b=document.querySelector(`[data-id="${el.id}"] .body`); if(!b) return; b.focus();
  const r=document.createRange(); r.selectNodeContents(b); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); },0); }

function nodeFor(el){
  const div=document.createElement('div'); div.className='el '+el.type+(el.id===window._sel?' selected':''); div.dataset.id=el.id;
  // text/heading blocks hug their content (v0.2.2): the box is only as wide as the
  // longest line, so clicking beside the text hits the canvas and starts a new block;
  // only clicking the text itself edits it. Other block types keep their fixed size.
  const autoFit=el.type==='text'||el.type==='heading';
  div.style.left=el.x+'px'; div.style.top=el.y+'px';
  if(autoFit){ div.style.width='max-content'; div.style.maxWidth='900px'; }
  else{ div.style.width=el.w+'px'; if(el.h) div.style.height=el.h+'px'; }
  const label=el.type==='image'?'图片':el.type==='todo'?'待办':el.type==='sticky'?'便签':'文字';
  div.innerHTML=`<div class="grip"><span>⠿ ${label}</span><button title="删除">✕</button></div>`+
    (el.type==='image'?`<img draggable="false" alt=""/>`:`<div class="body" contenteditable="true" data-placeholder="在这里输入…"></div>`)+(autoFit?'':`<div class="resize">◢</div>`);
  if(el.type==='image'){ div.querySelector('img').src=el.src; }
  else{
    const b=div.querySelector('.body'); renderBody(b, el);
    // read via readRich (innerText-based), never textContent: line breaks inside a
    // contenteditable live in its <div>/<br> structure, and textContent glues lines
    // together with no separator — that merged multi-line notes into one blob (v0.2.4)
    b.oninput=()=>{ readRich(b, el); scheduleSave(); };
    // clicking into text edits it — it must NOT start a move/pan
    b.onmousedown=e=>e.stopPropagation();
    // an empty text block that loses focus disappears again (OneNote behaviour)
    b.onblur=()=>{ setTimeout(()=>{ if(el.type!=='todo' && el.type!=='sticky' && (el.text||'').trim()===''){ note.elements=note.elements.filter(x=>x.id!==el.id); render(); scheduleSave(); } },150); };
  }
  div.querySelector('.grip button').onclick=()=>{ note.elements=note.elements.filter(x=>x.id!==el.id); render(); scheduleSave(); };
  div.querySelector('.grip').onmousedown=e=>startMove(e,el,div);
  // images: drag the image itself to move it (native HTML drag is disabled, so no copy/ghost)
  if(el.type==='image'){ div.querySelector('img').onmousedown=e=>startMove(e,el,div); }
  const rz=div.querySelector('.resize'); if(rz) rz.onmousedown=e=>{ e.preventDefault(); e.stopPropagation(); const sx=e.clientX,sy=e.clientY,ow=el.w,oh=el.h||div.offsetHeight;
    const mv=ev=>{ el.w=Math.max(60,ow+(ev.clientX-sx)/zoom); el.h=Math.max(36,oh+(ev.clientY-sy)/zoom); div.style.width=el.w+'px'; div.style.height=el.h+'px'; };
    const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up); };
  div.onmousedown=()=>select(el.id);
  return div;
}
function select(id){ window._sel=id; document.querySelectorAll('.el').forEach(n=>n.classList.toggle('selected',n.dataset.id===id)); }
function canvasPos(clientX,clientY){ const r=$('#viewport').getBoundingClientRect(); return {x:(clientX-r.left-pan.x)/zoom, y:(clientY-r.top-pan.y)/zoom}; }
function addEl(type,x,y,extra={}){ const el={id:uid(),type,x:Math.round(x),y:Math.round(y),w:type==='image'?320:280,h:type==='image'?220:null,text:type==='todo'?'☐ 待办事项\n☐ 跟进人 / 截止日期':type==='sticky'?'便签':type==='heading'?'标题':'',...extra}; note.elements.push(el); render(); scheduleSave(); return el; }
function typeAt(p){ const el=addEl('text',p.x,p.y); select(el.id); focusBody(el); return el; }

document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{ const el=addEl(b.dataset.add, 80+Math.random()*120 - pan.x/zoom, 80+Math.random()*80 - pan.y/zoom); select(el.id); if(el.type!=='image') focusBody(el); });
$('#imgInput').onchange=e=>{ [...e.target.files].forEach((f,i)=>{ const r=new FileReader(); r.onload=()=>addEl('image',120+i*30,120+i*30,{src:r.result}); r.readAsDataURL(f); }); e.target.value=''; };
addEventListener('paste',e=>{ const item=[...(e.clipboardData||[]).items||[]].find(i=>i.type.startsWith('image/')); if(item){ const r=new FileReader(); r.onload=()=>addEl('image',140,140,{src:r.result}); r.readAsDataURL(item.getAsFile()); }});
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
function syncFmtBar(){
  const t=fmtTarget(); if(!t) return;
  const li=boundaryLine(t.b, fmtCtx.range.startContainer, fmtCtx.range.startOffset, false);
  const first=lineNodes(t.b)[li];
  const m=first?/lv-(h[123])/.exec(first.className||''):null;
  document.querySelectorAll('.lvBtn').forEach(btn=>btn.classList.toggle('on',(btn.dataset.lv||'')===(m?m[1]:'')));
  const fs=$('#fontSel'); const want=(first&&first.style&&first.style.fontFamily)||'';
  if([...fs.options].some(o=>o.value===want)) fs.value=want;
}
document.querySelectorAll('.lvBtn').forEach(btn=>{
  btn.addEventListener('mousedown',e=>e.preventDefault()); // keep the text selection alive
  btn.addEventListener('click',()=>applyLevel(btn.dataset.lv||''));
});
$('#fontSel').addEventListener('change',e=>applyFont(e.target.value));
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
  files.forEach((f,i)=>{ const r=new FileReader(); r.onload=()=>addEl('image',p.x+i*24,p.y+i*24,{src:r.result}); r.readAsDataURL(f); });
});
// empty canvas: drag = pan, click without moving = type right there (OneNote behaviour)
$('#viewport').addEventListener('mousedown',e=>{
  if(e.target.id!=='viewport'&&e.target.id!=='canvas') return;
  const sx=e.clientX, sy=e.clientY, ox=pan.x, oy=pan.y; let moved=false;
  const mv=ev=>{ if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>4) moved=true; if(moved){ pan.x=ox+ev.clientX-sx; pan.y=oy+ev.clientY-sy; applyTransform(); } };
  const up=ev=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up);
    if(!moved) typeAt(canvasPos(ev.clientX,ev.clientY)); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
});
$('#zoomIn').onclick=()=>{zoom=Math.min(2,zoom*1.15);applyTransform()}; $('#zoomOut').onclick=()=>{zoom=Math.max(.3,zoom/1.15);applyTransform()};
$('#fitBtn').onclick=()=>{pan={x:20,y:20};zoom=1;applyTransform()};
$('#todayBtn').onclick=()=>loadNote(today(),{create:true});
$('#datePick').onchange=e=>{ if(e.target.value) loadNote(e.target.value,{create:true}); };
$('#search').oninput=refreshList;
$('#title').oninput=scheduleSave;
$('#exportBtn').onclick=()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(note,null,2)],{type:'application/json'})); a.download=date+'-纪要.json'; a.click(); };
async function deleteNote(d){
  clearTimeout(saveTimer); // a pending autosave must not resurrect the note
  const t=(d===date&&note.title)?'「'+note.title+'」':'';
  if(!confirm('确定删除 '+d+' '+t+'这篇纪要吗？删除后无法恢复。')) return;
  try{ if(!useServer) throw 0; await api('/api/notes/'+d,{method:'DELETE'}); }
  catch{ localStorage.removeItem('notebook:'+d); }
  if(d===date){
    let list=[]; try{ list=await api('/api/notes'); }catch{ list=[]; }
    const next=list.find(x=>x.date>d)||[...list].reverse().find(x=>x.date<d);
    await loadNote(next?next.date:today());
  } else refreshList();
  markSaved('已删除 '+d);
}
$('#delBtn').onclick=()=>deleteNote(date);
loadNote(today());
