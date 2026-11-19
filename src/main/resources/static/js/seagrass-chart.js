const svgNS = 'http://www.w3.org/2000/svg';
const units = {turbidity: 'FNU', chlorophyll: 'mg/m³'};
const formatNumber = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 2});
const shortMonths = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const fullMonth = new Intl.DateTimeFormat('bg-BG', {month: 'long', year: 'numeric', timeZone: 'UTC'});

function svgNode(name, attributes, text) {
    const node = document.createElementNS(svgNS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
}

function monthIndex(month) {
    const [year, index] = month.split('-').map(Number);
    return year * 12 + index - 1;
}

function dateFor(index) {
    return new Date(Date.UTC(Math.floor(index / 12), index % 12, 1));
}

function gridStep(maximum) {
    const target = maximum / 4;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const normalized = target / magnitude;
    const nearest = [1, 2, 2.5, 5, 10].reduce((best, step) =>
        Math.abs(step - normalized) < Math.abs(best - normalized) ? step : best);
    return nearest * magnitude;
}

export function setupWaterChart(figure, controls) {
    const wrapper = figure.querySelector('.water-chart');
    const svg = wrapper.querySelector('svg');
    const caption = figure.querySelector('figcaption');
    const buttons = [...controls.querySelectorAll('button')];
    let metric = 'turbidity';
    let rows = [];
    let activeMonth;

    function highlight(point) {
        activeMonth = point.index;
        caption.textContent = `${fullMonth.format(dateFor(point.index))} · ${formatNumber.format(point.value)} ${units[metric]}`;
        svg.querySelectorAll('[data-month]').forEach(node => {
            node.classList.toggle('is-current', Number(node.dataset.month) === activeMonth);
        });
    }

    function draw() {
        if (rows.length === 0 || !wrapper.clientWidth) return;
        const width = wrapper.clientWidth;
        const height = wrapper.clientHeight;
        const left = 36;
        const right = width - 17;
        const bottom = height - 31;
        const top = 14;
        const first = monthIndex(rows[0].month);
        const last = monthIndex(rows.at(-1).month);
        const max = Math.max(...rows.map(row => row[metric]), 0.1);
        const step = gridStep(max * 1.05);
        const limit = step * Math.ceil(max * 1.05 / step);
        const x = index => first === last ? (left + right) / 2 : left + (right - left) * (index - first) / (last - first);
        const y = value => bottom - (bottom - top) * value / limit;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const grid = [];
        for (let i = 0; i <= Math.round(limit / step); i++) {
            const value = step * i;
            grid.push(svgNode('line', {x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-gridline'}));
            grid.push(svgNode('text', {x: left - 7, y: y(value) + 4, 'text-anchor': 'end'}, formatNumber.format(value)));
        }
        const labelInterval = Math.max(1, Math.ceil((last - first + 1) * 34 / (right - left)));
        for (let i = first; i <= last; i++) {
            if (i !== last && (i - first) % labelInterval !== 0) continue;
            grid.push(svgNode('text', {x: x(i), y: bottom + 21, 'text-anchor': 'middle'}, shortMonths[i % 12]));
        }
        const points = rows.map(row => ({index: monthIndex(row.month), value: row[metric]}));
        const groups = [];
        for (const point of points) {
            const group = groups.at(-1);
            if (!group || point.index !== group.at(-1).index + 1) groups.push([point]);
            else group.push(point);
        }
        const paths = groups.flatMap(group => {
            if (group.length === 1) return [];
            const line = group.map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(point.index)} ${y(point.value)}`).join(' ');
            const area = `${line} L ${x(group.at(-1).index)} ${bottom} L ${x(group[0].index)} ${bottom} Z`;
            return [svgNode('path', {d: area, class: 'chart-area'}), svgNode('path', {d: line, class: 'chart-line'})];
        });
        const selected = points.find(point => point.index === activeMonth) ?? points.at(-1);
        const markers = points.map(point => {
            const position = {cx: x(point.index), cy: y(point.value)};
            const group = svgNode('g', {'data-month': point.index});
            group.append(svgNode('circle', {...position, r: 4, class: 'chart-marker'}));
            const hit = svgNode('circle', {...position, r: 15, class: 'chart-hit'});
            hit.addEventListener('pointerenter', () => highlight(point));
            hit.addEventListener('click', () => highlight(point));
            group.append(hit);
            return group;
        });
        svg.replaceChildren(...grid, ...paths, ...markers);
        highlight(selected);
    }

    buttons.forEach(button => button.addEventListener('click', () => {
        metric = button.dataset.metric;
        buttons.forEach(item => item.setAttribute('aria-pressed', item === button));
        draw();
    }));
    new ResizeObserver(draw).observe(wrapper);

    return observations => {
        rows = [...observations].sort((a, b) => a.month.localeCompare(b.month));
        activeMonth = undefined;
        controls.hidden = figure.hidden = rows.length === 0;
        draw();
    };
}
