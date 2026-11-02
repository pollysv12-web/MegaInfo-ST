// Отдельный «тихий» запрос к модели: только для блоков, без участия в истории чата.

import { stripTagBlocks } from './util.js';

/** Все теги блоков, которые расширение вырезает из истории. */
export const ALL_TAGS = ['sims'];

/**
 * Собирает последние сообщения чата в читаемый текст для отдельного запроса.
 * @param {number} uptoId  последнее сообщение, которое нужно включить
 * @param {number} count   сколько сообщений брать
 */
export function recentStory(uptoId, count) {
    const { chat } = SillyTavern.getContext();
    const from = Math.max(0, uptoId - count + 1);
    const parts = [];
    for (let i = from; i <= uptoId && i < chat.length; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        const text = stripTagBlocks(String(m.mes ?? ''), ALL_TAGS);
        if (!text) continue;
        parts.push(`${m.name}: ${text}`);
    }
    return parts.join('\n\n');
}

/**
 * Отправляет запрос: через выбранный профиль подключения или через текущее подключение.
 * @returns {Promise<string>}
 */
export async function quietRequest({ system, user, profileId = '', maxTokens = 600 }) {
    const context = SillyTavern.getContext();
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];

    if (profileId && context.ConnectionManagerRequestService) {
        const result = await context.ConnectionManagerRequestService.sendRequest(
            profileId, messages, maxTokens, { stream: false, extractData: true, includePreset: true },
        );
        if (typeof result === 'string') return result;
        return String(result?.content ?? '');
    }

    return String(await context.generateRaw({
        prompt: [{ role: 'user', content: user }],
        systemPrompt: system,
        responseLength: maxTokens,
        trimNames: false,
    }) ?? '');
}

/** Список профилей подключения (если менеджер подключений включён). */
export function listProfiles() {
    try {
        const context = SillyTavern.getContext();
        return context.ConnectionManagerRequestService?.getSupportedProfiles?.() ?? [];
    } catch {
        return [];
    }
}
