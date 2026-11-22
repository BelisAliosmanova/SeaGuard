'use strict';

const byId = id => document.getElementById(id);
const canvas = byId('ocean');
const ctx = canvas.getContext('2d');
const fogLayer = document.createElement('canvas');
const fog = fogLayer.getContext('2d');
const W = 1000;
const H = 565;
fogLayer.width = W;
fogLayer.height = H;
const TAU = 2 * Math.PI;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = (a, b, strength, dt) => a + (b - a) * (1 - Math.exp(-strength * dt));
const range = (x, y, other) => Math.hypot(x - other.x, y - other.y);
const layout = [
    { x: 263, y: 418, name: 'Каменният риф' },
    { x: 543, y: 379, name: 'Тихият склон' },
    { x: 836, y: 424, name: 'Външният залив' }
];
const dock = { x: 96, y: 196, kind: 'dock' };
const cuttings = [
    { x: 351, y: 279, kind: 'cutting' },
    { x: 497, y: 438, kind: 'cutting' },
    { x: 609, y: 243, kind: 'cutting' }
];
const beds = [
    { x: 543, y: 379, kind: 'plant', safe: true },
    { x: 713, y: 397, kind: 'plant', safe: false }
];
const cutOffsets = [[-44, 4], [-10, -16], [35, 6]];
const rocks = [
    { x: 344, y: 462, size: 46 }, { x: 460, y: 481, size: 30 },
    { x: 653, y: 467, size: 63 }, { x: 767, y: 489, size: 36 },
    { x: 910, y: 475, size: 55 }
];
let mission, knot, collected, carried, exposedSeed, healthy;
let pulse, sonarReady, revealedUntil, noticeUntil, notice, scatter, blocked, retryCutting;
const PRESS_RANGE = 27;
const vents = [
    { x: 405, y: 365, width: 47, height: 105, phase: 0.3 },
    { x: 699, y: 310, width: 53, height: 125, phase: 2.7 }
];
const keys = new Set();
let pointer = null;
let workHeld = false;
let boostHeld = false;
let soundEnabled = false;
let audio;
let paused = false;
let patches, drone, particles, time, trail, completed, lastWarning, hint, danger;
let victoryAt = 0;
let labelScale = 1;
let frameWidth = 0;
let frameHeight = 0;

function seeded(seed) {
    const raw = Math.sin(seed * 127.1 + 19.6) * 43758.5453;
    return raw - Math.floor(raw);
}

const drift = Array.from({ length: 105 }, (_, i) => ({
    x: seeded(i) * W, y: seeded(i + 200) * H,
    radius: 0.55 + seeded(i + 400) * 2,
    speed: 5 + seeded(i + 600) * 20
}));

const blades = Array.from({ length: 42 }, (_, i) => ({
    offset: (seeded(i + 800) - .5) * 166,
    size: 12 + seeded(i + 900) * 60,
    lean: -15 + seeded(i + 1000) * 30,
    shade: seeded(i + 1100),
    row: seeded(i + 1200) * 27
})).sort((a, b) => a.row - b.row);

function say(message) {
    if (hint === message) return;
    hint = message;
    byId('objective').textContent = message;
}

function hud() {
    const energy = Math.round(drone.energy);
    if (Number(byId('energy').value) !== energy) {
        byId('energy').value = energy;
        byId('energy-percent').textContent = energy + '%';
    }
    const count = completed + ' от 3';
    const phase = mission === 'storm' || mission === 'won' ? '2 / 2 · След бурята' : '1 / 2 · Мрежата в тъмното';
    if (byId('mission').textContent !== phase) byId('mission').textContent = phase;
    const supply = carried + ' / 2';
    if (byId('cutting-count').textContent !== supply) byId('cutting-count').textContent = supply;
    const sonar = byId('sonar');
    const cooldown = Math.max(0, Math.ceil(sonarReady - time));
    const sonarLabel = cooldown ? 'Сонар · ' + cooldown + ' с' : 'Сонар · Q';
    if (sonar.textContent !== sonarLabel) sonar.textContent = sonarLabel;
    sonar.disabled = Boolean(cooldown) || paused || mission === 'won' || mission === 'intermission';
    if (byId('restored').textContent !== count) byId('restored').textContent = count;
}

function sound(frequencies) {
    if (!soundEnabled || !audio || audio.state !== 'running') return;
    frequencies.forEach((frequency, index) => {
        const start = audio.currentTime + index * .085;
        const wave = audio.createOscillator();
        const volume = audio.createGain();
        wave.type = 'sine';
        wave.frequency.setValueAtTime(frequency, start);
        volume.gain.setValueAtTime(.0001, start);
        volume.gain.exponentialRampToValueAtTime(.09, start + .025);
        volume.gain.exponentialRampToValueAtTime(.0001, start + .25);
        wave.connect(volume).connect(audio.destination);
        wave.start(start);
        wave.stop(start + .26);
    });
}

function clearInput() {
    keys.clear();
    pointer = null;
    workHeld = boostHeld = false;
    byId('work').classList.remove('is-held');
    byId('boost').classList.remove('is-held');
}

function reset() {
    clearInput();
    paused = false;
    patches = layout.map((patch, i) => ({ ...patch, phase: i === 0 ? 'net' : 'barren', bloom: 0 }));
    mission = 'rescue';
    collected = new Set();
    knot = carried = healthy = sonarReady = revealedUntil = noticeUntil = scatter = 0;
    pulse = exposedSeed = retryCutting = null;
    blocked = false;
    drone = { x: 116, y: 227, vx: 0, vy: 0, energy: 100, face: 1 };
    time = trail = completed = danger = victoryAt = 0;
    lastWarning = 0;
    particles = [];
    byId('overlay').hidden = true;
    byId('pause').textContent = 'Пауза';
    byId('pause').setAttribute('aria-pressed', 'false');
    say('Натисни Q или „Сонар“, за да намериш мрежата в мътната вода.');
    hud();
}

function openOverlay(title, text, action) {
    clearInput();
    byId('overlay-title').textContent = title;
    byId('overlay-text').textContent = text;
    byId('overlay-action').textContent = action;
    byId('overlay').hidden = false;
    byId('overlay-action').focus();
}

function togglePause() {
    if (mission === 'won' || mission === 'intermission') return;
    paused = !paused;
    clearInput();
    byId('pause').textContent = paused ? 'Продължи' : 'Пауза';
    byId('pause').setAttribute('aria-pressed', String(paused));
    hud();
    if (paused) openOverlay('Гмуркането е на пауза', 'Дронът и теченията са спрели.', 'Продължи');
    else {
        byId('overlay').hidden = true;
        canvas.focus();
    }
}

function emit(x, y, count, color, speed) {
    if (reducedMotion) count = Math.min(count, 6);
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * TAU;
        const force = speed * (.25 + Math.random() * .75);
        const life = .45 + Math.random() * .85;
        particles.push({ x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force - 16, life, total: life, color, r: 1 + Math.random() * 3 });
    }
}

function plume(vent) {
    const wave = Math.sin(time * 1.35 + vent.phase);
    return {
        x: vent.x + wave * 23,
        y: vent.y,
        strength: clamp((wave + .58) / 1.58, 0, 1)
    };
}

function activeNet() {
    return patches[mission === 'storm' ? 2 : 0];
}

function knots(patch) {
    return cutOffsets.map(([x, y], index) => ({ x: patch.x + x, y: patch.y + y, index, kind: 'knot' }));
}

function objectives() {
    if (mission === 'rescue' || mission === 'storm') return knots(activeNet()).slice(knot);
    if (mission === 'return') return [dock];
    if (mission !== 'nursery') return [];
    const available = carried < 2 ? cuttings.filter(point => !collected.has(point)) : [];
    if (retryCutting && carried < 2) available.push(retryCutting);
    const canPlant = carried > 0 && healthy < 2;
    if (canPlant) available.push(...beds.filter(bed => bed.safe || !exposedSeed));
    return available;
}

function nearest(points, maxDistance = Infinity) {
    let target = null;
    for (const point of points) {
        const distance = range(drone.x, drone.y, point);
        if (distance < maxDistance) {
            target = point;
            maxDistance = distance;
        }
    }
    return target;
}

function announce(message, seconds = 2.8) {
    notice = message;
    noticeUntil = time + seconds;
}

function ping() {
    if (paused || mission === 'won' || mission === 'intermission' || time < sonarReady) return;
    pulse = { x: drone.x, y: drone.y, at: time };
    sonarReady = time + 4;
    revealedUntil = time + 9;
    sound([740, 535, 360]);
    if (mission === 'rescue' || mission === 'storm') announce('Сонарът очерта мрежата. Приближи първия светещ възел.');
    hud();
}

function finishWork(target) {
    if (target.kind === 'knot') {
        if (target.index !== knot) {
            const patch = activeNet();
            patch.damage = (patch.damage || 0) + 1;
            emit(target.x, target.y, 18, '#b3a075', 68);
            sound([165, 120]);
            announce('Тревата се огъна под опънатото въже. Следвай номера на светещия възел.');
            return;
        }
        knot++;
        emit(target.x, target.y, 20, '#ffd49a', 96);
        sound([280 + knot * 60, 480 + knot * 60]);
        if (knot < cutOffsets.length) {
            announce('Възел ' + knot + ' е освободен. Премини към следващия.');
            return;
        }
        const patch = activeNet();
        patch.phase = 'done';
        patch.bloom = .15;
        completed++;
        emit(patch.x, patch.y, 35, '#88ffcd', 126);
        if (mission === 'storm') {
            mission = 'won';
            victoryAt = time + 2;
            announce('Втората мрежа е извадена. Ливадата е свободна.', 4);
        } else {
            mission = 'nursery';
            announce('Мрежата е извадена! Събери два светещи стръка за разсадника.', 4);
        }
        return;
    }
    if (target.kind === 'cutting') {
        if (target === retryCutting) retryCutting = null;
        else collected.add(target);
        carried++;
        emit(target.x, target.y, 13, '#86ffd3', 56);
        sound([500, 650]);
        announce('Стръкът е прибран. Потърси защитения участък.');
        return;
    }
    if (target.kind === 'plant') {
        carried--;
        if (!target.safe) {
            exposedSeed = { x: target.x, y: target.y, since: time };
            announce('Тук течението е силно. Виж какво ще стане с разсада.');
            return;
        }
        healthy++;
        emit(target.x, target.y, 31, '#92ffc4', 118);
        sound([392, 523, 660]);
        if (healthy === 1) {
            patches[1].phase = 'growing';
            patches[1].bloom = .32;
            announce('Първият стрък е засаден. Добави още един в заслона.');
        } else {
            patches[1].phase = 'done';
            completed++;
            mission = 'return';
            announce('Разсадникът е засаден. Върни се до зарядната станция.', 4);
        }
        return;
    }
    mission = 'intermission';
    openOverlay('Следващо гмуркане', 'Изминаха няколко седмици. Тревата в заслона е пуснала корени, но нова буря разкри мрежа в другия край на същия залив.', 'Върни се в залива');
}

function startStorm() {
    mission = 'storm';
    knot = 0;
    pulse = null;
    sonarReady = revealedUntil = 0;
    drone.energy = 100;
    patches[1].bloom = 1;
    patches[2].phase = 'net';
    byId('overlay').hidden = true;
    announce('Виж порасналия разсадник. После използвай сонара, за да намериш новата мрежа.', 5);
    canvas.focus();
    hud();
}

function update(dt) {
    if (mission === 'intermission') return;
    time += dt;
    for (const patch of patches) {
        if (patch.phase === 'done' || patch.phase === 'growing') {
            const target = patch.phase === 'growing' ? .42 : 1 - Math.min(.48, (patch.damage || 0) * .12);
            patch.bloom = ease(patch.bloom, target, .9, dt);
        }
    }
    particles = particles.filter(particle => particle.life > 0);
    for (const particle of particles) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
    }
    if (exposedSeed && exposedSeed.since + 2.6 < time) {
        emit(exposedSeed.x + 65, exposedSeed.y - 28, 13, '#a1cda0', 48);
        exposedSeed = null;
        if (carried + cuttings.length - collected.size < 2 - healthy) {
            retryCutting = { ...cuttings[0] };
        }
        announce('Течението отнесе стръка. Засади следващия зад скалния заслон.');
    }
    if (mission === 'won') {
        if (victoryAt && time >= victoryAt) {
            victoryAt = 0;
            openOverlay('Ливадата оживя!', 'Двете мрежи са извадени. В защитения разсадник морската трева е пораснала и младите риби имат къде да се скрият.', 'Гмурни се отново');
        }
        return;
    }
    const key = (...names) => names.some(name => keys.has(name));
    let dx = Number(key('arrowright', 'd', 'keyd')) - Number(key('arrowleft', 'a', 'keya'));
    let dy = Number(key('arrowdown', 's', 'keys')) - Number(key('arrowup', 'w', 'keyw'));
    if (pointer && !dx && !dy) {
        dx = (pointer.x - drone.x) / 34;
        dy = (pointer.y - drone.y) / 34;
    }
    const inputLength = Math.hypot(dx, dy);
    dx /= Math.max(1, inputLength);
    dy /= Math.max(1, inputLength);
    const held = workHeld || key(' ');
    if (!held) blocked = false;
    const nearby = nearest(objectives(), PRESS_RANGE);
    const working = held && nearby && !blocked;
    const boost = (boostHeld || key('shift')) && inputLength > .12 && drone.energy > 10 && !working;
    scatter = ease(scatter, boost ? 1 : 0, boost ? 6 : 1.35, dt);
    const speed = working ? 56 : boost ? 320 : 178;
    drone.vx = ease(drone.vx, dx * speed, 6.8, dt);
    drone.vy = ease(drone.vy, dy * speed, 6.8, dt);
    if (Math.abs(drone.vx) > 12) drone.face = drone.vx < 0 ? -1 : 1;
    else if (Math.abs(dx) > .3) drone.face = Math.sign(dx);

    danger = 0;
    for (const vent of vents) {
        const cloud = plume(vent);
        const distance = Math.hypot((drone.x - cloud.x) / vent.width, (drone.y - cloud.y) / vent.height);
        if (distance < 1) {
            const force = mission === 'storm' ? 1.35 : 1;
            danger += force * cloud.strength * (1 - distance);
            drone.vx += dt * 190 * cloud.strength * force;
            drone.vy -= dt * 90 * cloud.strength * force;
        }
    }
    drone.x = clamp(drone.x + drone.vx * dt, 30, W - 31);
    drone.y = clamp(drone.y + drone.vy * dt, 68, 493);
    const charging = range(drone.x, drone.y, dock) < 72;
    drone.energy = clamp(drone.energy + dt * (charging ? 40 : -30 * danger - (boost ? 11 : 0)), 0, 100);

    trail += dt;
    if (trail > (boost ? .026 : .13) && inputLength > .1) {
        emit(drone.x - drone.face * 23, drone.y + 4, boost ? 3 : 1, '#a7fff2', boost ? 47 : 19);
        if (drone.y > 411) emit(drone.x - drone.face * 23, drone.y + 27, boost ? 4 : 1, '#c6ae7e', 40);
        trail = 0;
    }
    if (drone.energy <= 0) {
        Object.assign(drone, { x: dock.x, y: dock.y, energy: 35, vx: 0, vy: 0 });
        pointer = null;
        lastWarning = time + 3.4;
        sound([180, 130]);
    }

    const task = nearby && nearby.kind + ':' + nearby.x;
    if (task !== drone.task) drone.progress = 0;
    drone.task = task;
    drone.progress = working ? (drone.progress || 0) + dt / .58 : Math.max(0, (drone.progress || 0) - dt * 1.8);
    if (working && drone.progress >= 1) {
        drone.progress = 0;
        blocked = true;
        finishWork(nearby);
    }

    if (lastWarning > time) say('Аварийно връщане. Остани до станцията, за да презаредиш.');
    else if (noticeUntil > time) say(notice);
    else if (danger > .26) say('Силно течение. Заобиколи облака или използвай ускорение.');
    else if (mission === 'return') say(nearby ? 'Задръж за работа, за да приключиш гмуркането.' : 'Върни се до зарядната станция горе вляво.');
    else if (mission === 'nursery') {
        say(nearby?.kind === 'plant' ? 'Задръж, за да засадиш стрък.' : nearby?.kind === 'cutting' ?
            'Задръж, за да прибереш светещия стрък.' : carried ?
                'Засади в заслона зад скалите или пробвай откритото дъно.' : 'Потърси светещите стръкове и събери разсад.');
    } else if (nearby?.kind === 'knot') say(nearby.index === knot ? 'Задръж за работа при възел ' + (knot + 1) + '. После отпусни бутона.' : 'Първо освободи светещия възел ' + (knot + 1) + '.');
    else if (drone.energy < 24) say('Батерията е ниска. Зарядната станция е горе вляво.');
    else say(time < revealedUntil ? 'Плувай към светещия възел ' + (knot + 1) + '.' :
        'Използвай сонар (Q), за да откриеш мрежата. Светлината следва дрона.');
    hud();
}

const dunes = [
    { y: 342, amplitude: 52, color: '#103945', scale: .009, offset: 3 },
    { y: 397, amplitude: 28, color: '#12353b', scale: .014, offset: 7 },
    { y: 462, amplitude: 29, color: '#132d30', scale: .018, offset: 1.4 },
    { y: 523, amplitude: 24, color: '#102425', scale: .017, offset: 5 }
];

function path(color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    points();
    ctx.fill();
}

function ellipse(x, y, rx, ry, color, turn = 0) {
    path(color, () => ctx.ellipse(x, y, rx, ry, turn, 0, TAU));
}

function glow(x, y, radius, color) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, color);
    light.addColorStop(1, 'transparent');
    ellipse(x, y, radius, radius, light);
}

function caption(label, x, y, color = '#d3fff0', size = 14) {
    ctx.font = '650 ' + size * labelScale + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(label).width + 18;
    x = clamp(x, width / 2 + 3, W - width / 2 - 3);
    ctx.fillStyle = '#07232be8';
    ctx.fillRect(x - width / 2, y - 13 * labelScale, width, 26 * labelScale);
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
}

function drawSea(t) {
    const ocean = ctx.createLinearGradient(0, 0, 0, H);
    ocean.addColorStop(0, '#288f96');
    ocean.addColorStop(.17, '#126679');
    ocean.addColorStop(.65, '#0b3445');
    ocean.addColorStop(1, '#081b27');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, W, H);
    glow(285, 0, 485, '#a6ffe3a6');

    const ray = ctx.createLinearGradient(0, 0, 0, H * .86);
    ray.addColorStop(0, '#c3ffe63d');
    ray.addColorStop(1, 'transparent');
    for (let i = 0; i < 13; i++) {
        const x = i * 86 - 98 + Math.sin(t * .35 + i * 1.8) * 28;
        const spread = 120 + seeded(i + 1800) * 130;
        path(ray, () => {
            ctx.moveTo(x, 0);
            ctx.lineTo(x + 12 + i % 4 * 6, 0);
            ctx.lineTo(x + spread, H * .92);
            ctx.lineTo(x + spread - 88, H * .92);
        });
    }
    for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(193,255,240,' + (.31 - i * .034) + ')';
        ctx.lineWidth = i < 2 ? 2 : 1;
        for (let x = 0; x <= W; x += 8) {
            const y = 8 + i * 5 + Math.sin(x / 32 + t * 1.4 + i) * 4 + Math.sin(x / 71 - t * 1.3) * 5;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    dunes.forEach(({ y, amplitude, color, scale, offset }) => path(color, () => {
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) {
            const ridge = y + Math.sin(x * scale + offset) * amplitude + Math.sin(x * scale * 2.2) * 12;
            ctx.lineTo(x, ridge);
        }
        ctx.lineTo(W, H);
    }));
    for (let i = 0; i < 46; i++) {
        const x = seeded(i + 1400) * W;
        const y = 463 + seeded(i + 1500) * 103;
        const size = 3 + seeded(i + 1600) * 16;
        ellipse(x, y, size, size * .34, i % 2 ? '#214448' : '#0a2228', -.12);
    }

    drift.forEach(speck => {
        const x = (speck.x + t * speck.speed * .58) % W;
        const y = (speck.y - t * speck.speed % H + H) % H;
        ellipse(x, y, speck.radius, speck.radius, speck.radius > 2.1 ? '#bafdf051' : '#d2fff034');
    });
}

function drawFish(x, y, scale, side, t, warm) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(side * scale, scale);
    const tail = Math.sin(t * 10 + x * .01) * 3.5;
    path(warm ? '#a6684f' : '#346e83', () => {
        ctx.moveTo(-8, 0);
        ctx.lineTo(-19, -6 + tail);
        ctx.quadraticCurveTo(-15, tail, -19, 6 + tail);
    });
    const skin = ctx.createLinearGradient(0, -7, 0, 7);
    skin.addColorStop(0, warm ? '#9d654e' : '#287e95');
    skin.addColorStop(.57, warm ? '#ffe3ad' : '#acf2e8');
    skin.addColorStop(1, warm ? '#b48c78' : '#548ca4');
    path(skin, () => {
        ctx.moveTo(-12, 0);
        ctx.bezierCurveTo(-4, -10, 8, -8, 14, -1);
        ctx.bezierCurveTo(10, 7, -4, 10, -12, 0);
    });
    ellipse(8, -1.6, 1.5, 1.5, '#082030');
    ctx.restore();
}

function drawSchool(x, y, count, timeOffset, fade, warm, t, juveniles = false) {
    ctx.save();
    ctx.globalAlpha = fade;
    const phase = t * .78 + timeOffset;
    for (let i = 0; i < count; i++) {
        const spread = seeded(i + 50) - .5;
        const reaction = scatter * (1 - clamp(Math.hypot(x - drone.x, y - drone.y) / 260, 0, 1));
        const width = juveniles ? 44 : 65;
        drawFish(x + Math.sin(phase) * width + spread * (114 + reaction * 210),
            y + (seeded(i + 120) - .5) * (55 + reaction * 100) + Math.sin(t + i) * 8,
            (juveniles ? .46 : 1) * (.5 + seeded(i + 80) * .66), Math.cos(phase) >= 0 ? 1 : -1, t, warm);
    }
    ctx.restore();
}

function drawJelly(x, y, size, phase, t) {
    x += Math.sin(t * .34 + phase) * 25;
    y += Math.sin(t * .65 + phase) * 15;
    const pulse = .86 + Math.sin(t * 2 + phase) * .14;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    glow(0, 1, 29, '#c2e4ff27');
    const bell = ctx.createLinearGradient(0, -15, 0, 5);
    bell.addColorStop(0, '#cce5ff68');
    bell.addColorStop(1, '#bce0ff12');
    path(bell, () => {
        ctx.moveTo(-15 * pulse, 3);
        ctx.bezierCurveTo(-15, -19, 15, -19, 15 * pulse, 3);
        ctx.quadraticCurveTo(0, 8, -15 * pulse, 3);
    });
    ctx.strokeStyle = '#bfecff56';
    ctx.lineWidth = .9;
    for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 4, 4);
        ctx.bezierCurveTo(i * 5 + Math.sin(t * 2 + i) * 6, 12, i * 6 - 4, 19, i * 6 + Math.cos(t + i) * 5, 28);
        ctx.stroke();
    }
    ctx.restore();
}
function drawGrass(patch, t) {
    const living = patch.phase === 'done' || patch.phase === 'growing';
    const growth = (living ? .13 + .87 * patch.bloom : .2) * (1 - Math.min(.65, (patch.damage || 0) * .18));
    ellipse(patch.x, patch.y + 21, 85, 15, '#071e25a0');
    if (patch.phase === 'done') glow(patch.x, patch.y + 5, 98, '#67ffc455');
    blades.forEach((blade, i) => {
        if (!living && i % 6 !== 0) return;
        const x = patch.x + blade.offset;
        const y = patch.y + blade.row;
        const length = blade.size * growth * (.73 + blade.row / 60);
        const sway = blade.lean + Math.sin(t * 1.55 + blade.offset * .035) * length * .31;
        const leaf = ctx.createLinearGradient(x, y, x, y - length);
        leaf.addColorStop(0, '#134f44');
        leaf.addColorStop(1, living ?
            'hsl(' + (130 + blade.shade * 42) + ' 65% ' + (37 + blade.shade * 32) + '%)' : '#7e7e49');
        path(leaf, () => {
            ctx.moveTo(x - 3.5, y);
            ctx.quadraticCurveTo(x + sway * .24, y - length * .49, x + sway, y - length);
            ctx.quadraticCurveTo(x + sway * .52 + 7, y - length * .47, x + 3.9, y);
        });
    });
}

function drawRock(rock, outline = false) {
    const { x, y, size } = rock;
    const stone = ctx.createLinearGradient(x, y - size, x, y + 15);
    stone.addColorStop(0, '#3d6971');
    stone.addColorStop(.48, '#25494f');
    stone.addColorStop(1, '#132d36');
    ctx.beginPath();
    ctx.moveTo(x - size, y + 8);
    ctx.lineTo(x - size * .54, y - size * .63);
    ctx.lineTo(x - size * .12, y - size * .79);
    ctx.lineTo(x + size * .52, y - size * .62);
    ctx.lineTo(x + size, y + 11);
    ctx.closePath();
    if (outline) {
        ctx.strokeStyle = '#8df4df92';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    } else {
        ctx.fillStyle = stone;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - size * .53, y - size * .62);
        ctx.lineTo(x - size * .17, y - size * .56);
        ctx.lineTo(x + size * .31, y - size * .48);
        ctx.strokeStyle = '#79a4a14b';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawNet(patch, t, outline = false) {
    const points = knots(patch).slice(knot);
    if (!points.length) return;
    ctx.strokeStyle = outline ? '#9af5df' : '#dfbc82';
    ctx.lineWidth = outline ? 1.5 : 2.1;
    ctx.beginPath();
    ctx.moveTo(points[0].x - 15, points[0].y + 11);
    points.forEach((point, index) => {
        const wiggle = Math.sin(t * 2.2 + index) * (knot + 2);
        ctx.quadraticCurveTo(point.x - 9, point.y + 15 + wiggle, point.x, point.y);
    });
    ctx.quadraticCurveTo(patch.x + 53, patch.y + 22 + knot * 4, patch.x + 60, patch.y + 8);
    ctx.stroke();
    if (outline) return;
    ctx.lineWidth = .8;
    points.forEach((point, i) => {
        for (let j = 0; j < 6; j++) {
            const x = point.x + j * 6 - 10;
            const hang = 15 + Math.sin(t * 1.9 + j * .44 + i) * (5 + knot * 2);
            ctx.beginPath();
            ctx.moveTo(x, point.y + j * .8);
            ctx.lineTo(x + 7, point.y + hang);
            ctx.lineTo(x - 4, point.y + hang - 4);
            ctx.stroke();
        }
    });
}

function inBeam(point) {
    const dx = (point.x - drone.x) * drone.face;
    const dy = point.y - drone.y;
    return range(drone.x, drone.y, point) < 65 || (dx > 0 && dx < 250 && Math.abs(dy) < dx * .44 + 17);
}

function pingReached(point) {
    return pulse && time < revealedUntil && range(pulse.x, pulse.y, point) < (time - pulse.at) * 720 + 18;
}

function drawFog() {
    fog.globalCompositeOperation = 'source-over';
    fog.clearRect(0, 0, W, H);
    fog.fillStyle = mission === 'storm' ? '#03131ee9' : '#061925df';
    fog.fillRect(0, 0, W, H);
    fog.globalCompositeOperation = 'destination-out';
    const halo = fog.createRadialGradient(drone.x, drone.y, 24, drone.x, drone.y, 105);
    halo.addColorStop(0, '#000');
    halo.addColorStop(1, '#0000');
    fog.fillStyle = halo;
    fog.fillRect(drone.x - 105, drone.y - 105, 210, 210);
    fog.save();
    fog.translate(drone.x, drone.y);
    fog.scale(drone.face, 1);
    const beam = fog.createLinearGradient(14, 0, 260, 0);
    beam.addColorStop(0, '#000');
    beam.addColorStop(.55, '#000e');
    beam.addColorStop(1, '#0000');
    fog.fillStyle = beam;
    fog.beginPath();
    fog.moveTo(14, -9);
    fog.lineTo(260, -112);
    fog.lineTo(260, 112);
    fog.lineTo(14, 10);
    fog.fill();
    fog.restore();
    ctx.drawImage(fogLayer, 0, 0);
}

function drawSonar() {
    if (!pulse) return;
    const age = time - pulse.at;
    if (age < 1.55) {
        ctx.strokeStyle = 'rgba(141,255,226,' + (reducedMotion ? .3 : Math.max(0, .66 - age * .41)) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, reducedMotion ? 94 : 18 + age * 720, 0, TAU);
        ctx.stroke();
    }
    rocks.filter(pingReached).forEach(rock => drawRock(rock, true));
    if (pingReached(dock)) {
        ctx.beginPath();
        ctx.arc(dock.x, dock.y, 15, 0, TAU);
        ctx.strokeStyle = '#8df4df92';
        ctx.stroke();
    }
}

function drawObjective(point, t) {
    const { x, y, kind } = point;
    const distance = range(drone.x, drone.y, point);
    const close = distance < PRESS_RANGE;
    const current = kind !== 'knot' || point.index === knot;
    const tint = kind === 'knot' ? current ? '#ffdf9e' : '#b99b73' : '#aaffcb';
    if (kind === 'cutting') drawSprig(x, y, t, .9);
    glow(x, y, current ? 25 : 17, kind === 'knot' ? '#ffcc705b' : '#75ffc56c');
    ctx.strokeStyle = tint;
    ctx.lineWidth = current ? 2 : 1;
    ctx.beginPath();
    ctx.arc(x, y, current ? 12 + Math.sin(t * 4) * 2 : 9, 0, TAU);
    ctx.stroke();
    if (kind === 'knot') {
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = tint;
        ctx.fillText(point.index + 1, x, y);
    }
    const working = close && drone.progress > 0 && drone.task === kind + ':' + x;
    if (working) {
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, 18, -Math.PI / 2, drone.progress * TAU - Math.PI / 2);
        ctx.stroke();
    }
    if (close || current && kind === 'knot') {
        const label = kind === 'knot' ? (current ? 'Възел ' + (point.index + 1) : 'Изчакай реда') :
            kind === 'cutting' ? 'Събери стрък' : kind === 'dock' ? 'Приключи гмуркането' :
                point.safe ? 'Защитен разсадник' : 'Открито дъно';
        caption(label, x, y - 34, tint, 13);
    }
}

function drawSprig(x, y, t, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#a9edac';
    ctx.lineWidth = 2.8;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 9);
        ctx.quadraticCurveTo(i * 6, -4, i * 9 + Math.sin(t * 3 + i) * 3, -15);
        ctx.stroke();
    }
    ctx.restore();
}

function drawVent(vent, t) {
    const cloud = plume(vent);
    if (cloud.strength < .05) return;
    ctx.save();
    ctx.globalAlpha = cloud.strength;
    ctx.translate(cloud.x, cloud.y);
    ctx.scale(vent.width, vent.height);
    const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    haze.addColorStop(0, '#d6a56c95');
    haze.addColorStop(1, 'transparent');
    ellipse(0, 0, 1, 1, haze);
    for (let i = 0; i < 14; i++) {
        const y = (seeded(i + 1700) - t * .39 % 1 + 1) % 1;
        const x = Math.sin(t * 2.4 + i) * .53;
        ellipse(x, y * 2 - 1, .03 + i % 4 * .017, .018, '#ffdc9f77');
    }
    ctx.restore();
}

function drawDock(t) {
    const y = dock.y;
    glow(dock.x, y, 54, '#62e7ff73');
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#a9f2f9';
    ctx.arc(dock.x, y, 15 + Math.sin(t * 3) * 3, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#d1fbff';
    ctx.fillRect(dock.x - 1.5, y - 7, 3, 14);
    ctx.fillRect(dock.x - 7, y - 1.5, 14, 3);
    caption('Зарядна станция', dock.x, y - 36, '#b1f7ff', 13);
}

function drawDrone(t) {
    const bob = Math.sin(t * 4.6) * 2;
    ctx.save();
    ctx.translate(drone.x, drone.y + bob);
    ctx.scale(drone.face, 1);
    ctx.rotate(clamp(drone.vy / 650, -.23, .23));
    const beam = ctx.createLinearGradient(16, 0, 163, 0);
    beam.addColorStop(0, '#d7fff074');
    beam.addColorStop(1, 'transparent');
    path(beam, () => {
        ctx.moveTo(16, -3);
        ctx.lineTo(165, -41);
        ctx.lineTo(165, 40);
        ctx.lineTo(16, 8);
    });
    ellipse(-4, 9, 23, 6, '#071f2c', -.07);
    ellipse(-20, 1, 8, 9, '#19384d');
    ellipse(0, -2, 22, 11, '#e8b865', -.04);
    ellipse(-3, -5, 17, 6, '#ffdc91', -.04);
    ellipse(11, -2, 8.5, 8, '#1b525d');
    ellipse(13, -3, 4.8, 4.5, '#a2fff1');
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#b6e0d9';
    ctx.beginPath();
    ctx.moveTo(-9, 7);
    ctx.lineTo(-15, 15);
    ctx.lineTo(5, 15);
    ctx.moveTo(14, 7);
    ctx.lineTo(15, 14);
    ctx.lineTo(24, 17);
    ctx.stroke();
    ctx.restore();
}

function draw() {
    if (!frameWidth || !frameHeight) return;
    ctx.setTransform(frameWidth / W, 0, 0, frameHeight / H, 0, 0);
    const t = reducedMotion ? 0 : time;
    const dark = mission === 'rescue' || mission === 'storm';
    drawSea(t);
    drawJelly(635, 118, 1.2, 0, t);
    drawJelly(905, 236, .83, 2, t);
    drawSchool(289, 135, 11, 0, .31, false, t);
    drawSchool(752, 190, 12, 2.6, .34, false, t);
    rocks.forEach(rock => drawRock(rock));
    patches.forEach((patch, index) => {
        drawGrass(patch, t);
        if (patch.phase === 'net') drawNet(patch, t);
        if (patch.phase === 'done') {
            drawSchool(patch.x, patch.y - 69, 10, index * 2, patch.bloom * .88, index % 2 === 0, t);
            if (index === 1 && (mission === 'storm' || mission === 'won')) {
                drawSchool(patch.x, patch.y - 24, 8, 3.4, .9, true, t, true);
            }
        }
    });
    vents.forEach(vent => drawVent(vent, t));
    if (exposedSeed) {
        const age = time - exposedSeed.since;
        drawSprig(exposedSeed.x + age * age * 12, exposedSeed.y - age * 12, t, .95 - age * .14);
    }
    drawDock(t);
    for (const particle of particles) {
        ctx.globalAlpha = clamp(particle.life / particle.total, 0, 1);
        ellipse(particle.x, particle.y, particle.r, particle.r, particle.color);
    }
    ctx.globalAlpha = 1;
    if (dark) drawFog();
    drawSonar();

    const goals = objectives();
    if (dark && pingReached(activeNet())) drawNet(activeNet(), t, true);
    if (mission === 'nursery') beds.forEach(bed => {
        caption(bed.safe ? 'Заслон' : 'Силно течение', bed.x, bed.y + 37,
            bed.safe ? '#acffc8' : '#ffd3a0', 13);
    });
    goals.filter(point => !dark || inBeam(point) || pingReached(point)).forEach(point => drawObjective(point, t));
    const work = nearest(goals, PRESS_RANGE);
    if (work && drone.progress > 0) {
        ctx.beginPath();
        ctx.strokeStyle = work.kind === 'knot' ? '#ffdda6' : '#9affcc';
        ctx.lineWidth = 2;
        ctx.moveTo(drone.x + drone.face * 16, drone.y + 12);
        ctx.lineTo(work.x, work.y);
        ctx.stroke();
    }
    drawDrone(t);
    if (danger > .32) {
        const edge = ctx.createRadialGradient(W * .5, H * .46, H * .27, W * .5, H * .46, W * .61);
        edge.addColorStop(0, 'transparent');
        edge.addColorStop(1, '#713b2f9c');
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, W, H);
    }
}

const controls = new Set(['arrowright', 'arrowleft', 'arrowdown', 'arrowup', 'w', 'a', 's', 'd', 'keyw', 'keya', 'keys', 'keyd', 'shift', ' ']);
window.addEventListener('keydown', event => {
    if (event.target?.closest?.('.site-nav, .skip')) return;
    const key = event.key.toLowerCase();
    if ((event.code === 'KeyQ' || key === 'q') && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
        ping();
        return;
    }
    if (key === 'escape' && !event.repeat) {
        togglePause();
        return;
    }
    const physical = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code) ? event.code.toLowerCase() : key;
    if (paused || mission === 'won' || mission === 'intermission' || event.ctrlKey || event.metaKey || event.altKey || !controls.has(physical)) return;
    if (key === ' ' && event.target instanceof HTMLButtonElement && event.target !== byId('work')) return;
    event.preventDefault();
    keys.add(physical);
});
window.addEventListener('keyup', event => {
    keys.delete(event.key.toLowerCase());
    if (event.key === ' ' && !workHeld) blocked = false;
    if (event.code) keys.delete(event.code.toLowerCase());
});
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInput();
});

function steer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer = {
        id: event.pointerId,
        x: (event.clientX - bounds.left) * W / bounds.width,
        y: (event.clientY - bounds.top) * H / bounds.height
    };
}

canvas.addEventListener('pointerdown', event => {
    if (pointer || event.button !== 0 || paused || mission === 'intermission' || mission === 'won') return;
    canvas.setPointerCapture(event.pointerId);
    steer(event);
});
canvas.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId) steer(event);
});
canvas.addEventListener('lostpointercapture', event => {
    if (pointer?.id === event.pointerId) pointer = null;
});

function hold(id, setHeld) {
    const button = byId(id);
    button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || paused || mission === 'won' || mission === 'intermission') return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        setHeld(true);
        button.classList.add('is-held');
    });
    button.addEventListener('lostpointercapture', () => {
        setHeld(false);
        button.classList.remove('is-held');
    });
}

hold('work', value => {
    workHeld = value;
    if (!value && !keys.has(' ')) blocked = false;
});
hold('boost', value => { boostHeld = value; });
byId('sonar').addEventListener('click', () => { ping(); canvas.focus(); });
byId('pause').addEventListener('click', () => { if (mission !== 'intermission') togglePause(); });
byId('restart').addEventListener('click', () => { reset(); canvas.focus(); });
byId('overlay-action').addEventListener('click', () => {
    if (paused) togglePause();
    else if (mission === 'intermission') startStorm();
    else { reset(); canvas.focus(); }
});
byId('sound').addEventListener('click', async () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    soundEnabled = !soundEnabled;
    byId('sound').setAttribute('aria-pressed', String(soundEnabled));
    if (!soundEnabled) return;
    try {
        audio ??= new Audio();
        await audio.resume();
        sound([440, 590]);
    } catch {
        soundEnabled = false;
        byId('sound').setAttribute('aria-pressed', 'false');
    }
});

new ResizeObserver(() => {
    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(devicePixelRatio || 1, 2);
    labelScale = clamp(750 / Math.max(bounds.width, 1), 1, 1.85);
    frameWidth = canvas.width = Math.round(bounds.width * pixelRatio);
    frameHeight = canvas.height = Math.round(bounds.height * pixelRatio);
    draw();
}).observe(canvas);

let previous;
function frame(now) {
    const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, .04);
    previous = now;
    if (!paused) update(dt);
    draw();
    requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
