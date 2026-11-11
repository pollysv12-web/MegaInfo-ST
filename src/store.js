// Хранение данных блоков внутри сообщений чата (message.extra.megainfo) и в метаданных чата.
// Данные лежат в самом сообщении, поэтому свайпы, удаление и ветки чата работают сами собой:
// у каждого свайпа своя копия, а удалённое сообщение уносит своё состояние с собой.

import { MODULE } from './settings.js';
import { normName } from './util.js';

const ctx = () => SillyTavern.getContext();

export function getMessage(messageId) {
    return ctx().chat?.[messageId] ?? null;
}

export function isBotMessage(m) {
    return !!m && !m.is_user && !m.is_system;
}

export function getData(message) {
    return message?.extra?.[MODULE] ?? null;
}

/** Записывает поле данных модуля в сообщение и в текущий свайп. undefined — удалить. */
export function setData(message, key, value) {
    if (!message) return;
    message.extra ??= {};
    message.extra[MODULE] ??= {};
    if (value === undefined) delete message.extra[MODULE][key];
    else message.extra[MODULE][key] = value;
    syncSwipe(message);
}

/** Полностью убирает данные расширения из сообщения (например, для нового свайпа). */
export function clearData(message) {
    if (!message?.extra?.[MODULE]) return;
    delete message.extra[MODULE];
    syncSwipe(message);
}

/** Меняет текст сообщения (и текущего свайпа). */
export function setMessageText(message, text) {
    message.mes = text;
    if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number' && message.swipe_id < message.swipes.length) {
        message.swipes[message.swipe_id] = text;
    }
}

function syncSwipe(message) {
    const info = message.swipe_info?.[message.swipe_id];
    if (info && typeof info === 'object') {
        info.extra ??= {};
        if (message.extra?.[MODULE]) info.extra[MODULE] = structuredClone(message.extra[MODULE]);
        else delete info.extra[MODULE];
    }
}

/**
 * Последнее сохранённое состояние ДО сообщения beforeId (не включая его).
 * @returns {{ id: number, value: any } | null}
 */
export function findPreviousState(beforeId) {
    const { chat } = ctx();
    const start = Math.min(beforeId, chat.length) - 1;
    for (let i = start; i >= 0; i--) {
        const value = getData(chat[i])?.state;
        if (value) return { id: i, value };
    }
    return null;
}

/** Последнее сообщение до beforeId, где поле `key` есть (diary, phone…) или модуль обновлялся. */
export function findPreviousWith(beforeId, test) {
    const { chat } = ctx();
    for (let i = Math.min(beforeId, chat.length) - 1; i >= 0; i--) {
        const d = getData(chat[i]);
        if (d && test(d, chat[i])) return { id: i, data: d };
    }
    return null;
}

/** Сколько ответов бота в промежутке (from, to] */
export function botMessagesBetween(from, to) {
    const { chat } = ctx();
    let n = 0;
    for (let i = Math.max(0, from + 1); i <= to && i < chat.length; i++) if (isBotMessage(chat[i])) n++;
    return n;
}

export function lastBotMessageId() {
    const { chat } = ctx();
    for (let i = chat.length - 1; i >= 0; i--) if (isBotMessage(chat[i])) return i;
    return -1;
}

export async function saveChat() {
    await ctx().saveChat();
}

const markKey = (m) => JSON.stringify([m.id, m.whoId || m.who, m.kind, m.where, m.at]);

/** Ручное удаление не должно отменяться запоздавшим отдельным запросом. */
export function filterDismissedMarks(state) {
    if (!state?.marks?.length) return state;
    const dismissed = new Set(meta()?.dismissedMarks ?? []);
    if (!dismissed.size) return state;
    return { ...state, marks: state.marks.filter((m) => !dismissed.has(markKey(m))) };
}

export function dismissMark(messageId, id) {
    const message = getMessage(messageId);
    const mark = getData(message)?.state?.marks?.find((m) => m.id === id);
    if (!mark) return false;
    const m = meta();
    if (m) m.dismissedMarks = [...new Set([...(m.dismissedMarks ?? []), markKey(mark)])];
    const key = markKey(mark);
    const remove = (data) => {
        if (!data?.state?.marks) return;
        data.state = { ...data.state, marks: data.state.marks.filter((x) => markKey(x) !== key) };
    };
    for (const item of ctx().chat.slice(messageId)) {
        remove(getData(item));
        for (const swipe of item.swipe_info ?? []) remove(swipe?.extra?.[MODULE]);
    }
    saveMeta();
    return true;
}

// ---------------------------------------------------------------- метаданные чата (места)

function meta() {
    const m = ctx().chatMetadata;
    if (!m) return null;
    m[MODULE] ??= {};
    m[MODULE].places ??= {};
    return m[MODULE];
}

export function getPlaces() {
    return meta()?.places ?? {};
}

export function savePlace(place, messageId) {
    const m = meta();
    if (!m || !place?.name) return;
    m.places[normName(place.name)] = { ...place, mes: messageId, saved: Date.now() };
    saveMeta();
}

/** Сколько раз уже просили описание этого места (чтобы не просить бесконечно). */
export function placeTries(name) {
    return meta()?.placeTries?.[normName(name)] ?? 0;
}

export function markPlaceTry(name) {
    const m = meta();
    if (!m || !name) return;
    m.placeTries ??= {};
    m.placeTries[normName(name)] = (m.placeTries[normName(name)] ?? 0) + 1;
    saveMeta();
}

export function deletePlace(key) {
    const m = meta();
    if (!m?.places?.[key]) return;
    delete m.places[key];
    saveMeta();
}

export function saveMeta() {
    const c = ctx();
    (c.saveMetadataDebounced ?? c.saveMetadata)?.();
}
