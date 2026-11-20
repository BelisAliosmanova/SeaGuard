(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const LEVEL = {LOW: ['risk-low', 'Ниско', 'var(--marker-low)'], MODERATE: ['risk-moderate', 'Умерено', 'var(--marker-elevated)'], HIGH: ['risk-high', 'Високо', 'var(--marker-high)'], UNKNOWN: ['risk-unknown', 'Няма данни', 'var(--risk-none)']};
  const PRIORITY = {'Спешно': 'p-urgent', 'Висок': 'p-high', 'Среден': 'p-mid', 'Рутинно': 'p-routine'};
  const FRESH = {live: 'На живо', recent: 'Актуални', old: 'Стари', missing: 'Няма'};
  const workspace = $('workspace');
  const provider = workspace.dataset.provider || 'rules';
  const footage = window.setupFootage?.($('footage').dataset.endpoint, {onResult: includeFootage, onTask: addFootageTask});
  let meadowMap, meadowOutline, meadowBounds, selection;
  const archive = typeof L === 'undefined' ? Promise.resolve(null) :
    fetch(workspace.dataset.archiveUrl).then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).catch(() => null);
  let sites = [], current = null, trendMetric = 'lightAtDepth', history = [], picker, lastFootage;

  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const fmt = (v, d = 1) => v == null ? '—' : Number(v).toLocaleString('bg-BG', {minimumFractionDigits: d, maximumFractionDigits: d});

  async function init() {
    try {
      const response = await fetch(workspace.dataset.locationsUrl);
      if (!response.ok) throw new Error();
      sites = await response.json();
      if (!sites.length) throw new Error();
      $('eco-picker-status').remove();
      picker = SitePicker.create($('picker'), {sites, onSelect: select, label: 'Избран участък'});
      const wanted = Number(new URLSearchParams(location.search).get('site'));
      select(sites.some(s => s.id === wanted) ? wanted : sites[0].id);
      fetch(workspace.dataset.sitesUrl)
        .then(response => {
          if (!response.ok) throw new Error();
          return response.json();
        })
        .then(data => {
          if (!data.sites?.length) return;
          sites = data.sites;
          picker.updateSites(sites);
        })
        .catch(() => {});
    } catch {
      const message = 'Участъците не се заредиха. Презареди страницата, за да опиташ отново.';
      footage?.showUnavailable(message);
      $('verdict-headline').textContent = message;
      $('meadow-map-status').textContent = message;
      $('trend-status').textContent = message;
      const pickerStatus = $('eco-picker-status');
      if (pickerStatus) pickerStatus.textContent = message;
    }
  }

  async function select(id) {
    const site = sites.find(item => item.id === id);
    if (!site) return;
    selection = id;
    picker.set(id);
    if (lastFootage?.siteId !== id) lastFootage = null;
    footage?.selectSite(id, site.name);
    renderMeadowMap(id).catch(() => {
      if (selection !== id) return;
      const status = $('meadow-map-status');
      $('meadow-map-shell').hidden = true;
      status.hidden = false;
      status.textContent = 'Картата не се зареди. Презареди страницата или избери друг участък.';
    });
    $('map-link').href = '/dashboard?site=' + id;
    const url = new URL(location.href);
    url.searchParams.set('site', id);
    window.history.replaceState(null, '', url);
    current = null;
    resetChat(site.name);
    $('verdict-headline').textContent = 'Зареждаме оценката…';
    $('meadow-map-title').textContent = site.name;
    renderTrend();
    $('tasks').replaceChildren(el('li', 'Зареждаме задачите…', 'empty'));
    try {
      const response = await fetch('/api/ecologist/assessment/' + id);
      if (!response.ok) throw new Error();
      const assessment = await response.json();
      if (selection !== id) return;
      current = assessment;
      renderVerdict(); renderFreshness(); renderThreats(); renderCauses(); renderActions(); renderGaps(); renderEvidence(); renderTrend();
      welcome();
      loadTasks();
    } catch {
      if (selection !== id) return;
      $('verdict-headline').textContent = 'Оценката не се зареди. Избери участъка отново.';
      $('trend-status').textContent = 'Данните за диаграмата не се заредиха. Избери участъка отново.';
      $('tasks').replaceChildren(el('li', 'Избери участъка отново, за да видиш задачите.', 'empty'));
    }
  }

  function fitMeadow(map) {
    map.fitBounds(meadowBounds, {padding: [42, 36], maxZoom: 18, animate: false});
  }

  async function renderMeadowMap(id) {
    const status = $('meadow-map-status');
    const shell = $('meadow-map-shell');
    const data = await archive;
    if (selection !== id) return;
    const feature = data?.features?.find(item => Number(item.id) === id);
    if (!feature) {
      if (meadowMap) meadowMap.removeLayer(meadowOutline);
      shell.hidden = true;
      status.hidden = false;
      status.textContent = typeof L === 'undefined' ?
        'Картата е недостъпна. Провери интернет връзката и презареди страницата.' :
        'Границата не се зареди. Презареди страницата или избери друг участък.';
      return;
    }
    const outlineColor = getComputedStyle(shell).getPropertyValue('--map-outline').trim();
    const outline = L.geoJSON(feature, {style: {color: outlineColor, weight: 3, fillOpacity: .22}});
    meadowBounds = outline.getBounds();
    shell.hidden = false;
    status.hidden = true;
    if (!meadowMap) {
      ({map: meadowMap} = SeaMap.create('meadow-map', {
        base: 'satellite', bounds: meadowBounds, resetLabel: 'Покажи границата на ливадата', onReset: fitMeadow
      }));
    } else {
      meadowMap.removeLayer(meadowOutline);
    }
    meadowOutline = outline.addTo(meadowMap);
    fitMeadow(meadowMap);
  }

  function renderVerdict() {
    const a = current, s = a.site;
    $('verdict-status').className = 'badge risk-' + a.statusKey;
    $('verdict-status').textContent = a.status;
    $('verdict-meta').textContent = [s.areaHa != null ? fmt(s.areaHa) + ' ха' : null, s.depthLimitM != null ? 'до ' + fmt(s.depthLimitM, 0) + ' m дълбочина' : null].filter(Boolean).join(', ');
    $('verdict-headline').textContent = a.headline + '.';
    $('risk-score').textContent = a.riskScore;
    $('risk-bar').style.width = (100 - a.riskScore) + '%';
    $('confidence').textContent = a.confidence;
    $('confidence-bar').style.width = (100 - a.confidence) + '%';
    DepthProfile.draw($('depth-profile'), $('profile-caption'), a.optics);
  }

  function renderFreshness() {
    $('freshness').replaceChildren(...current.freshness.map(f => {
      const d = el('div', null, 'fresh-item');
      d.append(el('span', FRESH[f.status], 'fresh-tag ' + f.status), el('strong', f.source), el('span', f.status === 'missing' ? f.what : `${f.age}${f.date ? ' (' + f.date + ')' : ''}`));
      d.title = f.what;
      return d;
    }));
  }

  function renderThreats() {
    const box = $('threats');
    box.replaceChildren();
    for (const i of current.indicators) {
      const d = el('details', null, 'threat');
      const sum = el('summary');
      const dot = el('i', null, 'threat-dot');
      dot.style.background = LEVEL[i.level][2];
      const text = el('span', null, 'threat-text');
      text.append(el('strong', i.label), el('span', i.value));
      sum.append(dot, text, el('span', LEVEL[i.level][1], 'badge ' + LEVEL[i.level][0]));
      const body = el('div', null, 'threat-body');
      body.append(el('p', i.explanation), el('p', 'Праг: ' + i.threshold, 'meta'), el('p', 'Източник: ' + i.source, 'meta'));
      d.append(sum, body);
      box.append(d);
    }
  }

  function renderCauses() {
    $('causes').replaceChildren(...current.causes.map(c => {
      const li = el('li');
      const top = el('div', null, 'cause-top');
      top.append(el('strong', c.title), el('span', c.confidence + ' %'));
      const bar = el('div', null, 'cause-bar');
      const fill = el('i');
      fill.style.width = c.confidence + '%';
      bar.append(fill);
      li.append(top, bar, el('p', c.reasoning));
      return li;
    }));
  }

  function renderActions() {
    $('actions').replaceChildren(...current.actions.map(a => {
      const li = el('li');
      const top = el('div', null, 'action-top');
      top.append(el('strong', a.title), el('span', a.priority, 'priority ' + (PRIORITY[a.priority] || 'p-mid')));
      const add = el('button', '+ В плана за терена', 'link-btn');
      add.type = 'button';
      add.addEventListener('click', async () => {
        add.disabled = true;
        const saved = await addTask({title: a.title, priority: a.priority, reason: a.why, origin: 'user'});
        add.textContent = saved ? '✓ Добавено' : 'Опитай да добавиш отново';
        add.disabled = saved;
      });
      li.title = 'Как ще разберем: ' + a.verify;
      li.append(top, el('p', a.why, 'why'), add);
      return li;
    }));
  }

  function renderGaps() { $('gaps').replaceChildren(...current.dataGaps.map(g => el('li', g))); }

  function renderEvidence() {
    $('evidence').replaceChildren(...current.evidence.map(e => {
      const li = el('li');
      const a = el('a', e.source);
      a.href = e.link;
      if (e.link.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      li.append(a, el('span', e.detail), el('span', e.date));
      return li;
    }));
  }

  const TREND = {
    lightAtDepth: {label: 'светлина до дъното', unit: '%', digits: 0, zones: [[20, 100, 'good'], [11, 20, 'mid'], [0, 11, 'bad']], higherIsBetter: true},
    turbidity: {label: 'мътност', unit: 'FNU', digits: 1, zones: [[0, 2, 'good'], [2, 5, 'mid'], [5, 99, 'bad']]},
    chlorophyll: {label: 'хлорофил-а', unit: 'mg/m³', digits: 1, zones: [[0, 3, 'good'], [3, 6, 'mid'], [6, 99, 'bad']]}
  };
  const ZONE_COLOR = {good: '#34c759', mid: '#ff9500', bad: '#ff3b30'};
  const ZONE_TEXT = {good: '#1e8a3c', mid: '#b45309', bad: '#d1242f'};
  const ZONE_WORD = {good: 'в норма', mid: 'внимание', bad: 'критично'};
  const MONTH_NAMES = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
  const MONTH_SHORT = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
  let trendChart = null;
  const zoneOf = (cfg, v) => cfg.zones.find(([lo, hi]) => v >= lo && v < hi)?.[2] || cfg.zones[cfg.zones.length - 1][2];

  function renderTrend() {
    const status = $('trend-status'), body = $('trend-body'), canvas = $('trend');
    const points = current?.trend || [];
    const values = points.map(p => Number.isFinite(p[trendMetric]) ? p[trendMetric] : null);
    const latest = values.findLastIndex(v => v != null);
    body.hidden = typeof Chart === 'undefined' || latest === -1;
    status.hidden = !body.hidden;
    if (body.hidden) {
      status.textContent = !current ? 'Зареждаме месечните данни…' : latest === -1 ? 'Няма месечни стойности за този показател.' : 'Графиката изисква интернет връзка.';
      $('trend-value').textContent = '—'; $('trend-detail').textContent = ''; $('wc-sub').textContent = '';
      return;
    }
    const cfg = TREND[trendMetric];
    const last = values[latest];
    const known = values.filter(v => v != null);
    // Same season value the risk assessment uses, so the numbers on the page agree.
    const avg = known.reduce((a, b) => a + b, 0) / known.length;
    const o = current.optics || {};
    const mean = trendMetric === 'lightAtDepth' && o.lightPct != null ? o.lightPct : trendMetric === 'turbidity' && o.turbidityFnu != null ? o.turbidityFnu : avg;
    const zone = zoneOf(cfg, last);
    $('trend-value').textContent = fmt(last, cfg.digits);
    $('trend-value').style.color = ZONE_TEXT[zone];
    $('trend-detail').textContent = ` ${cfg.unit} ${cfg.label} през ${MONTH_NAMES[Number(points[latest].month.slice(5, 7)) - 1]}`;
    $('wc-sub').replaceChildren();
    const tag = el('span', ZONE_WORD[zone], 'wc-tag ' + zone);
    $('wc-sub').append(tag, document.createTextNode(` Средно за сезона ${fmt(mean, cfg.digits)} ${cfg.unit}. Оценката на риска ползва средното.`));
    if (trendChart) trendChart.destroy();
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, '#0a6cf133'); grad.addColorStop(1, '#0a6cf100');
    const maxVal = Math.max(...known);
    trendChart = new Chart(ctx, {
      type: 'line',
      data: {labels: points.map(p => MONTH_SHORT[Number(p.month.slice(5, 7)) - 1]), datasets: [
        {data: values, borderColor: '#0a6cf1', backgroundColor: grad, fill: true, borderWidth: 3, tension: .38,
          pointRadius: values.map((_, i) => i === latest ? 6 : 3.5), pointBackgroundColor: values.map(v => v == null ? '#fff' : ZONE_COLOR[zoneOf(cfg, v)]),
          pointBorderColor: '#fff', pointBorderWidth: 2},
        {data: values.map(() => mean), borderColor: '#9aa3b0', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0}
      ]},
      options: {responsive: true, maintainAspectRatio: false, interaction: {mode: 'index', intersect: false},
        plugins: {legend: {display: false}, tooltip: {filter: i => i.datasetIndex === 0, callbacks: {label: c => `${fmt(c.parsed.y, cfg.digits)} ${cfg.unit}`}}},
        scales: {x: {grid: {display: false}}, y: {beginAtZero: true, suggestedMax: Math.ceil(maxVal * 1.2), grid: {color: '#00000008'}}}},
      plugins: [{id: 'zones', beforeDatasetsDraw(c) {
        const {ctx: g, chartArea: a, scales: {y}} = c;
        g.save();
        for (const [lo, hi, key] of cfg.zones) {
          const top = Math.max(y.getPixelForValue(Math.min(hi, y.max)), a.top), bottom = Math.min(y.getPixelForValue(Math.max(lo, y.min)), a.bottom);
          if (bottom <= top) continue;
          g.fillStyle = ZONE_COLOR[key] + '14';
          g.fillRect(a.left, top, a.right - a.left, bottom - top);
        }
        g.restore();
      }}]
    });
  }

  // ---------------------------------------------------------------- field tasks
  async function addTask(task, site = current?.site.id) {
    if (site == null || selection !== site) return false;
    try {
      const response = await fetch('/api/tasks', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({siteId: site, ...task})});
      if (response.ok && current?.site.id === site) loadTasks();
      return response.ok;
    } catch {
      return false;
    }
  }

  async function loadTasks() {
    const site = current.site.id;
    let tasks;
    try {
      const response = await fetch('/api/tasks?siteId=' + site);
      if (!response.ok) throw new Error();
      tasks = await response.json();
    } catch {
      if (current?.site.id === site) {
        $('tasks').replaceChildren(el('li', 'Задачите не се заредиха. Избери участъка отново.', 'empty'));
      }
      return;
    }
    if (current?.site.id !== site) return;
    $('tasks-count').textContent = tasks.filter(t => !t.done).length + ' отворени';
    const list = $('tasks');
    list.replaceChildren();
    if (!tasks.length) { list.append(el('li', 'Няма задачи. Добави стъпка от плана или потвърди предложение на AI еколога.', 'empty')); return; }
    for (const t of tasks) {
      const li = el('li', null, 'task' + (t.done ? ' is-done' : ''));
      const box = el('input');
      box.type = 'checkbox';
      box.checked = t.done;
      box.setAttribute('aria-label', 'Изпълнена');
      async function updateTask(method, body) {
        box.disabled = del.disabled = true;
        notice.textContent = '';
        try {
          const response = await fetch('/api/tasks/' + t.id, {
            method, body, headers: body ? {'Content-Type': 'application/json'} : undefined
          });
          if (!response.ok) throw new Error();
          if (current?.site.id === site) loadTasks();
        } catch {
          box.checked = t.done;
          notice.textContent = 'Промяната не се запази. Опитай отново.';
        } finally {
          box.disabled = del.disabled = false;
        }
      }
      box.addEventListener('change', () => updateTask('PATCH', JSON.stringify({done: box.checked})));
      const text = el('div', null, 'task-text');
      text.append(el('strong', t.title));
      const meta = el('span', `${t.priority || 'Среден'} · ${t.origin === 'ai' ? 'предложено от AI' : 'добавено ръчно'} · ${new Date(t.createdAt).toLocaleDateString('bg-BG', {day: 'numeric', month: 'short'})}`);
      const notice = el('span');
      notice.setAttribute('role', 'status');
      text.append(meta, notice);
      const del = el('button', '×', 'task-del');
      del.type = 'button';
      del.setAttribute('aria-label', 'Изтрий задачата');
      del.addEventListener('click', () => updateTask('DELETE'));
      li.append(box, text, del);
      list.append(li);
    }
  }

  // ---------------------------------------------------------------- AI copilot
  const modeLabel = m => m === 'claude' ? 'Claude' : m === 'gemini' ? 'Gemini' : 'Експертна система';
  const ACTION_META = {
    add_task: {icon: '#i-check', yes: 'Добави в плана', done: 'Добавено в плана за терена'},
    open_site: {icon: '#i-target', yes: 'Отвори'},
    show_map: {icon: '#i-map', yes: 'Покажи на картата'},
    new_measurement: {icon: '#i-plus', yes: 'Попълни измерване'},
    show_trend: {icon: '#i-chart', yes: 'Покажи графиката'}
  };
  const REPORT_CHIP = 'Напиши доклад';
  let asked = new Set(), busy = false;

  function icon(href) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', href);
    svg.append(use);
    return svg;
  }

  const chatEl = () => $('chat');
  function scrollChat() { const c = chatEl(); c.scrollTo({top: c.scrollHeight, behavior: 'smooth'}); }

  function bubble(role, content) {
    const row = el('div', null, 'cp-row ' + role);
    if (role.startsWith('assistant')) {
      const av = el('span', null, 'cp-mini-avatar');
      av.append(icon('#i-spark'));
      row.append(av);
    }
    const b = el('div', null, 'cp-bubble');
    if (typeof content === 'string') b.append(el('p', content)); else if (content) b.append(content);
    row.append(b);
    chatEl().append(row);
    scrollChat();
    return b;
  }

  function typing() {
    const b = bubble('assistant', null);
    b.classList.add('is-typing');
    const dots = el('div', null, 'cp-dots');
    dots.append(el('i'), el('i'), el('i'));
    const step = el('span', 'Чета данните…', 'cp-step');
    b.append(dots, step);
    const steps = ['Проверявам показателите…', 'Сравнявам с праговете…', 'Сравнявам с другите участъци…', 'Пиша отговора…'];
    let i = 0;
    const timer = setInterval(() => { step.textContent = steps[Math.min(i++, steps.length - 1)]; }, 1400);
    b.stop = () => clearInterval(timer);
    return b;
  }

  /** Reveal text word by word so the answer feels alive, without delaying long answers. */
  function reveal(p, text) {
    const words = text.split(/(\s+)/);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || words.length > 400) { p.textContent = text; return Promise.resolve(); }
    let i = 0;
    const per = Math.max(1, Math.ceil(words.length / 45));
    return new Promise(done => {
      const t = setInterval(() => {
        p.textContent = words.slice(0, i += per).join('');
        scrollChat();
        if (i >= words.length) { clearInterval(t); done(); }
      }, 22);
    });
  }

  function chips(list) {
    const box = $('suggestions');
    box.replaceChildren();
    for (const text of list) {
      const b = el('button', null, 'cp-chip' + (text === REPORT_CHIP ? ' is-report' : ''));
      b.type = 'button';
      if (text === REPORT_CHIP) b.append(icon('#i-download'));
      b.append(document.createTextNode(text));
      b.addEventListener('click', () => text === REPORT_CHIP ? writeReport() : ask(text));
      box.append(b);
    }
  }

  function suggestedQuestions() {
    if (!current) return [];
    const lvl = k => current.indicators.find(i => i.key === k)?.level;
    const bad = l => l === 'HIGH' || l === 'MODERATE';
    const qs = [];
    if (bad(lvl('light')) || bad(lvl('trend'))) qs.push('Защо водата е мътна тук?');
    if (bad(lvl('eutrophication'))) qs.push('Откъде идват хранителните вещества?');
    if (bad(lvl('heat')) || bad(lvl('anomaly'))) qs.push('Има ли опасност от гореща вълна?');
    qs.push('Какво да направим първо?', 'Можем ли да засаждаме тук?', 'Ще помогне ли забрана за котвене?', 'С кой участък да сравня?');
    return [...qs.filter(x => !asked.has(x)).slice(0, 3), REPORT_CHIP];
  }

  function addFootageTask(siteId, nextStep) {
    return addTask({title: 'Провери подводните кадри на участъка', priority: 'Рутинно',
      reason: nextStep, origin: 'ai'}, siteId);
  }

  function showFootageInChat(data) {
    chatEl().querySelector('.cp-footage-result')?.remove();
    const box = el('div', null, 'cp-footage-result-body');
    box.append(el('strong', 'Анализ на подводни кадри'), el('p', data.summary),
      el('p', 'Следваща теренна стъпка: ' + data.nextStep));
    const details = el('a', 'Виж наблюденията по кадри');
    details.href = '#analysis-title';
    box.append(details);
    bubble('assistant', box).closest('.cp-row').classList.add('cp-footage-result');
  }

  function includeFootage(siteId, data) {
    if (selection !== siteId) return;
    lastFootage = data ? {siteId, data} : null;
    if (data) showFootageInChat(data);
    else chatEl().querySelector('.cp-footage-result')?.remove();
  }

  function resetChat(name) {
    chatEl().replaceChildren();
    history = [];
    asked = new Set();
    $('suggestions').replaceChildren();
    bubble('assistant', `Зареждам данните за ${name}…`).classList.add('is-muted');
  }

  function welcome() {
    chatEl().replaceChildren();
    const a = current;
    const top = a.indicators.filter(i => i.level === 'HIGH' || i.level === 'MODERATE')
      .sort((x, y) => (y.level === 'HIGH') - (x.level === 'HIGH')).slice(0, 3);
    const box = el('div');
    box.append(el('p', `Разгледах ${a.site.name}. ${a.status}, риск ${a.riskScore}/100.`));
    if (top.length) {
      box.append(el('p', 'Какво виждам:', 'cp-sub'));
      const ul = el('ul', null, 'cp-findings');
      for (const i of top) {
        const li = el('li');
        const d = el('i');
        d.style.background = LEVEL[i.level][2];
        li.append(d, el('strong', i.label), el('span', i.value));
        ul.append(li);
      }
      box.append(ul);
    } else box.append(el('p', 'Не виждам силни рискови сигнали в данните.'));
    box.append(el('p', 'Какво искаш да разбереш?', 'cp-sub'));
    bubble('assistant', box);
    if (lastFootage?.siteId === a.site.id) showFootageInChat(lastFootage.data);
    chips(suggestedQuestions());
  }

  function actionCard(a) {
    const meta = ACTION_META[a.type];
    const card = el('div', null, 'cp-action');
    const head = el('div', null, 'cp-action-head');
    head.append(icon(meta.icon));
    const txt = el('div');
    const target = a.type === 'open_site' ? sites.find(s => s.id === a.siteId) : null;
    txt.append(el('strong', a.label + (target ? ` · ${target.name}` : '')));
    if (a.reason) txt.append(el('span', a.reason));
    head.append(txt);
    const row = el('div', null, 'cp-action-row');
    const yes = el('button', meta.yes, 'button primary small');
    const no = el('button', 'Не сега', 'button ghost small');
    yes.type = no.type = 'button';
    no.addEventListener('click', () => { card.classList.add('is-dismissed'); row.replaceChildren(el('span', 'Пропуснато', 'cp-action-note')); });
    yes.addEventListener('click', async () => {
      if (a.type === 'add_task') {
        yes.disabled = true;
        const ok = await addTask({title: a.label, priority: a.priority, reason: a.reason, origin: 'ai'});
        row.replaceChildren(el('span', ok ? '✓ ' + meta.done : 'Неуспешно добавяне', ok ? 'cp-action-done' : 'cp-action-note'));
        card.classList.add('is-confirmed');
      } else if (a.type === 'open_site') select(a.siteId);
      else if (a.type === 'show_map') location.href = '/dashboard?site=' + a.siteId;
      else if (a.type === 'new_measurement') location.href = '/measurements/new?site=' + a.siteId;
      else if (a.type === 'show_trend') {
        document.querySelector(`#trend-switch [data-metric="${a.metric}"]`)?.click();
        $('trend-title').scrollIntoView({behavior: 'smooth', block: 'center'});
      }
    });
    row.append(yes, no);
    card.append(head, row);
    return card;
  }

  async function ask(question) {
    question = question.trim();
    if (!current || !question || busy) return;
    busy = true;
    asked.add(question);
    const assessment = current;
    $('suggestions').replaceChildren();
    bubble('user', question);
    $('question').value = '';
    autosize();
    const pending = typing();
    try {
      const r = await fetch('/api/ecologist/ask', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({siteId: assessment.site.id, question, history})});
      if (!r.ok) throw new Error();
      const ans = await r.json();
      if (current !== assessment) return;
      pending.stop();
      pending.classList.remove('is-typing');
      pending.replaceChildren();
      const p = el('p');
      pending.append(p);
      await reveal(p, ans.text);
      if (ans.used?.length) {
        const used = el('div', null, 'cp-used');
        for (const key of ans.used) {
          const ind = assessment.indicators.find(i => i.key === key);
          if (!ind) continue;
          const chip = el('span', ind.label, 'cp-used-chip');
          const dot = el('i');
          dot.style.background = LEVEL[ind.level][2];
          chip.prepend(dot);
          chip.title = ind.value;
          used.append(chip);
        }
        pending.append(used);
      }
      pending.append(el('small', modeLabel(ans.mode), 'cp-by'));
      for (const a of ans.actions || []) bubble('assistant action', actionCard(a));
      history.push({role: 'user', text: question}, {role: 'assistant', text: ans.text});
    } catch {
      pending.stop?.();
      pending.classList.remove('is-typing');
      pending.replaceChildren(el('p', 'Не получих отговор. Опитай отново.'));
    } finally {
      busy = false;
      if (current === assessment) chips(suggestedQuestions());
      scrollChat();
    }
  }

  async function writeReport() {
    if (!current || busy) return;
    busy = true;
    const assessment = current;
    $('suggestions').replaceChildren();
    bubble('user', REPORT_CHIP);
    const pending = typing();
    try {
      const r = await fetch('/api/ecologist/report/' + assessment.site.id, {method: 'POST'});
      if (!r.ok) throw new Error();
      const rep = await r.json();
      if (current !== assessment) return;
      pending.stop();
      pending.classList.remove('is-typing');
      pending.classList.add('is-report');
      pending.replaceChildren();
      const head = el('div', null, 'cp-report-head');
      head.append(icon('#i-download'), el('strong', 'Доклад: ' + assessment.site.name));
      pending.append(head, el('h4', rep.headline));
      const sum = el('p');
      pending.append(sum);
      await reveal(sum, rep.summary);
      const det = el('details', null, 'cp-report-more');
      det.append(el('summary', `Находки (${rep.findings.length}) и план (${rep.plan.length})`));
      const ul = el('ul');
      rep.findings.forEach(f => ul.append(el('li', `${f.title}: ${f.explanation}`)));
      const ol = el('ol');
      rep.plan.forEach(s => ol.append(el('li', `${s.action} (${s.priority})`)));
      det.append(el('h5', 'Находки'), ul, el('h5', 'План'), ol);
      pending.append(det);
      const copy = el('button', 'Копирай доклада', 'button secondary small');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        const text = [`${assessment.site.name}: ${rep.headline}`, '', rep.summary, '', 'Находки:', ...rep.findings.map(f => `- ${f.title}: ${f.explanation}`),
          '', 'План:', ...rep.plan.map((s, i) => `${i + 1}. ${s.action} [${s.priority}] ${s.rationale} Показател: ${s.successMetric}`),
          '', 'Неизвестни:', ...(rep.unknowns || []).map(u => `- ${u}`), '', rep.caveat || ''].join('\n');
        try { await navigator.clipboard.writeText(text); copy.textContent = '✓ Копирано'; } catch { copy.textContent = 'Копирането не е разрешено'; }
      });
      pending.append(copy, el('small', modeLabel(rep.mode), 'cp-by'));
    } catch {
      pending.stop?.();
      pending.classList.remove('is-typing');
      pending.replaceChildren(el('p', 'Докладът не се генерира. Опитай отново.'));
    } finally {
      busy = false;
      if (current === assessment) chips(suggestedQuestions().filter(x => x !== REPORT_CHIP));
      scrollChat();
    }
  }

  // ---------------------------------------------------------------- wiring
  const q = $('question');
  function autosize() { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; }
  q.addEventListener('input', autosize);
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q.value); } });
  $('ask-form').addEventListener('submit', e => { e.preventDefault(); ask(q.value); });
  $('cp-reset').addEventListener('click', () => { if (current && !busy) { history = []; asked = new Set(); welcome(); } });
  $('cp-open').addEventListener('click', () => { document.body.classList.add('cp-open'); setTimeout(() => q.focus(), 200); });
  $('cp-close').addEventListener('click', () => document.body.classList.remove('cp-open'));
  for (const b of document.querySelectorAll('#trend-switch button')) b.addEventListener('click', () => {
    trendMetric = b.dataset.metric;
    document.querySelectorAll('#trend-switch button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderTrend();
  });
  init();
})();
