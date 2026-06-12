@echo off
rem visual-tests launcher: local server + open the shell in default browser.
rem Port 8473 (intentionally uncommon to avoid collisions).
cd /d "%~dp0"
start "" http://localhost:8473/index.html
python -m http.server 8473
