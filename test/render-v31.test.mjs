import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { renderPanel } from '../src/render.js';

function fixture() {
    const s = structuredClone(DEFAULTS);
    const opts = {
        s, on: Object.fromEntries(Object.keys(s.modules).map(k => [k, true])),
        stats: ['food', 'hygiene', 'energy', 'arousal'], decay: {},
        userName: 'Игрок', charName: 'Алекс', pronoun: 'he', places: {},
    };
    const person = {
        id: 'char', name: 'Алекс', role: 'char', stats: { food: 65, hygiene: 80, energy: 60, arousal: 7 },
        diff: { food: 15 }, excitement: 0, money: 1200, mood: 'Рад встрече', outfit: 'Синий свитер',
        thought: 'Приятно увидеть его.', profile: { birthday: '01.02', mbti: 'INTJ' }, aff: 12,
        changes: { food: [
            { kind: 'time', from: 50, to: 45, delta: -5, reason: 'Прошёл игровой час.' },
            { kind: 'event', from: 45, to: 65, delta: 20, reason: 'Поел супа.' },
        ] },
    };
    const npc = { id: 'npc', name: 'Кира', role: 'npc', mood: 'Задумалась', outfit: 'Фартук', stats: { food: 20 }, money: 600, excitement: 10 };
    const state = {
        date: '12.11.2026', time: '12:00', scene: ['char', 'npc'], people: { char: person, npc }, marks: [],
        slow: { points: 0, moments: [] }, world: { tension: 4, plot: 'Встреча', progress: 1,
            threads: [{ id: 't1', text: 'Обещал вернуть книгу', endings: ['Вернуть при встрече', 'Объяснить задержку'] }] },
        pockets: { char: [{ id: 'p1', name: 'Ключи', note: 'С брелоком-сердцем' }] },
    };
    return { opts, state, person, npc };
}

const panel = (f) => renderPanel({ data: { state: f.state }, opts: f.opts });

test('emotional excitement and sexual passion have separate values and accessible disclosures', () => {
    const f = fixture();
    const html = panel(f);
    assert.match(html, /data-mi-stat="arousal"[\s\S]*?Страсть: 7%/);
    assert.match(html, /data-mi-stat="excitement"[\s\S]*?Возбуждение: 0%/);
    assert.match(html, /Радость, азарт и предвкушение; не сексуальная страсть/);
    assert.match(html, /<details class="mi-stat-change" data-mi-sec="change:char:food"><summary title=/);
    assert.match(html, /По времени −5: Прошёл игровой час/);
    assert.match(html, /В сцене \+20: Поел супа/);
    assert.match(html, /50 → 45/);
    assert.match(html, /45 → 65/);
    assert.match(html, />Slow burn<\/span>/);
});

test('each Pulse value can be edited without exposing field pencils in other panes', () => {
    const f = fixture();
    const html = panel(f);
    const pulse = html.slice(html.indexOf('data-mi-pane="chars"'), html.indexOf('data-mi-pane="npc"'));
    for (const field of ['food', 'hygiene', 'energy', 'arousal', 'excitement', 'money', 'mood', 'outfit', 'thought', 'profile.birthday', 'profile.zodiac', 'profile.mbti']) {
        assert.match(pulse, new RegExp(`data-mi-field="${field.replace('.', '\\.')}"`));
    }
    assert.doesNotMatch(html.slice(html.indexOf('data-mi-pane="npc"')), /data-mi-act="edit-field"/);
    f.opts.s.display.editControls = false;
    assert.doesNotMatch(panel(f), /data-mi-act="edit-field"/);
});

test('Pulse hidden and collapsed options actually change output and tracking choices are independent', () => {
    const f = fixture();
    f.opts.s.display.pulse.outfit = 'collapse';
    f.opts.s.display.pulse.money = 'hide';
    f.opts.s.display.pulse.excitement = 'hide';
    f.state.tx = [{ who: 'Алекс', amount: -300, note: 'Скрытая покупка' }];
    const html = panel(f);
    assert.match(html, /<details class="mi-pulse-more" data-mi-sec="pulse:char:outfit"><summary>Одежда/);
    assert.doesNotMatch(html, /data-mi-field="money"|Скрытая покупка|data-mi-stat="excitement"/);
    assert.match(html, /data-mi-stat="food"/);
    f.opts.s.tracking.overrides = { алекс: { detail: 'full', fields: { outfit: false, thought: false } } };
    assert.doesNotMatch(panel(f), /Синий свитер|Приятно увидеть его/);
});

test('short NPCs stay brief while a pinned or specifically selected NPC exposes requested state', () => {
    const f = fixture();
    let html = panel(f);
    let npc = html.slice(html.indexOf('data-mi-pane="npc"'), html.indexOf('data-mi-pane="rel"'));
    assert.match(npc, /Фартук/);
    assert.doesNotMatch(npc, /data-mi-stat="food"|600/);
    f.opts.s.tracking.pinnedNpc = 'Кира';
    html = panel(f);
    npc = html.slice(html.indexOf('data-mi-pane="npc"'), html.indexOf('data-mi-pane="rel"'));
    assert.match(npc, /data-mi-stat="food"/);
    f.opts.s.tracking.pinnedNpc = '';
    f.opts.s.tracking.overrides = { кира: { detail: 'short', fields: { stats: true } } };
    html = panel(f);
    npc = html.slice(html.indexOf('data-mi-pane="npc"'), html.indexOf('data-mi-pane="rel"'));
    assert.match(npc, /data-mi-stat="food"/);
    f.opts.s.tracking.overrides.кира.detail = 'off';
    assert.doesNotMatch(panel(f), /data-mi-pane="npc"/);
});

test('tab order, pocket CRUD controls and dismissible story threads are rendered with safe identifiers', () => {
    const f = fixture();
    f.opts.s.display.tabOrder = ['pocket', 'world', 'chars'];
    const html = panel(f);
    const tabs = [...html.matchAll(/data-mi-tab="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(tabs.slice(0, 3), ['pocket', 'world', 'chars']);
    assert.match(html, /data-mi-act="pocket-add" data-mi-person="char"/);
    assert.match(html, /data-mi-act="pocket-edit" data-mi-person="char" data-mi-item="p1"/);
    assert.match(html, /data-mi-act="pocket-remove" data-mi-person="char" data-mi-item="p1"/);
    assert.match(html, /data-mi-act="thread-dismiss" data-mi-thread="t1"/);
    assert.match(html, /<details class="mi-thread-endings"/);
    assert.match(html, /Варианты, а не предрешённые события/);
    f.person.changes.food[0].reason = '</summary><img src=x onerror=evil()>';
    f.state.pockets.char[0] = { id: 'p" onclick="evil()', name: '<svg onload=evil()>', note: '<script>evil()</script>' };
    f.state.world.threads[0].text = '<img src=x>';
    f.state.world.threads[0].endings = ['<iframe>evil</iframe>'];
    const malicious = panel(f);
    assert.doesNotMatch(malicious, /<img|<svg|<script|<iframe|data-mi-item="p" onclick=/);
    assert.match(malicious, /&lt;svg/);
    assert.match(malicious, /data-mi-item="p&quot; onclick=&quot;evil\(\)"/);
});
