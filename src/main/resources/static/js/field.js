(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const urls = $('workspace').dataset;
  const busy = new Set();
  const siteNames = new Map();
  let tasks = [], filterId = null, newSiteId, createPicker;
  let readings = [], chart, metric = 'temperature';
  const units = {temperature: '°C', turbidity: 'NTU', salinity: 'PSU'};

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  async function request(url, method = 'GET', payload) {
    const response = await fetch(url, {
      method,
      headers: payload ? {'Content-Type': 'application/json'} : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });
    if (!response.ok) throw new Error(response.status);
    if (response.status !== 204) return response.json();
  }

  function taskStatus(message, isError = false) {
    $('task-status').textContent = message;
    $('task-status').classList.toggle('is-error', isError);
  }

  function renderTask(task) {
    const row = el('li', null, 'field-task' + (task.done ? ' is-done' : ''));
    row.dataset.taskId = task.id;
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.disabled = busy.has(task.id);
    checkbox.setAttribute('aria-label', 'Изпълнена задача: ' + task.title);
    checkbox.addEventListener('change', () => changeTask(task, 'PATCH', {done: checkbox.checked}));

    const details = el('div', null, 'field-task-details');
    const link = el('a', siteNames.get(task.siteId) || task.siteName);
    link.href = urls.ecologistUrl + '?site=' + task.siteId;
    details.append(el('strong', task.title), link, el('span', task.priority || 'Среден', 'muted'));
    if (task.reason) details.append(el('span', task.reason, 'muted'));

    const remove = el('button', 'Изтрий', 'button ghost small');
    remove.type = 'button';
    remove.disabled = busy.has(task.id);
    remove.setAttribute('aria-label', 'Изтрий задача: ' + task.title);
    remove.addEventListener('click', () => changeTask(task, 'DELETE'));
    row.append(checkbox, details, remove);
    return row;
  }

  function renderTasks() {
    const visible = tasks.filter(task => filterId == null || task.siteId === filterId);
    const open = visible.filter(task => !task.done);
    const done = visible.filter(task => task.done);
    $('open-tasks').replaceChildren(...(open.length ? open.map(renderTask) : [el('li',
      filterId == null ? 'Няма отворени задачи. Добави задача за следващата теренна проверка.' :
        'Няма отворени задачи за този участък. Добави задача или избери „Всички участъци“.', 'empty')]));
    $('done-tasks').replaceChildren(...(done.length ? done.map(renderTask) : [el('li',
      'Няма изпълнени задачи. Отбележи задача като изпълнена след проверката.', 'empty')]));
    $('task-groups').hidden = false;
  }

  async function loadTasks() {
    try {
      tasks = await request(urls.tasksUrl);
      renderTasks();
      taskStatus('');
    } catch {
      taskStatus('Задачите не се заредиха. Презареди страницата, за да опиташ отново.', true);
    }
  }

  async function changeTask(task, method, payload) {
    busy.add(task.id);
    const row = document.querySelector(`[data-task-id="${task.id}"]`);
    row.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    try {
      const result = await request(urls.tasksUrl + '/' + task.id, method, payload);
      tasks = result ? tasks.map(item => item.id === task.id ? result : item) :
        tasks.filter(item => item.id !== task.id);
      taskStatus(result ? 'Задачата е обновена.' : 'Задачата е изтрита.');
    } catch {
      taskStatus('Промяната не се запази. Опитай отново.', true);
    } finally {
      busy.delete(task.id);
      renderTasks();
      document.querySelector(`[data-task-id="${task.id}"] input`)?.focus({preventScroll: true});
    }
  }

  async function enablePickers() {
    try {
      const {sites} = await request(urls.sitesUrl);
      if (!sites.length) throw new Error();
      sites.forEach(site => siteNames.set(site.id, site.name));
      if (!$('task-groups').hidden) renderTasks();
      createPicker = SitePicker.create($('task-site'), {
        sites, label: 'Участък за нова задача', onSelect: id => {
          newSiteId = id;
          $('task-site-status').textContent = '';
        }
      });
      SitePicker.create($('task-filter'), {
        sites, allLabel: 'Всички участъци', label: 'Филтър по участък', onSelect: id => {
          filterId = id;
          if (id != null) {
            newSiteId = id;
            createPicker.set(id);
          }
          if (!$('task-groups').hidden) renderTasks();
        }
      });
      $('task-form').hidden = false;
      $('task-site-status').textContent = '';
    } catch {
      $('task-site-status').textContent = 'Участъците не се заредиха. Презареди страницата, за да добавяш и филтрираш задачи.';
    }
  }

  $('task-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    const title = $('task-title');
    if (newSiteId == null) {
      $('task-site-status').textContent = 'Избери участък за задачата.';
      $('task-site button')?.focus();
      return;
    }
    if (!title.value.trim()) {
      $('task-site-status').textContent = 'Въведи заглавие за задачата.';
      title.focus();
      return;
    }
    $('task-site-status').textContent = '';
    submit.disabled = true;
    try {
      await initialTasks;
      const task = await request(urls.tasksUrl, 'POST', {
        siteId: newSiteId, title: title.value.trim(), priority: $('task-priority').value
      });
      if ($('task-groups').hidden) await loadTasks();
      tasks = [task, ...tasks.filter(item => item.id !== task.id)];
      renderTasks();
      title.value = '';
      taskStatus(filterId == null || filterId === task.siteId ? 'Задачата е добавена.' :
        'Задачата е добавена. Избери нейния участък или „Всички участъци“, за да я видиш.');
    } catch {
      taskStatus('Задачата не се запази. Опитай отново.', true);
    } finally {
      submit.disabled = false;
    }
  });

  const search = $('filter');
  search?.addEventListener('input', event => {
    const query = event.currentTarget.value.trim().toLocaleLowerCase('bg');
    let shown = 0;
    for (const row of $('measurements-table').tBodies[0].rows) {
      row.hidden = !row.textContent.toLocaleLowerCase('bg').includes(query);
      if (!row.hidden) shown++;
    }
    $('no-match').hidden = shown > 0;
  });

  if (search) search.disabled = false;

  const fmt = value => value.toLocaleString('bg-BG', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const dateText = value => new Date(value).toLocaleDateString('bg-BG', {day: 'numeric', month: 'short', year: 'numeric'});

  function renderAlerts(alerts) {
    const target = $('alerts');
    target.replaceChildren();
    if (!alerts.length) {
      target.append(el('p', 'Няма необичайни стойности. Добави поне четири измервания на едно място, за да има сравнение.', 'empty'));
      return;
    }
    for (const alert of alerts) {
      const card = el('article', null, 'alert-card');
      const percent = alert.baseline ? Math.round((alert.current - alert.baseline) / Math.abs(alert.baseline) * 100) : 0;
      card.append(el('h3', alert.title), el('p', `${alert.place}, ${dateText(alert.date)}`, 'place'));
      const values = el('div', null, 'alert-values');
      values.append(el('strong', `${fmt(alert.current)} ${alert.unit}`),
        el('span', `${percent > 0 ? '+' : ''}${percent}%`, 'delta ' + (percent > 0 ? 'up' : 'down')),
        el('span', `обичайно ${fmt(alert.baseline)} ${alert.unit}`, 'base'));
      card.append(values);
      target.append(card);
    }
  }

  function renderChart() {
    chart?.destroy();
    const canvas = $('trend');
    const status = $('trend-status');
    const wrap = canvas.parentElement;
    const groups = new Map();
    for (const reading of readings) {
      if (reading[metric] == null) continue;
      if (!groups.has(reading.place)) groups.set(reading.place, []);
      groups.get(reading.place).push({x: new Date(reading.date).getTime(), y: reading[metric]});
    }
    wrap.hidden = !groups.size || typeof Chart === 'undefined';
    status.hidden = !wrap.hidden;
    if (wrap.hidden) {
      status.textContent = groups.size ?
        'Графиката е недостъпна. Провери интернет връзката и презареди страницата.' :
        'Няма измервания за този показател. Избери друг показател или добави измерване.';
      return;
    }
    const palette = window.SeaGuardPalette;
    chart = new Chart(canvas, {
      type: 'line',
      data: {datasets: [...groups.entries()].slice(0, 6).map(([label, points], index) => ({
        label, data: points.sort((a, b) => a.x - b.x), borderColor: palette[index % palette.length],
        backgroundColor: palette[index % palette.length], tension: .3, pointRadius: 3
      }))},
      options: {responsive: true, maintainAspectRatio: false, parsing: false, interaction: {mode: 'nearest', intersect: false},
        plugins: {legend: {position: 'bottom'}, tooltip: {callbacks: {title: items => dateText(items[0].parsed.x),
          label: item => `${item.dataset.label} · ${fmt(item.parsed.y)} ${units[metric]}`}}},
        scales: {x: {type: 'linear', grid: {display: false}, ticks: {maxTicksLimit: 7,
          callback: value => new Date(value).toLocaleDateString('bg-BG', {day: 'numeric', month: 'short'})}},
          y: {title: {display: true, text: units[metric]}, grid: {color: '#f0f0f2'}}}}
    });
  }

  const initialTasks = loadTasks();
  enablePickers();
  document.addEventListener('DOMContentLoaded', () => {
    if (!$('measurement-summary')) return;
    request(urls.insightsUrl).then(renderAlerts).catch(() => {
      $('alerts').replaceChildren(el('p', 'Проверката е недостъпна. Презареди страницата, за да опиташ отново.', 'empty'));
    });
    request(urls.measurementsUrl).then(data => {
      readings = data;
      renderChart();
      const buttons = document.querySelectorAll('#metric-switch button');
      for (const button of buttons) button.addEventListener('click', () => {
        metric = button.dataset.metric;
        buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        renderChart();
      });
    }).catch(() => {
      $('trend-status').textContent = 'Измерванията не се заредиха. Презареди страницата, за да опиташ отново.';
    });
  });
})();
