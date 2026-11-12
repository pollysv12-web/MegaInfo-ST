// Панель настроек в меню «Расширения».

import { getSettings } from './settings.js';
import { listProfiles } from './request.js';
import { deletePlace, getData, getPlaces, lastBotMessageId } from './store.js';
import { buildInstruction } from './core/engine.js';
import { buildOpts, injectionFor, allTrackerModules } from './tracker.js';
import { exportDiary, exportJson, exportText } from './export.js';
import { openQuickMenu } from './quick.js';
import * as Log from './log.js';
import { esc, normName } from './util.js';
import { PRESETS, applyPreset } from './presets.js';
import { TRACKING_FIELDS, setTrackingOverride, trackingFor } from './tracking.js';

let hooks = { onChange: () => {} };

const TAB_LABELS = { chars: 'Пульс', npc: 'Окружение', rel: 'Связи', slow: 'Slow burn', world: 'Сюжет', place: 'Места', body: 'Следы', pocket: 'Кармашек' };
const PULSE_LABELS = { stats: 'Потребности и страсть', mood: 'Настроение', excitement: 'Возбуждение', outfit: 'Одежда', thought: 'Мысли', money: 'Деньги', profile: 'Общая информация', pocket: 'Кармашек' };

function renderOrder() {
    const stored = getSettings().display.tabOrder;
    const order = [...new Set([...(Array.isArray(stored) ? stored : []), ...Object.keys(TAB_LABELS)])].filter(k => Object.hasOwn(TAB_LABELS, k));
    $('#megainfo_tab_order').html(order.map((key, index) => `<div class="mi-order-row"><span>${esc(TAB_LABELS[key])}</span><span class="mi-order-actions"><button type="button" class="menu_button" data-mi-order="${key}" data-mi-direction="-1" title="Поднять ${esc(TAB_LABELS[key])}" aria-label="Поднять ${esc(TAB_LABELS[key])}"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" class="menu_button" data-mi-order="${key}" data-mi-direction="1" title="Опустить ${esc(TAB_LABELS[key])}" aria-label="Опустить ${esc(TAB_LABELS[key])}"${index === order.length - 1 ? ' disabled' : ''}>↓</button></span></div>`).join(''));
}

function knownPeople() {
    const c = SillyTavern.getContext();
    const people = new Map();
    for (const message of c.chat ?? []) for (const p of Object.values(getData(message)?.state?.people ?? {})) people.set(normName(p.name), p);
    if (c.name2 && !people.has(normName(c.name2))) people.set(normName(c.name2), { name: c.name2, role: 'char' });
    if (c.name1 && !people.has(normName(c.name1))) people.set(normName(c.name1), { name: c.name1, role: 'user' });
    return people;
}

function renderTrackingFields() {
    const name = String($('#megainfo_tracking_name').val() ?? '').trim();
    const s = getSettings();
    const key = normName(name);
    const current = Object.hasOwn(s.tracking.overrides, key) ? s.tracking.overrides[key] : {};
    const person = knownPeople().get(key) ?? { name, role: 'npc' };
    const policy = trackingFor(person, s);
    $('#megainfo_tracking_detail').val(current.detail ?? 'inherit').prop('disabled', !name);
    $('#megainfo_tracking_reset').prop('disabled', !name || !Object.hasOwn(s.tracking.overrides, key));
    $('#megainfo_tracking_fields').html(Object.entries(TRACKING_FIELDS).map(([field, label]) => `<label class="checkbox_label"><input type="checkbox" data-mi-track-field="${field}"${policy.fields[field] ? ' checked' : ''}${!name || policy.detail === 'off' ? ' disabled' : ''}><span>${esc(label)}</span></label>`).join(''));
}

function renderPreferences() {
    renderOrder();
    $('#megainfo_pulse_fields').html(Object.entries(PULSE_LABELS).map(([key, label]) => `<div class="mi-set-row"><label>${esc(label)}</label><select class="text_pole" data-mi-setting="display.pulse.${key}"><option value="show">Сразу</option><option value="collapse">Под раскрытие</option><option value="hide">Скрыть</option></select></div>`).join(''));
    $('#megainfo_known_people').html([...knownPeople().values()].map(p => `<option value="${esc(p.name)}"></option>`).join(''));
    renderTrackingFields();
}

function updatePresetDescription() {
    const selected = PRESETS.find(p => p.id === $('#megainfo_preset').val());
    $('#megainfo_preset_description').text(selected?.description ?? '');
}

function initPreferences() {
    const $root = $('.megainfo-settings');
    const activate = (attribute, value, panelAttribute) => {
        $root.find(`[${attribute}]`).each((_, el) => $(el).attr('aria-selected', String(el.getAttribute(attribute) === value)));
        $root.find(`[${panelAttribute}]`).each((_, el) => { el.hidden = el.getAttribute(panelAttribute) !== value; });
    };
    for (const [attribute, panels] of [['data-mi-config-tab', 'data-mi-config-panel'], ['data-mi-config-subtab', 'data-mi-config-subpanel']]) {
        $root.on('click', `[${attribute}]`, function () { activate(attribute, this.getAttribute(attribute), panels); });
        $root.on('keydown', `[${attribute}]`, function (event) {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const tabs = $root.find(`[${attribute}]`).toArray();
            const index = tabs.indexOf(this);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
            tabs[next].click(); tabs[next].focus();
        });
    }
    $root.on('click', '[data-mi-order]', function () {
        const s = getSettings();
        const order = [...new Set([...(Array.isArray(s.display.tabOrder) ? s.display.tabOrder : []), ...Object.keys(TAB_LABELS)])].filter(k => Object.hasOwn(TAB_LABELS, k));
        const key = this.dataset.miOrder;
        const index = order.indexOf(key), target = index + Number(this.dataset.miDirection);
        if (target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        s.display.tabOrder = order;
        const direction = this.dataset.miDirection;
        renderOrder();
        $root.find(`[data-mi-order="${key}"][data-mi-direction="${direction}"]`).trigger('focus');
        hooks.onChange('display.tabOrder', order);
    });
    $('#megainfo_tracking_name').on('change input', renderTrackingFields);
    $('#megainfo_tracking_detail').on('change', function () {
        const s = getSettings(), name = String($('#megainfo_tracking_name').val() ?? '').trim(), key = normName(name);
        const previous = Object.hasOwn(s.tracking.overrides, key) ? s.tracking.overrides[key] : {};
        const next = { ...previous, role: (knownPeople().get(key) ?? { role: 'npc' }).role };
        if (this.value === 'inherit') delete next.detail; else next.detail = this.value;
        if (setTrackingOverride(s, name, next.detail || next.fields ? next : null)) {
            renderTrackingFields(); hooks.onChange('tracking');
        }
    });
    $root.on('change', '[data-mi-track-field]', function () {
        const s = getSettings(), name = String($('#megainfo_tracking_name').val() ?? '').trim(), key = normName(name);
        const previous = Object.hasOwn(s.tracking.overrides, key) ? s.tracking.overrides[key] : {};
        if (setTrackingOverride(s, name, { ...previous, role: (knownPeople().get(key) ?? { role: 'npc' }).role, fields: { ...previous.fields, [this.dataset.miTrackField]: this.checked } })) {
            renderTrackingFields(); hooks.onChange('tracking');
        }
    });
    $('#megainfo_tracking_reset').on('click', () => {
        if (setTrackingOverride(getSettings(), $('#megainfo_tracking_name').val(), null)) { renderTrackingFields(); hooks.onChange('tracking'); }
    });
    $('#megainfo_preset').html(PRESETS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join(''))
        .val(getSettings().lastPreset ?? PRESETS[0].id).on('change', updatePresetDescription);
    updatePresetDescription();
    $('#megainfo_preset_apply').on('click', () => {
        const id = $('#megainfo_preset').val();
        if (!applyPreset(getSettings(), id)) return;
        loadValues(); hooks.onChange('preset', id);
        $('#megainfo_preset_status').text(`Применён набор «${PRESETS.find(p => p.id === id).name}». Подключение и данные чатов сохранены.`);
    });
}

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
    const current = getSettings().profileId;
    $select.empty().append('<option value="">Текущее подключение</option>');
    for (const p of listProfiles()) $select.append(`<option value="${esc(p.id)}">${esc(p.name)}</option>`);
    $select.val(current);
    if ($select.val() !== current) $select.val('');
}

export function loadValues() {
    const s = getSettings();
    renderPreferences();
    $('.megainfo-settings [data-mi-setting]').each(function () {
        const value = getPath(s, $(this).data('mi-setting'));
        if (this.type === 'checkbox') this.checked = !!value;
        else $(this).val(value ?? '');
    });
    $('#megainfo_custom_colors').toggle(s.theme === 'custom');
}

function renderLog() {
    const $out = $('#megainfo_log');
    if (!$out.length) return;
    const entries = Log.getEntries().slice(-80);
    if (!entries.length) {
        $out.html('<span style="opacity:.6">Здесь появятся события: что попросили у модели, нашёлся ли блок, ошибки.</span>');
        return;
    }
    $out.html(entries.map((e) => `<div class="mi-log-${e.level}">${esc(e.t)} ${esc(e.msg)}</div>`).join(''));
    $out.scrollTop($out[0].scrollHeight);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toastr.success('Скопировано', 'MegaInfo');
    } catch {
        const c = SillyTavern.getContext();
        await c.callGenericPopup('<b>Скопируйте вручную:</b>', c.POPUP_TYPE.INPUT, text, { rows: 18, wide: true, large: true });
    }
}

async function showPrompt() {
    const c = SillyTavern.getContext();
    const { text } = injectionFor(c.chat.length);
    const opts = buildOpts();
    const lastId = lastBotMessageId();
    const prev = lastId >= 0 ? getData(c.chat[lastId])?.state ?? null : null;
    const separate = buildInstruction({ state: prev, request: allTrackerModules(opts), opts, separate: true });
    const body = `=== Вставка в следующий обычный запрос ===\n\n${text || '(ничего — все блоки выключены или не нужны в этот раз)'}\n\n\n=== Так выглядит отдельный запрос за блоком ===\n\n${separate || '(нет включённых блоков)'}`;
    await c.callGenericPopup('<b>Что увидит модель</b>', c.POPUP_TYPE.INPUT, body, { rows: 24, wide: true, large: true, okButton: 'Закрыть' });
}

async function showPlaces() {
    const c = SillyTavern.getContext();
    const places = getPlaces();
    const keys = Object.keys(places);
    if (!keys.length) {
        toastr.info('В этом чате пока нет описанных мест.', 'MegaInfo');
        return;
    }
    const $list = $('<div class="mi-quick"><h3>Места этого чата</h3><div class="mi-hint">Удалите место, если хотите, чтобы модель описала его заново.</div></div>');
    for (const k of keys) {
        const p = places[k];
        const $row = $(`<details class="mi-more"><summary><b>${esc(p.name)}</b> <i class="fa-solid fa-trash-can mi-link" title="Удалить"></i></summary><div>${esc(p.look)}</div><div>${esc(p.details)}</div><div>${esc(p.mood)}</div></details>`);
        $row.find('.fa-trash-can').on('click', (e) => {
            e.preventDefault();
            deletePlace(k);
            $row.remove();
            hooks.onChange();
        });
        $list.append($row);
    }
    await c.callGenericPopup($list, c.POPUP_TYPE.TEXT, '', { okButton: 'Закрыть', allowVerticalScrolling: true });
}

export async function initSettingsUi(h) {
    hooks = { ...hooks, ...h };
    const url = new URL('../settings.html', import.meta.url);
    const html = await (await fetch(url)).text();
    $('#extensions_settings2').append(html);

    fillProfiles();
    initPreferences();
    loadValues();
    renderLog();
    Log.onLog(() => renderLog());

    $('.megainfo-settings').on('change input', '[data-mi-setting]', function (event) {
        // Числа и текст сохраняем по change, чтобы не дёргаться на каждую букву
        if (event.type === 'input' && this.type !== 'checkbox' && this.tagName !== 'SELECT' && this.type !== 'color') return;
        const path = $(this).data('mi-setting');
        let value;
        if (this.type === 'checkbox') value = this.checked;
        else if (this.type === 'number') value = Number($(this).val());
        else value = $(this).val();
        if (path === 'modules.sims.stats.arousal.decay') {
            value = Number.isFinite(value) ? Math.min(0, value) : 0;
            $(this).val(value);
        }
        if (path === 'display.fontSize') {
            value = Number.isFinite(value) ? Math.min(150, Math.max(80, value)) : 100;
            $(this).val(value);
        }
        if (path === 'modules.pocket.maxItems' || path === 'modules.world.threadLimit') {
            value = Number.isFinite(value) ? Math.min(path === 'modules.pocket.maxItems' ? 20 : 12, Math.max(1, Math.round(value))) : 5;
            $(this).val(value);
        }
        setPath(getSettings(), path, value);
        if (path === 'modules.sims.npcDetail') getSettings().tracking.roles.npc = value;
        if (path === 'tracking.roles.npc' && value !== 'off') getSettings().modules.sims.npcDetail = value;
        if (path === 'theme') $('#megainfo_custom_colors').toggle(value === 'custom');
        if (path.startsWith('tracking.')) renderTrackingFields();
        hooks.onChange(path, value);
    });

    $('#megainfo_tokens_refresh').on('click', () => refreshTokenStats());
    $('#megainfo_profile_select').on('focus', fillProfiles);
    $('#megainfo_export_logs').on('click', exportJson);
    $('#megainfo_export_md').on('click', exportText);
    $('#megainfo_export_diary').on('click', exportDiary);
    $('#megainfo_copy_report').on('click', () => copyText(Log.report()));
    $('#megainfo_show_prompt').on('click', showPrompt);
    $('#megainfo_clear_log').on('click', () => { Log.clearLog(); renderLog(); });
    $('#megainfo_places').on('click', showPlaces);
    $('#megainfo_quick_open').on('click', () => openQuickMenu(() => { loadValues(); hooks.onChange(); }));

    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const ev of ['CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_DELETED', 'CONNECTION_PROFILE_UPDATED']) {
        if (eventTypes[ev]) eventSource.on(eventTypes[ev], fillProfiles);
    }
    if (eventTypes.CHAT_CHANGED) eventSource.on(eventTypes.CHAT_CHANGED, () => {
        $('#megainfo_known_people').html([...knownPeople().values()].map(p => `<option value="${esc(p.name)}"></option>`).join(''));
        renderTrackingFields();
    });
}

let refreshTimer = null;

/** Пересчитывает и показывает, сколько токенов тратят блоки. */
export function refreshTokenStats() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => doRefresh().catch((e) => console.warn('[MegaInfo] token stats', e)), 400);
}

async function doRefresh() {
    const $out = $('#megainfo_tokens');
    if (!$out.length) return;
    const c = SillyTavern.getContext();
    const s = getSettings();
    if (!c.chat?.length) {
        $out.text('Откройте чат, чтобы посчитать.');
        return;
    }
    if (!s.enabled) {
        $out.html('Расширение выключено — токены не тратятся.');
        return;
    }
    const count = (t) => (t ? c.getTokenCountAsync(t) : Promise.resolve(0));
    const rows = [];
    const { text: inline, request } = injectionFor(c.chat.length);
    rows.push([request.size ? 'Инструкция в следующем запросе' : 'Напоминание о состоянии', `≈ ${await count(inline)}`, 'вход']);

    const outs = [];
    for (let i = c.chat.length - 1; i >= 0 && outs.length < 10; i--) {
        const n = getData(c.chat[i])?.outTokens;
        if (n) outs.push(n);
    }
    if (outs.length) rows.push(['Блок в ответе (в среднем)', `≈ ${Math.round(outs.reduce((a, b) => a + b, 0) / outs.length)}`, 'выход']);

    if (s.mode !== 'inline' || (s.modules.diary.enabled && s.modules.diary.mode === 'separate')) {
        const opts = buildOpts();
        const lastId = lastBotMessageId();
        const prev = lastId >= 0 ? getData(c.chat[lastId])?.state ?? null : null;
        const sep = buildInstruction({ state: prev, request: allTrackerModules(opts), opts, separate: true });
        const label = s.mode === 'auto' ? 'Отдельный запрос (только если модель забыла блок)' : 'Отдельный запрос';
        rows.push([`${label}${s.separateKind === 'full' ? ' + вся история' : ` + ${s.contextMessages} сообщ.`}`, `≈ ${await count(sep)}`, 'вход']);
    }

    let html = '<table class="mi-tok-table">';
    for (const [name, value, kind] of rows) html += `<tr><td>${esc(name)}</td><td class="mi-tok-val">${esc(value)}</td><td class="mi-tok-kind">${esc(kind)}</td></tr>`;
    html += '</table><div class="mi-tok-note">Старые блоки вырезаются из истории — в контекст не попадают.</div>';
    $out.html(html);
}
