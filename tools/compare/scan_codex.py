"""Шаг 2. Сессии Codex CLI → data/codex_runs.json.

Обходит все rollout-*.jsonl в ~/.codex/sessions, берёт те, у которых рабочая папка
содержит «visual-tests», и находит задачу по началу её промпта из manifest.js.
Модель — из событий turn_context (в session_meta её нет). Сохраняет только прогоны
с найденной задачей. Сессии, чьих логов уже нет, остаются из сохранённых данных.
"""
import json
import re

from common import load_jsonl, load_tasks, parse_ts, read_data, write_data
from config import CODEX_SESSIONS, DATA

OUT = DATA / 'codex_runs.json'
FIX_KEYWORDS = ['починк', 'баг', 'пуст', 'не выполнен', 'сломал', 'ошибк', 'не работает', 'синтаксическая ошибка']


def norm(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def analyze_file(path, task_keys):
    records = load_jsonl(path)
    if not records:
        return None
    session_meta, turn_models, user_turns, token_events, tool_ts = None, [], [], [], []
    start_ts = end_ts = None
    for r in records:
        t, ts, payload = r.get('type'), r.get('timestamp'), r.get('payload', {})
        if ts and start_ts is None:
            start_ts = ts
        if ts:
            end_ts = ts
        if t == 'session_meta':
            session_meta = payload
        elif t == 'turn_context':
            if payload.get('model'):
                turn_models.append(payload['model'])
        elif t == 'response_item':
            ptype = payload.get('type')
            if ptype == 'message' and payload.get('role') == 'user':
                content = payload.get('content')
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get('type') == 'input_text':
                            user_turns.append((ts, c.get('text', '')))
            elif ptype in ('function_call', 'custom_tool_call'):
                tool_ts.append(ts)
        elif t == 'event_msg' and payload.get('type') == 'token_count':
            tot = (payload.get('info') or {}).get('total_token_usage')
            if tot:
                token_events.append((ts, tot))

    # Якорь — первое сообщение пользователя, в начале которого есть промпт задачи.
    anchor_idx = anchor_task = None
    for idx, (_, text) in enumerate(user_turns):
        head = norm(text)[:1000]
        for tid, key in task_keys.items():
            if norm(key) in head:
                anchor_idx, anchor_task = idx, tid
                break
        if anchor_idx is not None:
            break
    if anchor_idx is None:
        return None

    row = {
        'path': str(path).replace('\\', '/'),
        'id': (session_meta or {}).get('id'),
        'cwd': (session_meta or {}).get('cwd', ''),
        'models': sorted(set(turn_models)),
        'matched_task': anchor_task,
        'start_ts': start_ts,
        'end_ts': end_ts,
    }
    critique = user_turns[anchor_idx + 1:]
    start_dt, end_dt = parse_ts(start_ts), parse_ts(end_ts)

    def usage_at(ts_dt):
        best = None
        for ets, usage in token_events:
            if parse_ts(ets) <= ts_dt:
                best = usage
            else:
                break
        return best

    final_usage = token_events[-1][1] if token_events else None
    if critique:
        v1_end = parse_ts(critique[0][0])
        v1_usage = usage_at(v1_end)
    else:
        v1_end, v1_usage = end_dt, final_usage
    row['v1'] = {
        'minutes': round((v1_end - start_dt).total_seconds() / 60.0, 1),
        'tool_calls': sum(1 for tt in tool_ts if parse_ts(tt) <= v1_end),
        'cumulative_usage_at_end': v1_usage,
    }
    row['revision'] = None
    if critique:
        joined = norm(' '.join(t for _, t in critique)).lower()
        is_fix = any(k in joined for k in FIX_KEYWORDS)
        any_non_fix = any(not any(k in norm(t).lower() for k in FIX_KEYWORDS) for _, t in critique)
        kind = 'mixed' if is_fix and any_non_fix and len(critique) > 1 else 'fix' if is_fix else 'revision'
        if final_usage and v1_usage:
            delta = {k: final_usage.get(k, 0) - v1_usage.get(k, 0) for k in final_usage}
        else:
            delta = dict(final_usage) if final_usage else None
        row['revision'] = {
            'kind': kind,
            'minutes': round((end_dt - v1_end).total_seconds() / 60.0, 1),
            'tool_calls': sum(1 for tt in tool_ts if parse_ts(tt) > v1_end),
            'delta_usage': delta,
            'n_rounds': len(critique),
        }
    return row


def main():
    task_keys = {t['id']: t['prompt'][:40] for t in load_tasks()}
    found = {}
    for path in sorted(CODEX_SESSIONS.rglob('rollout-*.jsonl')):
        with open(path, encoding='utf-8') as f:
            first = f.readline()
        try:
            cwd = json.loads(first).get('payload', {}).get('cwd', '')
        except json.JSONDecodeError:
            continue
        if 'visual-tests' not in cwd.replace('\\', '/'):
            continue
        row = analyze_file(path, task_keys)
        if row:
            found[row['id']] = row
    kept = [r for r in read_data(OUT) if r['id'] not in found]
    if kept:
        print(f'логов нет, из сохранённых данных: {len(kept)} прогонов')
    rows = sorted(list(found.values()) + kept, key=lambda r: r['start_ts'])
    print(f'Codex: {len(found)} прогонов из логов, всего {len(rows)}')
    write_data(OUT, rows)


if __name__ == '__main__':
    main()
