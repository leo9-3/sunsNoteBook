// Intranet Notebook — freeform canvas (OneNote-style)
// v0.1.1: click any empty spot to type right there (no block dragging needed);
//         images move by dragging the image itself and never duplicate via native drag.
// Elements: {id,type:'text'|'heading'|'sticky'|'todo'|'image',x,y,w,h,text?,src?}
const $=s=>document.querySelector(s);
const today=()=>{const d=new Date();return d.toISOString().slice(0,10)};
let date=today(), note={date,title:'',elements:[]}, zoom=1, pan={x:20,y:20}, saveTimer=null, useServer=true;
const uid=()=>Math.random().toString(36).slice(2,10);

async function api(path,opts){ const r=await fetch(path,opts); if(!r.ok) throw new Error(r.status); return r.json(); }
async function loadNote(d){
  date=d; expandFor(d);
  try{ note=await api('/api/notes/'+d); }
  catch{ useServer=false; note=JSON.parse(localStorage.getItem('notebook:'+d)||JSON.stringify({date:d,title:'',elements:[]})); }
  if(!note.elements) note.elements=[];
  $('#title').value=note.title||''; render(); refreshList(); markSaved('已打开 '+d);
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
      if(mOpen) html+='<div class="treeDays">'+days.map(n=>{ const wd='日一二三四五六'[new Date(n.date+'T00:00:00').getDay()]; return `<div class="noteItem treeDay ${n.date===date?'active':''}" data-d="${n.date}"><b>${Number(n.date.slice(8))}日</b><small>周${wd}</small><span class="tt">${n.title||'<i>未命名纪要</i>'}</span></div>`; }).join('')+'</div>';
    }
  }
  box.innerHTML=html;
  box.querySelectorAll('.treeRow').forEach(r=>r.onclick=()=>{ const k=r.dataset.k; expandedKeys.has(k)?expandedKeys.delete(k):expandedKeys.add(k); refreshList(); });
  box.querySelectorAll('.noteItem').forEach(el=>el.onclick=()=>loadNote(el.dataset.d));
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
    const b=div.querySelector('.body'); b.textContent=el.text||'';
    b.oninput=()=>{ el.text=b.textContent; scheduleSave(); };
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
$('#todayBtn').onclick=()=>loadNote(today());
$('#datePick').onchange=e=>{ if(e.target.value) loadNote(e.target.value); };
$('#search').oninput=refreshList;
$('#title').oninput=scheduleSave;
$('#exportBtn').onclick=()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(note,null,2)],{type:'application/json'})); a.download=date+'-纪要.json'; a.click(); };
loadNote(today());
