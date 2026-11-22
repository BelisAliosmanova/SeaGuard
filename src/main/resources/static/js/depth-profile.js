// Water-column cross-section: light decays with depth (Beer-Lambert), the meadow sits on a sloping seabed.
window.DepthProfile = (() => {
    'use strict';
    const SVG = 'http://www.w3.org/2000/svg';
    const fmt = (v, d = 1) => v == null ? '—' : Number(v).toLocaleString('bg-BG', {
        minimumFractionDigits: d,
        maximumFractionDigits: d
    });

    function draw(svg, captionEl, o) {

        svg.replaceChildren();
        const W = 300, top = 22, bottom = 214, left = 38, right = 292;
        const node = (tag, attrs, text) => {
            const n = document.createElementNS(SVG, tag);
            for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
            if (text != null) n.textContent = text;
            svg.append(n);
            return n;
        };
        const kd = o.kd ?? 0.25, depth = o.depthM;
        const maxZ = Math.max(Math.ceil(depth * 1.3), 6);
        const y = z => top + (z / maxZ) * (bottom - top);
        const light = z => Math.exp(-kd * z);
        const mix = (t) => { // 1 = bright shallow water, 0 = dark
            const a = [215, 220, 220], b = [98, 107, 109];
            return `rgb(${a.map((v, i) => Math.round(b[i] + (v - b[i]) * t)).join(',')})`;
        };
        const defs = node('defs', {});
        const grad = document.createElementNS(SVG, 'linearGradient');
        grad.setAttribute('id', 'water');
        grad.setAttribute('x1', 0);
        grad.setAttribute('x2', 0);
        grad.setAttribute('y1', 0);
        grad.setAttribute('y2', 1);
        for (let i = 0; i <= 10; i++) {
            const z = maxZ * i / 10, st = document.createElementNS(SVG, 'stop');
            st.setAttribute('offset', i / 10);
            st.setAttribute('stop-color', mix(Math.pow(light(z), .6)));
            grad.append(st);
        }
        defs.append(grad);
        node('rect', {x: left, y: top, width: right - left, height: bottom - top, fill: 'url(#water)'});
        // Seabed drops quickly from the shore, then levels off offshore.
        const shape = 0.85;
        const seabedZ = x => 0.4 + Math.pow((x - left) / (right - left), shape) * (maxZ - 0.4);
        const xAtZ = z => left + Math.pow(Math.max(0, z - 0.4) / (maxZ - 0.4), 1 / shape) * (right - left);
        const pts = [];
        for (let x = left; x <= right; x += 4) pts.push(`${x},${y(seabedZ(x)).toFixed(1)}`);
        node('polygon', {points: `${left},${bottom + 8} ${pts.join(' ')} ${right},${bottom + 8}`, fill: '#515859'});
        node('polyline', {points: pts.join(' '), fill: 'none', stroke: '#353b3c', 'stroke-width': 1.2});
        // Meadow: blades along the seabed down to the depth limit, coloured by light reaching them.
        for (let x = left + 5; x < right; x += 7) {
            const z = seabedZ(x);
            if (z > depth) break;
            const L = light(z), base = y(z) + 1;
            const colour = L >= .2 ? 'var(--marker-low)' : L >= .11 ? 'var(--marker-elevated)' : 'var(--marker-high)';
            const h = 10 + 14 * Math.min(1, L * 2);
            node('path', {
                d: `M${x},${base} q-3,${-h / 2} 1,${-h}`,
                stroke: colour,
                'stroke-width': 2,
                fill: 'none',
                'stroke-linecap': 'round'
            });
            node('path', {
                d: `M${x + 2.5},${base} q4,${-h / 2.2} 1,${-h * .82}`,
                stroke: colour,
                'stroke-width': 1.6,
                fill: 'none',
                'stroke-linecap': 'round',
                opacity: .85
            });
        }
        // Light thresholds as isolines.
        for (const [frac, label] of [[.2, '20 % светлина'], [.11, '11 % критично']]) {
            const z = Math.log(1 / frac) / kd;
            if (z >= maxZ) continue;
            node('line', {
                x1: left,
                x2: right,
                y1: y(z),
                y2: y(z),
                stroke: '#ffffffcc',
                'stroke-dasharray': '4 4',
                'stroke-width': 1
            });
            node('text', {
                x: left + 6,
                y: y(z) - 4,
                fill: '#fff',
                'font-size': 10,
                'font-weight': 600,
                stroke: '#0000004d',
                'stroke-width': 2,
                'paint-order': 'stroke'
            }, label);
        }
        // Depth axis.
        for (let z = 0; z <= maxZ; z += maxZ > 10 ? 4 : 2) {
            node('line', {x1: left - 4, x2: left, y1: y(z), y2: y(z), stroke: 'var(--control)'});
            node('text', {
                x: left - 7,
                y: y(z) + 3.5,
                'text-anchor': 'end',
                fill: 'var(--muted)',
                'font-size': 10
            }, z + ' m');
        }
        // Depth-limit marker.
        const xLimit = xAtZ(depth);
        node('line', {x1: xLimit, x2: xLimit, y1: top, y2: y(depth), stroke: '#ffffffaa', 'stroke-dasharray': '2 3'});
        node('circle', {cx: xLimit, cy: y(depth), r: 4.5, fill: '#fff', stroke: '#1d1d1f', 'stroke-width': 1.5});
        const tag = o.lightPct == null ? 'няма данни' : `${fmt(o.lightPct, 0)} % на ${fmt(depth, 0)} m`;
        const tx = Math.max(left + 2, Math.min(xLimit + 8, right - 94));
        node('rect', {x: tx, y: top + 6, width: 92, height: 20, rx: 5, fill: 'var(--accent)'});
        node('text', {
            x: tx + 46,
            y: top + 20,
            'text-anchor': 'middle',
            fill: '#fff',
            'font-size': 11,
            'font-weight': 600
        }, tag);
        node('text', {
            x: left + 4,
            y: top - 8,
            fill: 'var(--muted)',
            'font-size': 10
        }, `Повърхност · Kd ≈ ${fmt(kd, 2)} m⁻¹`);
        captionEl.textContent = o.lightPct == null
            ? 'Няма сателитни данни за мътността над участъка.'
            : `До долната граница на ливадата стигат около ${fmt(o.lightPct, 0)} % от слънчевата светлина${o.depthAssumed ? ' (дълбочината е приета 5 m)' : ''}.`;
    }

    return {draw};
})();
