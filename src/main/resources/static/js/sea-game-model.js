export const cases = {
    storm: {
        title: 'След бурята',
        clue: 'Стръковете губят цвят и пасажите оредяват.',
        cause: 'sediment',
        readings: [20, 7.5, 20],
        initial: { grass: 48, fish: 12, clarity: 20 },
        explanation: 'Наносите намаляват светлината, от която тревата се нуждае.'
    },
    heat: {
        title: 'Гореща седмица',
        clue: 'Водата изглежда бистра, но рибите плуват близо до повърхността.',
        cause: 'heat',
        readings: [31, 3, 85],
        initial: { grass: 59, fish: 10, clarity: 85 },
        explanation: 'При горещата вълна кислородът е нисък, а рибите показват признаци на стрес.'
    },
    anchors: {
        title: 'Натоварен залив',
        clue: 'В тревата се отварят тесни ивици оголено дъно след преминаване на лодки.',
        cause: 'anchors',
        readings: [21, 8, 88],
        initial: { grass: 37, fish: 13, clarity: 88 },
        explanation: 'Котвите оставят видими бразди, дори когато измерените условия във водата са добри.'
    }
};

export const diagnoses = {
    sediment: 'Наноси във водата', heat: 'Гореща вълна и нисък кислород', anchors: 'Следи от котви'
};

export const measures = {
    sediment: 'Ограничи източника на наноси',
    anchors: 'Въведи зона без закотвяне',
    heat: 'Ограничи притока на хранителни вещества'
};

export const samples = [
    { label: 'Температура', unit: '°C', typical: '18–24 °C', location: 'повърхност' },
    { label: 'Кислород', unit: 'мг/л', typical: '6–9 мг/л', location: 'край пасажа' },
    { label: 'Прозрачност', unit: '%', typical: '75–95%', location: 'над ливадата' }
];

const clamp = (value, max = 100) => Math.max(0, Math.min(max, value));

export function advanceBay(bay, cause, action, step) {
    const relief = action === cause;
    const storm = step === 1;
    const heatwave = step === 2;
    const clarity = clamp(bay.clarity + (storm ? -8 : 4) + (relief && cause === 'sediment' ? 23 : 0));
    const grass = clamp(bay.grass - (storm ? 8 : heatwave ? 6 : 3) + (relief ? 19 : 0));
    const fish = clamp(bay.fish - (storm || heatwave ? 3 : 1) + (relief ? 6 : 0), 30);
    return { grass, fish, clarity };
}

export const route = {
    start: [.09, .75],
    shelter: [.91, .72],
    food: [[.23, .51], [.49, .76], [.72, .42]],
    cover: [[.18, .78], [.43, .76], [.65, .77], [.83, .76]]
};

export function moveFish(state, dx, dy) {
    if (state.result) return;
    const limit = (value, min, max) => Math.max(min, Math.min(max, value));
    state.x = limit(state.x + dx, .06, .94);
    state.y = limit(state.y + dy, .18, .84);
    if (dx) state.direction = Math.sign(dx);
    state.step++;
    const distance = ([x, y]) => Math.hypot(state.x - x, state.y - y);
    route.food.forEach((food, index) => {
        if (distance(food) < .075) state.food.add(index);
    });
    const cover = state.round === 1 ? route.cover : [route.cover[0]];
    state.hidden = cover.some(patch => distance(patch) < .105);
    state.predator = [
        .5 + Math.sin(state.step * .37) * .37,
        .47 + Math.sin(state.step * .57 + .5) * .24
    ];
    const caught = distance(state.predator) < .12 && !state.hidden;
    if (caught) state.result = 'caught';
    else if (distance(route.shelter) < .085 && state.food.size === route.food.length) state.result = 'safe';
}
