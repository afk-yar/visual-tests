# visual-tests

Полигон для сравнения визуальных решений разных LLM. Слева — список задач,
справа — переключатель моделей и результат выбранной модели в iframe, снизу —
исходный промпт.

## Запуск
Основной режим — **локальный сервер**. Двойной клик по `start.cmd` (поднимает
сервер и открывает оболочку), либо вручную:

```
python -m http.server 8473
```
и открыть `http://localhost:8473/index.html`.

Оболочку нужно открывать именно через сервер: решение грузится в
`<iframe sandbox="allow-scripts">`, а на `file://` браузер блокирует загрузку
ресурсов внутри sandbox-iframe. Отдельную демку
(`demos/<task>/<model-slug>/index.html`) можно открыть и напрямую через `file://`.

## Добавить решение
1. Положить самодостаточную демку в `demos/<task>/<model-slug>/index.html`.
2. Дописать запись в `solutions[]` нужной задачи в `manifest.js`.

## Добавить задачу
Создать `demos/<task>/…` и добавить объект задачи в `manifest.js`
(`id`, `title`, `tags`, `prompt`, `solutions`).

## Тесты
- `node demos/double-pendulum/opus-4.8/pendulum.test.js`
- `node assets/shell.test.js`
