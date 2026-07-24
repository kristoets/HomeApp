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

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| F11 | Toggle fullscreen |
| Ctrl+← | Previous month |
| Ctrl+→ | Next month |
| Enter | Add todo (when input focused) |
| Escape | Close popups/modals |

---

## Windows notes

- PyWebView on Windows uses Microsoft Edge (WebView2) which is pre-installed on Windows 10/11
- If it's not installed, download WebView2 Runtime from Microsoft
- No code-signing issues — works out of the box
