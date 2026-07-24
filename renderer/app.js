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
  todos: [],
  dragSrc: null
};

const MAX_DONE = 5;

// ── Global callbacks from Python ───────────────────────────────────────────
window._onAuthSuccess = async function () {
  state.auth = 'logged-in';
  updateAuthUI();
  await loadCalendarList();
  loadCalendarEvents();
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

  state.todos = await call('todos_get');
  renderTodos();

  const res = await call('auth_status');
  state.auth = res.status;
  updateAuthUI();

  if (state.auth === 'logged-in') {
    await loadCalendarList();
    await loadCalendarEvents();
  }

  setInterval(() => {
    if (state.auth === 'logged-in') loadCalendarEvents();
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
      el.appendChild(timeEl);
      el.appendChild(titleEl);
      if (ev._calendarName) {
        const calEl = document.createElement('div');
        calEl.className = 'popup-event-calendar';
        calEl.textContent = ev._calendarName;
        if (ev._displayColor) calEl.style.color = ev._displayColor;
        el.appendChild(calEl);
      }
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

// ── Todos ──────────────────────────────────────────────────────────────────
function saveTodos() {
  call('todos_set', state.todos);
}

function renderTodos() {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';

  const active = state.todos
    .filter(t => !t.done)
    .sort((a, b) => a.order - b.order);

  const done = state.todos
    .filter(t => t.done)
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    .slice(0, MAX_DONE);

  active.forEach((todo) => list.appendChild(makeTodoEl(todo, false)));

  if (done.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'todo-done-divider';
    divider.textContent = `Completed (${done.length})`;
    list.appendChild(divider);
    done.forEach((todo) => list.appendChild(makeTodoEl(todo, true)));
  }
}

function makeTodoEl(todo, isDone) {
  const item = document.createElement('div');
  item.className = 'todo-item' + (isDone ? ' done' : '');
  item.dataset.id = todo.id;
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
  check.addEventListener('click', () => toggleTodo(todo.id));
  item.appendChild(check);

  const text = document.createElement('div');
  text.className = 'todo-text';
  text.textContent = todo.text;
  item.appendChild(text);

  const del = document.createElement('button');
  del.className = 'todo-delete';
  del.textContent = '✕';
  del.title = 'Delete';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteTodo(todo.id); });
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

function addTodo(text) {
  text = text.trim();
  if (!text) return;
  const maxOrder = state.todos.filter(t => !t.done).reduce((m, t) => Math.max(m, t.order || 0), -1);
  state.todos.push({
    id: Date.now() + Math.random(),
    text,
    done: false,
    doneAt: null,
    order: maxOrder + 1
  });
  saveTodos();
  renderTodos();
}

function toggleTodo(id) {
  const todo = state.todos.find(t => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.doneAt = todo.done ? Date.now() : null;
  if (!todo.done) {
    const maxOrder = state.todos.filter(t => !t.done).reduce((m, t) => Math.max(m, t.order || 0), -1);
    todo.order = maxOrder + 1;
  }
  saveTodos();
  renderTodos();
}

function deleteTodo(id) {
  state.todos = state.todos.filter(t => t.id !== id);
  saveTodos();
  renderTodos();
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

function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const srcId = parseFloat(state.dragSrc);
  const dstId = parseFloat(this.dataset.id);
  if (srcId === dstId) return;

  const active = state.todos.filter(t => !t.done).sort((a, b) => a.order - b.order);
  const srcIdx = active.findIndex(t => t.id === srcId);
  const dstIdx = active.findIndex(t => t.id === dstId);
  if (srcIdx < 0 || dstIdx < 0) return;

  active.splice(srcIdx, 1);
  active.splice(dstIdx, 0, state.todos.find(t => t.id === srcId));
  active.forEach((t, i) => { const o = state.todos.find(x => x.id === t.id); if (o) o.order = i; });

  saveTodos();
  renderTodos();
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
  state.dragSrc = null;
}

// ── Event Modal ────────────────────────────────────────────────────────────
function showEventModal(prefillDate) {
  const modal = document.getElementById('modal-event');
  document.getElementById('event-title').value = '';
  document.getElementById('event-date').value = prefillDate || dateKey(new Date());
  document.getElementById('event-start-time').value = '09:00';
  document.getElementById('event-end-time').value = '10:00';
  document.getElementById('event-allday').checked = false;
  document.getElementById('event-error').style.display = 'none';
  modal.style.display = 'flex';
  document.getElementById('event-title').focus();
}

async function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const startTime = document.getElementById('event-start-time').value;
  const endTime = document.getElementById('event-end-time').value;
  const allDay = document.getElementById('event-allday').checked;
  const errEl = document.getElementById('event-error');

  if (!title) { showError(errEl, 'Title is required.'); return; }
  if (!date) { showError(errEl, 'Date is required.'); return; }
  errEl.style.display = 'none';

  let startVal, endVal;
  if (allDay) {
    startVal = date;
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    endVal = dateKey(endDate);
  } else {
    startVal = `${date}T${startTime || '00:00'}:00`;
    endVal = `${date}T${endTime || startTime || '01:00'}:00`;
  }

  const btn = document.getElementById('modal-event-save');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  const res = await call('calendar_create_event', title, startVal, endVal, allDay);

  btn.textContent = 'Save Event';
  btn.disabled = false;

  if (res.error) { showError(errEl, res.error); return; }

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
    document.getElementById('btn-calendars').style.display = 'none';
    document.getElementById('calendar-legend').innerHTML = '';
    updateAuthUI();
    renderCalendar();
  });

  document.getElementById('btn-setup').addEventListener('click', showCredsModal);

  document.getElementById('btn-fullscreen').addEventListener('click', () => call('window_fullscreen'));

  document.getElementById('btn-add-event').addEventListener('click', () => showEventModal(null));
  document.getElementById('modal-event-save').addEventListener('click', saveEvent);
  document.getElementById('modal-event-close').addEventListener('click', () => {
    document.getElementById('modal-event').style.display = 'none';
  });
  document.getElementById('modal-event-cancel').addEventListener('click', () => {
    document.getElementById('modal-event').style.display = 'none';
  });
  document.getElementById('event-allday').addEventListener('change', (e) => {
    const hide = e.target.checked;
    document.getElementById('event-start-time').style.display = hide ? 'none' : '';
    document.getElementById('event-end-time').style.display = hide ? 'none' : '';
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
    addTodo(todoInput.value);
    todoInput.value = '';
  });
  todoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTodo(todoInput.value);
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
