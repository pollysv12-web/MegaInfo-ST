import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.js';
import { applyData, buildInstruction } from '../src/core/engine.js';
import * as Pocket from '../src/core/pocket.js';
import * as World from '../src/core/world.js';
import {
    addPocketItem, dismissThread, filterManualCollections, getData, updatePocket,
} from '../src/store.js';

function options(patch = {}) {
    const s = structuredClone(DEFAULTS);
    s.modules.pocket = { enabled: true, every: 1, auto: true, maxItems: 5, ...s.modules.pocket, ...patch.pocket };
    Object.assign(s.modules.world, { enabled: true, threads: true, threadLimit: 6, tension: false, plot: false, schedule: false, rumors: false }, patch.world);
    return {
        s, on: { pocket: true, world: true, sims: false, relations: false }, stats: [], decay: {},
        charName: 'Алекс', userName: 'Миша', language: 'Russian', places: {}, pronoun: 'he',
    };
}

const person = (id, name, role) => ({ id, name, role, stats: null, profile: {}, diff: {}, affDiff: 0 });
function state() {
    return {
        v: 2, date: '12.11.2026', time: '10:00',
        people: { 'алекс': person('алекс', 'Алекс', 'char'), user: person('user', 'Миша', 'user') },
        scene: ['алекс', 'user'], pockets: {},
    };
}
function applyPocket(base, data, opts = options()) {
    const next = structuredClone(base);
    Pocket.apply(next, base, data, opts);
    return next;
}
function applyWorld(base, world, opts = options()) {
    const next = structuredClone(base);
    World.apply(next, base, { world }, opts);
    return next;
}
function message(s) {
    const m = { is_user: false, mes: 'Ответ', extra: { megainfo: { state: structuredClone(s) } }, swipe_id: 0 };
    m.swipe_info = [{ extra: structuredClone(m.extra) }];
    return m;
}
function context(chat, opts = options()) {
    const c = { chat, chatMetadata: {}, extensionSettings: { megainfo: structuredClone(opts.s) }, saveSettingsDebounced() {}, saveMetadataDebounced() {} };
    globalThis.SillyTavern = { getContext: () => c };
    return c;
}

test('кармашек ограничивает автоматический список пятью значимыми вещами и не заполняет пустоты', () => {
    const base = state();
    const next = applyPocket(base, { pocket: { add: [
        { who: 'Алекс', name: 'Ключи', note: 'От мастерской' },
        { who: 'Алекс', name: 'ключи', note: 'Повтор модели' },
        { who: 'Алекс', name: '…' },
        ...['Письмо', 'Жетон', 'Подарок', 'Улика', 'Чужой зонтик'].map((name) => ({ who: 'Алекс', name })),
    ] } });
    assert.deepEqual(next.pockets['алекс'].map((x) => x.name), ['Ключи', 'Письмо', 'Жетон', 'Подарок', 'Улика']);
    assert.equal(next.pockets['алекс'][0].note, 'От мастерской');
    assert.deepEqual(base.pockets, {}, 'исходное сообщение не изменяется');
    assert.deepEqual(applyPocket(state(), {}).pockets, {}, 'нет установленных вещей — список пуст, без выдуманного наполнения');
    assert.deepEqual(applyPocket(next, {}).pockets, next.pockets, 'пропущенный ключ не очищает кармашек');
});

test('передача и исправление предметов используют владельца и стабильный id, не трогая прошлое состояние', () => {
    const first = applyPocket(state(), { pocket: { add: [{ who: 'Алекс', name: 'Письмо', note: 'Запечатано' }] } });
    const original = structuredClone(first);
    const id = first.pockets['алекс'][0].id;
    const updated = applyPocket(first, { pocket: { update: [{ who: 'Алекс', id, note: 'Конверт вскрыт' }] } });
    assert.equal(updated.pockets['алекс'][0].id, id);
    assert.equal(updated.pockets['алекс'][0].note, 'Конверт вскрыт');
    assert.deepEqual(first, original);
    const transferred = applyPocket(updated, { pocket: { drop: [{ who: 'Алекс', id }], add: [{ who: 'Миша', name: 'Письмо', note: 'Передал Алекс' }] } });
    assert.deepEqual(transferred.pockets['алекс'], []);
    assert.equal(transferred.pockets.user[0].name, 'Письмо');
    assert.notEqual(transferred.pockets.user[0].id, id);
    assert.equal(updated.pockets['алекс'].length, 1);
});

test('одинаковые имена NPC не смешивают вещи; неизвестный владелец не создаётся', () => {
    const base = state();
    const opts = options();
    opts.s.tracking ??= { roles: {}, overrides: {} };
    opts.s.tracking.roles.npc = 'full';
    base.people['кира ли'] = person('кира ли', 'Кира Ли', 'npc');
    base.people['кира петрова'] = person('кира петрова', 'Кира Петрова', 'npc');
    const next = applyPocket(base, { pocket: { add: [
        { who: 'Кира', name: 'Пистолет' }, { who: 'Неизвестный', name: 'Ключи' },
        { who: 'Кира Ли', name: 'Улика' }, { who: 'Кира Петрова', name: 'Кошелёк' },
    ] } }, opts);
    assert.equal(next.pockets['кира ли'][0].name, 'Улика');
    assert.equal(next.pockets['кира петрова'][0].name, 'Кошелёк');
    assert.equal(Object.values(next.pockets).flat().length, 2);
    assert.equal(Object.keys(next.people).length, 4);
});

test('краткое или выключенное отслеживание не набирает кармашек за персонажа', () => {
    const base = state();
    base.people['кира'] = person('кира', 'Кира', 'npc');
    const opts = options();
    opts.s.tracking = { roles: { char: 'full', user: 'off', npc: 'short' }, pinnedNpc: '', overrides: {} };
    const data = { pocket: { add: [{ who: 'Кира', name: 'Письмо' }, { who: 'Миша', name: 'Ключи' }] } };
    assert.deepEqual(applyPocket(base, data, opts).pockets, {});
    opts.s.tracking.pinnedNpc = 'Кира';
    const next = applyPocket(base, data, opts);
    assert.equal(next.pockets['кира'][0].name, 'Письмо');
    assert.equal(next.pockets.user, undefined);
});

test('кармашек работает отдельно от Пульса для бота и пользователя, а ручной режим игнорирует модель', () => {
    const opts = options();
    const payload = { pocket: { add: [{ who: '{{char}}', name: 'Жетон' }, { who: '{{user}}', name: 'Ключи' }] } };
    const next = applyData({ base: null, data: payload, request: new Set(['pocket']), opts }).state;
    assert.equal(next.pockets['алекс'][0].name, 'Жетон');
    assert.equal(next.pockets.user[0].name, 'Ключи');
    assert.equal(next.people['алекс'].stats, null);
    const manual = options({ pocket: { auto: false } });
    assert.deepEqual(applyPocket(next, { pocket: { drop: [{ who: 'Алекс', id: next.pockets['алекс'][0].id }], add: [{ who: 'Миша', name: 'Кольцо' }] } }, manual).pockets, next.pockets);
    const instruction = buildInstruction({ state: next, request: new Set(['pocket']), opts });
    assert.match(instruction, /up to 5 SIGNIFICANT/);
    assert.match(instruction, /Never.*fill a quota/);
    assert.match(instruction, /Жетон/);
});

test('нити сюжета сохраняют нерешённые обязательства, не создают дублей и соблюдают лимит', () => {
    const next = applyWorld(state(), { thread_add: [
        { text: 'Вернуть книгу', endings: ['Вернуть лично', 'Попросить передать', 'Вернуть лично', 'Отправить почтой', 'Оставить у двери'] },
        { text: 'вернуть книгу' }, { text: '…' },
        ...['Объяснить исчезновение', 'Встретиться вечером', 'Найти свидетеля', 'Отдать подарок', 'Проверить улику', 'Уточнить адрес'].map((text) => ({ text })),
    ] });
    assert.equal(next.world.threads.length, 6);
    assert.equal(next.world.threads[0].text, 'Вернуть книгу');
    assert.deepEqual(next.world.threads[0].endings, ['Вернуть лично', 'Попросить передать', 'Отправить почтой']);
    assert.deepEqual(applyWorld(next, {}).world.threads, next.world.threads);
    assert.equal(state().world, undefined);
    const lines = World.stateLines(next, options()).join('\n');
    assert.match(lines, /NOT events that already happened/);
    assert.match(lines, /Вернуть книгу/);
});

test('модель обновляет и завершает только названную нить, не меняя прежний ответ', () => {
    const first = applyWorld(state(), { thread_add: [{ text: 'Вернуть книгу' }, { text: 'Договориться о встрече' }] });
    const original = structuredClone(first);
    const [book, meeting] = first.world.threads;
    const updated = applyWorld(first, { thread_update: [{ id: book.id, text: 'Вернуть книгу в пятницу', endings: ['Занести в кафе'] }], thread_drop: [meeting.id] });
    assert.equal(updated.world.threads.length, 1);
    assert.equal(updated.world.threads[0].id, book.id);
    assert.equal(updated.world.threads[0].text, 'Вернуть книгу в пятницу');
    assert.deepEqual(updated.world.threads[0].endings, ['Занести в кафе']);
    assert.deepEqual(first, original);
    assert.deepEqual(applyWorld(first, { thread_add: [{ text: 'Новая нить' }] }, options({ world: { threadLimit: 2 } })).world.threads, first.world.threads, 'новая нить не вытесняет незакрытое обещание');
});

test('ручное добавление в кармашек соблюдает лимит и сохраняется в активном свайпе', () => {
    const m = message(state());
    const c = context([m], options({ pocket: { maxItems: 1 } }));
    assert.equal(addPocketItem(0, 'алекс', { name: 'Жетон', note: 'Памятная вещь' }), true);
    assert.equal(addPocketItem(0, 'алекс', { name: 'Ключи' }), false);
    assert.equal(addPocketItem(0, 'unknown', { name: 'Улика' }), false);
    const item = getData(m).state.pockets['алекс'][0];
    assert.equal(item.manual, true);
    assert.deepEqual(m.swipe_info[0].extra.megainfo.state.pockets['алекс'], [item]);
    assert.notEqual(m.swipe_info[0].extra.megainfo.state.pockets['алекс'], getData(m).state.pockets['алекс']);
    const stale = filterManualCollections(state(), 0);
    assert.equal(stale.pockets['алекс'][0].name, 'Жетон');
    assert.equal(c.chatMetadata.megainfo.pocketEdits.length, 1);
});

test('ручная правка и удаление предмета обновляют будущие состояния и свайпы, но не отменяют уже случившуюся потерю', () => {
    const first = applyPocket(state(), { pocket: { add: [{ who: 'Алекс', name: 'Письмо', note: 'Старая заметка' }] } });
    const id = first.pockets['алекс'][0].id;
    const lost = applyPocket(first, { pocket: { drop: [{ who: 'Алекс', id }] } });
    const history = [message(first), message(first), message(first), message(lost)];
    context(history);
    assert.equal(updatePocket(1, 'алекс', id, { name: 'Письмо от брата', note: 'Новая заметка' }), true);
    assert.equal(getData(history[0]).state.pockets['алекс'][0].name, 'Письмо');
    assert.equal(getData(history[1]).state.pockets['алекс'][0].name, 'Письмо от брата');
    assert.equal(getData(history[2]).state.pockets['алекс'][0].note, 'Новая заметка');
    assert.equal(history[2].swipe_info[0].extra.megainfo.state.pockets['алекс'][0].name, 'Письмо от брата');
    assert.deepEqual(getData(history[3]).state.pockets['алекс'], [], 'предмет не возвращается после реально случившейся потери');
    assert.equal(filterManualCollections(first, 1).pockets['алекс'][0].note, 'Новая заметка');
    assert.equal(filterManualCollections(first, 0).pockets['алекс'][0].note, 'Старая заметка');
    assert.equal(updatePocket(1, 'алекс', id, null), true);
    assert.deepEqual(getData(history[1]).state.pockets['алекс'], []);
    assert.deepEqual(getData(history[2]).state.pockets['алекс'], []);
    assert.deepEqual(history[2].swipe_info[0].extra.megainfo.state.pockets['алекс'], []);
    assert.deepEqual(filterManualCollections(first, 2).pockets['алекс'], []);
    assert.equal(first.pockets['алекс'][0].note, 'Старая заметка', 'фильтр не мутирует входной ответ');
});

test('удаление предмета защищает тот же ответ от запоздалого дубля, но допускает новое приобретение позже', () => {
    const first = applyPocket(state(), { pocket: { add: [{ who: 'Алекс', name: 'Ключи' }] } });
    const old = first.pockets['алекс'][0];
    context([message(first)]);
    updatePocket(0, 'алекс', old.id, null);
    const stale = structuredClone(first);
    stale.pockets['алекс'][0].id = 'id-из-запоздалого-пересчёта';
    assert.deepEqual(filterManualCollections(stale, 0).pockets['алекс'], []);
    const later = state();
    later.time = '12:00';
    const reacquired = applyPocket(later, { pocket: { add: [{ who: 'Алекс', name: 'Ключи', note: 'Нашёл в кафе' }] } });
    assert.notEqual(reacquired.pockets['алекс'][0].id, old.id);
    assert.equal(filterManualCollections(reacquired, 1).pockets['алекс'][0].name, 'Ключи');
});

test('ручное закрытие нити удаляет её из следующих ответов и защищает от запоздалого пересчёта', () => {
    const first = applyWorld(state(), { thread_add: [{ text: 'Вернуть книгу' }, { text: 'Объяснить исчезновение' }] });
    const [book, question] = first.world.threads;
    const history = [message(first), message(first), message(first)];
    const c = context(history);
    assert.equal(dismissThread(1, book.id), true);
    assert.equal(getData(history[0]).state.world.threads.length, 2);
    assert.deepEqual(getData(history[1]).state.world.threads.map((x) => x.id), [question.id]);
    assert.deepEqual(history[2].swipe_info[0].extra.megainfo.state.world.threads.map((x) => x.id), [question.id]);
    assert.equal(filterManualCollections(first, 0).world.threads.length, 2);
    assert.deepEqual(filterManualCollections(first, 2).world.threads.map((x) => x.id), [question.id]);
    const stale = structuredClone(first);
    stale.world.threads[0].id = 'другой-id-той-же-нити';
    assert.deepEqual(filterManualCollections(stale, 1).world.threads.map((x) => x.id), [question.id]);
    assert.equal(c.chatMetadata.megainfo.dismissedThreads.length, 1);
    assert.equal(dismissThread(1, 'missing'), false);
    assert.equal(first.world.threads.length, 2);
});
