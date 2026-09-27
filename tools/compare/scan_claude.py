"""Шаг 1. Субагенты Claude Code → data/claude_runs.json.

Для каждой сессии из config.CLAUDE_SESSIONS разбирает транскрипты субагентов
<session>/subagents/agent-*.jsonl. Если каталога сессии больше нет (логи удалены
автоочисткой), строки этой сессии берутся из уже сохранённого data/claude_runs.json.
Субагенты без пути demos/<task>/<slug>/ в первом сообщении — не решения, отбрасываются.
"""
import json
import re
from pathlib import Path

from common import load_jsonl, parse_ts, read_data, write_data
from config import CLAUDE_PROJECT, CLAUDE_SESSIONS, DATA

OUT = DATA / 'claude_runs.json'
PAT = re.compile(r"demos[\\/]([a-zA-Z0-9_\-]+)[\\/]([a-zA-Z0-9_.\-]+)[\\/]")
EMPTY = {'input': 0, 'output': 0, 'cache_write_5m': 0, 'cache_write_1h': 0, 'cache_read': 0}


def first_user_text(records):
    for r in records:
        if r.get('type') == 'user':
            content = r.get('message', {}).get('content')
            if isinstance(content, str):
                return content
    return ''


def usage_of(r):
    msg = r.get('message', {})
    usage = msg.get('usage') or {}
    cc = usage.get('cache_creation')
    if cc:
        cw5 = cc.get('ephemeral_5m_input_tokens', 0) or 0
        cw1 = cc.get('ephemeral_1h_input_tokens', 0) or 0
    else:
        cw5 = usage.get('cache_creation_input_tokens', 0) or 0
        cw1 = 0
    return {
        'input': usage.get('input_tokens', 0) or 0,
        'output': usage.get('output_tokens', 0) or 0,
        'cache_write_5m': cw5,
        'cache_write_1h': cw1,
        'cache_read': usage.get('cache_read_input_tokens', 0) or 0,
    }, msg.get('model')


def summarize(assistants, tool_counts):
    tokens = dict(EMPTY)
    models = set()
    tool_calls = 0
    for r in assistants:
        u, model = usage_of(r)
        for k in tokens:
            tokens[k] += u[k]
        if model:
            models.add(model)
        tool_calls += tool_counts[id(r)]
    return tokens, (sorted(models)[0] if models else None), tool_calls


def analyze_agent(path, meta):
    records = [r for r in load_jsonl(path) if 'timestamp' in r]
    if not records:
        return None
    records.sort(key=lambda r: r['timestamp'])
    start_ts = parse_ts(records[0]['timestamp'])
    m = PAT.search(first_user_text(records))
    task, slug = (m.group(1), m.group(2)) if m else (None, None)

    # Одна API-реплика пишется несколькими строками с общим message.id: в каждой
    # строке один новый блок content, а usage накопительный. Токены берём из
    # последней строки, вызовы инструментов собираем со всех строк.
    by_id, order = {}, []
    for r in records:
        if r.get('type') != 'assistant':
            continue
        msg = r.get('message', {})
        if msg.get('model') == '<synthetic>':
            continue
        key = msg.get('id') or f'__no_id_{len(order)}'
        if key not in by_id:
            order.append(key)
            by_id[key] = {'last': r, 'tools': 0}
        entry = by_id[key]
        if r['timestamp'] >= entry['last']['timestamp']:
            entry['last'] = r
        content = msg.get('content')
        if isinstance(content, list):
            entry['tools'] += sum(1 for c in content if isinstance(c, dict) and c.get('type') == 'tool_use')
    assistants = [by_id[k]['last'] for k in order]
    tool_counts = {id(by_id[k]['last']): by_id[k]['tools'] for k in order}

    # Критика — сообщения пользователя (строкой) после первого; служебное
    # «Output token limit hit» — продолжение той же версии, не критика.
    user_texts = [r for r in records if r.get('type') == 'user'
                  and isinstance(r.get('message', {}).get('content'), str)]
    injections = [r for r in user_texts[1:] if not r['message']['content'].startswith('Output token limit hit')]
    injection_ts = parse_ts(injections[0]['timestamp']) if injections else None

    if injection_ts:
        v1 = [r for r in assistants if parse_ts(r['timestamp']) < injection_ts]
        v2 = [r for r in assistants if parse_ts(r['timestamp']) >= injection_ts]
    else:
        v1, v2 = assistants, []

    flags = []
    if any(r.get('apiErrorStatus') == 429 for r in records):
        flags.append('session_limit')
    if any((r.get('message', {}) or {}).get('stop_reason') == 'max_tokens' for r in assistants):
        flags.append('max_tokens')
    n_cont = sum(1 for r in user_texts if r['message']['content'].startswith('Output token limit hit'))
    if n_cont:
        flags.append(f'auto_continue_x{n_cont}')

    cutoff_ts = max(parse_ts(r['timestamp']) for r in v1) if v1 else start_ts
    tokens, model, tool_calls = summarize(v1, tool_counts)
    row = {
        'path': str(path).replace('\\', '/'),
        'agent_id': meta['agentId'],
        'description': meta.get('description'),
        'task': task,
        'slug': slug,
        'start_ts': start_ts.isoformat(),
        'cutoff_ts': cutoff_ts.isoformat(),
        'v1': {
            'minutes': round((cutoff_ts - start_ts).total_seconds() / 60.0, 1),
            'tool_calls': tool_calls,
            'api_calls': len(v1),
            'model': model,
            'tokens': tokens,
        },
        'flags': flags,
        'revision': None,
    }
    if v2:
        rev_tokens, rev_model, rev_tools = summarize(v2, tool_counts)
        end_ts = max(parse_ts(r['timestamp']) for r in v2)
        joined = ' '.join(r['message']['content'] for r in injections)
        fix = '[ПОЧИНКА]' in joined or 'починк' in joined.lower()
        rev = '[ДОРАБОТКА]' in joined or 'доработ' in joined.lower()
        row['revision'] = {
            'kind': 'mixed' if fix and rev else 'fix' if fix else 'revision',
            'minutes': round((end_ts - injection_ts).total_seconds() / 60.0, 1),
            'tool_calls': rev_tools,
            'api_calls': len(v2),
            'model': rev_model or model,
            'tokens': rev_tokens,
            'n_injections': len(injections),
        }
    return row


def scan_session(label, subdir):
    rows = []
    for meta_path in sorted(subdir.glob('*.meta.json')):
        agent = meta_path.name[:-len('.meta.json')]
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        meta['agentId'] = agent
        row = analyze_agent(subdir / f'{agent}.jsonl', meta)
        if row and row['task']:
            row['session_label'] = label
            rows.append(row)
    return rows


def main():
    cached = read_data(OUT)
    out = []
    for s in CLAUDE_SESSIONS:
        root = Path(s['root']) if s.get('root') else CLAUDE_PROJECT
        subdir = root / s['session'] / 'subagents'
        if subdir.is_dir():
            rows = scan_session(s['label'], subdir)
            print(f"{s['label']}: {len(rows)} решений из логов")
        else:
            rows = [r for r in cached if r['session_label'] == s['label']]
            print(f"{s['label']}: логов нет, из сохранённых данных {len(rows)} решений")
        out.extend(rows)
    known = {s['label'] for s in CLAUDE_SESSIONS}
    orphans = [r for r in cached if r['session_label'] not in known]
    if orphans:
        print(f'ВНИМАНИЕ: {len(orphans)} строк сессий, которых нет в config.CLAUDE_SESSIONS, сохранены как есть')
        out.extend(orphans)
    write_data(OUT, out)


if __name__ == '__main__':
    main()
