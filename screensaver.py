#!/usr/bin/env python3
"""
Home Screensaver — photo slideshow + Google Tasks overlay.

Windows screensaver CLI contract:
  screensaver.scr /s        — run full-screen
  screensaver.scr /p HWND   — show preview in Control Panel
  screensaver.scr /c        — show config dialog
"""

import sys
import json
import random
import threading
import tkinter as tk
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageTk

# ── Paths ──────────────────────────────────────────────────────────────────────

APP_DIR   = Path.home() / '.homeapp'
TOKEN_FILE = APP_DIR / 'token.json'
CREDS_FILE = APP_DIR / 'credentials.json'

SCOPES = ['https://www.googleapis.com/auth/tasks']

PHOTO_DIRS = [
    Path.home() / 'Pictures',
    Path.home() / 'OneDrive' / 'Pictures',
    Path.home() / 'OneDrive' / 'Pildid',
    Path.home() / 'Pictures' / 'Saved Pictures',
    Path.home() / 'Pictures' / 'Camera Roll',
]

IMAGE_EXTS  = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
SLIDE_MS    = 10_000   # ms between photo changes
CLOCK_MS    = 30_000   # ms between clock refreshes
TASK_MS     = 5 * 60_000  # ms between task API refreshes


# ── Google Tasks ───────────────────────────────────────────────────────────────

def fetch_tasks():
    """Return list of active Google Task dicts (today's due first, then rest)."""
    try:
        if not CREDS_FILE.exists() or not TOKEN_FILE.exists():
            return []
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build

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

        svc = build('tasks', 'v1', credentials=creds, cache_discovery=False)
        lists_res = svc.tasklists().list(maxResults=10).execute()

        tasks = []
        for tl in lists_res.get('items', []):
            res = svc.tasks().list(
                tasklist=tl['id'], showCompleted=False, maxResults=50
            ).execute()
            for t in res.get('items', []):
                t['_list'] = tl.get('title', '')
                tasks.append(t)

        today = datetime.now().strftime('%Y-%m-%d')
        today_tasks = [t for t in tasks if t.get('due', '').startswith(today)]
        other_tasks = [t for t in tasks if not t.get('due', '').startswith(today)]
        return today_tasks + other_tasks
    except Exception:
        return []


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


# ── Font helpers ───────────────────────────────────────────────────────────────

_font_cache: dict = {}

def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    key = (name, size)
    if key not in _font_cache:
        candidates = [
            f'C:/Windows/Fonts/{name}.ttf',
            f'C:/Windows/Fonts/{name}.otf',
            f'/System/Library/Fonts/{name}.ttf',  # macOS fallback for dev
        ]
        for p in candidates:
            try:
                _font_cache[key] = ImageFont.truetype(p, size)
                break
            except Exception:
                pass
        else:
            _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]


def _text_w(font, text: str) -> int:
    try:
        return int(font.getlength(text))
    except AttributeError:
        return font.getsize(text)[0]  # Pillow < 9.2


def _truncate(font, text: str, max_px: int) -> str:
    if _text_w(font, text) <= max_px:
        return text
    while text and _text_w(font, text + '…') > max_px:
        text = text[:-1]
    return text + '…'


# ── Frame rendering ────────────────────────────────────────────────────────────

def render_frame(bg: Image.Image, w: int, h: int, tasks: list) -> Image.Image:
    """Composite background photo + dark left panel + clock + tasks."""
    panel_w = max(280, min(420, w // 3))
    feather  = 80  # px soft edge on panel right side

    # Build semi-transparent dark overlay
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ov = ImageDraw.Draw(overlay)
    for x in range(panel_w + feather):
        if x < panel_w:
            a = 210
        else:
            a = max(0, int(210 * (1 - (x - panel_w) / feather) ** 1.5))
        ov.line([(x, 0), (x, h)], fill=(8, 8, 20, a))

    result = Image.alpha_composite(bg.convert('RGBA'), overlay).convert('RGB')
    draw = ImageDraw.Draw(result)

    # Scale fonts to screen height (reference: 900 px)
    s = h / 900
    pad = max(28, int(40 * s))

    f_clock = _font('segoeuil', max(44, int(88 * s)))
    f_date  = _font('segoeui',  max(12, int(18 * s)))
    f_head  = _font('segoeuib', max(10, int(13 * s)))
    f_task  = _font('segoeui',  max(10, int(14 * s)))

    now = datetime.now()
    y = int(65 * s)

    # Clock
    draw.text((pad, y), now.strftime('%H:%M'), font=f_clock, fill=(255, 255, 255))
    y += int(98 * s)

    # Date  (cross-platform: use .day instead of %-d / %#d)
    date_str = f"{now.strftime('%A')}, {now.day} {now.strftime('%B %Y')}"
    draw.text((pad, y), date_str, font=f_date, fill=(192, 192, 210))
    y += int(40 * s)

    # Separator
    draw.line([(pad, y), (panel_w - pad, y)], fill=(70, 70, 110), width=1)
    y += int(20 * s)

    # Section heading
    today = now.strftime('%Y-%m-%d')
    has_today = any(t.get('due', '').startswith(today) for t in tasks)
    heading = "Today's tasks" if has_today else "Your tasks"
    draw.text((pad, y), heading, font=f_head, fill=(140, 130, 220))
    y += int(30 * s)

    # Task list
    row_h     = max(22, int(28 * s))
    max_rows  = max(1, (h - y - int(60 * s)) // row_h)
    text_maxw = panel_w - pad * 2 - int(18 * s)
    dot_x     = pad
    text_x    = pad + int(18 * s)

    for task in tasks[:max_rows]:
        title = task.get('title', '').strip()
        if not title:
            continue
        is_today_task = task.get('due', '').startswith(today)
        color = (255, 255, 255) if is_today_task else (200, 200, 218)
        draw.text((dot_x,  y), '•',                              font=f_task, fill=(124, 106, 247))
        draw.text((text_x, y), _truncate(f_task, title, text_maxw), font=f_task, fill=color)
        y += row_h

    if not tasks:
        draw.text((pad, y), 'All caught up!', font=f_task, fill=(100, 100, 140))

    return result


# ── Screensaver window ─────────────────────────────────────────────────────────

class Screensaver:
    def __init__(self, root: tk.Tk, preview: bool = False):
        self.root    = root
        self.preview = preview

        self.canvas = tk.Canvas(root, bg='black', highlightthickness=0)
        self.canvas.pack(fill='both', expand=True)

        self._photos      = collect_photos()
        self._photo_idx   = 0
        self._bg_pil      = None    # current background PIL (screen-sized, no overlay)
        self._tk_image    = None    # kept alive to prevent GC
        self._canvas_id   = None
        self._tasks: list = []
        self._clock_after = None
        self._mouse_start = None

        if not preview:
            self.canvas.bind('<Motion>', self._on_mouse)
            self.root.bind('<Button>', self._exit)
            self.root.bind('<Key>', self._exit)

        self.root.after(200, self._start)

    def _start(self):
        self._schedule_task_fetch()
        self._advance_slide()

    # ── Tasks ──────────────────────────────────────────────────────────────────

    def _schedule_task_fetch(self):
        threading.Thread(target=self._do_fetch_tasks, daemon=True).start()
        self.root.after(TASK_MS, self._schedule_task_fetch)

    def _do_fetch_tasks(self):
        tasks = fetch_tasks()
        self.root.after(0, lambda: self._on_tasks_loaded(tasks))

    def _on_tasks_loaded(self, tasks):
        self._tasks = tasks
        if self._bg_pil:
            self._render()

    # ── Slideshow ──────────────────────────────────────────────────────────────

    def _advance_slide(self):
        w = self.root.winfo_width()
        h = self.root.winfo_height()
        if w < 10 or h < 10:
            self.root.after(200, self._advance_slide)
            return

        if self._photos:
            path = self._photos[self._photo_idx % len(self._photos)]
            self._photo_idx += 1
            try:
                self._bg_pil = load_cover(path, w, h)
            except Exception:
                self._bg_pil = Image.new('RGB', (w, h), '#0f0f1a')
        else:
            self._bg_pil = Image.new('RGB', (w, h), '#0f0f1a')

        self._render()
        self.root.after(SLIDE_MS, self._advance_slide)

    # ── Rendering ──────────────────────────────────────────────────────────────

    def _render(self):
        if self._bg_pil is None:
            return
        if self._clock_after:
            self.root.after_cancel(self._clock_after)
            self._clock_after = None

        w = self.root.winfo_width()
        h = self.root.winfo_height()
        frame = render_frame(self._bg_pil, w, h, self._tasks)
        self._tk_image = ImageTk.PhotoImage(frame)

        if self._canvas_id is None:
            self._canvas_id = self.canvas.create_image(0, 0, anchor='nw', image=self._tk_image)
        else:
            self.canvas.itemconfig(self._canvas_id, image=self._tk_image)

        self._clock_after = self.root.after(CLOCK_MS, self._render)

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
        # Preview pane in Windows Screen Saver Settings
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
        'Tasks are synced from the Home app.\n'
        'Open the Home app and log in to Google\n'
        'to enable task display on the screensaver.'
    )
    root.destroy()


def main():
    # Normalize args: strip leading / or -
    raw = sys.argv[1:]
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
