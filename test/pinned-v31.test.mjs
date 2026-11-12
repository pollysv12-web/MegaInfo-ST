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

test('a pinned NPC supplied last receives the limited NPC slot without moving bot/user', () => {
    const opts = options();
    const people = [...main, { name: 'Охранник', role: 'npc', mood: 'серьёзен' }, { name: 'Прохожий', role: 'npc' }, { name: 'Кира', role: 'npc', mood: 'рада встрече', new: { stats: { food: 45 }, money: 1200 } }];
    const before = structuredClone(people);
    const state = apply(opts, people);
    assert.deepEqual(state.scene, ['алекс', 'user', 'кира']);
    assert.equal(state.people.кира.stats.food, 45, 'pinned NPC uses detailed tracking');
    assert.equal(state.people.кира.money, 1200);
    assert.equal(state.people.охранник, undefined);
    assert.equal(state.people.прохожий, undefined);
    assert.deepEqual(people, before, 'model input and its order remain unchanged');
});

test('a pinned existing NPC still updates when a new NPC appears first at the cap', () => {
    const opts = options();
    const first = apply(opts, [...main, { name: 'Кира', role: 'npc', mood: 'спокойна', new: { stats: { food: 45 } } }]);
    const state = apply(opts, [...main, { name: 'Охранник', role: 'npc' }, { name: 'КИРА', role: 'npc', mood: 'встревожена', d: { food: 10 } }], first);
    assert.deepEqual(state.scene, ['алекс', 'user', 'кира']);
    assert.equal(state.people.кира.mood, 'встревожена');
    assert.equal(state.people.кира.stats.food, 55);
    assert.equal(state.people.охранник, undefined);
});

test('an absent pinned NPC is not manufactured or placed back in the scene', () => {
    const opts = options();
    const initial = apply(opts, [...main, { name: 'Кира', role: 'npc', mood: 'спокойна' }]);
    const state = apply(opts, [...main, { name: 'Охранник', role: 'npc' }], initial);
    assert.deepEqual(state.scene, ['алекс', 'user', 'охранник']);
    assert.equal(state.people.кира.mood, 'спокойна', 'known absent person remains in memory');
    const fresh = apply(opts, [...main, { name: 'Охранник', role: 'npc' }]);
    assert.equal(fresh.people.кира, undefined, 'pin alone never creates someone');
});

test('an explicit zero NPC limit continues to exclude even the pinned NPC', () => {
    const state = apply(options(0), [...main, { name: 'Кира', role: 'npc', new: { stats: { food: 50 } } }]);
    assert.deepEqual(state.scene, ['алекс', 'user']);
    assert.equal(state.people.кира, undefined);
});
