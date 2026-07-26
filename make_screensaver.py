#!/usr/bin/env python3
"""
Installs HomeScreensaver.scr without PyInstaller.
Uses distlib (bundled with pip) to create a tiny native exe stub
that calls the local Python interpreter to run screensaver.py.

Run:  python make_screensaver.py
"""
import sys
import os
import shutil
import subprocess
from pathlib import Path

INSTALL_DIR = Path.home() / 'AppData' / 'Local' / 'HomeScreensaver'
SCRIPT_SRC  = Path(__file__).parent / 'screensaver.py'


def find_pythonw():
    py = Path(sys.executable)
    for candidate in [py.parent / 'pythonw.exe', py.with_name('pythonw.exe')]:
        if candidate.exists():
            return str(candidate)
    return str(py)  # fallback: use python.exe


def main():
    print('Installing Home Screensaver...\n')

    INSTALL_DIR.mkdir(parents=True, exist_ok=True)

    # Copy screensaver.py to a stable location
    shutil.copy2(SCRIPT_SRC, INSTALL_DIR / 'screensaver.py')
    print(f'Copied screensaver.py  ->  {INSTALL_DIR}')

    # Write a tiny shim that puts INSTALL_DIR on sys.path then calls screensaver.main()
    shim = INSTALL_DIR / '_shim.py'
    shim.write_text(
        'import sys, os\n'
        f'sys.path.insert(0, r"{INSTALL_DIR}")\n'
        'def run():\n'
        '    import screensaver\n'
        '    screensaver.main()\n'
    )

    pythonw = find_pythonw()
    print(f'Python:  {pythonw}')

    # distlib ships with every pip installation — no extra install needed
    from distlib.scripts import ScriptMaker
    maker = ScriptMaker(str(INSTALL_DIR), str(INSTALL_DIR))
    maker.executable = pythonw
    maker.variants   = {''}   # single exe, no -3 / -3.x variants

    created = maker.make('HomeScreensaver = _shim:run [gui]')
    print(f'Created: {created}')

    # Rename .exe -> .scr  (Windows screensaver format)
    exe = INSTALL_DIR / 'HomeScreensaver.exe'
    scr = INSTALL_DIR / 'HomeScreensaver.scr'
    if scr.exists():
        scr.unlink()
    if not exe.exists():
        print('\nERROR: HomeScreensaver.exe was not created.')
        print('Check that distlib is available:  pip show distlib')
        return
    exe.rename(scr)
    print(f'Renamed  ->  {scr}\n')

    # Register in HKCU registry — no admin needed
    for key, val in [
        ('SCRNSAVE.EXE',      str(scr)),
        ('ScreenSaveActive',  '1'),
        ('ScreenSaveTimeOut', '300'),   # 5 minutes
    ]:
        subprocess.run(
            ['reg', 'add', r'HKCU\Control Panel\Desktop',
             '/v', key, '/t', 'REG_SZ', '/d', val, '/f'],
            capture_output=True
        )

    print('Registered in registry (activates after 5 min idle).\n')
    print('Test it now:')
    print(f'  "{scr}" /s\n')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
    input('Press Enter to exit...')
