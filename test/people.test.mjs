import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { applyData, People } from '../src/core/engine.js';

function options() {
    const s = structuredClone(DEFAULTS);
    s.modules.sims.birthdays = true;
    s.modules.sims.userThoughts = false;
    return {
        s, on: { sims: true, relations: true },
        stats: ['food', 'hygiene', 'energy', 'arousal'],
        decay: { food: -10, hygiene: -5, energy: -15, arousal: -10 },
        charName: 'Кристофер', userName: 'Саша', language: 'Russian',
    };
}

const request = new Set(['sims', 'relations']);
function step(opts, base, data) { return applyData({ base, data, request, opts }).state; }
function initial(opts, char = {}, user = {}) {
    return step(opts, null, {
        date: '01.06.2026', time: '10:00',
        people: [
            { name: opts.charName, role: 'char', new: { stats: { food: 70, hygiene: 80, energy: 70, arousal: 10 }, ...char } },
            { name: opts.userName, role: 'user', new: { stats: { food: 70, hygiene: 80, energy: 70, arousal: 5 }, ...user } },
        ],
    });
}

test('страсть утихает и не растёт сама, даже при старой положительной скорости', () => {
    const opts = options();
    opts.decay.arousal = 10;
    let state = initial(opts, { stats: { arousal: 80 } });
    state = step(opts, state, { time: '14:00' });
    assert.equal(state.people['кристофер'].stats.arousal, 60);
    assert.equal(state.people.user.stats.arousal, 5, 'спокойное время не повышает низкое значение');
    state = step(opts, state, { date: '02.06.2026', time: '14:00' });
    assert.equal(state.people['кристофер'].stats.arousal, 10, 'страсть утихает до спокойного уровня, а не уходит в минус');
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', set: { arousal: 0 } }] });
    state = step(opts, state, { time: '18:00' });
    assert.equal(state.people['кристофер'].stats.arousal, 0, 'после разрядки страсть остаётся нулевой до нового события');
});

test('страсть может падать по событиям; радость и азарт — отдельное значение', () => {
    const opts = options();
    let state = initial(opts, { stats: { arousal: 75 } });
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', d: { arousal: -25, excitement: 70 } }] });
    assert.equal(state.people['кристофер'].stats.arousal, 50);
    assert.equal(state.people['кристофер'].excitement, 70);
    state = step(opts, state, { time: '12:00' });
    assert.equal(state.people['кристофер'].excitement, 55);
    assert.equal(state.people['кристофер'].stats.arousal, 40);
    assert.match(People.rules(state, request, opts).join('\n'), /Ordinary joy.*never d\.arousal/);
});

test('двадцать четыре коротких хода копят спад, а не теряют его на округлении', () => {
    const opts = options();
    let state = initial(opts, { stats: { food: 80, arousal: 90 }, excitement: 60 });
    for (let turn = 1; turn <= 24; turn++) {
        const minutes = 10 * 60 + turn * 5;
        state = step(opts, state, { time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` });
    }
    assert.ok(Math.abs(state.people['кристофер'].stats.arousal - 80) < 0.002, 'ходы по пять минут дают в сумме два часа спада страсти');
    assert.ok(Math.abs(state.people['кристофер'].stats.food - 70) < 0.002, 'спад потребностей тоже не теряется на коротких ходах');
    assert.equal(state.people['кристофер'].excitement, 45, 'воодушевление тоже копит дробный спад');
    assert.ok(Object.values(state.people['кристофер'].diff).every(Number.isInteger), 'стрелки изменений остаются целыми числами');
});

test('голод и гигиена замечаются рано, а сексуальные проявления — только при высокой страсти', () => {
    const opts = options();
    const state = initial(opts, { stats: { food: 20, hygiene: 24, energy: 15, arousal: 84 } }, { stats: { food: 21, hygiene: 25, energy: 16, arousal: 85 } });
    const warnings = People.collectWarnings(state, opts);
    assert.deepEqual(warnings.filter((w) => w.id === 'кристофер').map((w) => w.stat), ['food', 'hygiene', 'energy']);
    assert.deepEqual(warnings.filter((w) => w.id === 'user').map((w) => w.stat), ['arousal']);
    const context = People.stateLines(state, opts).join('\n');
    assert.match(context, /Only observable signs/);
    assert.match(context, /proximity and personality/);
    assert.match(context, /other characters cannot read/);
});

test('нулевая сытость или бодрость допускает слабость, но не решает за игрока', () => {
    const opts = options();
    const state = initial(opts, {}, { stats: { food: 0, energy: 0 } });
    const critical = People.collectWarnings(state, opts).filter((w) => w.critical);
    assert.deepEqual(critical.map((w) => w.stat), ['food', 'energy']);
    assert.ok(critical.every((w) => /возможны.*обморок/.test(w.text)));
    assert.match(People.stateLines(state, opts).join('\n'), /Do not decide the user’s.*loss of consciousness/);
    assert.equal(state.people.user.unconscious, undefined);
});

test('неизвестный день рождения получает постоянную дату без выдуманного возраста', () => {
    const opts = options();
    const a = initial(opts);
    const b = initial(opts);
    for (const id of ['кристофер', 'user']) {
        assert.match(a.people[id].profile.birthday, /^\d{2}\.\d{2}$/);
        assert.deepEqual(People.birthdayParts(a.people[id].profile.birthday)?.year, null);
        assert.equal(a.people[id].profile.birthday, b.people[id].profile.birthday);
        assert.equal(a.people[id].profile.birthdayGenerated, true);
    }
    assert.equal(People.birthdayParts('31.02.2026'), null);
    assert.equal(People.birthdayParts('29.02.2025'), null);
    assert.ok(People.birthdayParts('29.02.2024'));
});

test('канонический день рождения один раз заменяет автоматический и дальше не меняется', () => {
    const opts = options();
    let state = initial(opts);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', new: { birthday: '02.06.1997' } }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997');
    assert.equal(state.people['кристофер'].profile.birthdayGenerated, undefined);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', new: { birthday: '03.06.1990' } }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997');
});

test('в старом чате автоматическую дату можно уточнить без повторного new', () => {
    const opts = options();
    let state = initial(opts);
    // У человека из старого чата нет ни даты, ни пометки об автоматической дате.
    delete state.people['кристофер'].profile.birthday;
    delete state.people['кристофер'].profile.birthdayGenerated;
    state = step(opts, state, { time: '10:05' });
    assert.equal(state.people['кристофер'].profile.birthdayGenerated, true);
    assert.match(People.stateLines(state, opts).join('\n'), /birthday auto/);
    assert.match(People.rules(state, request, opts).join('\n'), /top-level "birthday"/);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', birthday: '02.06.1997' }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997');
    assert.equal(state.people['кристофер'].profile.birthdayGenerated, undefined);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', birthday: '03.06.1997' }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997', 'каноническая дата не заменяется молча');
    assert.equal(People.birthdayLines(state, opts).some((line) => line.includes('Кристофер')), false, 'next-day birthday has no story reminder');
});

test('день рождения влияет на игру только в сам день, без напоминаний накануне', () => {
    const opts = options();
    let state = initial(opts, { birthday: '02.06.1997' }, { birthday: '20.11' });
    assert.deepEqual(People.birthdayLines(state, opts), []);
    state = step(opts, state, { date: '02.06.2026' });
    const lines = People.birthdayLines(state, opts);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /TODAY is Кристофер/);
    assert.match(lines[0], /strangers know only if told/);
    state = step(opts, state, { date: '03.06.2026' });
    assert.deepEqual(People.birthdayLines(state, opts), []);
    opts.s.modules.sims.birthdays = false;
    state.date = '02.06.2026';
    assert.deepEqual(People.birthdayLines(state, opts), []);
});

test('мысли игрока — только с явного разрешения и с учётом выключенных мыслей в Связях', () => {
    const opts = options();
    let state = initial(opts);
    const thought = { people: [{ name: opts.userName, role: 'user', thought: 'Я хочу остаться.' }] };
    assert.equal(People.schema(state, request, opts).people.find((p) => p.role === 'user').thought, undefined);
    state = step(opts, state, thought);
    assert.equal(state.people.user.thought, '');
    opts.s.modules.sims.userThoughts = true;
    assert.ok(People.schema(state, request, opts).people.find((p) => p.role === 'user').thought);
    state = step(opts, state, thought);
    assert.equal(state.people.user.thought, 'Я хочу остаться.');
    assert.match(People.rules(state, request, opts).join('\n'), /private thought field only/);
    opts.s.modules.relations.thoughts = false;
    state = step(opts, state, thought);
    assert.equal(state.people.user.thought, '');
});

test('частичная смена одежды сохраняет то, что не снимали', () => {
    const opts = options();
    let state = initial(opts);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', outfit: 'куртка, футболка, джинсы' }] });
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', outfit: 'футболка, джинсы, шарф' }] });
    assert.equal(state.people['кристофер'].outfit, 'футболка, джинсы, шарф');
    assert.match(People.rules(state, request, opts).join('\n'), /COMPLETE currently worn visible outfit/);
});
