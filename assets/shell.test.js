'use strict';
const assert = require('node:assert');
const { resolveActiveSelection, splitModelName, groupSolutions, taskHref, pageRoute } = require('./shell.js');

const tasks = [
  { id: 'dp', solutions: [{ slug: 'opus' }, { slug: 'gpt5' }] },
  { id: 'knight', solutions: [{ slug: 'opus' }] },
];

let r = resolveActiveSelection(tasks, '');               // дефолт: 1-я задача, самое свежее решение
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'gpt5');

r = resolveActiveSelection(tasks, '#dp/opus');           // явные задача+модель
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#knight');            // только задача → её самое свежее решение
assert.equal(r.task.id, 'knight'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#dp/nope');           // неизвестная модель → самое свежее решение задачи
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'gpt5');

r = resolveActiveSelection(tasks, '#zzz');               // неизвестная задача → 1-я задача
assert.equal(r.task.id, 'dp');

assert.equal(resolveActiveSelection([], '#x'), null);    // пустой реестр → null

// explicit: модель пришла из hash и нашлась у задачи — её запоминаем как выбор пользователя.
assert.equal(resolveActiveSelection(tasks, '#dp/opus').explicit, true);
assert.equal(resolveActiveSelection(tasks, '#dp').explicit, false);
assert.equal(resolveActiveSelection(tasks, '#dp/nope').explicit, false);

// Ссылка на задачу несёт выбранную модель, если она у задачи есть.
assert.equal(taskHref(tasks[0], 'gpt5'), '#dp/gpt5');
assert.equal(taskHref(tasks[1], 'gpt5'), '#knight');     // у задачи нет модели → самая свежая
assert.equal(taskHref(tasks[1], ''), '#knight');

// Служебная страница сравнения — не задача.
assert.equal(pageRoute('#compare'), 'compare');
assert.equal(pageRoute('#compare/opus-5'), 'compare');
assert.equal(pageRoute('#dp/opus'), '');
assert.equal(pageRoute(''), '');
assert.equal(pageRoute('#constructor'), '');              // не ловит унаследованные свойства объекта

// Вендор выносится в подпись группы, в кнопке остаётся короткое имя.
assert.deepEqual(splitModelName('Claude Opus 5.5'), { vendor: 'Claude', short: 'Opus 5.5' });
assert.deepEqual(splitModelName('GPT-5.6 Sol'), { vendor: 'GPT', short: '5.6 Sol' });
assert.deepEqual(splitModelName('Kimi K3'), { vendor: 'Kimi', short: 'K3' });
assert.deepEqual(splitModelName('Solo'), { vendor: 'Solo', short: 'Solo' });

// Порядок в manifest хронологический (решения дописываются в конец).
// Сначала свежие: вендоры и семейства — по самой свежей модели, внутри семейства — от новой к старой.
const solutions = [
  'Claude Opus 4.8', 'GPT-5.5 Codex', 'Claude Fable 5', 'Claude Sonnet 5',
  'GPT-5.6 Sol', 'GPT-5.6 Luna', 'Kimi K3', 'Claude Opus 5', 'Claude Opus 5.5',
].map((model) => ({ model }));
const groups = groupSolutions(solutions);
assert.deepEqual(groups.map((g) => g.vendor), ['Claude', 'Kimi', 'GPT']);
assert.deepEqual(groups[0].items.map((it) => it.short), ['Opus 5.5', 'Opus 5', 'Opus 4.8', 'Sonnet 5', 'Fable 5']);
assert.deepEqual(groups[2].items.map((it) => it.short), ['5.6 Luna', '5.6 Sol', '5.5 Codex']);
assert.equal(groups[0].items[0].solution, solutions[8]);  // в группе лежат исходные объекты решений

console.log('Тесты маршрутизации оболочки пройдены.');
