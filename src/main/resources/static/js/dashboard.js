(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const palette = window.SeaGuardPalette || ['#0071e3', '#248a3d', '#b25000', '#d70015', '#5e5ce6'];
  const UNITS = {temperature: '°C', turbidity: 'NTU', salinity: 'PSU'};
  const RISK = SeaMap.RISK, RISK_LABEL = SeaMap.RISK_LABEL;
  let map, chart, picker, data = [], sites = [], byId = new Map(), metric = 'temperature', selected = null;
  const polygons = new Map(), dots = new Map();

  const fmt = v => v == null ? '—' : Number(v).toLocaleString('bg-BG', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const dateText = s => s ? new Date(s).toLocaleDateString('bg-BG', {day: 'numeric', month: 'short', year: 'numeric'}) : '—';
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // ---------------------------------------------------------------- risk map
  async function initMap() {
    if (typeof L === 'undefined') { $('map').append(el('p', 'Картата изисква интернет връзка.', 'empty')); return; }
    ({map} = SeaMap.create('map', {onReset: m => fitAll(m)}));
    const [siteRes, archive] = await Promise.all([fetch('/api/ecologist/sites').then(r => r.json()), fetch('/data/zostera-bulgaria.geojson').then(r => r.json())]);
    sites = siteRes.sites;
    sites.forEach(s => byId.set(s.id, s));

    // Meadow outlines: visible when zoomed in.
    const outlines = L.geoJSON(archive, {
      style: f => polygonStyle(byId.get(f.id), false),
      onEachFeature(f, layer) {
        polygons.set(f.id, layer);
        layer.bindTooltip(() => tooltip(byId.get(f.id)), {sticky: true});
        layer.on('mouseover', () => layer.setStyle({weight: 3}));
        layer.on('mouseout', () => layer.setStyle(polygonStyle(byId.get(f.id), selected === f.id)));
        layer.on('click', () => select(f.id, false));
      }
    });
    // Site markers: sized by risk, visible when zoomed out.
    const markers = L.layerGroup(sites.map(s => {
      const m = L.circleMarker([s.latitude, s.longitude], markerStyle(s, false));
      m.bindTooltip(() => tooltip(s), {direction: 'top', offset: [0, -6]});
      m.on('click', () => select(s.id, true));
      dots.set(s.id, m);
      return m;
    }));
    const swap = () => {
      if (map.getZoom() >= 12) { markers.remove(); outlines.addTo(map); }
      else { outlines.remove(); markers.addTo(map); }
    };
    map.on('zoomend', swap);
    picker = SitePicker.create($('sc-picker'), {sites, onSelect: id => select(id, true)});
    fitAll(map);
    swap();
    const wanted = Number(new URLSearchParams(location.search).get('site'));
    select(byId.has(wanted) ? wanted : sites[0].id, byId.has(wanted));
    renderSummary();
    renderQueue();
  }

  function fitAll(m) {
    if (!sites.length) return;
    m.fitBounds(L.latLngBounds(sites.map(s => [s.latitude, s.longitude])).pad(.12));
  }
  const tooltip = s => `<strong>${s.name}</strong><br>${RISK_LABEL[s.statusKey]} · ${s.riskScore}/100${s.topThreat !== '—' ? '<br>' + s.topThreat : ''}`;
  const markerStyle = (s, active) => ({
    radius: 6 + s.riskScore / 9, weight: active ? 3 : 2, color: active ? '#fff' : '#ffffffcc',
    fillColor: RISK[s.statusKey], fillOpacity: active ? 1 : .88
  });
  const polygonStyle = (s, active) => ({
    color: active ? '#fff' : RISK[s.statusKey], weight: active ? 3 : 2, fillColor: RISK[s.statusKey], fillOpacity: active ? .65 : .45
  });

  async function select(id, zoom) {
    const prev = selected;
    selected = id;
    for (const sid of [prev, id]) {
      if (sid == null) continue;
      const s = byId.get(sid);
      dots.get(sid)?.setStyle(markerStyle(s, sid === id));
      polygons.get(sid)?.setStyle(polygonStyle(s, sid === id));
    }
    dots.get(id)?.bringToFront();
    const s = byId.get(id);
    if (zoom && map) map.flyTo([s.latitude, s.longitude], 14, {duration: .8});
    picker?.set(id);
    loadFreshness(id);
    $('sc-status').className = 'badge risk-' + s.statusKey;
    $('sc-status').textContent = RISK_LABEL[s.statusKey];
    $('sc-area').textContent = s.areaHa != null ? fmt(s.areaHa) + ' ха картирана площ' : '';
    $('sc-score').textContent = s.riskScore;
    $('sc-meter').style.width = s.riskScore + '%';
    $('sc-meter').style.background = RISK[s.statusKey];
    $('sc-threat').textContent = s.topThreat === '—' ? 'Няма силна заплаха в данните' : s.topThreat;
    $('sc-cause').textContent = s.topCause || '—';
    $('sc-action').textContent = s.firstAction || '—';
    $('sc-link').href = '/ecologist?site=' + id;
    document.querySelectorAll('#queue tr').forEach(tr => tr.classList.toggle('is-selected', Number(tr.dataset.id) === id));
  }

  const FRESH = {live: 'на живо', recent: 'актуални', old: 'стари', missing: 'няма'};
  async function loadFreshness(id) {
    const list = $('sc-fresh');
    try {
      const a = await (await fetch('/api/ecologist/assessment/' + id)).json();
      if (selected !== id) return;
      list.replaceChildren(...a.freshness.filter(f => f.key !== 'video').map(f => {
        const li = el('li');
        li.append(el('span', f.source), el('span', f.status === 'missing' ? 'няма' : f.age, 'fresh-tag ' + f.status));
        li.title = f.what + (f.date ? ', ' + f.date : '');
        return li;
      }));
    } catch (e) { list.replaceChildren(); }
  }

  function renderSummary() {
    const count = keys => sites.filter(s => keys.includes(s.statusKey)).length;
    $('n-risk').textContent = count(['high', 'elevated']);
    $('n-watch').textContent = count(['watch']);
    $('n-low').textContent = count(['low']);
  }

  function renderQueue() {
    const body = $('queue');
    body.replaceChildren();
    sites.slice(0, 8).forEach((s, i) => {
      const tr = el('tr');
      tr.dataset.id = s.id;
      const score = el('td');
      const bar = el('span', null, 'score-inline');
      const fill = el('i');
      fill.style.width = s.riskScore + '%';
      fill.style.background = RISK[s.statusKey];
      bar.append(fill);
      score.append(el('strong', s.riskScore), bar);
      const name = el('td');
      name.append(el('strong', s.name), el('span', RISK_LABEL[s.statusKey], 'sub'));
      const go = el('td');
      const a = el('a', 'Разследване');
      a.href = '/ecologist?site=' + s.id;
      go.append(a);
      tr.append(el('td', i + 1, 'muted'), name, score, el('td', s.topThreat === '—' ? '—' : s.topThreat), el('td', s.topCause || '—', 'muted'), go);
      tr.addEventListener('click', e => { if (e.target.tagName !== 'A') { select(s.id, true); document.querySelector('.overview').scrollIntoView({behavior: 'smooth'}); } });
      body.append(tr);
    });
  }

  // ---------------------------------------------------------------- field measurements
  function plotMeasurements() {
    if (!map) return;
    const seen = new Map();
    for (const m of data) {
      if (m.latitude == null || m.longitude == null || seen.has(m.place)) continue;
      seen.set(m.place, m);
      L.circleMarker([m.latitude, m.longitude], {radius: 6, weight: 2, color: '#fff', fillColor: '#0071e3', fillOpacity: 1})
        .bindTooltip(`<strong>${m.place}</strong><br>${dateText(m.date)} · ${fmt(m.temperature)} °C`, {direction: 'top'}).addTo(map);
    }
  }

  function renderRows() {
    const target = $('rows');
    target.replaceChildren();
    for (const m of data.slice(0, 8)) {
      const tr = el('tr');
      const src = el('td', m.source, 'muted clip');
      src.title = m.source;
      tr.append(el('td', m.place, 'strong'), el('td', dateText(m.date), 'muted'), el('td', fmt(m.temperature) + ' °C', 'num'),
        el('td', m.turbidity == null ? '—' : fmt(m.turbidity) + ' NTU', 'num'), el('td', m.salinity == null ? '—' : fmt(m.salinity) + ' PSU', 'num'), src);
      target.append(tr);
    }
  }

  function renderAlerts(alerts) {
    const target = $('alerts');
    target.replaceChildren();
    if (!alerts.length) {
      target.append(el('p', 'Няма необичайни стойности. Сравнението започва от 4 измервания на едно място.', 'empty'));
      return;
    }
    for (const a of alerts) {
      const card = el('article', null, 'alert-card');
      const pct = a.baseline ? Math.round((a.current - a.baseline) / Math.abs(a.baseline) * 100) : 0;
      card.append(el('h3', a.title), el('p', `${a.place}, ${dateText(a.date)}`, 'place'));
      const values = el('div', null, 'alert-values');
      values.append(el('strong', `${fmt(a.current)} ${a.unit}`), el('span', `${pct > 0 ? '+' : ''}${pct}%`, 'delta ' + (pct > 0 ? 'up' : 'down')),
        el('span', `обичайно ${fmt(a.baseline)} ${a.unit}`, 'base'));
      card.append(values);
      target.append(card);
    }
  }

  function renderChart() {
    if (chart) { chart.destroy(); chart = null; }
    const points = data.filter(m => m[metric] != null);
    if (!points.length || typeof Chart === 'undefined') return;
    const groups = new Map();
    for (const m of points) {
      if (!groups.has(m.place)) groups.set(m.place, []);
      groups.get(m.place).push({x: new Date(m.date).getTime(), y: m[metric]});
    }
    chart = new Chart($('trend'), {
      type: 'line',
      data: {datasets: [...groups.entries()].slice(0, 6).map(([label, pts], i) => ({
        label, data: pts.sort((a, b) => a.x - b.x), borderColor: palette[i % palette.length], backgroundColor: palette[i % palette.length], tension: .3, pointRadius: 3}))},
      options: {responsive: true, maintainAspectRatio: false, parsing: false, interaction: {mode: 'nearest', intersect: false},
        plugins: {legend: {position: 'bottom'}, tooltip: {callbacks: {title: i => dateText(i[0].parsed.x), label: c => `${c.dataset.label}: ${fmt(c.parsed.y)} ${UNITS[metric]}`}}},
        scales: {x: {type: 'linear', grid: {display: false}, ticks: {maxTicksLimit: 7, callback: v => new Date(v).toLocaleDateString('bg-BG', {day: 'numeric', month: 'short'})}},
          y: {title: {display: true, text: UNITS[metric]}, grid: {color: '#f0f0f2'}}}}
    });
  }

  async function loadTasks() {
    const list = $('team-tasks');
    try {
      const tasks = await (await fetch('/api/tasks')).json();
      list.replaceChildren();
      if (!tasks.length) { list.append(el('li', 'Още няма задачи. Отвори участък в AI еколога и добави стъпка от плана или потвърди предложение на AI.', 'empty')); return; }
      for (const t of tasks) {
        const li = el('li', null, t.done ? 'is-done' : '');
        const a = el('a', t.siteName);
        a.href = '/ecologist?site=' + t.siteId;
        li.append(el('span', t.done ? '✓' : '', 'tt-check'), el('strong', t.title), el('span', t.priority || 'Среден', 'tt-pri'), a);
        list.append(li);
      }
    } catch (e) { list.replaceChildren(el('li', 'Задачите не се заредиха.', 'empty')); }
  }

  async function loadMeasurements() {
    try {
      const [r, a] = await Promise.all([fetch('/api/measurements'), fetch('/api/insights')]);
      data = await r.json();
      const alerts = await a.json();
      $('n-meas').textContent = data.length;
      $('meas-empty').hidden = data.length > 0;
      $('meas-content').hidden = data.length === 0;
      if (!data.length) return;
      renderRows(); renderAlerts(alerts); renderChart(); plotMeasurements();
    } catch (e) {
      $('meas-empty').hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await initMap();
    loadMeasurements();
    loadTasks();
    for (const b of document.querySelectorAll('#metric-switch button')) b.addEventListener('click', () => {
      metric = b.dataset.metric;
      document.querySelectorAll('#metric-switch button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderChart();
    });
  });
})();
