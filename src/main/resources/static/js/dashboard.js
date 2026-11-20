(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const page = document.querySelector('.overview-page').dataset;
  const LIGHT_OK = Number(page.lightOk) || 20, LIGHT_CRIT = Number(page.lightCritical) || 11;
  const CHL_MID = Number(page.chlModerate) || 3, CHL_HIGH = Number(page.chlHigh) || 6;
  const RISK = SeaMap.RISK, RISK_LABEL = SeaMap.RISK_LABEL;
  const MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
  const METRIC = {
    lightAtDepth: {label: 'Светлина до дъното', unit: '%', digits: 0,
      level: v => v >= LIGHT_OK ? 'good' : v >= LIGHT_CRIT ? 'mid' : 'bad',
      note: `Процент от слънчевата светлина, който стига до долната граница на ливадата. Зелено ≥ ${LIGHT_OK} %, оранжево ${LIGHT_CRIT}–${LIGHT_OK} %, червено под ${LIGHT_CRIT} % (критично за тревата).`},
    turbidity: {label: 'Мътност', unit: 'FNU', digits: 1,
      level: v => v < 2 ? 'good' : v < 5 ? 'mid' : 'bad',
      note: 'Колко мътна е водата по сателит. Зелено под 2 FNU, оранжево 2–5, червено над 5.'},
    chlorophyll: {label: 'Хлорофил-а', unit: 'mg/m³', digits: 1,
      level: v => v < CHL_MID ? 'good' : v < CHL_HIGH ? 'mid' : 'bad',
      note: `Количество водорасли във водата, признак за замърсяване с хранителни вещества. Зелено под ${CHL_MID}, оранжево ${CHL_MID}–${CHL_HIGH}, червено над ${CHL_HIGH} mg/m³.`}
  };
  let map, picker, chart, sites = [], byId = new Map(), water = null, selected = null, metric = 'lightAtDepth', showAll = false;
  const polygons = new Map(), dots = new Map();

  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('bg-BG', {minimumFractionDigits: d, maximumFractionDigits: d});
  const monthLabel = m => MONTHS[Number(m.slice(5, 7)) - 1];

  // ---------------------------------------------------------------- map
  function initMap(archive) {
    if (typeof L === 'undefined') { $('map').append(el('p', 'Картата изисква интернет връзка.', 'empty')); return; }
    ({map} = SeaMap.create('map', {onReset: fitAll}));
    const outlines = L.geoJSON(archive, {
      style: f => polygonStyle(byId.get(f.id), false),
      onEachFeature(f, layer) {
        polygons.set(f.id, layer);
        layer.bindTooltip(() => tip(byId.get(f.id)), {sticky: true});
        layer.on('click', () => select(f.id, false));
      }
    });
    const markers = L.layerGroup(sites.map(s => {
      const m = L.circleMarker([s.latitude, s.longitude], markerStyle(s, false));
      m.bindTooltip(() => tip(s), {direction: 'top', offset: [0, -6]});
      m.on('click', () => select(s.id, false));
      dots.set(s.id, m);
      return m;
    }));
    const swap = () => {
      if (map.getZoom() >= 12) { markers.remove(); outlines.addTo(map); }
      else { outlines.remove(); markers.addTo(map); }
    };
    map.on('zoomend', swap);
    fitAll(map);
    swap();
  }
  function fitAll(m = map) {
    if (!m || !sites.length) return;
    // Leave room on the left for the floating site card.
    m.fitBounds(L.latLngBounds(sites.map(s => [s.latitude, s.longitude])), {paddingTopLeft: [window.innerWidth > 900 ? 330 : 30, 30], paddingBottomRight: [30, 30]});
  }
  const tip = s => `<strong>${s.name}</strong><br>${RISK_LABEL[s.statusKey]}, ${s.riskScore}/100`;
  const markerStyle = (s, active) => ({radius: active ? 11 : 6 + s.riskScore / 10, weight: active ? 3 : 1.5, color: '#fff', fillColor: RISK[s.statusKey], fillOpacity: active ? 1 : .9});
  const polygonStyle = (s, active) => ({color: active ? '#fff' : RISK[s.statusKey], weight: active ? 3 : 2, fillColor: RISK[s.statusKey], fillOpacity: active ? .6 : .4});

  // ---------------------------------------------------------------- selection
  function select(id, zoom) {
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
    picker?.set(id);
    $('mc-status').className = 'badge risk-' + s.statusKey;
    $('mc-status').textContent = RISK_LABEL[s.statusKey];
    $('mc-area').textContent = s.areaHa != null ? fmt(s.areaHa) + ' ха' : '';
    $('mc-name').textContent = s.name;
    $('mc-score').textContent = s.riskScore;
    $('mc-bar').style.width = s.riskScore + '%';
    $('mc-bar').style.background = RISK[s.statusKey];
    $('mc-threat').textContent = s.topThreat === '—' ? 'Няма силна заплаха в данните' : s.topThreat;
    $('mc-cause').textContent = s.topCause || '—';
    $('mc-link').href = '/ecologist?site=' + id;
    document.querySelectorAll('#priority-list button').forEach(b => b.classList.toggle('is-active', Number(b.dataset.id) === id));
    const row = document.querySelector(`#priority-list button[data-id="${id}"]`), list = $('priority-list');
    if (row && list.scrollHeight > list.clientHeight) {
      const top = row.offsetTop - list.offsetTop, bottom = top + row.offsetHeight;
      if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight / 2;
    }
    document.querySelectorAll('#heat-body tr').forEach(tr => tr.classList.toggle('is-active', Number(tr.dataset.id) === id));
    if (zoom && map) map.flyTo([s.latitude, s.longitude], 14, {duration: .8});
    const url = new URL(location.href);
    url.searchParams.set('site', id);
    history.replaceState(null, '', url);
    renderTrend();
  }

  function renderPriority() {
    const list = $('priority-list');
    list.replaceChildren();
    sites.forEach((s, i) => {
      const b = el('button', null, 'pr-row');
      b.type = 'button';
      b.dataset.id = s.id;
      const score = el('span', s.riskScore, 'pr-score');
      score.style.setProperty('--c', RISK[s.statusKey]);
      const text = el('span', null, 'pr-text');
      text.append(el('strong', s.name), el('small', s.topThreat === '—' ? RISK_LABEL[s.statusKey] : s.topThreat));
      b.append(el('span', i + 1, 'pr-rank'), text, score);
      b.addEventListener('click', () => select(s.id, true));
      const li = el('li');
      li.append(b);
      list.append(li);
    });
  }

  function renderPulse() {
    const n = keys => sites.filter(s => keys.includes(s.statusKey)).length;
    $('p-risk').textContent = n(['high', 'elevated']);
    $('p-watch').textContent = n(['watch']);
    $('p-low').textContent = n(['low']);
    const an = sites.map(s => s.anomaly30C).filter(v => v != null);
    if (an.length) {
      const avg = an.reduce((a, b) => a + b, 0) / an.length;
      $('p-anomaly').textContent = (avg >= 0 ? '+' : '−') + fmt(Math.abs(avg)) + ' °C';
      $('p-anomaly').parentElement.title = 'Температурата на морето за последните 30 дни спрямо същите седмици през предходните години';
    }
  }

  // ---------------------------------------------------------------- water heatmap
  function renderHeat() {
    const cfg = METRIC[metric];
    $('water-note').textContent = cfg.note;
    $('heat-head').replaceChildren((() => {
      const tr = el('tr');
      tr.append(el('th', 'Участък'));
      water.months.forEach(m => tr.append(el('th', monthLabel(m), 'num')));
      tr.append(el('th', 'Промяна', 'num'));
      return tr;
    })());
    const order = new Map(sites.map((s, i) => [s.id, i]));
    const rows = [...water.sites].sort((a, b) => order.get(a.id) - order.get(b.id));
    const body = $('heat-body');
    body.replaceChildren();
    for (const r of showAll ? rows : rows.slice(0, 12)) {
      const tr = el('tr');
      tr.dataset.id = r.id;
      if (r.id === selected) tr.classList.add('is-active');
      const name = el('th');
      const dot = el('i');
      dot.style.background = RISK[r.statusKey];
      name.append(dot, document.createTextNode(r.name));
      tr.append(name);
      const vals = r.values[metric] || [];
      vals.forEach(v => {
        const td = el('td', v == null ? '—' : fmt(v, cfg.digits), 'num cell ' + (v == null ? 'none' : cfg.level(v)));
        td.title = v == null ? 'Няма данни' : `${cfg.label}: ${fmt(v, cfg.digits)} ${cfg.unit}`;
        tr.append(td);
      });
      const first = vals.find(v => v != null), last = [...vals].reverse().find(v => v != null);
      const change = first != null && last != null ? last - first : null;
      const worse = change == null ? null : metric === 'lightAtDepth' ? change < 0 : change > 0;
      tr.append(el('td', change == null ? '—' : (change > 0 ? '▲ ' : change < 0 ? '▼ ' : '') + fmt(Math.abs(change), cfg.digits), 'num delta ' + (worse == null ? '' : worse ? 'is-worse' : 'is-better')));
      tr.addEventListener('click', () => { select(r.id, true); document.querySelector('.ov-hero').scrollIntoView({behavior: 'smooth'}); });
      body.append(tr);
    }
    $('heat-more').hidden = rows.length <= 12;
    $('heat-more').textContent = showAll ? 'Покажи по-малко' : `Покажи всички ${rows.length}`;
  }

  // ---------------------------------------------------------------- trend
  function renderTrend() {
    if (!water || typeof Chart === 'undefined' || $('trend').closest('[hidden]')) return;
    const cfg = METRIC[metric];
    const avg = water.months.map((_, i) => {
      const v = water.sites.map(s => s.values[metric]?.[i]).filter(x => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });
    const site = water.sites.find(s => s.id === selected);
    $('trend-note').textContent = `${cfg.label} (${cfg.unit}): средно за 35-те участъка${site ? ' и ' + site.name : ''}.`;
    const datasets = [{label: 'Средно за крайбрежието', data: avg, borderColor: '#9aa3b0', borderDash: [5, 4], pointRadius: 2, tension: .3}];
    if (site) datasets.push({label: site.name, data: site.values[metric], borderColor: '#0a6cf1', backgroundColor: '#0a6cf11a', fill: true, pointRadius: 3, tension: .3});
    if (chart) chart.destroy();
    chart = new Chart($('trend'), {
      type: 'line', data: {labels: water.months.map(monthLabel), datasets},
      options: {responsive: true, maintainAspectRatio: false, interaction: {mode: 'index', intersect: false},
        plugins: {legend: {position: 'bottom'}, tooltip: {callbacks: {label: c => `${c.dataset.label}: ${fmt(c.parsed.y, cfg.digits)} ${cfg.unit}`}}},
        scales: {x: {grid: {display: false}}, y: {beginAtZero: metric === 'lightAtDepth', grid: {color: '#eef0f3'}}}}
    });
  }

  // ---------------------------------------------------------------- sea today
  async function loadSea() {
    const box = $('sea-cards');
    const areas = [['sozopol', 'Созопол'], ['varna', 'Варна'], ['burgas', 'Бургас']];
    const results = await Promise.all(areas.map(([a]) => fetch('/api/marine-live?area=' + a).then(r => r.ok ? r.json() : null).catch(() => null)));
    box.replaceChildren();
    const now = Date.now();
    results.forEach((d, i) => {
      const card = el('div', null, 'sea-card');
      card.append(el('h3', areas[i][1]));
      if (!d?.series) { card.append(el('p', 'Няма връзка с Open-Meteo.', 'muted')); box.append(card); return; }
      const latest = key => [...d.series].reverse().find(p => p[key] != null && Date.parse(p.time + 'Z') <= now);
      const t = latest('temperature'), w = latest('wave'), c = latest('current');
      const big = el('div', null, 'sea-temp');
      big.append(el('strong', t ? fmt(t.temperature) : '—'), el('span', '°C на повърхността'));
      const dl = el('dl');
      for (const [label, v, unit] of [['Вълни', w?.wave, 'm'], ['Течение', c?.current, 'km/h']]) {
        const row = el('div');
        row.append(el('dt', label), el('dd', v == null ? '—' : `${fmt(v)} ${unit}`));
        dl.append(row);
      }
      card.append(big, dl);
      box.append(card);
    });
  }

  // ---------------------------------------------------------------- field strip
  async function loadField() {
    try {
      const [tasks, meas] = await Promise.all([fetch('/api/tasks').then(r => r.json()), fetch('/api/measurements').then(r => r.json())]);
      const open = tasks.filter(t => !t.done);
      $('fc-tasks').textContent = open.length
        ? `${open.length} отворени задачи. Следваща: ${open[0].title} (${open[0].siteName})`
        : 'Няма отворени задачи. Добави от страницата на участъка.';
      $('fc-meas').textContent = meas.length
        ? `${meas.length} измервания. Последно: ${meas[0].place}, ${new Date(meas[0].date).toLocaleDateString('bg-BG', {day: 'numeric', month: 'short'})}`
        : 'Още няма. Първото с координати влиза в оценката на най-близката ливада.';
    } catch (e) { /* the cards keep their loading text */ }
  }

  // ---------------------------------------------------------------- wiring
  for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    $('metric-switch').hidden = tab.dataset.tab === 'sea';
    if (tab.dataset.tab === 'trend') renderTrend();
  });
  for (const b of document.querySelectorAll('#metric-switch button')) b.addEventListener('click', () => {
    metric = b.dataset.metric;
    document.querySelectorAll('#metric-switch button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (water) { renderHeat(); renderTrend(); }
  });
  $('heat-more').addEventListener('click', () => { showAll = !showAll; renderHeat(); });
  $('mc-zoom').addEventListener('click', () => { const s = byId.get(selected); if (s && map) map.flyTo([s.latitude, s.longitude], 14, {duration: .8}); });

  (async () => {
    const [siteRes, archive, waterRes] = await Promise.all([
      fetch('/api/ecologist/sites').then(r => r.json()),
      fetch('/data/zostera-bulgaria.geojson').then(r => r.json()),
      fetch('/api/ecologist/water').then(r => r.json()).catch(() => null)
    ]);
    sites = siteRes.sites;
    sites.forEach(s => byId.set(s.id, s));
    water = waterRes;
    renderPulse();
    renderPriority();
    picker = SitePicker.create($('picker'), {sites, onSelect: id => select(id, true)});
    initMap(archive);
    if (water) renderHeat(); else $('heat-body').replaceChildren(el('tr')).firstChild.append(el('td', 'Сателитните данни не се заредиха.', 'empty'));
    const wanted = Number(new URLSearchParams(location.search).get('site'));
    select(byId.has(wanted) ? wanted : sites[0].id, byId.has(wanted));
    loadSea();
    loadField();
  })();
})();
