(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const urls = $('workspace').dataset;
  const {RISK, RISK_LABEL} = SeaMap;
  const polygons = new Map(), dots = new Map(), byId = new Map();
  let map, picker, sites = [], selected, water;
  let metric = 'lightAtDepth';

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  const number = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 2});
  const monthFormat = new Intl.DateTimeFormat('bg-BG', {month: 'short', year: 'numeric', timeZone: 'UTC'});
  const observationTime = new Intl.DateTimeFormat('bg-BG', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia'
  });
  const metricLabels = {
    lightAtDepth: ['Светлина до дъното', '%'],
    turbidity: ['Мътност', 'FNU'],
    chlorophyll: ['Хлорофил-а', 'mg/m³']
  };

  async function json(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.status);
    return response.json();
  }

  const tooltip = s => {
    const content = el('div');
    content.append(el('strong', s.name), el('br'), `${RISK_LABEL[s.statusKey]} · ${s.riskScore}/100`);
    if (s.topThreat !== '—') content.append(el('br'), s.topThreat);
    return content;
  };
  const markerStyle = (s, active) => ({
    radius: 6 + s.riskScore / 9, weight: active ? 3 : 2, color: active ? '#fff' : '#ffffffcc',
    fillColor: RISK[s.statusKey], fillOpacity: active ? 1 : .88
  });
  const polygonStyle = (s, active) => ({
    color: active ? '#fff' : RISK[s.statusKey], weight: active ? 3 : 2,
    fillColor: RISK[s.statusKey], fillOpacity: active ? .65 : .45
  });

  function fitAll() {
    map.fitBounds(L.latLngBounds(sites.map(s => [s.latitude, s.longitude])).pad(.12));
  }

  function mapMessage(text) {
    const message = el('p', text, 'map-message');
    message.setAttribute('role', 'status');
    $('map').parentElement.append(message);
  }

  async function initMap(archivePromise) {
    if (typeof L === 'undefined') {
      mapMessage('Картата е недостъпна. Провери интернет връзката и презареди страницата.');
      return;
    }
    ({map} = SeaMap.create('map', {onReset: fitAll}));
    fitAll();
    const markers = L.layerGroup(sites.map(s => {
      const marker = L.circleMarker([s.latitude, s.longitude], markerStyle(s, selected === s.id));
      marker.bindTooltip(() => tooltip(s), {direction: 'top', offset: [0, -6]});
      marker.on('click', () => select(s.id, true));
      dots.set(s.id, marker);
      return marker;
    })).addTo(map);
    try {
      const archive = await archivePromise;
      if (!archive) throw new Error();
      const outlines = L.geoJSON(archive, {
        filter: feature => byId.has(Number(feature.id)),
        style: f => polygonStyle(byId.get(Number(f.id)), selected === Number(f.id)),
        onEachFeature(feature, layer) {
          const id = Number(feature.id);
          polygons.set(id, layer);
          layer.bindTooltip(() => tooltip(byId.get(id)), {sticky: true});
          layer.on('mouseover', () => layer.setStyle({weight: 3}));
          layer.on('mouseout', () => layer.setStyle(polygonStyle(byId.get(id), selected === id)));
          layer.on('click', () => select(id, false));
        }
      });
      const swap = () => {
        if (map.getZoom() >= 12) { markers.remove(); outlines.addTo(map); }
        else { outlines.remove(); markers.addTo(map); }
      };
      map.on('zoomend', swap);
      swap();
    } catch {
      mapMessage('Границите на ливадите не се заредиха. Презареди страницата, за да опиташ отново.');
    }
  }

  function select(id, zoom) {
    const site = byId.get(id);
    if (!site) return;
    const previous = selected;
    selected = id;
    for (const sid of [previous, id]) {
      dots.get(sid)?.setStyle(markerStyle(byId.get(sid), sid === id));
      polygons.get(sid)?.setStyle(polygonStyle(byId.get(sid), sid === id));
    }
    dots.get(id)?.bringToFront();
    if (zoom && map) map.flyTo([site.latitude, site.longitude], 14, {duration: .65});
    picker.set(id);
    loadFreshness(id);
    $('sc-status').className = 'badge risk-' + site.statusKey;
    $('sc-status').textContent = RISK_LABEL[site.statusKey];
    $('sc-area').textContent = site.areaHa == null ? '' : number.format(site.areaHa) + ' ха картирана площ';
    $('sc-score').textContent = site.riskScore;
    $('sc-meter').style.width = site.riskScore + '%';
    $('sc-meter').style.background = RISK[site.statusKey];
    $('sc-threat').textContent = site.topThreat === '—' ? 'Няма силна заплаха в данните' : site.topThreat;
    $('sc-cause').textContent = site.topCause || '—';
    $('sc-action').textContent = site.firstAction || '—';
    $('sc-link').href = '/ecologist?site=' + id;
    $('sc-link').hidden = false;
    updateSelection();
  }

  function updateSelection() {
    for (const row of document.querySelectorAll('#queue tr[data-id], #water-sites tr[data-id]')) {
      const active = Number(row.dataset.id) === selected;
      row.classList.toggle('is-selected', active);
      row.querySelector('button')?.setAttribute('aria-pressed', String(active));
    }
  }

  function selectOnMap(id) {
    select(id, true);
    $('risk-map').scrollIntoView({behavior: 'smooth', block: 'start'});
    $('sc-picker').querySelector('button')?.focus({preventScroll: true});
  }

  async function loadFreshness(id) {
    const list = $('sc-fresh');
    list.replaceChildren(el('li', 'Зареждаме източниците…', 'muted'));
    try {
      const assessment = await json('/api/ecologist/assessment/' + id);
      if (selected !== id) return;
      list.replaceChildren(...assessment.freshness.filter(f => f.key !== 'video').map(f => {
        const li = el('li');
        li.append(el('span', f.source), el('span', f.status === 'missing' ? 'няма' : f.age, 'fresh-tag ' + f.status));
        li.title = f.what + (f.date ? ', ' + f.date : '');
        return li;
      }));
    } catch {
      if (selected === id) list.replaceChildren(el('li', 'Избери участъка отново, за да провериш източниците.', 'muted'));
    }
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
    sites.slice(0, 8).forEach((site, index) => {
      const row = el('tr');
      row.dataset.id = site.id;
      const score = el('td');
      const bar = el('span', null, 'score-inline');
      const fill = el('i');
      fill.style.width = site.riskScore + '%';
      fill.style.background = RISK[site.statusKey];
      bar.append(fill);
      score.append(el('strong', site.riskScore), bar);
      const name = el('td');
      name.append(el('strong', site.name), el('span', RISK_LABEL[site.statusKey], 'sub'));
      const action = el('td');
      const link = el('a', 'Разследване');
      link.href = '/ecologist?site=' + site.id;
      action.append(link);
      row.append(el('td', index + 1, 'muted'), name, score, el('td', site.topThreat),
        el('td', site.topCause || '—', 'muted'), action);
      row.addEventListener('click', event => {
        if (!event.target.closest('a')) selectOnMap(site.id);
      });
      body.append(row);
    });
  }

  async function plotMeasurements() {
    try {
      const readings = await json(urls.measurementsUrl);
      const seen = new Set();
      for (const reading of readings) {
        if (reading.latitude == null || reading.longitude == null || seen.has(reading.place)) continue;
        seen.add(reading.place);
        const observation = new Date(reading.date).toLocaleDateString('bg-BG');
        const content = el('div');
        content.append(el('strong', reading.place), el('br'), `${observation} · ${number.format(reading.temperature)} °C`);
        L.circleMarker([reading.latitude, reading.longitude], {
          radius: 6, weight: 2, color: '#fff', fillColor: '#0071e3', fillOpacity: 1
        }).bindTooltip(content, {direction: 'top'}).addTo(map);
      }
    } catch {
      mapMessage('Теренните измервания не се заредиха. Презареди страницата или отвори „Теренна работа“.');
    }
  }

  function renderWater() {
    if (!water) return;
    const thresholds = $('water').dataset;
    const lightOk = Number(thresholds.lightOk), lightCritical = Number(thresholds.lightCritical);
    const chlModerate = Number(thresholds.chlorophyllModerate), chlHigh = Number(thresholds.chlorophyllHigh);
    const [label, unit] = metricLabels[metric];
    const header = el('tr');
    header.append(el('th', `Участък · ${unit}`));
    for (const month of water.months) {
      header.append(el('th', monthFormat.format(new Date(month + '-01T00:00:00Z'))));
    }
    for (const cell of header.cells) cell.scope = 'col';
    $('water-months').replaceChildren(header);

    $('water-legend').textContent = metric === 'chlorophyll'
      ? `Зелено под ${chlModerate} · кехлибарено от ${chlModerate} до под ${chlHigh} · червено от ${chlHigh} mg/m³ · сиво при липса на данни.`
      : `Зелено от ${lightOk} % светлина · кехлибарено от ${lightCritical} до под ${lightOk} % · червено под ${lightCritical} % · сиво при липса на данни. ` +
        (metric === 'turbidity' ? 'Цветът показва ефекта на мътността върху светлината при дълбочината на участъка.' :
          'Оценка при дълбочинната граница на участъка или при 5 m, ако тя липсва.');

    $('water-sites').replaceChildren(...water.sites.map(site => {
      const row = el('tr');
      row.dataset.id = site.id;
      const name = el('th');
      name.scope = 'row';
      const button = el('button', site.name, 'water-site');
      button.type = 'button';
      const dot = el('i', null, 'water-dot');
      dot.style.backgroundColor = RISK[site.statusKey];
      dot.title = RISK_LABEL[site.statusKey];
      button.prepend(dot);
      name.append(button);
      row.append(name);
      row.addEventListener('click', () => selectOnMap(site.id));
      site.values[metric].forEach((value, index) => {
        const light = site.values.lightAtDepth[index];
        let level = 'missing';
        if (value != null) {
          level = metric === 'chlorophyll'
            ? (value >= chlHigh ? 'high' : value >= chlModerate ? 'mid' : 'low')
            : (light >= lightOk ? 'low' : light >= lightCritical ? 'mid' : 'high');
        }
        const cell = el('td', value == null ? '—' : number.format(value), 'water-' + level);
        cell.title = value == null ? 'Няма спътникови данни за този месец.' : `${label} · ${number.format(value)} ${unit}`;
        row.append(cell);
      });
      return row;
    }));
    $('water-status').hidden = true;
    $('water-content').hidden = false;
    updateSelection();
  }

  async function loadWater() {
    try {
      const data = await json(urls.waterUrl);
      if (!data.months.length || !data.sites.some(site =>
        Object.values(site.values).some(values => values.some(Number.isFinite)))) {
        $('water-status').textContent = 'Няма налични месечни данни. Провери дали архивът на Copernicus е обновен и презареди страницата.';
        return;
      }
      water = data;
      renderWater();
    } catch {
      $('water-status').textContent = 'Месечните данни не се заредиха. Презареди страницата, за да опиташ отново.';
    }
  }

  async function loadMarine() {
    const stations = [['sozopol', 'Созопол'], ['varna', 'Варна'], ['burgas', 'Бургас']];
    const metrics = [
      ['temperature', 'Повърхностна температура', '°C'], ['wave', 'Височина на вълните', 'm'],
      ['current', 'Скорост на течението', 'km/h']
    ];
    $('marine-cards').replaceChildren();
    await Promise.all(stations.map(async ([key, name]) => {
      const card = el('article', null, 'marine-card');
      const status = el('p', 'Зареждаме…', 'muted');
      card.append(el('h3', name), status);
      $('marine-cards').append(card);
      try {
        const data = await json(`${urls.marineUrl}?area=${key}`);
        const now = Date.now();
        const past = data.series.filter(point => Date.parse(point.time + 'Z') <= now).reverse();
        const values = el('dl');
        for (const [metricKey, label, unit] of metrics) {
          const row = el('div');
          const point = past.find(item => Number.isFinite(item[metricKey]));
          const value = el('dd', point ? `${number.format(point[metricKey])} ${unit}` : 'Няма данни');
          if (point) value.title = `Моделен час ${observationTime.format(new Date(point.time + 'Z'))}`;
          row.append(el('dt', label), value);
          values.append(row);
        }
        status.replaceWith(values);
        if (metrics.some(([key]) => !past.some(point => Number.isFinite(point[key])))) {
          card.append(el('p', 'При липсваща стойност провери отново по-късно.', 'muted'));
        }
      } catch {
        status.textContent = 'Моделните данни са недостъпни. Провери отново по-късно.';
      }
    }));
  }

  function renderAnomaly() {
    const values = sites.map(site => site.anomaly30C).filter(Number.isFinite);
    if (!values.length) {
      $('marine-anomaly').textContent = 'Няма налична температурна норма. Провери отново по-късно.';
      return;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const delta = mean.toLocaleString('bg-BG', {signDisplay: 'exceptZero', maximumFractionDigits: 2});
    $('marine-anomaly').textContent = `${delta} °C · ${values.length} от ${sites.length} участъка`;
  }

  for (const button of document.querySelectorAll('#water-switch button')) {
    button.addEventListener('click', () => {
      metric = button.dataset.metric;
      document.querySelectorAll('#water-switch button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      renderWater();
    });
  }

  async function init() {
    loadMarine();
    const archive = json(urls.archiveUrl).catch(() => null);
    try {
      ({sites} = await json(urls.sitesUrl));
      if (!sites.length) throw new Error();
    } catch {
      const message = 'Участъците не се заредиха. Презареди страницата, за да опиташ отново.';
      $('sc-loading').textContent = message;
      $('queue').rows[0].cells[0].textContent = message;
      $('water-status').textContent = message;
      $('marine-anomaly').textContent = 'Отклонението не се зареди. Презареди страницата.';
      $('sc-fresh').replaceChildren();
      mapMessage(message);
      return;
    }
    sites.forEach(site => byId.set(site.id, site));
    $('sc-loading').remove();
    picker = SitePicker.create($('sc-picker'), {sites, onSelect: id => select(id, true)});
    renderSummary();
    renderQueue();
    renderAnomaly();
    const mapping = initMap(archive).catch(() =>
      mapMessage('Картата не се зареди. Презареди страницата, за да опиташ отново.'));
    const wanted = Number(new URLSearchParams(location.search).get('site'));
    select(byId.has(wanted) ? wanted : sites[0].id, byId.has(wanted));
    if (map) plotMeasurements();
    loadWater();
    await mapping;
  }

  init();
})();
