import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { applyData, buildInstruction, Slow } from '../src/core/engine.js';
import * as Pocket from '../src/core/pocket.js';

function options(charName) {
    const s = structuredClone(DEFAULTS);
    s.modules.sims.npcMax = 2;
    return {
        s, on: { sims: true, relations: true, pocket: true, slowburn: true }, stats: ['food', 'hygiene', 'energy', 'arousal'],
        decay: { food: -10, hygiene: -5, energy: -15, arousal: -10 },
        charName, userName: 'Макс', language: 'Russian', places: {}, pronoun: 'he', group: ['Лена', 'Кира'],
    };
}
const request = new Set(['sims', 'relations', 'pocket']);

test('групповой чат: все участники — главные персонажи, роли не прыгают со сменой говорящего', () => {
    const first = applyData({ base: null, request, opts: options('Лена'), data: { date: '01.06.2025', time: '10:00', people: [
        { name: 'Лена', role: 'char', aff: 0 }, { name: 'Кира', role: 'npc', aff: 0 }, { name: 'Макс', role: 'user' },
    ] } }).state;
    assert.equal(first.people['кира'].role, 'char', 'участник группы не становится NPC');
    const second = applyData({ base: first, request, opts: options('Кира'), data: { date: '01.06.2025', time: '10:20', people: [
        { name: 'Кира', role: 'char', aff: 2 }, { name: 'Макс', role: 'user' },
    ] } }).state;
    assert.equal(second.people['лена'].role, 'char');
    assert.equal(second.people['кира'].aff, 2);
    assert.ok(!second.scene.includes('лена'), 'ушедший участник группы может покинуть сцену');
    assert.match(buildInstruction({ state: second, request, opts: options('Кира') }), /group characters \(Лена, Кира\)/);
});

test('групповой чат: вещи и Slow burn привязаны к именам, а не к текущему говорящему', () => {
    const opts = options('Кира');
    const base = { date: '01.06.2025', time: '10:00', scene: ['лена', 'кира', 'user'], pockets: {}, people: {
        'лена': { id: 'лена', name: 'Лена', role: 'char' }, 'кира': { id: 'кира', name: 'Кира', role: 'char' }, user: { id: 'user', name: 'Макс', role: 'user' },
    } };
    const next = structuredClone(base);
    Pocket.apply(next, base, { pocket: { add: [{ who: 'Лена', name: 'Письмо' }, { who: 'char', name: 'Кинжал' }] } }, opts);
    assert.deepEqual(next.pockets['лена'].map((i) => i.name), ['Письмо']);
    assert.deepEqual(next.pockets['кира'].map((i) => i.name), ['Кинжал']);
    assert.equal(Slow.targetName(opts), 'Лена');
});
