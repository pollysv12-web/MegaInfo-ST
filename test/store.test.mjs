import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissMark, filterDismissedMarks, getData, setData } from '../src/store.js';
import { chatHistory, recentStory } from '../src/request.js';
import { cleanForPrompt } from '../src/tracker.js';
import { DEFAULTS } from '../src/settings.js';

function context(chat = []) {
    const c = { chat, chatMetadata: {}, extensionSettings: {}, saveSettingsDebounced() {}, saveMetadataDebounced() {} };
    globalThis.SillyTavern = { getContext: () => c };
    return c;
}

const mark = { id: 'm1', who: 'Алекс', whoId: 'алекс', kind: 'bruise', where: 'рука', at: '15.03.2025 12:00' };
const message = (marks) => ({ is_user: false, mes: 'Ответ', extra: { megainfo: { state: { marks: structuredClone(marks) } } } });

test('ручное удаление убирает тот же след из следующих ответов и сохранённых свайпов', () => {
    const first = message([mark]);
    const later = message([mark]);
    later.swipe_info = [{ extra: structuredClone(later.extra) }];
    const c = context([first, later]);
    assert.equal(dismissMark(0, 'm1'), true);
    assert.deepEqual(getData(first).state.marks, []);
    assert.deepEqual(getData(later).state.marks, []);
    assert.deepEqual(later.swipe_info[0].extra.megainfo.state.marks, []);
    assert.equal(c.chatMetadata.megainfo.dismissedMarks.length, 1);
});

test('запоздавший запрос не воскрешает удалённый след, новый след и другой чат сохраняются', () => {
    context([message([mark])]);
    dismissMark(0, 'm1');
    const newMark = { ...mark, at: '16.03.2025 12:00' };
    const state = { marks: [mark, newMark] };
    assert.deepEqual(filterDismissedMarks(state).marks, [newMark]);
    assert.equal(state.marks.length, 2, 'входное состояние не меняется');
    context();
    assert.deepEqual(filterDismissedMarks(state).marks, [mark, newMark]);
});

test('свёрнутость сохраняется вместе с данными текущего свайпа', () => {
    const m = message([]);
    m.swipe_id = 0;
    m.swipe_info = [{ extra: {} }];
    context([m]);
    setData(m, 'ui', { collapsed: true, details: { 'section:body': false } });
    assert.deepEqual(m.swipe_info[0].extra.megainfo.ui, getData(m).ui);
    assert.notEqual(m.swipe_info[0].extra.megainfo.ui, getData(m).ui);
});

test('основная и обе отдельные истории очищают маркеры и payload, сохраняя рассказ', () => {
    const text = 'Он достал телефон. [[mi:phone]] Затем открыл письмо. [[ MI:card ]]\n<megainfo>{"phone":[]}</megainfo>';
    context([{ name: 'Алекс', is_user: false, mes: text }]);
    const clean = cleanForPrompt(text, 0, structuredClone(DEFAULTS));
    for (const value of [clean, recentStory(0, 6), chatHistory(0, 60)[0].content]) {
        assert.match(value, /Он достал телефон/);
        assert.match(value, /Затем открыл письмо/);
        assert.doesNotMatch(value, /\[\[|megainfo|"phone"/);
    }
});
