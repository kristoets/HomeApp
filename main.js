const _electron = require('electron');
console.log('[DEBUG] electron type:', typeof _electron, 'keys:', Object.keys(_electron).slice(0,5));
const { app, BrowserWindow, ipcMain, shell } = _electron;
const path = require('path');
const http = require('http');
const url = require('url');
const fs = require('fs');
const { google } = require('googleapis');
const Store = require('electron-store');

const store = new Store();

let mainWindow;
let authServer;
let oAuth2Client;

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_KEY = 'google_calendar_token';
const REDIRECT_PORT = 3141;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json');
}

function loadCredentials() {
  const credPath = getCredentialsPath();
  if (fs.existsSync(credPath)) {
    return JSON.parse(fs.readFileSync(credPath, 'utf8'));
  }
  // Also check app directory for credentials.json
  const localCred = path.join(__dirname, 'credentials.json');
  if (fs.existsSync(localCred)) {
    return JSON.parse(fs.readFileSync(localCred, 'utf8'));
  }
  return null;
}

function createOAuth2Client(credentials) {
  const { client_secret, client_id } = credentials.installed || credentials.web;
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Auth ──────────────────────────────────────────────────────────────

ipcMain.handle('auth:status', async () => {
  const credentials = loadCredentials();
  if (!credentials) return { status: 'no-credentials' };
  const token = store.get(TOKEN_KEY);
  if (!token) return { status: 'not-logged-in' };
  return { status: 'logged-in' };
});

ipcMain.handle('auth:login', async () => {
  const credentials = loadCredentials();
  if (!credentials) return { error: 'No credentials.json found' };

  oAuth2Client = createOAuth2Client(credentials);
  const existing = store.get(TOKEN_KEY);
  if (existing) {
    oAuth2Client.setCredentials(existing);
    return { success: true };
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  return new Promise((resolve) => {
    if (authServer) authServer.close();

    authServer = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname === '/oauth2callback') {
        const code = parsed.query.code;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#1a1a2e;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>Login successful! You can close this tab.</h2></body></html>');
        authServer.close();

        try {
          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);
          store.set(TOKEN_KEY, tokens);
          mainWindow?.webContents.send('auth:success');
          resolve({ success: true });
        } catch (e) {
          resolve({ error: e.message });
        }
      }
    });

    authServer.listen(REDIRECT_PORT, () => {
      shell.openExternal(authUrl);
    });
  });
});

ipcMain.handle('auth:logout', async () => {
  store.delete(TOKEN_KEY);
  oAuth2Client = null;
  return { success: true };
});

ipcMain.handle('auth:save-credentials', async (event, json) => {
  try {
    const parsed = JSON.parse(json);
    fs.writeFileSync(getCredentialsPath(), JSON.stringify(parsed, null, 2));
    return { success: true };
  } catch (e) {
    return { error: 'Invalid JSON: ' + e.message };
  }
});

// ── IPC: Calendar ──────────────────────────────────────────────────────────

function getCalendarClient() {
  const credentials = loadCredentials();
  if (!credentials) return null;
  const token = store.get(TOKEN_KEY);
  if (!token) return null;
  if (!oAuth2Client) {
    oAuth2Client = createOAuth2Client(credentials);
  }
  oAuth2Client.setCredentials(token);
  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

ipcMain.handle('calendar:events', async (event, { year, month }) => {
  const calendar = getCalendarClient();
  if (!calendar) return { error: 'Not authenticated' };

  // Fetch from one month before to one month after
  const start = new Date(year, month - 2, 1); // month-1 in JS (0-indexed) minus 1 more
  const end = new Date(year, month + 1, 1);   // month+1 in JS, then next month start

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 500
    });
    return { events: res.data.items || [] };
  } catch (e) {
    if (e.code === 401) {
      store.delete(TOKEN_KEY);
      oAuth2Client = null;
      mainWindow?.webContents.send('auth:expired');
    }
    return { error: e.message };
  }
});

ipcMain.handle('calendar:create-event', async (event, { title, start, end, allDay }) => {
  const calendar = getCalendarClient();
  if (!calendar) return { error: 'Not authenticated' };

  const eventBody = {
    summary: title,
    start: allDay ? { date: start } : { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: allDay ? { date: end } : { dateTime: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  };

  try {
    const res = await calendar.events.insert({ calendarId: 'primary', resource: eventBody });
    return { event: res.data };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('calendar:calendars', async () => {
  const calendar = getCalendarClient();
  if (!calendar) return { error: 'Not authenticated' };
  try {
    const res = await calendar.calendarList.list();
    return { calendars: res.data.items || [] };
  } catch (e) {
    return { error: e.message };
  }
});

// ── IPC: Todos ──────────────────────────────────────────────────────────────

ipcMain.handle('todos:get', async () => {
  return store.get('todos', []);
});

ipcMain.handle('todos:set', async (event, todos) => {
  store.set('todos', todos);
  return { success: true };
});

// ── IPC: Window ────────────────────────────────────────────────────────────

ipcMain.handle('window:fullscreen', async () => {
  mainWindow?.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.handle('window:is-fullscreen', async () => {
  return mainWindow?.isFullScreen() ?? false;
});

ipcMain.handle('window:open-external', async (event, url) => {
  await shell.openExternal(url);
});
