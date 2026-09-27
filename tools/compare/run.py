"""Весь конвейер по порядку: сканы логов → сборка assets/compare-data.js.

python tools/compare/run.py           # пересканировать логи и собрать
python tools/compare/run.py --build   # только собрать из сохранённых data/*.json
"""
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

steps = ['build.py'] if '--build' in sys.argv else ['scan_claude.py', 'scan_codex.py', 'scan_orchestrators.py', 'build.py']
for step in steps:
    print(f'== {step}')
    runpy.run_path(str(HERE / step), run_name='__main__')
