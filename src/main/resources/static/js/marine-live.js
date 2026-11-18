(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let data = null, chart = null;
  const titles = {temperature:'Температура на морската повърхност',wave:'Височина на вълните',current:'Скорост на течението'};
  const units = {temperature:'°C',wave:'m',current:'km/h'};
  const fmt = (v, unit) => v == null ? '—' : `${Number(v).toFixed(1)} ${unit}`;
  function reset() {
    ['temp','wave','current'].forEach(id => $(id).textContent = '—');
    ['tempTime','waveTime','currentTime'].forEach(id => $(id).textContent = 'Няма данни');
    $('coords').textContent = '—'; $('retrieved').textContent = '—'; $('exportCsv').disabled = true; $('coverage').textContent='—'; $('lastModelTime').textContent='—'; $('forecastCount').textContent='—'; $('qualityTag').textContent='Очакваме данни'; $('qualityExplanation').textContent='Показваме липсващите данни, без да ги заместваме.';
    if (chart) { chart.destroy(); chart = null; }
  }
  function latestObserved(series, key) {
    const now = new Date();
    return [...series].reverse().find(p => p[key] != null && new Date(p.time + 'Z') <= now) || null;
  }
  function renderCards() {
    for (const [key, id, timeId] of [['temperature','temp','tempTime'],['wave','wave','waveTime'],['current','current','currentTime']]) {
      const item = latestObserved(data.series,key);
      $(id).textContent = item ? fmt(item[key], units[key]) : '—';
      $(timeId).textContent = item ? `Моделен час: ${item.time} UTC` : 'Няма налична стойност за минал час';
    }
    $('coords').textContent = `${data.requestedLatitude}, ${data.requestedLongitude} → решетка: ${data.gridLatitude ?? '—'}, ${data.gridLongitude ?? '—'}`;
    $('retrieved').textContent = `Извлечено: ${data.retrievedAt} · Часова зона: ${data.timezone}`;
  }
  function renderQuality() {
    if (!data) return;
    const key = $('metric').value;
    const now = Date.now();
    const valid = data.series.filter(p => p[key] != null && Number.isFinite(Number(p[key])));
    const past = valid.filter(p => Date.parse(p.time + 'Z') <= now);
    const future = valid.filter(p => Date.parse(p.time + 'Z') > now);
    const percent = Math.round(100 * valid.length / data.series.length);
    $('coverage').textContent = `${percent}% (${valid.length}/${data.series.length})`;
    $('lastModelTime').textContent = past.length ? `${past[past.length - 1].time} UTC` : 'Няма минали стойности';
    $('forecastCount').textContent = `${future.length}`;
    $('qualityTag').textContent = percent === 100 ? 'Пълен времеви ред' : percent > 0 ? 'Частични данни' : 'Няма стойности';
    $('qualityExplanation').textContent = `${data.source}. Последните минали стойности също са изход от модел, НЕ измервания от сензор. ${data.series.length - valid.length} липсващи стойности за този показател. Възможни са ограничения в крайбрежната точност.`;
  }
  function csvCell(value) {
    const str = String(value == null ? '' : value);
    return '"' + str.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    if (!data) return;
    const now = Date.now();
    const headers = ['area','requested_latitude','requested_longitude','grid_latitude','grid_longitude','utc_time','time_kind','temperature_c','wave_height_m','current_velocity_kmh','source','retrieved_at_utc'];
    const rows = data.series.map(p => [data.area,data.requestedLatitude,data.requestedLongitude,data.gridLatitude,data.gridLongitude,p.time,Date.parse(p.time+'Z') > now ? 'FORECAST' : 'PAST_MODEL',p.temperature,p.wave,p.current,data.source,data.retrievedAt]);
    const content = '\uFEFF' + [headers,...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([content], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href=url; link.download=`seagrass-marine-${data.area}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderChart() {
    if (!data || typeof Chart === 'undefined') return;
    if (chart) chart.destroy();
    const key = $('metric').value;
    const labels = data.series.map(p => p.time.replace('T',' '));
    const now = Date.now();
    const history = data.series.map(p => new Date(p.time + 'Z').getTime() <= now ? p[key] : null);
    const forecast = data.series.map(p => new Date(p.time + 'Z').getTime() >= now ? p[key] : null);
    // Share the nearest previous observation to make the forecast line visually continuous.
    const firstFuture = forecast.findIndex((v,i) => v !== null && new Date(data.series[i].time+'Z').getTime() > now);
    if (firstFuture > 0) forecast[firstFuture - 1] = history[firstFuture - 1];
    chart = new Chart($('marineChart'), {type:'line',data:{labels,datasets:[
      {label:'Минали моделни стойности',data:history,borderColor:'#73e7c0',backgroundColor:'rgba(115,231,192,.12)',pointRadius:0,borderWidth:2,tension:.25,spanGaps:false},
      {label:'Прогноза',data:forecast,borderColor:'#ffcc80',pointRadius:0,borderDash:[7,5],borderWidth:2,tension:.25,spanGaps:false}
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#cde8e9'}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y,units[key])}`}}},scales:{x:{ticks:{color:'#aac8cf',maxTicksLimit:9},grid:{color:'#294554'}},y:{title:{display:true,text:`${titles[key]} (${units[key]})`,color:'#cde8e9'},ticks:{color:'#aac8cf'},grid:{color:'#294554'}}}}});
  }
  async function load() {
    $('refresh').disabled = true; $('status').className='small mt-3'; $('status').textContent='Свързване с Open-Meteo Marine API...';
    data = null; reset();
    try {
      const response = await fetch(`/api/marine-live?area=${encodeURIComponent($('area').value)}`,{cache:'no-store'});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Грешка при извличане');
      if (!Array.isArray(payload.series) || !payload.series.length) throw new Error('Няма налични данни');
      data = payload; renderCards(); renderQuality(); renderChart(); $('exportCsv').disabled = false;
      $('status').className='small mt-3 ok'; $('status').textContent=`✓ Заредени ${data.series.length} часови позиции от външния модел. Това НЕ са измервания на морски треви.`;
    } catch (e) {
      $('status').className='small mt-3 error'; $('status').textContent=`Неуспешно зареждане: ${e.message}. Не показваме измислени стойности.`;
    } finally { $('refresh').disabled = false; }
  }
  $('area').addEventListener('change',load);
  $('refresh').addEventListener('click',load);
  $('metric').addEventListener('change',()=>{renderQuality();renderChart();});
  $('exportCsv').addEventListener('click',exportCsv);
  load();
})();
