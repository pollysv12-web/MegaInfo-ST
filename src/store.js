// Хранение данных блоков внутри сообщений чата (message.extra.megainfo).
// Данные лежат в самом сообщении, поэтому свайпы, удаление и ветки чата работают сами собой:
// у каждого свайпа своя копия, а удалённое сообщение уносит своё состояние с собой.

import { MODULE } from './settings.js';

export function getMessage(messageId) {
    const { chat } = SillyTavern.getContext();
    return chat?.[messageId] ?? null;
}

export function getData(message) {
    return message?.extra?.[MODULE] ?? null;
}

/** Записывает данные модуля в сообщение и в текущий свайп. */
export function setData(message, key, value) {
    if (!message) return;
    message.extra ??= {};
    message.extra[MODULE] ??= {};
    if (value === undefined) delete message.extra[MODULE][key];
    else message.extra[MODULE][key] = value;
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
        info.extra[MODULE] = structuredClone(message.extra[MODULE]);
    }
}

/**
 * Последнее сохранённое состояние модуля ДО сообщения beforeId (не включая его).
 * @returns {{ id: number, value: any } | null}
 */
export function findPrevious(key, beforeId) {
    const { chat } = SillyTavern.getContext();
    const start = Math.min(beforeId, chat.length) - 1;
    for (let i = start; i >= 0; i--) {
        const value = getData(chat[i])?.[key];
        if (value) return { id: i, value };
    }
    return null;
}

/** Последнее состояние во всём чате. */
export function findLatest(key) {
    const { chat } = SillyTavern.getContext();
    return findPrevious(key, chat.length);
}

export function lastBotMessageId() {
    const { chat } = SillyTavern.getContext();
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m.is_user && !m.is_system) return i;
    }
    return -1;
}

export async function saveChat() {
    await SillyTavern.getContext().saveChat();
}
