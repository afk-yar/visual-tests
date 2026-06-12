# visual-tests — полигон визуальных задач

Полигон для сравнения визуальных возможностей разных LLM. Одной задаче дают
несколько моделей; их решения (самодостаточные HTML-демки) собраны в одну
витрину с переключателем моделей.

## Стек
Чистый статичный HTML/CSS/JS, **без сборки** (нет npm/Node/бандлера в рантайме).
Node используется только как dev-time раннер тестов (`node:assert`, без npm).

## Конвенции
- Задача = папка `demos/<task>/` + объект в `manifest.js` (с общим `prompt` и
  списком `solutions`).
- Решение модели = подпапка `demos/<task>/<model-slug>/index.html` +
  запись в `solutions[]` соответствующей задачи.
- Реестр `manifest.js` подключается как `<script>` (кладёт `window.TASKS`),
  а **не** через `fetch` — иначе сломается `file://`.
- Демки не используют ES-module-импорты и `fetch` локальных файлов
  (совместимость с `file://`).
- Тестируемая чистая логика — в dual-mode модулях: в браузере кладут API в
  глобал, в node экспортируют через `module.exports` (см. `pendulum.js`,
  `assets/shell.js`).

## Как смотреть
- Двойной клик по `index.html` (`file://`), либо
- `python -m http.server 8000` → `http://localhost:8000/index.html`
  (сервер нужен для Playwright-проверок).

## Как тестировать
- Чистая логика: `node demos/<task>/<model>/*.test.js`, `node assets/shell.test.js`.
- UI/canvas: Playwright MCP (навигация на localhost, скриншот, проверка консоли).

## Визуальный эталон оболочки
`docs/superpowers/mockup-shell.html` — утверждённый дизайн; `assets/shell.css`
выведен из него.
