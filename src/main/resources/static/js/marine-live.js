(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let data = null, chart = null, metric = 'temperature';
  const titles = {temperature: 'Температура на повърхността', wave: 'Височина на вълните', current: 'Скорост на течението'};
  const units = {temperature: '°C', wave: 'm', current: 'km/h'};
  const fmt = (v, unit) => v == null ? '—' : `${Number(v).toLocaleString('bg-BG', {minimumFractionDigits: 1, maximumFractionDigits: 1})} ${unit}`;
  const utc = t => Date.parse(t + 'Z');
  const when = t => new Date(utc(t)).toLocaleString('bg-BG', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'}) + ' UTC';

  function setStatus(kind, text) {
    $('status').className = 'callout section' + (kind ? ' ' + kind : '');
    $('status').querySelector('use').setAttribute('href', kind === 'ok' ? '#i-check' : kind === 'error' ? '#i-alert' : '#i-info');
    $('status-text').textContent = text;
  }

  function reset() {
    ['temp', 'wave', 'current'].forEach(id => $(id).textContent = '—');
    ['tempTime', 'waveTime', 'currentTime'].forEach(id => $(id).textContent = 'Няма данни');
    for (const id of ['coords', 'retrieved', 'coverage', 'lastModelTime', 'forecastCount']) $(id).textContent = '—';
    $('exportCsv').disabled = true;
    $('qualityTag').textContent = 'Очакваме данни';
    $('qualityTag').className = 'badge neutral';
    if (chart) { chart.destroy(); chart = null; }
  }

  function latestObserved(series, key) {
    const now = Date.now();
    return [...series].reverse().find(p => p[key] != null && utc(p.time) <= now) || null;
  }

  function renderCards() {
    for (const [key, id, timeId] of [['temperature', 'temp', 'tempTime'], ['wave', 'wave', 'waveTime'], ['current', 'current', 'currentTime']]) {
      const item = latestObserved(data.series, key);
      $(id).textContent = item ? fmt(item[key], units[key]) : '—';
      $(timeId).textContent = item ? `Моделен час ${when(item.time)}` : 'Няма стойност за минал час';
    }
    $('coords').textContent = `${data.requestedLatitude}, ${data.requestedLongitude} → ${data.gridLatitude ?? '—'}, ${data.gridLongitude ?? '—'}`;
    $('retrieved').textContent = new Date(data.retrievedAt).toLocaleString('bg-BG');
  }

  function renderQuality() {
    if (!data) return;
    const now = Date.now();
    const valid = data.series.filter(p => p[metric] != null && Number.isFinite(Number(p[metric])));
    const past = valid.filter(p => utc(p.time) <= now);
    const future = valid.filter(p => utc(p.time) > now);
    const percent = Math.round(100 * valid.length / data.series.length);
    $('coverage').textContent = `${percent}% (${valid.length} от ${data.series.length})`;
    $('lastModelTime').textContent = past.length ? when(past[past.length - 1].time) : 'Няма минали стойности';
    $('forecastCount').textContent = `${future.length}`;
    $('qualityTag').textContent = percent === 100 ? 'Пълен ред' : percent > 0 ? 'Частични данни' : 'Няма стойности';
    $('qualityTag').className = 'badge ' + (percent === 100 ? 'manual' : percent > 0 ? 'demo' : 'neutral');
    const missing = data.series.length - valid.length;
    $('qualityExplanation').textContent = missing
      ? `${missing} липсващи стойности за „${titles[metric]}“. Не ги запълваме с измислени.`
      : `Няма липсващи стойности за „${titles[metric]}“.`;
  }

  function csvCell(value) {
    const str = String(value == null ? '' : value);
    return '"' + str.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    if (!data) return;
    const now = Date.now();
    const headers = ['area', 'requested_latitude', 'requested_longitude', 'grid_latitude', 'grid_longitude', 'utc_time', 'time_kind', 'temperature_c', 'wave_height_m', 'current_velocity_kmh', 'source', 'retrieved_at_utc'];
    const rows = data.series.map(p => [data.area, data.requestedLatitude, data.requestedLongitude, data.gridLatitude, data.gridLongitude, p.time, utc(p.time) > now ? 'FORECAST' : 'PAST_MODEL', p.temperature, p.wave, p.current, data.source, data.retrievedAt]);
    const content = '﻿' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `seaguard-marine-${data.area}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderChart() {
    if (!data || typeof Chart === 'undefined') return;
    if (chart) chart.destroy();
    const now = Date.now();
    const points = data.series.map(p => ({x: utc(p.time), y: p[metric]}));
    const history = points.map(p => p.x <= now ? p : {x: p.x, y: null});
    const forecast = points.map(p => p.x >= now ? p : {x: p.x, y: null});
    // Share the last past value so the forecast line continues from it.
    const firstFuture = points.findIndex(p => p.x > now && p.y != null);
    if (firstFuture > 0) forecast[firstFuture - 1] = points[firstFuture - 1];
    const ctx = $('marineChart').getContext('2d');
    const fill = ctx.createLinearGradient(0, 0, 0, 320);
    fill.addColorStop(0, 'rgba(0,113,227,.14)');
    fill.addColorStop(1, 'rgba(0,113,227,0)');
    chart = new Chart(ctx, {
      type: 'line',
      data: {datasets: [
        {label: 'Минали моделни стойности', data: history, borderColor: '#0071e3', backgroundColor: fill, fill: true, tension: .25, spanGaps: false},
        {label: 'Прогноза', data: forecast, borderColor: '#b25000', borderDash: [6, 4], tension: .25, spanGaps: false}
      ]},
      options: {
        responsive: true, maintainAspectRatio: false, parsing: false,
        interaction: {mode: 'index', intersect: false},
        plugins: {
          legend: {position: 'bottom'},
          tooltip: {callbacks: {
            title: items => new Date(items[0].parsed.x).toLocaleString('bg-BG', {weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'}) + ' UTC',
            label: c => c.parsed.y == null ? null : `${c.dataset.label}: ${fmt(c.parsed.y, units[metric])}`
          }}
        },
        scales: {
          x: {type: 'linear', grid: {display: false},
              ticks: {stepSize: 86400000, callback: v => new Date(v).toLocaleDateString('bg-BG', {day: '2-digit', month: 'short', timeZone: 'UTC'})}},
          y: {title: {display: true, text: `${titles[metric]}, ${units[metric]}`}, grid: {color: '#eef2f6'}}
        }
      },
      plugins: [{
        id: 'now-line',
        afterDraw(c) {
          const x = c.scales.x.getPixelForValue(now);
          if (x < c.chartArea.left || x > c.chartArea.right) return;
          const g = c.ctx;
          g.save();
          g.strokeStyle = '#c7c7cc'; g.setLineDash([3, 3]);
          g.beginPath(); g.moveTo(x, c.chartArea.top); g.lineTo(x, c.chartArea.bottom); g.stroke();
          g.fillStyle = '#6e6e73'; g.font = '600 11px -apple-system, Inter, sans-serif'; g.fillText('сега', x + 5, c.chartArea.top + 11);
          g.restore();
        }
      }]
    });
  }

  async function load() {
    $('refresh').disabled = true;
    setStatus('', 'Свързване с Open-Meteo Marine…');
    data = null; reset();
    try {
      const response = await fetch(`/api/marine-live?area=${encodeURIComponent($('area').value)}`, {cache: 'no-store'});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Грешка при извличане');
      if (!Array.isArray(payload.series) || !payload.series.length) throw new Error('Няма налични данни');
      data = payload; renderCards(); renderQuality(); renderChart(); $('exportCsv').disabled = false;
      setStatus('ok', `Заредени ${data.series.length} часови стойности за ${data.label}. Това са моделни оценки, а не измервания.`);
    } catch (e) {
      setStatus('error', `${e.message}. Не показваме измислени стойности.`);
    } finally { $('refresh').disabled = false; }
  }

  for (const button of document.querySelectorAll('#metric-switch button')) {
    button.addEventListener('click', () => {
      metric = button.dataset.metric;
      for (const b of document.querySelectorAll('#metric-switch button')) b.setAttribute('aria-pressed', String(b === button));
      renderQuality(); renderChart();
    });
  }
  $('area').addEventListener('change', load);
  $('refresh').addEventListener('click', load);
  $('exportCsv').addEventListener('click', exportCsv);
  load();
})();
