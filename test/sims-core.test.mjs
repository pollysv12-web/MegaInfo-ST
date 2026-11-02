// Запуск: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdate, buildInstruction, formatState, collectWarnings } from '../src/sims-core.js';
import { parseLooseJson, findTagBlock, stripTagBlocks, weekday } from '../src/util.js';

const opts = {
    stats: ['food', 'hygiene', 'energy', 'arousal'],
    decay: { food: -10, hygiene: -5, energy: -15, arousal: 10 },
    npcMax: 2, npcDetail: 'short', charName: 'Алекс', userName: 'Юля', currency: '₽',
};

const first = {
    date: '15.03.2025', time: '14:00', weather: 'пасмурно', location: 'Кофейня',
    people: [
        { name: 'Алекс', role: 'char', mood: 'устал', outfit: 'худи', thought: 'хочу спать',
          new: { stats: { food: 60, hygiene: 80, energy: 50, arousal: 10 }, money: 20000, birthday: '01.02.1995', zodiac: 'Водолей', mbti: 'INTJ' } },
        { name: 'Юля', role: 'user', outfit: 'платье', new: { stats: { food: 70, hygiene: 90, energy: 70, arousal: 5 }, money: 5000 } },
        { name: 'Бариста Кира', role: 'npc', mood: 'весёлая', outfit: 'фартук' },
    ],
    money: [{ who: 'Алекс', amount: -450, note: 'кофе' }],
};

test('первый блок создаёт людей и считает деньги', () => {
    const s = applyUpdate(null, first, opts);
    assert.equal(Object.keys(s.people).length, 3);
    assert.equal(s.people['алекс'].money, 19550);
    assert.equal(s.people['user'].money, 5000);
    assert.equal(s.people['алекс'].profile.mbti, 'INTJ');
    assert.equal(s.people['бариста кира'].stats, null);
    assert.deepEqual(s.scene, ['алекс', 'user', 'бариста кира']);
});

test('спад статов за время + дельты событий, деньги по транзакциям', () => {
    const s1 = applyUpdate(null, first, opts);
    const s2 = applyUpdate(s1, {
        date: '15.03.2025', time: '18:00',
        people: [
            { name: 'Алекс', role: 'char', mood: 'сыт', d: { food: 50 } },
            { name: 'Юля', role: 'user', set: { hygiene: 100 } },
        ],
        money: [{ who: 'Юля', amount: -1200, note: 'такси' }],
    }, opts);
    // 4 часа: food -20 +50 => 90; energy 50-30 => 20; arousal 10+20 => 30
    assert.equal(s2.people['алекс'].stats.food, 90);
    assert.equal(s2.people['алекс'].stats.energy, 20);
    assert.equal(s2.people['алекс'].stats.arousal, 30);
    assert.equal(s2.people['алекс'].diff.food, 30);
    assert.equal(s2.people['user'].stats.hygiene, 100);
    assert.equal(s2.people['user'].money, 3800);
    assert.equal(s2.people['алекс'].money, 19550, 'баланс не меняется без транзакций');
    assert.equal(s2.elapsed, 240);
    // профиль не перетирается, кира осталась в памяти, но не в сцене
    assert.equal(s2.people['алекс'].profile.birthday, '01.02.1995');
    assert.ok(s2.people['бариста кира']);
    assert.ok(!s2.scene.includes('бариста кира'));
});

test('модель повторно прислала "new" для известного — числа не сбрасываются', () => {
    const s1 = applyUpdate(null, first, opts);
    const s2 = applyUpdate(s1, { date: '15.03.2025', time: '14:10', people: [
        { name: 'Алекс', role: 'char', new: { stats: { food: 100 }, money: 999999 } },
    ] }, opts);
    assert.equal(s2.people['алекс'].money, 19550);
    assert.ok(s2.people['алекс'].stats.food < 61);
});

test('нечёткое совпадение имени и лимит NPC', () => {
    const s1 = applyUpdate(null, first, opts);
    const s2 = applyUpdate(s1, { date: '15.03.2025', time: '14:30', people: [
        { name: 'Алекс Морозов', role: 'char' },
        { name: 'Кира', role: 'npc' },
        { name: 'Охранник', role: 'npc' },
        { name: 'Прохожий', role: 'npc' },
    ] }, opts);
    assert.equal(Object.values(s2.people).filter((p) => p.role === 'char').length, 1);
    assert.ok(s2.scene.includes('бариста кира'));
    assert.equal(s2.scene.filter((id) => s2.people[id].role === 'npc').length, 2);
});

test('время назад и мусорные значения не ломают состояние', () => {
    const s1 = applyUpdate(null, first, opts);
    const s2 = applyUpdate(s1, { date: 'вчера', time: '??', people: [
        { name: 'Алекс', role: 'char', d: { food: 'много', energy: '+500' } },
    ] }, opts);
    assert.equal(s2.elapsed, 0);
    assert.equal(s2.people['алекс'].stats.energy, 100);
    assert.equal(s2.people['алекс'].stats.food, 60);
});

test('парсер JSON терпит обёртки и висячие запятые', () => {
    const o = parseLooseJson('```json\n{"a":1,"b":[1,2,],}\n```');
    assert.deepEqual(o, { a: 1, b: [1, 2] });
    assert.throws(() => parseLooseJson('просто текст'));
});

test('поиск и вырезание блоков', () => {
    const text = 'Текст ответа.\n\n<sims>{"time":"10:00"}</sims>';
    assert.equal(findTagBlock(text, 'sims').inner, '{"time":"10:00"}');
    assert.equal(stripTagBlocks(text, ['sims']), 'Текст ответа.');
    assert.equal(stripTagBlocks('Начало <sims>{"time":"10', ['sims']), 'Начало');
    assert.equal(findTagBlock('a <sims>{"x":1', 'sims').inner, '{"x":1');
});

test('день недели и сводка состояния', () => {
    assert.equal(weekday('15.03.2025', '10:00'), 'Сб');
    const s1 = applyUpdate(null, { ...first, people: [{ ...first.people[0], new: { stats: { food: 5 } } }] }, opts);
    const w = collectWarnings(s1, opts);
    assert.ok(w.some((x) => x.stat === 'food'));
    const text = formatState(s1, opts);
    assert.match(text, /Алекс \[char\]/);
    assert.match(text, /сильный голод/);
});

test('инструкция содержит формат и правила', () => {
    const t = buildInstruction(null, opts);
    assert.match(t, /<sims>/);
    assert.match(t, /none yet/);
    assert.match(t, /"role":"char"/);
    const t2 = buildInstruction(null, { ...opts, npcMax: 0, stats: [] }, { separate: true });
    assert.doesNotMatch(t2, /"d"/);
    assert.match(t2, /NO NPCs/);
    console.log('\n--- пример инструкции ---\n' + buildInstruction(applyUpdate(null, first, opts), opts));
});
