@echo off
rem visual-tests launcher: local no-cache server + open the shell in default browser.
rem Port 8473 (intentionally uncommon to avoid collisions).
cd /d "%~dp0"
start "" http://localhost:8473/index.html
python serve.py 8473
