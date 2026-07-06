'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readTasks() {
  const manifestPath = path.resolve(__dirname, '..', 'manifest.js');
  const source = fs.readFileSync(manifestPath, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: manifestPath });
  return sandbox.window.TASKS;
}

const tasks = readTasks();
const ids = tasks.map((task) => task.id);

assert.equal(ids[0], 'svg-chess-knight');
assert.equal(ids[1], 'solar-system');
assert.equal(ids[Math.floor(ids.length / 2)], 'double-pendulum');

console.log('Manifest task order tests passed.');
