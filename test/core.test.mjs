// Запуск: npm test  (или node --test test/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import {
    applyData, buildContext, buildInstruction, extractBlocks, Loc, Marks, People, Slow,
} from '../src/core/engine.js';
import { diaryAboutTitle, parseDiary, parsePhone, parseCard } from '../src/core/extras.js';
import { parseLooseJson, stripAnyHtml, stripTagBlocks, weekday } from '../src/util.js';

function makeOpts(patch = {}) {
    const s = structuredClone(DEFAULTS);
    for (const k of Object.keys(s.modules)) s.modules[k].enabled = true;
    const stats = ['food', 'hygiene', 'energy', 'arousal'];
    const opts = {
        s,
        on: Object.fromEntries(Object.keys(s.modules).map((k) => [k, true])),
        stats,
        decay: { food: -10, hygiene: -5, energy: -15, arousal: 10 },
        charName: 'Алекс',
        userName: 'Миша',
        pronoun: 'he',
        language: 'Russian',
        places: {},
        phones: 'auto',
    };
    patch.s?.(s);
    return { ...opts, ...patch, s };
}

const ALL = new Set(['sims', 'relations', 'slowburn', 'world', 'marks', 'location']);

const first = {
    date: '15.03.2025', time: '14:00', weather: 'пасмурно', location: 'Кофейня «Зерно»',
    people: [
        { name: 'Алекс', role: 'char', mood: 'устал', outfit: 'худи', thought: 'хочу спать', aff: 0, rel: 'незнакомец',
            new: { stats: { food: 60, hygiene: 80, energy: 50, arousal: 10 }, money: 20000, birthday: '01.02.1995', zodiac: 'Водолей', mbti: 'INTJ — стратег', aff: 10 } },
        { name: 'Миша', role: 'user', outfit: 'куртка', new: { stats: { food: 70, hygiene: 90, energy: 70, arousal: 5 }, money: 5000 } },
        { name: 'Бариста Кира', role: 'npc', mood: 'весёлая', outfit: 'фартук', new: { aff: 20 } },
    ],
    money: [{ who: 'Алекс', amount: -450, note: 'кофе' }],
    place: { name: 'Кофейня «Зерно»', look: 'Маленький зал с кирпичными стенами.', details: 'Стойка, шесть столиков.', mood: 'Пахнет корицей.' },
    world: { pace: 'slow', plot: 'Знакомство', plot_d: 2, schedule: [{ who: 'Алекс', time: '18:00', what: 'тренировка' }], rumor_add: ['В кофейне видели призрака'] },
    slowburn: { d: 1, moment: '' },
    marks: { add: [{ who: 'Миша', kind: 'синяк', where: 'левое предплечье', sev: 1, note: 'ударился о дверь' }] },
};

test('первый блок: люди, деньги, профиль, симпатия, место', () => {
    const opts = makeOpts();
    const { state, place } = applyData({ base: null, data: first, request: ALL, opts });
    assert.equal(Object.keys(state.people).length, 3);
    assert.equal(state.people['алекс'].money, 19550);
    assert.equal(state.people.user.money, 5000);
    assert.equal(state.people.user.name, 'Миша');
    assert.equal(state.people['алекс'].profile.mbti, 'INTJ — стратег');
    assert.equal(state.people['алекс'].aff, 10, 'у нового стартовое значение из new.aff, дельта не прибавляется');
    assert.equal(state.people['бариста кира'].aff, 20);
    assert.equal(state.people['бариста кира'].stats, null);
    assert.deepEqual(state.scene, ['алекс', 'user', 'бариста кира']);
    assert.equal(place.name, 'Кофейня «Зерно»');
    assert.equal(state.world.tension, 3);
    assert.equal(state.world.rumors.length, 1);
    assert.equal(state.world.schedule[0].at, '15.03.2025 18:00');
    assert.equal(state.marks.length, 1);
    assert.equal(state.marks[0].kind, 'bruise');
    assert.equal(state.slow.points, 1);
});

test('спад статов за время + события; баланс только по транзакциям', () => {
    const opts = makeOpts();
    const s1 = applyData({ base: null, data: first, request: ALL, opts }).state;
    const s2 = applyData({
        base: s1,
        data: {
            date: '15.03.2025', time: '18:00',
            people: [
                { name: 'Алекс', role: 'char', mood: 'сыт', d: { food: 50 }, aff: 3 },
                { name: 'Миша', role: 'user', set: { hygiene: 100 } },
            ],
            money: [{ who: 'Миша', amount: -1200, note: 'такси' }],
        },
        request: new Set(['sims', 'relations']),
        opts,
    }).state;
    // 4 часа: food 60-20+50 => 90; energy 50-30 => 20; возбуждение не растёт само.
    assert.equal(s2.people['алекс'].stats.food, 90);
    assert.equal(s2.people['алекс'].stats.energy, 20);
    assert.equal(s2.people['алекс'].stats.arousal, 10);
    assert.equal(s2.people['алекс'].diff.food, 30);
    assert.equal(s2.people.user.stats.hygiene, 100);
    assert.equal(s2.people.user.money, 3800);
    assert.equal(s2.people['алекс'].money, 19550, 'баланс не меняется без транзакций');
    assert.equal(s2.people['алекс'].aff, 13);
    assert.equal(s2.people['алекс'].affDiff, 3);
    assert.equal(s2.elapsed, 240);
    assert.equal(s2.people['алекс'].profile.birthday, '01.02.1995', 'профиль не перетирается');
    assert.ok(s2.people['бариста кира'], 'NPC остаётся в памяти');
    assert.ok(!s2.scene.includes('бариста кира'));
    assert.equal(s2.world.tension, 3, 'мир не запрашивали — не меняется');
});

test('симпатия: шаг ограничен, ярлык обновляется', () => {
    const opts = makeOpts();
    const s1 = applyData({ base: null, data: first, request: ALL, opts }).state;
    const s2 = applyData({
        base: s1,
        data: { time: '14:10', people: [{ name: 'Алекс', role: 'char', aff: 40, rel: 'друг' }] },
        request: new Set(['relations']),
        opts,
    }).state;
    assert.equal(s2.people['алекс'].aff, 15, '+40 урезано до +5');
    assert.equal(s2.people['алекс'].rel, 'друг');
});

test('модель повторно прислала "new" для знакомого — числа не сбрасываются', () => {
    const opts = makeOpts();
    const s1 = applyData({ base: null, data: first, request: ALL, opts }).state;
    const s2 = applyData({
        base: s1,
        data: { date: '15.03.2025', time: '14:30', people: [{ name: 'Алекс', role: 'char', new: { stats: { food: 100 }, money: 999999, aff: 90 } }] },
        request: new Set(['sims', 'relations']),
        opts,
    }).state;
    assert.equal(s2.people['алекс'].money, 19550);
    assert.equal(s2.people['алекс'].aff, 10);
    assert.ok(s2.people['алекс'].stats.food < 70);
});

test('время назад не идёт', () => {
    const opts = makeOpts();
    const s1 = applyData({ base: null, data: first, request: ALL, opts }).state;
    const r = applyData({ base: s1, data: { date: '14.03.2025', time: '09:00' }, request: new Set(['sims']), opts });
    assert.equal(r.state.date, '15.03.2025');
    assert.equal(r.state.time, '14:00');
    assert.equal(r.issues.length, 1);
});

test('слоуберн: шаг ограничен скоростью, не больше стадии в день, без перескоков', () => {
    const opts = makeOpts({ s: (s) => { s.modules.slowburn.speed = 'fast'; } });
    let st = { date: '01.01.2025', time: '10:00', people: {}, scene: [], slow: { points: 5, moments: [] } };
    st = applyData({ base: st, data: { date: '01.01.2025', time: '10:05', slowburn: { d: 50, moment: 'первый взгляд' } }, request: new Set(['slowburn']), opts }).state;
    assert.equal(st.slow.points, 10, '+50 → +5');
    assert.equal(Slow.stageIndex(st.slow.points), 1);
    st = applyData({ base: st, data: { date: '01.01.2025', time: '10:10', slowburn: { d: 5 } }, request: new Set(['slowburn']), opts }).state;
    st = applyData({ base: st, data: { date: '01.01.2025', time: '10:15', slowburn: { d: 5 } }, request: new Set(['slowburn']), opts }).state;
    assert.equal(st.slow.points, 13, 'вторая новая стадия в тот же день не наступает');
    st = applyData({ base: st, data: { date: '02.01.2025', time: '09:00', slowburn: { d: 5 } }, request: new Set(['slowburn']), opts }).state;
    assert.equal(Slow.stageIndex(st.slow.points), 2, 'на следующий день — можно');
    assert.equal(st.slow.moments.length, 1);
    const lines = Slow.stateLines(st, opts).join('\n');
    assert.match(lines, /Интерес/);
    assert.match(lines, /NOT yet/);
});

test('мир: напряжение, твист со сбросом, расписание и слухи', () => {
    const opts = makeOpts();
    let st = applyData({ base: null, data: first, request: ALL, opts }).state;
    st.world.tension = 99;
    st = applyData({ base: st, data: { time: '15:00', world: { pace: 'slow' } }, request: new Set(['world']), opts }).state;
    assert.equal(st.world.tension, 100);
    assert.match(buildContext(st, opts), /MAJOR TWIST/);
    st = applyData({ base: st, data: { time: '15:10', world: { pace: 'active', twist: 'Кира оказалась сестрой Алекса', rumor_add: ['Кира что-то скрывает'], rumor_drop: ['r1'] } }, request: new Set(['world']), opts }).state;
    assert.equal(st.world.tension, 0);
    assert.equal(st.world.lastTwist, 'Кира оказалась сестрой Алекса');
    assert.deepEqual(st.world.rumors.map((r) => r.id), ['r2']);
    // расписание: после 18:00 запись пропадает
    st = applyData({ base: st, data: { time: '18:30', world: { pace: 'slow' } }, request: new Set(['sims', 'world']), opts }).state;
    assert.equal(st.world.schedule.length, 0);
    // слухов не больше лимита
    for (let i = 0; i < 6; i++) st = applyData({ base: st, data: { world: { rumor_add: [`слух ${i}`] } }, request: new Set(['world']), opts }).state;
    assert.equal(st.world.rumors.length, 4);
});

test('следы на теле заживают по времени ролевой, шрам остаётся', () => {
    const opts = makeOpts();
    let st = applyData({ base: null, data: first, request: ALL, opts }).state;
    st = applyData({
        base: st,
        data: { time: '14:20', marks: { add: [{ who: 'Алекс', kind: 'hickey', where: 'шея слева', sev: 2 }, { who: 'Алекс', kind: 'шрам', where: 'бровь', sev: 1 }] } },
        request: new Set(['sims', 'marks']),
        opts,
    }).state;
    assert.equal(st.marks.length, 3);
    const hickey = st.marks.find((m) => m.kind === 'hickey');
    assert.equal(Marks.markStatus(hickey, st, opts).stage, 'свежий');
    // через 4 дня засос ещё виден, синяк (лёгкий, 6 дней) бледнеет
    st = applyData({ base: st, data: { date: '19.03.2025', time: '14:20' }, request: new Set(['sims', 'marks']), opts }).state;
    assert.equal(st.marks.length, 3);
    assert.equal(Marks.markStatus(st.marks.find((m) => m.kind === 'hickey'), st, opts).stage, 'бледнеет, заживает');
    // через 2 недели остался только шрам
    st = applyData({ base: st, data: { date: '29.03.2025', time: '14:20' }, request: new Set(['sims', 'marks']), opts }).state;
    assert.deepEqual(st.marks.map((m) => m.kind), ['scar']);
    assert.match(Marks.stateLines(st, opts).join('\n'), /outfit does not cover/);
});

test('повторный засос на том же месте не дублируется', () => {
    const opts = makeOpts();
    let st = applyData({ base: null, data: first, request: ALL, opts }).state;
    const add = { marks: { add: [{ who: 'Миша', kind: 'засос', where: 'шея', sev: 1 }] } };
    st = applyData({ base: st, data: { time: '14:10', ...add }, request: new Set(['sims', 'marks']), opts }).state;
    st = applyData({ base: st, data: { time: '14:20', ...add }, request: new Set(['sims', 'marks']), opts }).state;
    assert.equal(st.marks.filter((m) => m.kind === 'hickey').length, 1);
});

test('локация: поиск по названию, нужно ли описание', () => {
    const places = { 'кофейня зерно': { name: 'Кофейня «Зерно»', look: 'x' } };
    assert.ok(Loc.findPlace(places, 'кофейня "Зерно"'));
    assert.ok(Loc.findPlace(places, 'Кофейня Зерно, у окна'));
    assert.equal(Loc.needsPlace({ location: 'Парк' }, places), true);
    assert.equal(Loc.needsPlace({ location: 'Кофейня «Зерно»' }, places), false);
});

test('дневник и телефон', () => {
    const d = parseDiary({ diary: { entry: 'Сегодня...\n\nОн странный.', about_user: 'Он смотрел на меня.', npcs: [{ name: 'Кира', entry: 'хм' }, 'мусор'] } }, { date: '01.01.2025', time: '10:00' });
    assert.equal(d.date, '01.01.2025 10:00');
    assert.equal(d.npcs.length, 1);
    assert.equal(diaryAboutTitle('he'), 'О нём');
    assert.equal(diaryAboutTitle('she'), 'О ней');
    assert.equal(parseDiary({ diary: { entry: '' } }), null);

    const p = parsePhone({ phone: { app: 'Telegram', title: 'Кира', items: [{ from: 'Кира', dir: 'in', text: 'ты где?' }, { dir: 'out', text: 'скоро' }] } });
    assert.equal(p[0].app, 'telegram');
    assert.equal(p[0].items[1].dir, 'out');
    assert.equal(parsePhone({ phone: { app: 'sms', items: [] } }), null);
    assert.equal(parseCard('просто текст'), '');
    assert.ok(parseCard('```html\n<div>ok</div>\n```').startsWith('<div>'));
});

test('инструкция: лайт-режим без людей, полный — с правилами', () => {
    const lite = makeOpts({ s: (s) => { s.modules.sims.variant = 'lite'; } });
    lite.on.relations = false;
    const t1 = buildInstruction({ state: null, request: new Set(['sims']), opts: lite });
    assert.match(t1, /<megainfo>/);
    assert.doesNotMatch(t1, /"people"/);
    const full = makeOpts();
    const t2 = buildInstruction({ state: null, request: new Set([...ALL, 'diary', 'phone', 'cards']), opts: full, separate: true });
    for (const needle of ['"people"', '"aff"', '"slowburn"', '"world"', '"marks"', '"place"', '"diary"', '"phone"', 'megainfo_html', 'he/him']) {
        assert.ok(t2.includes(needle), `нет ${needle}`);
    }
    assert.equal(buildInstruction({ state: null, request: new Set(), opts: full }), '');
});

test('заглушки из примера не превращаются в людей и значения', () => {
    const opts = makeOpts();
    const st = applyData({
        base: null,
        data: { time: '10:00', date: '01.01.2025', location: '…', people: [{ name: 'Алекс', role: 'char', outfit: '…', mood: '...' }, { name: 'Имя NPC', role: 'npc', outfit: '…' }] },
        request: new Set(['sims']),
        opts,
    }).state;
    assert.deepEqual(Object.keys(st.people), ['алекс']);
    assert.equal(st.people['алекс'].outfit, '');
    assert.equal(st.location, '');
});

test('разбор кривого JSON от модели', () => {
    assert.equal(parseLooseJson('```json\n{"a":1,}\n```').a, 1);
    assert.equal(parseLooseJson('{"t":"строка\nс переносом"}').t, 'строка\nс переносом');
    assert.deepEqual(parseLooseJson('{"a":{"b":[1,2'), { a: { b: [1, 2] } });
    assert.equal(parseLooseJson('{"diary":{"entry":"оборвалось на полусл').diary.entry, 'оборвалось на полусл');
    assert.throws(() => parseLooseJson('нет тут json'));
});

test('блоки вырезаются из текста, в том числе незакрытые', () => {
    const text = 'История.\n\n<megainfo>{"time":"10:00"}</megainfo>\n<megainfo_html><div>карточка</div></megainfo_html>';
    const b = extractBlocks(text);
    assert.equal(b.text, 'История.');
    assert.equal(b.json, '{"time":"10:00"}');
    assert.equal(b.card, '<div>карточка</div>');
    const cut = extractBlocks('Текст <megainfo>{"time":"10:');
    assert.equal(cut.text, 'Текст');
    assert.equal(cut.jsonClosed, false);
    assert.equal(stripTagBlocks('a <sims>x</sims> b', ['sims']), 'a  b');
    assert.equal(stripAnyHtml('Привет <div style="x">блок<div>вложенный</div></div> <b>жирный</b>'), 'Привет  жирный');
    assert.equal(weekday('15.03.2025', '10:00'), 'Сб');
    // регулярка срезала теги — остался голый JSON в конце
    const bare = extractBlocks('Он ушёл {хлопнув дверью}.\n\n{"date":"01.01.2025","time":"10:00","people":[]}');
    assert.equal(bare.bare, true);
    assert.equal(bare.text, 'Он ушёл {хлопнув дверью}.');
    assert.equal(extractBlocks('Она сказала {тихо}.').found, false);
});

test('длинная ролевая: 12 ходов, состояние не теряется', () => {
    const opts = makeOpts();
    let st = applyData({ base: null, data: first, request: ALL, opts }).state;
    for (let i = 1; i <= 12; i++) {
        const hh = String(14 + Math.floor(i / 2)).padStart(2, '0');
        const mm = i % 2 ? '30' : '00';
        const data = i % 3 === 0
            ? { time: `${hh}:${mm}` } // модель прислала почти пустой блок
            : { time: `${hh}:${mm}`, people: [{ name: 'Алекс', role: 'char', aff: 2 }, { name: 'Миша', role: 'user' }], money: [{ who: 'Миша', amount: -100 }], world: { pace: 'active' } };
        st = applyData({ base: st, data, request: ALL, opts }).state;
    }
    assert.equal(st.people.user.money, 5000 - 8 * 100);
    assert.equal(st.people['алекс'].aff, 10 + 8 * 2);
    assert.ok(st.scene.includes('алекс') && st.scene.includes('user'), 'главные всегда в сцене');
    assert.equal(st.time, '20:00');
    assert.ok(People.stateLines(st, opts).some((l) => l.includes('affinity')));
});
