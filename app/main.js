const DB_NAME = 'notepad_mvp_db';
// Keep DB schema at v3 to include workspace settings and migration-safe store creation.
const DB_VERSION = 3;
let db;
let clockTimer = null;
const state = {
  workspaceId: null,
  selectedNoteId: null,
  selectedDate: new Date(),
  calendarMonth: new Date(),
  importData: null,
  editTaskId: null,
  editEventId: null,
};

const $ = (id) => document.getElementById(id);
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 1800); };
const uid = () => crypto.randomUUID();
const dateOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isoDate = (d) => dateOnly(d).toISOString();
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0];
const CLOCK_TIMEZONES = [
  { label: 'Asia/Manila', value: 'Asia/Manila' },
  { label: 'America/Chicago (Central)', value: 'America/Chicago' },
  { label: 'America/Denver (Mountain)', value: 'America/Denver' },
  { label: 'America/Los_Angeles (Pacific)', value: 'America/Los_Angeles' },
  { label: 'America/New_York (Eastern)', value: 'America/New_York' },
];
const DEFAULT_WORKSPACE_SETTINGS = {
  avatarEmoji: '🗂️',
  avatarImageId: null,
  fontFamily: 'Calibri, Segoe UI, Arial, sans-serif',
  bgImageId: null,
  bgDim: 0.25,
  bgBlurEnabled: false,
  bgBlur: 4,
  clockTimezone: 'Asia/Manila',
  clock24h: false,
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const up = req.result;
      if (!up.objectStoreNames.contains('workspaces')) up.createObjectStore('workspaces', { keyPath: 'id' });
      if (!up.objectStoreNames.contains('folders')) up.createObjectStore('folders', { keyPath: 'id' });
      if (!up.objectStoreNames.contains('notes')) up.createObjectStore('notes', { keyPath: 'id' });
      if (!up.objectStoreNames.contains('tasks')) up.createObjectStore('tasks', { keyPath: 'id' });
      if (!up.objectStoreNames.contains('events')) up.createObjectStore('events', { keyPath: 'id' });
      if (!up.objectStoreNames.contains('images')) up.createObjectStore('images', { keyPath: 'id' });
      if (!up.objectStoreNames.contains('meta')) up.createObjectStore('meta', { keyPath: 'key' });
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
    const ws = { id: uid(), name: 'Personal', createdAt: Date.now(), settings: { ...DEFAULT_WORKSPACE_SETTINGS } };
    await put('workspaces', ws);
    await put('meta', { key: 'activeWorkspaceId', value: ws.id });
  }
}

async function activeWorkspace() {
  const m = await get('meta', 'activeWorkspaceId');
  const workspaces = await getAll('workspaces');
  const hasStoredWorkspace = workspaces.some((ws) => ws.id === m?.value);
  state.workspaceId = hasStoredWorkspace ? m.value : workspaces[0]?.id;
  if (state.workspaceId && m?.value !== state.workspaceId) await put('meta', { key: 'activeWorkspaceId', value: state.workspaceId });
}

async function getCurrentWorkspace() {
  if (!state.workspaceId) await activeWorkspace();
  let ws = state.workspaceId ? await get('workspaces', state.workspaceId) : null;
  if (!ws) {
    const workspaces = await getAll('workspaces');
    const fallback = workspaces[0] || null;
    if (fallback) {
      state.workspaceId = fallback.id;
      await put('meta', { key: 'activeWorkspaceId', value: fallback.id });
      ws = fallback;
    } else {
      await ensureSeed();
      await activeWorkspace();
      ws = state.workspaceId ? await get('workspaces', state.workspaceId) : null;
    }
  }
  if (!ws) return { id: null, name: 'Workspace', settings: { ...DEFAULT_WORKSPACE_SETTINGS } };
  if (!ws.settings) ws.settings = { ...DEFAULT_WORKSPACE_SETTINGS };
  ws.settings = { ...DEFAULT_WORKSPACE_SETTINGS, ...ws.settings };
  return ws;
}

function toLocalDateTimeValue(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function updateWorkspaceSettings(patch) {
  const ws = await getCurrentWorkspace();
  if (!ws.id) return;
  ws.settings = { ...ws.settings, ...patch };
  await put('workspaces', ws);
  await renderWorkspaces();
  await applyWorkspaceTheme();
  renderClock();
}

function collapsedKey() { return `collapsedFolders:${state.workspaceId}`; }

async function renderWorkspaces() {
  const wss = await getAll('workspaces');
  const sel = $('workspaceSelect');
  sel.innerHTML = '';
  wss.forEach((w) => {
    const o = document.createElement('option');
    o.value = w.id;
    const emoji = w.settings?.avatarEmoji || '🗂️';
    o.textContent = `${emoji} ${w.name}`;
    if (w.id === state.workspaceId) o.selected = true;
    sel.appendChild(o);
  });
}

function recurrenceMatches(task, date) {
  const due = dateOnly(new Date(task.dueDate));
  const d = dateOnly(date);
  if (d < due) return false;
  const rec = task.recurrence || { type: 'none' };
  if (rec.type === 'none') return isoDate(d) === isoDate(due);
  if (rec.type === 'daily') return true;
  if (rec.type === 'weekly') {
    const days = rec.days?.length ? rec.days : [due.getDay()];
    return days.includes(d.getDay());
  }
  if (rec.type === 'monthly') {
    const day = Math.max(1, Math.min(31, Number(rec.day) || due.getDate()));
    return d.getDate() === day;
  }
  return isoDate(d) === isoDate(due);
}

function taskDateHasItem(targetDate, tasks, events) {
  return tasks.some((t) => recurrenceMatches(t, targetDate)) || events.some((ev) => isoDate(new Date(ev.start)) === isoDate(targetDate));
}

async function renderTree() {
  const folders = (await getAll('folders')).filter((f) => f.workspaceId === state.workspaceId).sort((a, b) => a.order - b.order);
  const notes = (await getAll('notes')).filter((n) => n.workspaceId === state.workspaceId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const collapsedMap = (await get('meta', collapsedKey()))?.value || {};
  const root = $('tree');
  root.innerHTML = '';

  const makeNote = (n, depth = 0) => {
    const d = document.createElement('div');
    d.className = 'item note-item';
    d.style.marginLeft = `${depth * 16}px`;
    d.draggable = true;
    d.dataset.type = 'note';
    d.dataset.id = n.id;
    if (n.id === state.selectedNoteId) d.classList.add('selected');
    d.innerHTML = `<span class='item-label'>📝 ${n.title || 'Untitled'}</span><span><button data-a='rn'>✎</button><button data-a='del'>🗑</button></span>`;
    d.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; selectNote(n.id); };
    d.querySelector("button[data-a='rn']").onclick = async () => { n.title = prompt('Rename note', n.title) || n.title; await put('notes', n); await renderTree(); await renderLinkedNoteOptions(); };
    d.querySelector("button[data-a='del']").onclick = async () => {
      if (!confirm('Delete note?')) return;
      await del('notes', n.id);
      if (state.selectedNoteId === n.id) { state.selectedNoteId = null; $('editor').innerHTML = ''; $('noteTitle').value = ''; await renderBanner(null, 180, 50); }
      await renderTree();
      await renderLinkedNoteOptions();
      await renderTodayPanel();
      await renderCalendar();
    };
    attachDnD(d);
    return d;
  };

  const renderFolder = (f, depth = 0) => {
    const collapsed = Boolean(collapsedMap[f.id]);
    const d = document.createElement('div');
    d.className = 'item folder-item';
    d.style.marginLeft = `${depth * 16}px`;
    d.draggable = true;
    d.dataset.type = 'folder';
    d.dataset.id = f.id;
    d.innerHTML = `<span class='item-label'><button class='collapse-btn' data-a='toggle'>${collapsed ? '▸' : '▾'}</button> 📁 ${f.name}</span><span><button data-a='addn'>+N</button><button data-a='addf'>+F</button><button data-a='rn'>✎</button><button data-a='del'>🗑</button></span>`;
    d.querySelector("button[data-a='toggle']").onclick = async (e) => {
      e.stopPropagation();
      collapsedMap[f.id] = !collapsed;
      await put('meta', { key: collapsedKey(), value: collapsedMap });
      await renderTree();
    };
    d.querySelector("button[data-a='addn']").onclick = () => createNote(f.id);
    d.querySelector("button[data-a='addf']").onclick = () => createFolder(f.id);
    d.querySelector("button[data-a='rn']").onclick = async () => { f.name = prompt('Rename folder', f.name) || f.name; await put('folders', f); await renderTree(); };
    d.querySelector("button[data-a='del']").onclick = async () => { if (confirm('Delete folder and children?')) { await deleteFolderCascade(f.id); await renderTree(); await renderLinkedNoteOptions(); } };
    attachDnD(d);
    root.appendChild(d);
    if (collapsed) return;
    notes.filter((n) => n.folderId === f.id).forEach((n) => root.appendChild(makeNote(n, depth + 1)));
    folders.filter((c) => c.parentFolderId === f.id).forEach((c) => renderFolder(c, depth + 1));
  };

  notes.filter((n) => !n.folderId).forEach((n) => root.appendChild(makeNote(n)));
  folders.filter((f) => !f.parentFolderId).forEach((f) => renderFolder(f));
}

let dragData = null;
function attachDnD(el) {
  el.addEventListener('dragstart', () => { dragData = { type: el.dataset.type, id: el.dataset.id }; });
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragData || dragData.id === el.dataset.id) return;
    if (dragData.type === 'note') {
      const n = await get('notes', dragData.id);
      n.folderId = el.dataset.type === 'folder' ? el.dataset.id : null;
      n.order = Date.now();
      await put('notes', n);
    }
    if (dragData.type === 'folder' && el.dataset.type === 'folder') {
      const f = await get('folders', dragData.id);
      if (f.id === el.dataset.id) return;
      f.parentFolderId = el.dataset.id;
      f.order = Date.now();
      await put('folders', f);
    }
    await renderTree();
  });
}

async function deleteFolderCascade(folderId) {
  const folders = await getAll('folders');
  const notes = await getAll('notes');
  for (const n of notes.filter((x) => x.folderId === folderId)) await del('notes', n.id);
  for (const c of folders.filter((x) => x.parentFolderId === folderId)) await deleteFolderCascade(c.id);
  await del('folders', folderId);
}

async function createFolder(parentFolderId = null) {
  const name = prompt('Folder name', 'New Folder');
  if (!name) return;
  await put('folders', { id: uid(), workspaceId: state.workspaceId, parentFolderId, name, order: Date.now() });
  await renderTree();
}

async function createNote(folderId = null) {
  const title = prompt('Note title', 'Untitled') || 'Untitled';
  const n = {
    id: uid(), workspaceId: state.workspaceId, folderId, title, content: '', bannerImageId: null, bannerHeight: 180, bannerPosition: 50, updatedAt: Date.now(), order: Date.now(),
  };
  await put('notes', n);
  state.selectedNoteId = n.id;
  await renderTree();
  await renderLinkedNoteOptions();
  await selectNote(n.id);
}

async function selectNote(id) {
  state.selectedNoteId = id;
  const n = await get('notes', id);
  if (!n) return;
  $('noteTitle').value = n.title;
  $('editor').innerHTML = n.content || '';
  $('bannerHeight').value = n.bannerHeight || 180;
  $('bannerPosition').value = n.bannerPosition ?? 50;
  await renderBanner(n.bannerImageId, n.bannerHeight || 180, n.bannerPosition ?? 50);
  await renderTree();
}

async function renderBanner(imageId, height = 180, position = 50) {
  const wrap = $('bannerWrap');
  wrap.innerHTML = '';
  wrap.style.height = `${height}px`;
  if (!imageId) return;
  const img = await get('images', imageId);
  if (!img) return;
  const el = document.createElement('img');
  el.src = URL.createObjectURL(img.blob);
  el.style.height = `${height}px`;
  el.style.objectPosition = `center ${position}%`;
  wrap.appendChild(el);
}

async function saveCurrentNote() {
  if (!state.selectedNoteId) return;
  const n = await get('notes', state.selectedNoteId);
  if (!n) return;
  n.title = $('noteTitle').value || 'Untitled';
  n.content = $('editor').innerHTML;
  n.bannerHeight = Number($('bannerHeight').value) || n.bannerHeight || 180;
  n.bannerPosition = Number($('bannerPosition').value) || n.bannerPosition || 50;
  n.updatedAt = Date.now();
  await put('notes', n);
  await renderTree();
}

async function insertImage(file) {
  const id = uid();
  await put('images', { id, blob: file, createdAt: Date.now() });
  const html = `<div contenteditable='false' style='display:inline-block;resize:both;overflow:auto;border:1px solid #c7779f;border-radius:8px'><img src='${URL.createObjectURL(file)}' style='max-width:360px;display:block'/></div>`;
  document.execCommand('insertHTML', false, html);
  await saveCurrentNote();
}

function applyEditorStyles() {
  document.execCommand('fontName', false, $('editorFont').value);
}

function bindEditor() {
  document.querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = () => document.execCommand(b.dataset.cmd); });
  document.querySelectorAll('[data-block]').forEach((b) => { b.onclick = () => document.execCommand('formatBlock', false, b.dataset.block); });
  $('checkboxBtn').onclick = () => document.execCommand('insertHTML', false, `<label class='task-inline'><input type='checkbox'/> <span>Task item</span></label><br/>`);
  $('applyTextColorBtn').onclick = () => document.execCommand('foreColor', false, $('textColor').value);
  $('applyHighlightBtn').onclick = () => document.execCommand('hiliteColor', false, $('highlightColor').value);
  $('editorFont').onchange = applyEditorStyles;

  $('editor').addEventListener('change', saveCurrentNote);
  $('editor').addEventListener('input', () => setTimeout(saveCurrentNote, 150));
  $('editor').addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') {
      const sp = e.target.parentElement.querySelector('span');
      sp.style.textDecoration = e.target.checked ? 'line-through' : 'none';
      saveCurrentNote();
    }
  });
  $('editor').addEventListener('paste', async (e) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    await insertImage(item.getAsFile());
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommands();
    }
  });
}

function renderWeekdayHeader() {
  const wrap = $('weekdayHeader');
  wrap.innerHTML = '';
  WEEKDAY_LABELS.forEach((day) => {
    const cell = document.createElement('div');
    cell.className = 'weekday-cell';
    cell.textContent = day;
    wrap.appendChild(cell);
  });
}

async function renderCalendar() {
  const tasks = (await getAll('tasks')).filter((t) => t.workspaceId === state.workspaceId);
  const events = (await getAll('events')).filter((ev) => ev.workspaceId === state.workspaceId);
  const d = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
  $('monthLabel').textContent = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  const grid = $('calendar');
  grid.innerHTML = '';
  const weekdayShift = (d.getDay() + 6) % 7;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

  for (let i = 0; i < weekdayShift; i += 1) {
    const e = document.createElement('div');
    e.className = 'day blank';
    grid.appendChild(e);
  }
  for (let i = 1; i <= days; i += 1) {
    const day = new Date(d.getFullYear(), d.getMonth(), i);
    const cell = document.createElement('div');
    cell.className = 'day';
    const hasItem = taskDateHasItem(day, tasks, events);
    cell.innerHTML = `<span class='day-number'>${i}</span>${hasItem ? "<span class='day-dot'></span>" : ''}`;
    if (isoDate(day) === isoDate(new Date())) cell.classList.add('today');
    if (isoDate(day) === isoDate(state.selectedDate)) cell.classList.add('active');
    cell.onclick = () => { state.selectedDate = day; renderCalendar(); renderTodayPanel(); };
    grid.appendChild(cell);
  }
}

async function renderLinkedNoteOptions() {
  const notes = (await getAll('notes')).filter((n) => n.workspaceId === state.workspaceId).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  ['taskNoteLink', 'eventNoteLink'].forEach((id) => {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = "<option value=''>None</option>";
    notes.forEach((n) => {
      const o = document.createElement('option');
      o.value = n.id;
      o.textContent = n.title || 'Untitled';
      if (prev === n.id) o.selected = true;
      sel.appendChild(o);
    });
  });
}

function getSelectedWeeklyDays() {
  return [...document.querySelectorAll('.day-pill.active')].map((el) => Number(el.dataset.day)).filter((x) => !Number.isNaN(x));
}

function renderWeeklyPills(selectedDays = []) {
  const wrap = $('weeklyDaysWrap');
  wrap.innerHTML = '';
  WEEKDAY_LABELS.forEach((label, idx) => {
    const day = WEEKDAY_VALUES[idx];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `day-pill ${selectedDays.includes(day) ? 'active' : ''}`;
    btn.dataset.day = String(day);
    btn.textContent = label;
    btn.onclick = () => btn.classList.toggle('active');
    wrap.appendChild(btn);
  });
}

function syncRecurrenceVisibility() {
  const t = $('recurType').value;
  $('weeklyDaysWrap').style.display = t === 'weekly' ? 'flex' : 'none';
  $('weeklyQuickWrap').style.display = t === 'weekly' ? 'flex' : 'none';
  $('monthlyWrap').style.display = t === 'monthly' ? 'flex' : 'none';
}

async function renderTodayPanel() {
  const noteMap = new Map((await getAll('notes')).map((n) => [n.id, n]));
  const tasks = (await getAll('tasks')).filter((t) => t.workspaceId === state.workspaceId && recurrenceMatches(t, state.selectedDate));
  const events = (await getAll('events')).filter((ev) => ev.workspaceId === state.workspaceId && isoDate(new Date(ev.start)) === isoDate(state.selectedDate));
  const box = $('todayItems');
  box.innerHTML = '';

  tasks.forEach((t) => {
    const linked = t.noteId && noteMap.get(t.noteId);
    const recurrenceText = t.recurrence?.type === 'weekly' ? `Weekly (${(t.recurrence.days || []).join(',')})` : (t.recurrence?.type || 'none');
    const d = document.createElement('div');
    d.className = `item task${t.completed ? ' done' : ''}`;
    d.innerHTML = `<input type='checkbox' ${t.completed ? 'checked' : ''}/> <span>${t.title}</span> <small>${recurrenceText}</small> ${linked ? `<button data-note='${linked.id}' class='note-chip'>📝 ${linked.title || 'Untitled'}</button>` : ''} <button data-a='edit'>✎</button> <button data-a='del'>🗑</button>`;
    d.querySelector('input').onchange = async (e) => { t.completed = e.target.checked; t.updatedAt = Date.now(); await put('tasks', t); await renderTodayPanel(); await renderCalendar(); };
    d.querySelector("button[data-a='edit']").onclick = () => {
      state.editTaskId = t.id;
      $('taskTitle').value = t.title;
      $('recurType').value = t.recurrence?.type || 'none';
      $('monthlyDay').value = t.recurrence?.day || '';
      renderWeeklyPills(t.recurrence?.days || []);
      $('taskNoteLink').value = t.noteId || '';
      syncRecurrenceVisibility();
      $('addTaskBtn').textContent = 'Update Task';
    };
    d.querySelector("button[data-a='del']").onclick = async () => { await del('tasks', t.id); await renderTodayPanel(); await renderCalendar(); };
    const nb = d.querySelector('.note-chip');
    if (nb) nb.onclick = () => selectNote(nb.dataset.note);
    box.appendChild(d);
  });

  events.forEach((ev) => {
    const linked = ev.noteId && noteMap.get(ev.noteId);
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `📅 ${ev.title} (${new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}-${new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) ${linked ? `<button data-note='${linked.id}' class='note-chip'>📝 ${linked.title || 'Untitled'}</button>` : ''} <button data-a='edit'>✎</button> <button data-a='del'>🗑</button>`;
    d.querySelector("button[data-a='edit']").onclick = () => {
      state.editEventId = ev.id;
      $('eventTitle').value = ev.title;
      $('eventStart').value = toLocalDateTimeValue(ev.start);
      $('eventEnd').value = toLocalDateTimeValue(ev.end);
      $('eventNoteLink').value = ev.noteId || '';
      $('addEventBtn').textContent = 'Update Event';
    };
    d.querySelector("button[data-a='del']").onclick = async () => { await del('events', ev.id); await renderTodayPanel(); await renderCalendar(); };
    const nb = d.querySelector('.note-chip');
    if (nb) nb.onclick = () => selectNote(nb.dataset.note);
    box.appendChild(d);
  });
}

async function exportAll() {
  const data = {};
  for (const s of ['workspaces', 'folders', 'notes', 'tasks', 'events', 'meta']) data[s] = await getAll(s);
  data.images = [];
  for (const img of await getAll('images')) data.images.push({ id: img.id, createdAt: img.createdAt, blob: Array.from(new Uint8Array(await img.blob.arrayBuffer())), type: img.blob.type });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notepad-export.json';
  a.click();
  toast('Exported');
}

async function importData(mode) {
  const data = state.importData;
  if (!data) return;
  if (mode === 'replace') {
    for (const s of ['workspaces', 'folders', 'notes', 'tasks', 'events', 'images', 'meta']) {
      const all = await getAll(s);
      for (const x of all) await del(s, x.id || x.key);
    }
  }
  for (const s of ['workspaces', 'folders', 'notes', 'tasks', 'events', 'meta']) {
    for (const it of data[s] || []) await put(s, it);
  }
  for (const img of data.images || []) await put('images', { id: img.id, createdAt: img.createdAt, blob: new Blob([new Uint8Array(img.blob)], { type: img.type }) });
  $('importDialog').close();
  toast(`Imported (${mode})`);
  await activeWorkspace();
  await renderWorkspaces();
  await applyWorkspaceTheme();
  await renderTree();
  await renderLinkedNoteOptions();
  await renderCalendar();
  await renderTodayPanel();
}

async function searchNotes(q) {
  const notes = (await getAll('notes')).filter((n) => n.workspaceId === state.workspaceId && (`${n.title} ${n.content}`).toLowerCase().includes(q.toLowerCase()));
  return notes;
}

async function openCommands() {
  const p = $('commandPalette');
  p.classList.remove('hidden');
  const input = $('commandInput');
  input.value = '';
  input.focus();
  const base = [{ label: 'Create Note', run: () => createNote(null) }, { label: 'Create Folder', run: () => createFolder(null) }, { label: 'Go to Today', run: () => $('todayBtn').click() }];
  const render = async () => {
    const q = input.value.trim();
    let list = [...base];
    if (q) {
      const notes = await searchNotes(q);
      list = [...base, ...notes.map((n) => ({ label: `Open: ${n.title}`, run: () => selectNote(n.id) }))];
    }
    const ul = $('commandList');
    ul.innerHTML = '';
    list.forEach((c) => { const li = document.createElement('li'); li.textContent = c.label; li.onclick = () => { c.run(); p.classList.add('hidden'); }; ul.appendChild(li); });
  };
  input.oninput = render;
  render();
  p.onclick = (e) => { if (e.target === p) p.classList.add('hidden'); };
}

async function readImageAsStored(file) {
  const id = uid();
  await put('images', { id, blob: file, createdAt: Date.now() });
  return id;
}

async function applyWorkspaceTheme() {
  const ws = await getCurrentWorkspace();
  const s = ws.settings;
  document.documentElement.style.setProperty('--app-font', s.fontFamily || DEFAULT_WORKSPACE_SETTINGS.fontFamily);
  const backdrop = $('appBackdrop');
  backdrop.style.opacity = String(s.bgImageId ? (s.bgDim ?? 0.25) : 0);
  backdrop.style.filter = s.bgBlurEnabled ? `blur(${s.bgBlur || 0}px)` : 'none';
  backdrop.style.backgroundImage = 'none';
  if (s.bgImageId) {
    const img = await get('images', s.bgImageId);
    if (img) backdrop.style.backgroundImage = `url('${URL.createObjectURL(img.blob)}')`;
  }

  const avatarPreview = s.avatarEmoji || '🗂️';
  $('workspaceAvatar').value = avatarPreview;
  $('workspaceFont').value = s.fontFamily;
  $('workspaceDim').value = s.bgDim;
  $('workspaceBlurToggle').checked = Boolean(s.bgBlurEnabled);
  $('workspaceBlur').value = s.bgBlur;
  $('workspaceBlur').disabled = !s.bgBlurEnabled;

  $('clock24').checked = Boolean(s.clock24h);
  $('clockTimezone').value = s.clockTimezone;
}

function renderClock() {
  if (clockTimer) clearInterval(clockTimer);
  const tick = async () => {
    const ws = await getCurrentWorkspace();
    const opts = {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !ws.settings.clock24h, timeZone: ws.settings.clockTimezone,
    };
    $('clockTime').textContent = new Intl.DateTimeFormat([], opts).format(new Date());
  };
  tick();
  clockTimer = setInterval(tick, 1000);
}

function resetTaskForm() {
  state.editTaskId = null;
  $('taskTitle').value = '';
  $('recurType').value = 'none';
  $('monthlyDay').value = '';
  renderWeeklyPills([]);
  $('taskNoteLink').value = '';
  $('addTaskBtn').textContent = 'Save Task';
  syncRecurrenceVisibility();
}

function resetEventForm() {
  state.editEventId = null;
  $('eventTitle').value = '';
  $('eventStart').value = '';
  $('eventEnd').value = '';
  $('eventNoteLink').value = '';
  $('addEventBtn').textContent = 'Save Event';
}

async function bindUI() {
  $('clockTimezone').innerHTML = CLOCK_TIMEZONES.map((x) => `<option value='${x.value}'>${x.label}</option>`).join('');

  const savedLeftWidth = Number(localStorage.getItem('leftSidebarWidth') || 300);
  document.documentElement.style.setProperty('--left-width', `${Math.max(200, Math.min(520, savedLeftWidth))}px`);
  if (localStorage.getItem('leftSidebarCollapsed') === '1') document.body.classList.add('left-collapsed');

  $('toggleLeftSidebar').onclick = () => {
    document.body.classList.toggle('left-collapsed');
    localStorage.setItem('leftSidebarCollapsed', document.body.classList.contains('left-collapsed') ? '1' : '0');
  };

  $('leftResizer').addEventListener('mousedown', (e) => {
    if (document.body.classList.contains('left-collapsed')) return;
    e.preventDefault();
    const onMove = (ev) => {
      const next = Math.max(200, Math.min(520, ev.clientX));
      document.documentElement.style.setProperty('--left-width', `${next}px`);
      localStorage.setItem('leftSidebarWidth', String(next));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  $('addWorkspaceBtn').onclick = async () => {
    const name = prompt('Workspace name', 'Workspace');
    if (!name) return;
    const ws = { id: uid(), name, createdAt: Date.now(), settings: { ...DEFAULT_WORKSPACE_SETTINGS } };
    await put('workspaces', ws);
    state.workspaceId = ws.id;
    await put('meta', { key: 'activeWorkspaceId', value: ws.id });
    await renderWorkspaces();
    await applyWorkspaceTheme();
    await renderTree();
    await renderLinkedNoteOptions();
    await renderTodayPanel();
    await renderCalendar();
  };
  $('renameWorkspaceBtn').onclick = async () => {
    const ws = await getCurrentWorkspace();
    if (!ws.id) return;
    ws.name = prompt('Rename workspace', ws.name) || ws.name;
    await put('workspaces', ws);
    await renderWorkspaces();
  };
  $('deleteWorkspaceBtn').onclick = async () => {
    if (!confirm('Delete workspace and all data?')) return;
    const id = state.workspaceId;
    for (const s of ['folders', 'notes', 'tasks', 'events']) for (const i of await getAll(s)) if (i.workspaceId === id) await del(s, i.id);
    await del('workspaces', id);
    await activeWorkspace();
    await renderWorkspaces();
    await applyWorkspaceTheme();
    await renderTree();
    await renderLinkedNoteOptions();
    await renderTodayPanel();
    await renderCalendar();
  };
  $('workspaceSelect').onchange = async (e) => {
    state.workspaceId = e.target.value;
    await put('meta', { key: 'activeWorkspaceId', value: state.workspaceId });
    state.selectedNoteId = null;
    await renderTree();
    await renderLinkedNoteOptions();
    await applyWorkspaceTheme();
    renderClock();
    await renderCalendar();
    await renderTodayPanel();
  };

  $('workspaceAvatar').onchange = async () => updateWorkspaceSettings({ avatarEmoji: $('workspaceAvatar').value || '🗂️', avatarImageId: null });
  $('workspaceAvatarUpload').onchange = async (e) => {
    if (!e.target.files[0]) return;
    const imageId = await readImageAsStored(e.target.files[0]);
    await updateWorkspaceSettings({ avatarImageId: imageId, avatarEmoji: '🖼️' });
  };
  $('workspaceFont').onchange = async () => updateWorkspaceSettings({ fontFamily: $('workspaceFont').value });
  $('workspaceBgUpload').onchange = async (e) => {
    if (!e.target.files[0]) return;
    const imageId = await readImageAsStored(e.target.files[0]);
    await updateWorkspaceSettings({ bgImageId: imageId });
  };
  $('workspaceDim').oninput = async () => updateWorkspaceSettings({ bgDim: Number($('workspaceDim').value) });
  $('workspaceBlurToggle').onchange = async () => updateWorkspaceSettings({ bgBlurEnabled: $('workspaceBlurToggle').checked });
  $('workspaceBlur').oninput = async () => updateWorkspaceSettings({ bgBlur: Number($('workspaceBlur').value) });
  $('clearWorkspaceBgBtn').onclick = async () => updateWorkspaceSettings({ bgImageId: null });
  $('clock24').onchange = async () => { await updateWorkspaceSettings({ clock24h: $('clock24').checked }); renderClock(); };
  $('clockTimezone').onchange = async () => { await updateWorkspaceSettings({ clockTimezone: $('clockTimezone').value }); renderClock(); };

  $('addFolderBtn').onclick = () => createFolder(null);
  $('addNoteBtn').onclick = () => createNote(null);
  $('noteTitle').oninput = () => setTimeout(saveCurrentNote, 120);

  $('bannerInput').onchange = async (e) => {
    if (!state.selectedNoteId || !e.target.files[0]) return;
    const imageId = await readImageAsStored(e.target.files[0]);
    const n = await get('notes', state.selectedNoteId);
    n.bannerImageId = imageId;
    n.updatedAt = Date.now();
    await put('notes', n);
    await renderBanner(imageId, n.bannerHeight || 180, n.bannerPosition ?? 50);
    toast('Banner updated');
  };
  $('bannerHeight').oninput = async () => {
    if (!state.selectedNoteId) return;
    const n = await get('notes', state.selectedNoteId);
    n.bannerHeight = Number($('bannerHeight').value);
    await put('notes', n);
    await renderBanner(n.bannerImageId, n.bannerHeight, n.bannerPosition ?? 50);
  };
  $('bannerPosition').oninput = async () => {
    if (!state.selectedNoteId) return;
    const n = await get('notes', state.selectedNoteId);
    n.bannerPosition = Number($('bannerPosition').value);
    await put('notes', n);
    await renderBanner(n.bannerImageId, n.bannerHeight || 180, n.bannerPosition);
  };
  $('removeBannerBtn').onclick = async () => {
    if (!state.selectedNoteId) return;
    const n = await get('notes', state.selectedNoteId);
    n.bannerImageId = null;
    await put('notes', n);
    await renderBanner(null, n.bannerHeight || 180, n.bannerPosition ?? 50);
  };
  $('imageInput').onchange = async (e) => { if (e.target.files[0]) await insertImage(e.target.files[0]); };

  $('prevMonth').onclick = () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() - 1); renderCalendar(); };
  $('nextMonth').onclick = () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() + 1); renderCalendar(); };
  $('todayBtn').onclick = () => { state.selectedDate = new Date(); state.calendarMonth = new Date(); renderCalendar(); renderTodayPanel(); };

  $('recurType').onchange = syncRecurrenceVisibility;
  $('weekdaysBtn').onclick = () => renderWeeklyPills([1, 2, 3, 4, 5]);
  $('weekendsBtn').onclick = () => renderWeeklyPills([0, 6]);
  $('clearWeeklyBtn').onclick = () => renderWeeklyPills([]);
  renderWeeklyPills([]);
  syncRecurrenceVisibility();

  $('addTaskBtn').onclick = async () => {
    const title = $('taskTitle').value.trim();
    if (!title) return;
    const type = $('recurType').value;
    let recurrence = { type: 'none' };
    if (type === 'daily') recurrence = { type: 'daily' };
    if (type === 'weekly') recurrence = { type: 'weekly', days: getSelectedWeeklyDays() };
    if (type === 'monthly') recurrence = { type: 'monthly', day: Number($('monthlyDay').value) || state.selectedDate.getDate() };

    const payload = {
      id: state.editTaskId || uid(),
      workspaceId: state.workspaceId,
      title,
      dueDate: state.selectedDate.toISOString(),
      completed: false,
      recurrence,
      noteId: $('taskNoteLink').value || null,
      updatedAt: Date.now(),
    };
    if (state.editTaskId) {
      const existing = await get('tasks', state.editTaskId);
      payload.completed = existing?.completed || false;
      payload.dueDate = existing?.dueDate || payload.dueDate;
    }
    await put('tasks', payload);
    resetTaskForm();
    await renderTodayPanel();
    await renderCalendar();
  };

  $('addEventBtn').onclick = async () => {
    const title = $('eventTitle').value.trim();
    const start = $('eventStart').value;
    const end = $('eventEnd').value;
    if (!title || !start || !end) return toast('Event fields missing');
    await put('events', {
      id: state.editEventId || uid(),
      workspaceId: state.workspaceId,
      title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      noteId: $('eventNoteLink').value || null,
      updatedAt: Date.now(),
    });
    resetEventForm();
    await renderTodayPanel();
    await renderCalendar();
  };

  $('exportBtn').onclick = exportAll;
  $('importInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.importData = JSON.parse(await file.text());
    $('importDialog').showModal();
  };
  $('mergeImportBtn').onclick = () => importData('merge');
  $('replaceImportBtn').onclick = () => importData('replace');
  $('searchToggle').onclick = openCommands;
}

(async function init() {
  db = await openDB();
  await ensureSeed();
  await activeWorkspace();
  bindEditor();
  await bindUI();
  await renderWorkspaces();
  await applyWorkspaceTheme();
  renderClock();
  await renderTree();
  await renderLinkedNoteOptions();
  renderWeekdayHeader();
  await renderCalendar();
  await renderTodayPanel();
  toast('Ready');
}());
