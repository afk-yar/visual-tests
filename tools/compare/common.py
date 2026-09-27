"""Общие функции конвейера: чтение логов, манифеста, данных и расчёт стоимости."""
import json
import subprocess
from datetime import datetime

from config import MANIFEST, PRICING


def parse_ts(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


def load_jsonl(path):
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def load_tasks():
    """Задачи из manifest.js (window.TASKS) через node — манифест это JS, не JSON."""
    code = ('global.window={};require(process.argv[1]);'
            'process.stdout.write(JSON.stringify(window.TASKS))')
    res = subprocess.run(['node', '-e', code, str(MANIFEST)], capture_output=True, check=True)
    return json.loads(res.stdout.decode('utf-8'))


def read_data(path):
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding='utf-8'))


def write_data(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')


def claude_cost(model_id, t):
    """Стоимость по токенам Claude: вход без кеша, запись в кеш 5м/1ч, чтение кеша, выход."""
    p = PRICING.get(model_id)
    if not p:
        return None
    return round(
        t.get('input', 0) / 1e6 * p['input']
        + t.get('output', 0) / 1e6 * p['output']
        + t.get('cache_write_5m', 0) / 1e6 * p['cache_write_5m']
        + t.get('cache_write_1h', 0) / 1e6 * p['cache_write_1h']
        + t.get('cache_read', 0) / 1e6 * p['cache_read'],
        4,
    )


def codex_cost(model_id, usage):
    """Стоимость по накопительному usage Codex: input_tokens уже включает cached_input_tokens."""
    if not usage:
        return None
    p = PRICING[model_id]
    total_in = usage.get('input_tokens', 0) or 0
    cached = usage.get('cached_input_tokens', 0) or 0
    out = usage.get('output_tokens', 0) or 0
    return round(max(total_in - cached, 0) / 1e6 * p['input'] + cached / 1e6 * p['cache_read'] + out / 1e6 * p['output'], 4)
