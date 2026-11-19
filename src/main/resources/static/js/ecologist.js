(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const LEVEL = {LOW: ['risk-low', 'Ниско', '#34c759'], MODERATE: ['risk-moderate', 'Умерено', '#ff9f0a'], HIGH: ['risk-high', 'Високо', '#ff3b30'], UNKNOWN: ['risk-unknown', 'Няма данни', '#c7c7cc']};
  const PRIORITY = {'Спешно': 'p-urgent', 'Висок': 'p-high', 'Среден': 'p-mid', 'Рутинно': 'p-routine'};
  const FRESH = {live: 'На живо', recent: 'Актуални', old: 'Стари', missing: 'Няма'};
  const workspace = $('workspace');
  const provider = workspace.dataset.provider || 'rules';
  const footage = window.setupFootage($('footage').dataset.endpoint);
  let meadowMap, meadowOutline, meadowBounds, selection;
  const archive = typeof L === 'undefined' ? Promise.resolve(null) :
    fetch(workspace.dataset.archiveUrl).then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).catch(() => null);
  let sites = [], current = null, trendMetric = 'lightAtDepth', history = [], lastReport = null, picker;

  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const fmt = (v, d = 1) => v == null ? '—' : Number(v).toLocaleString('bg-BG', {minimumFractionDigits: d, maximumFractionDigits: d});

  async function init() {
    try {
      const response = await fetch('/api/ecologist/sites');
      if (!response.ok) throw new Error();
      ({sites} = await response.json());
      if (!sites.length) throw new Error();
      $('eco-picker-status').remove();
      picker = SitePicker.create($('picker'), {sites, onSelect: select, label: 'Избран участък'});
      const wanted = Number(new URLSearchParams(location.search).get('site'));
      select(sites.some(s => s.id === wanted) ? wanted : sites[0].id);
    } catch {
      const message = 'Участъците не се заредиха. Презареди страницата, за да опиташ отново.';
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
    footage.selectSite(id, site.name);
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
    history = [];
    lastReport = null;
    $('chat').replaceChildren();
    $('report-body').replaceChildren();
    $('copy-report').hidden = true;
    $('write-report').disabled = true;
    $('verdict-headline').textContent = 'Зареждаме оценката…';
    $('trend-meadow').textContent = site.name;
    renderTrend();
    $('tasks').replaceChildren(el('li', 'Зареждаме задачите…', 'empty'));
    try {
      const response = await fetch('/api/ecologist/assessment/' + id);
      if (!response.ok) throw new Error();
      const assessment = await response.json();
      if (selection !== id) return;
      current = assessment;
      renderVerdict(); renderFreshness(); renderThreats(); renderCauses(); renderActions(); renderGaps(); renderEvidence(); renderTrend();
      $('write-report').disabled = false;
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
    const outline = L.geoJSON(feature, {style: {color: '#5bcaff', weight: 3, fillOpacity: .28}});
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
      li.append(top, el('p', a.why), el('p', a.verify, 'verify'), add);
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

  function renderTrend() {
    const chart = window.SeaGuardWaterChart;
    const status = $('trend-status');
    const body = $('trend-body');
    const canvas = $('trend');
    const points = current?.trend || [];
    const values = points.map(point => point[trendMetric]);
    const latest = values.findLastIndex(Number.isFinite);
    body.hidden = !chart || latest === -1;
    status.hidden = !body.hidden;
    if (body.hidden) {
      chart?.clear(canvas);
      if (!current) {
        status.textContent = 'Зареждаме месечните данни…';
      } else {
        status.textContent = latest === -1 ?
          'Няма месечни стойности. Избери друг показател или участък.' :
          'Диаграмата е недостъпна. Провери интернет връзката и презареди страницата.';
      }
      return;
    }
    const label = chart.metrics[trendMetric].label;
    const date = chart.monthLabel(points[latest].month);
    $('trend-value').textContent = chart.format(values[latest], trendMetric);
    $('trend-detail').textContent = `${label} · ${date}`;
    canvas.setAttribute('aria-label', `Месечна графика · ${label} · ${current.site.name}`);
    chart.plot(canvas, {
      months: points.map(point => point.month), metric: trendMetric,
      primary: {label, values},
      limits: trendMetric === 'lightAtDepth' ? [[20, '--risk-low'], [11, '--risk-high']] : []
    });
  }

  // ---------------------------------------------------------------- AI: report and questions
  const modeLabel = m => m === 'claude' ? 'Claude' : m === 'gemini' ? 'Gemini' : 'Експертна система';

  async function writeReport() {
    if (!current) return;
    const site = current.site.id;
    $('write-report').disabled = true;
    $('report-body').replaceChildren(el('p', provider === 'rules' ? 'Експертната система съставя доклада…' : modeLabel(provider) + ' анализира участъка…', 'thinking'));
    try {
      const r = await fetch('/api/ecologist/report/' + site, {method: 'POST'});
      if (!r.ok) throw new Error();
      const report = await r.json();
      if (current?.site.id !== site) return;
      lastReport = report;
      renderReport(lastReport);
    } catch {
      if (current?.site.id === site) {
        $('report-body').replaceChildren(el('p', 'Докладът не се генерира. Провери дали сървърът работи и опитай отново.', 'empty'));
      }
    } finally {
      if (current?.site.id === site) $('write-report').disabled = false;
    }
  }

  function renderReport(rep) {
    const body = $('report-body');
    body.replaceChildren();
    const head = el('div', null, 'report-head');
    head.append(el('h3', rep.headline), el('span', modeLabel(rep.mode), 'badge ' + (rep.mode === 'rules' ? 'neutral' : 'model')));
    body.append(head, el('p', rep.summary, 'report-summary'));
    const cols = el('div', null, 'report-cols');
    const f = el('div'); f.append(el('h3', 'Находки'));
    const ul = el('ul');
    rep.findings.forEach(x => { const li = el('li', x.title + ' '); li.append(el('span', x.explanation)); ul.append(li); });
    f.append(ul);
    const p = el('div'); p.append(el('h3', 'План'));
    const ol = el('ol');
    rep.plan.forEach(s => { const li = el('li', s.action + ' '); li.append(el('span', `${s.priority}. ${s.rationale}`)); ol.append(li); });
    p.append(ol);
    cols.append(f, p);
    body.append(cols);
    if (rep.caveat) body.append(el('p', rep.caveat, 'report-caveat'));
    $('copy-report').hidden = false;
  }

  function reportText(rep) {
    return [`${current.site.name}: ${rep.headline}`, '', rep.summary, '', 'Находки:', ...rep.findings.map(f => `- ${f.title}: ${f.explanation}`),
      '', 'План:', ...rep.plan.map((s, i) => `${i + 1}. ${s.action} [${s.priority}] ${s.rationale} Показател: ${s.successMetric}`),
      '', 'Неизвестни:', ...(rep.unknowns || []).map(u => `- ${u}`), '', rep.caveat || ''].join('\n');
  }

  // ---------------------------------------------------------------- field tasks
  async function addTask(task) {
    if (!current) return false;
    const site = current.site.id;
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

  // ---------------------------------------------------------------- ask: answer, data used, actions
  const ACTION_META = {
    add_task: {icon: '#i-check', ask: 'Да добавя ли тази задача в плана за терена?', yes: 'Добави', done: 'Добавено в плана за терена'},
    open_site: {icon: '#i-target', ask: 'Да отворя ли този участък за сравнение?', yes: 'Отвори'},
    show_map: {icon: '#i-map', ask: 'Да покажа ли участъка на картата?', yes: 'Покажи'},
    new_measurement: {icon: '#i-plus', ask: 'Да отворя ли формата, попълнена за този участък?', yes: 'Попълни'},
    show_trend: {icon: '#i-chart', ask: 'Да покажа ли графиката?', yes: 'Покажи'}
  };

  function icon(href) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', href);
    svg.append(use);
    return svg;
  }

  function actionCard(a) {
    const meta = ACTION_META[a.type];
    const card = el('div', null, 'action-card');
    const head = el('div', null, 'action-card-head');
    head.append(icon(meta.icon));
    const txt = el('div');
    const target = a.type === 'open_site' ? sites.find(s => s.id === a.siteId) : null;
    txt.append(el('strong', a.label + (target ? ` (${target.name}, ${target.riskScore}/100)` : '')));
    if (a.reason) txt.append(el('span', a.reason));
    head.append(txt);
    const row = el('div', null, 'action-card-row');
    row.append(el('span', meta.ask, 'action-q'));
    const yes = el('button', meta.yes, 'button primary small');
    const no = el('button', 'Не', 'button ghost small');
    yes.type = no.type = 'button';
    no.addEventListener('click', () => { card.classList.add('is-dismissed'); row.replaceChildren(el('span', 'Пропуснато', 'action-q')); });
    yes.addEventListener('click', async () => {
      if (a.type === 'add_task') {
        yes.disabled = true;
        const ok = await addTask({title: a.label, priority: a.priority, reason: a.reason, origin: 'ai'});
        row.replaceChildren(el('span', ok ? '✓ ' + meta.done : 'Неуспешно добавяне', 'action-done'));
        card.classList.add('is-confirmed');
      } else if (a.type === 'open_site') { select(a.siteId); window.scrollTo({top: 0, behavior: 'smooth'}); }
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

  function trace(steps) {
    const box = el('div', null, 'trace');
    steps.forEach((t, i) => {
      const s = el('div', t, 'trace-step');
      s.style.animationDelay = (i * .9) + 's';
      box.append(s);
    });
    return box;
  }

  async function ask(question) {
    if (!current || !question.trim()) return;
    const assessment = current;
    const chat = $('chat');
    chat.append(el('div', question, 'msg user'));
    const pending = el('div', null, 'msg assistant pending');
    pending.append(trace([`Чете оценката на ${current.site.name}`, 'Проверява показателите и праговете', 'Сравнява с другите участъци', 'Формулира отговор']));
    chat.append(pending);
    pending.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    $('question').value = '';
    try {
      const r = await fetch('/api/ecologist/ask', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({siteId: current.site.id, question, history})});
      if (!r.ok) throw new Error();
      const ans = await r.json();
      if (current !== assessment) return;
      pending.className = 'msg assistant';
      pending.replaceChildren(el('p', ans.text));
      if (ans.used?.length) {
        const used = el('div', null, 'used');
        used.append(el('span', 'Проверени данни'));
        for (const key of ans.used) {
          const ind = current.indicators.find(i => i.key === key);
          if (!ind) continue;
          const chip = el('span', ind.label, 'used-chip');
          const dot = el('i');
          dot.style.background = LEVEL[ind.level][2];
          chip.prepend(dot);
          chip.title = ind.value;
          used.append(chip);
        }
        pending.append(used);
      }
      pending.append(el('small', modeLabel(ans.mode)));
      if (ans.actions?.length) {
        const actions = el('div', null, 'action-cards');
        ans.actions.forEach(a => actions.append(actionCard(a)));
        chat.append(actions);
      }
      history.push({role: 'user', text: question}, {role: 'assistant', text: ans.text});
    } catch (e) {
      pending.className = 'msg assistant';
      pending.replaceChildren(el('p', 'Не получих отговор. Опитай отново.'));
    }
  }

  // ---------------------------------------------------------------- wiring
  for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-pressed', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  });
  $('write-report').addEventListener('click', writeReport);
  $('copy-report').addEventListener('click', async () => {
    if (!lastReport) return;
    try {
      await navigator.clipboard.writeText(reportText(lastReport));
      $('copy-report').textContent = 'Копирано';
    } catch {
      $('copy-report').textContent = 'Копирай ръчно';
    }
    setTimeout(() => { $('copy-report').textContent = 'Копирай'; }, 1600);
  });
  $('ask-form').addEventListener('submit', e => { e.preventDefault(); ask($('question').value); });
  for (const b of document.querySelectorAll('#suggestions button')) b.addEventListener('click', () => ask(b.textContent));
  for (const b of document.querySelectorAll('#trend-switch button')) b.addEventListener('click', () => {
    trendMetric = b.dataset.metric;
    document.querySelectorAll('#trend-switch button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderTrend();
  });
  init();
})();
