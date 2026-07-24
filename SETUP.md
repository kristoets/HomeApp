# Home App — Setup Guide

## Requirements

- Python 3.8 or newer (download from https://python.org)
- On Windows: Python must be added to PATH during install (check the box in the installer)

## 1. Install Python dependencies

Open a terminal / command prompt in this folder and run:

```
pip install -r requirements.txt
```

On Mac you may need `pip3` instead of `pip`.

## 2. Start the app

**Mac:**
```
python3 app.py
```
Or double-click `start.sh`

**Windows:**
Double-click `start.bat`  
Or in a terminal: `python app.py`

---

## 3. Google Calendar setup

The first time you open the app you'll see a **"Setup Credentials"** button in the top right.

### Step A — Create a Google Cloud project

1. Click the **"Setup Credentials"** button in the app — it will open https://console.cloud.google.com/
2. Create a new project (any name, e.g. "Home App")

### Step B — Enable Google Calendar API

1. Go to **APIs & Services → Library**
2. Search **"Google Calendar API"** → click **Enable**

### Step C — Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **"+ Create Credentials" → OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - User type: **External**
   - App name: "Home App", your email
   - Add scope: `https://www.googleapis.com/auth/calendar`
   - Add your email as a **Test user**
4. Back in Create OAuth client ID:
   - Application type: **Desktop app**
5. Click **Create**, then **Download JSON**

### Step D — Paste credentials

1. Open the downloaded `credentials.json` in any text editor
2. Copy all the text
3. In the app click **"Setup Credentials"**
4. Paste in the text box → click **Save & Connect**

### Step E — Log in

Click **"Connect Google Calendar"** — your browser opens for Google login.
After approving, switch back to the app — it connects automatically.

---

## Features

### Calendar
- **Rolling 5-week view** by default — current week at the top, 4 weeks ahead below
- **← / →** navigation: from the rolling view, ← shows the full month of the current anchor week, → shows the full month after the last visible week. From a month view, navigates one month at a time
- **Today** button returns to the rolling 5-week view anchored on the current week
- Events from **all your Google Calendars** are shown simultaneously with their correct colors
- **Calendars button** — toggle which calendars are visible; preferences saved locally
- Color dot + name legend shows all currently visible calendars
- **Auto-refresh** every 5 minutes; **↻ button** for immediate manual refresh

### Events
- **Click a day** to see all events for that day in a popup
- **+ Event** button or click a day to add a new event — choose title, date, time, calendar, and whether it's all-day
- **✏ pencil icon** on a popup event to edit it (title, date, time, and calendar — moving between calendars is supported)
- **🗑 trash icon** on a popup event to delete it (with confirmation)
- Times use hour + minute dropdowns (5-minute increments) and are saved in your local timezone

### To-Do list
- Add tasks with the input field or press **Enter**
- Check off tasks to mark them done (last 5 completed tasks are shown)
- Drag the ⠿ handle to reorder active tasks
- Click ✕ to delete a task

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| F11 | Toggle fullscreen |
| Ctrl+← | Previous month / period |
| Ctrl+→ | Next month / period |
| Enter | Add todo (when input focused) |
| Escape | Close popups / modals |

---

## Local data

All local data is stored in `~/.homeapp/`:

| File | Contents |
|------|----------|
| `credentials.json` | Google OAuth client credentials |
| `token.json` | Your login session token |
| `todos.json` | To-do list |
| `calendar_visibility.json` | Which calendars are shown/hidden |

None of these files are tracked by git.

---

## Windows notes

- PyWebView on Windows uses Microsoft Edge (WebView2) which is pre-installed on Windows 10/11
- If it's not installed, download WebView2 Runtime from Microsoft
- No code-signing issues — works out of the box
