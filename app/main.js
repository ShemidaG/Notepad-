const DB_NAME = 'notepad_mvp_db';
const DB_VERSION = 1;
let db;
const state = { workspaceId: null, selectedNoteId: null, selectedDate: new Date(), calendarMonth: new Date(), importData: null };

const $ = (id) => document.getElementById(id);
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 1800); };
const uid = () => crypto.randomUUID();
const dateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isoDate = (d) => dateOnly(d).toISOString();

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('workspaces', { keyPath: 'id' });
      db.createObjectStore('folders', { keyPath: 'id' });
      db.createObjectStore('notes', { keyPath: 'id' });
      db.createObjectStore('tasks', { keyPath: 'id' });
      db.createObjectStore('events', { keyPath: 'id' });
      db.createObjectStore('images', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
const getAll = (store) => new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const get = (store, id) => new Promise((res, rej) => { const r = tx(store).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const put = (store, item) => new Promise((res, rej) => { const r = tx(store, 'readwrite').put(item); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const del = (store, id) => new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

async function ensureSeed() {
  const workspaces = await getAll('workspaces');
  if (!workspaces.length) {
    const ws = { id: uid(), name: 'Personal', createdAt: Date.now() };
    await put('workspaces', ws);
    await put('meta', { key: 'activeWorkspaceId', value: ws.id });
  }
}

async function activeWorkspace() {
  const m = await get('meta', 'activeWorkspaceId');
  const workspaces = await getAll('workspaces');
  state.workspaceId = m?.value || workspaces[0]?.id;
  if (!m?.value && state.workspaceId) await put('meta', { key: 'activeWorkspaceId', value: state.workspaceId });
}

async function renderWorkspaces() {
  const wss = await getAll('workspaces');
  const sel = $('workspaceSelect');
  sel.innerHTML = '';
  wss.forEach(w => { const o = document.createElement('option'); o.value = w.id; o.textContent = w.name; if (w.id === state.workspaceId) o.selected = true; sel.appendChild(o); });
}

async function renderTree() {
  const folders = (await getAll('folders')).filter(f => f.workspaceId === state.workspaceId).sort((a,b)=>a.order-b.order);
  const notes = (await getAll('notes')).filter(n => n.workspaceId === state.workspaceId).sort((a,b)=>(a.order||0)-(b.order||0));
  const root = $('tree'); root.innerHTML = '';

  const makeNote = (n, depth=0) => {
    const d=document.createElement('div'); d.className='item indent'.repeat(depth?1:0); d.style.marginLeft = `${depth*16}px`;
    d.draggable = true; d.dataset.type='note'; d.dataset.id=n.id; if (n.id===state.selectedNoteId) d.classList.add('selected');
    d.innerHTML=`<span>📝 ${n.title||'Untitled'}</span><span><button data-a='rn'>✎</button><button data-a='del'>🗑</button></span>`;
    d.onclick=(e)=>{ if(e.target.tagName==='BUTTON') return; selectNote(n.id); };
    d.querySelector("button[data-a='rn']").onclick=async()=>{n.title=prompt('Rename note',n.title)||n.title;await put('notes',n);renderTree();};
    d.querySelector("button[data-a='del']").onclick=async()=>{if(confirm('Delete note?')){await del('notes',n.id); if(state.selectedNoteId===n.id){state.selectedNoteId=null; $('editor').innerHTML='';$('noteTitle').value='';} renderTree();}};
    attachDnD(d);
    return d;
  };

  const renderFolder = (f, depth=0) => {
    const d=document.createElement('div'); d.className='item'; d.style.marginLeft=`${depth*16}px`; d.draggable=true; d.dataset.type='folder'; d.dataset.id=f.id;
    d.innerHTML=`<span>📁 ${f.name}</span><span><button data-a='addn'>+N</button><button data-a='addf'>+F</button><button data-a='rn'>✎</button><button data-a='del'>🗑</button></span>`;
    d.querySelector("button[data-a='addn']").onclick=()=>createNote(f.id);
    d.querySelector("button[data-a='addf']").onclick=()=>createFolder(f.id);
    d.querySelector("button[data-a='rn']").onclick=async()=>{f.name=prompt('Rename folder',f.name)||f.name;await put('folders',f);renderTree();};
    d.querySelector("button[data-a='del']").onclick=async()=>{if(confirm('Delete folder and children?')) await deleteFolderCascade(f.id); renderTree();};
    attachDnD(d);
    root.appendChild(d);
    notes.filter(n=>n.folderId===f.id).forEach(n=>root.appendChild(makeNote(n,depth+1)));
    folders.filter(c=>c.parentFolderId===f.id).forEach(c=>renderFolder(c, depth+1));
  };
  notes.filter(n=>!n.folderId).forEach(n=>root.appendChild(makeNote(n)));
  folders.filter(f=>!f.parentFolderId).forEach(f=>renderFolder(f));
}

let dragData = null;
function attachDnD(el){
  el.addEventListener('dragstart',()=>dragData={type:el.dataset.type,id:el.dataset.id});
  el.addEventListener('dragover',(e)=>e.preventDefault());
  el.addEventListener('drop', async (e)=>{
    e.preventDefault();
    if(!dragData||dragData.id===el.dataset.id) return;
    if(dragData.type==='note'){
      const n=await get('notes',dragData.id); n.folderId = el.dataset.type==='folder'?el.dataset.id:null; n.order=Date.now(); await put('notes',n);
    }
    if(dragData.type==='folder' && el.dataset.type==='folder'){
      const f=await get('folders',dragData.id); f.parentFolderId=el.dataset.id; f.order=Date.now(); await put('folders',f);
    }
    renderTree();
  });
}

async function deleteFolderCascade(folderId){
  const folders=await getAll('folders'); const notes=await getAll('notes');
  for(const n of notes.filter(n=>n.folderId===folderId)) await del('notes',n.id);
  for(const c of folders.filter(f=>f.parentFolderId===folderId)) await deleteFolderCascade(c.id);
  await del('folders',folderId);
}

async function createFolder(parentFolderId=null){ const name=prompt('Folder name','New Folder'); if(!name) return; await put('folders',{id:uid(),workspaceId:state.workspaceId,parentFolderId,name,order:Date.now()}); renderTree(); }
async function createNote(folderId=null){ const title=prompt('Note title','Untitled')||'Untitled'; const n={id:uid(),workspaceId:state.workspaceId,folderId,title,content:'',bannerImageId:null,updatedAt:Date.now(),order:Date.now()}; await put('notes',n); state.selectedNoteId=n.id; await renderTree(); await selectNote(n.id); }

async function selectNote(id){
  state.selectedNoteId=id;
  const n=await get('notes',id); if(!n) return;
  $('noteTitle').value=n.title; $('editor').innerHTML=n.content||'';
  await renderBanner(n.bannerImageId);
  renderTree();
}

async function renderBanner(imageId){
  const wrap=$('bannerWrap'); wrap.innerHTML='';
  if(!imageId) return;
  const img=await get('images',imageId); if(!img) return;
  const el=document.createElement('img'); el.src=URL.createObjectURL(img.blob); wrap.appendChild(el);
}

async function saveCurrentNote(){
  if(!state.selectedNoteId) return;
  const n=await get('notes',state.selectedNoteId); if(!n) return;
  n.title=$('noteTitle').value||'Untitled'; n.content=$('editor').innerHTML; n.updatedAt=Date.now();
  await put('notes',n); renderTree();
}

function bindEditor(){
  document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>document.execCommand(b.dataset.cmd));
  document.querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>document.execCommand('formatBlock', false, b.dataset.block));
  $('checkboxBtn').onclick=()=>document.execCommand('insertHTML', false, `<label class='task-inline'><input type='checkbox'/> <span>Task item</span></label><br/>`);
  $('editor').addEventListener('change', saveCurrentNote);
  $('editor').addEventListener('input', ()=>setTimeout(saveCurrentNote,200));
  $('editor').addEventListener('click', (e)=>{
    if(e.target.type==='checkbox'){
      const sp=e.target.parentElement.querySelector('span'); sp.style.textDecoration=e.target.checked?'line-through':'none';
      saveCurrentNote();
    }
  });
  $('editor').addEventListener('paste', async (e)=>{
    const item=[...e.clipboardData.items].find(i=>i.type.startsWith('image/')); if(!item) return;
    e.preventDefault(); const file=item.getAsFile(); await insertImage(file);
  });
  document.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey)&&['b','i','u'].includes(e.key.toLowerCase())){e.preventDefault(); document.execCommand({b:'bold',i:'italic',u:'underline'}[e.key.toLowerCase()]);}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); openCommands();}
  });
}

async function insertImage(file){
  const id=uid(); await put('images',{id,blob:file,createdAt:Date.now()});
  const html=`<div contenteditable='false' style='display:inline-block;resize:both;overflow:auto;border:1px solid #555'><img src='${URL.createObjectURL(file)}' style='max-width:360px;display:block'/></div>`;
  document.execCommand('insertHTML', false, html); saveCurrentNote();
}

function recurrenceMatches(task, date){
  const due = new Date(task.dueDate); const d = dateOnly(date);
  if (task.recurrence?.type === 'daily') return d >= dateOnly(due);
  if (task.recurrence?.type === 'weekly') { const days = task.recurrence.days || []; return d >= dateOnly(due) && days.includes(d.getDay()); }
  if (task.recurrence?.type === 'monthly') return d >= dateOnly(due) && d.getDate() === task.recurrence.day;
  return isoDate(due)===isoDate(d);
}

async function renderCalendar(){
  const d = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
  $('monthLabel').textContent = d.toLocaleString(undefined,{month:'long',year:'numeric'});
  const grid = $('calendar'); grid.innerHTML='';
  const start = d.getDay(); const days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  for(let i=0;i<start;i++){const e=document.createElement('div'); grid.appendChild(e);}
  for(let i=1;i<=days;i++){
    const day = new Date(d.getFullYear(), d.getMonth(), i); const cell=document.createElement('div'); cell.className='day'; cell.textContent=i;
    if(isoDate(day)===isoDate(new Date())) cell.classList.add('today');
    if(isoDate(day)===isoDate(state.selectedDate)) cell.classList.add('active');
    cell.onclick=()=>{state.selectedDate=day;renderCalendar();renderTodayPanel();};
    grid.appendChild(cell);
  }
}

async function renderTodayPanel(){
  const tasks=(await getAll('tasks')).filter(t=>t.workspaceId===state.workspaceId && recurrenceMatches(t,state.selectedDate));
  const events=(await getAll('events')).filter(ev=>ev.workspaceId===state.workspaceId && isoDate(new Date(ev.start))===isoDate(state.selectedDate));
  const box=$('todayItems'); box.innerHTML='';
  tasks.forEach(t=>{const d=document.createElement('div'); d.className='item task'+(t.completed?' done':''); d.innerHTML=`<input type='checkbox' ${t.completed?'checked':''}/> ${t.title} <button>🗑</button>`; d.querySelector('input').onchange=async(e)=>{t.completed=e.target.checked;t.updatedAt=Date.now();await put('tasks',t);renderTodayPanel();}; d.querySelector('button').onclick=async()=>{await del('tasks',t.id);renderTodayPanel();}; box.appendChild(d);});
  events.forEach(ev=>{const d=document.createElement('div'); d.className='item'; d.innerHTML=`📅 ${ev.title} (${new Date(ev.start).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}-${new Date(ev.end).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}) <button>🗑</button>`; d.querySelector('button').onclick=async()=>{await del('events',ev.id);renderTodayPanel();}; box.appendChild(d);});
}

async function exportAll(){
  const data={};
  for(const s of ['workspaces','folders','notes','tasks','events','meta']) data[s]=await getAll(s);
  data.images = [];
  for(const img of await getAll('images')) data.images.push({id:img.id, createdAt:img.createdAt, blob:Array.from(new Uint8Array(await img.blob.arrayBuffer())), type:img.blob.type});
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='notepad-export.json'; a.click(); toast('Exported');
}

async function importData(mode){
  const data=state.importData; if(!data) return;
  if(mode==='replace'){
    for(const s of ['workspaces','folders','notes','tasks','events','images','meta']){
      const all=await getAll(s); for(const x of all) await del(s, x.id||x.key);
    }
  }
  for(const s of ['workspaces','folders','notes','tasks','events','meta']) for(const it of data[s]||[]) await put(s,it);
  for(const img of data.images||[]) await put('images',{id:img.id,createdAt:img.createdAt,blob:new Blob([new Uint8Array(img.blob)],{type:img.type})});
  $('importDialog').close(); toast(`Imported (${mode})`); await activeWorkspace(); await renderWorkspaces(); await renderTree(); await renderCalendar(); await renderTodayPanel();
}

async function searchNotes(q){
  const notes=(await getAll('notes')).filter(n=>n.workspaceId===state.workspaceId && (`${n.title} ${n.content}`).toLowerCase().includes(q.toLowerCase()));
  return notes;
}

async function openCommands(){
  const p=$('commandPalette'); p.classList.remove('hidden'); const input=$('commandInput'); input.value=''; input.focus();
  const base=[
    {label:'Create Note',run:()=>createNote(null)},
    {label:'Create Folder',run:()=>createFolder(null)},
    {label:'Go to Today',run:()=>{$('todayBtn').click();}},
  ];
  const render=async()=>{
    const q=input.value.trim(); let list=[...base];
    if(q){ const notes=await searchNotes(q); list = [...base, ...notes.map(n=>({label:`Open: ${n.title}`,run:()=>selectNote(n.id)}))]; }
    const ul=$('commandList'); ul.innerHTML='';
    list.forEach(c=>{const li=document.createElement('li'); li.textContent=c.label; li.onclick=()=>{c.run(); p.classList.add('hidden');}; ul.appendChild(li);});
  };
  input.oninput=render; render();
  p.onclick=(e)=>{ if(e.target===p) p.classList.add('hidden'); };
}

async function bindUI(){
  $('addWorkspaceBtn').onclick=async()=>{const name=prompt('Workspace name','Workspace'); if(!name) return; const ws={id:uid(),name,createdAt:Date.now()}; await put('workspaces',ws); state.workspaceId=ws.id; await put('meta',{key:'activeWorkspaceId',value:ws.id}); await renderWorkspaces(); renderTree(); renderTodayPanel();};
  $('renameWorkspaceBtn').onclick=async()=>{const ws=await get('workspaces',state.workspaceId); ws.name=prompt('Rename workspace',ws.name)||ws.name; await put('workspaces',ws); renderWorkspaces();};
  $('deleteWorkspaceBtn').onclick=async()=>{if(!confirm('Delete workspace and all data?')) return; const id=state.workspaceId; for(const s of ['folders','notes','tasks','events']) for(const i of await getAll(s)) if(i.workspaceId===id) await del(s,i.id); await del('workspaces',id); await activeWorkspace(); await renderWorkspaces(); await renderTree(); renderTodayPanel();};
  $('workspaceSelect').onchange=async(e)=>{state.workspaceId=e.target.value; await put('meta',{key:'activeWorkspaceId',value:state.workspaceId}); state.selectedNoteId=null; await renderTree(); await renderTodayPanel();};
  $('addFolderBtn').onclick=()=>createFolder(null); $('addNoteBtn').onclick=()=>createNote(null);
  $('noteTitle').oninput=()=>setTimeout(saveCurrentNote,200);
  $('bannerInput').onchange=async(e)=>{if(!state.selectedNoteId||!e.target.files[0]) return; const imageId=uid(); await put('images',{id:imageId,blob:e.target.files[0],createdAt:Date.now()}); const n=await get('notes',state.selectedNoteId); n.bannerImageId=imageId; await put('notes',n); renderBanner(imageId); toast('Banner updated');};
  $('removeBannerBtn').onclick=async()=>{if(!state.selectedNoteId) return; const n=await get('notes',state.selectedNoteId); n.bannerImageId=null; await put('notes',n); renderBanner(null);};
  $('imageInput').onchange=async(e)=>e.target.files[0]&&insertImage(e.target.files[0]);

  $('prevMonth').onclick=()=>{state.calendarMonth.setMonth(state.calendarMonth.getMonth()-1);renderCalendar();};
  $('nextMonth').onclick=()=>{state.calendarMonth.setMonth(state.calendarMonth.getMonth()+1);renderCalendar();};
  $('todayBtn').onclick=()=>{state.selectedDate=new Date(); state.calendarMonth=new Date(); renderCalendar(); renderTodayPanel();};

  $('addTaskBtn').onclick=async()=>{
    const title=$('taskTitle').value.trim(); if(!title) return;
    const type=$('recurType').value; let recurrence=null; const param=$('recurParam').value.trim();
    if(type==='daily') recurrence={type};
    if(type==='weekly') recurrence={type,days:param.split(',').map(x=>Number(x.trim())).filter(x=>!Number.isNaN(x))};
    if(type==='monthly') recurrence={type,day:Number(param)||state.selectedDate.getDate()};
    await put('tasks',{id:uid(),workspaceId:state.workspaceId,title,dueDate:state.selectedDate.toISOString(),completed:false,recurrence,updatedAt:Date.now()});
    $('taskTitle').value=''; renderTodayPanel();
  };
  $('addEventBtn').onclick=async()=>{
    const title=$('eventTitle').value.trim(); const start=$('eventStart').value; const end=$('eventEnd').value;
    if(!title||!start||!end) return toast('Event fields missing');
    await put('events',{id:uid(),workspaceId:state.workspaceId,title,start:new Date(start).toISOString(),end:new Date(end).toISOString(),updatedAt:Date.now()});
    $('eventTitle').value=''; renderTodayPanel();
  };
  $('exportBtn').onclick=exportAll;
  $('importInput').onchange=async(e)=>{const file=e.target.files[0]; if(!file) return; state.importData=JSON.parse(await file.text()); $('importDialog').showModal();};
  $('mergeImportBtn').onclick=()=>importData('merge'); $('replaceImportBtn').onclick=()=>importData('replace');
  $('searchToggle').onclick=openCommands;
}

(async function init(){
  db = await openDB();
  await ensureSeed();
  await activeWorkspace();
  bindEditor();
  await bindUI();
  await renderWorkspaces();
  await renderTree();
  await renderCalendar();
  await renderTodayPanel();
  toast('Ready');
})();
