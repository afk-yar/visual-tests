'use strict';
const assert = require('node:assert');
const { resolveActiveSelection } = require('./shell.js');

const tasks = [
  { id: 'dp', solutions: [{ slug: 'opus' }, { slug: 'gpt5' }] },
  { id: 'knight', solutions: [{ slug: 'opus' }] },
];

let r = resolveActiveSelection(tasks, '');               // дефолт: 1-я задача, 1-е решение
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#dp/gpt5');           // явные задача+модель
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'gpt5');

r = resolveActiveSelection(tasks, '#knight');            // только задача → её 1-е решение
assert.equal(r.task.id, 'knight'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#dp/nope');           // неизвестная модель → 1-е решение задачи
assert.equal(r.task.id, 'dp'); assert.equal(r.solution.slug, 'opus');

r = resolveActiveSelection(tasks, '#zzz');               // неизвестная задача → 1-я задача
assert.equal(r.task.id, 'dp');

assert.equal(resolveActiveSelection([], '#x'), null);    // пустой реестр → null

console.log('Тесты маршрутизации оболочки пройдены.');
