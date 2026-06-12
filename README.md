# visual-tests

Полигон для сравнения визуальных решений разных LLM. Слева — список задач,
справа — переключатель моделей и результат выбранной модели в iframe, снизу —
исходный промпт.

## Запуск
Двойной клик по `index.html`, либо локальный сервер:

```
python -m http.server 8000
```
и открыть `http://localhost:8000/index.html`.

## Добавить решение
1. Положить самодостаточную демку в `demos/<task>/<model-slug>/index.html`.
2. Дописать запись в `solutions[]` нужной задачи в `manifest.js`.

## Добавить задачу
Создать `demos/<task>/…` и добавить объект задачи в `manifest.js`
(`id`, `title`, `tags`, `prompt`, `solutions`).

## Тесты
- `node demos/double-pendulum/opus-4.8/pendulum.test.js`
- `node assets/shell.test.js`
