import test from 'node:test';
import assert from 'node:assert/strict';
import { validateState } from '../src/manual.js';

const good = () => ({
    date: '10.05.2025', time: '12:00', location: 'Кафе',
    people: { 'лена': { id: 'лена', name: 'Лена', role: 'char', stats: { food: 140, energy: '30' }, aff: -300, money: '1500' } },
    scene: ['лена'], marks: [], pockets: { 'лена': [{ id: 'p1', name: 'Ключ' }] },
});

test('редактор блока принимает корректное состояние и приводит числа к границам', () => {
    const { state, errors } = validateState(good());
    assert.deepEqual(errors, []);
    assert.equal(state.people['лена'].stats.food, 100);
    assert.equal(state.people['лена'].stats.energy, 30);
    assert.equal(state.people['лена'].aff, -100);
    assert.equal(state.people['лена'].money, 1500);
});

test('редактор блока отклоняет сломанную структуру с понятными причинами', () => {
    assert.equal(validateState([]).state, null);
    assert.equal(validateState(null).errors.length, 1);
    const bad = good();
    bad.people['лена'].role = 'boss';
    bad.people['лена'].stats.food = 'много';
    bad.scene.push('призрак');
    bad.pockets['лена'] = 'ключ';
    const { state, errors } = validateState(bad);
    assert.equal(state, null);
    assert.ok(errors.some((e) => /role/.test(e)));
    assert.ok(errors.some((e) => /stats\.food/.test(e)));
    assert.ok(errors.some((e) => /призрак/.test(e)));
    assert.ok(errors.some((e) => /pockets/.test(e)));
});
