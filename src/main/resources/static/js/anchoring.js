window.setupAnchoring = (() => {
    'use strict';

    const RADIUS = 6371007.18;
    const RAD = Math.PI / 180;
    const MAP_WIDTH = 720;
    const MAP_HEIGHT = 400;
    const metres = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 0});
    const percent = new Intl.NumberFormat('bg-BG', {style: 'percent', maximumFractionDigits: 1});
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

    function projection(longitude, latitude) {
        const originLat = latitude * RAD;
        const sinOrigin = Math.sin(originLat);
        const cosOrigin = Math.cos(originLat);
        return {
            toLocal([lon, lat]) {
                const delta = (lon - longitude) * RAD;
                const phi = lat * RAD;
                const sinLat = Math.sin(phi);
                const cosLat = Math.cos(phi);
                const factor = RADIUS * Math.sqrt(2 / (1 + sinOrigin * sinLat + cosOrigin * cosLat * Math.cos(delta)));
                return [factor * cosLat * Math.sin(delta), factor * (cosOrigin * sinLat - sinOrigin * cosLat * Math.cos(delta))];
            },
            toGeo(x, y) {
                const distance = Math.hypot(x, y);
                if (!distance) return [longitude, latitude];
                const angle = 2 * Math.asin(distance / (2 * RADIUS));
                const sinAngle = Math.sin(angle);
                const cosAngle = Math.cos(angle);
                const phi = Math.asin(cosAngle * sinOrigin + y * sinAngle * cosOrigin / distance);
                const delta = Math.atan2(x * sinAngle, distance * cosOrigin * cosAngle - y * sinOrigin * sinAngle);
                return [longitude + delta / RAD, phi / RAD];
            }
        };
    }

    function bounds(points) {
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        return {left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys)};
    }

    function rectangle(zone) {
        return {
            left: zone.x - zone.width / 2, right: zone.x + zone.width / 2,
            bottom: zone.y - zone.length / 2, top: zone.y + zone.length / 2
        };
    }

    function clip(ring, axis, edge, keepGreater) {
        const output = [];
        if (!ring.length) return output;
        const inside = value => keepGreater ? value >= edge : value <= edge;
        let previous = ring.at(-1);
        for (const point of ring) {
            const wasInside = inside(previous[axis]);
            const isInside = inside(point[axis]);
            if (wasInside !== isInside) {
                const other = 1 - axis;
                const fraction = (edge - previous[axis]) / (point[axis] - previous[axis]);
                const offset = previous[other] + fraction * (point[other] - previous[other]);
                output.push(axis === 0 ? [edge, offset] : [offset, edge]);
            }
            if (isInside) output.push(point);
            previous = point;
        }
        return output;
    }

    function ringArea(ring) {
        let twice = 0;
        for (let i = 0; i < ring.length; i++) {
            const [x, y] = ring[i];
            const [nextX, nextY] = ring[(i + 1) % ring.length];
            twice += x * nextY - y * nextX;
        }
        return Math.abs(twice) / 2;
    }

    // The opposing edges added along a clip boundary cancel in the area sum, even for concave rings.
    function overlap(polygons, zone) {
        const box = rectangle(zone);
        let total = 0;
        for (const polygon of polygons) {
            polygon.forEach((ring, index) => {
                let clipped = clip(ring, 0, box.left, true);
                clipped = clip(clipped, 0, box.right, false);
                clipped = clip(clipped, 1, box.bottom, true);
                clipped = clip(clipped, 1, box.top, false);
                total += (index === 0 ? 1 : -1) * ringArea(clipped);
            });
        }
        return total < 1e-6 ? 0 : Math.min(total, zone.width * zone.length);
    }

    function prepare(geometry) {
        const geographic = geometry?.type === 'Polygon' ? [geometry.coordinates]
            : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
        const coordinates = geographic.flat(2);
        if (!coordinates.length) return null;
        const box = bounds(coordinates);
        const projector = projection((box.left + box.right) / 2, (box.bottom + box.top) / 2);
        const polygons = geographic.map(polygon => polygon.map(ring => ring.map(projector.toLocal)));
        const local = bounds(polygons.flat(2));
        if (!(local.right > local.left && local.top > local.bottom)) return null;
        const scale = Math.min(MAP_WIDTH / (local.right - local.left + 300), MAP_HEIGHT / (local.top - local.bottom + 300));
        const centerX = (local.left + local.right) / 2;
        const centerY = (local.bottom + local.top) / 2;
        const view = {
            left: centerX - MAP_WIDTH / (2 * scale), right: centerX + MAP_WIDTH / (2 * scale),
            bottom: centerY - MAP_HEIGHT / (2 * scale), top: centerY + MAP_HEIGHT / (2 * scale)
        };
        return {polygons, local, view, scale, projector};
    }

    function initialZone({polygons, local}) {
        const span = Math.min(local.right - local.left, local.top - local.bottom);
        const width = clamp(Math.round(span / 12) * 5, 25, 105);
        const length = clamp(Math.round(width * .15) * 5, 20, 80);
        const center = {x: (local.left + local.right) / 2, y: (local.bottom + local.top) / 2, width, length};
        let best = center;
        let area = overlap(polygons, best);
        for (let row = 1; row < 7 && area < width * length - .01; row++) {
            for (let col = 1; col < 7; col++) {
                const zone = {
                    ...center,
                    x: local.left + (local.right - local.left) * col / 7,
                    y: local.bottom + (local.top - local.bottom) * row / 7
                };
                const next = overlap(polygons, zone);
                if (next > area) { best = zone; area = next; }
            }
        }
        return best;
    }

    function squareMetres(area) {
        if (area === 0) return '0 м²';
        if (area < 1) return 'под 1 м²';
        return metres.format(area) + ' м²';
    }

    function setup(root, {loadOutline, addTask}) {
        const get = id => root.querySelector('#' + id);
        const map = get('anchor-map');
        const handle = get('anchor-candidate');
        const widthInput = get('anchor-width');
        const lengthInput = get('anchor-length');
        const task = get('anchor-task');
        const status = get('anchor-status');
        let siteId, state, drag, revision = 0;

        function screen(x, y) {
            return [(x - state.view.left) * state.scale, (state.view.top - y) * state.scale];
        }

        function drawOutline() {
            const path = state.polygons.flatMap(polygon => polygon.map(ring =>
                'M' + ring.map(([x, y]) => screen(x, y).map(value => value.toFixed(3)).join(',')).join(' L') + ' Z'
            )).join(' ');
            get('anchor-outline').setAttribute('d', path);
            get('anchor-clip-outline').setAttribute('d', path);
            const length = [10, 20, 50, 100, 200, 500, 1000, 2000].filter(value => value * state.scale <= 110).at(-1) || 10;
            const right = 22 + length * state.scale;
            get('anchor-scale-line').setAttribute('d', 'M22 368v6h' + (right - 22) + 'v-6');
            get('anchor-scale-label').textContent = metres.format(length) + ' м';
        }

        function drawRect(id, zone) {
            const box = rectangle(zone);
            const [x, y] = screen(box.left, box.top);
            const node = get(id);
            node.setAttribute('x', x);
            node.setAttribute('y', y);
            node.setAttribute('width', zone.width * state.scale);
            node.setAttribute('height', zone.length * state.scale);
        }

        function drawLabel(id, zone) {
            const [x, y] = screen(zone.x, zone.y);
            get(id).setAttribute('x', x);
            get(id).setAttribute('y', y);
        }

        const zoneKey = zone => [zone.x.toFixed(2), zone.y.toFixed(2), zone.width, zone.length].join('/');
        const same = () => zoneKey(state.a) === zoneKey(state.b);

        function readout(label, area, zone) {
            get('anchor-area-' + label).textContent = squareMetres(area);
            get('anchor-share-' + label).textContent = percent.format(area / (zone.width * zone.length)) +
                ' от зоната · ' + zone.width + ' × ' + zone.length + ' м';
        }

        function render() {
            const {a, b} = state;
            const areaA = state.areaA;
            const areaB = overlap(state.polygons, b);
            drawRect('anchor-baseline', a);
            drawRect('anchor-candidate', b);
            drawRect('anchor-overlap', b);
            drawLabel('anchor-label-a', a);
            drawLabel('anchor-label-b', b);
            get('anchor-label-a').setAttribute('visibility', same() ? 'hidden' : 'visible');
            readout('a', areaA, a);
            readout('b', areaB, b);
            const difference = areaB - areaA;
            get('anchor-difference').textContent = Math.abs(difference) < .5 ? 'Припокриването е приблизително еднакво.' :
                'Вариант Б има ' + squareMetres(Math.abs(difference)) + (difference < 0 ? ' по-малко' : ' повече') + ' припокриване.';
            widthInput.value = b.width;
            lengthInput.value = b.length;
            get('anchor-width-value').textContent = b.width + ' м';
            get('anchor-length-value').textContent = b.length + ' м';
            get('anchor-reset').disabled = same();
            get('anchor-keep').disabled = same();
            task.disabled = state.saving || state.saved.has(zoneKey(b));
        }

        function position(x, y) {
            const {b, view} = state;
            b.x = clamp(x, view.left + b.width / 2, view.right - b.width / 2);
            b.y = clamp(y, view.bottom + b.length / 2, view.top - b.length / 2);
            if (!state.saving) status.textContent = '';
            render();
        }

        function location(event) {
            const transform = map.getScreenCTM();
            if (!transform) return null;
            const point = map.createSVGPoint();
            point.x = event.clientX;
            point.y = event.clientY;
            const local = point.matrixTransform(transform.inverse());
            return [state.view.left + local.x / state.scale, state.view.top - local.y / state.scale];
        }

        map.addEventListener('pointerdown', event => {
            if (!state || drag || event.button !== 0) return;
            const local = location(event);
            if (!local) return;
            const [x, y] = local;
            const box = rectangle(state.b);
            const inside = x >= box.left && x <= box.right && y >= box.bottom && y <= box.top;
            drag = {id: event.pointerId, dx: inside ? state.b.x - x : 0, dy: inside ? state.b.y - y : 0};
            map.setPointerCapture(event.pointerId);
            handle.focus({preventScroll: true});
            if (!inside) position(x, y);
        });
        map.addEventListener('pointermove', event => {
            if (!state || drag?.id !== event.pointerId) return;
            const local = location(event);
            if (local) position(local[0] + drag.dx, local[1] + drag.dy);
        });
        map.addEventListener('lostpointercapture', () => { drag = null; });

        const arrows = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1]};
        handle.addEventListener('keydown', event => {
            if (!state || !Object.hasOwn(arrows, event.key)) return;
            event.preventDefault();
            const [x, y] = arrows[event.key];
            position(state.b.x + 10 * x, state.b.y + 10 * y);
        });

        for (const [input, key] of [[widthInput, 'width'], [lengthInput, 'length']]) {
            input.addEventListener('input', () => {
                if (!state) return;
                state.b[key] = Number(input.value);
                position(state.b.x, state.b.y);
            });
        }

        get('anchor-keep').addEventListener('click', () => {
            state.a = {...state.b};
            state.areaA = overlap(state.polygons, state.a);
            render();
        });
        get('anchor-reset').addEventListener('click', () => {
            state.b = {...state.a};
            status.textContent = '';
            render();
        });

        task.addEventListener('click', async () => {
            const active = state;
            const id = siteId;
            const b = {...active.b};
            const key = zoneKey(b);
            if (active.saving || active.saved.has(key)) return;
            const [longitude, latitude] = active.projector.toGeo(b.x, b.y);
            const area = overlap(active.polygons, b);
            active.saving = true;
            status.textContent = 'Записваме предложената зона…';
            render();
            let saved = false;
            try {
                saved = await addTask({
                    title: 'Провери предложена зона за закотвяне',
                    priority: 'Рутинно', origin: 'user',
                    reason: 'Център ' + latitude.toFixed(6) + '° N · ' + longitude.toFixed(6) + '° E. ' +
                        'Размер ' + b.width + ' × ' + b.length + ' м. Припокриване с архивния контур ' +
                        squareMetres(area) + '. Провери дъното и условията на място.'
                }, id);
            } finally {
                if (state !== active) return;
                active.saving = false;
                if (saved) active.saved.add(key);
                status.textContent = saved ? 'Зоната е добавена в плана за терена.' : 'Задачата не се записа. Опитай отново.';
                render();
            }
        });

        return {
            async selectSite(id) {
                if (id === siteId) return;
                siteId = id;
                const version = ++revision;
                state = drag = null;
                status.textContent = '';
                const loading = get('anchor-loading');
                const board = get('anchor-board');
                board.hidden = true;
                loading.hidden = false;
                loading.textContent = 'Зареждаме архивния контур…';
                const feature = await loadOutline(id);
                if (version !== revision) return;
                const prepared = prepare(feature?.geometry);
                if (!prepared) {
                    loading.textContent = 'Архивният контур за този участък не е наличен.';
                    return;
                }
                const a = initialZone(prepared);
                state = {...prepared, a, b: {...a}, areaA: overlap(prepared.polygons, a), saved: new Set(), saving: false};
                drawOutline();
                render();
                loading.hidden = true;
                board.hidden = false;
            }
        };
    }

    return setup;
})();
