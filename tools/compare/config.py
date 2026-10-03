"""Настройки конвейера сравнения моделей: пути, прейскурант, модели, сессии.

Всё, что меняется при добавлении новой модели или сессии, лежит здесь.
Как пользоваться — README.md рядом.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DATA = HERE / 'data'
MANIFEST = REPO / 'manifest.js'
OUT = REPO / 'assets' / 'compare-data.js'

# Логи Claude Code этого проекта и логи Codex CLI.
CLAUDE_PROJECT = Path.home() / '.claude' / 'projects' / 'E-----------pet-visual-tests'
CODEX_SESSIONS = Path.home() / '.codex' / 'sessions'

# Цены API, $ за 1 млн токенов. У Codex нет отдельной цены записи в кеш.
CLAUDE_SOURCE = 'Справочник Claude API, таблица цен от 2026-06-24'
PRICING = {
    'claude-opus-5-5': {'input': 4, 'output': 20, 'cache_write_5m': 5, 'cache_write_1h': 8, 'cache_read': 0.2, 'source': CLAUDE_SOURCE},
    'claude-opus-5': {'input': 5, 'output': 25, 'cache_write_5m': 6.25, 'cache_write_1h': 10, 'cache_read': 0.5, 'source': CLAUDE_SOURCE},
    'claude-opus-4-8': {'input': 5, 'output': 25, 'cache_write_5m': 6.25, 'cache_write_1h': 10, 'cache_read': 0.5, 'source': CLAUDE_SOURCE},
    'claude-sonnet-5-5': {'input': 2, 'output': 10, 'cache_write_5m': 2.5, 'cache_write_1h': 4, 'cache_read': 0.2, 'source': 'Справочник Claude API, таблица моделей от 2026-09-25'},
    'claude-sonnet-5': {'input': 2, 'output': 10, 'cache_write_5m': 2.5, 'cache_write_1h': 4, 'cache_read': 0.2, 'source': CLAUDE_SOURCE},
    'claude-fable-5': {'input': 10, 'output': 50, 'cache_write_5m': 12.5, 'cache_write_1h': 20, 'cache_read': 1.0, 'source': CLAUDE_SOURCE},
    'gpt-5.5': {'input': 5, 'output': 30, 'cache_write_5m': 0, 'cache_write_1h': 0, 'cache_read': 0.5, 'source': 'https://developers.openai.com/api/docs/models/gpt-5.5'},
    'gpt-5.6-sol': {'input': 4, 'output': 20, 'cache_write_5m': 0, 'cache_write_1h': 0, 'cache_read': 0.4, 'source': 'https://developers.openai.com/api/docs/models/gpt-5.6-sol'},
    'gpt-5.6-luna': {'input': 0.2, 'output': 1.2, 'cache_write_5m': 0, 'cache_write_1h': 0, 'cache_read': 0.02, 'source': 'https://developers.openai.com/api/docs/models/gpt-5.6-luna'},
}

# Модели витрины в порядке вывода. slug — как в manifest.js.
# model_ids — какие id моделей в логах относятся к этой модели витрины.
# why — почему данных нет или они неполные (показывается на странице).
# status — принудительный статус, если автоматический (none/full/partial) не подходит.
MODELS = [
    {'label': 'Claude Opus 4.8', 'slug': 'opus-4.8', 'tool': 'claude-code', 'model_ids': ['claude-opus-4-8'],
     'why': 'Логи Claude Code за 12–17 июня удалены автоочисткой через 30 дней, в бэкапах их нет.'},
    {'label': 'GPT-5.5 Codex', 'slug': 'gpt-5.5-codex', 'tool': 'codex', 'model_ids': ['gpt-5.5'],
     'why': 'Конь, Мандельброт и Лоренц решены в одной сессии Codex, их затраты не разделить.', 'status': 'partial'},
    {'label': 'Claude Fable 5', 'slug': 'fable-5', 'tool': 'claude-code', 'model_ids': ['claude-fable-5'],
     'why': 'Логи Claude Code за июль удалены автоочисткой через 30 дней, в бэкапах их нет.'},
    {'label': 'Claude Sonnet 5', 'slug': 'sonnet-5', 'tool': 'claude-code', 'model_ids': ['claude-sonnet-5'],
     'why': 'Логи Claude Code за 6 июля удалены автоочисткой через 30 дней, в бэкапах их нет.'},
    {'label': 'GPT-5.6 Sol', 'slug': 'gpt-5.6-sol', 'tool': 'codex', 'model_ids': ['gpt-5.6-sol'], 'why': ''},
    {'label': 'GPT-5.6 Luna', 'slug': 'gpt-5.6-luna', 'tool': 'codex', 'model_ids': ['gpt-5.6-luna'], 'why': ''},
    {'label': 'Kimi K3', 'slug': 'kimi-k3', 'tool': 'claude-code', 'model_ids': [],
     'why': 'Логи сессии Claude Code за июль удалены автоочисткой через 30 дней, в бэкапах их нет.'},
    {'label': 'Claude Opus 5', 'slug': 'opus-5', 'tool': 'claude-code', 'model_ids': ['claude-opus-5'],
     'why': 'Сессия восстановлена из бэкапа от 30 августа. Шахматного коня в ней нет.'},
    {'label': 'Claude Opus 5.5', 'slug': 'opus-5.5', 'tool': 'claude-code', 'model_ids': ['claude-opus-5-5'], 'why': ''},
    {'label': 'Claude Sonnet 5.5', 'slug': 'sonnet-5.5', 'tool': 'claude-code', 'model_ids': ['claude-sonnet-5-5'], 'why': ''},
]

# Сессии Claude Code, в которых субагенты писали решения.
# session — имя файла <session>.jsonl в CLAUDE_PROJECT (оркестратор),
#   субагенты лежат в <session>/subagents/.
# root — другой каталог проекта, если логи восстановлены из бэкапа.
# orchestrator_cutoff — не считать реплики оркестратора с этого момента (UTC),
#   если после решений сессия ушла в другую работу.
# Нет каталога с логами — берутся уже сохранённые данные из data/.
CLAUDE_SESSIONS = [
    {'label': 'opus-5.5-sessA', 'session': '44e0126f-d33c-4d6a-95ed-396ee8fc451a'},
    {'label': 'opus-5.5-sessB', 'session': '9076c8f3-b929-4c43-8885-65c23f80f7dd'},
    {'label': 'opus-5.5-sessC', 'session': '8fba026f-f739-4a0d-98ad-a0ee7fe7f0c3'},
    {'label': 'opus-5.5-sessD', 'session': '4f72b4d0-6a55-466f-b928-366fd7d55dc0',
     'orchestrator_cutoff': '2026-09-27T09:09:31.130Z'},
    {'label': 'sonnet-5.5-sessA', 'session': 'da037008-7e7b-4b95-8925-32602fe3e0bc'},
    # Восстановлена из restic-снимка 1726c119 от 2026-08-30.
    {'label': 'opus-5-restored', 'session': '9eb3a373-1a82-4f63-b3a1-3b92440087e4',
     'root': 'E:/tmp/vt-timing/restore/C/Users/afk/.claude/projects/E-----------pet-visual-tests'},
]

# Одна сессия Codex на несколько задач: затраты не делятся, у остальных задач флаг.
CODEX_SHARED = {
    'gpt-5.5-codex': {'session': '019ebbda-8423-7932-b3a3-ef388571f446',
                      'tasks': ['svg-chess-knight', 'mandelbrot', 'lorenz']},
}

# Пауза ожидания внутри первой версии: (slug, task) -> активные минуты.
# Простой 700 минут у GPT-5.5 Codex над велосипедом: ответ записан,
# следующее событие через 11,7 ч; активное время = 708,6 − 700,5.
IDLE_FIX = {('gpt-5.5-codex', 'svg-bicycle'): 8.1}
