import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { renderDiary, renderPanel } from '../src/render.js';

function fixture() {
    const s = structuredClone(DEFAULTS);
    const opts = {
        s, on: Object.fromEntries(Object.keys(s.modules).map((key) => [key, true])),
        stats: ['food', 'hygiene', 'energy', 'arousal'], decay: {},
        userName: 'Игрок', charName: 'Алекс', pronoun: 'he', places: {},
    };
    const state = {
        date: '12.11.2026', time: '14:00', scene: ['char', 'user'], marks: [],
        people: {
            char: { id: 'char', role: 'char', name: 'Алекс', money: 1250, aff: 15, rel: 'друг',
                profile: { birthday: '01.02', mbti: 'INTJ' }, stats: { food: 70 },
                changes: { money: [{ kind: 'event', from: 1500, to: 1250, delta: -250, reason: 'Купил кофе' }] } },
            user: { id: 'user', role: 'user', name: 'Игрок', money: 3500, stats: { food: 80 } },
        },
        tx: [{ who: 'Алекс', amount: -250, note: 'Купил кофе' }],
        pockets: { char: [{ id: 'key', name: 'Значимый ключ', note: 'От мастерской' }] },
    };
    return { opts, state };
}

const render = (f) => renderPanel({ data: { state: f.state }, opts: f.opts });
function pane(html, key) {
    const start = html.indexOf(`data-mi-pane="${key}"`);
    if (start < 0) return '';
    const next = html.indexOf('data-mi-pane="', start + 1);
    return html.slice(start, next < 0 ? undefined : next);
}

test('relationships appear in their tab and never pin a relation bar above the tabs', () => {
    const f = fixture();
    const html = render(f);
    assert.doesNotMatch(html, /mi-main-relation/);
    assert.doesNotMatch(html.slice(0, html.indexOf('class="mi-tabs"')), /mi-aff|Алекс ↔ Игрок/);
    assert.match(html, /data-mi-tab="rel"/);
    assert.match(pane(html, 'rel'), /Алекс ↔ Игрок/);
    assert.match(pane(html, 'rel'), /mi-aff/);
    f.state.scene = ['user'];
    assert.match(pane(render(f), 'rel'), /Алекс ↔ Игрок/);
});

test('Pulse money and its reason/editor are inside General information, never the immediate person cards', () => {
    const html = pane(render(fixture()), 'chars');
    const info = html.indexOf('data-mi-sec="profile"');
    assert.ok(info > 0);
    assert.doesNotMatch(html.slice(0, info), /class="mi-pulse-field mi-money"|data-mi-field="money"/);
    const inside = html.slice(info);
    assert.match(inside, /Общая информация/);
    assert.match(inside, /data-mi-sec="change:char:money"/);
    assert.match(inside, /data-mi-act="edit-field" data-mi-person="char" data-mi-field="money"/);
    assert.match(inside, /Купил кофе/);
    assert.match(inside, /1[\s\u00a0\u202f]?250/);
});

test('independent money tracking remains visible when personal profile fields are disabled', () => {
    for (const mode of ['per-person', 'module', 'display']) {
        const f = fixture();
        if (mode === 'per-person') f.opts.s.tracking.overrides = { алекс: { fields: { profile: false } } };
        if (mode === 'module') f.opts.s.modules.sims.showProfile = false;
        if (mode === 'display') f.opts.s.display.pulse.profile = 'hide';
        const html = pane(render(f), 'chars');
        assert.match(html, /Общая информация/, mode);
        assert.match(html, /data-mi-person="char" data-mi-field="money"/, mode);
        assert.doesNotMatch(html, /data-mi-person="char" data-mi-field="profile\.birthday"/, mode);
    }
});

test('money visibility options remain independent within General information', () => {
    const f = fixture();
    f.opts.s.display.pulse.money = 'collapse';
    let html = pane(render(f), 'chars');
    assert.match(html, /data-mi-sec="profile"[\s\S]*?<details class="mi-pulse-more" data-mi-sec="pulse:char:money"><summary>Деньги/);
    f.opts.s.display.pulse.money = 'hide';
    html = pane(render(f), 'chars');
    assert.doesNotMatch(html, /data-mi-field="money"|Купил кофе|mi-tx-item/);
    f.opts.s.display.pulse.profile = 'hide';
    assert.doesNotMatch(pane(render(f), 'chars'), /Общая информация/);
    f.opts.s.display.pulse.profile = 'collapse';
    f.opts.s.display.pulse.money = 'show';
    f.opts.s.tracking.overrides = { алекс: { fields: { money: false } } };
    html = pane(render(f), 'chars');
    assert.doesNotMatch(html, /data-mi-person="char" data-mi-field="money"|Купил кофе/);
    assert.match(html, /data-mi-person="user" data-mi-field="money"/);
});

test('Pocket only renders in its own pane rather than duplicating its inventory in Pulse', () => {
    const html = render(fixture());
    assert.doesNotMatch(pane(html, 'chars'), /Кармашек|mi-pocket-summary|Значимый ключ/);
    assert.match(pane(html, 'pocket'), /Значимый ключ/);
    assert.match(pane(html, 'pocket'), /data-mi-act="pocket-edit"/);
    assert.match(pane(html, 'pocket'), /data-mi-act="pocket-remove"/);
});

test('notes expose an initially open native disclosure with a stable persistence key', () => {
    const f = fixture();
    const html = renderDiary({ title: 'Вечер в кофейне', date: '12.11.2026', entry: 'Длинная запись', aboutUser: 'Он пришёл вовремя.' }, f.opts);
    assert.match(html, /^<details class="mi-diary" data-mi-sec="diary" open>/);
    const summary = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'));
    assert.match(summary, /Заметки/);
    assert.match(summary, /Вечер в кофейне/);
    assert.match(summary, /mi-diary-chevron/);
    assert.doesNotMatch(summary, /Длинная запись|Он пришёл вовремя|data-mi-act/);
    assert.match(html, /<div class="mi-diary-body">[\s\S]*Длинная запись[\s\S]*data-mi-act="diary"[\s\S]*<\/details>$/);
});

test('notes escape their summary and hidden body rather than allowing model markup', () => {
    const html = renderDiary({ title: '<img src=x onerror=evil()>', date: '<script>date</script>', entry: '<svg onload=evil()>', aboutUser: '<iframe>bad</iframe>' }, fixture().opts);
    assert.doesNotMatch(html, /<img|<script|<svg|<iframe/);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;svg/);
    assert.equal(renderDiary(null, fixture().opts), '');
});
