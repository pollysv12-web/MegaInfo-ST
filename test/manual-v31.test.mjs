import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePulseValue, patchPulse, reapplyPulseEdits, editPulseField } from '../src/manual.js';

const state = { people: { alex: { id: 'alex', name: 'Алекс', role: 'char', stats: { food: 60, arousal: 10 }, excitement: 45, money: 1500, outfit: 'Пальто' } } };
test('ручная правка разделяет страсть и эмоциональное возбуждение, сохраняет исходное состояние', () => {
    const edited = patchPulse(state, 'alex', 'arousal', 25);
    assert.equal(edited.people.alex.stats.arousal, 25);
    assert.equal(edited.people.alex.excitement, 45);
    assert.equal(state.people.alex.stats.arousal, 10);
    assert.equal(edited.people.alex.changes.arousal[0].reason, 'Исправлено вручную');
    assert.equal(edited.people.alex.changes.arousal[0].delta, 15);
});
test('числа проверяются, значения ограничены, долг разрешён, опасные поля отклоняются', () => {
    assert.equal(normalizePulseValue('food', '150'), 100);
    assert.equal(normalizePulseValue('excitement', '-10'), 0);
    assert.equal(normalizePulseValue('money', '-23,50'), -23.5);
    for (const value of ['', 'много', Infinity]) assert.throws(() => normalizePulseValue('food', value));
    assert.throws(() => normalizePulseValue('__proto__', 'x'));
    assert.throws(() => normalizePulseValue('profile.birthday', '31.02'));
    assert.equal(normalizePulseValue('outfit', ''), '');
});
test('правка синхронизирует активный свайп и переживает запоздавший результат', () => {
    const message = { extra: { megainfo: { state: structuredClone(state) } }, swipe_id: 0, swipe_info: [{ extra: {} }, { extra: {} }] };
    globalThis.SillyTavern = { getContext: () => ({ chat: [message] }) };
    editPulseField(0, 'alex', 'food', 80);
    assert.equal(message.swipe_info[0].extra.megainfo.state.people.alex.stats.food, 80);
    assert.equal(message.swipe_info[1].extra.megainfo, undefined);
    const stale = structuredClone(state);
    stale.people.alex.money = 1000;
    const corrected = reapplyPulseEdits(message, stale);
    assert.equal(corrected.people.alex.stats.food, 80);
    assert.equal(corrected.people.alex.money, 1000);
    assert.equal(stale.people.alex.stats.food, 60);
});
