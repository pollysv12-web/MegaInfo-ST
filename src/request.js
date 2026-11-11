// Отдельный «тихий» запрос к модели только за блоками — не попадает в историю чата.

import { LEGACY_TAGS, OUR_TAGS, stripPlacementMarkers } from './core/engine.js';
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
        const text = stripPlacementMarkers(stripTagBlocks(String(m.mes ?? ''), [...OUR_TAGS, ...LEGACY_TAGS, ...extraTags]));
        if (!text) continue;
        parts.push(`### ${m.name}${m.is_user ? ' (user)' : ''}:\n${text}`);
    }
    return parts.join('\n\n');
}

/**
 * История чата как сообщения с ролями (для «полного» отдельного запроса).
 * @returns {{role: 'user'|'assistant', content: string}[]}
 */
export function chatHistory(uptoId, count, extraTags = []) {
    const { chat } = ctx();
    const out = [];
    for (let i = Math.max(0, uptoId - count + 1); i <= uptoId && i < chat.length; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        const text = stripPlacementMarkers(stripTagBlocks(String(m.mes ?? ''), [...OUR_TAGS, ...LEGACY_TAGS, ...extraTags]));
        if (!text) continue;
        const role = m.is_user ? 'user' : 'assistant';
        const content = `${m.name}: ${text}`;
        const last = out[out.length - 1];
        if (last && last.role === role) last.content += `\n\n${content}`;
        else out.push({ role, content });
    }
    return out;
}

/** Описание персонажа и персоны — чтобы «полный» запрос знал, о ком речь. */
export function cardContext() {
    const c = ctx();
    const parts = [];
    try {
        const ch = c.characters?.[c.characterId];
        if (ch?.description) parts.push(`${c.name2} — описание персонажа:\n${String(ch.description).slice(0, 4000)}`);
        if (ch?.scenario) parts.push(`Сценарий:\n${String(ch.scenario).slice(0, 1500)}`);
        const persona = c.powerUserSettings?.persona_description;
        if (persona) parts.push(`${c.name1} — персона пользователя:\n${String(persona).slice(0, 2000)}`);
    } catch { /* нет карточки */ }
    return parts.length ? c.substituteParams?.(parts.join('\n\n')) ?? parts.join('\n\n') : '';
}

/**
 * Отдельный запрос: системная инструкция + (необязательно) история + последнее сообщение пользователя.
 * Запрос ВСЕГДА заканчивается сообщением пользователя: некоторые модели (Gemini через OpenRouter)
 * отвечают «Bad Request», если последним идёт ответ бота.
 * @returns {Promise<string>}
 */
export async function sideRequest({ system, history = [], final, profileId = '', maxTokens = 2000 }) {
    const c = ctx();
    const messages = [...history, { role: 'user', content: final }];
    if (profileId && c.ConnectionManagerRequestService) {
        const result = await c.ConnectionManagerRequestService.sendRequest(
            profileId, [{ role: 'system', content: system }, ...messages], maxTokens, { stream: false, extractData: true, includePreset: true },
        );
        if (typeof result === 'string') return result;
        return String(result?.content ?? result?.text ?? '');
    }
    // старые версии таверны: generateRaw(prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength)
    if (c.generateRaw.length >= 2) {
        const flat = messages.map((m) => m.content).join('\n\n');
        return String(await c.generateRaw(flat, null, false, false, system, maxTokens) ?? '');
    }
    return String(await c.generateRaw({ prompt: messages, systemPrompt: system, responseLength: maxTokens, trimNames: false }) ?? '');
}

/** Достаёт из ошибки таверны/API что-нибудь понятное. */
export function errorText(e) {
    const bits = [e?.message ?? String(e)];
    const extra = e?.error?.message ?? e?.cause?.message ?? e?.response?.statusText;
    if (extra && !bits.includes(extra)) bits.push(extra);
    if (e?.status) bits.push(`HTTP ${e.status}`);
    return bits.filter(Boolean).join(' · ');
}

/** Список профилей подключения (если менеджер подключений включён). */
export function listProfiles() {
    try {
        return ctx().ConnectionManagerRequestService?.getSupportedProfiles?.() ?? [];
    } catch {
        return [];
    }
}
