import webview
import json
import os
import threading
import webbrowser
import http.server
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone, timedelta

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

# ── Data directory ────────────────────────────────────────────────────────────
APP_DIR = Path.home() / '.homeapp'
APP_DIR.mkdir(exist_ok=True)

TOKEN_FILE = APP_DIR / 'token.json'
CREDS_FILE = APP_DIR / 'credentials.json'
TODOS_FILE = APP_DIR / 'todos.json'

SCOPES = ['https://www.googleapis.com/auth/calendar']
REDIRECT_PORT = 3141
REDIRECT_URI = f'http://localhost:{REDIRECT_PORT}/oauth2callback'

_window = None   # set after webview.create_window


# ── Helpers ───────────────────────────────────────────────────────────────────
def _load_credentials_json():
    if CREDS_FILE.exists():
        return json.loads(CREDS_FILE.read_text())
    return None

def _get_google_client():
    """Return authenticated Google Calendar service or None."""
    creds_json = _load_credentials_json()
    if not creds_json:
        return None
    if not TOKEN_FILE.exists():
        return None

    token = json.loads(TOKEN_FILE.read_text())
    info = creds_json.get('installed') or creds_json.get('web')
    creds = Credentials(
        token=token.get('token'),
        refresh_token=token.get('refresh_token'),
        token_uri='https://oauth2.googleapis.com/token',
        client_id=info['client_id'],
        client_secret=info['client_secret'],
        scopes=SCOPES
    )
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_FILE.write_text(json.dumps({
                'token': creds.token,
                'refresh_token': creds.refresh_token,
                'expiry': creds.expiry.isoformat() if creds.expiry else None
            }))
        except Exception:
            TOKEN_FILE.unlink(missing_ok=True)
            return None

    return build('calendar', 'v3', credentials=creds, cache_discovery=False)


# ── PyWebView API class ───────────────────────────────────────────────────────
class Api:

    # ── Auth ──────────────────────────────────────────────────────────────────

    def auth_status(self):
        if not _load_credentials_json():
            return {'status': 'no-credentials'}
        if not TOKEN_FILE.exists():
            return {'status': 'not-logged-in'}
        return {'status': 'logged-in'}

    def auth_login(self):
        creds_json = _load_credentials_json()
        if not creds_json:
            return {'error': 'No credentials.json found'}

        info = creds_json.get('installed') or creds_json.get('web')
        flow = Flow.from_client_config(
            creds_json,
            scopes=SCOPES,
            redirect_uri=REDIRECT_URI
        )
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            prompt='consent'
        )

        result = {'done': False, 'success': False, 'error': None}

        class OAuthHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                if parsed.path == '/oauth2callback':
                    params = urllib.parse.parse_qs(parsed.query)
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html')
                    self.end_headers()
                    self.wfile.write(b'''<html><body style="background:#0f0f1a;color:#e0e0e0;
                        font-family:sans-serif;display:flex;align-items:center;
                        justify-content:center;height:100vh;margin:0">
                        <h2>Login successful! You can close this tab.</h2></body></html>''')

                    code = params.get('code', [None])[0]
                    if code:
                        try:
                            flow.fetch_token(code=code)
                            creds = flow.credentials
                            TOKEN_FILE.write_text(json.dumps({
                                'token': creds.token,
                                'refresh_token': creds.refresh_token,
                                'expiry': creds.expiry.isoformat() if creds.expiry else None
                            }))
                            result['success'] = True
                        except Exception as e:
                            result['error'] = str(e)
                    result['done'] = True

            def log_message(self, *args):
                pass  # suppress HTTP log output

        server = http.server.HTTPServer(('localhost', REDIRECT_PORT), OAuthHandler)
        server.timeout = 120

        def serve():
            while not result['done']:
                server.handle_request()
            server.server_close()
            # Notify frontend
            if _window:
                if result['success']:
                    _window.evaluate_js('window._onAuthSuccess && window._onAuthSuccess()')
                else:
                    _window.evaluate_js(
                        f'window._onAuthError && window._onAuthError({json.dumps(result["error"])})'
                    )

        threading.Thread(target=serve, daemon=True).start()
        webbrowser.open(auth_url)
        return {'success': True, 'waiting': True}

    def auth_logout(self):
        TOKEN_FILE.unlink(missing_ok=True)
        return {'success': True}

    def auth_save_credentials(self, json_str):
        try:
            parsed = json.loads(json_str)
            CREDS_FILE.write_text(json.dumps(parsed, indent=2))
            return {'success': True}
        except Exception as e:
            return {'error': f'Invalid JSON: {e}'}

    # ── Calendar ──────────────────────────────────────────────────────────────

    def calendar_events(self, start_str, end_str):
        svc = _get_google_client()
        if not svc:
            return {'error': 'Not authenticated'}

        start = datetime.fromisoformat(start_str).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(end_str).replace(tzinfo=timezone.utc)

        try:
            # All visible calendars with their colors
            cal_list_res = svc.calendarList().list().execute()
            calendars = [c for c in cal_list_res.get('items', [])
                         if c.get('selected', True)]

            # Event-level color palette (for colorId overrides)
            color_defs = svc.colors().get().execute()
            event_colors = color_defs.get('event', {})

            all_events = []
            for cal in calendars:
                cal_id = cal['id']
                cal_bg = cal.get('backgroundColor', '#7c6af7')
                cal_name = cal.get('summary', '')
                try:
                    res = svc.events().list(
                        calendarId=cal_id,
                        timeMin=start.isoformat(),
                        timeMax=end.isoformat(),
                        singleEvents=True,
                        orderBy='startTime',
                        maxResults=500
                    ).execute()
                except Exception:
                    continue
                for ev in res.get('items', []):
                    ev['_displayColor'] = (
                        event_colors.get(ev['colorId'], {}).get('background', cal_bg)
                        if ev.get('colorId') else cal_bg
                    )
                    ev['_calendarName'] = cal_name
                    all_events.append(ev)

            all_events.sort(key=lambda ev: (
                ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date') or ''
            ))
            return {'events': all_events}
        except Exception as e:
            if '401' in str(e):
                TOKEN_FILE.unlink(missing_ok=True)
                if _window:
                    _window.evaluate_js('window._onAuthExpired && window._onAuthExpired()')
            return {'error': str(e)}

    def calendar_create_event(self, title, start, end, all_day):
        svc = _get_google_client()
        if not svc:
            return {'error': 'Not authenticated'}

        tz = datetime.now().astimezone().tzname()
        if all_day:
            body = {
                'summary': title,
                'start': {'date': start},
                'end': {'date': end}
            }
        else:
            body = {
                'summary': title,
                'start': {'dateTime': start, 'timeZone': 'UTC'},
                'end': {'dateTime': end, 'timeZone': 'UTC'}
            }
        try:
            ev = svc.events().insert(calendarId='primary', body=body).execute()
            return {'event': ev}
        except Exception as e:
            return {'error': str(e)}

    # ── Todos ─────────────────────────────────────────────────────────────────

    def todos_get(self):
        if TODOS_FILE.exists():
            return json.loads(TODOS_FILE.read_text())
        return []

    def todos_set(self, todos):
        TODOS_FILE.write_text(json.dumps(todos))
        return {'success': True}

    # ── Window ────────────────────────────────────────────────────────────────

    def window_fullscreen(self):
        if _window:
            _window.toggle_fullscreen()

    def window_open_external(self, url):
        webbrowser.open(url)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    global _window
    api = Api()
    _window = webview.create_window(
        'Home',
        str(Path(__file__).parent / 'renderer' / 'index.html'),
        js_api=api,
        width=1400,
        height=900,
        min_size=(900, 600),
        background_color='#0f0f1a',
        text_select=False
    )
    webview.start(debug=False)


if __name__ == '__main__':
    main()
