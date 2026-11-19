import { setupFootage } from './seagrass-footage.js';

const workspace = document.getElementById('workspace');
const byId = id => document.getElementById(id);
const picker = byId('site-select');
const report = byId('report');
const number = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 2});
const month = new Intl.DateTimeFormat('bg-BG', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const measurementDate = new Intl.DateTimeFormat('bg-BG', {dateStyle: 'medium', timeStyle: 'short'});
const methods = {
    satellite: 'сателитни снимки',
    diving: 'водолазно обследване',
    multibeam: 'многолъчев сонар',
    drone: 'дрон',
    dropcamera: 'спускаема камера'
};
const siteNames = {
    Otmanli2: 'Отманли 2', Otmanli3_4: 'Отманли 3–4', Ropotamo: 'Ропотамо',
    SvVlas1: 'Свети Влас 1', SvVlas2: 'Свети Влас 2', SvVlas3: 'Свети Влас 3', SvVlas4: 'Свети Влас 4',
    SlBriagN: 'Слънчев бряг, север', Vromos: 'Вромос', Poda: 'Пода', Gradina: 'Градина',
    Konski_zaliv1: 'Конски залив', Raiski_zaliv: 'Райски залив', Zlatna_ribka: 'Златна рибка 1',
    Zlatna_ribka2: 'Златна рибка 2', RavdaS1: 'Равда, юг 1', RavdaS2a: 'Равда, юг 2а',
    RavdaS3a: 'Равда, юг 3а', RavdaS4: 'Равда, юг 4', Kraimorie: 'Крайморие',
    BialaS: 'Бяла, юг', Pomorie_E: 'Поморие, изток', Pomorie: 'Поморие', Sarafovo: 'Сарафово',
    OtmanliRibarsko: 'Рибарско селище', Otmanli1: 'Отманли 1', Atia: 'Атия', Chernomorets: 'Черноморец',
    BialaN: 'Бяла, север', Nesebar_S_1: 'Несебър, юг 1', Tzarevo_1: 'Царево 1',
    Kavaci: 'Каваци', Tzarevo_2: 'Царево 2', Tzarevo_3: 'Царево 3', Kavarna: 'Каварна'
};

const layers = new Map();
let snapshot;
let map;
let selected;
let reportRequest;
const footage = setupFootage(workspace.dataset.analysisUrl);

function nameOf(feature) {
    return siteNames[feature.properties.NAME] ?? feature.properties.NAME;
}

function setText(id, value) {
    byId(id).textContent = value;
}

function formatValue(value, unit) {
    return Number.isFinite(value) ? `${number.format(value)} ${unit}` : 'Няма данни';
}

function formatMonth(value) {
    return /^\d{4}-\d{2}$/.test(value) ? month.format(new Date(`${value}-01T00:00:00Z`)) : 'Дата без запис';
}

function setMetric(id, value, unit) {
    const element = byId(id);
    const label = document.createElement('small');
    label.textContent = unit;
    element.replaceChildren(number.format(value), ' ', label);
}

function showMapStatus(message) {
    setText('map-status', message);
    byId('map-status').hidden = false;
}

function footprintStyle(feature) {
    const active = feature.id === selected?.id;
    return {
        color: active ? '#884018' : '#2c684d',
        weight: active ? 3 : 1.65,
        fillColor: active ? '#eda85c' : '#80aa78',
        fillOpacity: active ? .75 : .54
    };
}

function initMap(archive) {
    if (typeof L === 'undefined') {
        byId('map').hidden = true;
        byId('reset-map').hidden = true;
        showMapStatus('Картата е недостъпна. Данните са достъпни от списъка с участъци.');
        return;
    }
    map = L.map('map', {scrollWheelZoom: false});
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    tiles.on('tileerror', () => showMapStatus('Част от фоновата карта е недостъпна. Границите остават видими.'));

    const footprints = L.geoJSON(archive, {
        style: footprintStyle,
        onEachFeature(feature, layer) {
            const label = document.createElement('span');
            label.textContent = nameOf(feature);
            layer.bindTooltip(label, {sticky: true});
            layer.on('click', () => selectSite(feature));
            layers.set(feature.id, layer);
        }
    }).addTo(map);

    const dots = L.layerGroup(archive.features.map(feature => {
        const center = layers.get(feature.id).getBounds().getCenter();
        const dot = L.circleMarker(center, {radius: 4, weight: 1.5, color: '#fff', fillColor: '#286147', fillOpacity: 1});
        dot.on('click', () => selectSite(feature));
        return dot;
    }));
    map.on('zoomend', () => {
        if (map.getZoom() < 12) dots.addTo(map);
        else dots.remove();
    });
    const reset = byId('reset-map');
    reset.disabled = false;
    reset.addEventListener('click', () => map.fitBounds(footprints.getBounds(), {padding: [26, 26], animate: false}));
    L.control.scale({imperial: false, position: 'bottomright'}).addTo(map);
}

function siteCenter(feature) {
    const rings = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
    const positions = rings.flat();
    const latitudes = positions.map(position => position[1]);
    const longitudes = positions.map(position => position[0]);
    return {
        latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2
    };
}

function renderSatellite(feature) {
    const rows = snapshot?.sites[String(feature.id)] ?? [];
    const latest = rows[0];
    byId('water-values').hidden = !latest;
    const details = byId('water-details');
    details.hidden = !latest;
    details.open = false;
    if (!latest) {
        setText('water-status', snapshot ? 'Няма валидна сателитна клетка за този участък.' : 'Сателитните данни са недостъпни.');
        return;
    }
    setText('water-status', `Месечна оценка · ${formatMonth(latest.month)}`);
    setMetric('water-turbidity', latest.turbidity, 'FNU');
    setMetric('water-chlorophyll', latest.chlorophyll, 'mg/m³');
    setText('water-meta', `Клетка ${snapshot.resolutionM} м, на ${latest.distanceM} м от центъра. ` +
        `Включени дневни наблюдения за мътност: ${latest.turbidityCount}, за хлорофил: ${latest.chlorophyllCount}. ` +
        'Най-близката валидна клетка може да е различна във всеки месец.');
    const history = rows.slice(1).map(row => {
        const li = document.createElement('li');
        li.textContent = `${formatMonth(row.month)} · ${formatValue(row.turbidity, 'FNU')} · ${formatValue(row.chlorophyll, 'mg/m³')}`;
        return li;
    });
    byId('water-history').replaceChildren(...history);
}

function selectSite(feature) {
    reportRequest?.abort();
    report.hidden = true;
    const previousLayer = layers.get(selected?.id);
    selected = feature;
    const selectedLayer = layers.get(feature.id);
    if (selectedLayer) {
        previousLayer?.setStyle(footprintStyle(previousLayer.feature));
        selectedLayer.setStyle(footprintStyle(feature)).bringToFront();
        map.fitBounds(selectedLayer.getBounds(), {padding: [72, 56], maxZoom: 14, animate: false});
        setText('map-selection', nameOf(feature));
        byId('map-summary').hidden = false;
    }
    const site = feature.properties;
    const center = siteCenter(feature);
    picker.value = String(feature.id);
    setText('site-title', nameOf(feature));
    setText('site-date', `Архивно картографиране · ${formatMonth(site.Sat_date)}`);
    setMetric('site-area', site.area_ha, 'ха');
    setMetric('site-depth', site.depthlimit, 'м');
    setText('site-coordinates', `${center.latitude.toFixed(4)}° N  /  ${center.longitude.toFixed(4)}° E`);
    renderSatellite(feature);
    byId('site-details').hidden = false;
    footage.selectSite(feature.id, nameOf(feature));
}

function distanceKm(point, center) {
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = radians(point.latitude - center.latitude);
    const longitudeDelta = radians(point.longitude - center.longitude);
    const halfChordSquared = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(point.latitude)) * Math.cos(radians(center.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, halfChordSquared)));
}

async function runReport() {
    reportRequest?.abort();
    const request = new AbortController();
    reportRequest = request;
    const site = selected.properties;
    const center = siteCenter(selected);
    const observations = snapshot?.sites[String(selected.id)] ?? [];
    const latest = observations[0];
    const method = site.map_method.split('_').map(part => methods[part] ?? part).join(', ');
    setText('report-site', nameOf(selected));
    setText('report-archive', `${formatMonth(site.Sat_date)} · ${method}. ` +
        (site.groundtrth === 'yes' ? 'Теренната проверка е отбелязана в архива.' : 'Архивът няма потвърдена теренна проверка.'));
    setText('report-satellite', latest
        ? `${formatMonth(latest.month)} · мътност ${formatValue(latest.turbidity, 'FNU')} · хлорофил ${formatValue(latest.chlorophyll, 'mg/m³')}. Оценките описват повърхностните условия.`
        : 'Липсва валидна сателитна оценка за участъка.');
    setText('report-action', site.groundtrth === 'yes'
        ? 'Повтори заснемането по георефериран маршрут на съпоставима дълбочина. Запиши дата, видимост и покритие с морски треви.'
        : 'Провери по георефериран маршрут дали има морски треви. Запиши дълбочина, видимост и дата.');
    setText('report-measurements', 'Проверяваме записите…');
    byId('report-latest').hidden = true;
    report.hidden = false;
    byId('report-title').focus();

    try {
        const records = await fetchJson(workspace.dataset.measurementsUrl, {signal: request.signal});
        if (request.signal.aborted) return;
        const nearby = records.filter(record => record.demo === false
            && Number.isFinite(record.latitude) && Number.isFinite(record.longitude) && distanceKm(record, center) <= 2);
        setText('report-measurements', nearby.length === 0
            ? 'Няма въведени измервания с координати в този обхват.'
            : `Записи с посочен от подателя източник: ${number.format(nearby.length)}.`);
        if (nearby.length > 0) {
            const latestEntry = nearby[0];
            setText('report-latest', [
                measurementDate.format(new Date(latestEntry.date)),
                formatValue(latestEntry.temperature, '°C'),
                latestEntry.source
            ].join(' · '));
            byId('report-latest').hidden = false;
        }
    } catch {
        if (!request.signal.aborted) setText('report-measurements', 'Записите са недостъпни. Опитай отново.');
    }
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Request failed');
    return response.json();
}

async function loadAtlas() {
    const loadingSnapshot = fetchJson(workspace.dataset.satelliteUrl).catch(() => null);
    try {
        const archive = await fetchJson(workspace.dataset.archiveUrl);
        if (archive.type !== 'FeatureCollection' || !archive.features?.length) throw new Error('No archive features');
        const features = [...archive.features].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'bg'));
        snapshot = await loadingSnapshot;
        picker.replaceChildren(...features.map(feature => new Option(nameOf(feature), feature.id)));
        picker.disabled = false;
        picker.addEventListener('change', () => selectSite(features.find(feature => String(feature.id) === picker.value)));
        byId('run-report').addEventListener('click', runReport);
        setText('archive-status', `${number.format(features.length)} картографирани участъка`);
        initMap(archive);
        selectSite(features.find(feature => feature.properties.NAME === 'RavdaS1') ?? features[0]);
    } catch {
        picker.replaceChildren(new Option('Архивът е недостъпен'));
        byId('map').hidden = true;
        byId('reset-map').hidden = true;
        setText('archive-status', 'Архивът не се зареди. Презареди страницата, за да опиташ отново.');
    }
}

loadAtlas();
