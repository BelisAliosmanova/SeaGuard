window.setupFieldMission = (() => {
    'use strict';

    const statuses = {
        CONFIRMED: ['Потвърдено', 'confirmed', '#087a61'],
        NOT_VISIBLE: ['Не се виждат', 'not-visible', '#355e7d'],
        UNCLEAR: ['Нужен е нов кадър', 'unclear', '#946018']
    };
    const pending = ['За проверка', 'pending', '#2354a1'];
    const statusFor = point => statuses[point.review?.verdict] || pending;
    const byId = id => document.getElementById(id);
    const element = (tag, text, style) => {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (style) node.className = style;
        return node;
    };
    const svgElement = (tag, attributes) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        return node;
    };

    function drawOutline(svg, feature, points) {
        const geometry = feature?.geometry;
        const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
            : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
        const bounds = [...polygons.flat(2), ...points.map(point => [point.longitude, point.latitude])];
        const west = Math.min(...bounds.map(point => point[0]));
        const north = Math.max(...bounds.map(point => point[1]));
        const degrees = Math.cos(north * Math.PI / 180);
        const width = (Math.max(...bounds.map(point => point[0])) - west) * degrees;
        const height = north - Math.min(...bounds.map(point => point[1]));
        const scale = Math.min(278 / width, 134 / height);
        const project = ([lon, lat]) => [
            170 + (lon - west) * degrees * scale - width * scale / 2,
            95 + (north - lat) * scale - height * scale / 2
        ];
        const nodes = [];
        for (const polygon of polygons) {
            const path = polygon.map(ring =>
                'M' + ring.map(point => project(point).join(',')).join(' L') + ' Z').join(' ');
            nodes.push(svgElement('path', {d: path, class: 'mission-boundary', 'fill-rule': 'evenodd'}));
        }
        nodes.push(svgElement('polyline', {
            points: points.map(point => project([point.longitude, point.latitude]).join(',')).join(' '),
            class: 'mission-line'
        }));
        for (const point of points) {
            const [x, y] = project([point.longitude, point.latitude]);
            const group = svgElement('g', {});
            group.append(svgElement('circle', {cx: x, cy: y, r: 12, fill: statusFor(point)[2]}));
            const number = svgElement('text', {x, y, dy: '.35em', 'text-anchor': 'middle'});
            number.textContent = point.number;
            group.append(number);
            nodes.push(group);
        }
        svg.replaceChildren(...nodes);
    }

    function setup(root, {loadOutline, clearFootage, onPoints, onTasks}) {
        const plan = byId('mission-plan');
        const board = byId('mission-board');
        const list = byId('mission-points');
        const notice = byId('mission-status');
        const form = byId('mission-review');
        const capture = byId('mission-capture');
        const frameSelect = byId('mission-frame');
        const save = byId('mission-save');
        const saveStatus = byId('mission-save-status');
        let siteId, outline, active, analysis, operation;
        let points = [], frames = [];

        const missionUrl = () => root.dataset.endpoint + '/' + siteId;
        const pointUrl = point => missionUrl() + '/points/' + point.number + '/reviews';

        async function request(url, options) {
            const response = await fetch(url, options);
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(result.message || 'Blue root не успя да запише или зареди мисията. Опитай отново.');
                error.status = response.status;
                throw error;
            }
            return result;
        }

        async function load(selected) {
            const snapshot = await request(missionUrl());
            if (siteId !== selected) return;
            setPoints(snapshot);
        }

        function setPoints(next) {
            points = next;
            board.hidden = !points.length;
            plan.hidden = points.length > 0;
            list.replaceChildren(...points.map(pointCard));
            onPoints(points);
            if (points.length) drawOutline(byId('mission-outline'), outline, points);
        }

        function pointCard(point) {
            const item = element('li', null, 'mission-point');
            item.id = 'mission-point-' + point.number;
            item.tabIndex = -1;
            const [label, style] = statusFor(point);
            const heading = element('div', null, 'mission-point-heading');
            heading.append(element('strong', point.number + ' · ' + point.label),
                element('span', label, 'mission-badge ' + style));
            const coordinates = point.latitude.toFixed(5) + '° N · ' + point.longitude.toFixed(5) + '° E';
            item.append(heading, element('p', coordinates, 'mission-coordinate'), element('p', point.instruction));
            if (point.review) item.append(evidenceCard(point));
            if (!point.review || point.review.verdict === 'UNCLEAR') {
                const upload = element('button', point.review ? 'Добави повторна проверка' : 'Качи кадър за точката',
                    'button secondary small');
                upload.type = 'button';
                upload.addEventListener('click', () => startReview(point));
                item.append(upload);
            }
            return item;
        }

        function evidenceCard(point) {
            const {review} = point;
            const details = element('details', null, 'mission-evidence');
            details.append(element('summary', 'Виж запазения кадър'));
            const image = element('img');
            image.src = pointUrl(point) + '/' + review.id + '/frame';
            image.alt = 'Запазен подводен кадър за точка ' + point.number;
            image.loading = 'lazy';
            const when = review.capturedOn + ' · ' + Number(review.depthM).toLocaleString('bg-BG') + ' м';
            const timestamp = review.seconds == null ? '' :
                ' · кадър на ' + Number(review.seconds).toLocaleString('bg-BG', {maximumFractionDigits: 1}) + ' с';
            details.append(image, element('p', when + timestamp, 'mission-coordinate'));
            if (review.notes) details.append(element('p', review.notes));
            if (review.aiObservation) details.append(element('p', 'Наблюдение на Pickle · ' + review.aiObservation));
            return details;
        }

        function selectSite(id) {
            if (id === siteId) return;
            siteId = id;
            active = operation = outline = null;
            renderReview();
            setPoints([]);
            plan.disabled = true;
            notice.textContent = 'Зареждаме теренната мисия…';
            loadOutline(id).then(feature => {
                if (id !== siteId) return;
                outline = feature;
                if (points.length) drawOutline(byId('mission-outline'), outline, points);
            });
            load(id).then(() => {
                if (id === siteId) announceProgress();
            }).catch(error => {
                if (id === siteId) notice.textContent = error.message;
            }).finally(() => {
                if (id === siteId) plan.disabled = false;
            });
        }

        function announceProgress() {
            if (!points.length) {
                notice.textContent = 'Blue root ще предложи две точки в архивния контур на избрания участък.';
                return;
            }
            const finished = points.filter(point => point.review && point.review.verdict !== 'UNCLEAR').length;
            notice.textContent = finished + ' от ' + points.length + ' точки с резултат.';
        }

        function renderReview() {
            const selected = Boolean(active);
            form.hidden = capture.hidden = !selected;
            byId('footage-add-task').hidden = selected;
            byId('footage-task-status').hidden = selected;
            if (!selected) return;
            capture.textContent = 'Качваш кадри за точка ' + active.number + ' · ' + active.label + '.';
            byId('mission-review-title').textContent = 'Теренен преглед · точка ' + active.number;
            save.disabled = !frames.length || operation === active;
            byId('mission-ai-note').textContent = analysis?.observations?.[Number(frameSelect.value)] ||
                'Ако анализираш кадрите с Pickle, наблюдението за избрания кадър ще се добави към проверката.';
        }

        function startReview(point) {
            active = point;
            clearFootage();
            form.reset();
            saveStatus.textContent = '';
            renderReview();
            capture.scrollIntoView({block: 'start'});
            const input = byId('footage-file');
            input.focus({preventScroll: true});
            input.click();
        }

        plan.addEventListener('click', async () => {
            const selected = siteId;
            plan.disabled = true;
            notice.textContent = 'Планираме точките…';
            try {
                const snapshot = await request(missionUrl(), {method: 'POST', headers: {'X-SeaGuard-Mission': '1'}});
                if (siteId !== selected) return;
                setPoints(snapshot);
                announceProgress();
                onTasks();
                byId('mission-point-1')?.focus();
            } catch (error) {
                if (siteId !== selected) return;
                if (error.status === 409) {
                    await load(selected).then(() => {
                        if (siteId === selected) {
                            announceProgress();
                            onTasks();
                        }
                    }).catch(() => {
                        if (siteId === selected) notice.textContent = error.message;
                    });
                } else notice.textContent = error.message;
            } finally {
                if (siteId === selected) plan.disabled = false;
            }
        });

        byId('mission-cancel').addEventListener('click', () => {
            const number = active?.number;
            active = null;
            renderReview();
            if (number) byId('mission-point-' + number)?.focus();
        });
        frameSelect.addEventListener('change', renderReview);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const point = active;
            const selected = siteId;
            const index = Number(frameSelect.value);
            const frame = frames[index];
            if (!point || !frame || operation === point) return;
            const data = new FormData(form);
            data.set('frame', frame.blob, 'frame.jpg');
            if (frame.seconds != null) data.set('seconds', frame.seconds);
            if (point.review) data.set('previousReviewId', point.review.id);
            const observation = analysis?.observations?.[index];
            if (typeof observation === 'string') data.set('aiObservation', observation);
            operation = point;
            saveStatus.textContent = 'Записваме проверката…';
            renderReview();
            try {
                const result = await request(pointUrl(point), {
                    method: 'POST',
                    body: data,
                    headers: {'X-SeaGuard-Mission': '1'}
                });
                if (siteId !== selected) return;
                if (active === point) {
                    active = null;
                    clearFootage();
                    renderReview();
                }
                setPoints(points.map(item => item.number === result.number ? result : item));
                announceProgress();
                if (!active) byId('mission-point-' + result.number)?.focus();
                onTasks();
            } catch (error) {
                if (siteId === selected && active === point) saveStatus.textContent = error.message;
            } finally {
                if (operation === point) operation = null;
                if (siteId === selected) renderReview();
            }
        });

        return {
            selectSite,
            setFrames(id, prepared) {
                if (id !== siteId) return;
                frames = prepared;
                analysis = null;
                frameSelect.replaceChildren(...frames.map((frame, index) => {
                    const option = element('option', frame.label);
                    option.value = index;
                    return option;
                }));
                renderReview();
            },
            setAnalysis(id, data) {
                if (id !== siteId) return;
                analysis = data;
                renderReview();
            },
            focusPoint(number) {
                byId('mission-point-' + number)?.focus();
            }
        };
    }

    return setup;
})();
