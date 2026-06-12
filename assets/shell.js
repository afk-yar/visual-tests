'use strict';
(function () {
  // Чистая маршрутизация. hash вида "#<taskId>" или "#<taskId>/<slug>".
  // Возвращает { task, solution } с дефолтами или null, если задач нет.
  function resolveActiveSelection(tasks, hash) {
    const raw = (hash || '').replace(/^#/, '');
    const slash = raw.indexOf('/');
    const taskId = slash === -1 ? raw : raw.slice(0, slash);
    const slug = slash === -1 ? '' : raw.slice(slash + 1);
    const task = tasks.find((t) => t.id === taskId) || tasks[0] || null;
    if (!task) return null;
    const solution = task.solutions.find((s) => s.slug === slug) || task.solutions[0] || null;
    return { task, solution };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveActiveSelection };
    return;
  }

  const tasks = (typeof window !== 'undefined' && window.TASKS) || [];
  const listEl = document.getElementById('task-list');
  const switchEl = document.getElementById('model-switch');
  const frameEl = document.getElementById('stage');
  const labelEl = document.getElementById('frame-label');
  const promptEl = document.getElementById('prompt-text');

  function render() {
    const sel = resolveActiveSelection(tasks, location.hash);

    listEl.innerHTML = '';
    for (const t of tasks) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'task-link' + (sel && t.id === sel.task.id ? ' active' : '');
      a.href = '#' + t.id;
      const name = document.createElement('span');
      name.className = 'task-name';
      name.textContent = t.title;
      const tags = document.createElement('span');
      tags.className = 'task-tags';
      tags.textContent = (t.tags || []).join(' · ');
      a.appendChild(name);
      a.appendChild(tags);
      li.appendChild(a);
      listEl.appendChild(li);
    }

    switchEl.innerHTML = '';
    if (!sel || !sel.solution) return;
    for (const s of sel.task.solutions) {
      const seg = document.createElement('a');
      const isActive = s.slug === sel.solution.slug;
      seg.className = 'segment' + (isActive ? ' active' : '');
      seg.href = '#' + sel.task.id + '/' + s.slug;
      seg.textContent = s.model;
      seg.setAttribute('role', 'tab');
      seg.setAttribute('aria-selected', isActive ? 'true' : 'false');
      switchEl.appendChild(seg);
    }
    frameEl.src = sel.solution.dir + 'index.html';
    labelEl.textContent = sel.solution.dir;
    promptEl.textContent = sel.task.prompt;
  }

  window.addEventListener('hashchange', render);
  render();
})();
