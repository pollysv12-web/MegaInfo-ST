import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { applyData, People } from '../src/core/engine.js';

const request = new Set(['sims', 'relations']);
function options() {
    const s = structuredClone(DEFAULTS);
    return { s, on: { sims: true, relations: true }, stats: ['food', 'hygiene', 'energy', 'arousal'],
        decay: { food: -10, hygiene: -5, energy: -15, arousal: -10 },
        charName: 'Алекс', userName: 'Саша', language: 'Russian' };
}
const apply = (opts, base, data) => applyData({ base, data, request, opts }).state;
function initial(opts, values = {}) {
    return apply(opts, null, { date: '12.11.2026', time: '10:00', people: [
        { name: 'Алекс', role: 'char', new: { stats: { food: 99, hygiene: 50, energy: 70, arousal: 80 }, excitement: 20, money: 20000, ...values } },
    ] });
}

test('legacy sexual arousal stays passion; emotional activation has its own number and reason', () => {
    const opts = options();
    const base = initial(opts);
    delete base.people['алекс'].excitement;
    delete base.people['алекс'].changes;
    const state = apply(opts, base, { people: [{ name: 'Алекс', role: 'char', d: { excitement: 35 }, reasons: { excitement: 'порадовался встрече' } }] });
    const p = state.people['алекс'];
    assert.equal(p.stats.arousal, 80, 'existing sexual values are never relabelled as emotional values');
    assert.equal(p.excitement, 35);
    assert.equal(p.changes.excitement[0].kind, 'initial');
    assert.equal(p.changes.excitement[1].reason, 'порадовался встрече');
    assert.equal(p.changes.arousal, undefined);
    const rules = People.rules(state, request, opts).join('\n');
    assert.match(rules, /SEXUAL arousal only \(UI label «Страсть»\)/);
    assert.match(rules, /excitement \(UI label «Возбуждение»\)/);
    assert.equal(base.people['алекс'].excitement, undefined, 'saved source state is not mutated');
});

test('time and scene reasons explain actual clamped effects rather than requested deltas', () => {
    const opts = options(), base = initial(opts);
    const state = apply(opts, base, { time: '12:00', people: [{ name: 'Алекс', role: 'char',
        d: { food: 50, excitement: 20 }, set: { arousal: 100 },
        reasons: { food: 'плотно поел', excitement: 'обрадовался новости', arousal: 'поцелуй' },
    }], money: [{ who: 'Алекс', amount: -450, note: 'кофе' }] });
    const p = state.people['алекс'];
    assert.deepEqual(p.changes.food.map(({ kind, delta }) => ({ kind, delta })), [{ kind: 'time', delta: -10 }, { kind: 'event', delta: 11 }]);
    assert.equal(p.changes.food[1].from, 89);
    assert.equal(p.changes.food[1].to, 100);
    assert.equal(p.changes.food[1].reason, 'плотно поел');
    assert.deepEqual(p.changes.arousal.map(c => c.delta), [-10, 30]);
    assert.deepEqual(p.changes.excitement.map(c => c.delta), [-15, 20]);
    assert.deepEqual(p.changes.money, [{ kind: 'event', from: 20000, to: 19550, delta: -450, reason: 'кофе' }]);
    assert.equal(p.diff.food, 1, 'net visible arrow still represents total effect');
    assert.equal(base.people['алекс'].stats.food, 99);
});

test('fractional passive changes and absent reasons remain honest', () => {
    const opts = options();
    const base = initial(opts, { stats: { food: 70, hygiene: 50, energy: 70, arousal: 2 } });
    const state = apply(opts, base, { time: '10:05', people: [{ name: 'Алекс', role: 'char', d: { energy: -2 }, reasons: { energy: { invented: 'не принимать объект' } } }] });
    const p = state.people['алекс'];
    assert.equal(p.changes.food[0].delta, -0.4167);
    assert.equal(p.changes.arousal, undefined, 'quiet time does not raise low passion to a baseline');
    assert.equal(p.changes.energy.at(-1).reason, 'Изменение в сцене (модель не уточнила причину)');
    const next = apply(opts, state, {});
    assert.deepEqual(next.people['алекс'].changes, {}, 'a new reply does not repeat old reasons');
});

test('per-person tracking freezes unselected information and fully tracks the pinned NPC', () => {
    const opts = options();
    opts.s.tracking = { roles: { char: 'full', user: 'full', npc: 'short' }, pinnedNpc: 'Кира', overrides: {
        'алекс': { detail: 'full', fields: { stats: false, money: false, outfit: false } },
        'стоп': { detail: 'off' },
    } };
    const base = initial(options());
    base.people['алекс'].outfit = 'рубашка';
    const state = apply(opts, base, { time: '12:00', people: [
        { name: 'Алекс', role: 'char', outfit: 'пальто', d: { food: 10, excitement: 10 }, reasons: { excitement: 'предвкушение' } },
        { name: 'Кира', role: 'npc', new: { stats: { food: 60 }, money: 500 }, d: { food: 5 } },
        { name: 'Стоп', role: 'npc', new: { money: 99999 } },
    ], money: [{ who: 'Алекс', amount: -500, note: 'не отслеживается' }] });
    assert.equal(state.people['алекс'].stats.food, 99);
    assert.equal(state.people['алекс'].money, 20000);
    assert.equal(state.people['алекс'].outfit, 'рубашка');
    assert.equal(state.people['алекс'].excitement, 20, 'numeric state selection includes emotion; hidden stored values stay unchanged');
    assert.equal(state.people['кира'].stats.food, 65);
    assert.equal(state.people['стоп'], undefined);
    assert.equal(state.people['алекс'].changes.food, undefined);
    assert.match(People.rules(state, request, opts).join('\n'), /Important pinned NPC: Кира/);
});

test('short tracking accepts explicitly selected numeric fields without expanding other details', () => {
    const opts = options();
    opts.s.tracking = { roles: { char: 'full', user: 'full', npc: 'short' }, overrides: { 'кира': { detail: 'short', fields: { stats: true } } } };
    const state = apply(opts, null, { date: '12.11.2026', time: '12:00', people: [{ name: 'Кира', role: 'npc',
        new: { stats: { food: 40 }, excitement: 20, money: 900 }, d: { food: 5, excitement: 10 }, thought: 'не отслеживается',
    }] });
    assert.equal(state.people['кира'].stats.food, 45);
    assert.equal(state.people['кира'].excitement, 30);
    assert.equal(state.people['кира'].money, null);
    assert.equal(state.people['кира'].thought, '');
});

test('turning emotional tracking off preserves stored emotion but does not accept new changes', () => {
    const opts = options(), base = initial(opts);
    opts.s.modules.sims.excitement = false;
    const state = apply(opts, base, { time: '12:00', people: [{ name: 'Алекс', role: 'char', d: { excitement: 90, arousal: -5 } }] });
    assert.equal(state.people['алекс'].excitement, 20);
    assert.equal(state.people['алекс'].stats.arousal, 65);
    assert.equal(state.people['алекс'].changes.excitement, undefined);
    assert.equal(People.schema(state, request, opts).people[0].d.excitement, undefined);
});
