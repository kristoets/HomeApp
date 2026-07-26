#!/usr/bin/env python3
"""
Home Screensaver — photo slideshow + Google Calendar events + Tasks overlay.

Windows screensaver CLI:
  /s        — run screensaver
  /p HWND   — preview in Control Panel
  /c        — config dialog
"""

# ── Early crash log — written before any risky import ─────────────────────────
import sys
import os
from pathlib import Path as _Path

_APP_DIR = _Path.home() / '.homeapp'
_APP_DIR.mkdir(exist_ok=True)
_LOG_PATH = str(_APP_DIR / 'screensaver.log')

def _early_log(msg):
    try:
        with open(_LOG_PATH, 'a') as _f:
            _f.write(msg + '\n')
    except Exception:
        pass

_early_log(f'--- Screensaver starting (Python {sys.version}) ---')

try:
    import json
    import random
    import threading
    import logging
    import tkinter as tk
    from pathlib import Path
    from datetime import datetime, timedelta
    from PIL import Image, ImageDraw, ImageFont, ImageTk
    _early_log('All imports OK')
except Exception as _e:
    import traceback as _tb
    _early_log('IMPORT FAILED:\n' + _tb.format_exc())
    sys.exit(1)

# ── Config ─────────────────────────────────────────────────────────────────────

APP_DIR      = Path.home() / '.homeapp'
TOKEN_FILE   = APP_DIR / 'token.json'
CREDS_FILE   = APP_DIR / 'credentials.json'
CAL_VIS_FILE = APP_DIR / 'calendar_visibility.json'

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks',
]

PHOTO_DIRS = [
    Path.home() / 'Pictures',
    Path.home() / 'OneDrive' / 'Pictures',
    Path.home() / 'OneDrive' / 'Pildid',
    Path.home() / 'Pictures' / 'Saved Pictures',
    Path.home() / 'Pictures' / 'Camera Roll',
]

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
SLIDE_MS   = 10_000      # ms each photo is shown after it appears
DATA_MS    = 5 * 60_000  # ms between data refreshes

# ── Logging ────────────────────────────────────────────────────────────────────

APP_DIR.mkdir(exist_ok=True)
log = logging.getLogger('screensaver')
log.setLevel(logging.DEBUG)
_log_handler = logging.FileHandler(str(APP_DIR / 'screensaver.log'))
_log_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
log.addHandler(_log_handler)


# ── Credentials ────────────────────────────────────────────────────────────────

def _get_creds():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    creds_data = json.loads(CREDS_FILE.read_text())
    token_data = json.loads(TOKEN_FILE.read_text())
    info = creds_data.get('installed') or creds_data.get('web')
    creds = Credentials(
        token=token_data.get('token'),
        refresh_token=token_data.get('refresh_token'),
        token_uri='https://oauth2.googleapis.com/token',
        client_id=info['client_id'],
        client_secret=info['client_secret'],
        scopes=SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


# ── Data fetching (runs in background thread) ──────────────────────────────────

def fetch_all():
    """Returns (today_events, tomorrow_events, tasks). Safe to call from any thread."""
    log.info('fetch_all started')
    if not CREDS_FILE.exists() or not TOKEN_FILE.exists():
        log.warning('Missing credentials (%s) or token (%s)', CREDS_FILE, TOKEN_FILE)
        return [], [], []
    try:
        from googleapiclient.discovery import build
        creds = _get_creds()
        log.info('Credentials OK, valid=%s', creds.valid)
        cal_svc  = build('calendar', 'v3', credentials=creds, cache_discovery=False)
        task_svc = build('tasks',    'v1', credentials=creds, cache_discovery=False)

        today     = datetime.now().date()
        tomorrow  = today + timedelta(days=1)
        day_after = tomorrow + timedelta(days=1)

        time_min = datetime(today.year,    today.month,    today.day).astimezone().isoformat()
        time_max = datetime(day_after.year, day_after.month, day_after.day).astimezone().isoformat()

        visibility = {}
        if CAL_VIS_FILE.exists():
            visibility = json.loads(CAL_VIS_FILE.read_text())

        cal_list  = cal_svc.calendarList().list().execute()
        calendars = [c for c in cal_list.get('items', [])
                     if c.get('selected', True) and visibility.get(c['id'], True)]

        all_events = []
        for cal in calendars:
            try:
                res = cal_svc.events().list(
                    calendarId=cal['id'],
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy='startTime',
                    maxResults=30,
                ).execute()
                for ev in res.get('items', []):
                    ev['_color'] = cal.get('backgroundColor', '#7c6af7')
                    all_events.append(ev)
            except Exception:
                continue

        def _ev_start(ev):
            s = ev.get('start', {})
            return s.get('dateTime', s.get('date', ''))

        all_events.sort(key=_ev_start)
        today_str    = today.isoformat()
        tomorrow_str = tomorrow.isoformat()

        today_evs    = [e for e in all_events if _ev_start(e)[:10] == today_str]
        tomorrow_evs = [e for e in all_events if _ev_start(e)[:10] == tomorrow_str]

        # Tasks across all lists
        lists_res = task_svc.tasklists().list(maxResults=10).execute()
        tasks = []
        for tl in lists_res.get('items', []):
            res = task_svc.tasks().list(
                tasklist=tl['id'], showCompleted=False, maxResults=50
            ).execute()
            for t in res.get('items', []):
                t['_list'] = tl.get('title', '')
                tasks.append(t)

        today_tasks = [t for t in tasks if t.get('due', '').startswith(today_str)]
        other_tasks = [t for t in tasks if not t.get('due', '').startswith(today_str)]

        log.info('Fetched %d today events, %d tomorrow events, %d tasks',
                 len(today_evs), len(tomorrow_evs), len(today_tasks + other_tasks))
        return today_evs, tomorrow_evs, today_tasks + other_tasks

    except Exception:
        log.exception('fetch_all failed')
        return [], [], []


# ── Photos ─────────────────────────────────────────────────────────────────────

def collect_photos():
    photos = []
    for d in PHOTO_DIRS:
        if d.exists():
            for f in d.rglob('*'):
                if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                    photos.append(f)
    random.shuffle(photos)
    return photos


def load_cover(path, w, h):
    img = Image.open(path).convert('RGB')
    iw, ih = img.size
    scale = max(w / iw, h / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    img = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top  = (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


# ── Fonts ──────────────────────────────────────────────────────────────────────

_font_cache = {}

def _font(name, size):
    key = (name, size)
    if key not in _font_cache:
        for p in [f'C:/Windows/Fonts/{name}.ttf', f'C:/Windows/Fonts/{name}.otf']:
            try:
                _font_cache[key] = ImageFont.truetype(p, size)
                break
            except Exception:
                pass
        else:
            _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]


def _text_w(font, text):
    try:
        return int(font.getlength(text))
    except AttributeError:
        return font.getsize(text)[0]


def _truncate(font, text, max_px):
    if _text_w(font, text) <= max_px:
        return text
    while text and _text_w(font, text + '…') > max_px:
        text = text[:-1]
    return text + '…'


# ── Frame rendering (runs in background thread) ────────────────────────────────

def render_frame(bg, w, h, today_evs, tomorrow_evs, tasks):
    """Composite background + dark left panel + clock + events + tasks → RGB PIL Image."""
    panel_w = max(280, min(440, w // 3))
    feather  = 80

    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ov = ImageDraw.Draw(overlay)
    for x in range(panel_w + feather):
        a = 210 if x < panel_w else max(0, int(210 * (1 - (x - panel_w) / feather) ** 1.5))
        ov.line([(x, 0), (x, h)], fill=(8, 8, 20, a))

    result = Image.alpha_composite(bg.convert('RGBA'), overlay).convert('RGB')
    draw   = ImageDraw.Draw(result)

    s   = h / 900
    pad = max(28, int(40 * s))

    f_clock = _font('segoeuil', max(44, int(88 * s)))
    f_date  = _font('segoeui',  max(12, int(17 * s)))
    f_head  = _font('segoeuib', max(10, int(12 * s)))
    f_item  = _font('segoeui',  max(10, int(13 * s)))

    now      = datetime.now()
    today    = now.date()
    today_str = today.isoformat()
    row_h    = max(20, int(25 * s))
    text_maxw = panel_w - pad * 2
    time_col  = int(44 * s)   # pixels for "HH:MM" prefix on event rows

    y = int(65 * s)

    # Clock
    draw.text((pad, y), now.strftime('%H:%M'), font=f_clock, fill=(255, 255, 255))
    y += int(96 * s)

    # Date
    draw.text((pad, y),
              f"{now.strftime('%A')}, {now.day} {now.strftime('%B %Y')}",
              font=f_date, fill=(192, 192, 210))
    y += int(34 * s)

    # ── Layout helpers ─────────────────────────────────────────────────────────

    def sep():
        nonlocal y
        draw.line([(pad, y), (panel_w - pad, y)], fill=(60, 60, 100), width=1)
        y += int(14 * s)

    def heading(text):
        nonlocal y
        draw.text((pad, y), text, font=f_head, fill=(140, 130, 220))
        y += int(22 * s)

    def event_row(ev):
        nonlocal y
        start  = ev.get('start', {})
        dt_str = start.get('dateTime', '')
        t_lbl  = datetime.fromisoformat(dt_str).strftime('%H:%M') if dt_str else 'all day'
        title  = ev.get('summary', '').strip() or '(no title)'
        draw.text((pad,            y), t_lbl, font=f_item, fill=(150, 150, 190))
        draw.text((pad + time_col, y),
                  _truncate(f_item, title, text_maxw - time_col),
                  font=f_item, fill=(230, 230, 245))
        y += row_h

    def task_row(task):
        nonlocal y
        title = task.get('title', '').strip()
        if not title:
            return
        color = (255, 255, 255) if task.get('due', '').startswith(today_str) else (200, 200, 218)
        draw.text((pad,              y), '•', font=f_item, fill=(124, 106, 247))
        draw.text((pad + int(14*s), y),
                  _truncate(f_item, title, text_maxw - int(14*s)),
                  font=f_item, fill=color)
        y += row_h

    def empty_row(text):
        nonlocal y
        draw.text((pad, y), text, font=f_item, fill=(80, 80, 110))
        y += row_h

    # ── Fit sections into available height ─────────────────────────────────────
    sec_overhead = int(36 * s)   # sep + heading height
    avail = h - y - int(50 * s)

    n_today_ev    = min(len(today_evs),    4)
    n_tomorrow_ev = min(len(tomorrow_evs), 3)
    n_tasks       = min(len(tasks),        6)

    # Each section always shows at least 1 row ("No events" / "All caught up!")
    needed = sec_overhead * 3 + max(n_today_ev, 1) * row_h + max(n_tomorrow_ev, 1) * row_h + max(n_tasks, 1) * row_h
    while needed > avail and n_tasks > 0:
        n_tasks -= 1; needed -= row_h
    while needed > avail and n_tomorrow_ev > 0:
        n_tomorrow_ev -= 1; needed -= row_h
    while needed > avail and n_today_ev > 0:
        n_today_ev -= 1; needed -= row_h

    # ── Draw sections ──────────────────────────────────────────────────────────
    sep();  heading(f"Today  ·  {now.strftime('%d %b')}")
    if today_evs:
        for ev in today_evs[:n_today_ev]:
            event_row(ev)
    else:
        empty_row('No events today')

    tomorrow_dt = today + timedelta(days=1)
    sep();  heading(f"Tomorrow  ·  {tomorrow_dt.strftime('%d %b')}")
    if tomorrow_evs:
        for ev in tomorrow_evs[:n_tomorrow_ev]:
            event_row(ev)
    else:
        empty_row('No events tomorrow')

    today_task_n = sum(1 for t in tasks if t.get('due', '').startswith(today_str))
    sep();  heading("Today's tasks" if today_task_n else "Your tasks")
    if tasks and n_tasks > 0:
        for task in tasks[:n_tasks]:
            task_row(task)
    else:
        empty_row('All caught up!')

    return result


# ── Screensaver window ─────────────────────────────────────────────────────────

class Screensaver:
    def __init__(self, root, preview=False):
        self.root    = root
        self.preview = preview

        self.canvas = tk.Canvas(root, bg='black', highlightthickness=0)
        self.canvas.pack(fill='both', expand=True)

        self._photos       = collect_photos()
        self._photo_idx    = 0
        self._bg_pil       = None   # current background PIL (photo, screen-sized)
        self._tk_image     = None   # keeps PhotoImage alive (GC protection)
        self._canvas_id    = None
        self._today_evs    = []
        self._tomorrow_evs = []
        self._tasks        = []
        self._mouse_start  = None

        if not preview:
            self.canvas.bind('<Motion>', self._on_mouse)
            self.root.bind('<Button>', self._exit)
            self.root.bind('<Key>', self._exit)

        self.root.after(100, self._start)

    # ── Startup ────────────────────────────────────────────────────────────────

    def _start(self):
        # Show clock on screen immediately using tkinter (no PIL, instant)
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        s  = sh / 900
        now = datetime.now()
        px  = max(28, int(40 * s))
        self.canvas.create_text(
            px, int(65 * s),
            text=now.strftime('%H:%M'),
            font=('Segoe UI Light', max(44, int(88 * s))),
            fill='white', anchor='nw', tags='quick',
        )
        self.canvas.create_text(
            px, int(65 * s) + int(96 * s),
            text=f"{now.strftime('%A')}, {now.day} {now.strftime('%B %Y')}",
            font=('Segoe UI', max(12, int(17 * s))),
            fill='#c0c0d2', anchor='nw', tags='quick',
        )
        # Kick off background data fetch and first photo load
        self._schedule_data_fetch()
        self._next_slide()

    # ── Data ───────────────────────────────────────────────────────────────────

    def _schedule_data_fetch(self):
        threading.Thread(target=self._do_fetch, daemon=True).start()
        self.root.after(DATA_MS, self._schedule_data_fetch)

    def _do_fetch(self):
        result = fetch_all()
        self.root.after(0, lambda r=result: self._on_data(r))

    def _on_data(self, result):
        self._today_evs, self._tomorrow_evs, self._tasks = result
        log.info('Data received: %d today evs, %d tomorrow evs, %d tasks',
                 len(self._today_evs), len(self._tomorrow_evs), len(self._tasks))
        # Re-render current photo with fresh data
        if self._bg_pil is not None:
            self._render_in_bg(self._bg_pil)

    # ── Slideshow ──────────────────────────────────────────────────────────────

    def _next_slide(self):
        """Pick next photo and start a background load+render."""
        w = self.root.winfo_width() or self.root.winfo_screenwidth()
        h = self.root.winfo_height() or self.root.winfo_screenheight()

        path = None
        if self._photos:
            path = self._photos[self._photo_idx % len(self._photos)]
            self._photo_idx += 1

        today_evs    = list(self._today_evs)
        tomorrow_evs = list(self._tomorrow_evs)
        tasks        = list(self._tasks)

        def _bg():
            if path:
                try:
                    bg = load_cover(path, w, h)
                except Exception:
                    bg = Image.new('RGB', (w, h), '#0f0f1a')
            else:
                bg = Image.new('RGB', (w, h), '#0f0f1a')
            self._bg_pil = bg
            frame = render_frame(bg, w, h, today_evs, tomorrow_evs, tasks)
            self.root.after(0, lambda f=frame: self._show_and_schedule(f))

        threading.Thread(target=_bg, daemon=True).start()

    def _show_and_schedule(self, frame):
        """Display frame, then schedule next slide after SLIDE_MS."""
        self.canvas.delete('quick')   # remove instant-clock placeholder if present
        self._tk_image = ImageTk.PhotoImage(frame)
        if self._canvas_id is None:
            self._canvas_id = self.canvas.create_image(0, 0, anchor='nw', image=self._tk_image)
        else:
            self.canvas.itemconfig(self._canvas_id, image=self._tk_image)
        self.root.after(SLIDE_MS, self._next_slide)

    def _render_in_bg(self, bg):
        """Re-render the current background with updated data (after fetch)."""
        w = self.root.winfo_width() or self.root.winfo_screenwidth()
        h = self.root.winfo_height() or self.root.winfo_screenheight()
        today_evs    = list(self._today_evs)
        tomorrow_evs = list(self._tomorrow_evs)
        tasks        = list(self._tasks)

        def _bg():
            frame = render_frame(bg, w, h, today_evs, tomorrow_evs, tasks)
            self.root.after(0, lambda f=frame: self._update_canvas(f))

        threading.Thread(target=_bg, daemon=True).start()

    def _update_canvas(self, frame):
        """Swap frame without touching the slide schedule."""
        self._tk_image = ImageTk.PhotoImage(frame)
        if self._canvas_id is None:
            self._canvas_id = self.canvas.create_image(0, 0, anchor='nw', image=self._tk_image)
        else:
            self.canvas.itemconfig(self._canvas_id, image=self._tk_image)

    # ── Exit ───────────────────────────────────────────────────────────────────

    def _on_mouse(self, event):
        if self._mouse_start is None:
            self._mouse_start = (event.x, event.y)
            return
        if abs(event.x - self._mouse_start[0]) > 5 or abs(event.y - self._mouse_start[1]) > 5:
            self._exit()

    def _exit(self, _event=None):
        self.root.destroy()


# ── Entry points ───────────────────────────────────────────────────────────────

def run_screensaver(hwnd=None):
    root = tk.Tk()
    root.title('Home Screensaver')
    root.configure(bg='black')

    if hwnd:
        try:
            import ctypes
            import ctypes.wintypes
            root.update()
            ctypes.windll.user32.SetParent(root.winfo_id(), int(hwnd))
            rect = ctypes.wintypes.RECT()
            ctypes.windll.user32.GetClientRect(int(hwnd), ctypes.byref(rect))
            pw = rect.right - rect.left
            ph = rect.bottom - rect.top
            root.geometry(f'{pw}x{ph}+0+0')
            root.overrideredirect(True)
        except Exception:
            root.geometry('320x240')
        Screensaver(root, preview=True)
    else:
        root.attributes('-fullscreen', True)
        root.attributes('-topmost', True)
        root.overrideredirect(True)
        root.configure(cursor='none')
        Screensaver(root, preview=False)

    root.mainloop()


def run_config():
    import tkinter.messagebox as mb
    root = tk.Tk()
    root.withdraw()
    mb.showinfo(
        'Home Screensaver',
        'Photos are loaded from your Pictures folder\n'
        'and OneDrive\\Pictures (if present).\n\n'
        'Calendar events and tasks are synced from\n'
        'the Home app. Open it and log in to Google\n'
        'to enable the overlay.'
    )
    root.destroy()


def main():
    raw  = sys.argv[1:]
    args = [a.lstrip('-').lstrip('/').lower() for a in raw]

    if not args or args[0] == 's':
        run_screensaver()
    elif args[0] == 'p' and len(raw) > 1:
        run_screensaver(hwnd=raw[1])
    elif args[0] == 'c':
        run_config()
    else:
        run_screensaver()


if __name__ == '__main__':
    main()
