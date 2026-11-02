// Панель настроек в меню «Расширения».

import { getSettings } from './settings.js';
import { listProfiles } from './request.js';
import { findLatest, getData, lastBotMessageId } from './store.js';
import * as Sims from './sims.js';
import { esc } from './util.js';

let hooks = { onChange: () => {}, getInjectionText: () => '' };

function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
    target[last] = value;
}

function fillProfiles() {
    const $select = $('#megainfo_profile_select');
    const current = getSettings().sims.profileId;
    $select.empty().append('<option value="">Текущее подключение</option>');
    for (const p of listProfiles()) {
        $select.append(`<option value="${esc(p.id)}">${esc(p.name)}</option>`);
    }
    $select.val(current);
    if ($select.val() !== current) $select.val('');
}

function loadValues() {
    const s = getSettings();
    $('.megainfo-settings [data-mi-setting]').each(function () {
        const path = $(this).data('mi-setting');
        const value = getPath(s, path);
        if (this.type === 'checkbox') this.checked = !!value;
        else $(this).val(value ?? '');
    });
}

export async function initSettingsUi(h) {
    hooks = { ...hooks, ...h };
    const url = new URL('../settings.html', import.meta.url);
    const html = await (await fetch(url)).text();
    $('#extensions_settings2').append(html);

    fillProfiles();
    loadValues();

    $('.megainfo-settings').on('change input', '[data-mi-setting]', function (event) {
        // Числа сохраняем по change, чтобы не дёргаться на каждую цифру
        if (event.type === 'input' && this.type !== 'checkbox' && this.tagName !== 'SELECT' && this.type === 'number') return;
        const path = $(this).data('mi-setting');
        let value;
        if (this.type === 'checkbox') value = this.checked;
        else if (this.type === 'number') value = Number($(this).val());
        else value = $(this).val();
        setPath(getSettings(), path, value);
        hooks.onChange(path, value);
    });

    $('#megainfo_tokens_refresh').on('click', () => refreshTokenStats());
    $('#megainfo_profile_select').on('focus', fillProfiles);

    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const ev of ['CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_DELETED', 'CONNECTION_PROFILE_UPDATED']) {
        if (eventTypes[ev]) eventSource.on(eventTypes[ev], fillProfiles);
    }
}

let refreshTimer = null;

/** Пересчитывает и показывает, сколько токенов тратят блоки. */
export function refreshTokenStats() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(doRefresh, 300);
}

async function doRefresh() {
    const $out = $('#megainfo_tokens');
    if (!$out.length) return;
    const c = SillyTavern.getContext();
    const s = getSettings();
    if (!c.chat?.length && c.characterId === undefined && !c.groupId) {
        $out.text('Откройте чат, чтобы посчитать.');
        return;
    }
    if (!s.enabled || !s.sims.enabled) {
        $out.html('Блоки выключены — расширение не тратит токены.');
        return;
    }
    const count = (t) => (t ? c.getTokenCountAsync(t) : Promise.resolve(0));
    const rows = [];
    const mode = s.sims.mode;

    // Что уходит в каждый ваш обычный запрос
    const inline = hooks.getInjectionText();
    const inlineTokens = await count(inline);

    // Сколько в среднем модель пишет в самом блоке
    const outs = [];
    for (let i = c.chat.length - 1; i >= 0 && outs.length < 10; i--) {
        const n = getData(c.chat[i])?.simsOutTokens;
        if (n) outs.push(n);
    }
    const avgOut = outs.length ? Math.round(outs.reduce((a, b) => a + b, 0) / outs.length) : 0;

    if (mode !== 'separate') {
        rows.push(['Инструкция sims в каждом запросе', `≈ ${inlineTokens}`, 'вход']);
        rows.push(['Блок в ответе модели', avgOut ? `≈ ${avgOut}` : 'нет данных', 'выход']);
    }
    if (mode !== 'inline') {
        const lastId = lastBotMessageId();
        let sepIn = 0;
        if (lastId >= 0) {
            const { system, user } = Sims.separatePrompt(lastId);
            sepIn = await count(system + '\n' + user);
        }
        const label = mode === 'auto' ? 'Отдельный запрос (только если модель забыла блок)' : 'Отдельный запрос после каждого ответа';
        rows.push([label, `≈ ${sepIn} + ${avgOut || '?'}`, 'вход + выход']);
    }

    const latest = findLatest('sims');
    let html = '<table class="mi-tok-table">';
    for (const [name, value, kind] of rows) {
        html += `<tr><td>${esc(name)}</td><td class="mi-tok-val">${esc(value)}</td><td class="mi-tok-kind">${esc(kind)}</td></tr>`;
    }
    html += '</table>';
    html += '<div class="mi-tok-note">Старые блоки вырезаются из истории — в контекст не попадают.';
    if (!latest) html += ' В этом чате ещё нет ни одного блока, после первого цифры станут точнее.';
    html += '</div>';
    $out.html(html);
}
