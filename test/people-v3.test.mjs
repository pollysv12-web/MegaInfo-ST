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

test('arousal settles without passive growth, including legacy positive decay and low baselines', () => {
    const opts = options();
    opts.decay.arousal = 10;
    let state = initial(opts, { stats: { arousal: 80 } });
    state = step(opts, state, { time: '14:00' });
    assert.equal(state.people['кристофер'].stats.arousal, 60);
    assert.equal(state.people.user.stats.arousal, 5, 'quiet time never raises an already low value');
    state = step(opts, state, { date: '02.06.2026', time: '14:00' });
    assert.equal(state.people['кристофер'].stats.arousal, 10, 'settles at baseline rather than becoming negative');
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', set: { arousal: 0 } }] });
    state = step(opts, state, { time: '18:00' });
    assert.equal(state.people['кристофер'].stats.arousal, 0, 'full satisfaction remains zero until an event');
});

test('sexual arousal can decrease through events; joy and excitement have a separate value', () => {
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

test('twenty-four short turns accumulate decay instead of rounding each change away', () => {
    const opts = options();
    let state = initial(opts, { stats: { food: 80, arousal: 90 }, excitement: 60 });
    for (let turn = 1; turn <= 24; turn++) {
        const minutes = 10 * 60 + turn * 5;
        state = step(opts, state, { time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` });
    }
    assert.ok(Math.abs(state.people['кристофер'].stats.arousal - 80) < 0.002, 'five-minute turns total two hours of arousal decay');
    assert.ok(Math.abs(state.people['кристофер'].stats.food - 70) < 0.002, 'needs decay also survives short turns');
    assert.equal(state.people['кристофер'].excitement, 45, 'emotional excitement keeps fractional decay too');
    assert.ok(Object.values(state.people['кристофер'].diff).every(Number.isInteger), 'displayed arrows remain integral');
});

test('needs thresholds notice hunger and hygiene early but sexual effects require high arousal', () => {
    const opts = options();
    const state = initial(opts, { stats: { food: 20, hygiene: 24, energy: 15, arousal: 84 } }, { stats: { food: 21, hygiene: 25, energy: 16, arousal: 85 } });
    const warnings = People.collectWarnings(state, opts);
    assert.deepEqual(warnings.filter((w) => w.id === 'кристофер').map((w) => w.stat), ['food', 'hygiene', 'energy']);
    assert.deepEqual(warnings.filter((w) => w.id === 'user').map((w) => w.stat), ['arousal']);
    const context = People.stateLines(state, opts).join('\n');
    assert.match(context, /Only observable signs/);
    assert.match(context, /proximity and personality/);
    assert.match(context, /not something other characters can read/);
});

test('zero hunger or energy allows plausible faintness without forcing user unconsciousness', () => {
    const opts = options();
    const state = initial(opts, {}, { stats: { food: 0, energy: 0 } });
    const critical = People.collectWarnings(state, opts).filter((w) => w.critical);
    assert.deepEqual(critical.map((w) => w.stat), ['food', 'energy']);
    assert.ok(critical.every((w) => /возможны.*обморок/.test(w.text)));
    assert.match(People.stateLines(state, opts).join('\n'), /Do not decide the user’s.*loss of consciousness/);
    assert.equal(state.people.user.unconscious, undefined);
});

test('unknown birthdays get a stable valid day/month without an invented age', () => {
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

test('canonical birthday replaces generated fallback once, then remains stable', () => {
    const opts = options();
    let state = initial(opts);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', new: { birthday: '02.06.1997' } }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997');
    assert.equal(state.people['кристофер'].profile.birthdayGenerated, undefined);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', new: { birthday: '03.06.1990' } }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997');
});

test('legacy chat can correct an automatic birthday from canonical context without repeating new', () => {
    const opts = options();
    let state = initial(opts);
    // A pre-v3 saved person has neither a birthday nor the new fallback flag.
    delete state.people['кристофер'].profile.birthday;
    delete state.people['кристофер'].profile.birthdayGenerated;
    state = step(opts, state, { time: '10:05' });
    assert.equal(state.people['кристофер'].profile.birthdayGenerated, true);
    assert.match(People.stateLines(state, opts).join('\n'), /автоматическая дата; канон может уточнить/);
    assert.match(People.rules(state, request, opts).join('\n'), /top-level birthday field/);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', birthday: '02.06.1997' }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997');
    assert.equal(state.people['кристофер'].profile.birthdayGenerated, undefined);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', birthday: '03.06.1997' }] });
    assert.equal(state.people['кристофер'].profile.birthday, '02.06.1997', 'canonical dates are never silently replaced');
    assert.equal(People.birthdayLines(state, opts).some((line) => line.includes('Кристофер')), false, 'next-day birthday has no story reminder');
});

test('birthday influence occurs on the actual in-story day with no tomorrow reminder', () => {
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

test('user thoughts require explicit opt in and respect disabled relationship thoughts', () => {
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

test('partial clothing changes replace current outfit while preserving unchanged garments', () => {
    const opts = options();
    let state = initial(opts);
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', outfit: 'куртка, футболка, джинсы' }] });
    state = step(opts, state, { people: [{ name: opts.charName, role: 'char', outfit: 'футболка, джинсы, шарф' }] });
    assert.equal(state.people['кристофер'].outfit, 'футболка, джинсы, шарф');
    assert.match(People.rules(state, request, opts).join('\n'), /COMPLETE currently worn visible outfit/);
});
