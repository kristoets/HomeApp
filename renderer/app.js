// ── API bridge (works with both PyWebView and Electron) ────────────────────
function getApi() {
  if (window.pywebview) return window.pywebview.api;
  if (window.api) return null; // Electron exposes nested api
  return null;
}

// Unified call that works with pywebview (flat method names) or electron (nested)
async function call(method, ...args) {
  // PyWebView: window.pywebview.api.method_name(args)
  if (window.pywebview && window.pywebview.api) {
    return window.pywebview.api[method](...args);
  }
  // Electron fallback (not used on Mac but useful for Windows Electron)
  if (window.api) {
    const [ns, fn] = method.split('_');
    if (window.api[ns] && window.api[ns][fn]) {
      return window.api[ns][fn](...args);
    }
  }
  throw new Error('No API bridge available');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getMondayOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  auth: 'unknown',
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth() + 1,
  viewMode: 'rolling',     // 'rolling' | 'month'
  viewAnchor: getMondayOfWeek(new Date()),
  events: [],
  eventsLoading: false,
  calendars: [],
  calendarVisibility: {},
  editingEvent: null,
  taskLists: [],
  activeTaskListId: '@default',
  taskListCounts: {},
  tasks: [],
  completedTasks: [],
  tasksLoading: false,
  tasksError: null,
  dragSrc: null
};

// ── Global callbacks from Python ───────────────────────────────────────────
window._onAuthSuccess = async function () {
  state.auth = 'logged-in';
  updateAuthUI();
  await loadCalendarList();
  loadCalendarEvents();
  await loadTaskLists();
  loadTasks();
};

window._onAuthExpired = function () {
  state.auth = 'not-logged-in';
  updateAuthUI();
};

window._onAuthError = function (msg) {
  alert('Login failed: ' + msg);
};

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  updateClock();
  setInterval(updateClock, 60000);
  initTimePickers();

  const res = await call('auth_status');
  state.auth = res.status;
  updateAuthUI();

  if (state.auth === 'logged-in') {
    await loadCalendarList();
    await loadCalendarEvents();
    await loadTaskLists();
    await loadTasks();
  } else {
    renderTasks();
  }

  setInterval(() => {
    if (state.auth === 'logged-in') {
      loadCalendarEvents();
      loadTasks();
    }
  }, 5 * 60 * 1000);

  renderCalendar();
  renderCalendarLegend();
  bindEvents();
}

function updateClock() {
  const now = new Date();
  document.getElementById('topbar-date').textContent =
    now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
    '  ·  ' +
    now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Auth UI ────────────────────────────────────────────────────────────────
function updateAuthUI() {
  const btnLogin = document.getElementById('btn-login');
  const authUser = document.getElementById('auth-user');
  const authSetup = document.getElementById('auth-setup');
  const btnAddEvent = document.getElementById('btn-add-event');

  btnLogin.style.display = 'none';
  authUser.style.display = 'none';
  authSetup.style.display = 'none';
  btnAddEvent.style.display = 'none';
  document.getElementById('btn-refresh').style.display = 'none';

  if (state.auth === 'no-credentials') {
    authSetup.style.display = 'flex';
  } else if (state.auth === 'not-logged-in') {
    btnLogin.style.display = 'inline-flex';
  } else if (state.auth === 'logged-in') {
    authUser.style.display = 'flex';
    btnAddEvent.style.display = 'inline-flex';
    document.getElementById('btn-refresh').style.display = 'inline-flex';
  }
}

// ── Calendar Data ──────────────────────────────────────────────────────────
async function loadCalendarEvents() {
  if (state.eventsLoading) return;
  state.eventsLoading = true;
  document.getElementById('cal-loading').style.display = 'block';
  document.getElementById('cal-error').style.display = 'none';
  document.getElementById('btn-refresh').classList.add('spinning');

  let startStr, endStr;
  if (state.viewMode === 'rolling') {
    const s = new Date(state.viewAnchor);
    const e = new Date(state.viewAnchor);
    e.setDate(e.getDate() + 35);
    startStr = dateKey(s);
    endStr = dateKey(e);
  } else {
    const { viewYear: y, viewMonth: m } = state;
    startStr = dateKey(new Date(y, m - 2, 1));
    endStr = dateKey(new Date(y, m + 1, 1));
  }

  const res = await call('calendar_events', startStr, endStr);

  state.eventsLoading = false;
  document.getElementById('cal-loading').style.display = 'none';
  document.getElementById('btn-refresh').classList.remove('spinning');

  if (res.error) {
    document.getElementById('cal-error').textContent = 'Error: ' + res.error;
    document.getElementById('cal-error').style.display = 'block';
    state.events = [];
  } else {
    state.events = res.events || [];
  }

  renderCalendar();
}

// ── Calendar List & Visibility ─────────────────────────────────────────────
async function loadCalendarList() {
  const [calRes, visRes] = await Promise.all([
    call('calendar_list'),
    call('calendar_visibility_get')
  ]);
  state.calendars = calRes.calendars || [];
  state.calendarVisibility = visRes || {};
  document.getElementById('btn-calendars').style.display = 'inline-flex';
  renderCalendarLegend();
}

function renderCalendarLegend() {
  const legend = document.getElementById('calendar-legend');
  legend.innerHTML = '';
  const visible = state.calendars.filter(c => state.calendarVisibility[c.id] !== false);
  for (const cal of visible) {
    const chip = document.createElement('span');
    chip.className = 'legend-chip';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = cal.color;
    const name = document.createElement('span');
    name.textContent = cal.name;
    chip.appendChild(dot);
    chip.appendChild(name);
    legend.appendChild(chip);
  }
}

function showCalendarModal() {
  const body = document.getElementById('modal-calendars-body');
  body.innerHTML = '';
  for (const cal of state.calendars) {
    const checked = state.calendarVisibility[cal.id] !== false;
    const row = document.createElement('label');
    row.className = 'calendar-toggle-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', async () => {
      state.calendarVisibility[cal.id] = cb.checked;
      await call('calendar_visibility_set', state.calendarVisibility);
      renderCalendarLegend();
      await loadCalendarEvents();
    });
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = cal.color;
    const name = document.createElement('span');
    name.textContent = cal.name;
    row.appendChild(cb);
    row.appendChild(dot);
    row.appendChild(name);
    body.appendChild(row);
  }
  document.getElementById('modal-calendars').style.display = 'flex';
}

// ── Calendar Render ────────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

function buildEventMap() {
  const map = {};
  for (const ev of state.events) {
    const raw = ev.start?.date || ev.start?.dateTime;
    if (!raw) continue;
    const key = raw.substring(0, 10);
    if (!map[key]) map[key] = [];
    map[key].push(ev);
  }
  return map;
}

function buildDayCell(date, extraClass, eventMap) {
  const key = dateKey(date);
  const dayEvents = eventMap[key] || [];
  const isToday = key === dateKey(new Date());
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

  const cell = document.createElement('div');
  cell.className = 'cal-day' +
    (extraClass ? ' ' + extraClass : '') +
    (isToday ? ' today' : '') +
    (isWeekend ? ' weekend' : '');
  cell.dataset.date = key;

  const numEl = document.createElement('div');
  numEl.className = 'cal-day-num';
  if (date.getDate() === 1 && extraClass !== 'other-month') {
    numEl.textContent = MONTH_NAMES[date.getMonth()].slice(0, 3) + ' 1';
  } else {
    numEl.textContent = date.getDate();
  }
  cell.appendChild(numEl);

  const maxShow = 3;
  for (let i = 0; i < Math.min(dayEvents.length, maxShow); i++) {
    const ev = dayEvents[i];
    const evEl = document.createElement('div');
    evEl.className = 'cal-event';
    const time = ev.start?.dateTime ? ' · ' + formatTime(ev.start.dateTime) : '';
    evEl.textContent = (ev.summary || '(no title)') + time;
    const hex = ev._displayColor;
    if (hex) {
      evEl.style.background = hex + '28';
      evEl.style.color = hex;
      evEl.style.borderLeftColor = hex;
    }
    cell.appendChild(evEl);
  }
  if (dayEvents.length > maxShow) {
    const more = document.createElement('div');
    more.className = 'cal-event more';
    more.textContent = `+${dayEvents.length - maxShow} more`;
    cell.appendChild(more);
  }

  cell.addEventListener('click', (e) => showDayPopup(e, key, dayEvents));
  return cell;
}

function renderCalendar() {
  if (state.viewMode === 'rolling') {
    renderCalendarRolling();
  } else {
    renderCalendarMonth();
  }
}

function renderCalendarRolling() {
  const anchor = state.viewAnchor;
  const lastDay = new Date(anchor);
  lastDay.setDate(anchor.getDate() + 34);

  let label;
  if (anchor.getMonth() === lastDay.getMonth() && anchor.getFullYear() === lastDay.getFullYear()) {
    label = `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
  } else if (anchor.getFullYear() === lastDay.getFullYear()) {
    label = `${MONTH_NAMES[anchor.getMonth()].slice(0,3)} – ${MONTH_NAMES[lastDay.getMonth()].slice(0,3)} ${anchor.getFullYear()}`;
  } else {
    label = `${MONTH_NAMES[anchor.getMonth()].slice(0,3)} ${anchor.getFullYear()} – ${MONTH_NAMES[lastDay.getMonth()].slice(0,3)} ${lastDay.getFullYear()}`;
  }
  document.getElementById('cal-month-label').textContent = label;

  const eventMap = buildEventMap();
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  for (let i = 0; i < 35; i++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    grid.appendChild(buildDayCell(d, null, eventMap));
  }
}

function renderCalendarMonth() {
  const { viewYear: year, viewMonth: month } = state;
  document.getElementById('cal-month-label').textContent = `${MONTH_NAMES[month - 1]} ${year}`;

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startDow = (firstDay.getDay() + 6) % 7;

  const days = [];
  for (let i = startDow - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month - 1, -i), other: true });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month - 1, d), other: false });
  }
  const remaining = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    days.push({ date: new Date(year, month, i), other: true });
  }

  const eventMap = buildEventMap();
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  for (const { date, other } of days) {
    grid.appendChild(buildDayCell(date, other ? 'other-month' : null, eventMap));
  }
}

function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formatTime(dateTimeStr) {
  return new Date(dateTimeStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function initTimePickers() {
  ['event-start', 'event-end'].forEach(prefix => {
    const hourSel = document.getElementById(`${prefix}-hour`);
    const minSel = document.getElementById(`${prefix}-minute`);
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = o.textContent = String(h).padStart(2, '0');
      hourSel.appendChild(o);
    }
    for (let m = 0; m < 60; m += 5) {
      const o = document.createElement('option');
      o.value = o.textContent = String(m).padStart(2, '0');
      minSel.appendChild(o);
    }
  });
}

function setTimePicker(prefix, hhmm) {
  const [h, m] = hhmm.split(':');
  document.getElementById(`${prefix}-hour`).value = h.padStart(2, '0');
  const rounded = String(Math.round(parseInt(m || '0') / 5) * 5 % 60).padStart(2, '0');
  document.getElementById(`${prefix}-minute`).value = rounded;
}

function getTimePicker(prefix) {
  return document.getElementById(`${prefix}-hour`).value + ':' +
         document.getElementById(`${prefix}-minute`).value;
}

function localDateTimeStr(dateStr, timeStr) {
  const offset = -new Date().getTimezoneOffset(); // minutes ahead of UTC
  const sign = offset >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const m = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${dateStr}T${timeStr}:00${sign}${h}:${m}`;
}

// ── Day popup ──────────────────────────────────────────────────────────────
function showDayPopup(e, dateStr, events) {
  const popup = document.getElementById('day-popup');
  const title = document.getElementById('day-popup-title');
  const eventsEl = document.getElementById('day-popup-events');

  const d = new Date(dateStr + 'T00:00:00');
  title.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  eventsEl.innerHTML = '';
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'popup-no-events';
    empty.textContent = 'No events';
    eventsEl.appendChild(empty);
  } else {
    for (const ev of events) {
      const el = document.createElement('div');
      el.className = 'popup-event';
      if (ev._displayColor) {
        el.style.borderLeft = `3px solid ${ev._displayColor}`;
        el.style.paddingLeft = '8px';
      }

      const infoEl = document.createElement('div');
      infoEl.className = 'popup-event-info';

      const timeEl = document.createElement('div');
      timeEl.className = 'popup-event-time';
      if (ev.start?.dateTime) {
        timeEl.textContent = formatTime(ev.start.dateTime) + ' – ' + formatTime(ev.end?.dateTime || ev.start.dateTime);
      } else {
        timeEl.textContent = 'All day';
      }
      const titleEl = document.createElement('div');
      titleEl.className = 'popup-event-title';
      titleEl.textContent = ev.summary || '(no title)';
      infoEl.appendChild(timeEl);
      infoEl.appendChild(titleEl);
      if (ev._calendarName) {
        const calEl = document.createElement('div');
        calEl.className = 'popup-event-calendar';
        calEl.textContent = ev._calendarName;
        if (ev._displayColor) calEl.style.color = ev._displayColor;
        infoEl.appendChild(calEl);
      }

      const actionsEl = document.createElement('div');
      actionsEl.className = 'popup-event-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'popup-action-btn';
      editBtn.title = 'Edit';
      editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('day-popup').style.display = 'none';
        showEventModal(null, ev);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'popup-action-btn popup-action-btn-danger';
      delBtn.title = 'Delete';
      delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteEvent(ev);
      });

      actionsEl.appendChild(editBtn);
      actionsEl.appendChild(delBtn);
      el.appendChild(infoEl);
      el.appendChild(actionsEl);
      eventsEl.appendChild(el);
    }
  }

  const rect = e.currentTarget.getBoundingClientRect();
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';

  let left = rect.right + 8;
  let top = rect.top;
  if (left + 290 > winW) left = rect.left - 290;
  if (top + 320 > winH) top = winH - 330;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

// ── Google Tasks ────────────────────────────────────────────────────────────
async function loadTaskLists() {
  const res = await call('tasklists_get');
  if (!res.error) {
    state.taskLists = res.lists || [];
    if (state.taskLists.length > 0 && !state.taskLists.find(l => l.id === state.activeTaskListId)) {
      state.activeTaskListId = state.taskLists[0].id;
    }
  }
  renderTaskListTabs();
  // Fetch active-task counts for all lists in parallel (background)
  if (state.taskLists.length > 1) {
    Promise.all(
      state.taskLists.map(l => call('tasks_get', l.id).then(r => ({ id: l.id, count: (r.tasks || []).length })))
    ).then(results => {
      results.forEach(({ id, count }) => { state.taskListCounts[id] = count; });
      renderTaskListTabs();
    });
  }
}

function renderTaskListTabs() {
  const container = document.getElementById('task-lists-tabs');
  if (!container) return;
  container.innerHTML = '';
  if (state.auth !== 'logged-in' || state.taskLists.length <= 1) return;
  state.taskLists.forEach(list => {
    const btn = document.createElement('button');
    btn.className = 'task-list-tab' + (list.id === state.activeTaskListId ? ' active' : '');

    const label = document.createElement('span');
    label.textContent = list.name;
    btn.appendChild(label);

    const count = state.taskListCounts[list.id];
    if (count != null && count > 0) {
      const badge = document.createElement('span');
      badge.className = 'task-list-badge';
      badge.textContent = count;
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => {
      state.activeTaskListId = list.id;
      renderTaskListTabs();
      loadTasks();
    });
    container.appendChild(btn);
  });
}

async function loadTasks() {
  if (state.tasksLoading) return;
  state.tasksLoading = true;
  const res = await call('tasks_get', state.activeTaskListId);
  state.tasksLoading = false;
  if (res.error) {
    state.tasksError = res.error;
    state.tasks = [];
    state.completedTasks = [];
  } else {
    state.tasksError = null;
    state.tasks = res.tasks || [];
    state.completedTasks = res.completed || [];
    // Keep count for active list in sync from the already-loaded data
    state.taskListCounts[state.activeTaskListId] = state.tasks.length;
    renderTaskListTabs();
  }
  renderTasks();
}

function renderTasks() {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';

  if (state.auth !== 'logged-in') {
    const msg = document.createElement('div');
    msg.className = 'tasks-message';
    msg.textContent = 'Connect Google Calendar to sync tasks.';
    list.appendChild(msg);
    return;
  }

  if (state.tasksError) {
    const msg = document.createElement('div');
    msg.className = 'tasks-message tasks-error';
    msg.textContent = 'Could not load tasks. Try reconnecting your Google account.';
    list.appendChild(msg);
    return;
  }

  state.tasks.forEach(task => list.appendChild(makeTaskEl(task, false)));

  if (state.completedTasks.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'todo-done-divider';
    divider.textContent = `Completed (${state.completedTasks.length})`;
    list.appendChild(divider);
    state.completedTasks.forEach(task => list.appendChild(makeTaskEl(task, true)));
  }
}

function makeTaskEl(task, isDone) {
  const item = document.createElement('div');
  item.className = 'todo-item' + (isDone ? ' done' : '');
  item.dataset.id = task.id;
  item.draggable = !isDone;

  if (!isDone) {
    const handle = document.createElement('span');
    handle.className = 'todo-drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';
    item.appendChild(handle);
  }

  const check = document.createElement('div');
  check.className = 'todo-checkbox' + (isDone ? ' checked' : '');
  check.title = isDone ? 'Mark as not done' : 'Mark as done';
  check.addEventListener('click', () => toggleTask(task.id, isDone));
  item.appendChild(check);

  const text = document.createElement('div');
  text.className = 'todo-text';
  text.textContent = task.title || '';
  if (!isDone) {
    text.addEventListener('dblclick', () => startEditTask(item, text, task));
  }
  item.appendChild(text);

  const del = document.createElement('button');
  del.className = 'todo-delete';
  del.textContent = '✕';
  del.title = 'Delete';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
  item.appendChild(del);

  if (!isDone) {
    item.addEventListener('dragstart', onDragStart);
    item.addEventListener('dragover', onDragOver);
    item.addEventListener('dragleave', onDragLeave);
    item.addEventListener('drop', onDrop);
    item.addEventListener('dragend', onDragEnd);
  }

  return item;
}

function startEditTask(_item, textEl, task) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'todo-text-edit';
  input.value = task.title || '';
  textEl.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== task.title) {
      await call('tasks_update_title', task.id, newTitle, state.activeTaskListId);
    }
    await loadTasks();
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { saved = true; loadTasks(); }
  });
}

async function addTask(title) {
  title = title.trim();
  if (!title) return;
  await call('tasks_add', title, state.activeTaskListId);
  await loadTasks();
}

async function toggleTask(taskId, isDone) {
  await call('tasks_complete', taskId, !isDone, state.activeTaskListId);
  await loadTasks();
}

async function deleteTask(taskId) {
  await call('tasks_delete', taskId, state.activeTaskListId);
  await loadTasks();
}

// ── Drag & Drop ────────────────────────────────────────────────────────────
function onDragStart(e) {
  state.dragSrc = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.id);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (this.dataset.id !== state.dragSrc) this.classList.add('drag-over');
}

function onDragLeave() { this.classList.remove('drag-over'); }

async function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const srcId = state.dragSrc;
  const dstId = this.dataset.id;
  if (srcId === dstId) return;

  const active = [...state.tasks];
  const srcIdx = active.findIndex(t => t.id === srcId);
  const dstIdx = active.findIndex(t => t.id === dstId);
  if (srcIdx < 0 || dstIdx < 0) return;

  const [moved] = active.splice(srcIdx, 1);
  active.splice(dstIdx, 0, moved);

  const newIdx = active.findIndex(t => t.id === srcId);
  const previousId = newIdx > 0 ? active[newIdx - 1].id : null;

  state.tasks = active;
  renderTasks();

  await call('tasks_reorder', srcId, previousId, state.activeTaskListId);
  await loadTasks();
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
  state.dragSrc = null;
}

// ── Event Modal ────────────────────────────────────────────────────────────
function showEventModal(prefillDate, editEvent = null) {
  state.editingEvent = editEvent;
  const isEdit = !!editEvent;

  document.getElementById('modal-event-title').textContent = isEdit ? 'Edit Event' : 'New Calendar Event';
  document.getElementById('modal-event-save').textContent = isEdit ? 'Update' : 'Save';
  document.getElementById('event-error').style.display = 'none';

  // Calendar selector — always visible; pre-select current calendar when editing
  const calList = document.getElementById('event-calendar-list');
  calList.innerHTML = '';
  const visible = state.calendars.filter(c => state.calendarVisibility[c.id] !== false);
  visible.forEach((cal, i) => {
    const label = document.createElement('label');
    label.className = 'calendar-radio-row';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'event-calendar';
    radio.value = cal.id;
    radio.checked = isEdit ? cal.id === editEvent._calendarId : (cal.primary || i === 0);
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = cal.color;
    const name = document.createElement('span');
    name.textContent = cal.name;
    label.appendChild(radio);
    label.appendChild(dot);
    label.appendChild(name);
    calList.appendChild(label);
  });

  const allDay = isEdit ? !editEvent.start?.dateTime : false;
  document.getElementById('event-allday').checked = allDay;
  document.getElementById('event-time-section').style.display = allDay ? 'none' : '';

  if (isEdit) {
    document.getElementById('event-title').value = editEvent.summary || '';
    if (allDay) {
      document.getElementById('event-date').value = editEvent.start.date;
    } else {
      const s = new Date(editEvent.start.dateTime);
      const e2 = new Date(editEvent.end?.dateTime || editEvent.start.dateTime);
      document.getElementById('event-date').value = dateKey(s);
      setTimePicker('event-start', s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      setTimePicker('event-end', e2.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    }
  } else {
    document.getElementById('event-title').value = '';
    document.getElementById('event-date').value = prefillDate || dateKey(new Date());
    setTimePicker('event-start', '09:00');
    setTimePicker('event-end', '10:00');
  }

  document.getElementById('modal-event').style.display = 'flex';
  document.getElementById('event-title').focus();
}

async function deleteEvent(ev) {
  if (!confirm(`Delete "${ev.summary || 'this event'}"?`)) return;
  document.getElementById('day-popup').style.display = 'none';
  const res = await call('calendar_delete_event', ev.id, ev._calendarId);
  if (res.error) { alert('Delete failed: ' + res.error); return; }
  await loadCalendarEvents();
}

async function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const allDay = document.getElementById('event-allday').checked;
  const errEl = document.getElementById('event-error');

  if (!title) { showError(errEl, 'Title is required.'); return; }
  if (!date) { showError(errEl, 'Date is required.'); return; }
  errEl.style.display = 'none';

  const startTime = getTimePicker('event-start');
  const endTime = getTimePicker('event-end');

  let startVal, endVal;
  if (allDay) {
    startVal = date;
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    endVal = dateKey(endDate);
  } else {
    startVal = localDateTimeStr(date, startTime);
    endVal = localDateTimeStr(date, endTime);
  }

  const selectedCalId = document.querySelector('input[name="event-calendar"]:checked')?.value || 'primary';
  const btn = document.getElementById('modal-event-save');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  let res;
  if (state.editingEvent) {
    let targetCalId = state.editingEvent._calendarId;
    if (selectedCalId !== targetCalId) {
      const moveRes = await call('calendar_move_event', state.editingEvent.id, targetCalId, selectedCalId);
      if (moveRes.error) { showError(errEl, moveRes.error); btn.textContent = 'Update'; btn.disabled = false; return; }
      targetCalId = selectedCalId;
    }
    res = await call('calendar_update_event', state.editingEvent.id, targetCalId, title, startVal, endVal, allDay);
  } else {
    res = await call('calendar_create_event', title, startVal, endVal, allDay, selectedCalId);
  }

  btn.textContent = state.editingEvent ? 'Update' : 'Save';
  btn.disabled = false;

  if (res.error) { showError(errEl, res.error); return; }

  state.editingEvent = null;
  document.getElementById('modal-event').style.display = 'none';
  await loadCalendarEvents();
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// ── Credentials Modal ──────────────────────────────────────────────────────
function showCredsModal() {
  document.getElementById('modal-creds').style.display = 'flex';
  document.getElementById('creds-input').value = '';
  document.getElementById('creds-error').style.display = 'none';
}

async function saveCreds() {
  const json = document.getElementById('creds-input').value.trim();
  const errEl = document.getElementById('creds-error');
  if (!json) { showError(errEl, 'Paste your credentials JSON first.'); return; }
  const res = await call('auth_save_credentials', json);
  if (res.error) { showError(errEl, res.error); return; }
  document.getElementById('modal-creds').style.display = 'none';
  state.auth = 'not-logged-in';
  updateAuthUI();
}

// ── Navigation ─────────────────────────────────────────────────────────────
function changeMonth(delta) {
  if (state.viewMode === 'rolling') {
    state.viewMode = 'month';
    if (delta === -1) {
      state.viewYear = state.viewAnchor.getFullYear();
      state.viewMonth = state.viewAnchor.getMonth() + 1;
    } else {
      const nextWeekStart = new Date(state.viewAnchor);
      nextWeekStart.setDate(state.viewAnchor.getDate() + 35);
      state.viewYear = nextWeekStart.getFullYear();
      state.viewMonth = nextWeekStart.getMonth() + 1;
    }
  } else {
    state.viewMonth += delta;
    if (state.viewMonth > 12) { state.viewMonth = 1; state.viewYear++; }
    if (state.viewMonth < 1) { state.viewMonth = 12; state.viewYear--; }
  }
  renderCalendar();
  if (state.auth === 'logged-in') loadCalendarEvents();
}

// ── Bind Events ────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('cal-prev').addEventListener('click', () => changeMonth(-1));
  document.getElementById('cal-next').addEventListener('click', () => changeMonth(1));
  document.getElementById('btn-today').addEventListener('click', () => {
    const now = new Date();
    state.viewMode = 'rolling';
    state.viewAnchor = getMondayOfWeek(now);
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth() + 1;
    renderCalendar();
    if (state.auth === 'logged-in') loadCalendarEvents();
  });

  document.getElementById('btn-login').addEventListener('click', async () => {
    const btn = document.getElementById('btn-login');
    btn.textContent = 'Opening browser…';
    btn.disabled = true;
    await call('auth_login');
    btn.textContent = 'Connect Google Calendar';
    btn.disabled = false;
    // auth success/failure handled by window._onAuthSuccess / _onAuthError callbacks
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await call('auth_logout');
    state.auth = 'not-logged-in';
    state.events = [];
    state.calendars = [];
    state.calendarVisibility = {};
    state.taskLists = [];
    state.activeTaskListId = '@default';
    state.taskListCounts = {};
    state.tasks = [];
    state.completedTasks = [];
    state.tasksError = null;
    document.getElementById('btn-calendars').style.display = 'none';
    document.getElementById('calendar-legend').innerHTML = '';
    updateAuthUI();
    renderCalendar();
    renderTasks();
  });

  document.getElementById('btn-setup').addEventListener('click', showCredsModal);

  document.getElementById('btn-fullscreen').addEventListener('click', () => call('window_fullscreen'));

  document.getElementById('btn-add-event').addEventListener('click', () => showEventModal(null));
  document.getElementById('modal-event-save').addEventListener('click', saveEvent);
  document.getElementById('modal-event-close').addEventListener('click', () => {
    state.editingEvent = null;
    document.getElementById('modal-event').style.display = 'none';
  });
  document.getElementById('modal-event-cancel').addEventListener('click', () => {
    state.editingEvent = null;
    document.getElementById('modal-event').style.display = 'none';
  });
  document.getElementById('event-allday').addEventListener('change', (e) => {
    document.getElementById('event-time-section').style.display = e.target.checked ? 'none' : '';
  });

  document.getElementById('modal-creds-save').addEventListener('click', saveCreds);
  document.getElementById('modal-creds-close').addEventListener('click', () => {
    document.getElementById('modal-creds').style.display = 'none';
  });
  document.getElementById('modal-creds-cancel').addEventListener('click', () => {
    document.getElementById('modal-creds').style.display = 'none';
  });
  document.getElementById('link-console').addEventListener('click', (e) => {
    e.preventDefault();
    call('window_open_external', 'https://console.cloud.google.com/');
  });

  document.getElementById('btn-refresh').addEventListener('click', () => loadCalendarEvents());
  document.getElementById('btn-calendars').addEventListener('click', showCalendarModal);
  document.getElementById('modal-calendars-close').addEventListener('click', () => {
    document.getElementById('modal-calendars').style.display = 'none';
  });
  document.getElementById('modal-calendars').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  document.getElementById('day-popup-close').addEventListener('click', () => {
    document.getElementById('day-popup').style.display = 'none';
  });
  document.addEventListener('click', (e) => {
    const popup = document.getElementById('day-popup');
    if (popup.style.display !== 'none' && !popup.contains(e.target) && !e.target.closest('.cal-day')) {
      popup.style.display = 'none';
    }
  });

  const todoInput = document.getElementById('todo-input');
  document.getElementById('btn-add-todo').addEventListener('click', () => {
    addTask(todoInput.value);
    todoInput.value = '';
  });
  todoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTask(todoInput.value);
      todoInput.value = '';
    }
  });

  document.getElementById('modal-event').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('modal-creds').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('modal-event').style.display = 'none';
      document.getElementById('modal-creds').style.display = 'none';
      document.getElementById('modal-calendars').style.display = 'none';
      document.getElementById('day-popup').style.display = 'none';
    }
    if (e.key === 'F11') { e.preventDefault(); call('window_fullscreen'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') changeMonth(-1);
    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') changeMonth(1);
  });
}

// ── Start (wait for pywebview to be ready) ─────────────────────────────────
if (window.pywebview) {
  init();
} else {
  window.addEventListener('pywebviewready', init);
}
