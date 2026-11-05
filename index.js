// MegaInfo — инфоблоки для SillyTavern.
// Точка входа: подписки на события таверны, вставка инструкций в промпт, отрисовка блоков.

import { MODULE, VERSION, getSettings, saveSettings } from './src/settings.js';
import { OUR_TAGS } from './src/core/engine.js';
import { getData, getMessage, isBotMessage, lastBotMessageId, saveChat, setData } from './src/store.js';
import {
    allTrackerModules, blockingJobs, buildOpts, cleanForPrompt, clearPending, handleEdited, handleReceived, injectionFor, pending, runSeparate,
    setChangeListener,
} from './src/tracker.js';
import { mountCard, renderPanel } from './src/render.js';
import { initSettingsUi, loadValues, refreshTokenStats } from './src/ui-settings.js';
import { addWandButton } from './src/quick.js';
import * as Log from './src/log.js';
import { stripTagBlocks } from './src/util.js';

const PROMPT_KEY = 'megainfo_inject';
const ctx = () => SillyTavern.getContext();

/** Свёрнутость панелей, которую пользователь поменял руками: id -> bool */
const collapsedOverride = new Map();

// ------------------------------------------------------------------ промпт

function clearInjection() {
    ctx().setExtensionPrompt(PROMPT_KEY, '', 1, 0);
}

/**
 * Вызывается таверной перед каждой генерацией (см. generate_interceptor в manifest.json).
 * В chat лежат сообщения, которые уйдут модели. Мы не меняем сами сообщения, а заменяем их копиями.
 */
globalThis.megaInfoInterceptor = async function (chat, _contextSize, _abort, type) {
    try {
        const s = getSettings();
        if (!s.enabled) {
            clearInjection();
            return;
        }
        // 1. Чистим историю от блоков — модель их не видит, токены не тратятся.
        const n = chat.length;
        for (let i = 0; i < n; i++) {
            const m = chat[i];
            if (typeof m?.mes !== 'string' || !m.mes) continue;
            const cleaned = cleanForPrompt(m.mes, n - 1 - i, s);
            if (cleaned !== m.mes) chat[i] = { ...m, mes: cleaned };
        }
        // 2. Тихие запросы (наши отдельные, сводки и т.п.) и «писать за меня» — без вставки.
        if (type === 'quiet' || type === 'impersonate') {
            clearInjection();
            return;
        }
        // 3. Если ещё не закончился отдельный запрос за блоком — подождём (до 20 сек), чтобы состояние было свежим.
        const jobs = blockingJobs();
        if (jobs.length) {
            await Promise.race([
                Promise.allSettled(jobs),
                new Promise((r) => setTimeout(r, 20000)),
            ]);
        }
        // 4. Вставляем инструкцию + текущее состояние.
        const c = ctx();
        const targetId = (type === 'swipe' || type === 'continue') ? c.chat.length - 1 : c.chat.length;
        const { text, request } = injectionFor(targetId);
        if (text) {
            c.setExtensionPrompt(PROMPT_KEY, text, 1 /* IN_CHAT */, Number(s.depth) || 0, false, s.injectRole === 'system' ? 0 : 1 /* USER */);
            Log.info(`→ #${targetId} (${type ?? 'normal'}): ${request.size ? 'прошу блок: ' + [...request].join(', ') : 'только напоминание о состоянии'}`, { chars: text.length });
        } else {
            clearInjection();
        }
    } catch (e) {
        Log.error('interceptor failed: ' + (e?.message ?? e));
        console.error(e);
    }
};

// ------------------------------------------------------------------ отрисовка

/** Входит ли сообщение в последние N ответов бота. */
function shouldShow(messageId) {
    const n = Number(getSettings().showOnLast) || 0;
    if (n <= 0) return true;
    const { chat } = ctx();
    let count = 0;
    for (let i = chat.length - 1; i >= messageId; i--) if (isBotMessage(chat[i])) count++;
    return count <= n;
}

function applyDynamicStyles() {
    const s = getSettings();
    let $style = $('#megainfo-dynamic-css');
    if (!$style.length) $style = $('<style id="megainfo-dynamic-css"></style>').appendTo('head');
    const { accent, bg, text } = s.custom ?? {};
    const custom = `.mi-host[data-mi-theme="custom"]{--mi-accent:${accent};--mi-bg:${bg};--mi-text:${text};--mi-em:${text};`
        + `--mi-card:color-mix(in srgb,${text} 5%,transparent);--mi-line:color-mix(in srgb,${text} 15%,transparent);`
        + `--mi-muted:color-mix(in srgb,${text} 60%,transparent);--mi-shadow:0 4px 16px #0004;}`;
    $style.text(custom + '\n' + String(s.customCss ?? ''));
}

function render(messageId) {
    const id = Number(messageId);
    const $mes = $(`#chat .mes[mesid="${id}"]`);
    if (!$mes.length) return;
    const $block = $mes.find('.mes_block').first();
    $block.children('.mi-host').remove();

    const s = getSettings();
    const message = getMessage(id);
    if (!s.enabled || !isBotMessage(message)) return;
    const isPending = pending.has(id);
    if (!isPending && !shouldShow(id)) return;

    const opts = buildOpts();
    const collapsed = collapsedOverride.has(id) ? collapsedOverride.get(id) : !!s.collapsed;
    const html = renderPanel({
        data: getData(message), opts, pending: isPending, isLast: id === lastBotMessageId(), collapsed, activeTab: s.lastTab,
    });
    if (!html) return;

    const $host = $('<div class="mi-host"></div>').attr({ 'data-mi-theme': s.theme, 'data-mi-font': s.font }).html(html);
    const $text = $block.children('.mes_text');
    if (s.placement === 'bottom') $text.after($host);
    else $text.before($host);

    const card = getData(message)?.card;
    if (card) $host.find('[data-mi-card]').each((_, el) => mountCard(el, card));
}

export function renderAll() {
    const { chat } = ctx();
    $('#chat .mes').each(function () {
        const id = Number($(this).attr('mesid'));
        if (Number.isFinite(id) && id < chat.length) render(id);
    });
}

// ------------------------------------------------------------------ кнопки в блоках

async function editState(messageId) {
    const c = ctx();
    const message = getMessage(messageId);
    const state = getData(message)?.state;
    if (!state) return;
    const value = await c.callGenericPopup(
        '<b>Значения инфоблока</b><br><small>Можно поправить числа, деньги, имена, симпатию, следы. Сохраняется для этого сообщения; следующие блоки будут считаться от него.</small>',
        c.POPUP_TYPE.INPUT,
        JSON.stringify(state, null, 2),
        { rows: 24, wide: true, large: true, okButton: 'Сохранить', cancelButton: 'Отмена' },
    );
    if (!value || typeof value !== 'string') return;
    try {
        setData(message, 'state', JSON.parse(value));
        await saveChat();
        render(messageId);
        toastr.success('Сохранено', 'MegaInfo');
    } catch (e) {
        toastr.error('Не получилось прочитать JSON: ' + e.message, 'MegaInfo');
    }
}

function onActionClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const $btn = $(event.currentTarget);
    const id = Number($btn.closest('.mes').attr('mesid'));
    if (!Number.isFinite(id)) return;
    const act = $btn.data('mi-act');
    if (act === 'regen') runSeparate(id, allTrackerModules());
    if (act === 'diary') runSeparate(id, ['diary']);
    if (act === 'edit') editState(id);
    if (act === 'toggle') {
        const s = getSettings();
        const now = collapsedOverride.has(id) ? collapsedOverride.get(id) : !!s.collapsed;
        collapsedOverride.set(id, !now);
        render(id);
    }
}

function onTabClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const $tab = $(event.currentTarget);
    const key = String($tab.data('mi-tab'));
    const $panel = $tab.closest('.mi-panel');
    $panel.find('.mi-tab').removeClass('mi-active');
    $panel.find('.mi-pane').removeClass('mi-active');
    $tab.addClass('mi-active');
    $panel.find(`.mi-pane[data-mi-pane="${key}"]`).addClass('mi-active');
    const s = getSettings();
    if (s.lastTab !== key) {
        s.lastTab = key;
        saveSettings();
    }
}

// ------------------------------------------------------------------ запуск

function registerFormatterHook() {
    // Прячет сырой <megainfo>{...} прямо во время печати ответа (SillyTavern 1.13.5+).
    const formatter = ctx().messageFormatter;
    if (!formatter?.addHook) return false;
    formatter.addHook((mes, info) => {
        if (info?.isUser || typeof mes !== 'string') return mes;
        const s = getSettings();
        if (!s.enabled || !s.hideWhileStreaming || !/<megainfo/i.test(mes)) return mes;
        return stripTagBlocks(mes, OUR_TAGS);
    }, { stage: formatter.stage?.BEFORE_REGEX ?? 'beforeRegex' });
    return true;
}

async function init() {
    const c = ctx();
    const { eventSource, eventTypes: E } = c;
    getSettings();

    setChangeListener((id) => {
        render(id);
        refreshTokenStats();
    });

    await initSettingsUi({
        onChange: () => {
            saveSettings();
            applyDynamicStyles();
            renderAll();
            refreshTokenStats();
        },
    });
    applyDynamicStyles();

    try {
        if (!registerFormatterHook()) Log.info('Хук форматирования недоступен (старая версия таверны) — сырой блок может мелькать во время печати');
    } catch (e) {
        console.warn('[MegaInfo] formatter hook unavailable', e);
    }

    const safe = (fn) => async (...args) => {
        try {
            await fn(...args);
        } catch (e) {
            Log.error(`ошибка обработчика: ${e?.message ?? e}`);
            console.error(e);
        }
    };

    eventSource.on(E.MESSAGE_RECEIVED, safe(handleReceived));
    // предыдущие ответы могли выйти за «последние N» — перерисовываем все
    eventSource.on(E.CHARACTER_MESSAGE_RENDERED, safe(() => renderAll()));
    eventSource.on(E.USER_MESSAGE_RENDERED, safe(() => renderAll()));
    eventSource.on(E.MESSAGE_SWIPED, safe((id) => setTimeout(() => render(Number(id)), 0)));
    eventSource.on(E.MESSAGE_EDITED, safe(handleEdited));
    eventSource.on(E.MESSAGE_UPDATED, safe((id) => render(Number(id))));
    eventSource.on(E.MESSAGE_DELETED, safe(() => setTimeout(renderAll, 0)));
    eventSource.on(E.MORE_MESSAGES_LOADED, safe(() => setTimeout(renderAll, 0)));
    eventSource.on(E.CHAT_CHANGED, safe(() => {
        clearPending();
        collapsedOverride.clear();
        clearInjection();
        setTimeout(() => {
            renderAll();
            refreshTokenStats();
            loadValues();
        }, 100);
    }));
    eventSource.on(E.GENERATION_ENDED, safe(() => refreshTokenStats()));

    $(document).on('click', '.mi-host .mi-act', onActionClick);
    $(document).on('click', '.mi-host .mi-tab', onTabClick);

    addWandButton(() => {
        saveSettings();
        loadValues();
        renderAll();
    });

    renderAll();
    Log.info(`MegaInfo ${VERSION} загружен`);
    console.log('[MegaInfo] loaded', MODULE, VERSION);
}

jQuery(() => {
    init().catch((e) => {
        console.error('[MegaInfo] init failed', e);
        toastr.error(String(e?.message ?? e), 'MegaInfo не запустился');
    });
});
