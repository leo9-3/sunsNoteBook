// Intranet Notebook — freeform canvas (OneNote-style)
// Elements: {id,type:'text'|'heading'|'sticky'|'todo'|'image',x,y,w,h,text?,src?}
// Position is absolute on an infinite-feeling canvas: place anything, anywhere.
const $=s=>document.querySelector(s);
const today=()=>{const d=new Date();return d.toISOString().slice(0,10)};
let date=today(), note={date,title:'',elements:[]}, zoom=1, pan={x:20,y:20}, saveTimer=null, useServer=true;
const uid=()=>Math.random().toString(36).slice(2,10);

async function api(path,opts){ const r=await fetch(path,opts); if(!r.ok) throw new Error(r.status); return r.json(); }
async function loadNote(d){
  date=d;
  try{ note=await api('/api/notes/'+d); }
  catch{ useServer=false; note=JSON.parse(localStorage.getItem('notebook:'+d)||JSON.stringify({date:d,title:'',elements:[]})); }
  if(!note.elements) note.elements=[];
  $('#title').value=note.title||''; render(); refreshList(); markSaved('已打开 '+d);
}
async function save(){
  markSaved('保存中…'); note.title=$('#title').value; note.date=date;
  try{ if(!useServer) throw 0; await api('/api/notes/'+date,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(note)}); }
  catch{ localStorage.setItem('notebook:'+date,JSON.stringify(note)); }
  markSaved('已保存 '+new Date().toLocaleTimeString()); refreshList();
}
const scheduleSave=()=>{ clearTimeout(saveTimer); saveTimer=setTimeout(save,500); };
const markSaved=t=>$('#saveState').textContent=t+(useServer?'':'（本地演示模式）');

async function refreshList(){
  let list=[];
  try{ list=await api('/api/notes'); }catch{ list=Object.keys(localStorage).filter(k=>k.startsWith('notebook:')).map(k=>{const n=JSON.parse(localStorage.getItem(k));return{date:n.date,title:n.title,count:(n.elements||[]).length}}); }
  const q=($('#search').value||'').toLowerCase();
  $('#noteList').innerHTML=list.filter(n=>!q||n.date.includes(q)||(n.title||'').toLowerCase().includes(q))
    .map(n=>`<div class="noteItem ${n.date===date?'active':''}" data-d="${n.date}"><b>${n.date}</b>${n.title||'<i>未命名纪要</i>'}<br><small>${n.count||0} 个块</small></div>`).join('')||'<p class="hint">还没有纪要，点上面新建今天的。</p>';
  document.querySelectorAll('.noteItem').forEach(el=>el.onclick=()=>loadNote(el.dataset.d));
}

function applyTransform(){ $('#canvas').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`; $('#zoomLabel').textContent=Math.round(zoom*100)+'%'; }
function render(){
  const c=$('#canvas'); c.innerHTML='';
  note.elements.forEach(el=>c.appendChild(nodeFor(el)));
  applyTransform();
}
function nodeFor(el){
  const div=document.createElement('div'); div.className='el '+el.type+(el.id===window._sel?' selected':''); div.dataset.id=el.id;
  div.style.left=el.x+'px'; div.style.top=el.y+'px'; div.style.width=el.w+'px'; if(el.h) div.style.height=el.h+'px';
  div.innerHTML=`<div class="grip"><span>⠿ ${el.type==='image'?'图片':el.type==='todo'?'待办':'文字'}</span><button title="删除">✕</button></div>`+
    (el.type==='image'?`<img src="${el.src}" alt=""/>`:`<div class="body" contenteditable="true"></div>`)+`<div class="resize">◢</div>`;
  if(el.type!=='image'){ const b=div.querySelector('.body'); b.textContent=el.text||''; b.oninput=()=>{el.text=b.textContent; scheduleSave();}; b.onmousedown=e=>e.stopPropagation(); }
  div.querySelector('.grip button').onclick=()=>{ note.elements=note.elements.filter(x=>x.id!==el.id); render(); scheduleSave(); };
  // drag by grip
  div.querySelector('.grip').onmousedown=e=>{ e.preventDefault(); select(el.id); const sx=e.clientX,sy=e.clientY,ox=el.x,oy=el.y;
    const mv=ev=>{ el.x=ox+(ev.clientX-sx)/zoom; el.y=oy+(ev.clientY-sy)/zoom; div.style.left=el.x+'px'; div.style.top=el.y+'px'; };
    const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up); };
  // resize
  div.querySelector('.resize').onmousedown=e=>{ e.preventDefault(); e.stopPropagation(); const sx=e.clientX,sy=e.clientY,ow=el.w,oh=el.h||div.offsetHeight;
    const mv=ev=>{ el.w=Math.max(60,ow+(ev.clientX-sx)/zoom); el.h=Math.max(36,oh+(ev.clientY-sy)/zoom); div.style.width=el.w+'px'; div.style.height=el.h+'px'; };
    const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleSave(); };
    addEventListener('mousemove',mv); addEventListener('mouseup',up); };
  div.onmousedown=()=>select(el.id);
  return div;
}
function select(id){ window._sel=id; document.querySelectorAll('.el').forEach(n=>n.classList.toggle('selected',n.dataset.id===id)); }
function canvasPos(clientX,clientY){ const r=$('#viewport').getBoundingClientRect(); return {x:(clientX-r.left-pan.x)/zoom, y:(clientY-r.top-pan.y)/zoom}; }
function addEl(type,x,y,extra={}){ const el={id:uid(),type,x:Math.round(x),y:Math.round(y),w:type==='image'?320:260,h:type==='image'?220:null,text:type==='todo'?'☐ 待办事项\n☐ 跟进人 / 截止日期':type==='heading'?'会议标题':'双击？直接在这里输入，可拖到任意位置',...extra}; note.elements.push(el); render(); scheduleSave(); return el; }

document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>addEl(b.dataset.add, 80+Math.random()*120 - pan.x/zoom, 80+Math.random()*80 - pan.y/zoom));
$('#imgInput').onchange=e=>{ [...e.target.files].forEach((f,i)=>{ const r=new FileReader(); r.onload=()=>addEl('image',120+i*30,120+i*30,{src:r.result}); r.readAsDataURL(f); }); e.target.value=''; };
$('#viewport').addEventListener('dblclick',e=>{ if(e.target.id==='viewport'||e.target.id==='canvas'){ const p=canvasPos(e.clientX,e.clientY); const el=addEl('text',p.x,p.y); setTimeout(()=>{ const n=document.querySelector(`[data-id="${el.id}"] .body`); if(n){n.focus(); document.execCommand&&document.execCommand('selectAll',false,null);} },0); }});
addEventListener('paste',e=>{ const item=[...(e.clipboardData||[]).items||[]].find(i=>i.type.startsWith('image/')); if(item){ const r=new FileReader(); r.onload=()=>addEl('image',140,140,{src:r.result}); r.readAsDataURL(item.getAsFile()); }});
$('#viewport').addEventListener('dragover',e=>e.preventDefault());
$('#viewport').addEventListener('drop',e=>{ e.preventDefault(); const p=canvasPos(e.clientX,e.clientY); [...e.dataTransfer.files].filter(f=>f.type.startsWith('image/')).forEach((f,i)=>{ const r=new FileReader(); r.onload=()=>addEl('image',p.x+i*24,p.y+i*24,{src:r.result}); r.readAsDataURL(f); }); });
// pan by dragging empty canvas
$('#viewport').addEventListener('mousedown',e=>{ if(e.target.id!=='viewport'&&e.target.id!=='canvas')return; const sx=e.clientX,sy=e.clientY,ox=pan.x,oy=pan.y; const mv=ev=>{pan.x=ox+ev.clientX-sx;pan.y=oy+ev.clientY-sy;applyTransform();}; const up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);}; addEventListener('mousemove',mv); addEventListener('mouseup',up); });
$('#zoomIn').onclick=()=>{zoom=Math.min(2,zoom*1.15);applyTransform()}; $('#zoomOut').onclick=()=>{zoom=Math.max(.3,zoom/1.15);applyTransform()};
$('#fitBtn').onclick=()=>{pan={x:20,y:20};zoom=1;applyTransform()};
$('#todayBtn').onclick=()=>loadNote(today());
$('#datePick').onchange=e=>{ if(e.target.value) loadNote(e.target.value); };
$('#search').oninput=refreshList;
$('#title').oninput=scheduleSave;
$('#exportBtn').onclick=()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(note,null,2)],{type:'application/json'})); a.download=date+'-纪要.json'; a.click(); };
loadNote(today());
