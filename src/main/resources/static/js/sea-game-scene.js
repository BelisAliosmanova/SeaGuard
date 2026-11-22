import {route} from './sea-game-model.js';

const wobble = (seed, rate, time) => Math.sin(seed + rate * time);
const random = seed => {
    const value = Math.sin(seed * 78.233 + 13.187) * 43758.5453;
    return value - Math.floor(value);
};
const plantSeeds = Array.from({length: 90}, (_, i) =>
    Array.from({length: 4}, (_, j) => random(i * 4 + j)));

function fill(context, color, commands) {
    context.fillStyle = color;
    context.beginPath();
    commands();
    context.fill();
}

function fishShape(ctx, x, y, size, direction, tint, tail) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(direction * size, size);
    fill(ctx, tint[1], () => {
        ctx.moveTo(-.54, 0);
        ctx.lineTo(-1, -.32 + tail);
        ctx.lineTo(-.88, tail);
        ctx.lineTo(-1, .32 + tail);
        ctx.closePath();
        ctx.moveTo(-.42, -.13);
        ctx.quadraticCurveTo(-.2, -.56, .16, -.32);
        ctx.lineTo(.12, -.1);
    });
    const sheen = ctx.createLinearGradient(0, -.35, 0, .35);
    sheen.addColorStop(0, tint[1]);
    sheen.addColorStop(.55, tint[0]);
    sheen.addColorStop(1, tint[1]);
    fill(ctx, sheen, () => {
        ctx.moveTo(-.65, 0);
        ctx.bezierCurveTo(-.26, -.46, .49, -.4, .7, -.04);
        ctx.bezierCurveTo(.57, .36, -.19, .45, -.65, 0);
    });
    fill(ctx, '#061d28', () => ctx.arc(.43, -.09, .075, 0, Math.PI * 2));
    ctx.restore();
}

const tones = [['#c6fef0', '#3a93a3'], ['#ffe2a3', '#b9704b'], ['#8de7d5', '#317b74']];

export function createScene(canvas) {
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let scale = 1;
    new ResizeObserver(([entry]) => {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
        scale = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
    }).observe(canvas);

    let lastPlayer;
    let lastTime;
    let swimmer;
    let predator;
    return function draw(bay, time, player, caseType) {
        if (!width || !height) return;
        const w = width;
        const h = height;
        const clarity = bay.clarity / 100;
        const growth = bay.grass / 100;
        const movement = 1 - Math.exp(-16 * Math.max(0, time - (lastTime ?? time)));
        lastTime = time;
        if (!player || lastPlayer !== player || !movement) {
            swimmer = player && [player.x, player.y];
            predator = player && [...player.predator];
        } else {
            swimmer[0] += (player.x - swimmer[0]) * movement;
            swimmer[1] += (player.y - swimmer[1]) * movement;
            predator[0] += (player.predator[0] - predator[0]) * movement;
            predator[1] += (player.predator[1] - predator[1]) * movement;
        }
        lastPlayer = player;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        const water = ctx.createLinearGradient(0, 0, 0, h);
        water.addColorStop(0, clarity > .45 ? '#198595' : '#526858');
        water.addColorStop(.48, '#124352');
        water.addColorStop(1, '#071b26');
        ctx.fillStyle = water;
        ctx.fillRect(0, 0, w, h);
        const sun = ctx.createRadialGradient(w * .26, 0, 0, w * .26, 0, h * .85);
        sun.addColorStop(0, 'rgba(158,255,226,' + clarity * .7 + ')');
        sun.addColorStop(1, 'transparent');
        ctx.fillStyle = sun;
        ctx.fillRect(0, 0, w, h);
        const ray = ctx.createLinearGradient(0, 0, 0, h * .86);
        ray.addColorStop(0, 'rgba(185,255,235,' + clarity * .23 + ')');
        ray.addColorStop(1, 'transparent');
        for (let i = 0; i < 8; i++) {
            const x = w * (.11 * i - .08) + wobble(i, .48, time) * 16;
            fill(ctx, ray, () => {
                ctx.moveTo(x, 0);
                ctx.lineTo(x + w * .028, 0);
                ctx.lineTo(x + w * .32, h * .86);
                ctx.lineTo(x + w * .17, h * .86);
            });
        }

        ctx.strokeStyle = 'rgba(196,255,238,' + clarity * .32 + ')';
        for (let row = 0; row < 5; row++) {
            ctx.beginPath();
            for (let x = 0; x < w + 8; x += 8) {
                const y = 7 + row * 6 + wobble(x / 25 + row, 1.1, time) * 3;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        fill(ctx, '#153536', () => {
            ctx.moveTo(0, h * .86);
            ctx.bezierCurveTo(w * .4, h * .74, w * .58, h * .94, w, h * .83);
            ctx.lineTo(w, h);
            ctx.lineTo(0, h);
        });

        for (let i = 0; i < 58; i++) {
            const x = (random(i + 125) * w + time * (3 + i % 8)) % w;
            const y = ((random(i + 205) * h - time * (3 + i % 6)) % h + h) % h;
            fill(ctx, 'rgba(221,248,216,' + (.08 + (1 - clarity) * .26) + ')',
                () => ctx.arc(x, y, .6 + i % 3 * .5, 0, Math.PI * 2));
        }

        const drawGrass = foreground => plantSeeds.forEach(([seed, depth, length, hue], index) => {
            if ((depth > .54) !== foreground) return;
            const patch = Math.floor(seed * route.cover.length);
            const cover = route.cover[patch][0];
            const x = w * (player ? cover + (depth - .5) * .19 : seed);
            if (player?.round === 2 && patch !== 0) return;
            if (!player && index / plantSeeds.length > .23 + .77 * growth) return;
            if (caseType === 'anchors' && Math.abs(seed - .39 - depth * .13) < .075) return;
            const y = h * (.83 + depth * .16);
            const blade = h * (.11 + length * .25) * (.35 + .65 * growth);
            const bend = blade * (.18 + wobble(hue * 7 + depth, 1.9, time) * .23);
            const shade = 17 + hue * 13 + depth * 8;
            fill(ctx, 'hsl(' + (44 + growth * 107) + ' 63% ' + shade + '%)', () => {
                ctx.moveTo(x - 2, y);
                ctx.quadraticCurveTo(x - 4, y - blade * .62, x + bend, y - blade);
                ctx.quadraticCurveTo(x + 8, y - blade * .57, x + 3 + length * 4, y);
            });
        });

        drawGrass(false);
        for (let i = 0; i < Math.round(bay.fish); i++) {
            const group = i % 3;
            const phase = time * (.45 + (1 - clarity) * .15) + group * 2.12;
            const x = w * (.5 + Math.sin(phase) * .31 + (random(i) - .5) * .29);
            const y = h * ((caseType === 'heat' ? .12 + group * .055 : .22 + group * .12) + random(i + 90) * .18 + wobble(i, .8, time) * .037);
            const size = Math.min(w, h) * (.025 + random(i + 50) * .026);
            fishShape(ctx, x, y, size, Math.cos(phase) > 0 ? 1 : -1, tones[group], wobble(i, 8, time) * .13);
        }
        drawGrass(true);

        if (player) {
            const [sx, sy] = route.shelter;
            const [px, py] = predator;
            const [fx, fy] = swimmer;
            const complete = player.food.size === route.food.length;
            const minDimension = Math.min(w, h);
            const ring = (x, y, size, color) => {
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.ellipse(x * w, y * h, size * w, size * h, 0, 0, Math.PI * 2);
                ctx.stroke();
            };
            const tag = (x, y, label, color) => {
                ctx.font = '600 12px system-ui, sans-serif';
                const width = ctx.measureText(label).width + 14;
                const left = Math.max(4, Math.min(w - width - 4, x - width / 2));
                ctx.fillStyle = '#09222deb';
                ctx.fillRect(left, y, width, 21);
                ctx.fillStyle = color;
                ctx.fillText(label, left + 7, y + 15);
            };

            if (player.guide.length > 1) {
                ctx.save();
                ctx.strokeStyle = '#ffe589a0';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 6]);
                ctx.beginPath();
                player.guide.forEach(([x, y], i) => {
                    if (i === 0) ctx.moveTo(x * w, y * h);
                    else ctx.lineTo(x * w, y * h);
                });
                ctx.stroke();
                ctx.restore();
            }

            const patches = player.round === 1 ? route.cover : [route.cover[0]];
            patches.forEach(([x, y]) => {
                const shade = player.hidden && Math.hypot(x - player.x, y - player.y) < .105 ?
                    '#68f6df' : 'rgba(105,246,223,.42)';
                ring(x, y, .105, shade);
            });
            ring(px, py, .12, 'rgba(252,143,135,.56)');
            ring(sx, sy, .077, complete ? '#a9ffb4' : '#92beb1');
            tag(sx * w, sy * h - 48, complete ? 'Влез тук' : 'Убежище', '#c9ffda');

            route.food.forEach(([x, y], index) => {
                if (player.food.has(index)) return;
                const pulse = 7 + wobble(index, 4, time) * 2;
                const glow = ctx.createRadialGradient(x * w, y * h, 1, x * w, y * h, pulse * 3);
                glow.addColorStop(0, '#ffcf6599');
                glow.addColorStop(1, '#ffcf6500');
                fill(ctx, glow, () => ctx.arc(x * w, y * h, pulse * 3, 0, Math.PI * 2));
                fill(ctx, '#fff2a0', () => ctx.arc(x * w, y * h, 4, 0, Math.PI * 2));
            });

            fishShape(ctx, px * w, py * h, minDimension * .086, Math.cos(player.step * .37) > 0 ? 1 : -1,
                ['#fca89c', '#99485c'], wobble(0, 8, time) * .13);
            tag(px * w, py * h - 27, 'Хищник', '#ffc4bb');
            ctx.globalAlpha = player.hidden ? .7 : 1;
            fishShape(ctx, fx * w, fy * h, minDimension * .062, player.direction,
                ['#ffe589', '#de8b4b'], wobble(0, 10, time) * .15);
            ctx.globalAlpha = 1;
            tag(fx * w, fy * h + 15, player.hidden ? 'Ти · в укритие' : 'Ти', '#fff1a7');
        }
    };
}