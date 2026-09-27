"""Шаг 3. Оркестраторы сессий Claude Code → data/orchestrators.json.

Справочная цифра: сколько стоила работа главной сессии (раздача задач, скриншоты,
критика). В стоимость моделей не входит. Реплики после orchestrator_cutoff не считаются.
"""
from pathlib import Path

from common import load_jsonl, read_data, write_data
from config import CLAUDE_PROJECT, CLAUDE_SESSIONS, DATA

OUT = DATA / 'orchestrators.json'


def analyze(path, cutoff=None):
    last, order = {}, []
    for r in load_jsonl(path):
        if r.get('type') != 'assistant':
            continue
        if cutoff and r.get('timestamp') and r['timestamp'] >= cutoff:
            continue
        msg = r.get('message', {})
        if msg.get('model') == '<synthetic>':
            continue
        key = msg.get('id') or f'__noid_{len(order)}'
        if key not in last:
            order.append(key)
        last[key] = r
    totals = {}
    for k in order:
        msg = last[k]['message']
        usage = msg.get('usage') or {}
        cc = usage.get('cache_creation') or {}
        u = totals.setdefault(msg.get('model'), {'input': 0, 'output': 0, 'cache_write_5m': 0, 'cache_write_1h': 0, 'cache_read': 0})
        u['input'] += usage.get('input_tokens', 0) or 0
        u['output'] += usage.get('output_tokens', 0) or 0
        if cc:
            u['cache_write_5m'] += cc.get('ephemeral_5m_input_tokens', 0) or 0
            u['cache_write_1h'] += cc.get('ephemeral_1h_input_tokens', 0) or 0
        else:
            u['cache_write_5m'] += usage.get('cache_creation_input_tokens', 0) or 0
        u['cache_read'] += usage.get('cache_read_input_tokens', 0) or 0
    return totals, len(order)


def main():
    cached = {r['label']: r for r in read_data(OUT)}
    out = []
    for s in CLAUDE_SESSIONS:
        root = Path(s['root']) if s.get('root') else CLAUDE_PROJECT
        path = root / f"{s['session']}.jsonl"
        if path.exists():
            totals, n = analyze(path, s.get('orchestrator_cutoff'))
            row = {'label': s['label'], 'session': s['session'], 'cutoff': s.get('orchestrator_cutoff'),
                   'api_calls': n, 'totals': totals}
            print(f"{s['label']}: {n} реплик оркестратора")
        elif s['label'] in cached:
            row = cached[s['label']]
            print(f"{s['label']}: логов нет, из сохранённых данных")
        else:
            print(f"{s['label']}: ни логов, ни сохранённых данных")
            continue
        out.append(row)
    write_data(OUT, out)


if __name__ == '__main__':
    main()
