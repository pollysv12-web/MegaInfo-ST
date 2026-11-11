import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { renderPanel, renderDiary, renderPhone } from '../src/render.js';
import { makeStamp } from '../src/util.js';

function makeOpts() {
    const s = structuredClone(DEFAULTS);
    return {
        s, on: Object.fromEntries(Object.keys(s.modules).map((key) => [key, true])),
        stats: ['food', 'hygiene', 'energy', 'arousal'], decay: {},
        userName: 'Игрок', charName: 'Кристофер', pronoun: 'he', places: {},
    };
}

function state() {
    return {
        date: '11.11.2026', time: '15:00', elapsed: 0, scene: ['user', 'char', 'npc'], marks: [],
        people: {
            npc: { id: 'npc', role: 'npc', name: 'Друг', aff: 20, rel: 'друг' },
            user: { id: 'user', role: 'user', name: 'Игрок', outfit: 'шарф', thought: 'Тайна игрока' },
            char: { id: 'char', role: 'char', name: 'Кристофер', aff: 12, rel: 'знакомый', profile: { mbti: 'ESTP — модель добавила очень длинный текст' }, thought: 'Тайна бота', excitement: 65 },
        },
    };
}

const panel = (st, opts, data = {}) => renderPanel({ data: { state: st, ...data }, opts });

test('дневник, телефон и карточка выходят из вкладок панели', () => {
    const opts = makeOpts();
    const html = panel(state(), opts, {
        diary: { entry: 'Личная запись' },
        phone: [{ app: 'sms', kind: 'chat', items: [{ text: 'Сообщение', dir: 'in' }] }],
        card: '<article>Документ</article>',
    });
    for (const key of ['diary', 'phone', 'card']) assert.doesNotMatch(html, new RegExp(`data-mi-tab="${key}"`));
    assert.doesNotMatch(html, /Личная запись|Сообщение|Документ/);
    assert.match(renderDiary({ entry: 'Личная запись', aboutUser: 'Он задумался.' }, opts), /Личная запись/);
    assert.match(renderPhone([{ app: 'sms', kind: 'chat', items: [{ text: 'Сообщение', dir: 'in' }] }], opts, state()), /Сообщение/);
});

test('мысли игрока скрываются сразу после отключения настройки', () => {
    const opts = makeOpts();
    let html = panel(state(), opts);
    assert.match(html, /Тайна бота/);
    assert.doesNotMatch(html, /Тайна игрока/);
    opts.s.modules.sims.userThoughts = true;
    html = panel(state(), opts);
    assert.match(html, /Тайна игрока/);
    assert.match(html, /Эмоциональный подъём: 65%/);
    opts.s.modules.relations.thoughts = false;
    assert.doesNotMatch(panel(state(), opts), /Тайна игрока/);
});

test('MBTI показывает короткий тип, описание доступно по наведению и раскрытию', () => {
    const html = panel(state(), makeOpts());
    assert.match(html, /<details class="mi-mbti"><summary title="Энергичный делец:/);
    assert.match(html, /ESTP · Делец/);
    assert.match(html, /<p class="mi-mbti-description">Энергичный делец:/);
    assert.doesNotMatch(html, /модель добавила очень длинный текст/);
});

test('главная пара выше вкладок и NPC, даже когда бот временно вне сцены', () => {
    const st = state();
    st.scene = ['user', 'npc'];
    const html = panel(st, makeOpts());
    assert.ok(html.indexOf('mi-main-relation') < html.indexOf('mi-tabs'));
    const relations = html.slice(html.indexOf('data-mi-pane="rel"'));
    assert.ok(relations.indexOf('Кристофер ↔ Игрок') < relations.indexOf('Друг ↔ Игрок'));
});

test('след можно убрать доступной кнопкой; скрытые постоянные метки не выводятся', () => {
    const opts = makeOpts();
    const st = state();
    st.marks = [
        { id: 'm1', kind: 'bruise', who: 'Игрок', where: 'рука', sev: 1, at: makeStamp(st.date, st.time) },
        { id: 'm2', kind: 'tattoo', who: 'Игрок', where: 'плечо', sev: 1, at: makeStamp(st.date, st.time) },
    ];
    let html = panel(st, opts);
    assert.match(html, /<button type="button" class="mi-act mi-mark-remove" data-mi-act="remove-mark" data-mi-mark="m1"[^>]+aria-label="Убрать след: синяк, рука"/);
    assert.doesNotMatch(html, /data-mi-mark="m2"/);
    opts.s.modules.marks.trackPermanent = true;
    html = panel(st, opts);
    assert.match(html, /data-mi-mark="m2"/);
});

test('модельный текст и атрибуты экранируются в новых элементах', () => {
    const st = state();
    st.people.char.name = '<img src=x onerror=evil()>';
    st.people.char.profile.mbti = '<script>evil()</script>';
    st.marks = [{ id: 'm" onclick="evil()', kind: 'bruise', who: 'Игрок', where: '<b>рука</b>', sev: 1, at: makeStamp(st.date, st.time) }];
    const html = panel(st, makeOpts());
    assert.doesNotMatch(html, /<img|<script|data-mi-mark="m" onclick=/);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /data-mi-mark="m&quot; onclick=&quot;evil\(\)"/);
});
