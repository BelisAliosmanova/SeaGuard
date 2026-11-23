(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const coastalMap = $('coastal-map');
    const hasInsights = Boolean($('metric-switch'));
    const page = document.querySelector('.overview-page').dataset;
    const LIGHT_OK = Number(page.lightOk) || 20, LIGHT_CRIT = Number(page.lightCritical) || 11;
    const CHL_MID = Number(page.chlModerate) || 3, CHL_HIGH = Number(page.chlHigh) || 6;
    const RISK = SeaMap.RISK, RISK_LABEL = SeaMap.RISK_LABEL;
    const MONTHS_FULL = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
    const MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
    const METRIC = {
        lightAtDepth: {
            label: 'Светлина до дъното', unit: '%', digits: 0,
            level: v => v >= LIGHT_OK ? 'good' : v >= LIGHT_CRIT ? 'mid' : 'bad',
            note: `Процент от слънчевата светлина, който стига до долната граница на ливадата. Зелено ≥ ${LIGHT_OK} %, оранжево ${LIGHT_CRIT}–${LIGHT_OK} %, червено под ${LIGHT_CRIT} % (критично за тревата).`
        },
        turbidity: {
            label: 'Мътност', unit: 'FNU', digits: 1,
            level: v => v < 2 ? 'good' : v < 5 ? 'mid' : 'bad',
            note: 'Колко мътна е водата по сателит. Зелено под 2 FNU, оранжево 2–5, червено над 5.'
        },
        chlorophyll: {
            label: 'Хлорофил-а', unit: 'mg/m³', digits: 1,
            level: v => v < CHL_MID ? 'good' : v < CHL_HIGH ? 'mid' : 'bad',
            note: `Количество водорасли във водата, признак за замърсяване с хранителни вещества. Зелено под ${CHL_MID}, оранжево ${CHL_MID}–${CHL_HIGH}, червено над ${CHL_HIGH} mg/m³.`
        }
    };
    let map, picker, chart, sites = [], byId = new Map(), water = null, selected = null, metric = 'lightAtDepth',
        showAll = false;
    const polygons = new Map(), dots = new Map();

    const el = (tag, text, cls) => {
        const e = document.createElement(tag);
        if (text != null) e.textContent = text;
        if (cls) e.className = cls;
        return e;
    };
    const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('bg-BG', {
        minimumFractionDigits: d,
        maximumFractionDigits: d
    });
    const monthLabel = m => MONTHS[Number(m.slice(5, 7)) - 1];

    // ---------------------------------------------------------------- map
    function initMap(archive) {
        if (typeof L === 'undefined') {
            $('map').append(el('p', 'Картата изисква интернет връзка.', 'empty'));
            return;
        }
        ({map} = SeaMap.create('map', {onReset: fitAll}));
        if (!hasInsights) map.scrollWheelZoom.disable();
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
            if (map.getZoom() >= 12) {
                markers.remove();
                outlines.addTo(map);
            } else {
                outlines.remove();
                markers.addTo(map);
            }
        };
        map.on('zoomend', swap);
        fitAll(map);
        swap();
    }

    function fitAll(m = map) {
        if (!m || !sites.length) return;
        // Leave room on the left for the floating site card.
        m.fitBounds(L.latLngBounds(sites.map(s => [s.latitude, s.longitude])), {
            paddingTopLeft: [window.innerWidth > 900 ? 330 : 30, 30],
            paddingBottomRight: [30, 30]
        });
    }

    const tip = s => `<strong>${s.name}</strong><br>${RISK_LABEL[s.statusKey]}, ${s.riskScore}/100`;
    const markerStyle = (s, active) => ({
        radius: active ? 11 : 6 + s.riskScore / 10,
        weight: active ? 3 : 1.5,
        color: '#fff',
        fillColor: RISK[s.statusKey],
        fillOpacity: active ? 1 : .9
    });
    const polygonStyle = (s, active) => ({
        color: active ? '#fff' : RISK[s.statusKey],
        weight: active ? 3 : 2,
        fillColor: RISK[s.statusKey],
        fillOpacity: active ? .6 : .4
    });

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
        if (zoom && map) map.flyTo([s.latitude, s.longitude], 14, {duration: .8});
        const url = new URL(location.href);
        url.searchParams.set('site', id);
        history.replaceState(null, '', url);
        coastalMap.dispatchEvent(new CustomEvent('coast:select', {detail: s}));
        if (hasInsights) renderWater();
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

    // ---------------------------------------------------------------- water: selected-site chart + coast strip
    const ZONE = {good: '#34c759', mid: '#ff9500', bad: '#ff3b30'};

    function zones() {
        if (metric === 'lightAtDepth') return [[LIGHT_OK, 100, 'good'], [LIGHT_CRIT, LIGHT_OK, 'mid'], [0, LIGHT_CRIT, 'bad']];
        if (metric === 'turbidity') return [[0, 2, 'good'], [2, 5, 'mid'], [5, 99, 'bad']];
        return [[0, CHL_MID, 'good'], [CHL_MID, CHL_HIGH, 'mid'], [CHL_HIGH, 99, 'bad']];
    }

    function renderWater() {
        if (!water) return;
        const cfg = METRIC[metric];
        const site = water.sites.find(s => s.id === selected) || water.sites[0];
        const vals = site.values[metric] || [];
        const lastIdx = vals.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
        const firstIdx = vals.findIndex(v => v != null);
        const last = vals[lastIdx], first = vals[firstIdx];
        $('wv-site').textContent = `${site.name} · ${cfg.label}`;
        $('wv-value').textContent = last == null ? '—' : fmt(last, cfg.digits);
        $('wv-unit').textContent = ' ' + cfg.unit;
        $('wv-sub').textContent = last == null ? 'няма данни' : `през ${MONTHS_FULL[Number(water.months[lastIdx].slice(5, 7)) - 1]} · ${({
            good: 'в норма',
            mid: 'внимание',
            bad: 'критично'
        })[cfg.level(last)]}`;
        $('wv-value').style.color = last == null ? '' : ({
            good: '#1e8a3c',
            mid: '#b45309',
            bad: '#d1242f'
        })[cfg.level(last)];
        const delta = last != null && first != null ? last - first : null;
        const worse = delta == null ? null : metric === 'lightAtDepth' ? delta < 0 : delta > 0;
        const d = $('wv-delta');
        d.className = 'wv-delta ' + (worse == null ? '' : worse ? 'is-worse' : 'is-better');
        d.textContent = delta == null ? '' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${fmt(Math.abs(delta), cfg.digits)} ${cfg.unit} от ${monthLabel(water.months[firstIdx])}`;

        // Chart with coloured risk zones behind the line and the coast average for context.
        const avg = water.months.map((_, i) => {
            const v = water.sites.map(x => x.values[metric]?.[i]).filter(x => x != null);
            return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        });
        const zoneBands = zones();
        const maxVal = Math.max(...vals.filter(v => v != null), ...avg.filter(v => v != null));
        if (chart) chart.destroy();
        const ctx = $('wv-canvas').getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 260);
        grad.addColorStop(0, '#0a6cf140');
        grad.addColorStop(1, '#0a6cf100');
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: water.months.map(monthLabel), datasets: [
                    {
                        label: site.name,
                        data: vals,
                        borderColor: '#0a6cf1',
                        backgroundColor: grad,
                        fill: true,
                        borderWidth: 3,
                        tension: .38,
                        pointRadius: vals.map((_, i) => i === lastIdx ? 6 : 3.5),
                        pointBackgroundColor: vals.map(v => v == null ? '#fff' : ZONE[cfg.level(v)]),
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2
                    },
                    {
                        label: 'Средно за крайбрежието',
                        data: avg,
                        borderColor: '#9aa3b0',
                        borderDash: [5, 5],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: .38
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: {mode: 'index', intersect: false},
                plugins: {
                    legend: {position: 'bottom', labels: {boxWidth: 8, usePointStyle: true}},
                    tooltip: {callbacks: {label: c => `${c.dataset.label}: ${fmt(c.parsed.y, cfg.digits)} ${cfg.unit}`}}
                },
                scales: {
                    x: {grid: {display: false}},
                    y: {
                        beginAtZero: true,
                        suggestedMax: Math.ceil(maxVal * 1.15),
                        grid: {color: '#00000008'},
                        ticks: {callback: v => v + (metric === 'lightAtDepth' ? ' %' : '')}
                    }
                }
            },
            plugins: [{
                id: 'zones',
                beforeDatasetsDraw(c) {
                    const {ctx: g, chartArea: a, scales: {y}} = c;
                    g.save();
                    for (const [lo, hi, key] of zoneBands) {
                        const top = y.getPixelForValue(Math.min(hi, y.max)),
                            bottom = y.getPixelForValue(Math.max(lo, y.min));
                        if (bottom <= a.top || top >= a.bottom) continue;
                        g.fillStyle = ZONE[key] + '14';
                        g.fillRect(a.left, Math.max(top, a.top), a.right - a.left, Math.min(bottom, a.bottom) - Math.max(top, a.top));
                    }
                    g.restore();
                }
            }]
        });

        // Coast strip: every site as a row of coloured cells, no numbers.
        $('wv-strip-months').textContent = `${monthLabel(water.months[0])}–${monthLabel(water.months[water.months.length - 1])}`;
        const order = new Map(sites.map((s, i) => [s.id, i]));
        const rows = [...water.sites].sort((a, b) => order.get(a.id) - order.get(b.id));
        const box = $('heat-body');
        box.replaceChildren();
        for (const r of rows) {
            const row = el('button', null, 'strip-row' + (r.id === site.id ? ' is-active' : ''));
            row.type = 'button';
            row.dataset.id = r.id;
            row.append(el('span', r.name, 'strip-name'));
            const cells = el('span', null, 'strip-cells');
            (r.values[metric] || []).forEach((v, i) => {
                const c = el('i', null, v == null ? 'none' : cfg.level(v));
                c.title = `${r.name}, ${monthLabel(water.months[i])}: ${v == null ? 'няма данни' : fmt(v, cfg.digits) + ' ' + cfg.unit}`;
                cells.append(c);
            });
            row.append(cells);
            row.addEventListener('click', () => select(r.id, true));
            box.append(row);
        }
        box.querySelector('.is-active')?.scrollIntoView({block: 'nearest'});
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
            if (!d?.series) {
                card.append(el('p', 'Няма връзка с Open-Meteo.', 'muted'));
                box.append(card);
                return;
            }
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
                ? `${meas.length} измервания. Последно: ${meas[0].place}, ${new Date(meas[0].date).toLocaleDateString('bg-BG', {
                    day: 'numeric',
                    month: 'short'
                })}`
                : 'Още няма. Първото с координати влиза в оценката на най-близката ливада.';
        } catch (e) { /* the cards keep their loading text */
        }
    }

    // ---------------------------------------------------------------- wiring
    for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
        document.querySelectorAll('[data-panel]').forEach(p => {
            p.hidden = p.dataset.panel !== tab.dataset.tab;
        });
        $('metric-switch').hidden = tab.dataset.tab === 'sea';
        if (tab.dataset.tab === 'water') renderWater();
    });
    for (const b of document.querySelectorAll('#metric-switch button')) b.addEventListener('click', () => {
        metric = b.dataset.metric;
        document.querySelectorAll('#metric-switch button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderWater();
    });
    $('mc-zoom').addEventListener('click', () => {
        const s = byId.get(selected);
        if (s && map) map.flyTo([s.latitude, s.longitude], 14, {duration: .8});
    });

    async function loadJson(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
    }

    async function loadOverview() {
        const [siteRes, archive, waterRes] = await Promise.all([
            loadJson('/api/ecologist/sites'),
            loadJson('/data/zostera-bulgaria.geojson').catch(() => null),
            hasInsights ? loadJson('/api/ecologist/water').catch(() => null) : null
        ]);
        sites = siteRes.sites;
        if (!sites.length) {
            $('mc-name').textContent = 'Няма заредени участъци';
            $('priority-list').replaceChildren(el('li', 'Няма данни за участъци.', 'empty'));
            return;
        }
        sites.forEach(s => byId.set(s.id, s));
        water = waterRes;
        renderPriority();
        picker = SitePicker.create($('picker'), {sites, onSelect: id => select(id, true)});
        if (archive) initMap(archive);
        else $('map').append(el('p', 'Контурите на картата не се заредиха.', 'empty'));
        const wanted = Number(new URLSearchParams(location.search).get('site'));
        select(byId.has(wanted) ? wanted : sites[0].id, byId.has(wanted));
        if (!hasInsights) return;

        renderPulse();
        if (!water) $('heat-body').replaceChildren(el('p', 'Сателитните данни не се заредиха.', 'empty'));
        loadSea();
        loadField();
    }

    loadOverview().catch(() => {
        $('mc-name').textContent = 'Данните за картата са недостъпни';
        $('priority-list').replaceChildren(el('li', 'Опитай да опресниш страницата.', 'empty'));
    });
})();
