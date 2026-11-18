import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { applyData } from '../src/core/engine.js';

function options(npcMax = 1) {
    const s = structuredClone(DEFAULTS);
    s.modules.sims.npcMax = npcMax;
    s.tracking.pinnedNpc = 'Кира';
    return {
        s, on: { sims: true, relations: true },
        stats: ['food', 'hygiene', 'energy', 'arousal'], decay: { food: -10, hygiene: -5, energy: -15, arousal: -10 },
        charName: 'Алекс', userName: 'Миша', language: 'Russian',
    };
}

const main = [
    { name: 'Алекс', role: 'char', new: { stats: { food: 60 } } },
    { name: 'Миша', role: 'user', new: { stats: { food: 70 } } },
];
const request = new Set(['sims', 'relations']);
const apply = (opts, people, base = null) => applyData({ base, data: { date: '11.11.2026', time: '17:00', people }, request, opts }).state;

test('закреплённый NPC в конце списка получает место в лимите, бот и игрок не сдвигаются', () => {
    const opts = options();
    const people = [...main, { name: 'Охранник', role: 'npc', mood: 'серьёзен' }, { name: 'Прохожий', role: 'npc' }, { name: 'Кира', role: 'npc', mood: 'рада встрече', new: { stats: { food: 45 }, money: 1200 } }];
    const before = structuredClone(people);
    const state = apply(opts, people);
    assert.deepEqual(state.scene, ['алекс', 'user', 'кира']);
    assert.equal(state.people.кира.stats.food, 45, 'закреплённый NPC ведётся подробно');
    assert.equal(state.people.кира.money, 1200);
    assert.equal(state.people.охранник, undefined);
    assert.equal(state.people.прохожий, undefined);
    assert.deepEqual(people, before, 'данные модели и их порядок не меняются');
});

test('закреплённый NPC обновляется, даже если новый NPC пришёл первым при заполненном лимите', () => {
    const opts = options();
    const first = apply(opts, [...main, { name: 'Кира', role: 'npc', mood: 'спокойна', new: { stats: { food: 45 } } }]);
    const state = apply(opts, [...main, { name: 'Охранник', role: 'npc' }, { name: 'КИРА', role: 'npc', mood: 'встревожена', d: { food: 10 } }], first);
    assert.deepEqual(state.scene, ['алекс', 'user', 'кира']);
    assert.equal(state.people.кира.mood, 'встревожена');
    assert.equal(state.people.кира.stats.food, 55);
    assert.equal(state.people.охранник, undefined);
});

test('отсутствующий закреплённый NPC не создаётся и не возвращается в сцену', () => {
    const opts = options();
    const initial = apply(opts, [...main, { name: 'Кира', role: 'npc', mood: 'спокойна' }]);
    const state = apply(opts, [...main, { name: 'Охранник', role: 'npc' }], initial);
    assert.deepEqual(state.scene, ['алекс', 'user', 'охранник']);
    assert.equal(state.people.кира.mood, 'спокойна', 'знакомый, но отсутствующий человек остаётся в памяти');
    const fresh = apply(opts, [...main, { name: 'Охранник', role: 'npc' }]);
    assert.equal(fresh.people.кира, undefined, 'закрепление само по себе никого не создаёт');
});

test('лимит NPC, равный нулю, исключает и закреплённого', () => {
    const state = apply(options(0), [...main, { name: 'Кира', role: 'npc', new: { stats: { food: 50 } } }]);
    assert.deepEqual(state.scene, ['алекс', 'user']);
    assert.equal(state.people.кира, undefined);
});
