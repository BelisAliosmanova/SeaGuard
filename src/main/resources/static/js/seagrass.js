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
const defaultSite = 'Gradina';
const measurementRadiusKm = 2;
const layers = new Map();
let archive;
let map;
let selected;
let reportRequest;

function setText(id, value) {
    byId(id).textContent = value;
}

function formatMeasurement(value, unit) {
    return Number.isFinite(value) ? `${number.format(value)} ${unit}` : 'Няма данни';
}

function mappingMethod(value) {
    return value.split('_').map(method => methods[method] ?? method).join(', ');
}

function showMapStatus(message) {
    setText('map-status', message);
    byId('map-status').hidden = false;
}

function footprintStyle(feature) {
    const active = feature.id === selected?.id;
    return {
        color: active ? '#934a1c' : '#176b60',
        weight: active ? 3 : 1.6,
        fillColor: active ? '#eea75f' : '#5bac95',
        fillOpacity: active ? .65 : .53
    };
}

function fitSite(layer) {
    map.fitBounds(layer.getBounds(), {padding: [52, 52], maxZoom: 15, animate: false});
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
        fitSite(selectedLayer);
    }
    const site = feature.properties;
    picker.value = String(feature.id);
    setText('site-title', site.NAME);
    setText('site-area', formatMeasurement(site.area_ha, 'ха'));
    setText('site-depth', formatMeasurement(site.depthlimit, 'м'));
    setText('satellite-date', /^\d{4}-\d{2}$/.test(site.Sat_date)
        ? month.format(new Date(`${site.Sat_date}-01T00:00:00Z`))
        : 'Няма данни');
    setText('mapping-method', mappingMethod(site.map_method));
    setText('field-check', site.groundtrth === 'yes' ? 'Отбелязана в архива' : 'Без потвърдена проверка');
    byId('site-details').hidden = false;
}

function initMap() {
    if (typeof L === 'undefined') {
        byId('map').hidden = true;
        byId('reset-map').hidden = true;
        showMapStatus('Картата е недостъпна. Избери участък от списъка.');
        return;
    }
    map = L.map('map', {scrollWheelZoom: false});
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    tiles.on('tileerror', () => showMapStatus('Фоновата карта не се зареди изцяло. Границите от архива са достъпни.'));
    const footprints = L.geoJSON(archive, {
        style: footprintStyle,
        onEachFeature(feature, layer) {
            const label = document.createElement('span');
            label.textContent = feature.properties.NAME;
            layer.bindTooltip(label, {sticky: true});
            layer.on('click', () => selectSite(feature));
            layers.set(feature.id, layer);
        }
    }).addTo(map);
    const reset = byId('reset-map');
    reset.disabled = false;
    reset.addEventListener('click', () => map.fitBounds(footprints.getBounds(), {padding: [28, 28]}));
}

function siteCenter(feature) {
    // Bounds work with all rings of both Polygon and MultiPolygon geometries.
    const rings = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat();
    const positions = rings.flat();
    const latitudes = positions.map(position => position[1]);
    const longitudes = positions.map(position => position[0]);
    return {
        latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2
    };
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
    setText('report-site', site.NAME);
    setText('report-archive', site.groundtrth === 'yes'
        ? 'Архивът съдържа граници на участъка и отбелязана теренна проверка при картографирането.'
        : 'Архивът съдържа граници на участъка. Полето за теренна проверка е отбелязано с „не“.');
    setText('report-action', site.groundtrth === 'yes'
        ? 'Заснеми отново участъка по георефериран маршрут на съпоставима дълбочина. Запиши видимостта, покритието с трева и датата.'
        : 'Провери с геореферирани подводни снимки дали в участъка има морски треви. Запиши дълбочината, видимостта и датата.');
    setText('report-measurements', 'Проверка на записите…');
    byId('report-latest').hidden = true;
    report.hidden = false;
    byId('report-title').focus();

    try {
        const response = await fetch(workspace.dataset.measurementsUrl, {signal: request.signal});
        if (!response.ok) throw new Error('Measurements unavailable');
        const measurements = await response.json();
        if (request.signal.aborted) return;
        const nearby = measurements.filter(record =>
            record.demo === false && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
            && distanceKm(record, center) <= measurementRadiusKm);
        setText('report-measurements', nearby.length === 0
            ? 'Няма въведени измервания с координати в този обхват.'
            : nearby.length === 1 ? '1 въведено измерване в обхвата.'
                : `${number.format(nearby.length)} въведени измервания в обхвата.`);
        if (nearby.length > 0) {
            const latest = nearby[0];
            const details = [
                measurementDate.format(new Date(latest.date)),
                formatMeasurement(latest.temperature, '°C'),
                latest.source
            ];
            setText('report-latest', details.join(' · '));
            byId('report-latest').hidden = false;
        }
    } catch {
        if (!request.signal.aborted) {
            setText('report-measurements', 'Записите са недостъпни. Опитай да пуснеш разследването отново.');
        }
    }
}

async function loadArchive() {
    try {
        const response = await fetch(workspace.dataset.archiveUrl);
        if (!response.ok) throw new Error('Archive unavailable');
        archive = await response.json();
        if (archive.type !== 'FeatureCollection' || !archive.features?.length) {
            throw new Error('No archive features');
        }
    } catch {
        picker.replaceChildren(new Option('Архивът е недостъпен'));
        byId('map').hidden = true;
        byId('reset-map').hidden = true;
        setText('archive-status', 'Архивът не се зареди. Презареди страницата, за да опиташ отново.');
        return;
    }
    const features = [...archive.features].sort((a, b) => a.properties.NAME.localeCompare(b.properties.NAME));
    picker.replaceChildren(...features.map(feature => new Option(feature.properties.NAME, feature.id)));
    picker.disabled = false;
    picker.addEventListener('change', () => selectSite(features.find(feature => String(feature.id) === picker.value)));
    byId('run-report').addEventListener('click', runReport);
    setText('archive-status', `${number.format(features.length)} участъка от архива на SEANOE`);
    initMap();
    selectSite(features.find(feature => feature.properties.NAME === defaultSite) ?? features[0]);
}

loadArchive();
