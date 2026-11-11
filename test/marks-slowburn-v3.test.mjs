import test from 'node:test';
import assert from 'node:assert/strict';
import * as Marks from '../src/core/marks.js';
import * as Slow from '../src/core/slowburn.js';

function options(patch = {}) {
    return {
        charName: 'Кристофер', userName: 'Миша',
        s: { modules: {
            marks: { healing: 'realistic', notice: 'subtle', trackPermanent: false, ...patch.marks },
            slowburn: { speed: 'slow', influence: 'medium', strict: true, dayLock: true, target: '', ...patch.slowburn },
        } },
    };
}

function update(base, marks = {}, { date = '01.03.2025', time = '12:00', opts = options() } = {}) {
    const next = { date, time, people: {} };
    Marks.apply(next, base, { marks }, opts);
    return next;
}

function mark(kind = 'bruise', extra = {}) {
    return { who: 'Кристофер', kind, where: 'левое предплечье', sev: 2, ...extra };
}

test('specific wound and skin-colour names retain their kinds', () => {
    for (const [input, expected] of [
        ['пулевое ранение', 'gunshot'], ['bullet wound', 'gunshot'],
        ['ножевое ранение', 'stab'], ['stab wound', 'stab'],
        ['обморожение руки', 'frostbite'], ['тату хной', 'henna'],
        ['окрасилась кожа', 'paint'], ['красная краска на коже', 'paint'],
        ['покраснение', 'redness'], ['свежий загар', 'tan'],
    ]) assert.equal(Marks.normalizeKind(input), expected, input);
    assert.equal(Marks.normalizeKind('distant mark'), 'mark', 'tan is a word, not a fragment inside distant');
});

test('temporary skin colour fades in hours or days, major injury lasts weeks', () => {
    const opts = options();
    const initial = update(null, { add: [mark('redness'), mark('paint'), mark('henna'), mark('gunshot')] });
    assert.equal(initial.marks.length, 4);
    const sameDay = update(initial, {}, { time: '20:00' });
    assert.equal(sameDay.marks.some((m) => m.kind === 'redness'), false);
    assert.equal(sameDay.marks.some((m) => m.kind === 'paint'), true);
    const tomorrow = update(sameDay, {}, { date: '02.03.2025', time: '20:00' });
    assert.deepEqual(tomorrow.marks.map((m) => m.kind), ['henna', 'gunshot']);
    const weeksLater = update(tomorrow, {}, { date: '25.03.2025' });
    assert.deepEqual(weeksLater.marks.map((m) => m.kind), ['gunshot']);
    assert.match(Marks.markStatus(weeksLater.marks[0], weeksLater, opts).stage, /заживает/);
});

test('healing speed changes the time required without changing the original event', () => {
    const injury = { ...mark('gunshot'), at: '01.03.2025 12:00' };
    const fast = Marks.healMinutes(injury, options({ marks: { healing: 'fast' } }));
    const normal = Marks.healMinutes(injury, options());
    const slow = Marks.healMinutes(injury, options({ marks: { healing: 'slow' } }));
    assert.equal(fast, normal / 2);
    assert.equal(slow, normal * 1.5);
    assert.equal(injury.at, '01.03.2025 12:00');
});

test('a repeated model entry does not reset healing or mutate the previous message', () => {
    const initial = update(null, { add: [mark()] });
    Object.freeze(initial.marks[0]);
    Object.freeze(initial.marks);
    Object.freeze(initial);
    const repeated = update(initial, { add: [mark('bruise', { sev: 3 })] }, { date: '04.03.2025' });
    assert.equal(repeated.marks.length, 1);
    assert.equal(repeated.marks[0].at, '01.03.2025 12:00');
    assert.equal(repeated.marks[0].sev, 2);
    const injuredAgain = update(repeated, { add: [mark('bruise', { sev: 3, reinjured: true })] }, { date: '05.03.2025' });
    assert.equal(injuredAgain.marks[0].at, '05.03.2025 12:00');
    assert.equal(injuredAgain.marks[0].sev, 3);
    assert.equal(initial.marks[0].at, '01.03.2025 12:00');
    assert.equal(initial.marks[0].sev, 2);
});

test('body modifications require both enabled tracking and an explicit new acquisition', () => {
    const off = update(null, { add: [mark('tattoo', { acquired: true }), mark('piercing', { acquired: true }), mark('scar')] });
    assert.deepEqual(off.marks.map((m) => m.kind), ['scar']);
    const opts = options({ marks: { trackPermanent: true } });
    const on = update(null, { add: [
        mark('tattoo', { acquired: true }),
        mark('piercing', { acquired: true, where: 'ухо' }),
        mark('tattoo', { acquired: true, preexisting: true, where: 'спина' }),
        mark('tattoo', { where: 'грудь' }),
    ] }, { opts });
    assert.deepEqual(on.marks.map((m) => m.kind), ['tattoo', 'piercing']);
    assert.equal(Marks.markStatus(on.marks[0], on, opts).permanent, false, 'fresh tattoo has a healing phase');
    const healed = update(on, {}, { date: '01.07.2025', opts });
    assert.equal(healed.marks.length, 2);
    assert.match(Marks.markStatus(healed.marks[0], healed, opts).stage, /зажившая татуировка/);
    assert.equal(Marks.markStatus(healed.marks[0], healed, opts).permanent, true);
    assert.equal(Marks.stateLines(healed, options()).length, 0, 'disabled setting hides inherited body modifications immediately');
    assert.equal(update(healed).marks.length, 0);
});

test('explicit resolved IDs are removed while other marks retain their healing clock', () => {
    const initial = update(null, { add: [mark('paint'), mark('cut')] });
    const washed = update(initial, { heal: [initial.marks[0].id] }, { time: '12:10' });
    assert.deepEqual(washed.marks.map((m) => m.kind), ['cut']);
    assert.equal(washed.marks[0].at, initial.marks[1].at);
});

test('slowburn influence changes narrative guidance without changing progress limits', () => {
    const base = { slow: { points: 23, moments: [], stageUpDate: '' } };
    for (const influence of ['light', 'medium', 'strong']) {
        const opts = options({ slowburn: { influence } });
        const next = { date: '01.03.2025' };
        Slow.apply(next, base, { slowburn: { d: 30 } }, opts);
        assert.equal(next.slow.points, 25, 'same speed means the same maximum point gain');
        const text = Slow.stateLines(next, opts).join('\n');
        assert.match(text, new RegExp(influence.toUpperCase()));
        assert.match(text, /never decide.*feelings, thoughts, consent or actions/);
        if (influence === 'strong') assert.match(text, /Sexual arousal alone never unlocks a stage/);
    }
});

test('strict slowburn respects daily lock and records each identical daily milestone once', () => {
    const opts = options();
    const base = { slow: { points: 13, moments: [], stageUpDate: '01.03.2025' } };
    const next = { date: '01.03.2025' };
    Slow.apply(next, base, { slowburn: { d: 2, moment: 'Доверил важную мелочь' } }, opts);
    assert.equal(next.slow.points, 13);
    const repeated = { date: next.date };
    Slow.apply(repeated, next, { slowburn: { d: 0, moment: 'Доверил важную мелочь' } }, opts);
    assert.equal(repeated.slow.moments.length, 1);
    const tomorrow = { date: '02.03.2025' };
    Slow.apply(tomorrow, repeated, { slowburn: { d: 2 } }, opts);
    assert.equal(tomorrow.slow.points, 15);
});
