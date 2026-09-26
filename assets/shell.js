'use strict';
(function () {
  // «Claude Opus 5.5» → { vendor: 'Claude', short: 'Opus 5.5' }; «GPT-5.6 Sol» → { vendor: 'GPT', short: '5.6 Sol' }.
  function splitModelName(name) {
    const m = /^([A-Za-z]+)[\s-]+(.+)$/.exec(name || '');
    return m ? { vendor: m[1], short: m[2] } : { vendor: name || '', short: name || '' };
  }

  // Группы вендоров для переключателя, сначала свежие. Свежесть = позиция в
  // manifest (решения дописываются в конец). Вендоры и семейства (первое слово
  // короткого имени: Opus, Sonnet, 5.6…) идут по самой свежей своей модели,
  // внутри семейства — от новой к старой.
  function groupSolutions(solutions) {
    const groups = [];
    const byVendor = new Map();
    solutions.forEach((solution, index) => {
      const { vendor, short } = splitModelName(solution.model || solution.slug);
      let g = byVendor.get(vendor);
      if (!g) {
        g = { vendor, items: [], fresh: index };
        byVendor.set(vendor, g);
        groups.push(g);
      }
      g.items.push({ solution, short, family: short.split(' ')[0], index });
      g.fresh = index;
    });
    for (const g of groups) {
      const familyFresh = new Map();
      for (const it of g.items) familyFresh.set(it.family, it.index);
      g.items.sort((a, b) => familyFresh.get(b.family) - familyFresh.get(a.family) || b.index - a.index);
    }
    groups.sort((a, b) => b.fresh - a.fresh);
    return groups.map((g) => ({
      vendor: g.vendor,
      items: g.items.map((it) => ({ solution: it.solution, short: it.short })),
    }));
  }

  // Чистая маршрутизация. hash вида "#<taskId>" или "#<taskId>/<slug>".
  // Возвращает { task, solution } с дефолтами или null, если задач нет.
  // Без модели в hash выбирается первая в переключателе — самая свежая.
  function resolveActiveSelection(tasks, hash) {
    const raw = (hash || '').replace(/^#/, '');
    const slash = raw.indexOf('/');
    const taskId = slash === -1 ? raw : raw.slice(0, slash);
    const slug = slash === -1 ? '' : raw.slice(slash + 1);
    const task = tasks.find((t) => t.id === taskId) || tasks[0] || null;
    if (!task) return null;
    const freshest = groupSolutions(task.solutions).map((g) => g.items[0].solution)[0] || null;
    const picked = slug ? task.solutions.find((s) => s.slug === slug) : null;
    return { task, solution: picked || freshest, explicit: !!picked };
  }

  // Ссылка на задачу из сайдбара: несёт выбранную пользователем модель, если она у задачи есть.
  function taskHref(task, preferredSlug) {
    const has = preferredSlug && task.solutions.some((s) => s.slug === preferredSlug);
    return '#' + task.id + (has ? '/' + preferredSlug : '');
  }

  // Служебные страницы оболочки (не задачи): hash "#<id>" → файл в iframe.
  const PAGES = { compare: 'compare.html' };

  function pageRoute(hash) {
    const id = (hash || '').replace(/^#/, '').split('/')[0];
    return Object.prototype.hasOwnProperty.call(PAGES, id) ? id : '';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveActiveSelection, splitModelName, groupSolutions, taskHref, pageRoute };
    return;
  }

  const tasks = (typeof window !== 'undefined' && window.TASKS) || [];
  const listEl = document.getElementById('task-list');
  const switchEl = document.getElementById('model-switch');
  const frameEl = document.getElementById('stage');
  const labelEl = document.getElementById('frame-label');
  const promptEl = document.getElementById('prompt-text');
  const promptBoxEl = document.getElementById('prompt-box');
  const toolbarEl = document.querySelector('.model-toolbar');
  const compareLink = document.getElementById('compare-link');

  // Модель, которую пользователь выбрал явно; переживает переход на задачу, где её нет.
  let preferredSlug = '';

  function render() {
    const page = pageRoute(location.hash);
    const sel = page ? null : resolveActiveSelection(tasks, location.hash);
    if (sel && sel.explicit) preferredSlug = sel.solution.slug;
    if (compareLink) compareLink.classList.toggle('active', page === 'compare');
    toolbarEl.hidden = !!page;
    promptBoxEl.hidden = !!page;

    listEl.innerHTML = '';
    for (const t of tasks) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'task-link' + (sel && t.id === sel.task.id ? ' active' : '');
      a.href = taskHref(t, preferredSlug);
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
    if (page) {
      frameEl.src = PAGES[page];
      labelEl.textContent = PAGES[page];
      return;
    }
    if (!sel || !sel.solution) return;
    for (const g of groupSolutions(sel.task.solutions)) {
      const group = document.createElement('div');
      group.className = 'model-group';
      const vendor = document.createElement('span');
      vendor.className = 'model-vendor';
      vendor.textContent = g.vendor;
      const segs = document.createElement('div');
      segs.className = 'segments';
      for (const { solution: s, short } of g.items) {
        const seg = document.createElement('a');
        const isActive = s.slug === sel.solution.slug;
        seg.className = 'segment' + (isActive ? ' active' : '');
        seg.href = '#' + sel.task.id + '/' + s.slug;
        seg.textContent = short;
        seg.title = s.model;
        seg.setAttribute('role', 'tab');
        seg.setAttribute('aria-selected', isActive ? 'true' : 'false');
        segs.appendChild(seg);
      }
      group.appendChild(vendor);
      group.appendChild(segs);
      switchEl.appendChild(group);
    }
    frameEl.src = sel.solution.dir + 'index.html';
    labelEl.textContent = sel.solution.dir;
    promptEl.textContent = sel.task.prompt;
  }

  window.addEventListener('hashchange', render);
  render();
})();
