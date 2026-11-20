'use strict';

const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const inputs = [...document.querySelectorAll('input[type="range"]')];
const buttons = [...document.querySelectorAll('[data-scenario]')];
const pause = document.querySelector('#pause');
const population = document.querySelector('#population');
const fishHealth = document.querySelector('#fish-health');
const grassHealth = document.querySelector('#grass-health');
const observation = document.querySelector('#observation');
const scenarios = {
    balanced: [20, 8, 85, 25],
    hot: [31, 3, 82, 15],
    murky: [22, 5, 12, 55]
};
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const random = count => Array.from({ length: count }, () => Math.random());
const plants = Array.from({ length: 104 }, () => random(5)).sort((a, b) => a[1] - b[1]);
const particles = Array.from({ length: 85 }, () => random(4));
const fish = Array.from({ length: 30 }, (_, index) => ({
    school: index % 3,
    offset: random(4)
}));
let width, height, scale, environment, frame, previous;
let time = 0;
let health = 1;
let grass = 1;
let count = 30;
let running = !matchMedia('(prefers-reduced-motion: reduce)').matches;

function syncInputs() {
    const values = inputs.map(input => {
        document.querySelector('output[for="' + input.id + '"]').textContent =
            Number(input.value).toLocaleString('bg-BG') + ' ' + input.dataset.unit;
        return Number(input.value);
    });
    const [temperature, oxygen, clarity, current] = values;
    environment = { temperature, oxygen, clarity: clarity / 100, current: current / 100 };
    buttons.forEach(button => {
        const selected = scenarios[button.dataset.scenario].every((value, index) => value === values[index]);
        button.setAttribute('aria-pressed', selected);
    });
    if (oxygen < 4) observation.textContent = 'Недостиг на кислород. Рибите се придвижват към повърхността.';
    else if (temperature > 27) observation.textContent = 'Горещата вода натоварва рибите и морската трева.';
    else if (temperature < 14) observation.textContent = 'Студената вода забавя движенията на рибите и растежа на тревата.';
    else if (clarity < 40) observation.textContent = 'Мътната вода пропуска по-малко светлина към морската трева.';
    else if (current > 70) observation.textContent = 'Силното течение огъва тревата и измества пасажите.';
    else observation.textContent = 'При тези условия пасажите се събират, а морската трева се възстановява.';
    if (!running) draw();
}

function setScenario(name) {
    inputs.forEach((input, index) => { input.value = scenarios[name][index]; });
    syncInputs();
}

function update(dt) {
    const { temperature, oxygen, clarity, current } = environment;
    const heat = clamp((temperature - 24) / 9);
    const cold = clamp((15 - temperature) / 9);
    const oxygenStress = clamp((6 - oxygen) / 5);
    const fishTarget = clamp(1 - heat * .42 - cold * .24 - oxygenStress * .76 - clamp((current - .65) / .35) * .17);
    const grassTarget = clamp(1 - clamp((.72 - clarity) / .67) * .74 - heat * .42 - cold * .26 - current ** 4 * .27 - oxygenStress * .15);
    health = mix(health, fishTarget, 1 - Math.exp(-dt / 5));
    grass = mix(grass, grassTarget, 1 - Math.exp(-dt / 8));
    count = mix(count, fish.length * clamp((health - .12) / .75) * (.45 + .55 * grass), 1 - Math.exp(-dt / 9));
    time += dt;
}

function showStats() {
    population.textContent = Math.round(count);
    fishHealth.textContent = Math.round(100 * health) + '%';
    grassHealth.textContent = Math.round(100 * grass) + '%';
}

function drawWater(w, h) {
    const { temperature, clarity } = environment;
    const color = mix(171, 199, clamp((25 - temperature) / 15));
    const water = ctx.createLinearGradient(0, 0, 0, h);
    water.addColorStop(0, 'hsl(' + color + ', 69%, 34%)');
    water.addColorStop(.35, 'hsl(' + color + ', 77%, 23%)');
    water.addColorStop(1, '#04161e');
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, w, h);
    const halo = ctx.createRadialGradient(w * .35, 0, 0, w * .35, 0, h * .85);
    halo.addColorStop(0, 'rgba(156, 255, 225, ' + clarity * .68 + ')');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
        const origin = w * (.05 + i * .12) + Math.sin(time * .33 + i) * 15;
        const ray = ctx.createLinearGradient(0, 0, 0, h * .78);
        ray.addColorStop(0, 'rgba(185, 255, 230, ' + clarity * .15 + ')');
        ray.addColorStop(1, 'transparent');
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(origin, 0);
        ctx.lineTo(origin + 13, 0);
        ctx.lineTo(origin + w * .26, h * .79);
        ctx.lineTo(origin + w * .12, h * .79);
        ctx.fill();
    }
    ctx.lineWidth = 1;
    for (let row = 0; row < 7; row++) {
        ctx.strokeStyle = 'rgba(178, 247, 235, ' + clarity * (.22 - row * .023) + ')';
        ctx.beginPath();
        for (let x = 0; x <= w + 8; x += 8) {
            const y = row * 5 + 5 + Math.sin(x / 28 + time * 1.6 + row * .65) * 3 + Math.sin(x / 65 - time) * 5;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.fillStyle = '#143438';
    ctx.beginPath();
    ctx.moveTo(0, h * .83);
    ctx.bezierCurveTo(w * .28, h * .7, w * .6, h * .99, w, h * .82);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    for (const [x, y, size, phase] of particles) {
        const px = ((x * w + time * (5 + environment.current * 38)) % w);
        const py = ((y * h - time * (4 + size * 10)) % h + h) % h;
        ctx.globalAlpha = (.2 + phase * .65) * (size > .85 ? 1 : 1 - clarity * .82);
        ctx.fillStyle = size > .85 ? '#baf9e9' : '#cfbd89';
        ctx.beginPath();
        ctx.arc(px, py, .45 + size * 1.9, 0, Math.PI * 2);
        if (size > .85) ctx.strokeStyle = '#baf9e9';
        if (size > .85) ctx.stroke();
        else ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawPlants(w, h, foreground) {
    for (const [position, depth, length, phase, hue] of plants) {
        if ((depth > .56) !== foreground) continue;
        const x = position * w;
        const y = (.83 + depth * .2) * h;
        const blade = h * (.07 + length * .31) * (.24 + grass * .76) * (.5 + depth * .5);
        const bend = (Math.sin(time * (1.4 + environment.current) + phase * 6) * .25 + environment.current * .85 - .13) * blade;
        const tone = Math.round(mix(42, 154, grass) + hue * 20);
        const thickness = 1 + length * 5 + depth * 3;
        ctx.fillStyle = 'hsl(' + tone + ', ' + (30 + grass * 34) + '%, ' + (14 + hue * 19 + depth * 7) + '%)';
        ctx.beginPath();
        ctx.moveTo(x - thickness / 2, y);
        ctx.quadraticCurveTo(x + bend * .16, y - blade * .57, x + bend, y - blade);
        ctx.quadraticCurveTo(x + thickness + bend * .6, y - blade * .46, x + thickness / 2, y);
        ctx.fill();
    }
}

function drawFish(w, h) {
    const { temperature, oxygen, current } = environment;
    const urgency = clamp((5 - oxygen) / 4);
    const pace = .12 + clamp((temperature - 7) / 22) * .55 + current * .24;
    for (let i = 0; i < Math.min(fish.length, Math.ceil(count)); i++) {
        const { school, offset: [a, b, c, d] } = fish[i];
        const phase = fishPhase + school * 2.1;
        const x = w * (.5 + Math.sin(phase) * .32 + (a - .5) * (.21 + (1 - health) * .18));
        const depth = .35 + school * .108;
        const y = h * (mix(depth, .25, urgency) + Math.sin(time * .65 + school + a) * .042 + (b - .5) * .19);
        const size = (9 + c * 15) * clamp(w / 630, .58, 1.25);
        const wag = Math.sin(time * (6 + pace * 8) + a * 13) * 5;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale((Math.cos(phase) > 0 ? 1 : -1) * size / 20, size / 20);
        ctx.globalAlpha = clamp(count - i) * (.48 + d * .48);
        const colors = [['#afece8', '#26748c'], ['#ffd89a', '#c36a32'], ['#9eeacf', '#297f71']];
        const body = ctx.createLinearGradient(0, -8, 0, 8);
        body.addColorStop(0, colors[school][1]);
        body.addColorStop(.61, colors[school][0]);
        body.addColorStop(1, '#557e83');
        ctx.fillStyle = colors[school][1];
        ctx.beginPath();
        ctx.moveTo(-13, 0);
        ctx.quadraticCurveTo(-20, -4, -25, -8 + wag);
        ctx.lineTo(-23, wag);
        ctx.lineTo(-25, 8 + wag);
        ctx.closePath();
        ctx.moveTo(-8, -4);
        ctx.quadraticCurveTo(-7, -10, 3, -10);
        ctx.lineTo(0, -3);
        ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        ctx.bezierCurveTo(-2, -11, 12, -7, 17, 0);
        ctx.bezierCurveTo(12, 8, -3, 10, -14, 0);
        ctx.fill();
        ctx.fillStyle = '#142e36';
        ctx.beginPath();
        ctx.arc(10, -1.6, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

let fishPhase = 0;
function draw() {
    if (!width || !height) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawWater(width, height);
    drawPlants(width, height, false);
    drawFish(width, height);
    drawPlants(width, height, true);
    const haze = (1 - environment.clarity) ** 2 * .55;
    ctx.fillStyle = 'rgba(95, 102, 64, ' + haze + ')';
    ctx.fillRect(0, 0, width, height);
}

function tick(now) {
    const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, .05);
    previous = now;
    update(dt);
    fishPhase += dt * (.12 + clamp((environment.temperature - 7) / 22) * .55 + environment.current * .24);
    draw();
    showStats();
    frame = requestAnimationFrame(tick);
}

function syncPlayback() {
    pause.textContent = running ? 'Пауза' : 'Продължи';
    cancelAnimationFrame(frame);
    previous = undefined;
    if (running) frame = requestAnimationFrame(tick);
}

inputs.forEach(input => input.addEventListener('input', syncInputs));
buttons.forEach(button => button.addEventListener('click', () => setScenario(button.dataset.scenario)));
pause.addEventListener('click', () => {
    running = !running;
    syncPlayback();
});
document.querySelector('#reset').addEventListener('click', () => {
    time = fishPhase = 0;
    health = grass = 1;
    count = 30;
    setScenario('balanced');
    showStats();
    draw();
});

syncInputs();
new ResizeObserver(() => {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    draw();
}).observe(canvas);
syncPlayback();
