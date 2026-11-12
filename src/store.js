// Хранение данных блоков внутри сообщений чата (message.extra.megainfo) и в метаданных чата.
// Данные лежат в самом сообщении, поэтому свайпы, удаление и ветки чата работают сами собой:
// у каждого свайпа своя копия, а удалённое сообщение уносит своё состояние с собой.

import { MODULE, getSettings } from './settings.js';
import { normName, str } from './util.js';
import { collectionId, pocketLimit } from './core/pocket.js';

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

// -------------------------------------------------------- manual collections

const collectionStamp = (state) => [state?.date, state?.time].filter(Boolean).join(' ');

function rewriteStates(fromId, change) {
    for (const [index, message] of (ctx().chat ?? []).entries()) {
        if (index < fromId) continue;
        const data = getData(message);
        if (data?.state) data.state = change(data.state, index);
        for (const swipe of message.swipe_info ?? []) {
            const d = swipe?.extra?.[MODULE];
            if (d?.state) d.state = change(d.state, index);
        }
    }
}

function rememberPocketEdit(edit) {
    const m = meta();
    if (!m) return;
    m.pocketEdits ??= [];
    m.pocketEdits = m.pocketEdits.filter((e) => !(e.personId === edit.personId && e.itemId === edit.itemId));
    m.pocketEdits.push(edit);
    saveMeta();
}

function pocketRevision(state, edit, targetId) {
    if (!state?.people?.[edit.personId]) return state;
    const current = state.pockets?.[edit.personId] ?? [];
    const historical = targetId !== undefined && targetId < edit.fromMessage;
    if (historical) return state;
    let items;
    if (edit.removed) {
        items = current.filter((item) => item.id !== edit.itemId
            && !(targetId === edit.fromMessage && normName(item.name) === edit.originalName));
    } else {
        let found = false;
        items = current.map((item) => {
            if (item.id !== edit.itemId) return item;
            found = true;
            return { ...item, ...edit.item };
        });
        // Restore an edited item lost by a stale recalculation of that very reply.
        // Later real loss/transfer events are allowed to remove it normally.
        if (!found && targetId === edit.fromMessage) items = [structuredClone(edit.item), ...items].slice(0, pocketLimit({ s: getSettings() }));
    }
    return { ...state, pockets: { ...(state.pockets ?? {}), [edit.personId]: items } };
}

/** Protect user edits/removals when an earlier asynchronous model request finishes. */
export function filterManualCollections(state, messageId) {
    if (!state) return state;
    let next = state;
    for (const edit of meta()?.pocketEdits ?? []) next = pocketRevision(next, edit, messageId);
    const removed = meta()?.dismissedThreads ?? [];
    if (next.world?.threads?.length && removed.length) {
        const threads = next.world.threads.filter((thread) => !removed.some((entry) =>
            (messageId === undefined || messageId >= entry.fromMessage)
            && (thread.id === entry.id || (messageId === entry.fromMessage && normName(thread.text) === entry.text))));
        next = { ...next, world: { ...next.world, threads } };
    }
    return next;
}

/** Add one explicitly chosen possession. Returns false when owner/name/limit is invalid. */
export function addPocketItem(messageId, personId, value) {
    const state = getData(getMessage(messageId))?.state;
    const name = str(value?.name, 80);
    if (!state?.people?.[personId] || !name) return false;
    const items = state.pockets?.[personId] ?? [];
    if (items.length >= pocketLimit({ s: getSettings() }) || items.some((item) => normName(item.name) === normName(name))) return false;
    const item = { id: collectionId('manual', personId, name, String(Date.now())), name, note: str(value?.note, 220), at: collectionStamp(state), manual: true };
    const edit = { personId, itemId: item.id, item, fromMessage: Number(messageId) };
    state.pockets = { ...(state.pockets ?? {}), [personId]: [...items, item] };
    // Active swipe needs its own copy just like model-produced data.
    syncSwipe(getMessage(messageId));
    rememberPocketEdit(edit);
    return true;
}

/** Change a single item, or remove it with patch=null; keeps following states/swipes consistent. */
export function updatePocket(messageId, personId, itemId, patch) {
    const state = getData(getMessage(messageId))?.state;
    const item = state?.pockets?.[personId]?.find((entry) => entry.id === itemId);
    if (!item) return false;
    const edit = { personId, itemId, fromMessage: Number(messageId), originalName: normName(item.name) };
    if (patch === null) edit.removed = true;
    else {
        if (!patch || typeof patch !== 'object') return false;
        const name = patch.name === undefined ? item.name : str(patch.name, 80);
        if (!name) return false;
        if ((state.pockets[personId] ?? []).some((other) => other.id !== itemId && normName(other.name) === normName(name))) return false;
        edit.item = { ...item, name, note: patch.note === undefined ? item.note : str(patch.note, 220), manual: true };
    }
    rewriteStates(Number(messageId), (next, index) => pocketRevision(next, edit, index));
    rememberPocketEdit(edit);
    return true;
}

/** Dismiss one unresolved promise/question without deleting unrelated plot data. */
export function dismissThread(messageId, threadId) {
    const thread = getData(getMessage(messageId))?.state?.world?.threads?.find((entry) => entry.id === threadId);
    if (!thread) return false;
    const m = meta();
    if (m) {
        m.dismissedThreads ??= [];
        m.dismissedThreads = m.dismissedThreads.filter((entry) => entry.id !== threadId);
        m.dismissedThreads.push({ id: threadId, text: normName(thread.text), fromMessage: Number(messageId) });
    }
    rewriteStates(Number(messageId), (state) => !state.world?.threads ? state : {
        ...state, world: { ...state.world, threads: state.world.threads.filter((entry) => entry.id !== threadId) },
    });
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
