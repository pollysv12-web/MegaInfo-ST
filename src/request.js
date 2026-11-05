// Отдельный «тихий» запрос к модели только за блоками — не попадает в историю чата.

import { LEGACY_TAGS, OUR_TAGS } from './core/engine.js';
import { stripTagBlocks } from './util.js';

const ctx = () => SillyTavern.getContext();

/**
 * Последние сообщения чата как читаемый текст (для лёгкого отдельного запроса).
 * @param {number} uptoId  последнее сообщение, которое нужно включить
 * @param {number} count   сколько сообщений брать
 */
export function recentStory(uptoId, count, extraTags = []) {
    const { chat } = ctx();
    const from = Math.max(0, uptoId - count + 1);
    const parts = [];
    for (let i = from; i <= uptoId && i < chat.length; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        const text = stripTagBlocks(String(m.mes ?? ''), [...OUR_TAGS, ...LEGACY_TAGS, ...extraTags]);
        if (!text) continue;
        parts.push(`### ${m.name}${m.is_user ? ' (user)' : ''}:\n${text}`);
    }
    return parts.join('\n\n');
}

/**
 * Лёгкий запрос: своя системная инструкция + кусок истории. Через выбранный профиль или текущее подключение.
 * @returns {Promise<string>}
 */
export async function lightRequest({ system, user, profileId = '', maxTokens = 2000 }) {
    const c = ctx();
    if (profileId && c.ConnectionManagerRequestService) {
        const messages = [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ];
        const result = await c.ConnectionManagerRequestService.sendRequest(
            profileId, messages, maxTokens, { stream: false, extractData: true, includePreset: true },
        );
        if (typeof result === 'string') return result;
        return String(result?.content ?? result?.text ?? '');
    }
    // старые версии таверны: generateRaw(prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength)
    if (c.generateRaw.length >= 2) return String(await c.generateRaw(user, null, false, false, system, maxTokens) ?? '');
    return String(await c.generateRaw({
        prompt: [{ role: 'user', content: user }],
        systemPrompt: system,
        responseLength: maxTokens,
        trimNames: false,
    }) ?? '');
}

/**
 * Полный запрос: вся история, карточка и пресет (с вашим джейлбрейком), а в конце — наша инструкция.
 * Дороже, зато модель знает весь контекст и реже отказывается.
 */
export async function fullRequest({ instruction, maxTokens = 2000 }) {
    const c = ctx();
    const fn = c.generateQuietPrompt;
    if (typeof fn !== 'function') throw new Error('generateQuietPrompt недоступен в этой версии таверны');
    // В старых версиях таверны функция принимала позиционные аргументы
    // (quiet_prompt, quietToLoud, skipWIAN, …) — у новой версии один объект, length 0 или 1
    if (fn.length >= 2) return String(await fn(instruction, false, false, null, null, maxTokens) ?? '');
    return String(await fn({ quietPrompt: instruction, responseLength: maxTokens, removeReasoning: true }) ?? '');
}

/** Список профилей подключения (если менеджер подключений включён). */
export function listProfiles() {
    try {
        return ctx().ConnectionManagerRequestService?.getSupportedProfiles?.() ?? [];
    } catch {
        return [];
    }
}
