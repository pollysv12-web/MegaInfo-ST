// Журнал диагностики: что вставили в промпт, нашёлся ли блок, чем закончился отдельный запрос.
// Его можно скопировать из настроек и прислать разработчику — по нему видно, где ломается.

import { getSettings, VERSION } from './settings.js';

const MAX = 300;
const entries = [];
const listeners = new Set();

export function log(level, msg, data) {
    const entry = { t: new Date().toISOString().slice(11, 19), level, msg, data: data === undefined ? undefined : shorten(data) };
    entries.push(entry);
    if (entries.length > MAX) entries.shift();
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
    fn('[MegaInfo]', msg, data ?? '');
    for (const l of listeners) {
        try { l(entry); } catch { /* ignore */ }
    }
}

export const info = (m, d) => log('info', m, d);
export const warn = (m, d) => log('warn', m, d);
export const error = (m, d) => log('error', m, d);

function shorten(data) {
    try {
        if (typeof data === 'string') return data.length > 1500 ? data.slice(0, 1500) + '…' : data;
        const s = JSON.stringify(data);
        return s.length > 1500 ? s.slice(0, 1500) + '…' : JSON.parse(s);
    } catch {
        return String(data);
    }
}

export function onLog(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getEntries() {
    return [...entries];
}

export function clearLog() {
    entries.length = 0;
}

/** Текстовый отчёт для копирования. */
export function report() {
    const c = SillyTavern.getContext();
    const s = getSettings();
    const safe = (fn) => { try { return fn() ?? '?'; } catch { return '?'; } };
    const enabled = Object.entries(s.modules).filter(([, v]) => v.enabled).map(([k]) => k).join(', ');
    const head = [
        `MegaInfo ${VERSION}`,
        `API: ${c.mainApi ?? '?'} · модель: ${safe(() => c.getChatCompletionModel?.())} · стриминг: ${safe(() => c.chatCompletionSettings?.stream_openai)}`,
        `Хук форматирования: ${c.messageFormatter?.addHook ? 'есть' : 'нет (старая таверна)'} · менеджер подключений: ${c.ConnectionManagerRequestService ? 'есть' : 'нет'}`,
        `Режим: ${s.mode} / отдельный запрос: ${s.separateKind} / профиль: ${s.profileId || 'текущий'}`,
        `Модули: ${enabled}`,
        `Сообщений в чате: ${c.chat?.length ?? 0}`,
        '',
    ];
    const lines = entries.map((e) => `${e.t} ${e.level.toUpperCase().padEnd(5)} ${e.msg}${e.data !== undefined ? ' ' + (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)) : ''}`);
    return head.concat(lines).join('\n');
}
