window.TASKS = [
  {
    id: 'double-pendulum',
    title: 'Двойной маятник',
    tags: ['физика', 'canvas', 'хаос'],
    prompt: 'Отобрази в HTML5 физику двойного маятника: два стержня, два точечных груза на шарнирах, корректные уравнения движения и численное интегрирование, реальное время. Добавь затухающий след нижнего груза, управление пуском/паузой и сбросом, ползунки масс и длин, и режим «призрак» с крошечным отклонением начального угла для демонстрации чувствительности к начальным условиям (хаос).',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/double-pendulum/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/double-pendulum/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/double-pendulum/fable-5/' },
    ],
  },
  {
    id: 'svg-chess-knight',
    title: 'SVG шахматный конь',
    tags: ['геометрия', 'svg', 'иконка'],
    prompt: 'Нарисуй фигурку шахматного коня в SVG: чистый, узнаваемый, эстетичный векторный силуэт; аккуратные кривые Безье; без растровых вставок. Самодостаточный HTML с инлайн-SVG. Тёмный фон, фигура крупная, по центру, хорошо читается; уместны тонкие детали (грива, глаз, лёгкий объём через градиент/тень), но без китча.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/svg-chess-knight/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/svg-chess-knight/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/svg-chess-knight/fable-5/' },
    ],
  },
  {
    id: 'mandelbrot',
    title: 'Фрактал Мандельброта',
    tags: ['математика', 'пиксели', 'масштаб'],
    prompt: 'Отрисуй множество Мандельброта на HTML5 canvas с плавной (continuous/smooth) раскраской. Сделай интерактив: зум колесом мыши с центрированием на курсоре и панорамирование перетаскиванием, с пересчётом при изменении. Глубина итераций должна расти с увеличением зума. Красивая палитра. Покажи текущий зум/координаты.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/mandelbrot/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/mandelbrot/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/mandelbrot/fable-5/' },
    ],
  },
  {
    id: 'lorenz',
    title: 'Система Лоренца',
    tags: ['аттрактор', '3D', 'траектория'],
    prompt: 'Визуализируй аттрактор Лоренца: численное интегрирование классических уравнений (σ=10, ρ=28, β=8/3), 3D-траектория с медленным автоматическим вращением камеры и затухающим следом, на canvas, в реальном времени. Красивый градиент цвета вдоль траектории.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/lorenz/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/lorenz/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/lorenz/fable-5/' },
    ],
  },
  {
    id: 'boids',
    title: 'Стая boids',
    tags: ['эмерджентность', 'агенты', 'canvas'],
    prompt: 'Смоделируй стаю птиц (boids) на canvas: правила разделения, выравнивания и сцепления; не менее 400 агентов в реальном времени с плавным движением. Ползунки силы каждого из трёх правил, радиуса восприятия и максимальной скорости. Мир тороидальный (агенты переходят через края). Подсвети одного агента, его радиус восприятия и соседей, которых он видит.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/boids/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/boids/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/boids/fable-5/' },
    ],
  },
  {
    id: 'verlet-cloth',
    title: 'Ткань (верлет)',
    tags: ['физика', 'верлет', 'интерактив'],
    prompt: 'Симуляция ткани на верлет-интегрировании: сетка частиц со связями-констрейнтами, верхний край закреплён в нескольких точках, гравитация и лёгкий переменный ветер. Мышью можно схватить и тянуть ткань; при сильном растяжении связи рвутся. Кнопка сброса. Отрисовка сетки на canvas в реальном времени.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/verlet-cloth/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/verlet-cloth/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/verlet-cloth/fable-5/' },
    ],
  },
  {
    id: 'falling-sand',
    title: 'Падающий песок',
    tags: ['клеточный автомат', 'пиксели', 'интерактив'],
    prompt: 'Сделай «падающий песок» — клеточный автомат на canvas. Вещества: песок (сыплется, образует горки, тонет в воде), вода (падает и растекается), камень (неподвижен), дерево (горит), огонь (поджигает дерево, гаснет дымом), дым (поднимается и тает). Кисть мышью с выбором вещества и размера, пауза и очистка. Симуляция должна быть честной: без телепортаций и явной асимметрии влево/вправо.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/falling-sand/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/falling-sand/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/falling-sand/fable-5/' },
    ],
  },
  {
    id: 'raycaster-maze',
    title: 'Рейкастер-лабиринт',
    tags: ['псевдо-3D', 'алгоритмы', 'игра'],
    prompt: 'Псевдо-3D лабиринт в стиле Wolfenstein 3D на canvas, без библиотек: процедурно сгенерированный связный лабиринт, рейкастинг по сетке (DDA), корректная перспектива без эффекта «рыбьего глаза», стены с разной яркостью по стороне и затемнением по дальности, пол и потолок, мини-карта с положением игрока и сектором обзора. Управление: W/S — вперёд/назад, A/D — стрейф, стрелки ←/→ — поворот; коллизии со стенами со скольжением.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/raycaster-maze/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/raycaster-maze/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/raycaster-maze/fable-5/' },
    ],
  },
  {
    id: 'light-2d',
    title: '2D-свет и тени',
    tags: ['геометрия', 'свет', 'canvas'],
    prompt: 'Источник света в 2D, следующий за курсором, и набор многоугольников-препятствий. Построй геометрически точный полигон видимости: лучи к вершинам препятствий (с малыми угловыми смещениями), пересечения луч-отрезок, сортировка по углу. Освещённую область залей радиальным градиентом, добавь мягкое свечение вокруг источника. Чекбокс отладочного режима — показать лучи и вершины.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/light-2d/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/light-2d/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/light-2d/fable-5/' },
    ],
  },
  {
    id: 'procedural-walker',
    title: 'Идущий человечек',
    tags: ['анимация', 'кинематика', 'canvas'],
    prompt: 'Процедурная анимация идущего человечка (stick figure) на canvas без покадровых спрайтов: цикл походки с фазами опоры и переноса, сгиб коленей через обратную кинематику, движение рук в противофазе ногам, вертикальное покачивание и наклон корпуса. Земля движется, создавая иллюзию ходьбы; стопы в фазе опоры не должны скользить относительно земли. Ползунок скорости от медленной ходьбы до бега с плавной сменой характера походки.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/procedural-walker/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/procedural-walker/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/procedural-walker/fable-5/' },
    ],
  },
  {
    id: 'svg-bicycle',
    title: 'SVG велосипед',
    tags: ['геометрия', 'svg', 'устройство мира'],
    prompt: 'Нарисуй классический велосипед в SVG: технически правдоподобная конструкция — ромбовидная рама из двух замкнутых треугольников, рулевая труба с вилкой к оси переднего колеса, подседельная труба к каретке, цепь от ведущей звезды с шатунами и педалями к задней звёздочке на оси заднего колеса, спицы, седло, руль, тормоза. Самодостаточный HTML с инлайн-SVG, чистый векторный стиль, светлая фигура на тёмном фоне, без растровых вставок.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/svg-bicycle/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/svg-bicycle/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/svg-bicycle/fable-5/' },
    ],
  },
  {
    id: 'css-newspaper',
    title: 'Газетная полоса',
    tags: ['типографика', 'вёрстка', 'CSS'],
    prompt: 'Сверстай первую полосу газеты чистым HTML/CSS, без единой строки JavaScript: шапка с названием издания, датой и номером выпуска; главная статья с крупным заголовком, подзаголовком, лидом и буквицей; вёрстка в несколько колонок с выключкой по ширине и переносами; врезка с цитатой; фото-плейсхолдеры с подписями; линейки между материалами; колонтитул. Газетная типографика с серифными шрифтами, аккуратные интервалы. Русский язык, правдоподобные тексты.',
    solutions: [
      { model: 'Claude Opus 4.8', slug: 'opus-4.8', dir: 'demos/css-newspaper/opus-4.8/' },
      { model: 'GPT-5.5 Codex', slug: 'gpt-5.5-codex', dir: 'demos/css-newspaper/gpt-5.5-codex/' },
      { model: 'Claude Fable 5', slug: 'fable-5', dir: 'demos/css-newspaper/fable-5/' },
    ],
  },
];
