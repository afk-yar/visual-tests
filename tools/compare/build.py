"""Шаг 4. data/*.json + config → assets/compare-data.js (window.COMPARE_DATA).

Какой прогон считается решением задачи:
- Claude Code: один субагент на задачу. Если субагентов несколько, субагент
  с описанием «Доработка …» — это доработка решения, а из остальных решением
  считается самый поздний, более ранние — перезапуски.
- Codex: самый поздний прогон по задаче — решение, более ранние — перезапуски.
  Общая сессия на несколько задач задаётся в config.CODEX_SHARED.
"""
import json
from collections import defaultdict
from datetime import date

from common import claude_cost, codex_cost, load_tasks, read_data
from config import CODEX_SHARED, DATA, IDLE_FIX, MODELS, OUT, PRICING

TOKEN_KEYS = ('input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read')


def claude_tokens(t):
    return {k: t.get(k, 0) for k in TOKEN_KEYS} | {'reasoning': None}


def codex_tokens(usage):
    if not usage:
        return {k: 0 for k in TOKEN_KEYS} | {'reasoning': None}
    total_in = usage.get('input_tokens', 0) or 0
    cached = usage.get('cached_input_tokens', 0) or 0
    return {'input': max(total_in - cached, 0), 'output': usage.get('output_tokens', 0) or 0,
            'cache_write_5m': 0, 'cache_write_1h': 0, 'cache_read': cached,
            'reasoning': usage.get('reasoning_output_tokens', 0) or 0}


def claude_run(slug, default_model, row, restarts=(), review=None):
    v1 = row['v1']
    model = v1['model'] or default_model
    run = {'slug': slug, 'task': row['task'], 'model_id': model, 'agent': row['agent_id'],
           'v1': {'minutes': v1['minutes'], 'tool_calls': v1['tool_calls'], 'api_calls': v1['api_calls'],
                  'tokens': claude_tokens(v1['tokens']), 'cost_usd': claude_cost(model, v1['tokens'])},
           'revision': None, 'restarts': [], 'flags': list(row['flags'])}
    rev = row.get('revision')
    if review:  # доработка отдельным субагентом: вся его работа — доработка
        rv = review['v1']
        run['revision'] = {'kind': 'revision', 'minutes': rv['minutes'], 'tokens': claude_tokens(rv['tokens']),
                           'cost_usd': claude_cost(rv['model'], rv['tokens'])}
    elif rev:
        run['revision'] = {'kind': rev['kind'], 'minutes': rev['minutes'], 'tokens': claude_tokens(rev['tokens']),
                           'cost_usd': claude_cost(rev['model'], rev['tokens'])}
    for r in restarts:
        minutes, tok = r['v1']['minutes'], dict(r['v1']['tokens'])
        if r.get('revision'):
            minutes += r['revision']['minutes']
            for k, v in r['revision']['tokens'].items():
                tok[k] = tok.get(k, 0) + v
        run['restarts'].append({'minutes': round(minutes, 1), 'cost_usd': claude_cost(r['v1']['model'], tok),
                                'reason': f"discarded/earlier attempt, flags={r.get('flags')} (agent {r['agent_id']})"})
    return run


def codex_run(slug, model, row, restarts=(), flags=()):
    v1, rev = row['v1'], row.get('revision')
    run = {'slug': slug, 'task': row['matched_task'], 'model_id': model, 'agent': row['id'],
           'v1': {'minutes': v1['minutes'], 'tool_calls': v1['tool_calls'], 'api_calls': None,
                  'tokens': codex_tokens(v1['cumulative_usage_at_end']),
                  'cost_usd': codex_cost(model, v1['cumulative_usage_at_end'])},
           'revision': None, 'restarts': [], 'flags': list(flags)}
    if rev:
        run['revision'] = {'kind': rev['kind'], 'minutes': rev['minutes'], 'tokens': codex_tokens(rev['delta_usage']),
                           'cost_usd': codex_cost(model, rev['delta_usage'])}
    for r in restarts:
        usage = dict(r['v1']['cumulative_usage_at_end'] or {})
        minutes = r['v1']['minutes']
        if r.get('revision') and r['revision'].get('delta_usage'):
            for k, v in r['revision']['delta_usage'].items():
                usage[k] = usage.get(k, 0) + v
            minutes += r['revision']['minutes']
        run['restarts'].append({'minutes': round(minutes, 1), 'cost_usd': codex_cost(model, usage) if usage else 0,
                                'reason': f"discarded attempt in {r['cwd'].split(chr(92))[-1]} (session {r['id']})"})
    return run


def claude_runs(model, rows):
    by_task = defaultdict(list)
    for r in rows:
        by_task[r['task']].append(r)
    runs = []
    for task, rs in by_task.items():
        reviews = [r for r in rs if (r['description'] or '').startswith('Доработка ')]
        solves = sorted((r for r in rs if r not in reviews), key=lambda r: r['start_ts'])
        assert solves and len(reviews) <= 1, (model['slug'], task)
        runs.append(claude_run(model['slug'], model['model_ids'][0], solves[-1], solves[:-1],
                               reviews[0] if reviews else None))
    return runs


def codex_runs(model, rows):
    model_id = model['model_ids'][0]
    shared = CODEX_SHARED.get(model['slug'])
    by_task = defaultdict(list)
    for r in rows:
        by_task[r['matched_task']].append(r)
    runs = []
    for task, rs in by_task.items():
        rs.sort(key=lambda r: r['start_ts'])
        runs.append(codex_run(model['slug'], model_id, rs[-1], rs[:-1]))
    if shared:
        row = next(r for r in rows if r['id'] == shared['session'])
        for task in shared['tasks'][1:]:
            run = codex_run(model['slug'], model_id, row, flags=['shared_session_not_separable'])
            run['task'] = task
            runs.append(run)
    return runs


def main():
    tasks = load_tasks()
    task_ids = [t['id'] for t in tasks]
    claude = read_data(DATA / 'claude_runs.json')
    codex = read_data(DATA / 'codex_runs.json')
    orchestrators = read_data(DATA / 'orchestrators.json')

    runs, models = [], []
    for m in MODELS:
        if m['tool'] == 'claude-code':
            rows = [r for r in claude if r['slug'] == m['slug']]
            mruns = claude_runs(m, rows)
        else:
            rows = [r for r in codex if len(r['models']) == 1 and r['models'][0] in m['model_ids']]
            mruns = codex_runs(m, rows)
        for r in mruns:
            fix = IDLE_FIX.get((m['slug'], r['task']))
            if fix:
                r['v1']['minutes'] = fix
                r['flags'].append('idle_removed')
        mruns.sort(key=lambda r: task_ids.index(r['task']))
        runs.extend(mruns)

        in_manifest = sum(1 for t in tasks if any(s['slug'] == m['slug'] for s in t['solutions']))
        with_data = len({r['task'] for r in mruns})
        status = m.get('status') or ('none' if not with_data else 'full' if with_data == in_manifest else 'partial')
        models.append({'label': m['label'], 'slug': m['slug'], 'tool': m['tool'], 'tasks_in_manifest': in_manifest,
                       'tasks_with_data': with_data, 'status': status, 'why': m['why']})
        dupes = [t for t in {r['task'] for r in mruns} if sum(r['task'] == t for r in mruns) > 1]
        extra = {r['task'] for r in mruns} - set(task_ids)
        assert not dupes and not extra, (m['slug'], dupes, extra)
        if mruns:
            total = sum((r['v1']['cost_usd'] or 0) + ((r['revision'] or {}).get('cost_usd') or 0)
                        + sum(x['cost_usd'] or 0 for x in r['restarts']) for r in mruns)
            print(f"{m['label']:16} задач {with_data:2}/{in_manifest}  всего ${total:.2f}")
        else:
            print(f"{m['label']:16} нет данных")

    shared = defaultdict(int)
    for r in runs:
        shared[(r['slug'], r['agent'])] += 1
    page_runs = [{
        'slug': r['slug'], 'task': r['task'], 'model_id': r['model_id'],
        'session_key': r['slug'] + '/' + r['agent'], 'shared': shared[(r['slug'], r['agent'])],
        'v1': r['v1'], 'revision': r['revision'], 'restarts': r['restarts'], 'flags': r['flags'],
    } for r in runs]

    orch_usd = 0
    for o in orchestrators:
        session_usd = sum(c for c in (claude_cost(model, u) for model, u in o['totals'].items()) if c)
        orch_usd += round(session_usd, 4)
    out = {
        'generated': date.today().isoformat(),
        'pricing': PRICING,
        'models': models,
        'runs': page_runs,
        'orchestrator_usd': round(orch_usd, 2),
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Сгенерировано tools/compare/build.py из логов Claude Code и Codex (см. compare.html → «Как считали»).\n')
        f.write('window.COMPARE_DATA = ')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'прогонов {len(page_runs)}, оркестраторы ${out["orchestrator_usd"]} → {OUT}')


if __name__ == '__main__':
    main()
