// Модуль Sims: обработка ответа модели, отдельный запрос, отрисовка.

import { STAT_DEFS, activeStats, getSettings } from './settings.js';
import { SIMS_TAG, applyUpdate, buildInstruction, collectWarnings, looksValid } from './sims-core.js';
import { findPrevious, getData, setData } from './store.js';
import { quietRequest, recentStory } from './request.js';
import {
    esc, findTagBlock, formatDuration, formatMoney, formatSigned, parseLooseJson, weekday,
} from './util.js';

export const KEY = 'sims';

export function simsOptions() {
    const s = getSettings();
    const ctx = SillyTavern.getContext();
    const stats = activeStats(s);
    return {
        stats,
        decay: Object.fromEntries(stats.map((k) => [k, Number(s.sims.stats[k]?.decay ?? STAT_DEFS[k].decay)])),
        npcMax: Number(s.sims.npcMax) || 0,
        npcDetail: s.sims.npcDetail,
        charName: ctx.name2,
        userName: ctx.name1,
        currency: s.sims.currency,
    };
}

export function isEnabled() {
    const s = getSettings();
    return s.enabled && s.sims.enabled;
}

/** Текст инструкции для вставки в основной запрос (режимы inline/auto). */
export function inlinePrompt(beforeId) {
    const prev = findPrevious(KEY, beforeId)?.value ?? null;
    return buildInstruction(prev, simsOptions(), { separate: false });
}

/**
 * Пытается применить блок из текста модели к сообщению.
 * @returns {'ok'|'error'|'none'}
 */
export function applyFromText(messageId, message, rawText) {
    const block = findTagBlock(rawText, SIMS_TAG);
    if (!block) return 'none';
    const prev = findPrevious(KEY, messageId)?.value ?? null;
    try {
        const data = parseLooseJson(block.inner);
        if (!looksValid(data)) throw new Error('в JSON нет даты, времени и людей');
        const state = applyUpdate(prev, data, simsOptions());
        setData(message, KEY, state);
        setData(message, KEY + 'Error', undefined);
        // Запоминаем размер блока в токенах — для счётчика в настройках.
        SillyTavern.getContext().getTokenCountAsync(block.inner)
            .then((n) => setData(message, KEY + 'OutTokens', n))
            .catch(() => {});
        return 'ok';
    } catch (e) {
        console.warn('[MegaInfo] sims parse failed', e, block.inner);
        setData(message, KEY + 'Error', { text: e.message, raw: block.inner.slice(0, 4000) });
        return 'error';
    }
}

/** Отдельный запрос только за блоком sims для сообщения messageId. */
export function separatePrompt(messageId) {
    const s = getSettings();
    const prev = findPrevious(KEY, messageId)?.value ?? null;
    const system = buildInstruction(prev, simsOptions(), { separate: true });
    const story = recentStory(messageId, Math.max(1, Number(s.sims.contextMessages) || 4));
    const user = `STORY (latest part):\n\n${story}\n\nNow output the <${SIMS_TAG}> block for the moment right after the last message.`;
    return { system, user };
}

/**
 * Отдельный запрос только за блоком sims для сообщения messageId.
 * @param {() => boolean} stillValid  проверка, что пока ждали ответ, чат/свайп не сменились
 * @returns {Promise<'ok'|'error'|'none'|'stale'>}
 */
export async function requestSeparate(messageId, message, stillValid = () => true) {
    const s = getSettings();
    const { system, user } = separatePrompt(messageId);
    const answer = await quietRequest({
        system, user, profileId: s.sims.profileId, maxTokens: Number(s.sims.maxTokens) || 700,
    });
    if (!stillValid()) return 'stale';
    const text = /<sims\b/i.test(answer) ? answer : `<${SIMS_TAG}>${answer}</${SIMS_TAG}>`;
    return applyFromText(messageId, message, text);
}

// ---------------------------------------------------------------- отрисовка

function statRow(key, value, diff, view, crit) {
    const def = STAT_DEFS[key];
    const delta = diff ? `<span class="mi-delta ${diff > 0 ? 'mi-up' : 'mi-down'}">${formatSigned(diff)}</span>` : '';
    if (view === 'chips') {
        return `<span class="mi-chip${crit ? ' mi-crit' : ''}" title="${esc(def.label)}"><i class="fa-solid ${def.icon}"></i>${value}%${delta}</span>`;
    }
    return `<div class="mi-stat${crit ? ' mi-crit' : ''}">`
        + `<span class="mi-stat-label"><i class="fa-solid ${def.icon}"></i>${esc(def.label)}</span>`
        + `<span class="mi-bar"><span class="mi-bar-fill mi-stat-${key}" style="width:${value}%"></span></span>`
        + `<span class="mi-stat-val">${value}%${delta}</span>`
        + '</div>';
}

function personCard(p, state, opts, view, warnings) {
    const critStats = new Set(warnings.filter((w) => w.id === p.id).map((w) => w.stat));
    const roleLabel = { char: '', user: '', npc: 'NPC' }[p.role] ?? '';
    let h = `<div class="mi-person mi-role-${esc(p.role)}">`;
    h += `<div class="mi-name"><i class="fa-solid ${p.role === 'user' ? 'fa-user' : p.role === 'npc' ? 'fa-user-group' : 'fa-user-tie'}"></i>${esc(p.name)}`;
    if (roleLabel) h += `<span class="mi-badge">${roleLabel}</span>`;
    h += '</div>';

    if (p.stats) {
        const keys = opts.stats.filter((k) => p.stats[k] !== undefined);
        if (keys.length) {
            h += `<div class="${view === 'chips' ? 'mi-chips' : 'mi-stats'}">`;
            for (const k of keys) h += statRow(k, p.stats[k], p.diff?.[k], view, critStats.has(k));
            h += '</div>';
        }
    }
    const tags = [];
    if (p.mood) tags.push(`<span class="mi-tag"><i class="fa-solid fa-masks-theater"></i>${esc(p.mood)}</span>`);
    if (p.outfit) tags.push(`<span class="mi-tag"><i class="fa-solid fa-shirt"></i>${esc(p.outfit)}</span>`);
    if (tags.length) h += `<div class="mi-tags">${tags.join('')}</div>`;
    if (p.thought) h += `<div class="mi-thought"><i class="fa-solid fa-comment-dots"></i>${esc(p.thought)}</div>`;
    h += '</div>';
    return h;
}

function profileSection(state, people, settings) {
    const s = settings.sims;
    const rows = people.map((p) => {
        const pr = p.profile ?? {};
        const items = [];
        if (s.showProfile) {
            if (pr.birthday) items.push(`<div><i class="fa-solid fa-cake-candles"></i><span class="mi-k">д/р</span>${esc(pr.birthday)}</div>`);
            if (pr.zodiac) items.push(`<div><i class="fa-solid fa-star"></i><span class="mi-k">знак</span>${esc(pr.zodiac)}</div>`);
            if (pr.mbti) items.push(`<div><i class="fa-solid fa-brain"></i><span class="mi-k">MBTI</span>${esc(pr.mbti)}</div>`);
        }
        if (s.showMoney && p.money !== null && p.money !== undefined) {
            items.push(`<div class="mi-money"><i class="fa-solid fa-wallet"></i><span class="mi-k">деньги</span>${esc(formatMoney(p.money, s.currency))}</div>`);
        }
        if (!items.length) return '';
        return `<div class="mi-profile"><div class="mi-profile-name">${esc(p.name)}</div>${items.join('')}</div>`;
    }).filter(Boolean);

    let tx = '';
    if (s.showMoney && state.tx?.length) {
        tx = '<div class="mi-tx">' + state.tx.map((t) => `<span class="mi-tx-item ${t.amount > 0 ? 'mi-up' : 'mi-down'}">${esc(formatMoney(t.amount, s.currency))}${t.note ? ' · ' + esc(t.note) : ''}<span class="mi-tx-who">${esc(t.who)}</span></span>`).join('') + '</div>';
    }
    if (!rows.length && !tx) return '';
    return `<details class="mi-more"><summary><i class="fa-solid fa-circle-info"></i>Общая информация</summary><div class="mi-profiles">${rows.join('')}</div>${tx}</details>`;
}

const ACTIONS = '<span class="mi-actions">'
    + '<i class="fa-solid fa-rotate mi-act" data-mi-act="regen" data-mi-mod="sims" title="Перегенерировать только этот блок"></i>'
    + '<i class="fa-solid fa-pen mi-act" data-mi-act="edit" data-mi-mod="sims" title="Исправить значения вручную"></i>'
    + '</span>';

export function renderHtml(message) {
    const data = getData(message);
    const state = data?.[KEY];
    const error = data?.[KEY + 'Error'];
    const settings = getSettings();

    if (!state && error) {
        return `<div class="mi-block mi-error"><i class="fa-solid fa-triangle-exclamation"></i>`
            + `<span>Блок sims не распознан: ${esc(error.text)}</span>${ACTIONS}</div>`;
    }
    if (!state) return '';

    const opts = simsOptions();
    const order = { char: 0, user: 1, npc: 2 };
    const people = (state.scene ?? []).map((id) => state.people[id]).filter(Boolean)
        .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
    const warnings = collectWarnings(state, opts);
    const wd = weekday(state.date, state.time);
    const passed = formatDuration(state.elapsed);

    let h = `<details class="mi-block mi-sims"${settings.sims.collapsed ? '' : ' open'}>`;
    h += '<summary class="mi-head">';
    h += '<span class="mi-head-main">';
    h += `<span><i class="fa-solid fa-calendar-days"></i>${esc([wd, state.date].filter(Boolean).join(', '))}</span>`;
    if (state.time) h += `<span><i class="fa-solid fa-clock"></i>${esc(state.time)}${passed ? `<span class="mi-passed">+${esc(passed)}</span>` : ''}</span>`;
    h += '</span>';
    h += '<span class="mi-head-sub">';
    if (state.weather) h += `<span><i class="fa-solid fa-cloud-sun"></i>${esc(state.weather)}</span>`;
    if (state.location) h += `<span><i class="fa-solid fa-location-dot"></i>${esc(state.location)}</span>`;
    h += '</span>';
    h += ACTIONS;
    h += '</summary>';
    h += '<div class="mi-body">';
    h += `<div class="mi-people mi-view-${esc(settings.sims.view)}">`;
    for (const p of people) h += personCard(p, state, opts, settings.sims.view, warnings);
    h += '</div>';
    h += profileSection(state, people, settings);
    h += '</div></details>';
    return h;
}
